import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import type { SKRSContext2D } from '@napi-rs/canvas';
import { Widget } from '../widget.ts';
import { colors, roundedFill, text } from '../draw.ts';

const run = promisify(execFile);
const DELL_INPUT = `${homedir()}/.local/bin/dell-input`;

export type MonitorInput = 'dp' | 'tb' | 'hdmi';

/** VCP 0x60 values, matching dell-input. */
const INPUT_VALUES: Record<number, MonitorInput> = { 15: 'dp', 25: 'tb', 17: 'hdmi' };

export const INPUT_LABELS: Record<MonitorInput, string> = { dp: 'DP', tb: 'TB', hdmi: 'HDMI' };

/**
 * State for one monitor, shared by its keys. Wraps dell-input: `set` switches
 * input, and a poll keeps the deck in sync if it's switched from elsewhere.
 * When the monitor can't be queried (e.g. it isn't on this Mac), the last
 * input set from the deck is kept and `reachable` goes false.
 */
export class Monitor {
  readonly id: 1 | 2;
  current: MonitorInput | undefined;
  pending: MonitorInput | undefined;
  reachable = true;
  lastError: string | undefined;

  #listeners = new Set<() => void>();
  #poll: NodeJS.Timeout | undefined;

  constructor(id: 1 | 2) {
    this.id = id;
  }

  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  startPolling(intervalMs = 3000): void {
    void this.refresh();
    this.#poll = setInterval(() => void this.refresh(), intervalMs);
  }

  stopPolling(): void {
    clearInterval(this.#poll);
  }

  async refresh(): Promise<void> {
    if (this.pending) return;
    try {
      const { stdout } = await run(DELL_INPUT, [String(this.id), 'get'], { timeout: 5000 });
      const input = INPUT_VALUES[Number(stdout.trim())];
      this.#update({ current: input ?? this.current, reachable: true, lastError: undefined });
    } catch {
      this.#update({ reachable: false });
    }
  }

  async set(input: MonitorInput): Promise<void> {
    if (this.pending) return;
    this.#update({ pending: input });
    try {
      await run(DELL_INPUT, [String(this.id), input], { timeout: 10000 });
      this.#update({ current: input, pending: undefined, lastError: undefined });
    } catch (err) {
      const message = (err as { stderr?: string }).stderr?.trim() || String(err);
      console.error(`mon${this.id} → ${input} failed: ${message}`);
      this.#update({ pending: undefined, lastError: message });
    }
  }

  async toggle(): Promise<void> {
    await this.set(this.current === 'dp' ? 'tb' : 'dp');
  }

  #update(patch: Partial<Pick<Monitor, 'current' | 'pending' | 'reachable' | 'lastError'>>): void {
    Object.assign(this, patch);
    for (const fn of this.#listeners) fn();
  }
}

abstract class MonitorWidget extends Widget {
  protected monitor: Monitor;
  #unsubscribe: (() => void) | undefined;

  constructor(monitor: Monitor) {
    super();
    this.monitor = monitor;
  }

  mount(): void {
    this.#unsubscribe = this.monitor.subscribe(() => this.invalidate());
  }

  unmount(): void {
    this.#unsubscribe?.();
  }
}

/** "MON 1" key showing the current input. Press to toggle DP ↔ TB. */
export class MonitorHeader extends MonitorWidget {
  onDown(): void {
    void this.monitor.toggle();
  }

  render(ctx: SKRSContext2D, s: number): void {
    const m = this.monitor;
    roundedFill(ctx, s, m.lastError ? '#3a1214' : colors.bg);
    text(ctx, `MON ${m.id}`, s / 2, s * 0.36, { size: 24, maxWidth: s - 16 });
    const state = m.pending ? '…' : m.current ? INPUT_LABELS[m.current] : '—';
    const color = m.pending ? colors.pending : m.reachable ? colors.active : colors.dim;
    text(ctx, state, s / 2, s * 0.68, { size: 22, maxWidth: s - 16, color });
    if (!m.reachable) text(ctx, 'no DDC', s / 2, s * 0.88, { size: 11, maxWidth: s - 16, color: colors.dim, weight: 'normal' });
  }
}

/** One input button, lit when it's the monitor's current input. */
export class MonitorInputButton extends MonitorWidget {
  #input: MonitorInput;

  constructor(monitor: Monitor, input: MonitorInput) {
    super(monitor);
    this.#input = input;
  }

  onDown(): void {
    void this.monitor.set(this.#input);
  }

  render(ctx: SKRSContext2D, s: number): void {
    const m = this.monitor;
    const isPending = m.pending === this.#input;
    const isCurrent = !m.pending && m.current === this.#input;
    const fill = isPending ? colors.pending : isCurrent ? (m.reachable ? colors.active : '#2f5e3d') : colors.bg;
    roundedFill(ctx, s, fill);
    text(ctx, INPUT_LABELS[this.#input], s / 2, s * 0.42, { size: 28, maxWidth: s - 16, color: isCurrent || isPending ? '#000' : colors.text });
    text(ctx, `mon${m.id}${({ dp: 1, tb: 2, hdmi: 3 })[this.#input]}`, s / 2, s * 0.72, {
      size: 13,
      maxWidth: s - 16,
      weight: 'normal',
      color: isCurrent || isPending ? '#000' : colors.dim,
    });
  }
}
