import { readFileSync } from 'node:fs';
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
 * Personal buttons (your own sites, apps and machines) live in a local,
 * git-ignored file so they never end up in the public repo:
 * greendeck.local.json next to package.json. See greendeck.example.json.
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
  /** When set, Main gets OSC REC and TC REC keys above REC and CACHE REC. */
  oscRecorder?: OscRecorderConfig;
}

export function loadLocalConfig(): LocalConfig {
  const file = new URL('../greendeck.local.json', import.meta.url);
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as LocalConfig;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error('greendeck.local.json:', (err as Error).message);
    return {};
  }
}
