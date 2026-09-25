#!/usr/bin/env bash
# UAC 주간 점검 오케스트레이터 (store-host crontab에서 매주 실행).
# 순서: 계량(fitness) → 승인된 정리(cleanup) → 공유 메모리 기록(note).
# fitness는 읽기 전용, cleanup만 승인된 대상(feature flag 평가 로그 7일+)을 삭제한다.
set -uo pipefail

UAC="${UAC_REPO_DIR:-$HOME/unified-agent-context}"
DATA="${UAC_DATA_DIR:-$HOME/.uac/data/memory}"
MAINT="${UAC_MAINT_DIR:-$HOME/.uac/maintenance}"
STAMP=$(date +%F)

mkdir -p "$MAINT/reports"

# 하네스 출처 추적: 이 스크립트가 쓰는 항목은 maintenance:cron 세션에 남는다.
export UAC_SESSION_NAME="maintenance:cron"

echo "== fitness ($STAMP) =="
node --no-warnings "$UAC/scripts/fitness-check.mjs" --data-dir "$DATA" \
  --history-file "$MAINT/fitness-history.jsonl" \
  > "$MAINT/reports/$STAMP-fitness.md" \
  && echo "fitness ok: $MAINT/reports/$STAMP-fitness.md" \
  || echo "fitness FAILED (exit $?)"

echo "== cleanup ($STAMP) =="
node --no-warnings "$UAC/scripts/maintenance-cleanup.mjs" --data-dir "$DATA" --apply \
  > "$MAINT/reports/$STAMP-cleanup.md" \
  && echo "cleanup ok: $MAINT/reports/$STAMP-cleanup.md" \
  || echo "cleanup FAILED (exit $?)"

echo "== wal-checkpoint ($STAMP) =="
# 세션 서버들이 DB를 상시 잡고 있어 WAL이 무한 누적된다 (프레임 수백 개면 open이 느려짐).
# 주간 TRUNCATE 체크포인트로 wal을 0으로 되돌린다. 실패해도 이후 단계를 막지 않는다.
if command -v sqlite3 >/dev/null 2>&1 && [ -f "$DATA/context.db" ]; then
  sqlite3 "$DATA/context.db" "PRAGMA busy_timeout=5000; PRAGMA wal_checkpoint(TRUNCATE);" \
    | awk -F'|' '{printf "wal checkpoint: busy=%s log_frames=%s merged=%s\n", $1, $2, $3}' \
    || echo "wal-checkpoint FAILED (exit $?)"
else
  echo "wal-checkpoint SKIPPED: sqlite3 또는 $DATA/context.db 없음"
fi

echo "== note ($STAMP) =="
# fitness가 실패필 때도 이전 단계 결과는 남으므로, 보고서가 있을 때만 기록한다.
if [ -s "$MAINT/reports/$STAMP-fitness.md" ]; then
  node "$UAC/scripts/maintenance-note.mjs" \
    --report "$MAINT/reports/$STAMP-fitness.md" \
    --cleanup "$MAINT/reports/$STAMP-cleanup.md" \
    || echo "note FAILED (exit $?)"
else
  echo "note SKIPPED: fitness 보고서가 비어 있음"
fi
