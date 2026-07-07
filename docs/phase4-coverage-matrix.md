# Phase 4 — 크로스 에이전트 시나리오 검증 커버리지 매트릭스

- 일시: 2026-07-07
- 러너: `scripts/cross-verify.mjs` (20개 directed 경로 전부 기계 실행 — 대표 6 full + 나머지 14 smoke)
- 결과: **20/20 PASS** (`artifacts/g005-matrix-run.txt`)
- full 행은 전역 선호(언어=한국어) 포함 여부까지 검증 (재설명 불필요 조건)

## 검증 계층 (정직 고지)

| 계층 | 의미 | 커버 |
|------|------|------|
| **라이브 (실 LLM 세션)** | 실제 하네스 에이전트 세션이 기록/인지 | gajaecode source (record-fact 실행, 스토어 기계 확인) + gajaecode sink (새 `gjc -p` 세션이 rule pull로 Phase 0 결정 정확 인지) |
| **메커니즘 (실 배선 실행)** | 각 하네스의 실제 기록/주입 경로(등록된 MCP 서버, 훅 커맨드, 훅 스크립트)를 실행 파일 그대로 구동 | 아래 매트릭스 20행 전부 |
| **라이브 보류 (외부 의존)** | codex/hermes: openai-codex 사용량 한도 (Jul 9 재개) · claude: CLI 로그인 필요 · lettacode: 미설치 | 해소 시 `scripts/cross-verify.mjs` 재실행 + 해당 하네스 라이브 세션 1회씩 |

라이브 격리 프로브(타 프로젝트 cwd에서 프로젝트 결정 미노출 확인)는 모델 안전필터 오탐으로 차단되어 기계 검증(스위트 65/65의 스코프 격리 테스트 + red-team scope 공격 PASS)으로 대체함.

## 커버리지 매트릭스

