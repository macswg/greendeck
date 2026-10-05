import { execFile } from 'node:child_process';
import { loadImage, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import { Widget } from '../widget.ts';
import { colors, keyFace, roundedFill, text } from '../draw.ts';
import { drawHoldBar, Hold } from '../hold.ts';

type PageState = 'idle' | 'running' | 'done' | 'failed';

interface Step {
  name: string;
  sha256: string;
  seen: 'ran' | 'new' | 'changed';
}

interface Status {
  now: string;
  recent_hours: number;
  current: { by: string; steps: { status: string }[] } | null;
  last: { id: number; status: string; finished_at: string } | null;
  transfer: { run_id: number; state: string; finished_at?: string } | null;
  steps: Step[];
}

/**
 * The End of Day page's button, on the deck. Tap to open the page; hold to
 * run the end of day sequence the way the page's own confirm button does
 * (POST /api/run with the step checksums it was shown, so the server refuses
 * if a script changed in between). Won't run from the deck if a step is new
 * or changed since it last ran: the page asks you to look at those first, so
 * the key says CHECK PAGE instead. Shows the page's own state icon.
 */
export class EndOfDayButton extends Widget {
  #url: string;
  #name: string;
  #status: Status | undefined;
  #offline = false;
  #message: string | undefined;
  #messageUntil = 0;
  #icons = new Map<PageState, Image>();
  #timer: NodeJS.Timeout | undefined;
  #hold: Hold;
  #starting = false;

  constructor(url: string, opts: { name: string }) {
    super();
    this.#url = url.endsWith('/') ? url : `${url}/`;
    this.#name = opts.name;
    this.#hold = new Hold(
      1000,
      () => {
        this.#holdFired = true;
        void this.#run();
      },
      () => this.invalidate(),
    );
    void this.#loadIcons();
  }

  mount(): void {
    void this.#poll();
  }

  unmount(): void {
    clearTimeout(this.#timer);
    this.#hold.cancel();
  }

  #pressedAt = 0;
  #holdFired = false;

  onDown(): void {
    this.#pressedAt = performance.now();
    this.#holdFired = false;
    if (this.#canRun()) this.#hold.start();
  }

  onUp(): void {
    if (this.#holdFired) return;
    const holding = this.#hold.progress !== undefined;
    const quickTap = performance.now() - this.#pressedAt < 400;
    this.#hold.cancel();
    // A tap opens the page (so does any press when it can't run from here);
    // a hold let go before it finished just cancels.
    if (!holding || quickTap) this.#open();
    else this.#flash('HOLD');
  }

  #open(): void {
    execFile('open', [this.#url], (err) => err && console.error(`open ${this.#url}:`, err.message));
  }

  get #state(): PageState {
    const s = this.#status;
    if (!s) return 'idle';
    if (s.current) return 'running';
    if (s.last?.status === 'failed') return 'failed';
    const own = !!s.transfer && !!s.last && s.transfer.run_id === s.last.id;
    const transferring = !!s.transfer && (s.transfer.state === 'starting' || s.transfer.state === 'running');
    if (transferring && own) return 'done';
    if (!s.last) return 'idle';
    const end = own && s.transfer?.finished_at ? s.transfer.finished_at : s.last.finished_at;
    const age = new Date(s.now).getTime() - new Date(end).getTime();
    return age < s.recent_hours * 3600e3 ? 'done' : 'idle';
  }

  /** New or changed steps: the page wants a look at those before running. */
  get #needsReview(): boolean {
    return !!this.#status?.steps.some((st) => st.seen !== 'ran');
  }

  #canRun(): boolean {
    return !!this.#status && !this.#offline && !this.#starting && this.#state !== 'running' && this.#status.steps.length > 0 && !this.#needsReview;
  }

  async #poll(): Promise<void> {
    clearTimeout(this.#timer);
    try {
      const res = await fetch(new URL('api/status', this.#url), { signal: AbortSignal.timeout(5000), cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.#status = (await res.json()) as Status;
      this.#offline = false;
    } catch {
      this.#offline = true;
    }
    this.invalidate();
    this.#timer = setTimeout(() => void this.#poll(), this.#status?.current ? 1000 : 3000);
  }

  async #run(): Promise<void> {
    if (!this.#canRun()) return;
    this.#starting = true;
    this.invalidate();
    try {
      const res = await fetch(new URL('api/run', this.#url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: this.#name, plan: this.#status!.steps.map((st) => st.sha256), only: null }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: { message?: string; current?: unknown; changed?: unknown } };
        this.#flash(res.status === 409 && body.detail?.current ? 'RUNNING' : res.status === 409 ? 'CHECK PAGE' : 'FAILED');
        console.error(`end of day: run refused (${res.status}):`, body.detail?.message ?? '');
      }
    } catch (err) {
      this.#flash('NO REPLY');
      console.error('end of day:', (err as Error).message);
    } finally {
      this.#starting = false;
      void this.#poll();
    }
  }

  #flash(message: string): void {
    this.#message = message;
    this.#messageUntil = performance.now() + 2500;
    setTimeout(() => this.invalidate(), 2600);
  }

  async #loadIcons(): Promise<void> {
    for (const state of ['idle', 'running', 'done', 'failed'] as const) {
      try {
        const res = await fetch(new URL(`icons/${state}.svg`, this.#url), { signal: AbortSignal.timeout(5000) });
        if (!res.ok) continue;
        // Same as LinkButton: drop comments the SVG parser can't take.
        const svg = (await res.text()).replace(/<!--[\s\S]*?-->/g, '');
        this.#icons.set(state, await loadImage(Buffer.from(svg)));
      } catch {
        // No icon for this state; the key still shows its label.
      }
    }
    this.invalidate();
  }

  render(ctx: SKRSContext2D, s: number): void {
    const state = this.#state;
    // A show action: black at rest, red while it runs.
    if (state === 'failed') roundedFill(ctx, s, '#3a1214');
    else keyFace(ctx, s, 'action', state === 'running' || this.#starting);

    const icon = this.#icons.get(state);
    if (icon) ctx.drawImage(icon, s * 0.3, s * 0.1, s * 0.4, s * 0.4);
    const message = performance.now() < this.#messageUntil ? this.#message : undefined;
    const label = this.#offline
      ? 'OFFLINE'
      : message ??
        (this.#starting ? 'STARTING' : state === 'running' ? 'RUNNING' : state === 'done' ? 'DONE' : state === 'failed' ? 'FAILED' : 'EOD');
    text(ctx, label, s / 2, s * 0.64, { size: 14, maxWidth: s - 10 });
    const sub = this.#offline ? 'tap to open' : this.#needsReview ? 'check page' : state === 'running' ? 'in progress' : 'hold to run';
    text(ctx, sub, s / 2, s * 0.82, { size: 10, maxWidth: s - 10, weight: 'normal', color: colors.dim });
    const progress = this.#hold.progress;
    if (progress !== undefined) drawHoldBar(ctx, s, progress);
  }
}
