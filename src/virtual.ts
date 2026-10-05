import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import jpeg from '@julusian/jpeg-turbo';
import { DeviceModelId, getModelInfo, type StreamDeckControlDefinition } from '@elgato-stream-deck/node';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Surface } from './engine.ts';
import { ICON_SVG, iconPng } from './icon.ts';
import type { Pager } from './pages.ts';

/** Stop queueing frames to a client once this much is waiting to be sent. */
const MAX_BUFFERED = 256 * 1024;

interface Client {
  ws: WebSocket;
  /** Newest image per key not yet sent. A slow client skips straight to the latest. */
  pending: Map<number, Buffer>;
  retry: NodeJS.Timeout | undefined;
}

/**
 * A Stream Deck in the browser. Serves a page that shows the keys and sends
 * presses back, and acts as a Surface so the engine drives it like real
 * hardware. Emits 'connect' when the first page opens and 'disconnect' when
 * the last one closes, so it only costs anything while someone's looking.
 *
 * Wire format: key images go out as binary [key index byte][JPEG], everything
 * else is JSON text.
 */
export class VirtualDeck extends EventEmitter implements Surface {
  readonly CONTROLS: Readonly<StreamDeckControlDefinition[]>;
  readonly #keySize: number;
  #images = new Map<number, Buffer>();
  #brightness = 100;
  #clients = new Set<Client>();
  #pager: Pager | undefined;
  #backlight = 70;
  #unsubscribePager: (() => void) | undefined;

  readonly #version: string;

  constructor(opts: { model?: DeviceModelId; version?: string } = {}) {
    super();
    const model = opts.model ?? DeviceModelId.XL;
    this.#version = opts.version ?? '';
    const info = getModelInfo(model);
    if (!info) throw new Error(`unknown Stream Deck model: ${model}`);
    this.CONTROLS = info.controls;
    const button = info.controls.find((c) => c.type === 'button' && c.feedbackType === 'lcd');
    this.#keySize = button && 'pixelSize' in button ? button.pixelSize.width : 96;
  }

  listen(port: number, host: string): void {
    const page = new URL('./virtual.html', import.meta.url);
    let touchIcon: Buffer | undefined;
    const server = createServer(async (req, res) => {
      if (req.url === '/favicon.svg') {
        res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=86400' }).end(ICON_SVG);
        return;
      }
      if (req.url === '/apple-touch-icon.png') {
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=86400' }).end((touchIcon ??= iconPng()));
        return;
      }
      if (req.url !== '/' && !req.url?.startsWith('/?')) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(await readFile(page));
    });
    const wss = new WebSocketServer({ server, path: '/ws' });
    wss.on('connection', (ws) => this.#accept(ws));
    server.on('error', (err) => console.error('virtual deck:', err.message));
    server.listen(port, host, () => console.log(`virtual deck: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`));
  }

  async fillKeyBuffer(index: number, pixels: Uint8ClampedArray): Promise<void> {
    const raw = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength);
    const image = await jpeg.compress(raw, {
      format: jpeg.FORMAT_RGBA,
      width: this.#keySize,
      height: this.#keySize,
      // Same as the hardware: full-resolution colour, so gradients don't smear.
      quality: 95,
      subsampling: jpeg.SAMP_444,
    });
    this.#images.set(index, image);
    for (const client of this.#clients) this.#queue(client, index, image);
  }

  async setBrightness(percent: number): Promise<void> {
    this.#brightness = percent;
    for (const { ws } of this.#clients) ws.send(JSON.stringify({ type: 'brightness', value: percent }));
  }

  /** Lets the page show a page picker that follows, and controls, this pager. */
  attachPager(pager: Pager | undefined): void {
    this.#unsubscribePager?.();
    this.#pager = pager;
    this.#unsubscribePager = pager?.subscribe(() => this.#sendPages());
    this.#sendPages();
  }

  /** Tell pages the backlight level, for the slider. */
  showBacklight(percent: number): void {
    this.#backlight = percent;
    const msg = JSON.stringify({ type: 'backlight', value: percent });
    for (const { ws } of this.#clients) ws.send(msg);
  }

  #sendPages(): void {
    if (!this.#pager) return;
    const msg = JSON.stringify(this.#pagesMessage());
    for (const { ws } of this.#clients) ws.send(msg);
  }

  #pagesMessage() {
    const pager = this.#pager!;
    return { type: 'pages', names: pager.names, index: pager.index, fixed: pager.fixedKeys };
  }

  #accept(ws: WebSocket): void {
    const client: Client = { ws, pending: new Map(), retry: undefined };
    this.#clients.add(client);

    const keys = this.CONTROLS.flatMap((c) => (c.type === 'button' ? [{ index: c.index, row: c.row, column: c.column }] : []));
    ws.send(JSON.stringify({ type: 'hello', keySize: this.#keySize, keys, brightness: this.#brightness, version: this.#version }));
    if (this.#pager) ws.send(JSON.stringify(this.#pagesMessage()));
    ws.send(JSON.stringify({ type: 'backlight', value: this.#backlight }));
    for (const [index, image] of this.#images) this.#queue(client, index, image);
    if (this.#clients.size === 1) this.emit('connect');

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let msg: { type?: string; index?: number; value?: unknown; from?: unknown; to?: unknown };
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (msg.type === 'backlight' && typeof msg.value === 'number') {
        this.emit('backlight', msg.value);
        return;
      }
      if (msg.type === 'move' && Number.isInteger(msg.from) && Number.isInteger(msg.to)) {
        this.#pager?.move(msg.from as number, msg.to as number);
        return;
      }
      if (msg.type === 'page' && Number.isInteger(msg.index)) {
        this.#pager?.go(msg.index as number);
        return;
      }
      const control = this.CONTROLS.find((c) => c.type === 'button' && c.index === msg.index);
      if (control && (msg.type === 'down' || msg.type === 'up')) this.emit(msg.type, control);
    });

    ws.on('close', () => {
      clearTimeout(client.retry);
      this.#clients.delete(client);
      if (this.#clients.size === 0) {
        this.#images.clear();
        this.emit('disconnect');
      }
    });
  }

  #queue(client: Client, index: number, image: Buffer): void {
    client.pending.set(index, image);
    this.#flush(client);
  }

  #flush(client: Client): void {
    if (client.retry) return;
    for (const [index, image] of client.pending) {
      if (client.ws.bufferedAmount > MAX_BUFFERED) {
        client.retry = setTimeout(() => {
          client.retry = undefined;
          this.#flush(client);
        }, 10);
        return;
      }
      client.pending.delete(index);
      const msg = Buffer.allocUnsafe(image.length + 1);
      msg[0] = index;
      image.copy(msg, 1);
      client.ws.send(msg);
    }
  }
}
