#!/usr/bin/env bash
# unified-agent-context: hermes pre_llm_call shell hook.
# 첫 턴(is_first_turn)에만 공유 컨텍스트 블록을 주입한다.
# stdin: hermes JSON payload / stdout: {"context": "..."} 또는 없음.
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

PAYLOAD=$(cat -)
IS_FIRST=$(printf '%s' "$PAYLOAD" | python3 -c 'import json,sys
try:
    p = json.load(sys.stdin)
    print("1" if p.get("extra", {}).get("is_first_turn") else "0")
except Exception:
    print("0")')

if [ "$IS_FIRST" != "1" ]; then
  exit 0
fi

BLOCK=$(node "$REPO_ROOT/scripts/inject-context.mjs" 2>/dev/null || true)
REG_BLOCK=$(bash "${HERMES_HOME:-${HOME}/.hermes}/scripts/agent-registry-inject.sh" 2>/dev/null || true)

if [ -n "$BLOCK" ] || [ -n "$REG_BLOCK" ]; then
  if [ -n "$BLOCK" ] && [ -n "$REG_BLOCK" ]; then
    printf '%s\n\n%s\n' "$BLOCK" "$REG_BLOCK" | python3 -c 'import json,sys; print(json.dumps({"context": sys.stdin.read()}))'
  else
    printf '%s\n' "$BLOCK$REG_BLOCK" | python3 -c 'import json,sys; print(json.dumps({"context": sys.stdin.read()}))'
  fi
fi
