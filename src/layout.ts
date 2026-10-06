import { Ambient } from './ambient.ts';
import { Attention } from './attention.ts';
import { Scanner } from './background.ts';
import { Brightness } from './brightness.ts';
import { SharedStandby } from './sleep.ts';
import { ClaudeSessions } from './claude.ts';
import { FanControl } from './fans.ts';
import { SystemStats } from './system.ts';
import type { Engine } from './engine.ts';
import { MicLevel } from './mic.ts';
import { Pager } from './pages.ts';
import { Positions } from './positions.ts';
import { loadLocalConfig } from './config.ts';
import type { Widget } from './widget.ts';
import type { PushHub } from './push.ts';
import { TouchDesigner } from './td.ts';
import { Wallpaper, WALLPAPERS } from './wallpaper.ts';
import { ClaudeKey, ClaudeSlot } from './widgets/claude.ts';
import { EndOfDayButton } from './widgets/endofday.ts';
import { LatencyTester } from './widgets/latency.ts';
import { LinkButton } from './widgets/link.ts';
import { MicGainButton, MicMeterSegment, MicReadout } from './widgets/mic.ts';
import { PageArrow, PageLink, PageTitle } from './widgets/nav.ts';
import { Monitor, MonitorHeader, MonitorInputButton } from './widgets/monitor.ts';
import { Clock, EngineStatsWidget, FanKey, LoadKey, PushValue, TempKey } from './widgets/realtime.ts';
import { SleepButton, WakeButton } from './widgets/standby.ts';
import { WallpaperButton } from './widgets/wallpaper.ts';
import { RecordButton, TdToggle } from './widgets/td.ts';

/**
 * Long-lived state that outlives a deck reconnect. Created once at startup.
 */
export function createServices(push: PushHub, opts: { brightness: number }) {
  const mon1 = new Monitor(1);
  const mon2 = new Monitor(2);
  mon1.startPolling();
  mon2.startPolling();
  const td = new TouchDesigner(push, { port: Number(process.env.GREENDECK_TD_PORT ?? 9901) });
  td.start();

  // Background states, highest priority wins. Claude waiting on you is the
  // first; more (recording, alerts, ...) go here.
  const ambient = new Ambient(push);
  // The resting background under every state; picked from keys on Main.
  const wallpaper = new Wallpaper(ambient);
  const claude = new ClaudeSessions(push);
  // When something needs you, a red KITT-style scanner sweeps the top row for
  // a few seconds, then rests for 2 minutes, repeating while it's still
  // needed. Flat colour per key (no banding), and only one row changes, so the
  // deck stays responsive.
  // Each burst is two full sweeps (across and back, twice) plus a moment for
  // the last key to fade, then 2 minutes' rest.
  const SCANNER_PERIOD = 1.8;
  const attention = new Attention(push, ambient, () => new Scanner('#e0201a', { period: SCANNER_PERIOD }), {
    burstMs: (2 * SCANNER_PERIOD + 0.5) * 1000,
    restMs: 2 * 60_000,
  });

  // A Claude session waiting on you needs attention; a newly waiting one
  // sweeps straight away.
  let waitingBefore = 0;
  claude.subscribe(() => {
    const waiting = claude.waiting.length;
    if (!waiting) attention.clear('claude');
    else if (!attention.active) attention.raise('claude');
    else if (waiting > waitingBefore) {
      attention.raise('claude');
      attention.poke();
    }
    waitingBefore = waiting;
  });

  const brightness = new Brightness(opts.brightness);
  const standby = new SharedStandby();
  const system = new SystemStats();
  system.start();
  const fans = new FanControl();
  fans.start();
  // Only listens while a meter is on screen.
  const mic = new MicLevel();
  // Where buttons have been moved to (from the browser deck). Local to this
  // machine and git-ignored; delete it to reset.
  const positions = new Positions(new URL('../layout.local.json', import.meta.url).pathname);
  const local = loadLocalConfig();

  return { push, mon1, mon2, td, ambient, wallpaper, attention, claude, brightness, standby, system, fans, mic, positions, local };
}

export type Services = ReturnType<typeof createServices>;

/**
 * What goes on which key. The XL is 8 columns x 4 rows; key index = row * 8 + col.
 * The three bottom-right keys are fixed on every page: ▲ / ▼ change page and
 * the title shows where you are (press it to go back to the first page).
 *
 *   Main
 *   ┌──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┐
 *   │      │      │      │      │CLAUDE│ FANS │ TEMP │ LOAD │
 *   ├──────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
 *   │      │      │      │      │ link*│ EOD* │      │ MON ›│
 *   ├──────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
 *   │  REC │ CACHE│      │      │      │      │      │  ▲   │
 *   ├──────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
 *   │ SLEEP│clock*│      │      │      │ WEB  │ title│  ▼   │
 *   └──────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┘
 *   * In standby the clock's key shows WAKE instead, the only lit key.
 *   link*, EOD* and other personal buttons come from greendeck.local.json.
 *   Presets (top left) switch several monitors at once; none defined yet.
 *
 *   Themes
 *   ┌──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┐
 *   │RAINBO│ EMBER│ OCEAN│ DUSK │CIRCUI│ GRID │ HEX  │ NEON │
 *   └──────┴──────┴──── ……… ────┴──────┴──────┴──────┴──────┘
 *   Wallpapers: press one to show it, the lit one again for black.
 *
 *   Monitors (MON › opens it)
 *   ┌──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┐
 *   │ MON1 │  DP  │  TB  │ HDMI │      │      │      │      │
 *   ├──────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
 *   │ MON2 │  DP  │  TB  │ HDMI │      │      │      │      │
 *   └──────┴──────┴──── ……… ────┴──────┴──────┴──────┴──────┘
 *
 *   Claude: one key per session (waiting first), on every non-nav key.
 *
 *   Data
 *   ┌──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┐
 *   │push a│push b│      │      │      │      │      │      │
 *   ├──────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
 *   │ stats│ LAT  │      │      │      │      │      │      │
 *   ├──────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
 *   │  MIC │ ◼◼◼◼◼◼◼◼◼◼◼◼◼◼ level meter ◼◼◼◼◼◼◼◼◼◼◼ │  ▲   │
 *   ├──────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
 *   │GAIN −│GAIN +│      │      │      │      │ title│  ▼   │
 *   └──────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┘
 *   LAT: press to time how fast the deck answers. The mic only listens while
 *   this page is showing.
 */
