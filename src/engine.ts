import { createCanvas, type Canvas } from '@napi-rs/canvas';
import type { StreamDeckControlDefinition } from '@elgato-stream-deck/node';
import type { Background } from './background.ts';
import type { Widget } from './widget.ts';

/**
 * What the engine needs from a deck. A real StreamDeck satisfies it, and so
 * does VirtualDeck, so the same layout can drive either.
 */
export interface Surface {
  readonly CONTROLS: Readonly<StreamDeckControlDefinition[]>;
  on(event: 'down' | 'up', fn: (control: StreamDeckControlDefinition) => void): unknown;
  fillKeyBuffer(index: number, pixels: Uint8ClampedArray, options: { format: 'rgba' }): Promise<void>;
  setBrightness(percent: number): Promise<void>;
}

/** Background canvas resolution relative to the panel; it's scaled up smoothly. */
const BG_SCALE = 1 / 8;

export interface EngineStats {
  fps: number;
  keysPerSec: number;
  frameMs: number;
}

/**
 * Drives the deck. Each key is redrawn only when its widget invalidates, and
 * only sent over USB if its pixels actually changed. Frames never queue: while
 * one is being sent, new invalidations just mark keys dirty, and the next frame
 * draws whatever the latest state is. That keeps latency at one frame however
 * fast the data comes in.
 */
export class Engine {
  readonly size: number;
  readonly stats: EngineStats = { fps: 0, keysPerSec: 0, frameMs: 0 };

  #deck: Surface;
  #minFrameMs: number;
  #widgets = new Map<number, Widget>();
  #canvases = new Map<number, Canvas>();
  #lastPixels = new Map<number, Uint8ClampedArray>();
  #dirty = new Set<number>();
  #timer: NodeJS.Timeout | undefined;
  #inFlight = false;
  #lastFrameAt = 0;
  #stopped = false;
  #frames = 0;
  #keysSent = 0;
  #statsTimer: NodeJS.Timeout;
  #onStats = new Set<() => void>();
  #keys: { index: number; x: number; y: number; w: number; h: number }[];
  #background: Background | undefined;
  #bgCanvas: Canvas;
  #startedAt = performance.now();
  #standby = false;
  #onStop: (() => void)[] = [];
  #standbyWidgets = new Map<number, Widget>();
  #brightness: number;
  #standbyBrightness: number;

  constructor(deck: Surface, opts: { maxFps?: number; brightness?: number; standbyBrightness?: number } = {}) {
    this.#deck = deck;
    this.#minFrameMs = 1000 / (opts.maxFps ?? 60);
    this.#brightness = opts.brightness ?? 70;
    this.#standbyBrightness = opts.standbyBrightness ?? 25;
    this.#setBrightness(this.#brightness);
    const button = deck.CONTROLS.find((c) => c.type === 'button' && c.feedbackType === 'lcd');
    this.size = button && 'pixelSize' in button ? button.pixelSize.width : 96;

    // Where each key sits on the physical panel, so a background flows across
    // the gaps between keys instead of restarting on every key.
    this.#keys = deck.CONTROLS.flatMap((c) =>
      c.type === 'button' && c.feedbackType === 'lcd'
        ? [{ index: c.index, ...('bounds' in c && c.bounds ? c.bounds : { x: c.column * (this.size + 32), y: c.row * (this.size + 32), width: this.size, height: this.size }) }]
        : [],
    ).map(({ index, x, y, width, height }) => ({ index, x, y, w: width, h: height }));
    const panelW = Math.max(...this.#keys.map((k) => k.x + k.w));
    const panelH = Math.max(...this.#keys.map((k) => k.y + k.h));
    this.#bgCanvas = createCanvas(Math.ceil(panelW * BG_SCALE), Math.ceil(panelH * BG_SCALE));

    this.#statsTimer = setInterval(() => {
      this.stats.fps = this.#frames;
      this.stats.keysPerSec = this.#keysSent;
      this.#frames = 0;
      this.#keysSent = 0;
      for (const fn of this.#onStats) fn();
    }, 1000);

    deck.on('down', (c) => {
      if (c.type === 'button') this.#active.get(c.index)?.onDown?.();
    });
    deck.on('up', (c) => {
      if (c.type === 'button') this.#active.get(c.index)?.onUp?.();
    });
  }

  /** Run when this engine stops, e.g. to unsubscribe from shared services. */
  onStop(fn: () => void): void {
    this.#onStop.push(fn);
  }

  onStats(fn: () => void): () => void {
    this.#onStats.add(fn);
    return () => this.#onStats.delete(fn);
  }

