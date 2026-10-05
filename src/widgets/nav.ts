import type { SKRSContext2D } from '@napi-rs/canvas';
import { Widget } from '../widget.ts';
import { colors, keyFace, text } from '../draw.ts';
import type { Pager } from '../pages.ts';

abstract class PagerWidget extends Widget {
  protected pager: Pager;
  #unsubscribe: (() => void) | undefined;

  constructor(pager: Pager) {
    super();
    this.pager = pager;
  }

  mount(): void {
    this.#unsubscribe = this.pager.subscribe(() => this.invalidate());
  }

  unmount(): void {
    this.#unsubscribe?.();
  }
}

/** ▲ next page or ▼ previous page (both wrap around). */
export class PageArrow extends PagerWidget {
  #direction: 'up' | 'down';

  constructor(pager: Pager, direction: 'up' | 'down') {
    super(pager);
    this.#direction = direction;
  }

  onDown(): void {
    if (this.#direction === 'up') this.pager.next();
    else this.pager.prev();
  }

  render(ctx: SKRSContext2D, s: number): void {
    keyFace(ctx, s, 'nav');
    const up = this.#direction === 'up';
    const h = s * 0.16;
    ctx.strokeStyle = this.pager.count > 1 ? colors.text : colors.dim;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(s * 0.3, s / 2 + (up ? h / 2 : -h / 2));
    ctx.lineTo(s / 2, s / 2 + (up ? -h / 2 : h / 2));
    ctx.lineTo(s * 0.7, s / 2 + (up ? h / 2 : -h / 2));
    ctx.stroke();
  }
}

/** Current page's name and position. Press to jump back to the first page. */
export class PageTitle extends PagerWidget {
  onDown(): void {
    this.pager.go(0);
  }

  render(ctx: SKRSContext2D, s: number): void {
    keyFace(ctx, s, 'nav');
    text(ctx, this.pager.name.toUpperCase(), s / 2, s * 0.42, { size: 20, maxWidth: s - 14 });

    // One dot per page, the current one lit.
    const n = this.pager.count;
    const gap = Math.min(12, (s - 24) / Math.max(1, n - 1));
    const x0 = s / 2 - (gap * (n - 1)) / 2;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i === this.pager.index ? colors.text : colors.dim;
      ctx.beginPath();
      ctx.arc(x0 + i * gap, s * 0.72, i === this.pager.index ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Jumps to a named page. Navigation, so it uses the black nav face. */
export class PageLink extends PagerWidget {
  #page: string;
  #label: string;

  constructor(pager: Pager, page: string, label = page.toUpperCase()) {
    super(pager);
    this.#page = page;
    this.#label = label;
  }

  onDown(): void {
    this.pager.goTo(this.#page);
  }

  render(ctx: SKRSContext2D, s: number): void {
    keyFace(ctx, s, 'nav');
    text(ctx, this.#label, s / 2, s * 0.44, { size: 20, maxWidth: s - 14 });
    // A small chevron to say "opens a page".
    ctx.strokeStyle = colors.dim;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(s / 2 - 5, s * 0.66);
    ctx.lineTo(s / 2 + 1, s * 0.72);
    ctx.lineTo(s / 2 - 5, s * 0.78);
    ctx.stroke();
  }
}
