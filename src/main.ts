import { listStreamDecks, openStreamDeck, type StreamDeck } from '@elgato-stream-deck/node';
import { Engine } from './engine.ts';
import { createServices, layout } from './layout.ts';
import { PushHub } from './push.ts';

const PUSH_PORT = Number(process.env.GREENDECK_PUSH_PORT ?? 9900);
const MAX_FPS = Number(process.env.GREENDECK_MAX_FPS ?? 60);
const BRIGHTNESS = Number(process.env.GREENDECK_BRIGHTNESS ?? 70);

const push = new PushHub();
push.listen(PUSH_PORT);
const services = createServices(push);

let current: { deck: StreamDeck; engine: Engine } | undefined;

async function shutdown(): Promise<void> {
  if (current) {
    await current.engine.stop();
    await current.deck.resetToLogo().catch(() => {});
    await current.deck.close().catch(() => {});
  }
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

/** Open the first deck, run until it errors (e.g. unplugged), then retry. */
async function run(): Promise<never> {
  let waiting = false;
  for (;;) {
    const [info] = await listStreamDecks();
    if (!info) {
      if (!waiting) console.log('waiting for a Stream Deck…');
      waiting = true;
      await sleep(2000);
      continue;
    }
    waiting = false;

    let deck: StreamDeck;
    try {
      deck = await openStreamDeck(info.path);
    } catch (err) {
      console.error(`couldn't open ${info.modelInfo.name} (is Companion or the Elgato app running?):`, (err as Error).message);
      await sleep(3000);
      continue;
    }

    console.log(`connected: ${deck.PRODUCT_NAME} (${info.serialNumber})`);
    await deck.clearPanel();
    const engine = new Engine(deck, { maxFps: MAX_FPS, brightness: BRIGHTNESS });
    current = { deck, engine };
    layout(engine, services);
    if (process.env.GREENDECK_STATS) {
      engine.onStats(() => {
        const { fps, keysPerSec, frameMs } = engine.stats;
        console.log(`${fps} fps  ${keysPerSec} keys/s  ${frameMs.toFixed(1)} ms/frame`);
      });
    }

    await new Promise<void>((resolve) => deck.once('error', (err) => {
      console.error('deck error, reconnecting:', (err as Error)?.message ?? err);
      resolve();
    }));
    current = undefined;
    await engine.stop();
    await deck.close().catch(() => {});
    await sleep(1000);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

await run();
