import type { SKRSContext2D } from '@napi-rs/canvas';
import { Widget } from '../widget.ts';
import { colors, keyFace, roundedFill, text } from '../draw.ts';
import { MicLevel } from '../mic.ts';

/** The meter spans this many dB, up to 0 dBFS. */
const RANGE_DB = 48;

/** dB to 0–1 along the whole meter. */
const position = (db: number) => Math.min(1, Math.max(0, (db + RANGE_DB) / RANGE_DB));

/** Green, then amber near the top, then red at the end, like a mixing desk. */
function zoneColor(at: number): string {
  if (at > 1 - 6 / RANGE_DB) return colors.error;
  if (at > 1 - 15 / RANGE_DB) return colors.pending;
  return colors.active;
}

/**
 * One key's worth of a mic level meter that runs across a row of keys: key
 * `index` of `count` shows its slice of the bar. A key only redraws when its
 * slice changes, so quiet keys stay quiet while the loud end flickers.
 */
export class MicMeterSegment extends Widget {
  #mic: MicLevel;
  #index: number;
  #count: number;
  #unsubscribe?: () => void;
  /** What was last drawn, in key pixels (fill width, peak marker x). */
  #drawn = { fill: -1, peak: -1 };
  #size = 96;

  constructor(mic: MicLevel, index: number, count: number) {
    super();
    this.#mic = mic;
    this.#index = index;
    this.#count = count;
  }

  mount(): void {
    this.#unsubscribe = this.#mic.subscribe(() => {
      const { fill, peak } = this.#slice(this.#size);
      if (fill !== this.#drawn.fill || peak !== this.#drawn.peak) this.invalidate();
    });
  }

  unmount(): void {
    this.#unsubscribe?.();
  }

  /** This key's share of the bar and peak marker, in whole pixels (-1 = not on this key). */
  #slice(s: number): { fill: number; peak: number } {
    const local = (at: number) => at * this.#count - this.#index;
    const fill = Math.round(Math.min(1, Math.max(0, local(position(this.#mic.db)))) * s);
    const p = local(position(this.#mic.peakDb));
    const peak = this.#mic.peakDb > -RANGE_DB && p > 0 && p <= 1 ? Math.round(p * s) : -1;
    return { fill, peak };
  }

  render(ctx: SKRSContext2D, s: number): void {
    this.#size = s;
    const { fill, peak } = this.#slice(s);
    this.#drawn = { fill, peak };
    roundedFill(ctx, s, colors.bg, 0, 0);

    // The lit part, coloured by where each pixel sits on the whole meter.
    const bar = { y: s * 0.2, h: s * 0.6 };
    for (let x = 0; x < fill; x += 4) {
      const at = (this.#index + x / s) / this.#count;
      ctx.fillStyle = zoneColor(at);
      ctx.fillRect(x, bar.y, 3, bar.h);
    }
    if (peak >= 0) {
      ctx.fillStyle = zoneColor((this.#index + peak / s) / this.#count);
      ctx.fillRect(Math.max(0, peak - 2), bar.y - 6, 3, bar.h + 12);
    }
    // dB marks along the bottom edge, so it reads as a scale.
    const lo = -RANGE_DB + (RANGE_DB * this.#index) / this.#count;
    text(ctx, `${Math.round(lo)}`, 12, s * 0.92, { size: 9, maxWidth: 22, color: colors.dim });
  }
}

/** The meter's label key: the current level in dB. */
export class MicReadout extends Widget {
  #mic: MicLevel;
  #unsubscribe?: () => void;
  #shown = '';

  constructor(mic: MicLevel) {
    super();
    this.#mic = mic;
  }

  #unsubscribeGain?: () => void;

  mount(): void {
    this.#unsubscribe = this.#mic.subscribe(() => {
      if (this.#label() !== this.#shown) this.invalidate();
    });
    this.#unsubscribeGain = this.#mic.subscribeGain(() => this.invalidate());
  }

  unmount(): void {
    this.#unsubscribe?.();
    this.#unsubscribeGain?.();
  }

  #label(): string {
    if (this.#mic.problem) return this.#mic.problem;
    return this.#mic.db > -RANGE_DB ? `${Math.round(this.#mic.db)}` : '—';
  }

  render(ctx: SKRSContext2D, s: number): void {
    this.#shown = this.#label();
    roundedFill(ctx, s, colors.bg);
    text(ctx, 'MIC', s / 2, s * 0.13, { size: 11, maxWidth: s - 8, color: colors.dim });
    text(ctx, this.#shown, s / 2, s * 0.48, { size: 26, maxWidth: s - 10, color: colors.text });
    text(ctx, 'dB', s / 2, s * 0.7, { size: 12, maxWidth: s - 10, color: colors.dim });
    const gain = this.#mic.gainDb;
    if (gain) text(ctx, `gain ${formatGain(gain)}`, s / 2, s * 0.87, { size: 11, maxWidth: s - 10, color: colors.accent });
  }
}

const formatGain = (db: number) => `${db > 0 ? '+' : ''}${db}`;

/** Turns the meter's sensitivity up or down a step. */
export class MicGainButton extends Widget {
  #mic: MicLevel;
  #dir: 1 | -1;
  #unsubscribe?: () => void;

  constructor(mic: MicLevel, dir: 1 | -1) {
    super();
    this.#mic = mic;
    this.#dir = dir;
  }

  mount(): void {
    this.#unsubscribe = this.#mic.subscribeGain(() => this.invalidate());
  }

  unmount(): void {
    this.#unsubscribe?.();
  }

  onDown(): void {
    this.#mic.adjustGain(this.#dir);
  }

  render(ctx: SKRSContext2D, s: number): void {
    const gain = this.#mic.gainDb;
    const atLimit = this.#dir > 0 ? gain >= MicLevel.GAIN_MAX : gain <= MicLevel.GAIN_MIN;
    keyFace(ctx, s, 'default');
    text(ctx, 'GAIN', s / 2, s * 0.18, { size: 11, maxWidth: s - 8, color: colors.dim });
    text(ctx, this.#dir > 0 ? '+' : '−', s / 2, s * 0.46, { size: 34, maxWidth: s - 10, color: atLimit ? colors.dim : colors.text });
    text(ctx, `${formatGain(gain)} dB`, s / 2, s * 0.78, { size: 12, maxWidth: s - 10, color: gain ? colors.accent : colors.dim });
  }
}
