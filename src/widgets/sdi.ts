import type { SKRSContext2D } from '@napi-rs/canvas';
import { Widget } from '../widget.ts';
import { colors, roundedFill, text } from '../draw.ts';
import type { Lilliput } from '../lilliput.ts';

export type SdiInput = 1 | 2;
export type Tally = 'red' | 'green' | 'yellow';

const TALLY_COLORS: Record<Tally, string> = { red: colors.error, green: colors.active, yellow: colors.pending };

/**
 * A tally light showing one colour at a time, or off, on a Lilliput monitor.
 * Without a monitor (none configured) the deck just remembers what's held.
 */
export class TallyLight {
  /** Who the tally is for, shown on its keys; unnamed keys show the colour. */
  readonly name: string | undefined;
  readonly monitor: Lilliput | undefined;
  color: Tally | undefined;

  #listeners = new Set<() => void>();

  constructor(name?: string, monitor?: Lilliput) {
    this.name = name;
    this.monitor = monitor;
  }

  /** Also fires when the monitor's state or reachability changes. */
  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn);
    const unsubscribe = this.monitor?.subscribe(fn);
    return () => {
      this.#listeners.delete(fn);
      unsubscribe?.();
    };
  }

  set(color: Tally | undefined): void {
    this.color = color;
    for (const fn of this.#listeners) fn();
    void this.monitor?.setTally(color ?? 'off');
  }
}

/**
 * The SDI monitor, shared by its keys: input switching and a tally. Without a
 * Lilliput configured the deck just remembers what was pressed.
 */
export class SdiMonitor {
  readonly monitor: Lilliput | undefined;
  readonly tally: TallyLight;

  #input: SdiInput | undefined;
  #listeners = new Set<() => void>();

  constructor(monitor?: Lilliput) {
    this.monitor = monitor;
    this.tally = new TallyLight(undefined, monitor);
    monitor?.subscribe(() => this.#notify());
  }

  /** The current input: as last read from the monitor, if there is one. */
  get input(): SdiInput | undefined {
    if (!this.monitor) return this.#input;
    const index = this.monitor.input;
    return index === 0 || index === 1 ? ((index + 1) as SdiInput) : undefined;
  }

  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  setInput(input: SdiInput): void {
    if (this.monitor) void this.monitor.setInput(input - 1);
    else {
      this.#input = input;
      this.#notify();
    }
  }

  #notify(): void {
    for (const fn of this.#listeners) fn();
  }
}

/** Small "offline" note for keys whose monitor isn't answering. */
function offline(monitor: Lilliput | undefined): boolean {
  return !!monitor && !monitor.reachable;
}

abstract class SdiWidget extends Widget {
  protected sdi: SdiMonitor;
  #unsubscribe: (() => void) | undefined;

  constructor(sdi: SdiMonitor) {
    super();
    this.sdi = sdi;
  }

  mount(): void {
    this.#unsubscribe = this.sdi.subscribe(() => this.invalidate());
  }

  unmount(): void {
    this.#unsubscribe?.();
  }
}

/** "SDI MON" key showing the current input. Press to toggle SDI 1 ↔ SDI 2. */
export class SdiHeader extends SdiWidget {
  onDown(): void {
    this.sdi.setInput(this.sdi.input === 1 ? 2 : 1);
  }

  render(ctx: SKRSContext2D, s: number): void {
    roundedFill(ctx, s, colors.bg);
    text(ctx, 'SDI MON', s / 2, s * 0.36, { size: 22, maxWidth: s - 16 });
    const { input } = this.sdi;
    const down = offline(this.sdi.monitor);
    text(ctx, input ? `SDI ${input}` : '—', s / 2, s * 0.68, { size: 22, maxWidth: s - 16, color: input && !down ? colors.active : colors.dim });
    if (down) text(ctx, 'offline', s / 2, s * 0.88, { size: 11, maxWidth: s - 16, color: colors.dim, weight: 'normal' });
  }
}

/** One SDI input button, lit when it's the current input. */
export class SdiInputButton extends SdiWidget {
  #input: SdiInput;

  constructor(sdi: SdiMonitor, input: SdiInput) {
    super(sdi);
    this.#input = input;
  }

  onDown(): void {
    this.sdi.setInput(this.#input);
  }

  render(ctx: SKRSContext2D, s: number): void {
    const on = this.sdi.input === this.#input;
    roundedFill(ctx, s, on ? colors.active : colors.bg);
    text(ctx, `SDI ${this.#input}`, s / 2, s / 2, { size: 26, maxWidth: s - 16, color: on ? '#000' : colors.text });
  }
}

/**
 * One colour of a tally, lit only while held: solid in its colour then, a
 * coloured ring otherwise. Holding a second colour takes over; letting go of
 * one that's no longer lit does nothing.
 */
export class TallyButton extends Widget {
  #light: TallyLight;
  #color: Tally;
  #unsubscribe: (() => void) | undefined;

  constructor(light: TallyLight, color: Tally) {
    super();
    this.#light = light;
    this.#color = color;
  }

  mount(): void {
    this.#unsubscribe = this.#light.subscribe(() => this.invalidate());
  }

  unmount(): void {
    this.#unsubscribe?.();
  }

  onDown(): void {
    this.#light.set(this.#color);
  }

  onUp(): void {
    if (this.#light.color === this.#color) this.#light.set(undefined);
  }

  render(ctx: SKRSContext2D, s: number): void {
    const on = this.#light.color === this.#color;
    const color = TALLY_COLORS[this.#color];
    roundedFill(ctx, s, on ? color : colors.bg);
    if (!on) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(8, 8, s - 16, s - 16, 9);
      ctx.stroke();
      ctx.restore();
    }
    const { name } = this.#light;
    text(ctx, (name ?? this.#color).toUpperCase(), s / 2, s * 0.42, { size: 18, maxWidth: s - 18, color: on ? '#000' : colors.text });
    const sub = offline(this.#light.monitor) ? 'offline' : name ? this.#color : 'tally';
    text(ctx, sub, s / 2, s * 0.68, { size: 13, maxWidth: s - 18, weight: 'normal', color: on ? '#000' : colors.dim });
  }
}
