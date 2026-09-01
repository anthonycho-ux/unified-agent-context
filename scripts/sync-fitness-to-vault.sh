#!/usr/bin/env bash
# store-host의 최신 주간 fitness 보고서를 맥의 partnership-journal vault로 배달한다.
# store-host(순찰자)가 쓴 보고서를 맥(배달부)이 가져와 vault(책상)에 노트로 올려놓는다.
# 멱등: 같은 날짜의 노트가 이미 있으면 아무것도 하지 않는다.
# launchd가 매주 월요일 실행 (맥이 자고 있었다면 깨어날 때 1회 따라잡기).
set -uo pipefail

VAULT="/Users/<mac-user>/Library/Mobile Documents/iCloud~md~obsidian/Documents/partnership-journal"
DEST="$VAULT/entries/UAC/fitness"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$DEST"

LATEST=$(ssh -o ConnectTimeout=10 store-host 'ls -t /home/user/.uac/maintenance/reports/*-fitness.md 2>/dev/null | head -1')
if [ -z "${LATEST:-}" ]; then
  echo "no fitness reports on store-host"
  exit 0
fi

BASE=$(basename "$LATEST")          # 예: 2026-07-28-fitness.md
DATE="${BASE%-fitness.md}"
NOTE="$DEST/$DATE weekly fitness.md"

if [ -f "$NOTE" ]; then
  echo "already synced: $NOTE"
else
scp -q -o ConnectTimeout=10 "store-host:$LATEST" "$TMP/fitness.md" || { echo "scp fitness failed"; exit 1; }
scp -q -o ConnectTimeout=10 "store-host:/home/user/.uac/maintenance/reports/$DATE-cleanup.md" "$TMP/cleanup.md" 2>/dev/null || true

{
  echo "# UAC 주간 fitness — $DATE"
  echo
  echo "- 출처: store-host 자동 점검 (매주 월요일 07:23, cron)"
  echo "- 원본: \`/home/user/.uac/maintenance/reports/$BASE\` (store-host)"
  echo "- 동기화: $(date '+%Y-%m-%d %H:%M') (맥 launchd)"
  echo
  echo '## 원본 보고서'
  echo
  cat "$TMP/fitness.md"
  if [ -s "$TMP/cleanup.md" ]; then
    echo
    echo '## cleanup 결과'
    echo
    cat "$TMP/cleanup.md"
  fi
  echo
  echo '## 피드백'
  echo
  echo '여기에 생각을 자유롭게 적어주세요. 다음 보고서에 반영할게요.'
  echo
  echo '- '
} > "$NOTE"

echo "synced: $NOTE"
fi

# sorting 점검: '!'가 붙은 고정 노트가 항상 최신 보고서를 가리키게 한다.
# Obsidian 파일 목록은 알파벳순이라 '!'가 맨 위에 온다.
# 내용은 최신 노트의 임베드 하나뿐이라 원본은 늘 한 곳에만 있다.
TOP="$DEST/!지금 읽을 보고서.md"
TOP_BODY=$(cat <<EOF
# 지금 읽을 보고서

가장 최근 주간 fitness 보고서로 바로 연결돼요. 이 노트는 매주 자동 갱신돼요.

![[$DATE weekly fitness]]
EOF
)
if [ ! -f "$TOP" ] || [ "$(cat "$TOP")" != "$TOP_BODY" ]; then
  printf '%s\n' "$TOP_BODY" > "$TOP"
  echo "top note updated -> $DATE"
else
  echo "top note already current ($DATE)"
fi
