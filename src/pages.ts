import type { Engine } from './engine.ts';
import type { Positions } from './positions.ts';
import type { Widget } from './widget.ts';

interface Entry {
  /** Stable name for the button, used to remember where it was moved. */
  id: string;
  defaultKey: number;
  widget: Widget;
}

interface Page {
  name: string;
  entries: Entry[];
}

/**
 * Pages of keys on one engine. Fixed keys (like page navigation) stay put on
 * every page; everything else swaps when the page changes. Widgets on hidden
 * pages are detached, so their timers and subscriptions stop until shown again.
 *
 * Buttons can be moved (see move()); with a Positions store the new places
 * are saved and every surface sharing it rearranges together.
 */
export class Pager {
  #engine: Engine;
  #positions: Positions | undefined;
  #pages: Page[] = [];
  #fixed = new Set<number>();
  #current = 0;
  /** Page widgets currently on the deck, by key. */
  #mounted = new Map<number, Widget>();
  #listeners = new Set<() => void>();

  constructor(engine: Engine, positions?: Positions) {
    this.#engine = engine;
    this.#positions = positions;
    if (positions) engine.onStop(positions.subscribe(() => this.#show(this.#current)));
  }

  /** A key that shows the same widget on every page. */
  fixed(key: number, widget: Widget): void {
    this.#fixed.add(key);
    this.#engine.mount(key, widget);
  }

  isFixed(key: number): boolean {
    return this.#fixed.has(key);
  }

  get fixedKeys(): number[] {
    return [...this.#fixed];
  }

  /** Add a page. `put` places a widget on one of its keys (its default place). */
  page(name: string, build: (put: (key: number, widget: Widget) => void) => void): void {
    const page: Page = { name, entries: [] };
    build((key, widget) => {
      if (this.#fixed.has(key)) throw new Error(`page "${name}": key ${key} is reserved for a fixed key`);
      page.entries.push({ id: `key${key}`, defaultKey: key, widget });
    });
    this.#pages.push(page);
    if (this.#pages.length === 1) this.#show(0);
  }

  /**
   * Move the button on `from` to `to` on the current page, swapping with
   * whatever is there. Fixed keys can't be moved or moved onto.
   */
  move(from: number, to: number): boolean {
    const page = this.#pages[this.#current];
    if (!page || from === to || this.#fixed.has(from) || this.#fixed.has(to)) return false;
    const placement = this.#placement(page);
    const moving = placement.get(from);
    if (!moving) return false;
    const displaced = placement.get(to);
    const moves = [{ id: moving.id, key: to }];
    if (displaced) moves.push({ id: displaced.id, key: from });
    if (this.#positions) {
      this.#positions.set(page.name, moves);
    } else {
      // No store: rearrange this surface only, until restart.
      moving.defaultKey = to;
      if (displaced) displaced.defaultKey = from;
      this.#show(this.#current);
    }
    return true;
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

  /** Go to a page by name (no-op if there isn't one). */
  goTo(name: string): void {
    const index = this.#pages.findIndex((p) => p.name === name);
    if (index >= 0) this.#show(index);
  }

  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  /** Which button is on which key for a page, after any moves. */
  #placement(page: Page): Map<number, Entry> {
    const placement = new Map<number, Entry>();
    for (const entry of page.entries) {
      let key = this.#positions?.keyFor(page.name, entry.id, entry.defaultKey) ?? entry.defaultKey;
      // A saved place that's no longer usable (taken, or now a fixed key)
      // falls back to the default.
      if (this.#fixed.has(key) || placement.has(key)) key = entry.defaultKey;
      if (this.#fixed.has(key) || placement.has(key)) continue;
      placement.set(key, entry);
    }
    return placement;
  }

  #show(index: number): void {
    const page = this.#pages[index];
    if (!page) return;
    const next = new Map([...this.#placement(page)].map(([key, e]) => [key, e.widget]));
    // Take widgets off keys they're leaving before putting them on new ones:
    // a moved widget is detached from its old key, then attached to its new one.
    for (const [key, widget] of this.#mounted) if (next.get(key) !== widget) this.#engine.unmount(key);
    for (const [key, widget] of next) if (this.#mounted.get(key) !== widget) this.#engine.mount(key, widget);
    this.#mounted = next;
    this.#current = index;
    for (const fn of this.#listeners) fn();
  }
}
