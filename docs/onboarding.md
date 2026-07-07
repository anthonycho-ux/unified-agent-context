# 신규 에이전트 온보딩 — MCP 연결 + 훅 설정

새 에이전트를 공유 컨텍스트에 합류시키는 표준 절차. 소요: 5분 내외.

## 0. 공통 정보

- 공유 메모리 서버(스토어): `node <repo>/node_modules/mcp-memory-keeper/dist/index.js`
- 필수 환경변수: `DATA_DIR=<repo>/data/memory`
- 주입 커맨드: `node <repo>/scripts/inject-context.mjs [--cwd <dir>]`
- 명시 기록: `node <repo>/scripts/record-fact.mjs --type decision|preference "<문장>"`
- 스코프 규약: 전역 선호 = channel `global`, 프로젝트 결정 = channel `project:<git-root-basename>`
- 금지: API 키/토큰/자격증명을 공유 메모리에 저장하지 않는다 (게이트가 차단하지만 원칙으로도 금지)

## 1. MCP 연결 (온디맨드 검색/기록)

에이전트의 MCP 등록 명령으로 위 서버를 `unified-memory` 이름으로 등록한다.

| 하네스 유형 | 명령 예시 |
|-------------|-----------|
| claude code | `claude mcp add unified-memory --scope user --env DATA_DIR=<위 DATA_DIR> -- node <위 서버 경로>` |
| codex | `~/.codex/config.toml`에 `[mcp_servers.unified-memory]` 블록 (command/args/env) |
| hermes | `printf 'Y\n' \| hermes mcp add unified-memory --command node --env DATA_DIR=<DATA_DIR> --args <서버 경로>` |
| gjc | `gjc mcp add unified-memory --env DATA_DIR=<DATA_DIR> node <서버 경로>` |
| 기타 MCP 지원 에이전트 | 해당 에이전트의 stdio MCP 등록 절차에 동일 스펙 적용 |

등록 확인: 에이전트의 MCP 목록/health 명령에서 `unified-memory` 연결 확인 (도구: `context_save`/`context_get`/`context_search_all` 등).

## 2. 세션 시작 주입 (훅 또는 지시)

하네스가 지원하는 방식 하나를 택한다:

**A. 세션 시작 훅 지원 시** — 훅에서 주입 커맨드를 실행하고 stdout을 컨텍스트에 추가:
- claude code: `~/.claude/settings.json` → `hooks.SessionStart[].hooks[] = {type:"command", command:"node .../inject-context.mjs"}`
- hermes: `~/.hermes/config.yaml` → `hooks.pre_llm_call[].command = ".../scripts/hermes-pre-llm-hook.sh"` (첫 턴에만 주입; 최초 1회 동의 프롬프트 발생)

**B. 훅 미지원 시 (지시 기반 pull)** — 에이전트의 전역 지시 파일에 다음 지시를 추가:
- codex: `~/.codex/AGENTS.md` / gjc: `~/.gjc/agent/rules/uac-shared-context.md`
- 지시 내용: "첫 요청 처리 전 주입 커맨드를 실행해 공유 컨텍스트 블록을 읽고, 세션 중 확정 결정/선호는 record-fact 또는 `context_save`로 기록하라."

## 3. (권장) 세션 종료 증류

- claude code: `hooks.SessionEnd[].hooks[] = {type:"command", command:"node .../scripts/claude-session-end.mjs"}`
- 기타: 세션 종료 시 `node .../scripts/distill-session.mjs --file <transcript>` 실행 (또는 명시 기록만 사용)

## 4. 합류 검증 (2분)

```sh
# 먼저 <repo>를 실제 checkout 경로로 바꾼다.
export UAC_HOME="$PWD"

# (a) 주입 확인 — 전역 선호가 보이면 성공
node "$UAC_HOME/scripts/inject-context.mjs" --cwd <아무 프로젝트>
# (b) 기록 왕복 — RECORDED 출력 확인 후 (a) 재실행 시 새 사실 포함
node "$UAC_HOME/scripts/record-fact.mjs" --type decision --scope project:onboard-test "온보딩 검증 결정"
# (c) 배선 자가진단
node "$UAC_HOME/scripts/doctor.mjs"
```

## 5. 재설명 계측 (2주 관문 보조지표)

에이전트에게 뭔가를 "다시 설명"하게 됐다면 그 순간 기록한다:

```sh
node "$UAC_HOME/scripts/reexplain.mjs" log "<무엇을 재설명했나>" [--agent <이름>]
node "$UAC_HOME/scripts/reexplain.mjs" report   # 주간 추이
```

2주 실사용 후 report의 주간 건수가 0에 수렴하고 체감상 재설명이 사라졌으면 v1 최종 합격.