| source | sink | write path | startup injection path | tier | expected fact | observed | verdict |
|--------|------|-----------|------------------------|------|---------------|----------|---------|
| claude | codex | MCP context_save (claude 등록 서버) | AGENTS.md 지시 pull — MCP context_get | full | 매트릭스 claude→codex 결정 | 기대 사실 인지 | PASS |
| claude | hermes | MCP context_save (claude 등록 서버) | pre_llm_call 셸 훅 (hermes-pre-llm-hook.sh) | full | 매트릭스 claude→hermes 결정 | 기대 사실 인지 | PASS |
| claude | gajaecode | MCP context_save (claude 등록 서버) | 사용자 rule 지시 pull (inject-context.mjs) | smoke | 매트릭스 claude→gajaecode 결정 | 기대 사실 인지 | PASS |
| claude | lettacode | MCP context_save (claude 등록 서버) | 표준 온보딩 주입 (inject-context.mjs — 미설치 시뮬레이션) | smoke | 매트릭스 claude→lettacode 결정 | 기대 사실 인지 | PASS |
| codex | claude | MCP context_save (codex config.toml 등록 서버) | SessionStart 훅 커맨드 실행 (inject-context.mjs) | full | 매트릭스 codex→claude 결정 | 기대 사실 인지 | PASS |
| codex | hermes | MCP context_save (codex config.toml 등록 서버) | pre_llm_call 셸 훅 (hermes-pre-llm-hook.sh) | smoke | 매트릭스 codex→hermes 결정 | 기대 사실 인지 | PASS |
| codex | gajaecode | MCP context_save (codex config.toml 등록 서버) | 사용자 rule 지시 pull (inject-context.mjs) | smoke | 매트릭스 codex→gajaecode 결정 | 기대 사실 인지 | PASS |
| codex | lettacode | MCP context_save (codex config.toml 등록 서버) | 표준 온보딩 주입 (inject-context.mjs — 미설치 시뮬레이션) | smoke | 매트릭스 codex→lettacode 결정 | 기대 사실 인지 | PASS |
| hermes | claude | MCP context_save (hermes mcp 등록 서버) | SessionStart 훅 커맨드 실행 (inject-context.mjs) | smoke | 매트릭스 hermes→claude 결정 | 기대 사실 인지 | PASS |
| hermes | codex | MCP context_save (hermes mcp 등록 서버) | AGENTS.md 지시 pull — MCP context_get | smoke | 매트릭스 hermes→codex 결정 | 기대 사실 인지 | PASS |
| hermes | gajaecode | MCP context_save (hermes mcp 등록 서버) | 사용자 rule 지시 pull (inject-context.mjs) | full | 매트릭스 hermes→gajaecode 결정 | 기대 사실 인지 | PASS |
| hermes | lettacode | MCP context_save (hermes mcp 등록 서버) | 표준 온보딩 주입 (inject-context.mjs — 미설치 시뮬레이션) | smoke | 매트릭스 hermes→lettacode 결정 | 기대 사실 인지 | PASS |
| gajaecode | claude | record-fact CLI (explicit_write 게이트) | SessionStart 훅 커맨드 실행 (inject-context.mjs) | smoke | 매트릭스 gajaecode→claude 결정 | 기대 사실 인지 | PASS |
| gajaecode | codex | record-fact CLI (explicit_write 게이트) | AGENTS.md 지시 pull — MCP context_get | smoke | 매트릭스 gajaecode→codex 결정 | 기대 사실 인지 | PASS |
| gajaecode | hermes | record-fact CLI (explicit_write 게이트) | pre_llm_call 셸 훅 (hermes-pre-llm-hook.sh) | smoke | 매트릭스 gajaecode→hermes 결정 | 기대 사실 인지 | PASS |
| gajaecode | lettacode | record-fact CLI (explicit_write 게이트) | 표준 온보딩 주입 (inject-context.mjs — 미설치 시뮬레이션) | full | 매트릭스 gajaecode→lettacode 결정 | 기대 사실 인지 | PASS |
| lettacode | claude | MCP context_save (표준 온보딩 경로 — 미설치 시뮬레이션) | SessionStart 훅 커맨드 실행 (inject-context.mjs) | full | 매트릭스 lettacode→claude 결정 | 기대 사실 인지 | PASS |
| lettacode | codex | MCP context_save (표준 온보딩 경로 — 미설치 시뮬레이션) | AGENTS.md 지시 pull — MCP context_get | smoke | 매트릭스 lettacode→codex 결정 | 기대 사실 인지 | PASS |
| lettacode | hermes | MCP context_save (표준 온보딩 경로 — 미설치 시뮬레이션) | pre_llm_call 셸 훅 (hermes-pre-llm-hook.sh) | smoke | 매트릭스 lettacode→hermes 결정 | 기대 사실 인지 | PASS |
| lettacode | gajaecode | MCP context_save (표준 온보딩 경로 — 미설치 시뮬레이션) | 사용자 rule 지시 pull (inject-context.mjs) | smoke | 매트릭스 lettacode→gajaecode 결정 | 기대 사실 인지 | PASS |

## 대표 조합 선정 기준

각 하네스가 source·sink로 최소 1회 등장: claude→codex, codex→claude, claude→hermes, hermes→gajaecode, gajaecode→lettacode, lettacode→claude (승인 플랜 그대로).

## 라이브 증거 상세

1. **gajaecode sink (라이브)**: 새 `gjc -p --no-session` 세션이 사용자 rule에 따라 injector를 실행하고 "v1 컨텍스트 스토어는 mcp-memory-keeper" 결정을 정확히 답변.
2. **gajaecode source (라이브)**: `gjc -p` 세션이 record-fact CLI로 "G005 라이브 검증" 결정 기록 → 스토어 getFacts로 기계 확인 (dedupe_key 9a4922199053567e).
3. **codex 라이브 시도**: `codex exec` 실행 → 사용량 한도 오류 확인 (Jul 9 8:28AM 재개) — ledger 기록.
