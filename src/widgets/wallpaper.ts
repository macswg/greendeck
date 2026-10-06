import type { SKRSContext2D } from '@napi-rs/canvas';
import { Widget } from '../widget.ts';
import { colors, keyFace, text } from '../draw.ts';
import type { Wallpaper, WallpaperChoice } from '../wallpaper.ts';

/** Picks a wallpaper; pressing the one that's showing turns it off. */
export class WallpaperButton extends Widget {
  #wallpaper: Wallpaper;
  #choice: WallpaperChoice;
  #unsubscribe?: () => void;

  constructor(wallpaper: Wallpaper, choice: WallpaperChoice) {
    super();
    this.#wallpaper = wallpaper;
    this.#choice = choice;
  }

  mount(): void {
    this.#unsubscribe = this.#wallpaper.subscribe(() => this.invalidate());
  }

  unmount(): void {
    this.#unsubscribe?.();
  }

  onDown(): void {
    void this.#wallpaper.toggle(this.#choice.id);
  }

  render(ctx: SKRSContext2D, s: number): void {
    const on = this.#wallpaper.current === this.#choice.id;
    keyFace(ctx, s, 'default');
    const { swatch, label } = this.#choice;
    // A swatch disc: filled when showing, a ring when not.
    ctx.beginPath();
    ctx.arc(s / 2, s * 0.4, 12, 0, Math.PI * 2);
    if (on) {
      ctx.fillStyle = swatch;
      ctx.fill();
    } else {
      ctx.strokeStyle = swatch;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    text(ctx, label, s / 2, s * 0.74, {
      size: 13,
      maxWidth: s - 14,
      weight: on ? 'bold' : 'normal',
      color: on ? colors.text : colors.dim,
    });
  }
}
