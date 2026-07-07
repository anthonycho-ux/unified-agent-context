# Phase 0 — 저장소 후보 검증 스파이크 결과

- 일시: 2026-07-07
- 환경: macOS (Apple M3), node v22.23.1, npm 10.9.8 · **Docker 없음 · Ollama 없음** (환경 제약이 채점에 직접 반영됨)
- 방법: 4개 후보를 npm으로 설치, MCP stdio 클라이언트(`spike/roundtrip.mjs`)로 tools/list + 기록/검색 왕복을 실측

## 대조표

| 항목 | Mem0 OpenMemory (npm `openmemory`) | `mem0-mcp` 0.2.0 | `@modelcontextprotocol/server-memory` | `mcp-memory-keeper` 0.14.0 |
|---|---|---|---|---|
| (a) 설치/실행 난이도 | npm 설치는 쉬우나 **클라우드 클라이언트** (`api.openmemory.dev` + `OPENMEMORY_API_KEY`); 로컬 스택은 Docker 필수 → 이 환경에서 로컬 실행 불가 | npm 설치 쉬움, 실행되나 **Ollama 임베딩 필수** (`qwen3-embedding`) → 이 환경에서 store 실패("fetch failed" 실측) | npx 한 줄, 의존성 0, 즉시 동작 | npm 설치 후 즉시 동작 (better-sqlite3) |
| (b) 노출 MCP tools | add/search/list/delete-all (4개) | health, memory_store/recall/search/update/forget, setup_wizard | create_entities, search_nodes 등 그래프 9개 | context_save/get/search_all/semantic_search, checkpoint, batch 등 35+ |
| (c) 전역/프로젝트 스코프 태깅 | user 단위(클라우드) — 프로젝트 스코프 없음 | **최상**: scope{workspace, project} 필수 스키마 | 없음 (엔티티 이름에 인코딩해야 함) | **channel**(스코프 매핑) + category(fact_type 매핑) + 세션 구분 |
| (d) 자동 증류 지원 | 서버측 LLM 추출(클라우드) | 없음 (직접 배선) | 없음 | 없음 (직접 배선) — v1 계획상 증류는 우리 훅 계층 소관이라 감점 아님 |
| (e) 자원 소모 | 클라우드/또는 Docker+Qdrant 스택 | Node + Ollama 상주 필요 | Node 단일, JSONL 파일 | Node 단일, SQLite 파일 |
| (f) MCP 클라이언트 실접속 | stdio 연결·tools/list 성공, add "성공" 응답 후 search 0건 (키 없는 클라우드 사일런트 실패) | 연결 성공, health가 스스로 `ok:false` (Ollama 부재) 정직 보고 | **왕복 전부 성공** (기록→검색 일치) | **왕복 전부 성공** + `claude mcp add` 후 health check ✔ Connected |
| (g) scope 필터 집행 위치 | 서버(클라우드) | **서버 쿼리 강제** (스키마 필수) | 클라이언트 후처리 필요 | **서버 쿼리 강제** — `context_get(channel=project-a)`가 SQL WHERE로 해당 채널만 반환함을 실측 |
| 영속성 (재접속 후 조회) | 미검증(클라우드) | — | 파일 기반 OK | **실측 OK** (새 프로세스에서 이전 기록 조회 성공) |

## 실측 로그 요약 (spike/roundtrip.mjs)

- `server-memory`: WRITE→SEARCH 왕복 성공 (`Phase0SpikeDecision` 저장·검색 일치)
- `memory-keeper`: WRITE→GET 왕복 성공, **크로스 프로세스 GET 성공**, **channel 필터 서버측 집행 확인**, `context_search_all`로 세션 횡단 검색 성공
- `mem0-mcp`: 올바른 스키마(kind/scope{workspace,project}/provenance{checkpointId})로 호출해도 store가 `fetch failed` (Ollama 부재) — 임베딩이 하드 의존. roundtrip.mjs는 설치본 0.2.0 스키마와 일치하도록 수정됨
- `openmemory`: add "Memory added successfully" 후 search 0건 — API 키 없는 클라우드 사일런트 실패, v1 로컬 전용 제약 위반
- 전 후보(4종) 재현 로그: `artifacts/g001-roundtrip-all.txt` — 동일 스크립트로 일괄 재실행한 원시 transcript

## 채택 결정

**채택: `mcp-memory-keeper` (v1 Context Store)**

근거:
1. 이 환경(로컬 전용, Docker/Ollama 없음)에서 **왕복·영속성·서버측 스코프 필터를 모두 실측 통과한 유일한 후보**가 사실상 memory-keeper (server-memory는 스코프 모델 부재).
2. (g) 서버 쿼리 단계 스코프 강제 — 프로젝트 간 누출 차단 요건에 직결.
3. 매핑이 자연스러움: `channel` ↔ MemoryScope(`global` / `project:<id>`), `category` ↔ fact_type(`decision`/`preference`/`project_state`), metadata ↔ 나머지 DistilledFact 필드.
4. `DATA_DIR` 환경변수로 저장 위치 통제 가능 (기본 `~/mcp-data/memory-keeper/context.db`).

기각:
- **Mem0 OpenMemory**: 1순위 후보였으나 npm판은 클라우드 전용, 로컬판은 Docker 필수 → v1 로컬 전용 제약과 환경 제약으로 기각. **v2(원격/셀프호스팅)에서 재평가 가치 있음.**
- **mem0-mcp**: 스코프 스키마는 요구사항과 가장 잘 맞으나 Ollama 임베딩 하드 의존 → 환경 미충족. Ollama 도입 시 교체 1순위 후보.
- **server-memory**: 스코프 모델 부재, 검색이 엔티티 이름 기반 — DistilledFact 모델과 불일치.

**교체 가능성(P3 결합 금지):** 에이전트/훅 계층은 MCP 표준으로만 접근하므로, 향후 Ollama/Docker 도입 시 mem0-mcp·OpenMemory로 스토어만 교체 가능. 우리 어댑터 계층에 memory-keeper 고유 명칭이 새지 않도록 Phase 1에서 도구 호출을 단일 모듈로 캡슐화한다.

## claude code 실접속 증거

- `claude mcp add unified-memory --scope user -- node .../mcp-memory-keeper/dist/index.js` → `~/.claude.json` 등록
- `claude mcp list` → `unified-memory: ... - ✔ Connected` (claude code MCP 클라이언트의 initialize 핸드셰이크 왕복 성공)
- 도구 호출 왕복은 동일 stdio 프로토콜 클라이언트로 검증 (WRITE→GET 일치)
- 제약: claude CLI 미로그인 상태라 LLM 경유 인-세션 도구 호출은 Phase 4에서 로그인 후 수행 (인간 의존 항목으로 ledger 기록)
