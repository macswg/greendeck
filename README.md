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

Edit `src/layout.ts` to change what goes on each key.

| Env var | Default | |
|---|---|---|
| `GREENDECK_BRIGHTNESS` | 70 | Backlight % |
| `GREENDECK_MAX_FPS` | 60 | Frame-rate cap |
| `GREENDECK_PUSH_PORT` | 9900 | UDP port for pushed values |
| `GREENDECK_TD_PORT` | 9901 | TouchDesigner's UDP port |
| `GREENDECK_VIRTUAL_PORT` | 9902 | Browser deck port (0 to turn it off) |
| `GREENDECK_VIRTUAL_HOST` | 127.0.0.1 | Set to 0.0.0.0 to reach it from a phone. Anyone on your network can then press buttons |
| `GREENDECK_VIRTUAL_FPS` | 30 | Browser deck frame-rate cap |
| `GREENDECK_STATS` | | Set to log fps and keys/s every second |

## Personal buttons

Buttons for your own sites, apps and machines go in `greendeck.local.json` (git-ignored),
not in the code. Copy `greendeck.example.json` to start.

## Browser deck on Tailscale

To use the browser deck from your other devices, share it on your tailnet (HTTPS,
tailnet only): `tailscale serve --bg 9902`. Anyone on the tailnet can then press
every button.

## TouchDesigner

In the TD Textport, run `td/install.py` to build a `greendeck` COMP, then map
names to parameters in its `bindings` table (`name | path | par`).

## Keeping secrets out

This repo is public. `npm install` turns on a pre-commit hook (`.githooks/`)
that blocks `.env`, key and `*.local.*` files and runs
[gitleaks](https://github.com/gitleaks/gitleaks) (`brew install gitleaks`) on
staged changes. CI runs the same scan on every push. Put machine-specific
config in `*.local.*` files or env vars, which are git-ignored.
