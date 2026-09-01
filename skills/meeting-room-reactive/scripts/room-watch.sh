#!/bin/bash
# room-watch.sh - token-free 1s watcher for the shared meeting room.
#
# The point: watching every second must never cost an LLM turn per second.
# This is a plain shell loop (free). Only a REAL change should ever escalate
# to an LLM, and it does so in one of two modes.
#
# Usage:
#   room-watch.sh <room-file> [wake-file] [exit-on-change]
#   <room-file>     path to the shared meeting room file (append-only)
#   [wake-file]     default /tmp/room-wake.txt ; new lines land here
#   [exit-on-change] if exactly "1", exit 0 the moment a new line appears
#                    (cmd/Claude shell-host pattern: the exit wakes the agent loop)
#
# Mode A (aside / background): pass NO third arg. Loop runs forever, appends
#   only the genuinely new lines to $WAKE. An LLM is never invoked here; a
#   session reads $WAKE for free when it chooses, and pays tokens only when
#   it acts on actual content.
#
# Mode B (shell-host agent): pass third arg `1`. On the first new line, append
#   to $WAKE and exit 0. The non-zero->zero exit is the wake signal to the
#   agent loop; the agent replies, then re-arms with a fresh baseline.
#
# Trap it avoids: `tail -f` never exits, so it never wakes any host. This loop
# either escalates on change (Mode B) or leaves a zero-cost marker (Mode A).

ROOM="${1:?usage: room-watch.sh <room-file> [wake-file] [exit-on-change]}"
WAKE="${2:-/tmp/room-wake.txt}"
EXIT_ON_CHANGE="${3:-0}"
BLINE="${WAKE}.baseline"

: > "$WAKE"
wc -l < "$ROOM" > "$BLINE"
echo "room-watch: watching $ROOM every 1s (token-free). new lines -> $WAKE"
echo "summary: $(wc -l < "$ROOM") lines at baseline"

while : ; do
  CUR=$(wc -l < "$ROOM")
  BASE=$(cat "$BLINE")
  if [ "$CUR" -gt "$BASE" ]; then
    tail -n +"$((BASE + 1))" "$ROOM" >> "$WAKE"
    echo "$CUR" > "$BLINE"
    echo "room-watch: +$((CUR - BASE)) new line(s) at $(date +%H:%M:%S)"
    if [ "$EXIT_ON_CHANGE" = "1" ]; then
      exit 0
    fi
  fi
  sleep 1
done
