# Phase 2 — 세션 시작 훅 배선 + Degraded Mode

- 일시: 2026-07-07
- 인젝터: `scripts/inject-context.mjs` (코어: `src/injector.mjs`)
- 주입 내용: **증류된 사실만** — 전역 선호(`global`) + 현재 프로젝트 결정(`project:<git-root-basename>`). 원본 대화/비밀정보는 절대 주입되지 않는다.

## 하네스별 배선 현황

| 하네스 | 메커니즘 | 배선 위치 | 상태 | 분류 |
|--------|----------|-----------|------|------|
| claude code | `SessionStart` 훅 (stdout이 컨텍스트로 추가) + MCP `unified-memory` | `~/.claude/settings.json` hooks.SessionStart, `claude mcp add unified-memory` (DATA_DIR=프로덕션 스토어) | 배선 완료, MCP health ✔ Connected. 인-세션 실검증은 CLI 로그인 필요(인간 의존, Phase 4) | 훅 지원 |
| gajaecode (GJC) | **지시 기반 pull** — 사용자 rule이 세션 시작 시 injector 실행을 지시 + MCP `unified-memory` 등록 | `~/.gjc/agent/rules/uac-shared-context.md`, `~/.gjc/agent/mcp.json` | **라이브 검증 완료** — 새 `gjc -p` 세션이 rule pull로 결정 인지 (G005). GJC 확장(`before_agent_start`) 자동 주입은 확장 탐색이 `-p` 모드에서 로드되지 않아 후속 개선 항목으로 전환 | 지시 pull (확장 자동주입 후속) |
| hermes (Mac) | 셸 훅 `pre_llm_call` (stdout JSON `{"context":...}` 주입, `is_first_turn`에만) + MCP `unified-memory` (38 tools) | `~/.hermes/config.yaml` hooks 블록 → `scripts/hermes-pre-llm-hook.sh` | 배선 완료, 합성 페이로드 테스트 통과. 첫 실행 시 hermes 최초 사용 동의(allowlist) 프롬프트 1회 필요 | 훅 지원 |
| hermes (sov) | 동일 `pre_llm_call` 훅 — sov 배포본 `~/unified-agent-context` 사용 (스토어는 local 직결) | `sov:~/.hermes/config.yaml` hooks 블록 (백업: `config.yaml.bak-uac-20260708`) | **라이브 검증 완료 (2026-07-08)** — 배선 전 프로브 "모른다" → 배선 후 Pending Actions Board 전역 선호를 정확히 암송 | 훅 지원 |
| codex | 세션 시작 훅 부재 → **지시 기반 pull** (AGENTS.md 지시 + MCP 도구 직접 호출) | `~/.codex/config.toml` [mcp_servers.unified-memory], `~/.codex/AGENTS.md` 공유 컨텍스트 지시 | 배선 완료 | **확인된 하네스 제약** — 수동/지시 pull 폴백 (플랜 허용 조건) |
| lettacode | 이 머신에 CLI 미설치 — 바이너리/설정 디렉토리 미발견 | 온보딩 문서의 표준 절차(MCP 연결 + 훅 설정) 적용 대상 | 미배선 (환경 부재) | **확인된 하네스 제약** — 설치 후 표준 온보딩 절차로 합류 |
| kimi | `UserPromptSubmit` 훅 (세션당 첫 프롬프트에 stdout 주입) + MCP `unified-memory` + `~/.agents/AGENTS.md` 지시 폴백 | `~/.kimi-code/config.toml` [[hooks]], `~/.kimi-code/mcp.json`, 스크립트 `scripts/kimi-user-prompt-hook.sh` | 배선 완료 (`onboard-agent.mjs --harness kimi` 적용, 합성 페이로드 훅 테스트 통과) | 훅 지원 |

모든 하네스는 훅 주입과 별개로 MCP 도구(`context_save`/`context_get`/`context_search_all`)로 세션 중 온디맨드 검색/기록이 가능하다.

## Degraded Mode (폴백 ≠ 조용한 스킵)

서버/사실 조회 실패 시 인젝터는 4가지 증거를 **모두** 방출한다:

1. **visible warning**: stderr `[uac-injector] DEGRADED: <reason>`
2. **structured log**: `data/logs/injector.log`에 JSON line `{ts, event: "injector_degraded", reason, projectId}` append
3. **health probe**: `data/health/injector.json`이 `{status: "degraded", ts, reason}`로 전이 (성공 시 `ok` 복귀)
4. **metric**: `data/metrics/injector-metrics.json`의 `degraded_count` 증가 (`inject_count`는 매 호출 증가)

경로는 `UAC_LOG_PATH` / `UAC_HEALTH_PATH` / `UAC_METRICS_PATH`로 오버라이드 가능.

**검증 환경 규율**: `UAC_STRICT=1`이면 degraded는 `InjectorDegradedError`(라이브러리) / exit 2(CLI)로 **테스트 실패 처리**된다. 기대 사실 누락을 폴백으로 은폐할 수 없다. 일반 모드 CLI는 exit 0 — 하네스 세션을 죽이지 않는다.

## 검증

- `tests/injector.test.mjs` 6/6: 스코프 주입/배제, degraded 4증거, strict 실패 처리, health 복귀, CLI 정상/strict 경로 (실서버 스폰)
- 라이브 acceptance: 시드 후 `node scripts/inject-context.mjs --cwd <repo>` → 전역 선호 + 프로젝트 결정 주입, `--scope project:other-project` → 전역 선호만 (프로젝트 간 누출 0)
