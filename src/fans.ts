import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { promisify } from 'node:util';

const run = promisify(execFile);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type FanPreset = 'Automatic' | 'Full blast';

const DOMAIN = 'com.crystalidea.macsfancontrol';
const PROCESS = 'Macs Fan Control';
/** Macs Fan Control's built-in presets, as stored in its ActivePreset setting. */
const PRESET_IDS: Record<FanPreset, string> = { Automatic: 'Predefined:0', 'Full blast': 'Predefined:1' };

function appPath(): string | undefined {
  return [`${homedir()}/Applications/Macs Fan Control.app`, '/Applications/Macs Fan Control.app'].find((p) => existsSync(p));
}

/** The preset Macs Fan Control has saved as active. */
export async function readFanPreset(): Promise<FanPreset | undefined> {
  const { stdout } = await run('defaults', ['read', DOMAIN, 'ActivePreset']);
  const id = stdout.trim();
  return (Object.keys(PRESET_IDS) as FanPreset[]).find((p) => PRESET_IDS[p] === id);
}

/**
 * Switch Macs Fan Control's preset without touching its UI. It has no
 * scripting interface and ignores quit requests, so: stop it, write the
 * preset into its settings, and relaunch it with /minimized (its own
 * start-in-the-menu-bar flag, so no window appears); it applies the saved
 * preset on start. The fans fall back to macOS control for about a second.
 */
export async function setFanPreset(preset: FanPreset): Promise<void> {
  const app = appPath();
  if (!app) throw new Error('Macs Fan Control not found');
  await run('pkill', ['-TERM', '-x', PROCESS]).catch(() => {});
  for (let i = 0; i < 30; i++) {
    const running = await run('pgrep', ['-x', PROCESS]).then(() => true, () => false);
    if (!running) break;
    if (i === 29) throw new Error('Macs Fan Control did not quit');
    await sleep(100);
  }
  await run('defaults', ['write', DOMAIN, 'ActivePreset', PRESET_IDS[preset]]);
  await run('open', ['-g', '-j', app, '--args', '/minimized']);
}

/**
 * Current fan preset and switching, shared by every fan key. The preset is
 * read from Macs Fan Control's settings (polled, so changes made in the app
 * show up too); switches run one at a time.
 */
export class FanControl {
  preset: FanPreset | undefined;
  busy = false;
  #listeners = new Set<() => void>();

  start(pollMs = 5000): void {
    void this.#poll();
    setInterval(() => void this.#poll(), pollMs).unref();
  }

  async toggle(): Promise<void> {
    if (this.busy) return;
    const target: FanPreset = this.preset === 'Full blast' ? 'Automatic' : 'Full blast';
    this.busy = true;
    this.#notify();
    try {
      await setFanPreset(target);
      this.preset = target;
    } catch (err) {
      console.error('fans:', (err as Error).message);
      await this.#poll();
    } finally {
      this.busy = false;
      this.#notify();
    }
  }

  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  async #poll(): Promise<void> {
    if (this.busy) return;
    const preset = await readFanPreset().catch(() => undefined);
    if (preset !== this.preset) {
      this.preset = preset;
      this.#notify();
    }
  }

  #notify(): void {
    for (const fn of this.#listeners) fn();
  }
}
