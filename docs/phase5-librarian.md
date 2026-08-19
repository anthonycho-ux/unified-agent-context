# Phase 5 — Letta 사서(librarian) handoff lane

- 일시: 2026-07-08
- 배경: 장기 기억 큐레이션 권한을 단일 사서로 통일 (7-writer 산재 문제의 구조적 재발 방지)

## 아키텍처

```
UAC storeFact 성공 (모든 경로: 명시 기록/증류)
   └─▶ queueForLibrarian()  — 영구 팩트(decision/preference)만, fail-safe
         └─▶ data/memory/librarian/outbox.jsonl (dedupe: outbox+sent)
               └─▶ scripts/librarian-sync.mjs (수동/cron)
                     └─(ssh)─▶ sov: Letta "The Noticer"
                               <UAC_NOTICER_INBOX>/uac-*.md   (기본: ~/.letta/agents/<agent-id>/memory/reference/inbox)
                               사서가 세션에서 promote/merge/discard 판단
```

## 역할 경계

| 주체 | 권한 |
|------|------|
| UAC (Mac) | 기고자(feeder) — 후보 팩트 큐잉/배달만. 로컬 context.db는 세션 주입용으로 유지 |
| Letta "The Noticer" (sov) | **유일한 장기 기억 writer** — mem0 승격/병합/폐기 판단 (`librarian-role.md`) |

## 규칙

- 큐잉 대상: `retention_class=permanent` AND `sensitivity_class=normal` (비밀 게이트 통과 후) — project_state/sensitive는 로컬 전용.
- 큐잉은 어떤 경우에도 로컬 저장을 실패시키지 않는다 (`{queued:false, reason}` 반환).
- 배달 실패 시 outbox 보존 → 다음 sync 재시도 (degraded 철학 일관). `--strict`면 exit 1.
- dedupe: outbox + sent.jsonl의 dedupe_key 합집합 기준.

## 환경변수

| 변수 | 기본값 | 용도 |
|------|--------|------|
| `UAC_LIBRARIAN` | (enabled) | `0`이면 큐잉 비활성 |
| `UAC_LIBRARIAN_DIR` | `<DATA_DIR>/librarian` | outbox/sent 위치 |
| `UAC_LIBRARIAN_HOST` | `sov` | ssh 호스트 |
| `UAC_LIBRARIAN_INBOX` / `UAC_NOTICER_INBOX` | `~/.letta/agents/<agent-id>/memory/reference/inbox` | 배달 대상 |

## 검증

- `tests/librarian.test.mjs` 8건: 큐잉 JSONL/dedupe(outbox+sent 교차)/스킵 규칙(비영구·sensitive)/무예외 보장/배달·이관·클리어/degraded 보존/digest 렌더/storeFact 통합.
- 전체 스위트 73/73.
- 라이브 e2e (2026-07-08): `record-fact` → `librarian-sync` → sov inbox에 digest 착지 확인. (교훈: async `execFile`은 `input` 미지원 → 원격 `cat` hang. `execFileSync`로 배달.)

## 후속

- ~~cron 배달 자동화~~ **완료 (2026-07-08):** launchd `<com.uac.librarian-sync>` — 1시간 주기 + RunAtLoad, 로그 `data/logs/librarian-sync.log`. 세션 종료 훅 방식은 ssh 지연을 세션 종료에 전가하므로 기각.
- 사서 처리 결과(promote/discard)의 역방향 피드백 — v2에서 UAC가 사서 판단을 로컬 캐시에 반영.
