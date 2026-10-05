#!/bin/zsh
# Double-click to start greendeck (or restart it, if it's already running).
# Keep this Terminal window open while you use the deck; close it to stop.

cd "${0:A:h}" || exit 1
# A double-clicked script may not load your shell setup, so make sure node
# and the tools greendeck calls (macmon, ...) are on the PATH.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"

if ! command -v node >/dev/null; then
  echo "greendeck needs Node.js: brew install node"
  read -k1 "?Press any key to close."
  exit 1
fi
[ -d node_modules ] || npm install

# Only one copy can hold the Stream Deck and its ports, so stop any other.
# Matched by this folder's full path, so nothing else is touched (the older
# "node src/main.ts" form is caught too).
MAIN="$PWD/src/main.ts"
running() { pgrep -f "node $MAIN" >/dev/null || pgrep -fx "node src/main.ts" >/dev/null; }
if running; then
  echo "Stopping the greendeck that's already running…"
  pkill -INT -f "node $MAIN"; pkill -INT -fx "node src/main.ts"
  for i in {1..30}; do running || break; sleep 0.2; done
  pkill -KILL -f "node $MAIN" 2>/dev/null; pkill -KILL -fx "node src/main.ts" 2>/dev/null
fi

printf '\e]0;greendeck\a'
echo "Starting greendeck. Browser deck: http://localhost:9902"
exec node "$MAIN"
