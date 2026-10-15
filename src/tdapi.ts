import type { TdApiConfig } from './config.ts';

/** What GET /api/state reports. */
export interface TdApiState {
  rec: boolean;
  recording: string | null;
  rec_seconds: number | null;
  cache_on: boolean;
  cache_recording: boolean;
  cache_saving: boolean;
  marks: number;
  stop_held: boolean;
  time: string;
}

/**
 * The show's TouchDesigner, over its HTTP API (host, port and key in
 * greendeck.local.json). Polls /api/state so the deck always shows TD's real
 * state, including changes made inside TD; commands are POSTs, followed by an
 * immediate re-poll so the key catches up without waiting for the next tick.
 */
export class TdApi {
  state: TdApiState | undefined;
  online = false;

  #base: string;
  #key: string;
  #listeners = new Set<() => void>();
  #timer: NodeJS.Timeout | undefined;
  #polling = false;
  #last = '';
  /** Commands go out one at a time, so a stop's release can't overtake its hold. */
  #posts: Promise<void> = Promise.resolve();

  constructor(config: TdApiConfig) {
    this.#base = `http://${config.host}:${config.port}`;
    this.#key = config.apiKey;
  }

  get recording(): boolean {
    return this.online && !!this.state?.rec;
  }

  /** Seconds into the current take, when TD reports it. */
  get seconds(): number | undefined {
    return this.recording ? (this.state?.rec_seconds ?? undefined) : undefined;
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

  startRecording(): void {
    this.#post('/api/rec/start');
  }

  /**
   * Stopping is a hold that TD times itself: hold on press, release on let
   * go. TD only ends the take if the release comes at least 1.5s after the hold.
   */
  holdStop(): void {
    this.#post('/api/rec/stop/hold');
  }

  releaseStop(): void {
    this.#post('/api/rec/stop/release');
  }

  #post(path: string): void {
    this.#posts = this.#posts.then(() => this.#send(path));
  }

  async #send(path: string): Promise<void> {
    try {
      const res = await this.#fetch(path, 'POST');
      if (!res.ok) console.error(`td api: POST ${path}: HTTP ${res.status} ${await res.text()}`);
    } catch (err) {
      console.error(`td api: POST ${path}:`, (err as Error).message);
    }
    await this.#poll();
  }

  async #poll(): Promise<void> {
    if (this.#polling) return;
    this.#polling = true;
    let state: TdApiState | undefined;
    let reason = '';
    try {
      const res = await this.#fetch('/api/state', 'GET');
      if (res.ok) state = ((await res.json()) as { state: TdApiState }).state;
      else reason = `HTTP ${res.status}`;
    } catch (err) {
      reason = (err as Error).message;
    } finally {
      this.#polling = false;
    }
    const wasOnline = this.online;
    this.online = state !== undefined;
    if (state) this.state = state;
    if (this.online && !wasOnline) console.log('td api: connected');
    if (!this.online && (wasOnline || !this.#last)) console.log(`td api: offline (${reason})`);
    // `time` ticks every poll; only redraw when something else changed.
    const { time: _, ...rest } = state ?? ({} as Partial<TdApiState>);
    const key = `${this.online} ${JSON.stringify(rest)}`;
    if (key === this.#last) return;
    this.#last = key;
    for (const fn of this.#listeners) fn();
  }

  #fetch(path: string, method: 'GET' | 'POST'): Promise<Response> {
    return fetch(this.#base + path, {
      method,
      headers: { Authorization: `Bearer ${this.#key}` },
      signal: AbortSignal.timeout(2000),
    });
  }
}
