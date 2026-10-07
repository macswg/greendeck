import { basename } from 'node:path';
import type { PushHub } from './push.ts';
import { focusTerminal } from './terminals.ts';

export type ClaudeState = 'working' | 'waiting' | 'idle';

export interface ClaudeSession {
  id: string;
  state: ClaudeState;
  /** $TERM_PROGRAM of the terminal the session runs in. */
  terminal: string;
  /** iTerm's session id, or '-'. */
  terminalSession: string;
  /** The claude process, or 0 when the hook couldn't find it. */
  pid: number;
  cwd: string;
  project: string;
  /** When it entered its current state. */
  since: number;
  lastSeen: number;
}

/** Sessions that never reported ending and have no pid to check drop off after this. */
const STALE_MS = 24 * 60 * 60 * 1000;
/** How often to check for sessions whose claude process has gone. */
const SWEEP_MS = 15_000;
/** Presses this close together step to the next session instead of starting over. */
const CYCLE_MS = 10_000;

const STATE_ORDER: Record<ClaudeState, number> = { waiting: 0, working: 1, idle: 2 };

/**
 * Live state of every Claude Code session on this machine, fed by
 * scripts/claude-status.sh running as a Claude Code hook. Survives deck
 * reconnects; starts empty, so sessions appear as soon as they next do something.
 */
export class ClaudeSessions {
  readonly sessions = new Map<string, ClaudeSession>();
  #listeners = new Set<() => void>();
  #cycle = { index: -1, at: 0 };

  constructor(push: PushHub) {
    push.subscribeAll((id, value) => {
      if (!id.startsWith('claude.')) return;
      this.#update(id.slice(7), value);
    });
    setInterval(() => this.#sweep(), SWEEP_MS).unref();
  }

  /** Every session: waiting (longest first), then working, then idle. */
  get all(): ClaudeSession[] {
    return [...this.sessions.values()].sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.since - b.since);
  }

  /** Sessions waiting on you, longest-waiting first. */
  get waiting(): ClaudeSession[] {
    return this.all.filter((s) => s.state === 'waiting');
  }

  get working(): ClaudeSession[] {
    return this.all.filter((s) => s.state === 'working');
  }

  /** Bring a session's own terminal tab to the front. */
  focus(session: ClaudeSession): void {
    if (!alive(session)) return this.#sweep();
    void focusTerminal({ ...session, waiting: session.state === 'waiting' });
  }

  /**
   * Jump to the longest-waiting session; pressing again within a few seconds
   * steps through the rest. With nothing waiting, steps through all sessions.
   */
  focusNext(): void {
    this.#sweep();
    const list = this.waiting.length ? this.waiting : this.all;
    if (!list.length) return;
    const now = Date.now();
    const index = now - this.#cycle.at < CYCLE_MS ? (this.#cycle.index + 1) % list.length : 0;
    this.#cycle = { index, at: now };
    this.focus(list[index]);
  }

  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #update(id: string, value: string): void {
    const [state, terminal = '-', terminalSession = '-', pid = '-', ...cwdParts] = value.split(' ');
    const cwd = cwdParts.join(' ');
    const now = Date.now();
    if (state === 'ended') {
      if (!this.sessions.delete(id)) return;
    } else if (state === 'working' || state === 'waiting' || state === 'idle') {
      const prev = this.sessions.get(id);
      this.sessions.set(id, {
        id,
        state,
        terminal,
        terminalSession,
        pid: Number(pid) || 0,
        cwd,
        project: cwd && cwd !== '-' ? basename(cwd) : '',
        since: prev?.state === state ? prev.since : now,
        lastSeen: now,
      });
      if (prev?.state === state) return;
    } else {
      return;
    }
    for (const fn of this.#listeners) fn();
  }

  /** Drop sessions whose claude process is gone, or that went quiet a day ago. */
  #sweep(): void {
    const cutoff = Date.now() - STALE_MS;
    let changed = false;
    for (const [id, s] of this.sessions) {
      if (!alive(s) || s.lastSeen < cutoff) changed = this.sessions.delete(id) || changed;
    }
    if (changed) for (const fn of this.#listeners) fn();
  }
}

/** Whether the session's claude process is still running (true when its pid is unknown). */
function alive({ pid }: ClaudeSession): boolean {
  if (!pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists but isn't ours to signal.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
