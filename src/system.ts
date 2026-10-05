import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface SystemSample {
  cpuTemp: number;
  gpuTemp: number;
  ramUsed: number;
  ramTotal: number;
  swapUsed: number;
  fans: { rpm: number; maxRpm: number }[];
}

const HISTORY = 48;

/**
 * Temperatures and memory for the deck, from macmon (`brew install macmon`),
 * which reads Apple Silicon sensors without sudo. One macmon process streams
 * a JSON sample a second for every key that shows these; it's restarted if it
 * exits.
 */
export class SystemStats {
  latest: SystemSample | undefined;
  readonly history = { cpuTemp: [] as number[], gpuTemp: [] as number[], ram: [] as number[] };
  /** Why there's no data, if there isn't (e.g. macmon not installed). */
  problem: string | undefined;

  #intervalMs: number;
  #child: ChildProcess | undefined;
  #listeners = new Set<() => void>();
  #stopped = false;

  constructor(opts: { intervalMs?: number } = {}) {
    this.#intervalMs = opts.intervalMs ?? 1000;
  }

  start(): void {
    this.#stopped = false;
    const child = spawn('macmon', ['pipe', '-i', String(this.#intervalMs)], { stdio: ['ignore', 'pipe', 'ignore'] });
    this.#child = child;
    child.on('error', (err) => {
      this.problem = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'no macmon' : 'macmon failed';
      if (this.problem === 'no macmon') console.error('system stats: macmon not found (brew install macmon)');
      this.#notify();
    });
    child.on('exit', () => {
      if (this.#stopped || this.problem === 'no macmon') return;
      setTimeout(() => this.start(), 5000);
    });
    createInterface({ input: child.stdout! }).on('line', (line) => this.#parse(line));
  }

  stop(): void {
    this.#stopped = true;
    this.#child?.kill();
  }

  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #parse(line: string): void {
    let raw: {
      temp?: { cpu_temp_avg?: number; gpu_temp_avg?: number };
      memory?: Record<string, number>;
      fans?: { rpm?: number; max_rpm?: number }[];
    };
    try {
      raw = JSON.parse(line);
    } catch {
      return;
    }
    const mem = raw.memory ?? {};
    const sample: SystemSample = {
      cpuTemp: raw.temp?.cpu_temp_avg ?? NaN,
      gpuTemp: raw.temp?.gpu_temp_avg ?? NaN,
      ramUsed: mem.ram_usage ?? NaN,
      ramTotal: mem.ram_total ?? NaN,
      swapUsed: mem.swap_usage ?? 0,
      fans: (raw.fans ?? []).map((f) => ({ rpm: f.rpm ?? 0, maxRpm: f.max_rpm ?? 0 })),
    };
    this.latest = sample;
    this.problem = undefined;
    push(this.history.cpuTemp, sample.cpuTemp);
    push(this.history.gpuTemp, sample.gpuTemp);
    push(this.history.ram, (sample.ramUsed / sample.ramTotal) * 100);
    this.#notify();
  }

  #notify(): void {
    for (const fn of this.#listeners) fn();
  }
}

function push(list: number[], value: number): void {
  if (!Number.isFinite(value)) return;
  list.push(value);
  if (list.length > HISTORY) list.shift();
}
