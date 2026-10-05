import { createCanvas, type Canvas } from '@napi-rs/canvas';
import type { StreamDeckControlDefinition } from '@elgato-stream-deck/node';
import type { Background, KeyRect } from './background.ts';
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

/**
 * A background frame goes out this many keys at a time, so a key that changes
 * (a press) only ever waits behind one small batch, not a whole-deck frame.
 */
const BG_BATCH = 8;

/** Background canvas resolution relative to the panel; it's scaled up smoothly. */
const BG_SCALE = 1 / 4;

/**
 * 8x8 ordered-dither thresholds in (0, 1). Dark, smooth backgrounds band on
 * the deck: its LCDs appear to show 16-bit colour (RGB565), so red and blue
 * only change every 8 levels and green every 4. dither() snaps each channel
 * to those steps using this fixed pattern, turning hard bands into a fine
 * grain the eye blends. Fixed, so unchanged keys stay identical frame to
 * frame and still skip sending.
 */
const BAYER = Float32Array.from(
  [
    0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26,
    12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
    3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25,
    15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
  ],
  (b) => (b + 0.5) / 64,
);

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
  #timerAt = 0;
  #inFlight = false;
  #lastFrameAt = 0;
  #bgFrameMs: number;
  #lastBgAt = 0;
  /** The background canvas needs redrawing (new background, or waking up). */
  #bgStale = true;
  /** Keys still to send for the current background frame, a batch at a time. */
  #bgQueue: number[] = [];
  #stopped = false;
  #frames = 0;
  #keysSent = 0;
  #statsTimer: NodeJS.Timeout;
  #onStats = new Set<() => void>();
  #keys: { index: number; row: number; column: number; x: number; y: number; w: number; h: number }[];
  #bgKeys: KeyRect[];
  #background: Background | undefined;
  #bgCanvas: Canvas;
  #startedAt = performance.now();
  #standby = false;
  #onStop: (() => void)[] = [];
  #standbyWidgets = new Map<number, Widget>();
  #brightness: number;
  #standbyBrightness: number;

  constructor(
    deck: Surface,
    opts: { maxFps?: number; backgroundFps?: number; brightness?: number; standbyBrightness?: number } = {},
  ) {
    this.#deck = deck;
    this.#minFrameMs = 1000 / (opts.maxFps ?? 60);
    // Animated backgrounds redraw every key, which fills the USB link. Capping
    // them leaves room between background frames for keys that change (a
    // press, new data) to go out straight away.
    this.#bgFrameMs = 1000 / (opts.backgroundFps ?? 12);
    this.#brightness = opts.brightness ?? 70;
    this.#standbyBrightness = opts.standbyBrightness ?? 25;
    this.#setBrightness(this.#brightness);
    const button = deck.CONTROLS.find((c) => c.type === 'button' && c.feedbackType === 'lcd');
    this.size = button && 'pixelSize' in button ? button.pixelSize.width : 96;

    // Where each key sits on the physical panel, so a background flows across
    // the gaps between keys instead of restarting on every key.
    this.#keys = deck.CONTROLS.flatMap((c) =>
      c.type === 'button' && c.feedbackType === 'lcd'
        ? [{ index: c.index, row: c.row, column: c.column, ...('bounds' in c && c.bounds ? c.bounds : { x: c.column * (this.size + 32), y: c.row * (this.size + 32), width: this.size, height: this.size }) }]
        : [],
    ).map(({ index, row, column, x, y, width, height }) => ({ index, row, column, x, y, w: width, h: height }));
    // The same rects in background-canvas pixels, for backgrounds that light
    // whole keys (a scanner, a chase) rather than painting across the panel.
    this.#bgKeys = this.#keys.map((k) => ({
      index: k.index,
      row: k.row,
      column: k.column,
      x: k.x * BG_SCALE,
      y: k.y * BG_SCALE,
      w: k.w * BG_SCALE,
      h: k.h * BG_SCALE,
    }));
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
    this.#bgStale = true;
    this.#bgQueue = [];
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
    this.#bgStale = true;
    this.#bgQueue = [];
    this.#setBrightness(on ? this.#standbyBrightness : this.#brightness);
    for (const k of this.#keys) this.#dirty.add(k.index);
    this.#schedule();
  }

  /** Change the normal backlight level; applied now unless in standby. */
  setBrightness(percent: number): void {
    this.#brightness = percent;
    if (!this.#standby) this.#setBrightness(percent);
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

  /**
   * Plan the next frame: as soon as allowed when keys are waiting, otherwise
   * at the next background frame. A key change pulls a far-off background
   * frame forward rather than waiting for it.
   */
  #schedule(): void {
    if (this.#inFlight || this.#stopped) return;
    const now = performance.now();
    let at: number | undefined;
    if (this.#dirty.size) at = this.#lastFrameAt + this.#minFrameMs;
    else if (this.#bgQueue.length) at = now;
    else if (this.#animating) at = this.#lastBgAt + this.#bgInterval;
    if (at === undefined) return;
    if (this.#timer) {
      if (this.#timerAt <= at) return;
      clearTimeout(this.#timer);
    }
    this.#timerAt = at;
    this.#timer = setTimeout(() => void this.#frame(), Math.max(0, at - now));
  }

  /** Time between background frames: the background's own rate, or the default. */
  get #bgInterval(): number {
    const fps = this.#background?.fps;
    return fps ? 1000 / fps : this.#bgFrameMs;
  }

  get #animating(): boolean {
    return !this.#standby && !!this.#background?.animated;
  }

  async #frame(): Promise<void> {
    this.#timer = undefined;
    if (this.#stopped) return;
    this.#inFlight = true;
    const start = performance.now();
    this.#lastFrameAt = start;

    // Redraw the background when it's due; keys changing between background
    // frames reuse the last one.
    const bg = this.#standby ? undefined : this.#background;
    const bgDue = !!bg && (this.#bgStale || (bg.animated && start - this.#lastBgAt >= this.#bgInterval * 0.9));
    if (bg && bgDue) {
      bg.render(this.#bgCanvas, (start - this.#startedAt) / 1000, this.#bgKeys);
      this.#lastBgAt = start;
      this.#bgStale = false;
    }
    // Changed keys go out first and in full; the background frame follows a
    // batch at a time, so a press never waits behind the whole deck.
    if (bgDue) this.#bgQueue = this.#keys.map((k) => k.index);
    const keys = [...this.#dirty];
    for (const i of this.#bgQueue.splice(0, BG_BATCH)) if (!this.#dirty.has(i)) keys.push(i);
    this.#dirty.clear();
    try {
      // JPEG encoding runs off-thread, so drawing every key first and sending
      // them together lets the encodes overlap. Sends go out in this order.
      await Promise.all(keys.map((i) => this.#draw(i)));
    } catch (err) {
      if (!this.#stopped) console.error('frame failed:', err);
    }

    this.#frames++;
    this.stats.frameMs = performance.now() - start;
    this.#inFlight = false;
    this.#schedule();
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
    if (background) dither(pixels, this.size);
    const last = this.#lastPixels.get(index);
    if (last && Buffer.from(last.buffer).equals(Buffer.from(pixels.buffer))) return;
    this.#lastPixels.set(index, pixels);

    await this.#deck.fillKeyBuffer(index, pixels, { format: 'rgba' });
    this.#keysSent++;
  }
}

function dither(pixels: Uint8ClampedArray, size: number): void {
  for (let y = 0; y < size; y++) {
    const row = (y & 7) * 8;
    for (let x = 0; x < size; x++) {
      const t = BAYER[row + (x & 7)];
      const i = (y * size + x) * 4;
      pixels[i] = snap(pixels[i], 8, t);
      pixels[i + 1] = snap(pixels[i + 1], 4, t);
      pixels[i + 2] = snap(pixels[i + 2], 8, t);
    }
  }
}

/**
 * Round `v` to a multiple of `step`, up or down by threshold `t`. The result
 * sits a little above the step (not on it) so JPEG's small errors don't tip
 * it into the neighbouring level, whether the deck truncates or rounds.
 * Black stays black.
 */
function snap(v: number, step: number, t: number): number {
  const q = Math.floor(v / step + t);
  return q ? q * step + (step >> 1) - 1 : 0;
}
