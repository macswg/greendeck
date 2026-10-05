import type { SKRSContext2D } from '@napi-rs/canvas';

/**
 * Press-and-hold for keys whose action shouldn't fire on a stray tap (stop
 * recording, sleep). Call start() on key down and release() on key up; the
 * action runs once the key has been held for `ms`. Letting go early cancels
 * and briefly sets `hinting`, so the key can show a "HOLD" reminder.
 */
export class Hold {
  #ms: number;
  #onComplete: () => void;
  #redraw: () => void;
  #startedAt = 0;
  #timer: NodeJS.Timeout | undefined;
  #ticker: NodeJS.Timeout | undefined;
  #hintUntil = 0;

  constructor(ms: number, onComplete: () => void, redraw: () => void) {
    this.#ms = ms;
    this.#onComplete = onComplete;
    this.#redraw = redraw;
  }

  /** 0–1 while the key is held, otherwise undefined. */
  get progress(): number | undefined {
    return this.#startedAt ? Math.min(1, (performance.now() - this.#startedAt) / this.#ms) : undefined;
  }

  get hinting(): boolean {
    return !this.#startedAt && performance.now() < this.#hintUntil;
  }

  start(): void {
    this.cancel();
    this.#startedAt = performance.now();
    this.#ticker = setInterval(this.#redraw, 33);
    this.#timer = setTimeout(() => {
      this.cancel();
      this.#onComplete();
    }, this.#ms);
    this.#redraw();
  }

  release(): void {
    if (!this.#startedAt) return;
    this.cancel();
    this.#hintUntil = performance.now() + 1200;
    setTimeout(this.#redraw, 1250);
    this.#redraw();
  }

  cancel(): void {
    clearTimeout(this.#timer);
    clearInterval(this.#ticker);
    this.#startedAt = 0;
  }
}

/** The fill bar along the bottom of a key while it's being held. */
export function drawHoldBar(ctx: SKRSContext2D, s: number, progress: number, color = '#fff'): void {
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = color;
  ctx.fillRect(12, s - 16, s - 24, 5);
  ctx.globalAlpha = 1;
  ctx.fillRect(12, s - 16, (s - 24) * progress, 5);
}
