## Summary
Phase 0 저장소 스파이크는 완료 게이트 관점에서 승인 가능하다. `mcp-memory-keeper` 채택은 로컬 전용·Docker 없음·Ollama 없음 제약에서 가장 보수적인 선택이며, MCP stdio 경계로 스토어 교체 가능성을 유지한다. 다만 제공된 산출물은 최종 후보 중심으로 강하고, 일부 비교 후보/Claude 세부 로그는 문서 주장 대비 원시 재현성이 약해 `WATCH`로 남긴다.

## Claims
- `docs/phase0-comparison.md`는 환경 제약을 명시하고, 대조표에 (a) 설치/실행 난이도부터 (g) scope 필터 집행 위치까지 포함한다(문서 4행, 9-18행).
- 동일 문서는 채택 결정을 `mcp-memory-keeper`로 단일화하고, Mem0 OpenMemory·mem0-mcp·server-memory 기각 사유와 P3 교체 가능성을 적는다(문서 29-42행).
- `artifacts/g001-roundtrip-rerun.txt`는 `mcp-memory-keeper`의 MCP tools/list, `context_save`, `context_get`, `ROUNDTRIP_DONE:memory-keeper`를 남긴다(아티팩트 1-4행).
- `spike/roundtrip.mjs`는 MCP SDK `Client`와 `StdioClientTransport`로 각 후보 서버를 stdio에서 띄우고 tools/list→write→search를 호출한다(스크립트 5-78행).
- `mcp-memory-keeper` 패키지 소스는 `context_get`의 `channel`/`channels` 입력을 handler에서 repository로 넘기고, repository SQL에 `AND channel = ?` / `AND channel IN (...)`를 추가한다(`node_modules/mcp-memory-keeper/dist/index.js` 783-806행, `ContextRepository.js` 533-576행).

## Analysis
### Stage 1 — Spec compliance
- 비교표 계약은 충족한다. 문서의 대조표가 (a)-(g)를 모두 포함하고, 로컬 환경 제약을 평가 기준에 반영한다.
- 채택 결정은 하나로 수렴한다. `mcp-memory-keeper`를 v1 Context Store로 채택하고, 다른 후보의 기각 사유를 제약 기반으로 분리했다.
- Claude Code 증거는 정직하다. 문서는 `claude mcp add` 및 `claude mcp list`의 Connected 상태를 기록하면서, CLI 미로그인 때문에 LLM 경유 인세션 호출은 Phase 4 인간 의존 항목으로 남겼다고 명시한다.
- 단, 원시 증거 파일은 최종 후보의 stdio WRITE→GET 재실행만 담고 있어, 문서가 주장하는 cross-process/channel/Claude list 전체 트랜스크립트까지 독립 재현하지는 않는다.

### Stage 2 — Architecture
- MCP decoupling은 Phase 0 수준에서 보존된다. 스파이크 코드는 제품 계층에 스토어 SDK를 박지 않고 MCP 표준 클라이언트로 stdio 서버만 호출한다.
- 로컬-only 제약에서 adoption은 타당하다. OpenMemory npm판은 API 키 기반 클라우드 호스트를 기본으로 쓰고, mem0-mcp는 소스상 Ollama embedder를 서버 구성에 직접 연결한다. 반면 memory-keeper는 Node+SQLite 파일 기반이며 실제 WRITE→GET 아티팩트가 있다.
- scope 모델은 memory-keeper의 `channel`로 매핑 가능하다. 중요한 점은 문서 주장뿐 아니라 패키지 소스에서도 `context_get`/search 계열의 channel 필터가 SQL WHERE에 들어간다는 점이다.
- P3 swap path는 credible하지만 Phase 1에서 실제 어댑터 캡슐화로 잠가야 한다. 현재는 스파이크라 후보별 명령/도구명이 스크립트에 노출되는 것이 허용되지만, 제품 코드로 전파되면 결합 금지 조건을 깨뜨린다.

