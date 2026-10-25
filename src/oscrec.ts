import type { OscRecorderConfig } from './config.ts';
import type { Recorder } from './widgets/td.ts';

/**
 * A recorder behind an HTTP API on the show machine: a status URL polled every
 * second, and start / stop as POSTs with no body, each followed by an
 * immediate re-poll. Subclasses say where the URLs are and how to read the
 * status.
 */
abstract class HttpRecorder<S> implements Recorder {
  state: S | undefined;
  online = false;
  abstract readonly name: string;

  protected abstract readonly statusPath: string;
  protected abstract readonly startPath: string;
  protected abstract readonly stopPath: string;
  /** Whether the status says a take is running. */
  protected abstract isRecording(state: S): boolean;
  /** Seconds into the take when the recorder reports it; otherwise the deck times it. */
  protected takeSeconds(_state: S): number | undefined {
    return undefined;
  }
  /** Why it can't record right now (shown under the key), if anything. */
  get status(): string | undefined {
    return undefined;
  }

  #base: string;
  #tag: string;
  #listeners = new Set<() => void>();
  #timer: NodeJS.Timeout | undefined;
  #polling = false;
  #last = '';
  /** When this deck first saw the current take running. */
  #since: number | undefined;
  #posts: Promise<void> = Promise.resolve();

  /** `tag` prefixes this recorder's log lines. */
  constructor(config: OscRecorderConfig, tag: string) {
    this.#base = `http://${config.host}:${config.port}`;
    this.#tag = tag;
  }

  get recording(): boolean {
    return this.online && this.state !== undefined && this.isRecording(this.state);
  }

  /**
   * Seconds into the take: the recorder's own count when it has one, else
   * since the deck saw it start (so a take started before greendeck was
   * running reads short).
   */
  get seconds(): number | undefined {
    if (!this.recording) return undefined;
    return this.takeSeconds(this.state!) ?? (this.#since === undefined ? undefined : (performance.now() - this.#since) / 1000);
  }

  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  startPolling(intervalMs = 1000): void {
    void this.#poll();
    this.#timer = setInterval(() => void this.#poll(), intervalMs);
  }

  stopPolling(): void {
    clearInterval(this.#timer);
  }

  start(): void {
    this.#post(this.startPath);
  }

  holdStop(): void {}

  /** Only a full hold stops the take. */
  releaseStop(full: boolean): void {
    if (full) this.#post(this.stopPath);
  }

  #post(path: string): void {
    this.#posts = this.#posts.then(() => this.#send(path));
  }

  async #send(path: string): Promise<void> {
    try {
      const res = await this.#fetch(path, 'POST');
      if (!res.ok) console.error(`${this.#tag}: POST ${path}: HTTP ${res.status} ${await res.text()}`);
    } catch (err) {
      console.error(`${this.#tag}: POST ${path}:`, (err as Error).message);
    }
    await this.#poll();
  }

  async #poll(): Promise<void> {
    if (this.#polling) return;
    this.#polling = true;
    let status: S | undefined;
    let reason = '';
    try {
      const res = await this.#fetch(this.statusPath, 'GET');
      if (res.ok) status = (await res.json()) as S;
      else reason = `HTTP ${res.status}`;
    } catch (err) {
      reason = (err as Error).message;
    } finally {
      this.#polling = false;
    }
    const wasOnline = this.online;
    this.online = status !== undefined;
    if (status) this.state = status;
    if (this.online && !wasOnline) console.log(`${this.#tag}: connected`);
    if (!this.online && (wasOnline || !this.#last)) console.log(`${this.#tag}: offline (${reason})`);
    // A blip offline mid-take keeps the take's time; only a stopped status resets it.
    if (status && !this.isRecording(status)) this.#since = undefined;
    else if (this.recording) this.#since ??= performance.now();
    // Redraw when the take starts or stops, every second while it runs, and
    // when the reason it can't record changes.
    const seconds = this.seconds;
    const key = `${this.online} ${this.recording} ${seconds === undefined ? '' : Math.floor(seconds)} ${this.status ?? ''}`;
    if (key === this.#last) return;
    this.#last = key;
    for (const fn of this.#listeners) fn();
  }

  #fetch(path: string, method: 'GET' | 'POST'): Promise<Response> {
    return fetch(this.#base + path, { method, signal: AbortSignal.timeout(2000) });
  }
}

/** What GET /api/status reports (the fields used here). */
export interface OscRecorderStatus {
  /** null when stopped; what it holds while recording isn't relied on. */
  recording: unknown;
  received: number;
  errors: number;
  last_error: string | null;
}

/**
 * The OSC recorder on the show machine (host and port in greendeck.local.json).
 * It doesn't say how long a take has run, so the deck times it.
 */
export class OscRecorder extends HttpRecorder<OscRecorderStatus> {
  readonly name = 'OSC';
  protected readonly statusPath = '/api/status';
  protected readonly startPath = '/api/record/start';
  protected readonly stopPath = '/api/record/stop';

  constructor(config: OscRecorderConfig) {
    super(config, 'osc recorder');
  }

  protected isRecording(state: OscRecorderStatus): boolean {
    return state.recording != null;
  }
}

/** What GET /api/greenalyzer/status reports (the fields used here). */
export interface GreenalyzerStatus {
  /** Greenalyzer pages connected with REMOTE on; 0 means nothing can record. */
  pages: number;
  /** The page hasn't reported in for 5s, so it's gone (and `recording` reads false). */
  stale: boolean;
  recording: boolean;
  file: string | null;
  /** When the take started, ms since 1970. */
  started: number | null;
  /** The page's last error, e.g. its folder needs allowing again. */
  error: string | null;
}

/**
 * The SMPTE Timecode Greenalyzer's recorder, a web page on the show machine
 * that the OSC listener relays to (same host and port as the OSC recorder, see
 * REMOTE_RECORD_tc_greenalyzer.md). A page has to be open with REMOTE on for a
 * start to land, so the key says "no page" until one is.
 */
export class GreenalyzerRecorder extends HttpRecorder<GreenalyzerStatus> {
  readonly name = 'TC';
  protected readonly statusPath = '/api/greenalyzer/status';
  protected readonly startPath = '/api/greenalyzer/record/start';
  protected readonly stopPath = '/api/greenalyzer/record/stop';

  constructor(config: OscRecorderConfig) {
    super(config, 'greenalyzer');
  }

  protected isRecording(state: GreenalyzerStatus): boolean {
    return state.recording && !state.stale;
  }

  protected takeSeconds(state: GreenalyzerStatus): number | undefined {
    return state.started == null ? undefined : Math.max(0, (Date.now() - state.started) / 1000);
  }

  get status(): string | undefined {
    const s = this.state;
    if (!this.online || !s) return undefined;
    if (!s.pages) return 'no page';
    if (s.stale) return 'page asleep';
    if (s.error) return 'page error';
    return undefined;
  }
}
