import type { SKRSContext2D } from '@napi-rs/canvas';
import { Widget } from '../widget.ts';
import { colors, keyFace, type Role, text } from '../draw.ts';
import type { TouchDesigner } from '../td.ts';
import { drawHoldBar, Hold } from '../hold.ts';

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
  #role: Role;

  /** Defaults to the red `action` role: these drive the show. */
  constructor(td: TouchDesigner, name: string, opts: { label?: string; role?: Role } = {}) {
    super(td);
    this.#name = name;
    this.#label = opts.label ?? name.toUpperCase();
    this.#role = opts.role ?? 'action';
  }

  onDown(): void {
    if (this.td.online) this.td.toggle(this.#name);
  }

  render(ctx: SKRSContext2D, s: number): void {
    const online = this.td.online;
    const known = this.td.values.has(this.#name);
    const on = online && this.td.isOn(this.#name);
    keyFace(ctx, s, this.#role, on);
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
  #role: Role;
  #flashUntil = 0;

  constructor(td: TouchDesigner, name: string, opts: { label?: string; role?: Role } = {}) {
    super(td);
    this.#name = name;
    this.#label = opts.label ?? name.toUpperCase();
    this.#role = opts.role ?? 'action';
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
    keyFace(ctx, s, this.#role, flash);
    text(ctx, this.#label, s / 2, s / 2, { size: 22, maxWidth: s - 14, color: this.td.online ? colors.text : colors.dim });
  }
}

/**
 * A record button for a TD toggle. Press to start. While recording it turns
 * into a bright red STOP key that needs a long press, so a stray tap can't end
 * a take: hold for `holdMs` (a bar fills as you hold); letting go early cancels.
 */
export class RecordButton extends TdWidget {
  #name: string;
  #label: string;
  #hold: Hold;

  constructor(td: TouchDesigner, name: string, opts: { label?: string; holdMs?: number } = {}) {
    super(td);
    this.#name = name;
    this.#label = opts.label ?? 'REC';
    this.#hold = new Hold(opts.holdMs ?? 1000, () => this.td.set(this.#name, false), () => this.invalidate());
  }

  get #recording(): boolean {
    return this.td.online && this.td.isOn(this.#name);
  }

  onDown(): void {
    if (!this.td.online) return;
    if (this.#recording) this.#hold.start();
    else this.td.set(this.#name, true);
  }

  onUp(): void {
    this.#hold.release();
  }

  unmount(): void {
    this.#hold.cancel();
    super.unmount();
  }

  render(ctx: SKRSContext2D, s: number): void {
    if (!this.#recording) {
      const online = this.td.online;
      keyFace(ctx, s, 'action');
      ctx.fillStyle = colors.error;
      ctx.beginPath();
      ctx.arc(s / 2, s * 0.3, 7, 0, Math.PI * 2);
      ctx.fill();
      text(ctx, this.#label, s / 2, s * 0.56, { size: 22, maxWidth: s - 14, color: online ? colors.text : colors.dim });
      const status = !online ? 'TD offline' : this.td.values.has(this.#name) ? 'ready' : 'unbound';
      text(ctx, status, s / 2, s * 0.8, { size: 12, maxWidth: s - 14, weight: 'normal', color: colors.dim });
      return;
    }

    keyFace(ctx, s, 'action', true);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.roundRect(s / 2 - 8, s * 0.3 - 8, 16, 16, 2);
    ctx.fill();
    text(ctx, 'STOP', s / 2, s * 0.56, { size: 22, maxWidth: s - 14, color: '#fff' });

    const progress = this.#hold.progress;
    const hint = this.#hold.hinting;
    text(ctx, progress !== undefined ? 'keep holding' : hint ? 'HOLD' : 'hold to stop', s / 2, s * 0.77, {
      size: hint ? 14 : 11,
      maxWidth: s - 14,
      weight: hint ? 'bold' : 'normal',
      color: '#fff',
    });
    if (progress !== undefined) drawHoldBar(ctx, s, progress);
  }
}