### Stage 3 — Code quality/security/performance
- 스파이크 스크립트는 1시간 검증용으로 충분히 작고 명시적이다. 후보별 command/args/env와 write/search를 한 파일에 두고, connect/list/write/search에 deadline을 두었다.
- production/CI harness는 아니다. 실패를 catch한 뒤에도 `ROUNDTRIP_DONE`과 exit 0으로 끝나므로 사람이 로그를 읽는 스파이크에는 괜찮지만 자동 게이트 신호로 쓰면 부정확하다.
- 현재 `mem0-mcp` 호출 인자는 설치된 0.2.0 tool schema와 맞지 않는다. 설치 패키지의 `memory_store`는 `kind`, `content`, `scope`, `provenance`를 요구하지만 스크립트는 `workspace`, `project`, `checkpoint`를 top-level로 넘긴다. 따라서 현재 스크립트만으로는 문서의 “올바른 스키마로 재시도 후 fetch failed”를 재현하지 못한다.

## Root Cause
남은 리스크의 근본 원인은 스파이크 산출물이 “인간이 읽는 비교 메모 + 최종 후보 재실행 로그” 형태이고, 전체 후보별 원시 트랜스크립트를 한 재현 가능한 harness로 고정하지 않았다는 점이다. 이 때문에 architecture decision 자체는 타당하지만, 후속 리뷰어가 모든 측정 주장과 현재 스크립트 상태를 1:1로 대조하기 어렵다.

## Findings
1. MEDIUM — `spike/roundtrip.mjs` 18-20행 vs `node_modules/mem0-mcp/dist/transport/tools/memory-store.tool.js` 1-22행: mem0-mcp store 호출 schema가 현재 설치 버전과 불일치한다. 영향: 현재 스크립트는 mem0-mcp의 Ollama `fetch failed` 경로를 재현하기 전에 schema validation에서 실패할 수 있어 비교표의 실측 설명과 도구가 어긋난다. 수정: `memory_store` 인자를 `{ kind, content, scope: { workspace, project }, provenance: { checkpointId } }`로 바꾸고 해당 실패 로그를 artifact에 남긴다.
2. LOW — `artifacts/g001-roundtrip-rerun.txt` 1-4행, `docs/phase0-comparison.md` 23행 및 46-49행: 제공 artifact는 memory-keeper 단일 WRITE→GET만 담고, 문서가 언급하는 cross-process/channel/Claude list 원문은 별도 파일로 보존되어 있지 않다. 영향: 승인자는 문서 기록을 신뢰할 수는 있지만 원시 증거 재검증성은 약하다. 수정: 후속 Phase 1 전 docs 또는 artifacts에 해당 원문 로그를 붙인다.
3. LOW — `spike/roundtrip.mjs` 62-82행: write/search 실패를 출력만 하고 정상 종료한다. 영향: 스파이크 수동 검토에는 충분하나 자동 완료 게이트에서 성공 신호로 오용될 수 있다. 수정: 재사용 시 expected substring/assertion과 후보별 non-zero exit를 추가한다.

## Recommendations
1. G001 Phase 0 완료는 승인한다. 채택 후보와 로컬-only 판단은 충분히 방어 가능하고, blocker는 없다.
2. Phase 1 착수 전 `memory-keeper` 고유 tool names를 제품 코드 밖 단일 MCP adapter 모듈에 가둔다.
3. 스파이크를 회귀 증거로 남길 경우 `roundtrip.mjs`의 mem0-mcp schema와 exit semantics를 고치고, channel/cross-process/Claude `Connected` 원문을 artifact로 보강한다.

## Architectural Status
WATCH

## Code Review Recommendation
COMMENT

## Tradeoffs
- `mcp-memory-keeper`: 현재 환경에서 즉시 동작, SQLite와 channel 필터 보유, 단 tool surface가 넓어 adapter 캡슐화 필요.
- `mem0-mcp`: scope 모델은 가장 자연스럽지만 Ollama hard dependency 때문에 현재 로컬 제약에 부적합, Ollama 도입 시 교체 1순위.
- `OpenMemory`: 클라우드/셀프호스트 방향에는 강하지만 v1 로컬-only와 Docker 없음 조건에는 부적합.
- `server-memory`: 가장 단순하지만 scope를 엔티티 이름에 인코딩해야 해 프로젝트 누출 방지 요구에 약하다.
