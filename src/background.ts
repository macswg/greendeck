import type { Canvas, SKRSContext2D } from '@napi-rs/canvas';

/**
 * Something drawn behind every key, as one image across the whole panel.
 * render() paints a small deck-wide canvas; the engine scales each key's
 * slice of it up, so cost is per frame, not per key.
 */
export interface Background {
  /** Redraw every frame (otherwise drawn once). */
  readonly animated: boolean;
  /** Background frames per second, if it wants other than the engine default. */
  readonly fps?: number;
  /** `keys` gives each key's rect on the canvas, for lighting whole keys. */
  render(canvas: Canvas, timeSec: number, keys: readonly KeyRect[]): void;
}

export interface KeyRect {
  index: number;
  row: number;
  column: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Fill a key's rect plus a margin, so scaling never blurs black into its edges. */
function fillKey(ctx: SKRSContext2D, k: KeyRect, margin = 3): void {
  ctx.fillRect(k.x - margin, k.y - margin, k.w + margin * 2, k.h + margin * 2);
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
    this.#rgb = parseHex(color);
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

/**
 * A band of colour that sweeps across the deck column by column, with a
 * fading tail, like a chase light. Each column is one flat colour at a time,
 * so there's no gradient inside a key to band; the motion comes from columns
 * brightening and fading.
 */
export class ColorChase implements Background {
  readonly animated = true;
  #rgb: [number, number, number];
  #period: number;
  #columns: number;
  #tail: number;
  #min: number;
  #max: number;

  constructor(color: string, opts: {
    /** Seconds for the band to cross the deck. */
    period?: number;
    /** Key columns on the deck. */
    columns?: number;
    /** How many columns the fading tail spans. */
    tail?: number;
    /** Brightness (0–1) of unlit columns and of the band's head. */
    min?: number;
    max?: number;
  } = {}) {
    this.#rgb = parseHex(color);
    this.#period = opts.period ?? 1.6;
    this.#columns = opts.columns ?? 8;
    this.#tail = opts.tail ?? 2.5;
    this.#min = opts.min ?? 0.05;
    this.#max = opts.max ?? 0.6;
  }

  render(canvas: Canvas, t: number): void {
    const { width: w, height: h } = canvas;
    const ctx = canvas.getContext('2d');
    const n = this.#columns;
    const head = fract(t / this.#period) * n;
    const [r, g, b] = this.#rgb;
    for (let c = 0; c < n; c++) {
      // How far this column is behind the head, wrapping round the deck.
      const behind = (head - (c + 0.5) + n) % n;
      // Rounded to a few levels so columns that barely change from one frame
      // to the next stay identical and aren't re-sent.
      const glow = Math.round(Math.exp(-behind / this.#tail) * Math.min(1, (n - behind) * 2) * 24) / 24;
      const k = this.#min + (this.#max - this.#min) * glow;
      ctx.fillStyle = `rgb(${r * k}, ${g * k}, ${b * k})`;
      ctx.fillRect(Math.floor((c * w) / n), 0, Math.ceil(w / n) + 1, h);
    }
  }
}

/**
 * A KITT-style scanner: one light sweeping back and forth along a row of keys,
 * each key glowing as it passes and fading out behind it. Only that row
 * changes, so it costs little and leaves the rest of the deck quiet.
 */
export class Scanner implements Background {
  readonly animated = true;
  readonly fps = 24;
  #rgb: [number, number, number];
  #period: number;
  #columns: number;
  #row: number;
  #decay: number;
  /**
   * Afterglow per canvas: the hardware and browser decks each draw this same
   * scanner, so each keeps its own fading levels rather than sharing (and
   * scrambling) one set.
   */
  #glow = new WeakMap<Canvas, { levels: Float32Array; lastT: number; startT: number }>();

  constructor(color: string, opts: {
    /** Seconds for one sweep across and back. */
    period?: number;
    columns?: number;
    /** Which row of keys it runs along (0 = top). */
    row?: number;
    /** Seconds for a key's afterglow to fade to about a third. */
    decay?: number;
  } = {}) {
    this.#rgb = parseHex(color);
    this.#period = opts.period ?? 1.8;
    this.#columns = opts.columns ?? 8;
    this.#row = opts.row ?? 0;
    this.#decay = opts.decay ?? 0.22;
  }

  /** Seconds for one sweep across and back. */
  get period(): number {
    return this.#period;
  }

  render(canvas: Canvas, t: number, keys: readonly KeyRect[]): void {
    const { width: w, height: h } = canvas;
    const ctx = canvas.getContext('2d');
    const n = this.#columns;
    let glow = this.#glow.get(canvas);
    if (!glow) {
      // Sweeps start from the left whenever this scanner first shows.
      glow = { levels: new Float32Array(n), lastT: t, startT: t };
      this.#glow.set(canvas, glow);
    }
    const dt = Math.max(0, t - glow.lastT);
    glow.lastT = t;
    const levels = glow.levels;

    // Head position bounces 0 → n-1 → 0 (a triangle wave).
    const phase = fract((t - glow.startT) / this.#period) * 2;
    const head = (phase < 1 ? phase : 2 - phase) * (n - 1);
    const fade = Math.exp(-dt / this.#decay);
    for (let c = 0; c < n; c++) {
      const lit = Math.max(0, 1 - Math.abs(head - c));
      levels[c] = Math.max(levels[c] * fade, lit);
    }

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const [r, g, b] = this.#rgb;
    for (const key of keys) {
      if (key.row !== this.#row || key.column >= n) continue;
      // A few levels only, so a key that's fully faded stays identical.
      const k = Math.round(levels[key.column] * 20) / 20;
      if (!k) continue;
      ctx.fillStyle = `rgb(${r * k}, ${g * k}, ${b * k})`;
      fillKey(ctx, key);
    }
  }
}

function parseHex(color: string): [number, number, number] {
  const hex = /^#?([0-9a-f]{6})$/i.exec(color)?.[1];
  if (!hex) throw new Error(`expected a #rrggbb colour, got "${color}"`);
  const n = parseInt(hex, 16);
  return [n >> 16, (n >> 8) & 0xff, n & 0xff];
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
