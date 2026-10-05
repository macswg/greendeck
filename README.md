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

## TouchDesigner

In the TD Textport, run `td/install.py` to build a `greendeck` COMP, then map
names to parameters in its `bindings` table (`name | path | par`).

## Keeping secrets out

This repo is public. `npm install` turns on a pre-commit hook (`.githooks/`)
that blocks `.env`, key and `*.local.*` files and runs
[gitleaks](https://github.com/gitleaks/gitleaks) (`brew install gitleaks`) on
staged changes. CI runs the same scan on every push. Put machine-specific
config in `*.local.*` files or env vars, which are git-ignored.
