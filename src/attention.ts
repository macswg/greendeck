import type { Ambient } from './ambient.ts';
import type { Background } from './background.ts';
import type { PushHub } from './push.ts';

/**
 * "Something needs you": while any reason is raised, the deck shows an alert
 * background in short bursts, then rests, then repeats, so it gets your
 * attention without animating nonstop. Stops the moment nothing needs you.
 *
 * Reasons can be raised in code (e.g. a Claude session waiting) or over the
 * push port by other programs:
 *
 *   attention.<name> on
 *   attention.<name> off
 */
export class Attention {
  #ambient: Ambient;
  #makeBackground: () => Background;
  #burstMs: number;
  #restMs: number;
  #reasons = new Set<string>();
  #timer: NodeJS.Timeout | undefined;

  constructor(
    push: PushHub,
    ambient: Ambient,
    /** A fresh background per burst, so each one starts clean. */
    makeBackground: () => Background,
    opts: { burstMs?: number; restMs?: number } = {},
  ) {
    this.#ambient = ambient;
    this.#makeBackground = makeBackground;
    this.#burstMs = opts.burstMs ?? 6000;
    this.#restMs = opts.restMs ?? 2 * 60_000;
    push.subscribeAll((id, value) => {
      if (!id.startsWith('attention.')) return;
      const reason = `push:${id.slice(10)}`;
      if (value === 'on') this.raise(reason);
      else if (value === 'off') this.clear(reason);
    });
  }

  get active(): boolean {
    return this.#reasons.size > 0;
  }

  raise(reason: string): void {
    if (this.#reasons.has(reason)) return;
    this.#reasons.add(reason);
    // Something new: show it now rather than waiting out the rest.
    this.poke();
  }

  clear(reason: string): void {
    if (!this.#reasons.delete(reason) || this.#reasons.size) return;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#ambient.clear('attention');
  }

  /** Burst now (and restart the rest timer), if anything needs attention. */
  poke(): void {
    if (this.#reasons.size) this.#burst();
  }

  #burst(): void {
    clearTimeout(this.#timer);
    this.#ambient.set('attention', this.#makeBackground(), 10);
    this.#timer = setTimeout(() => {
      this.#ambient.clear('attention');
      this.#timer = setTimeout(() => this.poke(), this.#restMs);
    }, this.#burstMs);
  }
}
