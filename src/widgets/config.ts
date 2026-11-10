import type { SKRSContext2D } from '@napi-rs/canvas';
import { Widget } from '../widget.ts';
import { colors, keyFace, roundedFill, text } from '../draw.ts';
import type { Configs } from '../config.ts';
import { drawHoldBar, Hold } from '../hold.ts';
import type { Pager } from '../pages.ts';

type AnyConfigs = Configs<{ stop(): void }>;

/** How long CONFIRM must be held. */
const CONFIRM_MS = 3000;
/** A picked config is dropped if it isn't confirmed within this long. */
const CHOICE_MS = 15_000;

/** Something that must not be cut off by a switch, like a recording. */
export interface Guard {
  /** Shown on CONFIRM while it blocks a switch. */
  readonly label: string;
  readonly recording: boolean;
  subscribe(fn: () => void): () => void;
}

/**
 * The config picked on the Config page, waiting for CONFIRM. Forgotten after
 * a while, or when the page is left, so a stray CONFIRM later does nothing.
 */
export class ConfigChoice {
  #name: string | undefined;
  #timer: NodeJS.Timeout | undefined;
  #listeners = new Set<() => void>();

  get name(): string | undefined {
    return this.#name;
  }

  /** Pick a config, or unpick it if it's already picked. */
  toggle(name: string): void {
    this.#set(this.#name === name ? undefined : name);
  }

  clear(): void {
    this.#set(undefined);
  }

  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #set(name: string | undefined): void {
    clearTimeout(this.#timer);
    this.#name = name;
    if (name) this.#timer = setTimeout(() => this.clear(), CHOICE_MS);
    for (const fn of this.#listeners) fn();
  }
}

/**
 * One config. Tapping only picks it (CONFIRM does the switch); the one in use
 * is lit, the picked one amber.
 */
export class ConfigButton extends Widget {
  #configs: AnyConfigs;
  #choice: ConfigChoice;
  #name: string;
  #unsubscribe?: () => void;

  constructor(configs: AnyConfigs, choice: ConfigChoice, name: string) {
    super();
    this.#configs = configs;
    this.#choice = choice;
    this.#name = name;
  }

  mount(): void {
    this.#unsubscribe = this.#choice.subscribe(() => this.invalidate());
  }

  unmount(): void {
    this.#unsubscribe?.();
  }

  onDown(): void {
    this.#choice.toggle(this.#name);
  }

  render(ctx: SKRSContext2D, s: number): void {
    const inUse = this.#configs.name === this.#name;
    const picked = this.#choice.name === this.#name;
    if (picked) roundedFill(ctx, s, colors.pending);
    else keyFace(ctx, s, 'default', inUse);
    text(ctx, this.#name.toUpperCase(), s / 2, s * 0.42, { size: 18, maxWidth: s - 14, weight: 'bold' });
    text(ctx, picked ? 'PICKED' : inUse ? 'IN USE' : '', s / 2, s * 0.68, { size: 12, maxWidth: s - 14, weight: 'normal', color: colors.text });
  }
}

/**
 * Switches to the picked config after a 3 s hold, since a switch rebuilds
 * every key and drops what the old config was talking to. Does nothing until
 * a config is picked, and refuses while anything is recording. Confirming the
 * config in use reloads its file.
 */
export class ConfirmSwitch extends Widget {
  #configs: AnyConfigs;
  #choice: ConfigChoice;
  #guards: Guard[];
  #hold: Hold;
  #unsubscribe: (() => void)[] = [];

  constructor(configs: AnyConfigs, choice: ConfigChoice, guards: Guard[]) {
    super();
    this.#configs = configs;
    this.#choice = choice;
    this.#guards = guards;
    this.#hold = new Hold(CONFIRM_MS, () => this.#confirm(), () => this.invalidate());
  }

  mount(): void {
    const redraw = () => {
      // A recording starting mid-hold cancels it.
      if (this.#blocker) this.#hold.cancel();
      this.invalidate();
    };
    this.#unsubscribe = [this.#choice.subscribe(redraw), ...this.#guards.map((g) => g.subscribe(redraw))];
  }

  /** Leaving the page drops the pick, so it can't be confirmed later by mistake. */
  unmount(): void {
    this.#hold.cancel();
    for (const fn of this.#unsubscribe.splice(0)) fn();
    this.#choice.clear();
  }

  onDown(): void {
    if (this.#choice.name && !this.#blocker) this.#hold.start();
  }

  onUp(): void {
    this.#hold.release();
  }

  get #blocker(): Guard | undefined {
    return this.#guards.find((g) => g.recording);
  }

  #confirm(): void {
    const name = this.#choice.name;
    if (!name || this.#blocker) return;
    this.#choice.clear();
    this.#configs.switch(name);
  }

  render(ctx: SKRSContext2D, s: number): void {
    const name = this.#choice.name;
    const blocker = this.#blocker;
    const progress = this.#hold.progress;
    if (!name) {
      keyFace(ctx, s, 'nav');
      text(ctx, 'CONFIRM', s / 2, s * 0.4, { size: 14, maxWidth: s - 14, color: colors.dim });
      text(ctx, 'pick a config', s / 2, s * 0.64, { size: 11, maxWidth: s - 14, weight: 'normal', color: colors.dim });
      return;
    }
    if (blocker) {
      keyFace(ctx, s, 'action', true);
      text(ctx, `STOP ${blocker.label}`, s / 2, s * 0.4, { size: 14, maxWidth: s - 14 });
      text(ctx, 'FIRST', s / 2, s * 0.64, { size: 12, maxWidth: s - 14, weight: 'normal' });
      return;
    }
    roundedFill(ctx, s, colors.pending);
    const reload = name === this.#configs.name;
    const hint = this.#hold.hinting;
    text(ctx, reload ? 'RELOAD' : 'SWITCH TO', s / 2, s * 0.3, { size: 11, maxWidth: s - 14, weight: 'normal' });
    text(ctx, name.toUpperCase(), s / 2, s * 0.5, { size: 17, maxWidth: s - 14 });
    text(ctx, hint ? 'HOLD 3s' : 'hold 3s', s / 2, s * 0.7, { size: 11, maxWidth: s - 14, weight: hint ? 'bold' : 'normal' });
    if (progress !== undefined) drawHoldBar(ctx, s, progress);
  }
}

/** Shows the config in use; press to open the Config page. */
export class ConfigLink extends Widget {
  #pager: Pager;
  #configs: AnyConfigs;

  constructor(pager: Pager, configs: AnyConfigs) {
    super();
    this.#pager = pager;
    this.#configs = configs;
  }

  onDown(): void {
    this.#pager.goTo('Config');
  }

  render(ctx: SKRSContext2D, s: number): void {
    keyFace(ctx, s, 'nav');
    text(ctx, 'CONFIG', s / 2, s * 0.28, { size: 11, maxWidth: s - 14, color: colors.dim });
    text(ctx, this.#configs.name.toUpperCase(), s / 2, s * 0.5, { size: 18, maxWidth: s - 14, weight: 'bold' });
    // A small chevron to say "opens a page", like PageLink.
    ctx.strokeStyle = colors.dim;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(s / 2 - 5, s * 0.68);
    ctx.lineTo(s / 2 + 1, s * 0.74);
    ctx.lineTo(s / 2 - 5, s * 0.8);
    ctx.stroke();
  }
}
