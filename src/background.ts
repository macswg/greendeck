import { createCanvas, loadImage, type Canvas, type Image, type SKRSContext2D } from '@napi-rs/canvas';

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
  /**
   * `keys` gives each key's rect on the canvas, for lighting whole keys.
   * Returning false says this frame looks the same as the last one drawn on
   * this canvas, so the engine needn't re-send the deck.
   */
  render(canvas: Canvas, timeSec: number, keys: readonly KeyRect[]): boolean | void;
  /**
   * Draw one key's slice at full resolution instead of the engine scaling up
   * the small canvas, for detail that scaling would blur (a picture). `key` is
   * in panel pixels; `panel` is the whole panel's size.
   */
  drawKey?(ctx: SKRSContext2D, key: KeyRect, size: number, panel: { w: number; h: number }): void;
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
 * A still picture across the whole deck, cropped to fill the panel. Each key
 * is cut from a full-resolution copy, so it stays sharp.
 */
export class ImageBackground implements Background {
  readonly animated = false;
  #image: Image;
  /** The picture fitted to the panel, made on first use (and per panel size). */
  #fitted: { w: number; h: number; canvas: Canvas } | undefined;

  #dim: number;

  /** Use load(): an image's pixels decode asynchronously, and draw blank until then. */
  private constructor(image: Image, dim: number) {
    this.#image = image;
    this.#dim = dim;
  }

  /** `dim` (0–1) darkens a bright photo so key labels stay readable on it. */
  static async load(path: string, opts: { dim?: number } = {}): Promise<ImageBackground> {
    return new ImageBackground(await loadImage(path), opts.dim ?? 0);
  }

  render(canvas: Canvas): void {
    this.#cover(canvas.getContext('2d'), canvas.width, canvas.height);
  }

  drawKey(ctx: SKRSContext2D, key: KeyRect, size: number, panel: { w: number; h: number }): void {
    if (this.#fitted?.w !== panel.w || this.#fitted.h !== panel.h) {
      const canvas = createCanvas(Math.ceil(panel.w), Math.ceil(panel.h));
      this.#cover(canvas.getContext('2d'), panel.w, panel.h);
      this.#fitted = { ...panel, canvas };
    }
    ctx.drawImage(this.#fitted.canvas, key.x, key.y, key.w, key.h, 0, 0, size, size);
  }

  /** Scale the picture to cover w x h, centred, cropping whatever overhangs. */
  #cover(ctx: SKRSContext2D, w: number, h: number): void {
    const img = this.#image;
    const scale = Math.max(w / img.width, h / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    if (this.#dim) {
      ctx.fillStyle = `rgba(0, 0, 0, ${this.#dim})`;
      ctx.fillRect(0, 0, w, h);
    }
  }
}

/**
 * A dark hexagon mesh whose cells light up blue now and then and gently fade
 * back out, each on its own random schedule. Cells fade through a few
 * brightness steps, so most frames change nothing, and only the keys under a
 * fading cell are re-sent. Drawn per key at full resolution, so the fine
 * mesh stays sharp.
 */
export class HexField implements Background {
  readonly animated = true;
  readonly fps = 10;
  /** Cell radius in panel pixels. */
  #r: number;
  /** Seconds to fade in and to fade out. */
  #fadeIn: number;
  #fadeOut: number;
  /** Rough share of cells lit at any moment. */
  #density: number;
  #steps: number;
  #cells: { x: number; y: number; band: number; slot: number; offset: number; seed: number }[] = [];
  #levels = new Uint8Array(0);
  /** Panel-size canvases: the bare mesh, and the mesh with lit cells for the current levels. */
  #base: Canvas | undefined;
  #frame: Canvas | undefined;
  #frameKey = '';
  #lastKey = new WeakMap<Canvas, string>();

  constructor(opts: { radius?: number; fadeIn?: number; fadeOut?: number; density?: number; steps?: number } = {}) {
    this.#r = opts.radius ?? 23;
    this.#fadeIn = opts.fadeIn ?? 1.5;
    this.#fadeOut = opts.fadeOut ?? 2;
    this.#density = opts.density ?? 0.07;
    this.#steps = opts.steps ?? 8;
  }

