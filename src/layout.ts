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
import { Configs, type LilliputConfig, type LocalConfig } from './config.ts';
import { Lilliput } from './lilliput.ts';
import { GreenalyzerRecorder, OscRecorder } from './oscrec.ts';
import type { Widget } from './widget.ts';
import type { PushHub } from './push.ts';
import { TouchDesigner } from './td.ts';
import { TdApi } from './tdapi.ts';
import { themesFor, Wallpaper } from './wallpaper.ts';
import { ClaudeKey, ClaudeSlot } from './widgets/claude.ts';
import { EndOfDayButton } from './widgets/endofday.ts';
import { LatencyTester } from './widgets/latency.ts';
import { LinkButton } from './widgets/link.ts';
import { MicGainButton, MicMeterSegment, MicReadout } from './widgets/mic.ts';
import { ConfigButton, ConfigChoice, ConfigLink, ConfirmSwitch, type Guard } from './widgets/config.ts';
import { PageArrow, PageLink, PageTitle } from './widgets/nav.ts';
import { Monitor, MonitorHeader, MonitorInputButton, MonitorPreset } from './widgets/monitor.ts';
import { SdiHeader, SdiInputButton, SdiMonitor, TallyButton, TallyLight } from './widgets/sdi.ts';
import { Clock, EngineStatsWidget, FanKey, LoadKey, PushValue, TempKey } from './widgets/realtime.ts';
import { SleepButton, WakeButton } from './widgets/standby.ts';
import { WallpaperButton } from './widgets/wallpaper.ts';
import { RecordButton, tdApiRecorder, tdRecorder } from './widgets/td.ts';

/**
 * Long-lived state that outlives a deck reconnect. Created once at startup.
 */
export function createServices(push: PushHub, opts: { brightness: number }) {
  const mon1 = new Monitor(1);
  const mon2 = new Monitor(2);
  mon1.startPolling();
  mon2.startPolling();
  // Which config in configs/ is in use (default.json, or another picked on the
  // Config page) and what's built from it; switching rebuilds the layouts.
  const configs = new Configs(configServices, process.env.GREENDECK_CONFIG);
  const td = new TouchDesigner(push, { port: Number(process.env.GREENDECK_TD_PORT ?? 9901) });
  td.start();

  // Background states, highest priority wins. Claude waiting on you is the
  // first; more (recording, alerts, ...) go here.
  const ambient = new Ambient(push);
  // The resting background under every state; picked from keys on Main.
  const wallpaper = new Wallpaper(ambient);
  // A theme the new config doesn't offer goes off when switching to it.
  configs.subscribe(() => {
    const id = wallpaper.current;
    if (id && !themesFor(configs.local).some((w) => w.id === id)) void wallpaper.toggle(id);
  });
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

  return { push, mon1, mon2, configs, td, ambient, wallpaper, attention, claude, brightness, standby, system, fans, mic, positions };
}

export type Services = ReturnType<typeof createServices>;

function guard(label: string, recorder: { readonly recording: boolean; subscribe(fn: () => void): () => void }): Guard {
  return { label, get recording() { return recorder.recording; }, subscribe: (fn) => recorder.subscribe(fn) };
}

/**
 * Everything built from a config file. Rebuilt when the config is switched,
 * after stop() has ended the old one's polling.
 */
function configServices(local: LocalConfig) {
  const polling: { stopPolling(): void }[] = [];
  const poll = <T extends { startPolling(): void; stopPolling(): void }>(service: T): T => {
    service.startPolling();
    polling.push(service);
    return service;
  };
  // Lilliput monitors. Without an SDI monitor its buttons just remember
  // what's pressed; people's tallies only appear when configured, since their
  // names live there too.
  const lilliput = (config: LilliputConfig) => poll(new Lilliput(config.ip, config.label));
  const sdiConfig = local.lilliput?.sdi;
  const sdi = new SdiMonitor(sdiConfig && lilliput(sdiConfig));
  const people = local.lilliput?.people ?? [];
  if (people.length > 3) console.warn(`lilliput: only the first 3 of ${people.length} people fit on the Monitors page`);
  const tallies = people.slice(0, 3).map((p) => new TallyLight(p.name, lilliput({ ...p, label: p.label ?? p.name })));
  // The show's TD over HTTP, when the config has a `td` block.
  const tdApi = local.td && poll(new TdApi(local.td));
  // The show machine's OSC recorder, and the Greenalyzer its listener relays
  // to, when the config has an `oscRecorder` block.
  const oscRecorder = local.oscRecorder && poll(new OscRecorder(local.oscRecorder));
  const greenalyzer = local.oscRecorder && poll(new GreenalyzerRecorder(local.oscRecorder));
  return {
    local, sdi, tallies, tdApi, oscRecorder, greenalyzer,
    stop: () => polling.forEach((service) => service.stopPolling()),
  };
}

