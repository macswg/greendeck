/**
 * Standby shared by every surface: SLEEP on the hardware, a phone or the
 * browser puts them all to sleep, and WAKE on any of them wakes them all.
 */
export class SharedStandby {
  #on = false;
  #listeners = new Set<() => void>();

  get on(): boolean {
    return this.#on;
  }

  setStandby(on: boolean): void {
    if (on === this.#on) return;
    this.#on = on;
    for (const fn of this.#listeners) fn();
  }

  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }
}
