#!/bin/sh
# Claude Code hook: reports this session's state to greendeck over UDP, so the
# deck can show which sessions are waiting on you and jump to their terminal.
# Register it (async) for UserPromptSubmit, PostToolUse, Notification,
# PermissionRequest, Stop, StopFailure, SessionStart and SessionEnd. The event
# name arrives on stdin with the rest of the hook input.
#
# Sends: claude.<session_id> <working|waiting|idle|ended> <terminal app> <terminal session id> <cwd>
# (the terminal session id is iTerm's $ITERM_SESSION_ID, or - when there isn't one)

jq -r --arg term "${TERM_PROGRAM:--}" --arg termsession "${ITERM_SESSION_ID:--}" '
  {
    UserPromptSubmit: "working", PostToolUse: "working",
    Notification: "waiting", PermissionRequest: "waiting",
    Stop: "waiting", StopFailure: "waiting",
    SessionStart: "idle", SessionEnd: "ended"
  }[.hook_event_name] as $state
  | select($state)
  | "claude.\(.session_id) \($state) \($term | gsub(" "; "_")) \($termsession | gsub(" "; "_")) \(.cwd // "-")"
' | nc -u -w0 127.0.0.1 "${GREENDECK_PUSH_PORT:-9900}"
exit 0
