import type { SKRSContext2D } from '@napi-rs/canvas';
import { Widget } from '../widget.ts';
import { colors, keyFace, text } from '../draw.ts';
import type { Engine } from '../engine.ts';
import { drawHoldBar, Hold } from '../hold.ts';

/** Puts the deck into standby after a 1 s hold, so a stray tap can't. */
export class SleepButton extends Widget {
  #hold: Hold;

  constructor(engine: Engine) {
    super();
    this.#hold = new Hold(1000, () => engine.setStandby(true), () => this.invalidate());
  }

  onDown(): void {
    this.#hold.start();
  }

  onUp(): void {
    this.#hold.release();
  }

  unmount(): void {
    this.#hold.cancel();
  }

  render(ctx: SKRSContext2D, s: number): void {
    keyFace(ctx, s, 'nav');
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
    const progress = this.#hold.progress;
    const hint = this.#hold.hinting;
    text(ctx, hint ? 'HOLD' : 'SLEEP', s / 2, s * 0.7, {
      size: 13,
      maxWidth: s - 14,
      weight: hint ? 'bold' : 'normal',
      color: hint ? colors.text : colors.dim,
    });
    if (progress !== undefined) drawHoldBar(ctx, s, progress, colors.dim);
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
    keyFace(ctx, s, 'nav');
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
