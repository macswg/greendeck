import { listStreamDecks, openStreamDeck, type StreamDeck } from '@elgato-stream-deck/node';
import { Engine, type Surface } from './engine.ts';
import type { Pager } from './pages.ts';
import { createServices, layout } from './layout.ts';
import { PushHub } from './push.ts';
import { VirtualDeck } from './virtual.ts';
import { versionString } from './version.ts';

const PUSH_PORT = Number(process.env.GREENDECK_PUSH_PORT ?? 9900);
const MAX_FPS = Number(process.env.GREENDECK_MAX_FPS ?? 60);
const BRIGHTNESS = Number(process.env.GREENDECK_BRIGHTNESS ?? 70);
// Key image quality sent to the deck. Higher keeps more of the background
// dither (lower smooths it away and the glow bands) but sends larger images:
// with a pulsing background, 95 runs ~16 fps, 97 ~13, 100 only ~7.
const JPEG_QUALITY = Number(process.env.GREENDECK_JPEG_QUALITY ?? 97);
// Set GREENDECK_VIRTUAL_PORT=0 to turn the browser deck off. It only listens on
// this machine unless GREENDECK_VIRTUAL_HOST opens it up (e.g. 0.0.0.0 for a
// phone on the LAN; anyone who can reach it can press buttons).
const VIRTUAL_PORT = Number(process.env.GREENDECK_VIRTUAL_PORT ?? 9902);
const VIRTUAL_HOST = process.env.GREENDECK_VIRTUAL_HOST ?? '127.0.0.1';
const VIRTUAL_FPS = Number(process.env.GREENDECK_VIRTUAL_FPS ?? 60);

const push = new PushHub();
push.listen(PUSH_PORT);
const services = createServices(push, { brightness: BRIGHTNESS });

if (VIRTUAL_PORT) startVirtualDeck();

/**
 * Lay out a surface, and lay it out again on a fresh engine whenever the
 * config is switched, staying on the page it was showing. Returns a stop
 * function that ends the current engine.
 */
function runLayout(surface: Surface, opts: { maxFps: number }, started: (engine: Engine, pager: Pager) => void): () => Promise<void> {
  let engine: Engine | undefined;
  const start = (page?: string) => {
    engine = new Engine(surface, { ...opts, brightness: BRIGHTNESS });
    const pager = layout(engine, services);
    if (page) pager.goTo(page);
    started(engine, pager);
    return pager;
  };
  let pager = start();
  const unsubscribe = services.configs.subscribe(() => {
    const page = pager.name;
    void engine?.stop();
    pager = start(page);
  });
  return async () => {
    unsubscribe();
    await engine?.stop();
    engine = undefined;
  };
}

/** The browser deck gets its own engine, running only while a page is open. */
function startVirtualDeck(): void {
  const deck = new VirtualDeck({ version: versionString() });
  let stop: (() => Promise<void>) | undefined;
  deck.on('connect', () => {
    stop = runLayout(deck, { maxFps: VIRTUAL_FPS }, (_engine, pager) => deck.attachPager(pager));
  });
  deck.on('disconnect', () => {
    deck.attachPager(undefined);
    void stop?.();
    stop = undefined;
  });
  // The page's slider sets the shared backlight level (the hardware follows).
  deck.on('backlight', (percent: number) => services.brightness.set(percent));
  services.brightness.subscribe(() => deck.showBacklight(services.brightness.value));
  deck.showBacklight(services.brightness.value);
  deck.listen(VIRTUAL_PORT, VIRTUAL_HOST);
}

let current: { deck: StreamDeck; stop: () => Promise<void> } | undefined;

async function shutdown(): Promise<void> {
  if (current) {
    await current.stop();
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
      deck = await openStreamDeck(info.path, { jpegOptions: { quality: JPEG_QUALITY } });
    } catch (err) {
      console.error(`couldn't open ${info.modelInfo.name} (is Companion or the Elgato app running?):`, (err as Error).message);
      await sleep(3000);
      continue;
    }

    console.log(`connected: ${deck.PRODUCT_NAME} (${info.serialNumber})`);
    await deck.clearPanel();
    const stop = runLayout(deck, { maxFps: MAX_FPS }, (engine) => {
      if (process.env.GREENDECK_STATS) {
        engine.onStats(() => {
          const { fps, keysPerSec, frameMs } = engine.stats;
          console.log(`${fps} fps  ${keysPerSec} keys/s  ${frameMs.toFixed(1)} ms/frame`);
        });
      }
    });
    current = { deck, stop };

    await new Promise<void>((resolve) => deck.once('error', (err) => {
      console.error('deck error, reconnecting:', (err as Error)?.message ?? err);
      resolve();
    }));
    current = undefined;
    await stop();
    await deck.close().catch(() => {});
    await sleep(1000);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

await run();
