import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { LinkOptions } from './widgets/link.ts';

/** Where a button goes: a page and its [row, column]. */
export interface Placement {
  page: string;
  at: [row: number, column: number];
}

export type LinkConfig = Placement & LinkOptions & ({ url: string } | { app: string });

export interface EndOfDayConfig extends Placement {
  url: string;
  /** Who the run is recorded as started by. */
  name: string;
}

/** A Lilliput monitor on the LAN (see lilliput.ts). */
export interface LilliputConfig {
  ip: string;
  /** The monitor's on-screen label text, resent with every tally change. */
  label?: string;
}

/** A person's tally monitor: their name goes on the deck's tally keys. */
export interface PersonTallyConfig extends LilliputConfig {
  name: string;
}

/** The show's TouchDesigner HTTP API (see tdapi.ts). */
export interface TdApiConfig {
  host: string;
  port: number;
  /** Sent as a Bearer token. */
  apiKey: string;
}

/**
 * The show machine's OSC listener HTTP API (see oscrec.ts): its OSC recorder,
 * and the timecode Greenalyzer page it relays record commands to.
 */
export interface OscRecorderConfig {
  host: string;
  port: number;
}

/**
 * Personal buttons (your own sites, apps and machines) live in local,
 * git-ignored files so they never end up in the public repo: one per setup
 * you switch between (the Config page on the deck), as configs/<name>.json.
 * configs/default.json is used when nothing else has been picked. See
 * greendeck.example.json.
 */
export interface LocalConfig {
  links?: LinkConfig[];
  endOfDay?: EndOfDayConfig;
  /**
   * The Monitors page's SDI monitor, and the people whose tally monitors get
   * red / green keys on its bottom row (up to three, in order).
   */
  lilliput?: { sdi?: LilliputConfig; people?: PersonTallyConfig[] };
  /** When set, the REC key drives this TD instead of the local greendeck.tox link. */
  td?: TdApiConfig;
  /** When set, Main gets OSC REC and TC REC keys above REC. */
  oscRecorder?: OscRecorderConfig;
  /**
   * Which themes the Themes page offers, by id: `hide` drops built-in ones,
   * `add` brings in optional ones (like "eagles").
   */
  themes?: { hide?: string[]; add?: string[] };
}

const ROOT = new URL('../', import.meta.url);
const DIR = new URL('configs/', ROOT);
export const DEFAULT_CONFIG = 'default';
/** Remembers which config was picked last, so a restart comes back to it. */
const ACTIVE_FILE = new URL('active.txt', DIR);

function configFile(name: string): string {
  return `configs/${name}.json`;
}

/** The configs there are files for, "default" first, then by name. */
export function configNames(): string[] {
  let files: string[] = [];
  try {
    files = readdirSync(DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error('configs:', (err as Error).message);
  }
  const names = files.flatMap((f) => (f.endsWith('.json') && !f.startsWith('.') ? [f.slice(0, -'.json'.length)] : []));
  return names.sort((a, b) => (a === DEFAULT_CONFIG ? -1 : b === DEFAULT_CONFIG ? 1 : a.localeCompare(b)));
}

/** A config's settings; a missing or broken file gives an empty config. */
export function loadLocalConfig(name = DEFAULT_CONFIG): LocalConfig {
  const file = configFile(name);
  try {
    return JSON.parse(readFileSync(new URL(file, ROOT), 'utf8')) as LocalConfig;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`${file}:`, (err as Error).message);
    return {};
  }
}

/** The config picked last time, if any. */
export function savedConfigName(): string | undefined {
  try {
    return readFileSync(ACTIVE_FILE, 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}

export function saveConfigName(name: string): void {
  try {
    writeFileSync(ACTIVE_FILE, `${name}\n`);
  } catch (err) {
    console.error('configs/active.txt:', (err as Error).message);
  }
}

/**
 * The config in use, and whatever is built from it (monitors, recorders, ...).
 * Switching stops what the old config built before building the new one;
 * subscribers then rebuild their layouts.
 */
export class Configs<T extends { stop(): void }> {
  #build: (local: LocalConfig) => T;
  #name: string;
  #local: LocalConfig;
  #current: T;
  #listeners = new Set<() => void>();

  /** Starts on `initial` (e.g. from GREENDECK_CONFIG), else the one picked last. */
  constructor(build: (local: LocalConfig) => T, initial?: string) {
    this.#build = build;
    const names = configNames();
    const wanted = initial || savedConfigName();
    if (initial && !names.includes(initial)) console.error(`no ${configFile(initial)}; using the ${this.#fallback(names)} config`);
    this.#name = wanted && names.includes(wanted) ? wanted : this.#fallback(names);
    this.#local = loadLocalConfig(this.#name);
    this.#current = build(this.#local);
    console.log(`config: ${this.#name}`);
  }

  get name(): string {
    return this.#name;
  }

  /** Read fresh each time, so a config file added while running shows up. */
  get names(): string[] {
    return configNames();
  }

  get local(): LocalConfig {
    return this.#local;
  }

  get current(): T {
    return this.#current;
  }

  /** Switch to a config. Switching to the one in use reloads its file. */
  switch(name: string): void {
    if (!this.names.includes(name)) return;
    this.#current.stop();
    this.#name = name;
    this.#local = loadLocalConfig(name);
    this.#current = this.#build(this.#local);
    saveConfigName(name);
    console.log(`config: ${name}`);
    for (const fn of this.#listeners) fn();
  }

  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #fallback(names: string[]): string {
    return names.includes(DEFAULT_CONFIG) ? DEFAULT_CONFIG : (names[0] ?? DEFAULT_CONFIG);
  }
}
