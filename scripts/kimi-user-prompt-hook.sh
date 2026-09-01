#!/usr/bin/env bash
# unified-agent-context: kimi UserPromptSubmit shell hook.
# 세션당 첫 사용자 프롬프트에만 공유 컨텍스트 블록을 주입한다.
# stdin: kimi hook JSON payload (session_id, cwd, ...) / stdout: 컨텍스트에 append될 텍스트.
# fail-open: 어떤 오류든 exit 0 (세션을 죽이지 않는다).
set -uo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

PAYLOAD=$(cat -)

read -r SESSION_ID CWD < <(printf '%s' "$PAYLOAD" | python3 -c 'import json,sys
try:
    p = json.load(sys.stdin)
    print(p.get("session_id") or "unknown", p.get("cwd") or "")
except Exception:
    print("unknown", "")' 2>/dev/null || echo "unknown ")

# 세션당 1회 가드 — 마커가 있으면 조용히 종료
MARKER="${TMPDIR:-/tmp}/uac-kimi-injected-${SESSION_ID}"
if [ -f "$MARKER" ]; then
  exit 0
fi

if [ -n "$CWD" ] && [ -d "$CWD" ]; then
  BLOCK=$(node "$REPO_ROOT/scripts/inject-context.mjs" --cwd "$CWD" 2>/dev/null || true)
else
  BLOCK=$(node "$REPO_ROOT/scripts/inject-context.mjs" 2>/dev/null || true)
fi

if [ -n "$BLOCK" ]; then
  printf '%s\n' "$BLOCK"
  touch "$MARKER" 2>/dev/null || true
fi

exit 0
