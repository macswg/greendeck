import { cpus } from 'node:os';
import type { SKRSContext2D } from '@napi-rs/canvas';
import { Widget } from '../widget.ts';
import { colors, roundedFill, sparkline, text } from '../draw.ts';
import type { Engine } from '../engine.ts';
import type { PushHub } from '../push.ts';

/** HH:MM:SS, redrawn on each second boundary. */
export class Clock extends Widget {
  #timer: NodeJS.Timeout | undefined;

  mount(): void {
    const tick = () => {
      this.invalidate();
      this.#timer = setTimeout(tick, 1000 - (Date.now() % 1000));
    };
    tick();
  }

  unmount(): void {
    clearTimeout(this.#timer);
  }

  render(ctx: SKRSContext2D, s: number): void {
    roundedFill(ctx, s, colors.bg);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    text(ctx, `${pad(now.getHours())}:${pad(now.getMinutes())}`, s / 2, s * 0.4, { size: 30, maxWidth: s - 8 });
    text(ctx, pad(now.getSeconds()), s / 2, s * 0.72, { size: 22, maxWidth: s - 8, color: colors.accent });
  }
}

/** Total CPU usage with a scrolling history graph. */
export class CpuGraph extends Widget {
  #history: number[] = [];
  #prev = cpuTimes();
  #timer: NodeJS.Timeout | undefined;
  #intervalMs: number;

  constructor(intervalMs = 250) {
    super();
    this.#intervalMs = intervalMs;
  }

  mount(): void {
    this.#timer = setInterval(() => {
      const next = cpuTimes();
      const total = next.total - this.#prev.total;
      const pct = total ? 100 * (1 - (next.idle - this.#prev.idle) / total) : 0;
      this.#prev = next;
      this.#history.push(pct);
      if (this.#history.length > 40) this.#history.shift();
      this.invalidate();
    }, this.#intervalMs);
  }

  unmount(): void {
    clearInterval(this.#timer);
  }

  render(ctx: SKRSContext2D, s: number): void {
    roundedFill(ctx, s, colors.bg);
    const pct = this.#history.at(-1) ?? 0;
    sparkline(ctx, this.#history, { x: 0, y: s * 0.45, w: s, h: s * 0.55 }, { min: 0, max: 100, color: pct > 80 ? colors.error : colors.accent });
    text(ctx, 'CPU', s / 2, s * 0.15, { size: 14, maxWidth: s - 8, color: colors.dim });
    text(ctx, `${pct.toFixed(0)}%`, s / 2, s * 0.38, { size: 28, maxWidth: s - 8 });
  }
}

function cpuTimes(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const { times } of cpus()) {
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return { idle, total };
}

/**
 * A value pushed in from outside over UDP (see push.ts). Numeric values also
 * get a history graph.
 */
export class PushValue extends Widget {
  #hub: PushHub;
  #id: string;
  #label: string;
  #value = '—';
  #history: number[] = [];
  #unsubscribe: (() => void) | undefined;

  constructor(hub: PushHub, id: string, label = id) {
    super();
    this.#hub = hub;
    this.#id = id;
    this.#label = label;
  }

  mount(): void {
    this.#unsubscribe = this.#hub.subscribe(this.#id, (value) => {
      this.#value = value;
      const n = Number(value);
      if (value !== '' && Number.isFinite(n)) {
        this.#history.push(n);
        if (this.#history.length > 48) this.#history.shift();
      }
      this.invalidate();
    });
  }

  unmount(): void {
    this.#unsubscribe?.();
  }

  render(ctx: SKRSContext2D, s: number): void {
    roundedFill(ctx, s, colors.bg);
    if (this.#history.length > 1) {
      const min = Math.min(...this.#history);
      const max = Math.max(...this.#history);
      sparkline(ctx, this.#history, { x: 0, y: s * 0.55, w: s, h: s * 0.45 }, { min, max: max === min ? min + 1 : max, color: colors.active });
    }
    text(ctx, this.#label, s / 2, s * 0.15, { size: 14, maxWidth: s - 8, color: colors.dim });
    text(ctx, this.#value, s / 2, s * 0.42, { size: 26, maxWidth: s - 8 });
  }
}

/** Live deck throughput, handy when tuning how much realtime data to show. */
export class EngineStatsWidget extends Widget {
  #engine: Engine;
  #unsubscribe: (() => void) | undefined;

  constructor(engine: Engine) {
    super();
    this.#engine = engine;
  }

  mount(): void {
    this.#unsubscribe = this.#engine.onStats(() => this.invalidate());
  }

  unmount(): void {
    this.#unsubscribe?.();
  }

  render(ctx: SKRSContext2D, s: number): void {
    roundedFill(ctx, s, colors.bg);
    const { fps, keysPerSec, frameMs } = this.#engine.stats;
    text(ctx, 'DECK', s / 2, s * 0.15, { size: 14, maxWidth: s - 8, color: colors.dim });
    text(ctx, `${fps} fps`, s / 2, s * 0.4, { size: 20, maxWidth: s - 8 });
    text(ctx, `${keysPerSec} keys/s`, s / 2, s * 0.62, { size: 13, maxWidth: s - 8, weight: 'normal', color: colors.dim });
    text(ctx, `${frameMs.toFixed(1)} ms`, s / 2, s * 0.8, { size: 13, maxWidth: s - 8, weight: 'normal', color: colors.dim });
  }
}
