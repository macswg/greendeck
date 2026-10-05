#!/bin/zsh
# Double-click to stop greendeck. The deck goes back to the Elgato logo.

cd "${0:A:h}" || exit 1
MAIN="$PWD/src/main.ts"
running() { pgrep -f "node $MAIN" >/dev/null || pgrep -fx "node src/main.ts" >/dev/null; }

if ! running; then
  echo "greendeck isn't running."
else
  echo "Stopping greendeck…"
  # A normal shutdown first (hands the deck back cleanly), then force it.
  pkill -INT -f "node $MAIN"; pkill -INT -fx "node src/main.ts"
  for i in {1..30}; do running || break; sleep 0.2; done
  if running; then
    pkill -KILL -f "node $MAIN"; pkill -KILL -fx "node src/main.ts"
    echo "greendeck didn't stop on its own, so it was forced to quit."
  else
    echo "greendeck stopped."
  fi
fi
exit 0
