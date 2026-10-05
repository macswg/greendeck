import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * What's running: package.json's version plus the git commit, marked
 * "modified" when there are uncommitted changes. Shown at the bottom of the
 * browser deck, so you can tell at a glance whether a phone has the latest.
 */
export function versionString(): string {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  try {
    const cwd = new URL('..', import.meta.url).pathname;
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd, encoding: 'utf8' }).trim() !== '';
    return `v${version} · ${sha}${dirty ? ' · modified' : ''}`;
  } catch {
    return `v${version}`;
  }
}