  /** Draw something behind every key. Animated backgrounds redraw each frame. */
  setBackground(background: Background | undefined): void {
    this.#background = background;
    for (const k of this.#keys) this.#dirty.add(k.index);
    this.#schedule();
  }

  mount(index: number, widget: Widget): void {
    this.#mountInto(this.#widgets, index, widget);
  }

  /** Clear a key back to just the background. */
  unmount(index: number): void {
    this.#widgets.get(index)?.detach();
    if (this.#widgets.delete(index) && !this.#standby) this.invalidate(index);
  }

  /**
   * Mount a widget that only exists in standby. Everything else goes dark and
   * ignores presses, and the background stops, so the deck sends nothing
   * over USB until one of these widgets changes.
   */
  mountStandby(index: number, widget: Widget): void {
    this.#mountInto(this.#standbyWidgets, index, widget);
  }

  get standby(): boolean {
    return this.#standby;
  }

  setStandby(on: boolean): void {
    if (on === this.#standby || this.#stopped) return;
    this.#standby = on;
    this.#setBrightness(on ? this.#standbyBrightness : this.#brightness);
    for (const k of this.#keys) this.#dirty.add(k.index);
    this.#schedule();
  }

  get #active(): Map<number, Widget> {
    return this.#standby ? this.#standbyWidgets : this.#widgets;
  }

  #mountInto(layer: Map<number, Widget>, index: number, widget: Widget): void {
    layer.get(index)?.detach();
    layer.set(index, widget);
    // Hidden layers don't redraw; switching layers repaints every key anyway.
    widget.attach(() => {
      if (layer === this.#active) this.invalidate(index);
    });
    if (layer === this.#active) this.invalidate(index);
  }

  #setBrightness(percent: number): void {
    this.#deck.setBrightness(percent).catch((err) => console.error('brightness:', err));
  }

  invalidate(index: number): void {
    if (this.#stopped) return;
    this.#dirty.add(index);
    this.#schedule();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    clearTimeout(this.#timer);
    clearInterval(this.#statsTimer);
    for (const fn of this.#onStop.splice(0)) fn();
    for (const w of [...this.#widgets.values(), ...this.#standbyWidgets.values()]) w.detach();
    this.#widgets.clear();
    this.#standbyWidgets.clear();
  }

  #schedule(): void {
    if (this.#timer || this.#inFlight) return;
    const wait = Math.max(0, this.#lastFrameAt + this.#minFrameMs - performance.now());
    this.#timer = setTimeout(() => void this.#frame(), wait);
  }

  async #frame(): Promise<void> {
    this.#timer = undefined;
    if (this.#stopped) return;
    this.#inFlight = true;
    const start = performance.now();
    this.#lastFrameAt = start;

    const bg = this.#standby ? undefined : this.#background;
    if (bg) bg.render(this.#bgCanvas, (start - this.#startedAt) / 1000);
    const keys = bg?.animated ? this.#keys.map((k) => k.index) : [...this.#dirty];
    this.#dirty.clear();
    try {
      // JPEG encoding runs off-thread, so drawing every key first and sending
      // them together lets the encodes overlap.
      await Promise.all(keys.map((i) => this.#draw(i)));
    } catch (err) {
      if (!this.#stopped) console.error('frame failed:', err);
    }

    this.#frames++;
    this.stats.frameMs = performance.now() - start;
    this.#inFlight = false;
    if (this.#dirty.size || (!this.#standby && this.#background?.animated)) this.#schedule();
  }

  async #draw(index: number): Promise<void> {
    const widget = this.#active.get(index);
    const background = this.#standby ? undefined : this.#background;

    let canvas = this.#canvases.get(index);
    if (!canvas) {
      canvas = createCanvas(this.size, this.size);
      this.#canvases.set(index, canvas);
    }
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.size, this.size);
    const key = background && this.#keys.find((k) => k.index === index);
    if (key) {
      ctx.drawImage(this.#bgCanvas, key.x * BG_SCALE, key.y * BG_SCALE, key.w * BG_SCALE, key.h * BG_SCALE, 0, 0, this.size, this.size);
    }
    widget?.render(ctx, this.size);
    ctx.restore();

    const pixels = ctx.getImageData(0, 0, this.size, this.size).data;
    const last = this.#lastPixels.get(index);
    if (last && Buffer.from(last.buffer).equals(Buffer.from(pixels.buffer))) return;
    this.#lastPixels.set(index, pixels);

    await this.#deck.fillKeyBuffer(index, pixels, { format: 'rgba' });
    this.#keysSent++;
  }
}
