import type { SKRSContext2D } from '@napi-rs/canvas';

/**
 * One key's worth of UI. Widgets hold their own state, call invalidate() when
 * it changes, and the engine redraws them on its next frame. Data can arrive
 * as fast as it likes: invalidations coalesce, so only the latest state is drawn.
 */
export abstract class Widget {
  #invalidate: () => void = () => {};

  attach(invalidate: () => void): void {
    this.#invalidate = invalidate;
    this.mount?.();
  }

  detach(): void {
    this.#invalidate = () => {};
    this.unmount?.();
  }

  protected invalidate(): void {
    this.#invalidate();
  }

  abstract render(ctx: SKRSContext2D, size: number): void;

  mount?(): void;
  unmount?(): void;
  onDown?(): void;
  onUp?(): void;
}
