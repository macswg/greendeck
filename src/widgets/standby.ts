import type { SKRSContext2D } from '@napi-rs/canvas';
import { Widget } from '../widget.ts';
import { colors, roundedFill, text } from '../draw.ts';
import type { Engine } from '../engine.ts';

/** Puts the deck into standby. */
export class SleepButton extends Widget {
  #engine: Engine;

  constructor(engine: Engine) {
    super();
    this.#engine = engine;
  }

  onDown(): void {
    this.#engine.setStandby(true);
  }

  render(ctx: SKRSContext2D, s: number): void {
    roundedFill(ctx, s, colors.bg);
    // Crescent moon: a disc clipped to everything outside an offset disc.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, s, s);
    ctx.arc(s / 2 + 5, s * 0.4 - 3.5, 8, 0, Math.PI * 2);
    ctx.clip('evenodd');
    // Same grey as the label, so the key reads as a quiet utility.
    ctx.fillStyle = colors.dim;
    ctx.beginPath();
    ctx.arc(s / 2, s * 0.4, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    text(ctx, 'SLEEP', s / 2, s * 0.72, { size: 13, maxWidth: s - 14, weight: 'normal', color: colors.dim });
  }
}

/** Shown in standby, and the only key that responds there: wakes the deck. */
export class WakeButton extends Widget {
  #engine: Engine;

  constructor(engine: Engine) {
    super();
    this.#engine = engine;
  }

  onDown(): void {
    this.#engine.setStandby(false);
  }

  render(ctx: SKRSContext2D, s: number): void {
    const warm = '#e8901c';
    roundedFill(ctx, s, '#1a0e02');
    // Power symbol: an open ring with a bar through the gap.
    ctx.strokeStyle = warm;
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(s / 2, s * 0.42, 11, -Math.PI / 2 + 0.7, -Math.PI / 2 - 0.7 + Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s / 2, s * 0.42 - 15);
    ctx.lineTo(s / 2, s * 0.42 - 3);
    ctx.stroke();
    text(ctx, 'WAKE', s / 2, s * 0.74, { size: 13, maxWidth: s - 14, weight: 'normal', color: warm });
  }
}
