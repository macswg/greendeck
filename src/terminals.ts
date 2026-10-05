import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface TerminalTarget {
  /** $TERM_PROGRAM of the terminal the session runs in. */
  terminal: string;
  /** iTerm's $ITERM_SESSION_ID, or '-'. */
  terminalSession: string;
  cwd: string;
  /** Prefer a Ghostty terminal whose title shows Claude Code as idle (✳). */
  waiting: boolean;
}

/** Fallback when the exact tab can't be found: bring the app forward. */
const APPS: Record<string, string> = {
  'iTerm.app': 'iTerm',
  Apple_Terminal: 'Terminal',
  ghostty: 'Ghostty',
  WezTerm: 'WezTerm',
  WarpTerminal: 'Warp',
  vscode: 'Visual Studio Code',
};

/**
 * Bring a specific terminal tab/split to the front: the one a Claude Code
 * session is running in. Exact for iTerm (by session id) and Ghostty (by
 * working directory and title); other terminals just get their app activated.
 */
export async function focusTerminal(target: TerminalTarget): Promise<void> {
  try {
    if (target.terminal === 'iTerm.app' && (await focusITerm(target))) return;
    if (target.terminal === 'ghostty' && (await focusGhostty(target))) return;
  } catch (err) {
    console.error('focus terminal:', (err as Error).message);
  }
  const app = APPS[target.terminal];
  console.log(`focus terminal: no exact ${target.terminal} tab found for ${target.cwd}${app ? `, opening ${app}` : ''}`);
  if (app) await run('open', ['-a', app]).catch((err) => console.error(`open ${app}:`, err.message));
}

const ITERM_FOCUS = `
on run argv
  set target to item 1 of argv
  tell application "iTerm2"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if unique id of s is target then
            tell w to select
            tell t to select
            tell s to select
            activate
            return "ok"
          end if
        end repeat
      end repeat
    end repeat
  end tell
  return "missing"
end run`;

async function focusITerm({ terminalSession }: TerminalTarget): Promise<boolean> {
  // $ITERM_SESSION_ID is "w0t1p0:<uuid>"; AppleScript knows sessions by the uuid.
  const uuid = terminalSession.split(':').pop() ?? '';
  if (!/^[0-9A-F-]{36}$/i.test(uuid)) return false;
  const { stdout } = await run('osascript', ['-e', ITERM_FOCUS, uuid]);
  return stdout.trim() === 'ok';
}

// Inside Ghostty's tell block \`tab\` means its tab class, not the character,
// so take the separator from outside it.
const GHOSTTY_LIST = `
set sep to character id 9
tell application "Ghostty"
  set out to ""
  repeat with t in terminals
    set out to out & (id of t) & sep & (working directory of t) & sep & (name of t) & linefeed
  end repeat
  return out
end tell`;

// \`focus\` alone moves keyboard focus within a tab but doesn't switch to it,
// so find the terminal's window and tab and bring those forward first.
const GHOSTTY_FOCUS = `
on run argv
  set target to item 1 of argv
  tell application "Ghostty"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with term in terminals of t
          if id of term is target then
            activate window w
            select tab t
            focus term
            activate
            return "ok"
          end if
        end repeat
      end repeat
    end repeat
  end tell
  return "missing"
end run`;

async function focusGhostty({ cwd, waiting }: TerminalTarget): Promise<boolean> {
  // Ghostty doesn't give the session a terminal id, so match on working
  // directory. Claude Code prefixes its terminal title with a status symbol
  // (✳ when idle, a spinner while working), which picks Claude's terminal
  // over a plain shell in the same directory.
  const { stdout } = await run('osascript', ['-e', GHOSTTY_LIST]);
  let best: { id: string; score: number } | undefined;
  for (const line of stdout.split('\n')) {
    const [id, dir, name = ''] = line.split('\t');
    if (!id || dir !== cwd) continue;
    const claudeTitle = /^[^\x00-\x7F]/.test(name);
    const score = 1 + (claudeTitle ? 2 : 0) + (claudeTitle && waiting === name.startsWith('✳') ? 1 : 0);
    if (!best || score > best.score) best = { id, score };
  }
  if (!best) return false;
  const result = await run('osascript', ['-e', GHOSTTY_FOCUS, best.id]);
  return result.stdout.trim() === 'ok';
}