/**
 * What goes on which key. The XL is 8 columns x 4 rows; key index = row * 8 + col.
 * The three bottom-right keys are fixed on every page: ▲ / ▼ change page and
 * the title shows where you are (press it to go back to the first page).
 *
 *   Main
 *   ┌──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┐
 *   │ MON- │ MON- │      │      │CLAUDE│ FANS │ TEMP │ LOAD │
 *   │ SHOW │  TB  │      │      │      │      │      │      │
 *   ├──────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
 *   │OSC*  │ TC*  │      │      │ link*│ EOD* │CONFIG│ MON ›│
 *   │ REC  │ REC  │      │      │      │      │ name │      │
 *   ├──────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
 *   │  REC │      │      │      │      │      │      │  ▲   │
 *   ├──────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
 *   │ SLEEP│clock*│      │      │      │ WEB  │ title│  ▼   │
 *   └──────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┘
 *   * In standby the clock's key shows WAKE instead, the only lit key.
 *   link*, EOD* and other personal buttons come from the config in use,
 *   and OSC REC* and TC REC* only appear when the OSC listener they talk to
 *   is configured there.
 *   CONFIG shows the config in use and opens the Config page.
 *   Presets (top left) switch several monitors at once. MON-SHOW puts MON 1
 *   on DP, MON 2 on HDMI and the SDI monitor on SDI 1; MON-TB puts both
 *   Dells on Thunderbolt.
 *
 *   Themes
 *   ┌──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┐
 *   │RAINBO│ EMBER│ OCEAN│ DUSK │CIRCUI│ GRID │ HEX  │ NEON │
 *   └──────┴──────┴──── ……… ────┴──────┴──────┴──────┴──────┘
 *   Wallpapers: press one to show it, the lit one again for black. A config
 *   can hide some and add optional ones (EAGLES) under `themes`.
 *
 *   Monitors (MON › opens it)
 *   ┌──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┐
 *   │ MON1 │  DP  │  TB  │ HDMI │      │      │      │      │
 *   ├──────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
 *   │ MON2 │  DP  │  TB  │ HDMI │      │      │      │      │
 *   ├──────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
 *   │SDIMON│ SDI 1│ SDI 2│ RED  │GREEN │YELLOW│      │  ▲   │
 *   ├──────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
 *   │PERSON│PERSON│PERSON│PERSON│PERSON│PERSON│ title│  ▼   │
 *   │ 1 red│1 grn │ 2 red│2 grn │ 3 red│3 grn │      │      │
 *   └──────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┘
 *   The SDI row and the people's tallies below it drive Lilliput monitors
 *   over the LAN (IPs in the config). Tallies are lit only while
 *   held, one colour per tally at a time. A config with
 *   `"monitors": { "dells": false }` drops the MON1 / MON2 rows and moves
 *   the SDI row and tallies up to the top, and drops MON-SHOW and MON-TB
 *   from Main. `"sdiOnMain": true` there puts copies of SDI 1, SDI 2, RED
 *   and GREEN on Main's top left instead of the presets.
 *
 *   Claude: one key per session (waiting first), on every non-nav key.
 *
 *   Config: one key per config file, the one in use lit, and CONFIRM left of
 *   the title. Tap a config to pick it, then hold CONFIRM for 3 s to switch
 *   (or, for the one in use, reload its file). The pick is dropped after 15 s
 *   or on leaving the page, and CONFIRM refuses while anything is recording.
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
export function layout(engine: Engine, { push, mon1, mon2, configs, td, ambient, wallpaper, claude, brightness, standby, system, fans, mic, positions }: Services): Pager {
  const { local, sdi, tallies, tdApi, oscRecorder, greenalyzer } = configs.current;
  const key = (row: number, col: number) => row * 8 + col;
  const hasDells = local.monitors?.dells !== false;

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

  // Personal buttons from the config go on their pages first, so
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

  // The REC key's recorder. With the others, it blocks a config switch while
  // it's recording.
  const rec = tdApi ? tdApiRecorder(tdApi) : tdRecorder(td, 'record');
  const guards: Guard[] = [
    guard('REC', rec),
    ...(oscRecorder ? [guard('OSC REC', oscRecorder)] : []),
    ...(greenalyzer ? [guard('TC REC', greenalyzer)] : []),
  ];

  const page = (name: string, build: (put: (key: number, widget: Widget) => void) => void) =>
    pager.page(name, (put) => {
      putLocal(name, put);
      build(put);
    });

  page('Main', (put) => {
    // Top left: either copies of the SDI monitor's keys, or monitor presets
    // that switch several monitors at once. The presets are built around the
    // Dells, so they go when a config drops them.
    if (local.monitors?.sdiOnMain) {
      put(key(0, 0), new SdiInputButton(sdi, 1));
      put(key(0, 1), new SdiInputButton(sdi, 2));
      put(key(0, 2), new TallyButton(sdi.tally, 'red'));
      put(key(0, 3), new TallyButton(sdi.tally, 'green'));
    } else if (hasDells) {
      put(key(0, 0), new MonitorPreset('MON-SHOW', [[mon1, 'dp'], [mon2, 'hdmi']], [sdi, 1]));
      put(key(0, 1), new MonitorPreset('MON-TB', [[mon1, 'tb'], [mon2, 'tb']]));
    }
    put(key(0, 4), new ClaudeKey(claude));
    put(key(0, 5), new FanKey(system, fans));
    put(key(0, 6), new TempKey(system));
    put(key(0, 7), new LoadKey(system));
    put(key(1, 7), new PageLink(pager, 'Monitors', 'MON'));
    put(key(1, 6), new ConfigLink(pager, configs));

    // The show machine's OSC recorder and the timecode Greenalyzer its
    // listener relays to: press to start, hold to stop, like REC.
    if (oscRecorder) put(key(1, 0), new RecordButton(oscRecorder, { label: 'OSC REC' }));
    if (greenalyzer) put(key(1, 1), new RecordButton(greenalyzer, { label: 'TC REC' }));
    // TouchDesigner: names map to parameters in the project's greendeck COMP.
    put(key(2, 0), new RecordButton(rec, { label: 'REC' }));

    put(key(3, 0), new SleepButton(standby));
    put(key(3, 1), new Clock());
    put(key(3, 5), new LinkButton({ url: 'http://localhost:9902/' }, { label: 'WEB DECK', icon: 'http://localhost:9902/favicon.svg' }));
  });

  // Wallpapers to pick from, eight to a row.
  page('Themes', (put) => {
    themesFor(local).forEach((choice, i) => put(key(Math.floor(i / 8), i % 8), new WallpaperButton(wallpaper, choice)));
  });

  // Individual input switching for each monitor.
  // A config can drop the Dells' rows, moving the Lilliput rows up.
  page('Monitors', (put) => {
    const dells = hasDells ? [mon1, mon2] : [];
    dells.forEach((mon, row) => {
      put(key(row, 0), new MonitorHeader(mon));
      put(key(row, 1), new MonitorInputButton(mon, 'dp'));
      put(key(row, 2), new MonitorInputButton(mon, 'tb'));
      put(key(row, 3), new MonitorInputButton(mon, 'hdmi'));
    });
    const sdiRow = dells.length;
    put(key(sdiRow, 0), new SdiHeader(sdi));
    put(key(sdiRow, 1), new SdiInputButton(sdi, 1));
    put(key(sdiRow, 2), new SdiInputButton(sdi, 2));
    put(key(sdiRow, 3), new TallyButton(sdi.tally, 'red'));
    put(key(sdiRow, 4), new TallyButton(sdi.tally, 'green'));
    put(key(sdiRow, 5), new TallyButton(sdi.tally, 'yellow'));
    tallies.forEach((light, i) => {
      put(key(sdiRow + 1, i * 2), new TallyButton(light, 'red'));
      put(key(sdiRow + 1, i * 2 + 1), new TallyButton(light, 'green'));
    });
  });

  // One key per Claude Code session, waiting ones first. Every key that isn't
  // a fixed nav key is a slot.
  page('Claude', (put) => {
    let slot = 0;
    for (let k = 0; k < 32; k++) if (!pager.isFixed(k)) put(k, new ClaudeSlot(claude, slot++));
  });

  // One key per config file. Tapping one only picks it; CONFIRM (held 3 s)
  // switches, and won't while anything is recording.
  page('Config', (put) => {
    const choice = new ConfigChoice();
    const confirmKey = key(3, 5);
    put(confirmKey, new ConfirmSwitch(configs, choice, guards));
    const free = [...Array(32).keys()].filter((k) => !pager.isFixed(k) && k !== confirmKey);
    const names = configs.names;
    if (names.length > free.length) console.warn(`config: only ${free.length} of ${names.length} configs fit on the Config page`);
    names.slice(0, free.length).forEach((name, i) => put(free[i]!, new ConfigButton(configs, choice, name)));
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
