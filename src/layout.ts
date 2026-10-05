import { WarmGlow } from './background.ts';
import { colors } from './draw.ts';
import type { Engine } from './engine.ts';
import type { PushHub } from './push.ts';
import { TouchDesigner } from './td.ts';
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
  return { push, mon1, mon2, td };
}

export type Services = ReturnType<typeof createServices>;

/**
 * What goes on which key. The XL is 8 columns x 4 rows; key index = row * 8 + col.
 *
 *   ┌──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┐
 *   │ MON1 │  DP  │  TB  │ HDMI │      │      │ clock│  CPU │
 *   ├──────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
 *   │ MON2 │  DP  │  TB  │ HDMI │      │      │      │      │
 *   ├──────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
 *   │  REC │ CACHE│      │      │      │      │      │push a│
 *   ├──────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
 *   │ SLEEP│ WAKE*│      │      │      │      │push b│ stats│
 *   └──────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┘
 *   * WAKE only appears in standby, when it's the only lit key.
 */
export function layout(engine: Engine, { push, mon1, mon2, td }: Services): void {
  const key = (row: number, col: number) => row * 8 + col;

  engine.setBackground(new WarmGlow());

  for (const [row, mon] of [[0, mon1], [1, mon2]] as const) {
    engine.mount(key(row, 0), new MonitorHeader(mon));
    engine.mount(key(row, 1), new MonitorInputButton(mon, 'dp'));
    engine.mount(key(row, 2), new MonitorInputButton(mon, 'tb'));
    engine.mount(key(row, 3), new MonitorInputButton(mon, 'hdmi'));
  }

  // TouchDesigner: names map to parameters in the project's greendeck COMP.
  engine.mount(key(2, 0), new TdToggle(td, 'record', { label: 'REC', onColor: colors.error }));
  engine.mount(key(2, 1), new TdToggle(td, 'cacherecord', { label: 'CACHE', onColor: colors.pending }));

  engine.mount(key(3, 0), new SleepButton(engine));
  engine.mountStandby(key(3, 1), new WakeButton(engine));

  engine.mount(key(0, 6), new Clock());
  engine.mount(key(0, 7), new CpuGraph());
  engine.mount(key(2, 7), new PushValue(push, 'a'));
  engine.mount(key(3, 6), new PushValue(push, 'b'));
  engine.mount(key(3, 7), new EngineStatsWidget(engine));
}