export function layout(engine: Engine, { push, mon1, mon2, td, ambient, wallpaper, claude, brightness, standby, system, fans, mic, positions, local }: Services): Pager {
  const key = (row: number, col: number) => row * 8 + col;

  engine.setBrightness(brightness.value);
  engine.onStop(brightness.subscribe(() => engine.setBrightness(brightness.value)));

  const showAmbient = () => engine.setBackground(ambient.current);
  showAmbient();
  engine.onStop(ambient.subscribe(showAmbient));
  // Standby is shared: every surface sleeps and wakes together.
  engine.setStandby(standby.on);
  engine.onStop(standby.subscribe(() => engine.setStandby(standby.on)));
  engine.mountStandby(key(3, 1), new WakeButton(standby));

  const pager = new Pager(engine, positions);
  pager.fixed(key(2, 7), new PageArrow(pager, 'up'));
  pager.fixed(key(3, 7), new PageArrow(pager, 'down'));
  pager.fixed(key(3, 6), new PageTitle(pager));

  // Personal buttons from greendeck.local.json go on their pages first, so
  // they win a key the built-in layout also uses.
  const putLocal = (page: string, put: (key: number, widget: Widget) => void) => {
    for (const link of local.links ?? []) {
      if (link.page !== page) continue;
      const { page: _p, at, ...rest } = link;
      const target = 'url' in rest ? { url: rest.url } : { app: rest.app };
      put(key(...at), new LinkButton(target, rest));
    }
    const eod = local.endOfDay;
    if (eod?.page === page) put(key(...eod.at), new EndOfDayButton(eod.url, { name: eod.name }));
  };

  const page = (name: string, build: (put: (key: number, widget: Widget) => void) => void) =>
    pager.page(name, (put) => {
      putLocal(name, put);
      build(put);
    });

  page('Main', (put) => {
    // Top left: monitor presets that switch several monitors at once, e.g.
    //   put(key(0, 0), new MonitorPreset('LAPTOP', [[mon1, 'tb'], [mon2, 'tb']]));
    put(key(0, 4), new ClaudeKey(claude));
    put(key(0, 5), new FanKey(system, fans));
    put(key(0, 6), new TempKey(system));
    put(key(0, 7), new LoadKey(system));
    put(key(1, 7), new PageLink(pager, 'Monitors', 'MON'));

    // TouchDesigner: names map to parameters in the project's greendeck COMP.
    put(key(2, 0), new RecordButton(td, 'record', { label: 'REC' }));
    put(key(2, 1), new TdToggle(td, 'cacherecord', { label: 'CACHE' }));

    put(key(3, 0), new SleepButton(standby));
    put(key(3, 1), new Clock());
    put(key(3, 5), new LinkButton({ url: 'http://localhost:9902/' }, { label: 'WEB DECK', icon: 'http://localhost:9902/favicon.svg' }));
  });

  // Wallpapers to pick from, eight to a row.
  page('Themes', (put) => {
    WALLPAPERS.forEach((choice, i) => put(key(Math.floor(i / 8), i % 8), new WallpaperButton(wallpaper, choice)));
  });

  // Individual input switching for each monitor.
  page('Monitors', (put) => {
    for (const [row, mon] of [[0, mon1], [1, mon2]] as const) {
      put(key(row, 0), new MonitorHeader(mon));
      put(key(row, 1), new MonitorInputButton(mon, 'dp'));
      put(key(row, 2), new MonitorInputButton(mon, 'tb'));
      put(key(row, 3), new MonitorInputButton(mon, 'hdmi'));
    }
  });

  // One key per Claude Code session, waiting ones first. Every key that isn't
  // a fixed nav key is a slot.
  page('Claude', (put) => {
    let slot = 0;
    for (let k = 0; k < 32; k++) if (!pager.isFixed(k)) put(k, new ClaudeSlot(claude, slot++));
  });

  page('Data', (put) => {
    put(key(0, 0), new PushValue(push, 'a'));
    put(key(0, 1), new PushValue(push, 'b'));
    put(key(1, 0), new EngineStatsWidget(engine));
    put(key(1, 1), new LatencyTester());
    put(key(2, 0), new MicReadout(mic));
    const METER = 6;
    for (let i = 0; i < METER; i++) put(key(2, 1 + i), new MicMeterSegment(mic, i, METER));
    put(key(3, 0), new MicGainButton(mic, -1));
    put(key(3, 1), new MicGainButton(mic, 1));
  });

  return pager;
}
