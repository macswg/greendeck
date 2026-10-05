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

/**
 * Personal buttons (your own sites, apps and machines) live in a local,
 * git-ignored file so they never end up in the public repo:
 * greendeck.local.json next to package.json. See greendeck.example.json.
 */
export interface LocalConfig {
  links?: LinkConfig[];
  endOfDay?: EndOfDayConfig;
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
