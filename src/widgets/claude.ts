import type { SKRSContext2D } from '@napi-rs/canvas';
import { Widget } from '../widget.ts';
import { colors, roundedFill, text } from '../draw.ts';
import type { ClaudeSessions } from '../claude.ts';

export const CLAUDE_COLOR = '#e8901c';

/**
 * How many Claude Code sessions are waiting on you, with the longest-waiting
 * one's project and how long it's waited. Press to jump to that session's
 * terminal tab; press again to step through the others.
 */
export class ClaudeKey extends Widget {
  #claude: ClaudeSessions;
  #unsubscribe: (() => void) | undefined;
  #timer: NodeJS.Timeout | undefined;

  constructor(claude: ClaudeSessions) {
    super();
    this.#claude = claude;
  }

  mount(): void {
    this.#unsubscribe = this.#claude.subscribe(() => this.invalidate());
    // Keep the "waited Nm" time current.
    this.#timer = setInterval(() => this.#claude.waiting.length && this.invalidate(), 15_000);
  }

  unmount(): void {
    this.#unsubscribe?.();
    clearInterval(this.#timer);
  }

  onDown(): void {
    this.#claude.focusNext();
  }

  render(ctx: SKRSContext2D, s: number): void {
    const waiting = this.#claude.waiting;
    if (waiting.length) {
      const oldest = waiting[0];
      roundedFill(ctx, s, CLAUDE_COLOR);
      // Count, then which project has waited longest (the one a press jumps to).
      text(ctx, 'CLAUDE', s / 2, s * 0.17, { size: 13, maxWidth: s - 14, color: '#000' });
      text(ctx, String(waiting.length), s / 2, s * 0.4, { size: 22, maxWidth: s - 14, color: '#000' });
      text(ctx, oldest.project || '?', s / 2, s * 0.63, { size: 14, maxWidth: s - 12, color: '#000' });
      text(ctx, `waiting ${ago(oldest.since).replace(/^for /, '')}`, s / 2, s * 0.83, {
        size: 11,
        maxWidth: s - 12,
        weight: 'normal',
        color: '#000',
      });
      return;
    }

    roundedFill(ctx, s, colors.bg);
    const working = this.#claude.working.length;
    text(ctx, 'CLAUDE', s / 2, s * 0.38, { size: 18, maxWidth: s - 14, color: working ? colors.text : colors.dim });
    text(ctx, working ? `${working} working` : 'all clear', s / 2, s * 0.64, {
      size: 13,
      maxWidth: s - 14,
      weight: 'normal',
      color: working ? colors.accent : colors.dim,
    });
  }
}

function ago(since: number): string {
  const min = Math.floor((Date.now() - since) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `for ${min}m`;
  return `for ${Math.floor(min / 60)}h ${min % 60}m`;
}

const TERMINAL_NAMES: Record<string, string> = {
  'iTerm.app': 'iTerm',
  Apple_Terminal: 'Terminal',
  ghostty: 'Ghostty',
  WarpTerminal: 'Warp',
  vscode: 'VS Code',
};

/**
 * One Claude Code session, for a page of them: slot N shows the Nth session
 * (waiting first, longest-waiting first, then working, then idle) and is
 * blank when there are fewer sessions. Press to jump to its terminal tab.
 */
export class ClaudeSlot extends Widget {
  #claude: ClaudeSessions;
  #slot: number;
  #unsubscribe: (() => void) | undefined;
  #timer: NodeJS.Timeout | undefined;

  constructor(claude: ClaudeSessions, slot: number) {
    super();
    this.#claude = claude;
    this.#slot = slot;
  }

  mount(): void {
    this.#unsubscribe = this.#claude.subscribe(() => this.invalidate());
    this.#timer = setInterval(() => this.#session() && this.invalidate(), 15_000);
  }

  unmount(): void {
    this.#unsubscribe?.();
    clearInterval(this.#timer);
  }

  onDown(): void {
    const session = this.#session();
    if (session) this.#claude.focus(session);
  }

  #session() {
    return this.#claude.all[this.#slot];
  }

  render(ctx: SKRSContext2D, s: number): void {
    const session = this.#session();
    if (!session) return;

    const waiting = session.state === 'waiting';
    const ink = waiting ? '#000' : colors.text;
    roundedFill(ctx, s, waiting ? CLAUDE_COLOR : colors.bg);
    text(ctx, TERMINAL_NAMES[session.terminal] ?? session.terminal, s / 2, s * 0.18, {
      size: 11,
      maxWidth: s - 14,
      weight: 'normal',
      color: waiting ? '#000' : colors.dim,
    });
    text(ctx, session.project || '?', s / 2, s * 0.46, { size: 17, maxWidth: s - 12, color: session.state === 'idle' ? colors.dim : ink });
    const status = waiting ? `waiting ${ago(session.since).replace(/^for /, '')}` : session.state;
    text(ctx, status, s / 2, s * 0.74, {
      size: 12,
      maxWidth: s - 12,
      weight: 'normal',
      color: waiting ? '#000' : session.state === 'working' ? colors.accent : colors.dim,
    });
  }
}
