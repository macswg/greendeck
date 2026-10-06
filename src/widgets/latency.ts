import type { SKRSContext2D } from '@napi-rs/canvas';
import { Widget } from '../widget.ts';
import { colors, keyFace, text } from '../draw.ts';

const KEEP = 10;

/**
 * Press it and it times how long the deck took to answer: from greendeck
 * hearing the press to the lit key image being handed to the deck (drawn,
 * encoded and written over USB). Doesn't include the deck's own button scan
 * or screen refresh, a few ms more that only a camera can see.
 */
export class LatencyTester extends Widget {
  #pressedAt: number | undefined;
  #lit = false;
  #results: number[] = [];

  onDown(): void {
    this.#pressedAt = performance.now();
    this.#lit = true;
    this.invalidate();
  }

  onSent(): void {
    if (this.#pressedAt === undefined) return;
    this.#results.push(performance.now() - this.#pressedAt);
    if (this.#results.length > KEEP) this.#results.shift();
    this.#pressedAt = undefined;
  }

  onUp(): void {
    this.#lit = false;
    this.invalidate();
  }

  render(ctx: SKRSContext2D, s: number): void {
    if (this.#lit) {
      // Bright and plain, so the change is unmistakable on the deck.
      keyFace(ctx, s, 'action', true);
      text(ctx, 'HIT', s / 2, s / 2, { size: 22, maxWidth: s - 10, weight: 'bold', color: '#000' });
      return;
    }
    keyFace(ctx, s, 'default');
    text(ctx, 'LATENCY', s / 2, s * 0.13, { size: 11, maxWidth: s - 8, color: colors.dim });
    const last = this.#results.at(-1);
    if (last === undefined) {
      text(ctx, 'TAP', s / 2, s * 0.48, { size: 22, maxWidth: s - 10, color: colors.text });
      return;
    }
    text(ctx, `${last.toFixed(1)}`, s / 2, s * 0.44, { size: 26, maxWidth: s - 10, color: colors.text });
    text(ctx, 'ms', s / 2, s * 0.64, { size: 12, maxWidth: s - 10, color: colors.dim });
    const avg = this.#results.reduce((a, b) => a + b, 0) / this.#results.length;
    text(ctx, `avg ${avg.toFixed(1)} (${this.#results.length})`, s / 2, s * 0.84, { size: 11, maxWidth: s - 10, color: colors.accent });
  }
}
