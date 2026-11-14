# greendeck

A custom control surface for the Elgato Stream Deck, written in TypeScript on
Node. It talks to the deck directly (no Elgato app or Companion), with a render
engine built for fast realtime data on the keys.

- **Realtime keys:** each key redraws only when its data changes and is only
  sent over USB if its pixels changed. Frames never queue, so keys show the
  latest value with at most one frame of lag.
- **Backgrounds:** one animated image across the whole panel (a rainbow wave or a
  pulsing warm glow) behind the buttons.
- **Virtual deck:** the same layout in a browser at http://localhost:9902, for
  working without hardware or as a second surface. It only renders while a page is open.
- **Background states:** named states light the whole deck to signal something
  (highest priority wins, plain black when none are active). Raise one from anywhere:
  `echo "bg.alert #d0343a 1.5 20" | nc -u -w0 127.0.0.1 9900` (colour, pulse seconds or 0
  for steady, priority), and `bg.alert off` to clear it.
- **Claude Code key:** shows how many Claude Code sessions are waiting on you (and pulses
  the deck amber); press it to jump to that session's terminal tab, and again to step
  through the others (exact tab in iTerm and Ghostty). The Claude page has one key per session. Needs `scripts/claude-status.sh`
  registered as an async Claude Code hook (see the script for the events).
- **Attention alert:** when something needs you (a Claude session waiting, or any
  program sending `attention.<name> on`), a red KITT-style scanner sweeps the top row
  twice, then rests 2 minutes, repeating until it's cleared.
- **Pages** with ▲ / ▼ / title keys, and a page picker, brightness slider and
  **Move buttons** mode (drag keys to rearrange; saved to `layout.local.json`) in the
  browser deck.
- **Hold-to-confirm** keys for anything consequential: stopping a recording, sleep,
  fans, end of day.
