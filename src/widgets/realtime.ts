import { cpus } from 'node:os';
import type { SKRSContext2D } from '@napi-rs/canvas';
import { Widget } from '../widget.ts';
import { colors, FONT, keyFace, roundedFill, sparkline, text } from '../draw.ts';
import type { FanControl } from '../fans.ts';
import { drawHoldBar, Hold } from '../hold.ts';
import type { Engine } from '../engine.ts';
import type { PushHub } from '../push.ts';
import type { SystemStats } from '../system.ts';

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

abstract class SystemWidget extends Widget {
  protected stats: SystemStats;
  #unsubscribe: (() => void) | undefined;

  constructor(stats: SystemStats) {
    super();
    this.stats = stats;
  }

  mount(): void {
    this.#unsubscribe = this.stats.subscribe(() => this.invalidate());
  }

  unmount(): void {
    this.#unsubscribe?.();
  }
}

/** One "LABEL  value" line of a two-reading key. */
function reading(ctx: SKRSContext2D, s: number, label: string, value: string, color: string, y: number): void {
  ctx.textBaseline = 'middle';
  ctx.font = `normal 11px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = colors.dim;
  ctx.fillText(label, 12, y);
  ctx.font = `bold 20px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillStyle = color;
  ctx.fillText(value, s - 10, y);
}

/**
 * CPU and GPU temperature (°C) on one key, each with its own history line.
 * Each reading turns amber when warm (70°) and red when hot (90°).
 */
export class TempKey extends SystemWidget {
  render(ctx: SKRSContext2D, s: number): void {
    roundedFill(ctx, s, colors.bg);
    const { cpuTemp, gpuTemp } = this.stats.history;
    const cpu = cpuTemp.at(-1);
    const gpu = gpuTemp.at(-1);
    const heat = (t: number | undefined, normal: string) =>
      t === undefined ? colors.dim : t >= 90 ? colors.error : t >= 70 ? colors.pending : normal;

    // History lines first, under the readings.
    const box = { x: 0, y: s * 0.7, w: s, h: s * 0.3 };
    sparkline(ctx, gpuTemp, box, { min: 30, max: 100, color: heat(gpu, colors.dim) });
    sparkline(ctx, cpuTemp, box, { min: 30, max: 100, color: heat(cpu, colors.accent) });

    text(ctx, 'TEMP', s / 2, s * 0.13, { size: 11, maxWidth: s - 8, color: colors.dim });
    if (cpu === undefined && gpu === undefined) {
      text(ctx, this.stats.problem ?? '—', s / 2, s * 0.42, { size: 13, maxWidth: s - 8 });
      return;
    }
    const deg = (t: number | undefined) => (t === undefined ? '—' : `${Math.round(t)}°`);
    reading(ctx, s, 'CPU', deg(cpu), heat(cpu, colors.text), s * 0.35);
    reading(ctx, s, 'GPU', deg(gpu), heat(gpu, colors.text), s * 0.57);
  }
}

/**
 * CPU usage and RAM in use on one key, each with its own history line. CPU
 * turns red above 80%; RAM amber above 85% and red above 95%.
 */
export class LoadKey extends SystemWidget {
  #cpu: number[] = [];
  #prev = cpuTimes();
  #timer: NodeJS.Timeout | undefined;

  mount(): void {
    super.mount();
    this.#timer = setInterval(() => {
      const next = cpuTimes();
      const total = next.total - this.#prev.total;
      const idle = next.idle - this.#prev.idle;
      this.#prev = next;
      this.#cpu.push(total ? 100 * (1 - idle / total) : 0);
      if (this.#cpu.length > 48) this.#cpu.shift();
      this.invalidate();
    }, 500);
  }

  unmount(): void {
    clearInterval(this.#timer);
    super.unmount();
  }

  render(ctx: SKRSContext2D, s: number): void {
    roundedFill(ctx, s, colors.bg);
    const cpu = this.#cpu.at(-1);
    const sample = this.stats.latest;
    const ram = sample && Number.isFinite(sample.ramUsed) ? (sample.ramUsed / sample.ramTotal) * 100 : undefined;
    const cpuColor = cpu !== undefined && cpu > 80 ? colors.error : colors.accent;
    const ramColor = ram === undefined ? colors.dim : ram >= 95 ? colors.error : ram >= 85 ? colors.pending : colors.dim;

    const box = { x: 0, y: s * 0.7, w: s, h: s * 0.3 };
    sparkline(ctx, this.stats.history.ram, box, { min: 0, max: 100, color: ramColor });
    sparkline(ctx, this.#cpu, box, { min: 0, max: 100, color: cpuColor });

    text(ctx, 'LOAD', s / 2, s * 0.13, { size: 11, maxWidth: s - 8, color: colors.dim });
    reading(ctx, s, 'CPU', cpu === undefined ? '—' : `${Math.round(cpu)}%`, cpu !== undefined && cpu > 80 ? colors.error : colors.text, s * 0.35);
    const gb = sample && Number.isFinite(sample.ramUsed) ? `${Math.round(sample.ramUsed / 2 ** 30)}G` : (this.stats.problem ?? '—');
    reading(ctx, s, 'RAM', gb, ram !== undefined && ram >= 85 ? ramColor : colors.text, s * 0.57);
  }
}

/**
 * Fans: hold to toggle Macs Fan Control between Automatic and Full blast. A
 * red action key, since full-blast fans are loud in the room. Shows the
 * app's active preset and the live fan speed.
 */
export class FanKey extends SystemWidget {
  #fans: FanControl;
  #hold: Hold;
  #unsubscribeFans: (() => void) | undefined;

  constructor(stats: SystemStats, fans: FanControl) {
    super(stats);
    this.#fans = fans;
    this.#hold = new Hold(1000, () => void fans.toggle(), () => this.invalidate());
  }

  mount(): void {
    super.mount();
    this.#unsubscribeFans = this.#fans.subscribe(() => this.invalidate());
  }

  unmount(): void {
    this.#hold.cancel();
    this.#unsubscribeFans?.();
    super.unmount();
  }

  onDown(): void {
    if (!this.#fans.busy) this.#hold.start();
  }

  onUp(): void {
    this.#hold.release();
  }

  render(ctx: SKRSContext2D, s: number): void {
    const { busy, preset } = this.#fans;
    const full = preset === 'Full blast';
    const fans = this.stats.latest?.fans ?? [];
    const rpm = fans.length ? Math.round(fans.reduce((n, f) => n + f.rpm, 0) / fans.length) : undefined;

    if (busy) roundedFill(ctx, s, colors.pending);
    else keyFace(ctx, s, 'action', full);
    const lit = busy || full;
    text(ctx, 'FANS', s / 2, s * 0.2, { size: 12, maxWidth: s - 8, color: lit ? '#000' : colors.dim });
    const label = busy ? (full ? 'AUTO…' : 'FULL…') : this.#hold.hinting ? 'HOLD' : preset === undefined ? '?' : full ? 'FULL' : 'AUTO';
    text(ctx, label, s / 2, s * 0.46, { size: 22, maxWidth: s - 10, color: lit ? '#000' : colors.text });
    text(ctx, rpm === undefined ? (this.stats.problem ?? '—') : `${rpm} rpm`, s / 2, s * 0.7, {
      size: 11,
      maxWidth: s - 10,
      weight: 'normal',
      color: lit ? '#000' : colors.dim,
    });
    const progress = this.#hold.progress;
    if (progress !== undefined) drawHoldBar(ctx, s, progress, full ? '#fff' : colors.text);
  }
}
