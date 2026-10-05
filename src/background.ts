import type { Canvas } from '@napi-rs/canvas';

/**
 * Something drawn behind every key, as one image across the whole panel.
 * render() paints a small deck-wide canvas; the engine scales each key's
 * slice of it up, so cost is per frame, not per key.
 */
export interface Background {
  /** Redraw every frame (otherwise drawn once). */
  readonly animated: boolean;
  render(canvas: Canvas, timeSec: number): void;
}

/** A rainbow that rolls across the deck, bent into a slow travelling wave. */
export class RainbowWave implements Background {
  readonly animated = true;
  #speed: number;
  #bands: number;
  #wave: number;
  #saturation: number;
  #lightness: number;

  constructor(opts: {
    /** Hue cycles per second rolling past a point. */
    speed?: number;
    /** Full rainbows across the panel width. */
    bands?: number;
    /** How much the colour bands bend up and down the rows (0 = straight). */
    wave?: number;
    saturation?: number;
    /** Kept low so key text stays readable on top. */
    lightness?: number;
  } = {}) {
    this.#speed = opts.speed ?? 0.25;
    this.#bands = opts.bands ?? 1;
    this.#wave = opts.wave ?? 0.15;
    this.#saturation = opts.saturation ?? 0.9;
    this.#lightness = opts.lightness ?? 0.32;
  }

  render(canvas: Canvas, t: number): void {
    const { width: w, height: h } = canvas;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(w, h);
    const px = image.data;
    for (let y = 0; y < h; y++) {
      const v = y / h;
      for (let x = 0; x < w; x++) {
        const u = x / w;
        const bend = Math.sin((u * 1.5 + t * 0.4) * Math.PI * 2) * this.#wave * v;
        const hue = fract(u * this.#bands + bend - t * this.#speed);
        const i = (y * w + x) * 4;
        hslToRgb(hue, this.#saturation, this.#lightness, px, i);
        px[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }
}

/**
 * A warm amber glow that slowly breathes. It's brightest near a centre that
 * drifts gently, so the panel looks lit from behind rather than flat-filled.
 */
export class WarmGlow implements Background {
  readonly animated = true;
  #period: number;
  #hue: number;
  #min: number;
  #max: number;

  constructor(opts: {
    /** Seconds per breath. */
    period?: number;
    /** 0–1 hue; ~0.08 is amber, lower is redder, higher is more golden. */
    hue?: number;
    /** Lightness at the dimmest and brightest point of the pulse. */
    min?: number;
    max?: number;
  } = {}) {
    this.#period = opts.period ?? 4;
    this.#hue = opts.hue ?? 0.08;
    this.#min = opts.min ?? 0.1;
    this.#max = opts.max ?? 0.34;
  }

  render(canvas: Canvas, t: number): void {
    const { width: w, height: h } = canvas;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(w, h);
    const px = image.data;

    // Ease in and out so it lingers at the top and bottom of each breath.
    const breath = (1 - Math.cos((t / this.#period) * Math.PI * 2)) / 2;
    const level = this.#min + (this.#max - this.#min) * breath;
    const cx = 0.5 + 0.15 * Math.sin(t * 0.23);
    const cy = 0.5 + 0.2 * Math.cos(t * 0.17);

    for (let y = 0; y < h; y++) {
      const dy = (y / h - cy) * (h / w);
      for (let x = 0; x < w; x++) {
        const dx = x / w - cx;
        const falloff = 1 - Math.min(1, Math.sqrt(dx * dx + dy * dy) * 1.4);
        const l = level * (0.45 + 0.55 * falloff);
        // Hotter spots shift slightly toward gold, like a filament.
        const i = (y * w + x) * 4;
        hslToRgb(this.#hue + 0.03 * falloff * breath, 1, l, px, i);
        px[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }
}

/**
 * One colour, glowing from the middle of the panel and optionally pulsing.
 * The building block for background states (see ambient.ts).
 */
export class ColorPulse implements Background {
  readonly animated: boolean;
  #rgb: [number, number, number];
  #period: number;
  #min: number;
  #max: number;

  constructor(color: string, opts: {
    /** Seconds per pulse; 0 for a steady glow. */
    period?: number;
    /** Brightness (0–1) at the bottom and top of the pulse. */
    min?: number;
    max?: number;
  } = {}) {
    const hex = /^#?([0-9a-f]{6})$/i.exec(color)?.[1];
    if (!hex) throw new Error(`ColorPulse: expected a #rrggbb colour, got "${color}"`);
    const n = parseInt(hex, 16);
    this.#rgb = [n >> 16, (n >> 8) & 0xff, n & 0xff];
    this.#period = opts.period ?? 2.5;
    this.#min = opts.min ?? 0.15;
    this.#max = opts.max ?? 0.6;
    this.animated = this.#period > 0;
  }

  render(canvas: Canvas, t: number): void {
    const { width: w, height: h } = canvas;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(w, h);
    const px = image.data;
    const breath = this.animated ? (1 - Math.cos((t / this.#period) * Math.PI * 2)) / 2 : 1;
    const level = this.#min + (this.#max - this.#min) * breath;
    const [r, g, b] = this.#rgb;
    for (let y = 0; y < h; y++) {
      const dy = (y / h - 0.5) * (h / w);
      for (let x = 0; x < w; x++) {
        const dx = x / w - 0.5;
        const falloff = 1 - Math.min(1, Math.sqrt(dx * dx + dy * dy) * 1.4);
        const k = level * (0.5 + 0.5 * falloff);
        const i = (y * w + x) * 4;
        px[i] = r * k;
        px[i + 1] = g * k;
        px[i + 2] = b * k;
        px[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }
}

function fract(n: number): number {
  return n - Math.floor(n);
}

function hslToRgb(h: number, s: number, l: number, out: Uint8ClampedArray, i: number): void {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  out[i] = f(0);
  out[i + 1] = f(8);
  out[i + 2] = f(4);
}
