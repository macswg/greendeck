import { createSocket } from 'node:dgram';
import type { PushHub } from './push.ts';

/**
 * Two-way link to a TouchDesigner project running td/greendeck.tox.
 *
 * Deck → TD: UDP lines to TD's port (`set <name> <value>`, `pulse <name>`,
 * `sync`). TD → deck: TD pushes `td.<name> <value>` to the PushHub port
 * whenever a bound parameter changes, from any source. `sync` doubles as a
 * heartbeat: TD answers with every value plus `td.alive`, which is how we
 * know it's up.
 */
export class TouchDesigner {
  readonly values = new Map<string, string>();
  online = false;

  #socket = createSocket('udp4');
  #host: string;
  #port: number;
  #lastSeen = 0;
  #listeners = new Set<() => void>();
  #timer: NodeJS.Timeout | undefined;

  constructor(push: PushHub, opts: { host?: string; port?: number } = {}) {
    this.#host = opts.host ?? '127.0.0.1';
    this.#port = opts.port ?? 9901;
    this.#socket.on('error', (err) => console.error('td link:', err.message));
    push.subscribeAll((id, value) => {
      if (!id.startsWith('td.')) return;
      this.#lastSeen = Date.now();
      const wasOnline = this.online;
      this.online = true;
      const name = id.slice(3);
      if (name !== 'alive') this.values.set(name, value);
      if (!wasOnline) console.log('td: connected');
      this.#notify();
    });
  }

  start(heartbeatMs = 1000): void {
    this.#send('sync');
    this.#timer = setInterval(() => {
      if (this.online && Date.now() - this.#lastSeen > heartbeatMs * 3) {
        this.online = false;
        console.log('td: lost connection');
        this.#notify();
      }
      this.#send('sync');
    }, heartbeatMs);
  }

  stop(): void {
    clearInterval(this.#timer);
    this.#socket.close();
  }

  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  isOn(name: string): boolean {
    const v = this.values.get(name);
    return v !== undefined && v !== '0' && v !== '' && v.toLowerCase() !== 'false';
  }

  set(name: string, value: string | number | boolean): void {
    this.#send(`set ${name} ${typeof value === 'boolean' ? Number(value) : value}`);
  }

  toggle(name: string): void {
    this.set(name, !this.isOn(name));
  }

  pulse(name: string): void {
    this.#send(`pulse ${name}`);
  }

  #send(line: string): void {
    this.#socket.send(line, this.#port, this.#host);
  }

  #notify(): void {
    for (const fn of this.#listeners) fn();
  }
}
