#!/usr/bin/env bash
# Dev loop for the room-change detector (agent_context/detect.py).
#
#   ./scripts/room-change-dev.sh            # tests + offline self-test
#   ./scripts/room-change-dev.sh watch      # rerun on every save of the module
#   ./scripts/room-change-dev.sh live       # include a real backend inference
#   ./scripts/room-change-dev.sh pair a.jpg b.jpg [extra flags]
#
# PY overrides the interpreter (default .venv-vlm/bin/python).
set -euo pipefail
cd "$(dirname "$0")/.."
PY=${PY:-.venv-vlm/bin/python}

run_suite() {
  echo "== unittest =="
  "$PY" -m unittest discover -s tests/python -q
  echo "== self-test =="
  "$PY" -m agent_context.detect --self-test
}

case "${1:-all}" in
  all)   run_suite ;;
  test)  "$PY" -m unittest discover -s tests/python -v ;;
  self)  "$PY" -m agent_context.detect --self-test ;;
  live)  "$PY" -m agent_context.detect --self-test --live ;;
  pair)
    shift
    [ $# -ge 2 ] || { echo "usage: $0 pair BEFORE AFTER [flags]" >&2; exit 2; }
    before=$1; after=$2; shift 2
    start=$(date +%s%N)
    "$PY" -m agent_context.detect "$before" "$after" --pretty "$@"
    echo "wall: $(( ($(date +%s%N) - start) / 1000000 )) ms" >&2
    ;;
  watch)
    echo "watching agent_context/ — Ctrl-C to stop"
    last=""
    while true; do
      cur=$(find agent_context tests/python -name '*.py' -print0 \
            | sort -z | xargs -0 cat | md5sum)
      if [ "$cur" != "$last" ]; then
        last=$cur
        clear
        if run_suite; then echo "OK $(date +%H:%M:%S)"; else echo "FAIL $(date +%H:%M:%S)"; fi
      fi
      sleep 2
    done
    ;;
  *)
    echo "unknown command: $1 (all|test|self|live|pair|watch)" >&2
    exit 2
    ;;
esac
