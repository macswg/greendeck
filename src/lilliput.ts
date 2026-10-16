import { createSocket, type Socket } from 'node:dgram';

/**
 * Network control for Lilliput monitors (UQ23 etc.), over the UDP protocol
 * Lilliput's RemoteTerminal app uses.
 *
 * UDP to the monitor's port 19523, sent from local port 19522 (the monitor
 * ignores any other source port); replies come back to 19522. The monitor
 * doesn't ack writes, so state is read back by polling.
 *
 *   Frame: 5a LEN 00 20 MASK ff 00 ID CMD <data...> CKS dd
 */
const PORT_MON = 19523;
const PORT_LOCAL = 19522;

const CMD_READ = 0xfe;
const CMD_SOURCE = 0x00;
const CMD_UMD = 0x05;

export type LilliputTally = 'off' | 'red' | 'green' | 'yellow';

// UMD byte 0: bits 0-2 label colour, bit 3 label shown, bits 4-5 tally.
const UMD_SHOW = 0x08;
const TALLY_SHIFT = 4;
const TALLY_MASK = 0x30;
const TALLY: Record<LilliputTally, number> = { off: 0, red: 1, green: 2, yellow: 3 };

function frame(cmd: number, data: readonly number[] = []): Buffer {
  // MASK 01: a single-screen monitor; ID ff: any device.
  const head = [0x5a, data.length + 11, 0x00, 0x20, 0x01, 0xff, 0x00, 0xff, cmd, ...data];
  const sum = head.reduce((a, b) => a + b, 0) & 0xff;
  return Buffer.from([...head, sum, 0xdd]);
}

function valid(pkt: Buffer): boolean {
  if (pkt.length < 11 || pkt[0] !== 0x5a || pkt[pkt.length - 1] !== 0xdd || pkt[1] !== pkt.length) return false;
  let sum = 0;
  for (let i = 0; i < pkt.length - 2; i++) sum += pkt[i]!;
  return (sum & 0xff) === pkt[pkt.length - 2];
}

interface State {
  machineType: number;
  /** Source bytes: byte 0 bits 0-3 is the input (0 = SDI 1); 1-2 multiview. */
  source: number[];
  /** UMD bytes: label colour/shown/tally, then multiview labels. */
  umd: number[];
}

function parse(pkt: Buffer): State {
  const p = pkt.subarray(10, -2);
  return { machineType: pkt[5]!, source: [p[7]!, p[57]!, p[58]!], umd: [p[20]!, p[55]!, p[56]!] };
}

/**
 * The one socket on port 19522, shared by every monitor (the port can only
 * be bound once) and opened on first use. Frames are handed to the monitor
 * they came from.
 */
let shared: Socket | undefined;
const byIp = new Map<string, Lilliput>();

function socket(): Socket {
  if (shared) return shared;
  shared = createSocket({ type: 'udp4', reuseAddr: true });
  shared.on('error', (err) => console.error('lilliput:', err.message));
  shared.on('message', (pkt, { address }) => {
    if (valid(pkt)) byIp.get(address)?.receive(pkt);
  });
  shared.bind(PORT_LOCAL);
  return shared;
}

/**
 * One Lilliput monitor. Polls its state so the deck shows its current input
 * and whether it answers; writes go out in the order they were made.
 */
export class Lilliput {
  readonly ip: string;
  /**
   * Label text, resent with every tally change: the monitor can't report it
   * back, and a tally write without it would blank a shown label.
   */
  readonly label: string;
  state: State | undefined;
  reachable = false;

  #listeners = new Set<() => void>();
  #reading: { promise: Promise<State>; resolve: (s: State) => void } | undefined;
  #writes: Promise<unknown> = Promise.resolve();
  #poll: NodeJS.Timeout | undefined;
  #warnedLabel = false;

  constructor(ip: string, label = '') {
    this.ip = ip;
    this.label = label;
    byIp.set(ip, this);
  }

  /** The selected input, 0 = SDI 1. */
  get input(): number | undefined {
    return this.state && this.state.source[0]! & 0x0f;
  }

  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  startPolling(intervalMs = 3000): void {
    void this.read().catch(() => {});
    this.#poll = setInterval(() => void this.read().catch(() => {}), intervalMs);
  }

  stopPolling(): void {
    clearInterval(this.#poll);
  }

  /** Ask for the monitor's state; concurrent calls share one request. */
  read(timeoutMs = 2000): Promise<State> {
    if (this.#reading) return this.#reading.promise;
    let resolve!: (s: State) => void;
    let reject!: (err: Error) => void;
    const promise = new Promise<State>((res, rej) => ((resolve = res), (reject = rej)));
    this.#reading = { promise, resolve };
    const timer = setTimeout(() => {
      this.#reading = undefined;
      if (this.reachable) console.log(`lilliput ${this.ip}: not answering`);
      this.#update({ reachable: false });
      reject(new Error(`no reply from ${this.ip}`));
    }, timeoutMs);
    void promise.then(() => clearTimeout(timer), () => {});
    this.#send(frame(CMD_READ));
    return promise;
  }

  /** Switch to an input, 0 = SDI 1. */
  setInput(index: number): Promise<void> {
    return this.#write(async () => {
      const state = this.state ?? (await this.read());
      const source = [(state.source[0]! & ~0x0f) | index];
      if (state.machineType === 2) source.push(...state.source.slice(1));
      this.#send(frame(CMD_SOURCE, source));
      this.#update({ state: { ...state, source: [...source, ...state.source.slice(source.length)] } });
    });
  }

  setTally(tally: LilliputTally): Promise<void> {
    return this.#write(async () => {
      const state = this.state ?? (await this.read());
      const b0 = (state.umd[0]! & ~TALLY_MASK) | (TALLY[tally] << TALLY_SHIFT);
      if (b0 & UMD_SHOW && !this.label && !this.#warnedLabel) {
        this.#warnedLabel = true;
        console.warn(`lilliput ${this.ip}: label is shown but none is configured, so tally changes will blank it`);
      }
      const text = Buffer.alloc(16);
      text.write(this.label.replace(/[^\x20-\x7e]/g, ' ').slice(0, 16), 'ascii');
      const umd = [b0, ...(state.machineType === 2 ? state.umd.slice(1) : [])];
      this.#send(frame(CMD_UMD, [umd[0]!, ...text, ...umd.slice(1)]));
      this.#update({ state: { ...state, umd: [b0, ...state.umd.slice(1)] } });
    });
  }

  /** A frame from this monitor. State frames also arrive unasked, e.g. after a source change. */
  receive(pkt: Buffer): void {
    if (pkt[8] !== CMD_READ || pkt.length < 71) return;
    const state = parse(pkt);
    if (!this.reachable) console.log(`lilliput ${this.ip}: connected`);
    this.#update({ state, reachable: true });
    this.#reading?.resolve(state);
    this.#reading = undefined;
  }

  /** Queue a write behind earlier ones. Failures are logged, never thrown. */
  #write(fn: () => Promise<void>): Promise<void> {
    const next = this.#writes.then(fn).catch((err) => console.error(`lilliput ${this.ip}:`, (err as Error).message));
    this.#writes = next;
    return next;
  }

  #send(pkt: Buffer): void {
    socket().send(pkt, PORT_MON, this.ip);
  }

  #update(patch: Partial<Pick<Lilliput, 'state' | 'reachable'>>): void {
    Object.assign(this, patch);
    for (const fn of this.#listeners) fn();
  }
}
