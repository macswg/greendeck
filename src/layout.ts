import { Ambient } from './ambient.ts';
import { ColorPulse } from './background.ts';
import { ClaudeSessions } from './claude.ts';
import { colors } from './draw.ts';
import type { Engine } from './engine.ts';
import { Pager } from './pages.ts';
import type { PushHub } from './push.ts';
import { TouchDesigner } from './td.ts';
import { CLAUDE_COLOR, ClaudeKey, ClaudeSlot } from './widgets/claude.ts';
import { PageArrow, PageTitle } from './widgets/nav.ts';
import { Monitor, MonitorHeader, MonitorInputButton } from './widgets/monitor.ts';
import { Clock, CpuGraph, EngineStatsWidget, PushValue } from './widgets/realtime.ts';
import { SleepButton, WakeButton } from './widgets/standby.ts';
import { TdToggle } from './widgets/td.ts';

/**
 * Long-lived state that outlives a deck reconnect. Created once at startup.
 */
export function createServices(push: PushHub) {
  const mon1 = new Monitor(1);
  const mon2 = new Monitor(2);
  mon1.startPolling();
  mon2.startPolling();
  const td = new TouchDesigner(push, { port: Number(process.env.GREENDECK_TD_PORT ?? 9901) });
  td.start();

  // Background states, highest priority wins. Claude waiting on you is the
  // first; more (recording, alerts, ...) go here.
  const ambient = new Ambient(push);
  const claude = new ClaudeSessions(push);
  const claudeWaiting = new ColorPulse(CLAUDE_COLOR, { period: 3, min: 0.1, max: 0.45 });
  claude.subscribe(() => {
    if (claude.waiting.length) ambient.set('claude-waiting', claudeWaiting, 10);
    else ambient.clear('claude-waiting');
  });

  return { push, mon1, mon2, td, ambient, claude };
}

export type Services = ReturnType<typeof createServices>;

/**
 * What goes on which key. The XL is 8 columns x 4 rows; key index = row * 8 + col.
 * The three bottom-right keys are fixed on every page: ▲ / ▼ change page and
 * the title shows where you are (press it to go back to the first page).
 *
 *   Main
 *   ┌──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┐
 *   │ MON1 │  DP  │  TB  │ HDMI │      │CLAUDE│ clock│  CPU │
 *   ├──────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
 *   │ MON2 │  DP  │  TB  │ HDMI │      │      │      │      │
 *   ├──────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
 *   │  REC │ CACHE│      │      │      │      │      │  ▲   │
 *   ├──────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
 *   │ SLEEP│ WAKE*│      │      │      │      │ title│  ▼   │
 *   └──────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┘
 *   * WAKE only appears in standby, when it's the only lit key.
 *
 *   Claude: one key per session (waiting first), on every non-nav key.
 *
 *   Data
 *   ┌──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┐
 *   │push a│push b│      │      │      │      │      │      │
 *   ├──────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
 *   │ stats│      │      │      │      │      │      │      │
 *   └──────┴──────┴──── ……… ────┴──────┴──────┴──────┴──────┘
 */
export function layout(engine: Engine, { push, mon1, mon2, td, ambient, claude }: Services): Pager {
  const key = (row: number, col: number) => row * 8 + col;

  const showAmbient = () => engine.setBackground(ambient.current);
  showAmbient();
  engine.onStop(ambient.subscribe(showAmbient));
  engine.mountStandby(key(3, 1), new WakeButton(engine));

  const pager = new Pager(engine);
  pager.fixed(key(2, 7), new PageArrow(pager, 'up'));
  pager.fixed(key(3, 7), new PageArrow(pager, 'down'));
  pager.fixed(key(3, 6), new PageTitle(pager));

  pager.page('Main', (put) => {
    for (const [row, mon] of [[0, mon1], [1, mon2]] as const) {
      put(key(row, 0), new MonitorHeader(mon));
      put(key(row, 1), new MonitorInputButton(mon, 'dp'));
      put(key(row, 2), new MonitorInputButton(mon, 'tb'));
      put(key(row, 3), new MonitorInputButton(mon, 'hdmi'));
    }
    put(key(0, 5), new ClaudeKey(claude));
    put(key(0, 6), new Clock());
    put(key(0, 7), new CpuGraph());

    // TouchDesigner: names map to parameters in the project's greendeck COMP.
    put(key(2, 0), new TdToggle(td, 'record', { label: 'REC', onColor: colors.error }));
    put(key(2, 1), new TdToggle(td, 'cacherecord', { label: 'CACHE', onColor: colors.pending }));

    put(key(3, 0), new SleepButton(engine));
  });

  // One key per Claude Code session, waiting ones first. Every key that isn't
  // a fixed nav key is a slot.
  pager.page('Claude', (put) => {
    let slot = 0;
    for (let k = 0; k < 32; k++) if (!pager.isFixed(k)) put(k, new ClaudeSlot(claude, slot++));
  });

  pager.page('Data', (put) => {
    put(key(0, 0), new PushValue(push, 'a'));
    put(key(0, 1), new PushValue(push, 'b'));
    put(key(1, 0), new EngineStatsWidget(engine));
  });

  return pager;
}
