import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import jpeg from '@julusian/jpeg-turbo';
import { DeviceModelId, getModelInfo, type StreamDeckControlDefinition } from '@elgato-stream-deck/node';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Surface } from './engine.ts';

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

  constructor(model: DeviceModelId = DeviceModelId.XL) {
    super();
    const info = getModelInfo(model);
    if (!info) throw new Error(`unknown Stream Deck model: ${model}`);
    this.CONTROLS = info.controls;
    const button = info.controls.find((c) => c.type === 'button' && c.feedbackType === 'lcd');
    this.#keySize = button && 'pixelSize' in button ? button.pixelSize.width : 96;
  }

  listen(port: number, host: string): void {
    const page = new URL('./virtual.html', import.meta.url);
    const server = createServer(async (req, res) => {
      if (req.url !== '/') {
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
    const image = await jpeg.compress(raw, { format: jpeg.FORMAT_RGBA, width: this.#keySize, height: this.#keySize, quality: 90 });
    this.#images.set(index, image);
    for (const client of this.#clients) this.#queue(client, index, image);
  }

  async setBrightness(percent: number): Promise<void> {
    this.#brightness = percent;
    for (const { ws } of this.#clients) ws.send(JSON.stringify({ type: 'brightness', value: percent }));
  }

  #accept(ws: WebSocket): void {
    const client: Client = { ws, pending: new Map(), retry: undefined };
    this.#clients.add(client);

    const keys = this.CONTROLS.flatMap((c) => (c.type === 'button' ? [{ index: c.index, row: c.row, column: c.column }] : []));
    ws.send(JSON.stringify({ type: 'hello', keySize: this.#keySize, keys, brightness: this.#brightness }));
    for (const [index, image] of this.#images) this.#queue(client, index, image);
    if (this.#clients.size === 1) this.emit('connect');

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let msg: { type?: string; index?: number };
      try {
        msg = JSON.parse(String(data));
      } catch {
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