- **System keys:** CPU/GPU temperature and CPU/RAM load (via
  [macmon](https://github.com/vladkens/macmon), `brew install macmon`), and a fan key
  that toggles Macs Fan Control between Automatic and Full blast.
- **Link buttons** that open a site or app with its icon, and an End of Day button for
  a run-a-sequence web page.
- **Standby:** a SLEEP key darkens the deck; a WAKE key brings it back.
- **Push data in over UDP:** `echo "a 42.1" | nc -u -w0 127.0.0.1 9900`
- **TouchDesigner link:** two-way toggle/pulse control of parameters (see `td/`).
- **Monitor input switching** for Dell monitors via BetterDisplay (`dell-input`, a local script not included here).

## Run

Requires Node 23.6+ (runs the TypeScript directly). A Stream Deck is optional:
without one, use the virtual deck at http://localhost:9902.
Quit the Elgato app and Companion first, since only one app can use the deck at a time.

```sh
npm install
npm start
```

Or double-click `start-greendeck.command` in Finder (it restarts greendeck if it's
already running), and `stop-greendeck.command` to stop it.

Edit `src/layout.ts` to change what goes on each key.

| Env var | Default | |
|---|---|---|
| `GREENDECK_BRIGHTNESS` | 70 | Backlight % |
| `GREENDECK_MAX_FPS` | 60 | Frame-rate cap |
| `GREENDECK_PUSH_PORT` | 9900 | UDP port for pushed values |
| `GREENDECK_TD_PORT` | 9901 | TouchDesigner's UDP port |
| `GREENDECK_VIRTUAL_PORT` | 9902 | Browser deck port (0 to turn it off) |
| `GREENDECK_VIRTUAL_HOST` | 127.0.0.1 | Set to 0.0.0.0 to reach it from a phone. Anyone on your network can then press buttons |
| `GREENDECK_VIRTUAL_FPS` | 60 | Browser deck frame-rate cap |
| `GREENDECK_STATS` | | Set to log fps and keys/s every second |
| `GREENDECK_CONFIG` | | Start on this config (see below) instead of the one picked last |

## Personal buttons

Buttons for your own sites, apps and machines go in a config file in the
`configs` folder (git-ignored, and blocked by the pre-commit hook), not in the
code. Copy `greendeck.example.json` to `configs/default.json` to start.

### Switching configs

For more than one setup (a show, the office, ...), add a file per setup as
`configs/<name>.json`, in the same format. The CONFIG key on Main shows the config
in use and opens the Config page, which has a key per config file and a CONFIRM key
left of the page title. Switching takes two steps so it can't happen by accident:
tap a config to pick it (it turns amber), then hold CONFIRM for 3 seconds. The deck
then rebuilds its keys on the new config, staying on the Config page.

- The pick is dropped after 15 seconds, or when you leave the page.
- CONFIRM refuses while REC, OSC REC or TC REC is recording, and a recording that
  starts mid-hold cancels the hold.
- Picking the config already in use and confirming reloads its file, so you can
  edit it without restarting. New files show up the next time the deck rebuilds.

A config can also change the Themes page: `"themes": { "hide": ["rainbow"], "add":
["eagles"] }` drops RAINBOW and adds EAGLES, which only appears in configs that add
it.

The config in use is saved in `configs/active.txt`, so greendeck comes back on it after a
restart. Before anything's been picked it uses `default`, or the first config by
name if there's no `default.json`. `GREENDECK_CONFIG=<name>` overrides
that at startup.

## Lilliput monitors

The Monitors page's SDI row and the people's tally keys below it control Lilliput
monitors (UQ23) over UDP. Put them under `lilliput` in the config: `sdi`
for the SDI monitor, and `people` (name and IP, up to three) for the red / green
tally keys. The `label` is the monitor's on-screen label text (a person's defaults
to their name): the monitor can't report it back, so greendeck resends it with
every tally change. greendeck uses local UDP port 19522,
which only one program can receive on, so quit greendeck before using another
Lilliput control tool.

For a setup without the two Dell monitors, `"monitors": { "dells": false }` drops
the MON 1 / MON 2 rows, so the SDI row (and any tally keys) move to the top of the page.
It also drops the MON-SHOW and MON-TB presets from Main. Add `"sdiOnMain": true`
to the same block to put the SDI monitor's SDI 1, SDI 2 and HDMI keys on Main's top
left instead of the presets, with its RED, GREEN and YELLOW tallies on the row below
(columns 3–5).

## Browser deck on Tailscale

To use the browser deck from your other devices, share it on your tailnet (HTTPS,
tailnet only): `tailscale serve --bg 9902`. Anyone on the tailnet can then press
every button.

## TouchDesigner

In the TD Textport, run `td/install.py` to build a `greendeck` COMP, then map
names to parameters in its `bindings` table (`name | path | par`).

To drive the show's TD over its HTTP API instead, add a `td` block (`host`,
`port`, `apiKey`) to the config. REC then polls `GET /api/state`
every second, shows the take's running time, and a press sends
`POST /api/rec/start`. While recording it becomes a STOP key: pressing sends
`POST /api/rec/stop/hold`, and `POST /api/rec/stop/release` goes out when the
key's bar fills, while you're still holding (or when you let go early). TD ends
the take only if the release comes at least 1.5s after the hold, so the bar takes
1.8s to fill (slack for a slow link).

## OSC recorder and timecode Greenalyzer

Add an `oscRecorder` block (`host`, `port`) to the config for an
OSC REC key above REC. It polls `GET /api/status` every second (`recording`
is null when stopped), a press sends `POST /api/record/start`, and while
recording it's a STOP key: `POST /api/record/stop` goes out once it's been held
for 1s, without waiting for you to let go.
The recorder doesn't report how long the take has run, so the key times it
from when greendeck first saw it recording.

The same block gives a TC REC key to its right, for the SMPTE Timecode
Greenalyzer's recorder. The OSC listener (1.8.0 or later) relays to the
Greenalyzer page open on that machine: TC REC polls `GET
/api/greenalyzer/status`, and start and stop are `POST
/api/greenalyzer/record/start` and `/stop`, held the same way. The page has to
be open with REMOTE on, or the key reads "no page" ("page asleep" once it
stops reporting in, "page error" when it can't write its file) and a start
would be lost. The take's time comes from the page's own `started` stamp.

## Keeping secrets out

This repo is public. `npm install` turns on a pre-commit hook (`.githooks/`)
that blocks `.env`, key and `*.local.*` files and runs
[gitleaks](https://github.com/gitleaks/gitleaks) (`brew install gitleaks`) on
staged changes. CI runs the same scan on every push. Put machine-specific
config in `*.local.*` files or env vars, which are git-ignored.
