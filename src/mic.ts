import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';

const run = promisify(execFile);
const SOURCE = new URL('../scripts/mic-level.swift', import.meta.url).pathname;
const BINARY = new URL('../dist/mic-level', import.meta.url).pathname;

/**
 * The default microphone's level, for meters on the deck. A small Swift
 * helper (scripts/mic-level.swift, compiled into dist/ on first use) streams
 * readings; it only runs while something is subscribed, so the mic is off
 * whenever no meter is on screen.
 */
export class MicLevel {
  /** Smoothed level in dB full scale, about -60 (silence) to 0. */
  db = -Infinity;
  /** Recent peak in dB, held briefly and then falling, like a meter's peak light. */
  peakDb = -Infinity;
  /** Why there's no reading, if there isn't. */
  problem: string | undefined;
  /** Added to every reading, so a quiet mic can fill the meter. */
  gainDb = 0;
  static readonly GAIN_STEP = 3;
  static readonly GAIN_MIN = -12;
  static readonly GAIN_MAX = 36;

  #child: ChildProcess | undefined;
  #listeners = new Set<() => void>();
  #peakAt = 0;
  #starting = false;
  #gainListeners = new Set<() => void>();

  /** Called on every reading (~50 a second). Starts the mic on the first subscriber. */
  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn);
    if (this.#listeners.size === 1) void this.#start();
    return () => {
      this.#listeners.delete(fn);
      if (this.#listeners.size === 0) this.#stop();
    };
  }

  /** Nudge the gain up (+1) or down (-1) a step, within limits. */
  adjustGain(dir: 1 | -1): void {
    const next = Math.min(MicLevel.GAIN_MAX, Math.max(MicLevel.GAIN_MIN, this.gainDb + dir * MicLevel.GAIN_STEP));
    if (next === this.gainDb) return;
    this.gainDb = next;
    for (const fn of this.#gainListeners) fn();
  }

  /** Called when the gain changes. Doesn't start the mic. */
  subscribeGain(fn: () => void): () => void {
    this.#gainListeners.add(fn);
    return () => this.#gainListeners.delete(fn);
  }

  async #start(): Promise<void> {
    if (this.#child || this.#starting) return;
    this.#starting = true;
    try {
      await compile();
    } catch (err) {
      this.problem = 'no swiftc';
      console.error('mic: could not build the helper:', (err as Error).message);
      this.#notify();
      return;
    } finally {
      this.#starting = false;
    }
    // Everyone left while it was compiling.
    if (this.#listeners.size === 0) return;

    const child = spawn(BINARY, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.#child = child;
    child.stderr!.on('data', (d) => console.error(String(d).trim()));
    child.on('exit', (code) => {
      if (this.#child !== child) return;
      this.#child = undefined;
      if (code) {
        this.problem = 'no mic';
        this.#notify();
      }
    });
    createInterface({ input: child.stdout! }).on('line', (line) => this.#reading(line));
  }

  #stop(): void {
    this.#child?.kill();
    this.#child = undefined;
    this.db = this.peakDb = -Infinity;
  }

  #reading(line: string): void {
    const [rms, peak] = line.split(' ').map(Number);
    if (!Number.isFinite(rms)) return;
    const now = performance.now();
    const gain = 10 ** (this.gainDb / 20);
    // Fast attack, slower release, so the meter jumps up and eases down.
    const db = toDb(rms * gain);
    this.db = db > this.db ? db : this.db + (db - this.db) * 0.25;
    const peakDb = toDb(peak * gain);
    if (peakDb >= this.peakDb) {
      this.peakDb = peakDb;
      this.#peakAt = now;
    } else if (now - this.#peakAt > 800) {
      this.peakDb = Math.max(peakDb, this.peakDb - 1.5);
    }
    this.problem = undefined;
    this.#notify();
  }

  #notify(): void {
    for (const fn of this.#listeners) fn();
  }
}

/** Linear level to dBFS, from a -60 floor up to 0 (capped there, as gain can push past full scale). */
function toDb(v: number): number {
  return v > 0 ? Math.min(0, Math.max(-60, 20 * Math.log10(v))) : -60;
}

/** Build the helper if it's missing or older than its source. */
async function compile(): Promise<void> {
  const mtime = (p: string) => {
    try {
      return statSync(p).mtimeMs;
    } catch {
      return 0;
    }
  };
  if (mtime(BINARY) >= mtime(SOURCE)) return;
  mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
  console.log('mic: building the level helper (first run only)…');
  await run('swiftc', ['-O', SOURCE, '-o', BINARY]);
}
