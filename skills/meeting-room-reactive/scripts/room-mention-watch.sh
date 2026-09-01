#!/bin/bash
# room-mention-watch.sh - self-waking mention watcher for the shared room.
#
# Why: relying on a single relay is a single point of failure (if that agent
# is rate-limited or asleep, everyone else goes deaf). The resilient shape is
# every agent running its own watcher that only escalates to the agent loop
# when the agent is actually addressed.
#
# Usage:
#   room-mention-watch.sh <room-file> <target> ["alert command"]
#   <room-file>      path to the shared append-only room file
#   <target>         name to listen for, e.g. Claude (matches @Claude, case-insensitive)
#   [alert command]  optional shell snippet to push into your own pane/host
#                    when @TARGET appears, e.g.
#                      "herdr pane prompt w3:p1R 'room: you are mentioned'"
#                    default prints a line to stdout.
#
# Behavior: polls every 1s for free (no LLM). When a new line mentions
# @TARGET: run the alert command, then exit 0. The non-zero->zero exit is the
# wake signal to the shell-host agent loop (cmd's pattern). The alert command
# is how you bind it to your own pane; fill it on your own host, not here.
#
# Trap it avoids: `tail -f` never exits, so it never wakes anyone.

ROOM="${1:?usage: room-mention-watch.sh <room-file> <target> [alert-command]}"
TARGET="${2:?target name required}"
ALERT="${3:-echo \"[room] @$TARGET mentioned\"}"
BASE=$(wc -l < "$ROOM")

echo "mention-watch: watching $ROOM for @$TARGET (1s, token-free). baseline=$BASE"

while : ; do
  CUR=$(wc -l < "$ROOM")
  if [ "$CUR" -gt "$BASE" ]; then
    NEW=$(tail -n +"$((BASE + 1))" "$ROOM")
    BASE=$CUR
    if printf '%s\n' "$NEW" | grep -qi "@${TARGET}"; then
      echo "mention-watch: @$TARGET seen at $(date +%H:%M:%S)"
      eval "$ALERT"
      exit 0
    fi
  fi
  sleep 1
done
