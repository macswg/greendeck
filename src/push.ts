import { createSocket } from 'node:dgram';

/**
 * Lets other programs (TouchDesigner, scripts, anything) push live values onto
 * keys over UDP. Each datagram is one or more lines of `<id> <value>`:
 *
 *   echo "temp 42.1" | nc -u -w0 127.0.0.1 9900
 *
 * UDP keeps it fire-and-forget: senders never block, and the deck only ever
 * draws the newest value.
 */
export class PushHub {
  #listeners = new Map<string, Set<(value: string) => void>>();
  #any = new Set<(id: string, value: string) => void>();
  #latest = new Map<string, string>();

  /** Every value, whatever its id. */
  subscribeAll(fn: (id: string, value: string) => void): () => void {
    this.#any.add(fn);
    return () => this.#any.delete(fn);
  }

  subscribe(id: string, fn: (value: string) => void): () => void {
    let set = this.#listeners.get(id);
    if (!set) this.#listeners.set(id, (set = new Set()));
    set.add(fn);
    const latest = this.#latest.get(id);
    if (latest !== undefined) fn(latest);
    return () => set.delete(fn);
  }

  publish(id: string, value: string): void {
    this.#latest.set(id, value);
    for (const fn of this.#listeners.get(id) ?? []) fn(value);
    for (const fn of this.#any) fn(id, value);
  }

  listen(port: number, host = '127.0.0.1'): void {
    const socket = createSocket('udp4');
    socket.on('message', (msg) => {
      for (const line of msg.toString().split('\n')) {
        const match = /^\s*(\S+)\s+(.*?)\s*$/.exec(line);
        if (match) this.publish(match[1], match[2]);
      }
    });
    socket.on('error', (err) => console.error('push listener:', err.message));
    socket.bind(port, host, () => console.log(`push: listening on udp://${host}:${port}`));
  }
}
