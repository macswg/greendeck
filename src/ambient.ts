import { ColorChase, ColorPulse, Scanner, type Background } from './background.ts';
import type { PushHub } from './push.ts';

interface State {
  background: Background;
  priority: number;
  order: number;
}

/**
 * Named background states that signal something across the whole deck, e.g.
 * "a Claude session is waiting" or "recording". Anything can raise or clear a
 * state; the deck shows the highest-priority one (newest wins a tie), and a
 * plain background when none are active.
 *
 * Other programs can drive it over the push port:
 *
 *   bg.<name> <#rrggbb> [pulse seconds, 0 = steady, "chase" or "scanner"] [priority]
 *   bg.<name> off
 */
export class Ambient {
  #states = new Map<string, State>();
  #order = 0;
  #listeners = new Set<() => void>();

  constructor(push: PushHub) {
    push.subscribeAll((id, value) => {
      if (!id.startsWith('bg.')) return;
      const name = id.slice(3);
      const [color, period, priority] = value.split(/\s+/);
      if (!color || color === 'off') {
        this.clear(name);
        return;
      }
      try {
        const background =
          period === 'chase'
            ? new ColorChase(color)
            : period === 'scanner'
              ? new Scanner(color)
              : new ColorPulse(color, { period: period ? Number(period) : undefined });
        this.set(name, background, Number(priority) || 0);
      } catch (err) {
        console.error(`bg.${name}:`, (err as Error).message);
      }
    });
  }

  set(name: string, background: Background, priority = 0): void {
    const existing = this.#states.get(name);
    if (existing?.background === background && existing.priority === priority) return;
    this.#states.set(name, { background, priority, order: ++this.#order });
    this.#notify();
  }

  clear(name: string): void {
    if (this.#states.delete(name)) this.#notify();
  }

  /** The background set under `name`, if that state is active. */
  get(name: string): Background | undefined {
    return this.#states.get(name)?.background;
  }

  get current(): Background | undefined {
    let best: State | undefined;
    for (const s of this.#states.values()) {
      if (!best || s.priority > best.priority || (s.priority === best.priority && s.order > best.order)) best = s;
    }
    return best?.background;
  }

  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #notify(): void {
    for (const fn of this.#listeners) fn();
  }
}