  render(canvas: Canvas, t: number): boolean {
    if (!this.#cells.length) return true;
    // Each cell's time is cut into slots of its own length; in a slot it's
    // either dark or lights up once (fade in, hold, fade out).
    for (let i = 0; i < this.#cells.length; i++) {
      const c = this.#cells[i];
      const local = t + c.offset;
      const slot = Math.floor(local / c.slot);
      const into = local - slot * c.slot;
      let level = 0;
      if (hash(c.seed + slot * 7919) < this.#density * (c.slot / (this.#fadeIn + this.#fadeOut + 1.5))) {
        const hold = 1.5;
        if (into < this.#fadeIn) level = ease(into / this.#fadeIn);
        else if (into < this.#fadeIn + hold) level = 1;
        else if (into < this.#fadeIn + hold + this.#fadeOut) level = 1 - ease((into - this.#fadeIn - hold) / this.#fadeOut);
      }
      this.#levels[i] = Math.round(level * this.#steps);
    }
    const key = this.#levels.join();
    const changed = this.#lastKey.get(canvas) !== key;
    this.#lastKey.set(canvas, key);
    return changed;
  }

  drawKey(ctx: SKRSContext2D, key: KeyRect, size: number, panel: { w: number; h: number }): void {
    if (this.#base?.width !== Math.ceil(panel.w) || this.#base.height !== Math.ceil(panel.h)) this.#build(panel);
    const levels = this.#levels.join();
    if (levels !== this.#frameKey) this.#paint(levels);
    ctx.drawImage(this.#frame!, key.x, key.y, key.w, key.h, 0, 0, size, size);
  }

  /** Lay out the cells and draw the bare mesh for this panel size. */
  #build(panel: { w: number; h: number }): void {
    const W = Math.ceil(panel.w);
    const H = Math.ceil(panel.h);
    const R = this.#r;
    const dx = R * Math.sqrt(3);
    const dy = R * 1.5;
    this.#cells = [];
    for (let row = -1; row * dy < H + R; row++) {
      for (let col = -1; col * dx < W + R; col++) {
        const x = col * dx + (row % 2 ? dx / 2 : 0);
        const y = row * dy;
        // A soft band of light running across the panel.
        const band = Math.exp(-(((y - H * 0.55 - (x - W / 2) * 0.25) / (H * 0.25)) ** 2));
        const seed = (row + 7) * 1000 + col + 7;
        this.#cells.push({ x, y, band, seed, slot: 5 + hash(seed) * 9, offset: hash(seed + 0.5) * 100 });
      }
    }
    this.#levels = new Uint8Array(this.#cells.length);
    this.#frameKey = '';

    this.#base = createCanvas(W, H);
    this.#frame = createCanvas(W, H);
    const ctx = this.#base.getContext('2d');
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#02050c');
    bg.addColorStop(1, '#071228');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = 1.25;
    for (const c of this.#cells) {
      this.#hexPath(ctx, c.x, c.y);
      ctx.strokeStyle = `rgba(80, 160, 255, ${0.12 + c.band * 0.35})`;
      ctx.stroke();
    }
  }

  /** The mesh plus every lit cell at its level. */
  #paint(levels: string): void {
    const ctx = this.#frame!.getContext('2d');
    ctx.drawImage(this.#base!, 0, 0);
    ctx.lineWidth = 1.25;
    for (let i = 0; i < this.#cells.length; i++) {
      const lit = this.#levels[i] / this.#steps;
      if (!lit) continue;
      const c = this.#cells[i];
      this.#hexPath(ctx, c.x, c.y);
      ctx.fillStyle = `rgba(40, 140, 255, ${lit * 0.45})`;
      ctx.shadowColor = `rgba(60, 160, 255, ${lit * 0.9})`;
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = `rgba(80, 160, 255, ${0.12 + c.band * 0.35 + lit * 0.4})`;
      ctx.stroke();
    }
    this.#frameKey = levels;
  }

  #hexPath(ctx: SKRSContext2D, x: number, y: number): void {
    const r = this.#r - 2;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 3) * k + Math.PI / 6;
      ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
    }
    ctx.closePath();
  }
}

/**
 * An effect drawn over another background, key by key at full resolution.
 * Subclasses say what this frame looks like (a short string; same string,
 * same picture) and draw it over a key; the layer works out whether anything
 * changed, so frames where neither the effect nor what's under it moved
 * aren't re-sent. Layers stack: a layer can go over another layer.
 */
export abstract class Layer implements Background {
  readonly animated = true;
  readonly fps: number;
  protected readonly under: Background;
  #lastKey = new WeakMap<Canvas, string>();
  #underDrawn = new WeakSet<Canvas>();

  constructor(under: Background, fps: number) {
    this.under = under;
    // Never slower than what's underneath.
    this.fps = Math.max(fps, under.fps ?? 0);
  }

  /** Work out this frame of the effect; return a string that changes when its look does. */
  protected abstract update(t: number): string;
  /** Draw the effect over a key that already has what's underneath on it. */
  protected abstract paint(ctx: SKRSContext2D, key: KeyRect, size: number, panel: { w: number; h: number }): void;

  render(canvas: Canvas, t: number, keys: readonly KeyRect[]): boolean {
    // A still picture underneath only needs drawing once per canvas.
    let underChanged = false;
    if (this.under.animated || !this.#underDrawn.has(canvas)) {
      underChanged = this.under.render(canvas, t, keys) !== false;
      this.#underDrawn.add(canvas);
    }
    const key = this.update(t);
    const changed = this.#lastKey.get(canvas) !== key;
    this.#lastKey.set(canvas, key);
    return changed || underChanged;
  }

  drawKey(ctx: SKRSContext2D, key: KeyRect, size: number, panel: { w: number; h: number }): void {
    this.under.drawKey?.(ctx, key, size, panel);
    ctx.save();
    this.paint(ctx, key, size, panel);
    ctx.restore();
  }
}

/**
 * An 80s laser scan: a bright magenta line with a glow and a fading trail
 * sweeps from a start line down to the bottom of the panel, then rests
 * before the next pass. Only the row of keys it's crossing changes, and
 * nothing at all while it rests.
 */
export class LaserSweep extends Layer {
  #sweep: number;
  #rest: number;
  /** Where the scan starts, as a 0–1 share of the panel's height. */
  #from: number;
  /** The line's progress 0–1, or undefined while resting. */
  #at: number | undefined;

  constructor(under: Background, opts: { sweep?: number; rest?: number; from?: number } = {}) {
    super(under, 15);
    this.#sweep = opts.sweep ?? 3;
    this.#rest = opts.rest ?? 4;
    this.#from = opts.from ?? 0;
  }

  protected update(t: number): string {
    const into = t % (this.#sweep + this.#rest);
    this.#at = into < this.#sweep ? into / this.#sweep : undefined;
    return this.#at === undefined ? '' : String(Math.round(this.#at * 600));
  }

  protected paint(ctx: SKRSContext2D, key: KeyRect, size: number, panel: { w: number; h: number }): void {
    if (this.#at === undefined) return;
    const TRAIL = 70;
    const GLOW = 10;
    // Run from the start line to just past the bottom, so the trail clears
    // it. Nothing is drawn above the start line, trail included.
    const top = this.#from * panel.h;
    const y = top + this.#at * (panel.h - top + TRAIL + GLOW);
    if (y + GLOW < key.y || y - TRAIL > key.y + key.h || key.y + key.h < top) return;
    const scale = size / key.h;
    const ky = (y - key.y) * scale;
    const clipTop = Math.max(0, (top - key.y) * scale);
    ctx.beginPath();
    ctx.rect(0, clipTop, size, size - clipTop);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    // The trail: a faint wash above the line, fading upward.
    const trail = ctx.createLinearGradient(0, ky - TRAIL * scale, 0, ky);
    trail.addColorStop(0, 'rgba(200, 40, 255, 0)');
    trail.addColorStop(1, 'rgba(200, 40, 255, 0.28)');
    ctx.fillStyle = trail;
    ctx.fillRect(0, ky - TRAIL * scale, size, TRAIL * scale);
    // The glow either side of the line.
    const glow = ctx.createLinearGradient(0, ky - GLOW * scale, 0, ky + GLOW * scale);
    glow.addColorStop(0, 'rgba(255, 60, 220, 0)');
    glow.addColorStop(0.5, 'rgba(255, 60, 220, 0.75)');
    glow.addColorStop(1, 'rgba(255, 60, 220, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, ky - GLOW * scale, size, GLOW * 2 * scale);
    // The hot core.
    ctx.fillStyle = 'rgba(255, 230, 255, 0.95)';
    ctx.fillRect(0, ky - 1, size, 2);
  }
}

interface Trace {
  points: { x: number; y: number }[];
  length: number;
  glow: number;
}

/**
 * A circuit board in the dark, its traces glowing cyan, with small lights
 * slowly travelling along them. Only the keys a light is crossing change, so
 * it's cheap; drawn per key at full resolution so the traces stay crisp.
 * The board is laid out in a 1984 x 960 design space (the XL panel at 2x)
 * and scaled to the panel.
 */
export class CircuitField implements Background {
  readonly animated = true;
  readonly fps = 12;
  static readonly #DW = 1984;
  static readonly #DH = 960;
  #lights: number;
  /** Design pixels per second. */
  #speed: number;
  #traces: Trace[] = [];
  /** Lights' positions this frame (design pixels), each with its trail. */
  #positions: { x: number; y: number }[][] = [];
  #base: Canvas | undefined;
  #frame: Canvas | undefined;
  #frameKey = '';
  #lastKey = new WeakMap<Canvas, string>();

  constructor(opts: { lights?: number; speed?: number } = {}) {
    this.#lights = opts.lights ?? 7;
    this.#speed = opts.speed ?? 110;
    this.#layout();
  }

  render(canvas: Canvas, t: number): boolean {
    this.#positions = [];
    for (let k = 0; k < this.#lights; k++) {
      // Each light runs one trace end to end, rests a moment, then picks
      // another, all from the time alone so every surface agrees.
      const cycle = 9;
      const offset = hash(k + 0.31) * cycle;
      const n = Math.floor((t + offset) / cycle);
      const into = (t + offset) % cycle;
      const trace = this.#pick(k, n);
      const travelled = into * this.#speed;
      if (travelled > trace.length) continue;
      const trail: { x: number; y: number }[] = [];
      for (let j = 0; j < 6; j++) {
        const d = travelled - j * 10;
        if (d >= 0) trail.push(pointAlong(trace.points, d));
      }
      this.#positions.push(trail);
    }
    const key = this.#positions.map((trail) => trail.map((p) => `${Math.round(p.x / 2)},${Math.round(p.y / 2)}`).join(' ')).join('|');
    const changed = this.#lastKey.get(canvas) !== key;
    this.#lastKey.set(canvas, key);
    return changed;
  }

  drawKey(ctx: SKRSContext2D, key: KeyRect, size: number, panel: { w: number; h: number }): void {
    if (this.#base?.width !== Math.ceil(panel.w) || this.#base.height !== Math.ceil(panel.h)) this.#drawBase(panel);
    const frameKey = JSON.stringify(this.#positions);
    if (frameKey !== this.#frameKey) this.#paint(frameKey);
    ctx.drawImage(this.#frame!, key.x, key.y, key.w, key.h, 0, 0, size, size);
  }

  /** Which trace light `k` runs on its `n`th trip: mostly the brighter ones. */
  #pick(k: number, n: number): Trace {
    const bright = this.#traces.filter((tr) => tr.glow > 0.5);
    const pool = hash(k * 31 + n * 7.7) < 0.7 && bright.length ? bright : this.#traces;
    return pool[Math.floor(hash(k * 13 + n * 3.1) * pool.length)];
  }

  /** Route the traces, the same way every time. */
  #layout(): void {
    const W = CircuitField.#DW;
    const H = CircuitField.#DH;
    const rand = seeded(11);
    const STEP = 32;
    for (let i = 0; i < 75; i++) {
      // Glow is decided first, then the route (the order the picture was made in).
      const glow = rand() < 0.12 ? 0.6 + rand() * 0.4 : rand() * 0.12;
      let x = Math.round((rand() * W) / STEP) * STEP;
      let y = Math.round((rand() * H) / STEP) * STEP;
      const horizontal = rand() < 0.6;
      let dx = horizontal ? (rand() < 0.5 ? 1 : -1) : 0;
      let dy = horizontal ? 0 : rand() < 0.5 ? 1 : -1;
      const points = [{ x, y }];
      for (let seg = 0; seg < 3 + rand() * 4; seg++) {
        const len = (2 + Math.floor(rand() * 8)) * STEP;
        x += dx * len;
        y += dy * len;
        points.push({ x, y });
        // Turn 45° one way or the other.
        const diag = rand() < 0.5 ? 1 : -1;
        [dx, dy] = dx !== 0 && dy !== 0 ? (rand() < 0.5 ? [dx, 0] : [0, dy]) : dx !== 0 ? [dx, diag] : [diag, dy];
      }
      let length = 0;
      for (let j = 1; j < points.length; j++) length += Math.hypot(points[j].x - points[j - 1].x, points[j].y - points[j - 1].y);
      this.#traces.push({ points, length, glow });
    }
  }

  /** The board itself, scaled to the panel. */
  #drawBase(panel: { w: number; h: number }): void {
    const W = CircuitField.#DW;
    const H = CircuitField.#DH;
    this.#base = createCanvas(Math.ceil(panel.w), Math.ceil(panel.h));
    this.#frame = createCanvas(Math.ceil(panel.w), Math.ceil(panel.h));
    this.#frameKey = '';
    const ctx = this.#base.getContext('2d');
    ctx.scale(panel.w / W, panel.h / H);
    const bg = ctx.createRadialGradient(W * 0.5, H * 0.5, 0, W * 0.5, H * 0.5, W * 0.7);
    bg.addColorStop(0, '#062126');
    bg.addColorStop(1, '#01080a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    for (const { points, glow } of this.#traces) {
      ctx.beginPath();
      for (const p of points) ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = `rgba(60, 230, 230, ${0.1 + glow * 0.6})`;
      ctx.lineWidth = 3;
      ctx.shadowColor = 'rgba(60, 230, 230, 0.9)';
      ctx.shadowBlur = glow * 9;
      ctx.stroke();
      ctx.shadowBlur = 0;
      // Pads at both ends.
      for (const p of [points[0], points.at(-1)!]) {
        ctx.fillStyle = `rgba(120, 250, 240, ${0.3 + glow * 0.6})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#021013';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // A couple of chips, sitting in the gaps between keys so they show at the edges.
    const PITCH = 256;
    for (const [cx, cy, w, h] of [[PITCH * 2.5 + 48, PITCH * 1.5 + 48, 300, 200], [PITCH * 5.5 + 48, PITCH * 2.5 + 48, 220, 220]]) {
      ctx.fillStyle = '#0b1b1f';
      ctx.strokeStyle = 'rgba(60, 230, 230, 0.5)';
      ctx.lineWidth = 3;
      ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
      ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
      ctx.fillStyle = 'rgba(60, 230, 230, 0.55)';
      for (let i = 0; i < w - 30; i += 24) {
        ctx.fillRect(cx - w / 2 + 20 + i, cy - h / 2 - 14, 10, 14);
        ctx.fillRect(cx - w / 2 + 20 + i, cy + h / 2, 10, 14);
      }
    }
  }

  /** The board plus each light: a bright head and a fading tail. */
  #paint(frameKey: string): void {
    const base = this.#base!;
    const ctx = this.#frame!.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(base, 0, 0);
    ctx.scale(base.width / CircuitField.#DW, base.height / CircuitField.#DH);
    for (const trail of this.#positions) {
      for (let j = trail.length - 1; j >= 0; j--) {
        const { x, y } = trail[j];
        const fade = 1 - j / 6;
        const r = 22 * (0.5 + 0.5 * fade);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(220, 255, 250, ${0.9 * fade})`);
        g.addColorStop(0.25, `rgba(90, 240, 235, ${0.6 * fade})`);
        g.addColorStop(1, 'rgba(60, 230, 230, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
    this.#frameKey = frameKey;
  }
}

/** The point `d` along a polyline (clamped to its end). */
function pointAlong(points: readonly { x: number; y: number }[], d: number): { x: number; y: number } {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (d <= len) return { x: a.x + ((b.x - a.x) * d) / len, y: a.y + ((b.y - a.y) * d) / len };
    d -= len;
  }
  return points.at(-1)!;
}

/** A seeded random number generator, 0–1, the same sequence every time. */
function seeded(seed: number): () => number {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

/** A repeatable 0–1 value for any number. */
function hash(n: number): number {
  return fract(Math.sin(n * 12.9898) * 43758.5453);
}

/** Smooth start and finish, 0–1 to 0–1. */
function ease(x: number): number {
  return x * x * (3 - 2 * x);
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
  #steps: number;
  /** Brightness step last drawn per canvas (the hardware and browser decks each have one). */
  #lastStep = new WeakMap<Canvas, number>();

  constructor(color: string, opts: {
    /** Seconds per pulse; 0 for a steady glow. */
    period?: number;
    /** Brightness (0–1) at the bottom and top of the pulse. */
    min?: number;
    max?: number;
    /**
     * Brightness levels from bottom to top. Each frame re-encodes every key,
     * so the pulse only redraws when it moves to a new level; the cosine
     * lingers at either end, so whole frames go by unchanged there.
     */
    steps?: number;
  } = {}) {
    this.#rgb = parseHex(color);
    this.#period = opts.period ?? 2.5;
    this.#min = opts.min ?? 0.15;
    this.#max = opts.max ?? 0.6;
    this.#steps = opts.steps ?? 12;
    this.animated = this.#period > 0;
  }

  render(canvas: Canvas, t: number): boolean {
    const breath = this.animated ? (1 - Math.cos((t / this.#period) * Math.PI * 2)) / 2 : 1;
    const step = Math.round(breath * this.#steps);
    // Always drawn (it's cheap), in case something else drew on this canvas since.
    const changed = this.#lastStep.get(canvas) !== step;
    this.#lastStep.set(canvas, step);

    const { width: w, height: h } = canvas;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(w, h);
    const px = image.data;
    const level = this.#min + ((this.#max - this.#min) * step) / this.#steps;
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
    return changed;
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
