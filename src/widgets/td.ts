import type { SKRSContext2D } from '@napi-rs/canvas';
import { Widget } from '../widget.ts';
import { colors, roundedFill, text } from '../draw.ts';
import type { TouchDesigner } from '../td.ts';

abstract class TdWidget extends Widget {
  protected td: TouchDesigner;
  #unsubscribe: (() => void) | undefined;

  constructor(td: TouchDesigner) {
    super();
    this.td = td;
  }

  mount(): void {
    this.#unsubscribe = this.td.subscribe(() => this.invalidate());
  }

  unmount(): void {
    this.#unsubscribe?.();
  }
}

/**
 * Toggles a bound TD parameter. Lights only when TD reports it on, so the key
 * always shows TD's real state, including changes made inside TD.
 */
export class TdToggle extends TdWidget {
  #name: string;
  #label: string;
  #onColor: string;

  constructor(td: TouchDesigner, name: string, opts: { label?: string; onColor?: string } = {}) {
    super(td);
    this.#name = name;
    this.#label = opts.label ?? name.toUpperCase();
    this.#onColor = opts.onColor ?? colors.active;
  }

  onDown(): void {
    if (this.td.online) this.td.toggle(this.#name);
  }

  render(ctx: SKRSContext2D, s: number): void {
    const online = this.td.online;
    const known = this.td.values.has(this.#name);
    const on = online && this.td.isOn(this.#name);
    roundedFill(ctx, s, on ? this.#onColor : colors.bg);
    if (on) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(s / 2, s * 0.3, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    text(ctx, this.#label, s / 2, s * 0.56, { size: 22, maxWidth: s - 14, color: online ? colors.text : colors.dim });
    const status = !online ? 'TD offline' : !known ? 'unbound' : on ? 'ON' : 'off';
    text(ctx, status, s / 2, s * 0.8, { size: 12, maxWidth: s - 14, weight: 'normal', color: on ? '#fff' : colors.dim });
  }
}

/** Fires a TD pulse parameter (or any one-shot action) on press. */
export class TdPulse extends TdWidget {
  #name: string;
  #label: string;
  #flashUntil = 0;

  constructor(td: TouchDesigner, name: string, opts: { label?: string } = {}) {
    super(td);
    this.#name = name;
    this.#label = opts.label ?? name.toUpperCase();
  }

  onDown(): void {
    if (!this.td.online) return;
    this.td.pulse(this.#name);
    this.#flashUntil = performance.now() + 150;
    this.invalidate();
    setTimeout(() => this.invalidate(), 160);
  }

  render(ctx: SKRSContext2D, s: number): void {
    const flash = performance.now() < this.#flashUntil;
    roundedFill(ctx, s, flash ? colors.accent : colors.bg);
    text(ctx, this.#label, s / 2, s / 2, { size: 22, maxWidth: s - 14, color: this.td.online ? colors.text : colors.dim });
  }
}
