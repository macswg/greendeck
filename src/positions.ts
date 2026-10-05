import { readFileSync, writeFileSync } from 'node:fs';

type Saved = Record<string, Record<string, number>>;

/**
 * Where you've moved buttons to, per page, saved to a local JSON file so it
 * survives restarts. Buttons are identified by page and their default key in
 * layout.ts; only moved ones are stored. Delete the file to reset the layout.
 */
export class Positions {
  #file: string;
  #saved: Saved = {};
  #listeners = new Set<() => void>();

  constructor(file: string) {
    this.#file = file;
    try {
      this.#saved = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      this.#saved = {};
    }
  }

  /** The key a button is on: where it was moved to, or its default. */
  keyFor(page: string, id: string, defaultKey: number): number {
    return this.#saved[page]?.[id] ?? defaultKey;
  }

  /** Record new keys for some buttons on a page, save, and tell every surface. */
  set(page: string, moves: { id: string; key: number }[]): void {
    const forPage = (this.#saved[page] ??= {});
    for (const { id, key } of moves) forPage[id] = key;
    try {
      writeFileSync(this.#file, JSON.stringify(this.#saved, null, 2) + '\n');
    } catch (err) {
      console.error('positions: could not save:', (err as Error).message);
    }
    for (const fn of this.#listeners) fn();
  }

  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }
}
