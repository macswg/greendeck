import type { Ambient } from './ambient.ts';
import { CircuitField, ColorPulse, HexField, ImageBackground, LaserSweep, RainbowWave, WarmGlow, type Background } from './background.ts';

/** A wallpaper you can pick from a key: its label, a swatch colour for the key, and the background. */
export interface WallpaperChoice {
  id: string;
  label: string;
  swatch: string;
  make: () => Background | Promise<Background>;
}

const wallpaperPath = (file: string) => new URL(`../assets/wallpapers/${file}`, import.meta.url).pathname;

function picture(id: string, label: string, swatch: string, file: string, opts?: { dim?: number }): WallpaperChoice {
  return { id, label, swatch, make: () => ImageBackground.load(wallpaperPath(file), opts) };
}

export const WALLPAPERS: readonly WallpaperChoice[] = [
  // These two change every pixel every frame, so they re-send the whole deck
  // at the background frame rate: the prettiest, and the heaviest.
  { id: 'rainbow', label: 'RAINBOW', swatch: '#c44dff', make: () => new RainbowWave() },
  { id: 'ember', label: 'EMBER', swatch: '#e8901c', make: () => new WarmGlow() },
  // A slow pulse only re-sends when it steps to a new brightness, so it's cheap.
  { id: 'ocean', label: 'OCEAN', swatch: '#1e6fd9', make: () => new ColorPulse('#1e6fd9', { period: 6, min: 0.1, max: 0.45 }) },
  // Still pictures cost nothing once they're on the deck. The drawn ones come
  // from scripts/make-wallpapers.ts; see assets/wallpapers/CREDITS.md.
  picture('dusk', 'DUSK', '#c9785a', 'dusk.png'),
  // Lights travel the traces; only the keys they cross are re-sent.
  { id: 'circuit', label: 'CIRCUIT', swatch: '#3ce6e6', make: () => new CircuitField() },
  // The grid picture with an 80s laser scan sweeping down the grid now and
  // then, from the horizon (52% down the picture) to the bottom.
  {
    id: 'grid',
    label: 'GRID',
    swatch: '#ff3cc8',
    make: async () => new LaserSweep(await ImageBackground.load(wallpaperPath('grid.png')), { from: 0.52, sweep: 1.8 }),
  },
  // Cells fade on and off; only the keys under a fading cell are re-sent.
  { id: 'hex', label: 'HEX', swatch: '#2a8cff', make: () => new HexField() },
  // A real photo, dimmed: it's bright, and labels need to read on top.
  picture('neon', 'NEON', '#b04cff', 'neon-tunnel.jpg', { dim: 0.45 }),
];

/**
 * The resting background, shown when no state (an alert, Claude waiting) is
 * raised. It sits below every state, so those still show over it. Shared by
 * every surface, so picking one on the browser deck changes the hardware too.
 */
export class Wallpaper {
  static readonly PRIORITY = -100;
  #ambient: Ambient;
  #current: WallpaperChoice | undefined;

  constructor(ambient: Ambient) {
    this.#ambient = ambient;
  }

  get current(): string | undefined {
    return this.#current?.id;
  }

  /** Show `id`, or go back to plain black if it's already showing. */
  async toggle(id: string): Promise<void> {
    const choice = this.#current?.id === id ? undefined : WALLPAPERS.find((w) => w.id === id);
    this.#current = choice;
    if (!choice) {
      this.#ambient.clear('wallpaper');
      return;
    }
    let background: Background;
    try {
      background = await choice.make();
    } catch (err) {
      console.error(`wallpaper ${id}:`, (err as Error).message);
      if (this.#current === choice) this.#current = undefined;
      this.#ambient.clear('wallpaper');
      return;
    }
    // Another key was pressed while this one loaded.
    if (this.#current !== choice) return;
    this.#ambient.set('wallpaper', background, Wallpaper.PRIORITY);
  }

  /** Called when the choice changes. Returns an unsubscribe. */
  subscribe(fn: () => void): () => void {
    // The wallpaper lives in the ambient states, so its changes are theirs.
    return this.#ambient.subscribe(fn);
  }
}
