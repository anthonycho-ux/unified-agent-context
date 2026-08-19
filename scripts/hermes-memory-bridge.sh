#!/usr/bin/env bash
# Hermes built-in memory (USER.md/MEMORY.md) 신규 증분 → 사서(The Noticer) inbox 배달.
# 설계: Hermes의 자기 메모는 유지하되, 장기 기억 승격 판단은 사서가 한다 (single-writer).
set -euo pipefail

STATE_DIR="${UAC_BRIDGE_STATE_DIR:-$HOME/.uac/bridge}"
INBOX="${UAC_NOTICER_INBOX:-$HOME/.letta/agents/<your-agent-uuid>/memory/reference/inbox}"
FILES=("${UAC_HERMES_MEMORIES:-$HOME/.hermes/memories/USER.md}" "${UAC_HERMES_MEMORIES_DIR:-$HOME/.hermes/memories}/MEMORY.md")
mkdir -p "$STATE_DIR" "$INBOX"

STAMP=$(date -u +%Y-%m-%dT%H-%M-%SZ)
DIGEST=""

for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue
  snap="$STATE_DIR/$(basename "$f").snapshot"
  if [ -f "$snap" ]; then
    new_lines=$(diff "$snap" "$f" 2>/dev/null | grep "^> " | sed "s/^> //" | grep -v "^§$" | grep -v "^[[:space:]]*$" || true)
  else
    new_lines=""  # 첫 실행: 스냅샷만 뜨고 배달 안 함 (기존 내용 재배달 방지)
  fi
  if [ -n "$new_lines" ]; then
    DIGEST="$DIGEST
## $(basename "$f") 신규 증분
$new_lines
"
  fi
  cp "$f" "$snap"
done

if [ -n "$DIGEST" ]; then
  out="$INBOX/hermes-bridge-$STAMP.md"
  {
    echo "---"
    echo "description: Hermes built-in memory delta — feeder batch. Curate per librarian-role.md."
    echo "---"
    echo "# Hermes memory bridge digest — $STAMP"
    echo "$DIGEST"
  } > "$out"
  echo "delivered: $out"
else
  echo "no delta"
fi
