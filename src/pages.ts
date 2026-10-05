import type { Engine } from './engine.ts';
import type { Widget } from './widget.ts';

interface Page {
  name: string;
  widgets: Map<number, Widget>;
}

/**
 * Pages of keys on one engine. Fixed keys (like page navigation) stay put on
 * every page; everything else swaps when the page changes. Widgets on hidden
 * pages are detached, so their timers and subscriptions stop until shown again.
 */
export class Pager {
  #engine: Engine;
  #pages: Page[] = [];
  #fixed = new Set<number>();
  #current = 0;
  #listeners = new Set<() => void>();

  constructor(engine: Engine) {
    this.#engine = engine;
  }

  /** A key that shows the same widget on every page. */
  fixed(key: number, widget: Widget): void {
    this.#fixed.add(key);
    this.#engine.mount(key, widget);
  }

  isFixed(key: number): boolean {
    return this.#fixed.has(key);
  }

  /** Add a page. `put` places a widget on one of its keys. */
  page(name: string, build: (put: (key: number, widget: Widget) => void) => void): void {
    const page: Page = { name, widgets: new Map() };
    build((key, widget) => {
      if (this.#fixed.has(key)) throw new Error(`page "${name}": key ${key} is reserved for a fixed key`);
      page.widgets.set(key, widget);
    });
    this.#pages.push(page);
    if (this.#pages.length === 1) this.#show(0);
  }

  get name(): string {
    return this.#pages[this.#current]?.name ?? '';
  }

  get names(): string[] {
    return this.#pages.map((p) => p.name);
  }

  get index(): number {
    return this.#current;
  }

  get count(): number {
    return this.#pages.length;
  }

  next(): void {
    this.#show((this.#current + 1) % this.count);
  }

  prev(): void {
    this.#show((this.#current - 1 + this.count) % this.count);
  }

  go(index: number): void {
    this.#show(index);
  }

  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #show(index: number): void {
    const from = this.#pages[this.#current];
    const to = this.#pages[index];
    if (!to) return;
    if (from && from !== to) {
      for (const key of from.widgets.keys()) if (!to.widgets.has(key)) this.#engine.unmount(key);
    }
    for (const [key, widget] of to.widgets) this.#engine.mount(key, widget);
    this.#current = index;
    for (const fn of this.#listeners) fn();
  }
}
