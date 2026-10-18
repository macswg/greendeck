import type { OscRecorderConfig } from './config.ts';
import type { Recorder } from './widgets/td.ts';

/** What GET /api/status reports (the fields used here). */
export interface OscRecorderStatus {
  /** null when stopped; what it holds while recording isn't relied on. */
  recording: unknown;
  received: number;
  errors: number;
  last_error: string | null;
}

/**
 * The OSC recorder on the show machine, over its HTTP API (host and port in
 * greendeck.local.json). Polls /api/status every second; start and stop are
 * POSTs with no body, followed by an immediate re-poll.
 */
export class OscRecorder implements Recorder {
  state: OscRecorderStatus | undefined;
  online = false;
  readonly name = 'OSC';

  #base: string;
  #listeners = new Set<() => void>();
  #timer: NodeJS.Timeout | undefined;
  #polling = false;
  #last = '';
  /** When this deck first saw the current take running. */
  #since: number | undefined;
  #posts: Promise<void> = Promise.resolve();

  constructor(config: OscRecorderConfig) {
    this.#base = `http://${config.host}:${config.port}`;
  }

  get recording(): boolean {
    return this.online && this.state?.recording != null;
  }

  /**
   * Seconds since the deck saw the take start, so a take started elsewhere
   * before greendeck was running reads short.
   */
  get seconds(): number | undefined {
    return this.recording && this.#since !== undefined ? (performance.now() - this.#since) / 1000 : undefined;
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
    this.#post('/api/record/start');
  }

  holdStop(): void {}

  /** Only a full hold stops the take. */
  releaseStop(full: boolean): void {
    if (full) this.#post('/api/record/stop');
  }

  #post(path: string): void {
    this.#posts = this.#posts.then(() => this.#send(path));
  }

  async #send(path: string): Promise<void> {
    try {
      const res = await this.#fetch(path, 'POST');
      if (!res.ok) console.error(`osc recorder: POST ${path}: HTTP ${res.status} ${await res.text()}`);
    } catch (err) {
      console.error(`osc recorder: POST ${path}:`, (err as Error).message);
    }
    await this.#poll();
  }

  async #poll(): Promise<void> {
    if (this.#polling) return;
    this.#polling = true;
    let status: OscRecorderStatus | undefined;
    let reason = '';
    try {
      const res = await this.#fetch('/api/status', 'GET');
      if (res.ok) status = (await res.json()) as OscRecorderStatus;
      else reason = `HTTP ${res.status}`;
    } catch (err) {
      reason = (err as Error).message;
    } finally {
      this.#polling = false;
    }
    const wasOnline = this.online;
    this.online = status !== undefined;
    if (status) this.state = status;
    if (this.online && !wasOnline) console.log('osc recorder: connected');
    if (!this.online && (wasOnline || !this.#last)) console.log(`osc recorder: offline (${reason})`);
    // A blip offline mid-take keeps the take's time; only a stopped status resets it.
    if (status && status.recording == null) this.#since = undefined;
    else if (this.recording) this.#since ??= performance.now();
    // Redraw when the take starts or stops, and every second while it runs.
    const seconds = this.seconds;
    const key = `${this.online} ${this.recording} ${seconds === undefined ? '' : Math.floor(seconds)}`;
    if (key === this.#last) return;
    this.#last = key;
    for (const fn of this.#listeners) fn();
  }

  #fetch(path: string, method: 'GET' | 'POST'): Promise<Response> {
    return fetch(this.#base + path, { method, signal: AbortSignal.timeout(2000) });
  }
}
