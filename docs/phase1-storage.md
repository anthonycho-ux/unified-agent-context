# Phase 1 Storage Foundation

## DistilledFact 스키마

| 필드 | 타입 | 기본값/규칙 |
| --- | --- | --- |
| `statement` | `string` | 저장할 원문 사실 문장. 저장 전 비밀 게이트 검사 대상. |
| `fact_type` | `"decision" \| "preference" \| "project_state"` | TTL 기본값을 결정한다. |
| `scope` | <code>"global" &#124; `project:${string}`</code> | 채널 필터로 서버에 전달한다. |
| `created_at` | ISO datetime string | `makeFact()` 호출 시 현재 시각. |
| `updated_at` | ISO datetime string | `makeFact()` 호출 시 현재 시각, dedupe 갱신 시 새 값으로 덮어쓴다. |
| `source_ref` | `string` | 원천 세션/파일/요약 참조. |
| `dedupe_key` | `string` | `sha256(statement + scope).slice(0, 16)`. 같은 키 저장은 갱신으로 취급한다. |
| `retention_class` | `"permanent" \| "days90" \| "days180"` | `fact_type` 기본값에서 파생, pruning 판단에 사용. |
| `sensitivity_class` | `"normal" \| "sensitive"` | 저장 허용 민감도. 실제 비밀은 저장하지 않는다. |

## 스코프 규약

| 스코프 | 용도 | 저장 채널 |
| --- | --- | --- |
| `global` | 사용자 선호, 장기 개인 설정 | `global` |
| `project:<id>` | 프로젝트 결정, 프로젝트 상태 | `project:<id>` |

Phase 1 검증에서 `project:alpha` 형식의 콜론 포함 채널이 실제 서버 필터로 동작함을 확인한다. 따라서 v1 규약은 `project:<id>`를 그대로 사용한다. 추후 서버가 콜론을 거부하는 버전으로 바뀌면 `project--<id>`로만 폴백하고 이 문서를 함께 갱신한다.

## TTL 기본값

| fact_type / 기록 유형 | retention_class | 자동 삭제 정책 |
| --- | --- | --- |
| `decision` | `permanent` | 자동 삭제 금지 |
| `preference` | `permanent` | 자동 삭제 금지 |
| `project_state` | `days90` | 90일 경과 후 pruning 가능 |
| `summary` | `days180` | 180일 경과 후 pruning 가능 |
| `note` | `days180` | 180일 경과 후 pruning 가능 |

`prunable()`은 `permanent`를 항상 건너뛴다. 기간형 보존값은 `updated_at`을 우선 기준으로 삼고 없으면 `created_at`을 사용한다.

## 5개 저장 경로와 비밀 게이트 지점

```text
1. distilled_fact
   makeFact/validateFact
     -> assertSafe(statement, "distilled_fact")
     -> ContextStore.storeFact()
     -> MCP stdio 저장

2. cold_archive
   archiveConversation(content)
     -> scanSecrets(content)
     -> 발견 시 redactSecrets(content)만 사용
     -> archive.jsonl append

3. explicit_write
   사용자가 명시한 장기 저장 요청
     -> assertSafe(text, "explicit_write")
     -> DistilledFact 변환
     -> distilled_fact 경로로 저장

4. auto_distill
   대화/세션 자동 증류 후보
     -> assertSafe(candidate.statement, "auto_distill")
     -> DistilledFact 변환
     -> distilled_fact 경로로 저장

5. archive_ingest
   기존 로그/대화 아카이브 적재
     -> scanSecrets(raw)
     -> 발견 시 redactSecrets(raw)만 보존
     -> cold_archive 경로로 append
```

원칙은 fail-closed다. 일반 저장 경로는 비밀 탐지 시 `SecretBlockedError`로 거부한다. 아카이브 적재만 예외적으로 원문 대신 redacted-only 레코드를 저장한다.

## 상시 구동 아키텍처

Phase 1은 클라이언트별 stdio 서버 프로세스를 띄우고, 모든 프로세스가 같은 `DATA_DIR` 아래 SQLite 저장소를 바라보는 구조다. 클라이언트 프로세스가 종료되어도 데이터는 공유 SQLite 파일에 남고, SQLite WAL은 동시 reader와 단일 writer 직렬화를 제공한다. 따라서 별도 데몬이 항상 떠 있지 않아도 “다음 클라이언트가 같은 저장소를 열면 직전 컨텍스트가 유지된다”는 상시성 요건을 충족한다.

`SERVER_SPEC`는 `node_modules/mcp-memory-keeper/dist/index.js`를 stdio로 실행하고 `DATA_DIR`만 저장소 위치로 주입한다. 테스트는 임시 `DATA_DIR`를 사용해 실제 stdio 서버와 왕복하며, 제품 기본값은 `data/memory`와 `data/archive`이다.
