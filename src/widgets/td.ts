import type { SKRSContext2D } from '@napi-rs/canvas';
import { Widget } from '../widget.ts';
import { colors, keyFace, type Role, roundedFill, text } from '../draw.ts';
import type { TouchDesigner } from '../td.ts';
import type { TdApi } from '../tdapi.ts';
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

/** Anything the REC key can drive. */
export interface Recorder {
  readonly online: boolean;
  readonly recording: boolean;
  /** Seconds into the current take, when known. */
  readonly seconds?: number;
  /** Shown under REC in place of "TD online" when it can't record yet. */
  readonly status?: string;
  /** How long STOP must be held; defaults to 1s. */
  readonly holdMs?: number;
  start(): void;
  /** STOP pressed: a hold to end the take begins. */
  holdStop(): void;
  /** STOP let go; `full` when it was held for the whole `holdMs`. */
  releaseStop(full: boolean): void;
  subscribe(fn: () => void): () => void;
}

/** A Recorder over a toggle parameter on the local greendeck.tox link. */
export function tdRecorder(td: TouchDesigner, name: string): Recorder {
  return {
    get online() {
      return td.online;
    },
    get recording() {
      return td.online && td.isOn(name);
    },
    get status() {
      return td.values.has(name) ? undefined : 'unbound';
    },
    start: () => td.set(name, true),
    holdStop: () => {},
    releaseStop: (full) => {
      if (full) td.set(name, false);
    },
    subscribe: (fn) => td.subscribe(fn),
  };
}

/** A Recorder over the show TD's HTTP API. */
export function tdApiRecorder(api: TdApi): Recorder {
  return {
    get online() {
      return api.online;
    },
    get recording() {
      return api.recording;
    },
    get seconds() {
      return api.seconds;
    },
    // TD needs 1.5s between hold and release; the extra 0.3s covers the hold
    // reaching TD later than the release over a slow link.
    holdMs: 1800,
    start: () => api.startRecording(),
    holdStop: () => api.holdStop(),
    // Always sent, so TD never stays held; TD itself decides if it was long enough.
    releaseStop: () => api.releaseStop(),
    subscribe: (fn) => api.subscribe(fn),
  };
}

/**
 * CACHE REC on the show TD's HTTP API: a press sends POST /api/cache/rec.
 * Lit red while TD reports the cache recording, amber while it's saving.
 */
export class CacheRecButton extends Widget {
  #api: TdApi;
  #label: string;
  #flashUntil = 0;
  #unsubscribe: (() => void) | undefined;

  constructor(api: TdApi, opts: { label?: string } = {}) {
    super();
    this.#api = api;
    this.#label = opts.label ?? 'CACHE REC';
  }

  mount(): void {
    this.#unsubscribe = this.#api.subscribe(() => this.invalidate());
  }

  unmount(): void {
    this.#unsubscribe?.();
  }

  onDown(): void {
    if (!this.#api.online) return;
    this.#api.cacheRec();
    this.#flashUntil = performance.now() + 150;
    this.invalidate();
    setTimeout(() => this.invalidate(), 160);
  }

  render(ctx: SKRSContext2D, s: number): void {
    const { online, state } = this.#api;
    const recording = online && !!state?.cache_recording;
    const saving = online && !!state?.cache_saving;
    const flash = performance.now() < this.#flashUntil;
    if (saving) roundedFill(ctx, s, colors.pending);
    else keyFace(ctx, s, 'action', recording || flash);
    const lit = recording || saving || flash;
    ctx.fillStyle = lit ? '#fff' : online ? colors.error : colors.dim;
    ctx.beginPath();
    ctx.arc(s / 2, s * 0.26, 7, 0, Math.PI * 2);
    ctx.fill();
    text(ctx, this.#label, s / 2, s * 0.52, { size: 18, maxWidth: s - 14, color: lit ? '#fff' : online ? colors.text : colors.dim });
    const status = !online ? 'TD offline' : saving ? 'saving' : recording ? 'recording' : state?.cache_on ? 'cache on' : 'cache off';
    const color = lit ? '#fff' : !online ? colors.pending : state?.cache_on ? colors.active : colors.dim;
    text(ctx, status, s / 2, s * 0.78, { size: 12, maxWidth: s - 14, weight: 'bold', color });
  }
}

function duration(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor(s / 60) % 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm.padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

/**
 * A record button. Press to start. While recording it turns into a bright red
 * STOP key that needs a long press, so a stray tap can't end a take: hold
 * until the bar fills, then let go to stop; letting go early cancels.
 */
export class RecordButton extends Widget {
  #rec: Recorder;
  #label: string;
  #hold: Hold;
  #holding = false;
  /** Held for the whole hold time: letting go now ends the take. */
  #full = false;
  #unsubscribe: (() => void) | undefined;

  constructor(rec: Recorder, opts: { label?: string; holdMs?: number } = {}) {
    super();
    this.#rec = rec;
    this.#label = opts.label ?? 'REC';
    this.#hold = new Hold(
      opts.holdMs ?? rec.holdMs ?? 1000,
      () => {
        this.#full = true;
        this.invalidate();
      },
      () => this.invalidate(),
    );
  }

  mount(): void {
    this.#unsubscribe = this.#rec.subscribe(() => this.invalidate());
  }

  onDown(): void {
    if (!this.#rec.online) return;
    if (!this.#rec.recording) return this.#rec.start();
    this.#holding = true;
    this.#full = false;
    this.#rec.holdStop();
    this.#hold.start();
  }

  onUp(): void {
    this.#endHold(this.#full);
  }

  unmount(): void {
    this.#endHold(false);
    this.#unsubscribe?.();
  }

  #endHold(full: boolean): void {
    if (!this.#holding) return;
    this.#holding = false;
    this.#full = false;
    if (full) this.#hold.cancel();
    else this.#hold.release();
    this.#rec.releaseStop(full);
    this.invalidate();
  }

  render(ctx: SKRSContext2D, s: number): void {
    if (!this.#rec.recording) {
      const online = this.#rec.online;
      keyFace(ctx, s, 'action');
      ctx.fillStyle = online ? colors.error : colors.dim;
      ctx.beginPath();
      ctx.arc(s / 2, s * 0.3, 7, 0, Math.PI * 2);
      ctx.fill();
      text(ctx, this.#label, s / 2, s * 0.56, { size: 22, maxWidth: s - 14, color: online ? colors.text : colors.dim });
      const status = !online ? 'TD offline' : (this.#rec.status ?? 'TD online');
      const color = !online ? colors.pending : this.#rec.status ? colors.dim : colors.active;
      text(ctx, status, s / 2, s * 0.8, { size: 12, maxWidth: s - 14, weight: 'bold', color });
      return;
    }

    keyFace(ctx, s, 'action', true);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.roundRect(s / 2 - 8, s * 0.3 - 8, 16, 16, 2);
    ctx.fill();
    const seconds = this.#rec.seconds;
    text(ctx, seconds !== undefined ? duration(seconds) : 'STOP', s / 2, s * 0.56, { size: 22, maxWidth: s - 14, color: '#fff' });
    const progress = this.#full ? 1 : this.#hold.progress;
    const loud = this.#full || this.#hold.hinting;
    const hint = this.#full ? 'LET GO' : progress !== undefined ? 'keep holding' : this.#hold.hinting ? 'HOLD' : 'hold to stop';
    text(ctx, hint, s / 2, s * 0.77, {
      size: loud ? 14 : 11,
      maxWidth: s - 14,
      weight: loud ? 'bold' : 'normal',
      color: '#fff',
    });
    if (progress !== undefined) drawHoldBar(ctx, s, progress);
  }
}
