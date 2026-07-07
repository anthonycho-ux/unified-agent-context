# Phase 3 — 세션 중 명시 기록 + 종료 자동 증류

- 일시: 2026-07-07

## 기록 경로

| 경로 | 진입점 | 게이트 | 비고 |
|------|--------|--------|------|
| 명시 기록 (`explicit_write`) | `src/recorder.mjs` (`recordFact`/`recordDecision`/`recordPreference`), CLI `scripts/record-fact.mjs` | `assertSafe(statement, "explicit_write")` — 차단형, 비밀 시 exit 3 | 에이전트/사용자가 세션 중 확정 결정·선호를 즉시 기록 |
| MCP 직접 기록 | 각 하네스의 `context_save` 도구 (unified-memory MCP) | 서버측 게이트 없음 → **검역 스윕이 사후 차단** | 편의 경로 — 증류 시 DistilledFact 아닌 row는 주입에 사용되지 않음 |
| 자동 증류 (`auto_distill`) | `src/distiller.mjs` (`distillSession`), CLI `scripts/distill-session.mjs` | 후보별 `assertSafe(candidate, "auto_distill")` — 비밀 후보는 skip(fail-closed, 저장 안 함) | 규칙 기반 v1 (결정/선호 마커) — 추출기는 후속에 LLM 기반으로 교체 가능 |
| 아카이브 (`archive_ingest`/`cold_archive`) | `distillSession` 내부 `archiveConversation` | scan 후 비밀 시 redact-only 저장 | 원본 대화는 주입 금지, 콜드 보관만 |
| 검역 스윕 | `src/quarantine.mjs` (`sweepQuarantine`) — distill CLI가 매번 실행 | foreign row에 비밀 발견 시 redact 값으로 덮어쓰기 (`overwriteRaw`는 저장 전 재스캔 fail-closed) | 게이트 우회(raw MCP 저장) 비밀의 사후 차단 |

## 하네스별 세션 종료 증류

| 하네스 | 방식 |
|--------|------|
| claude code | `SessionEnd` 훅 → `scripts/claude-session-end.mjs` (payload의 `transcript_path` JSONL → 평문 취합 → distill + 검역) — 자동 |
| gajaecode / hermes / codex | 세션 중 명시 기록(MCP `context_save` 또는 `record-fact.mjs`)이 1차 경로. 종료 증류는 `node scripts/distill-session.mjs --file <transcript>` 수동/스크립트 실행 (하네스별 transcript 자동 접근은 후속 확장) |

## 규칙 기반 증류 v1의 한계 (정직 고지)

- 마커(결정/하기로/채택/선호/항상 등) 기반 라인 추출 — 문맥 이해 없음, 20자 미만/중복 제거, 최대 20건.
- 오탐(마커 포함 잡담)과 미탐(마커 없는 결정)이 존재한다. dedupe upsert라 재증류는 안전.
- 추출기는 `extractCandidates()` 하나로 캡슐화되어 있어 LLM 증류로 교체 시 이 함수만 바꾸면 된다.

## 검증

- `tests/recorder.test.mjs` 4건 + `tests/distiller.test.mjs` 3건 (실서버): 명시 기록 왕복/차단(exit 3), 추출 마커·노이즈, 증류 저장·dedupe·비밀 skip·아카이브 redact, 검역 스윕(우회 비밀 redact + 재스윕 no-op)
- 전체 스위트 65/65
