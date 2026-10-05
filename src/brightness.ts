/**
 * The deck's backlight level (0–100), shared by every surface and adjustable
 * live (e.g. from the browser deck's slider). Standby dims below it
 * temporarily without changing it.
 */
export class Brightness {
  #value: number;
  #listeners = new Set<() => void>();

  constructor(initial: number) {
    this.#value = clamp(initial);
  }

  get value(): number {
    return this.#value;
  }

  set(percent: number): void {
    const value = clamp(percent);
    if (value === this.#value) return;
    this.#value = value;
    for (const fn of this.#listeners) fn();
  }

  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }
}

function clamp(n: number): number {
  return Number.isFinite(n) ? Math.round(Math.min(100, Math.max(0, n))) : 70;
}
