# Unified Agent Context

[English](README.md) | **한국어**

여러 AI 에이전트(claude code, codex, hermes, gajaecode, lettacode, …)의 컨텍스트/메모리를 하나의 로컬 공유 저장소로 통합하는 v1 시스템.

**목표 한 줄:** 어느 에이전트에서 정한 결정·선호도 재설명 없이 모든 에이전트의 새 세션에 이어진다.

## 아키텍처 (정본 = sov, 기기 독립 접근)

```
에이전트들 ──(MCP stdio, 원격이면 ssh 경유)──► mcp-memory-keeper (정본: sov ~/.uac/data/memory)
   │  ▲
   │  └─ 세션 시작: 증류된 사실만 주입 (훅 또는 지시 pull) — scripts/inject-context.mjs
   └──── 세션 중 명시 기록 (record-fact) / 종료 자동 증류 (distill-session)
              └─ 모든 저장 경로는 중앙 fail-closed 비밀 게이트 경유 (차단 or redact)
              └─ 영구 팩트는 사서 outbox 큐잉 → librarian-sync가 sov Letta "The Noticer" inbox로 배달 (Phase 5)
```

- 스코프: `global`(선호) vs `project:<git-root-basename>`(결정/작업 상태) — 프로젝트 간 누출 차단 (서버 쿼리 강제)
- TTL: decision/preference 영구 보존, project_state 90일
- 원본 대화는 콜드 아카이브만 (주입 금지, 비밀은 redact-only)
- degraded mode: 서버 부재 시 warning/log/health/metric 4증거 방출, `UAC_STRICT=1`이면 실패 처리
- 기기 독립: 정본 스토어는 sov — Mac 등 다른 기기는 `uac.config.json`의 ssh 스폰으로 접근 (Phase 6)
- v2 예정: 오프라인 로컬 큐 + 재동기화 / 셀프호스팅 원격 MCP + 인증 → claude.ai 합류

## 문서

| 문서 | 내용 |
|------|------|
| `docs/phase0-comparison.md` | 저장소 후보 대조표 + 채택 근거 |
| `docs/phase1-storage.md` | 스키마/스코프/TTL/비밀 게이트 |
| `docs/phase2-hooks.md` | 하네스 5종 배선 + degraded mode |
| `docs/phase3-write-paths.md` | 기록 경로 5종 + 증류/검역 |
| `docs/phase4-coverage-matrix.md` | 20경로 커버리지 매트릭스 + 검증 계층 |
| `docs/phase5-librarian.md` | Letta 사서 handoff lane (single-writer 큐레이션) |
| `docs/phase6-remote.md` | 정본 스토어 sov 이전 + ssh stdio-MCP 접근 |
| `docs/onboarding.md` | **신규 에이전트 합류 절차 (5분)** |
| `docs/handoff-tailscale-connectivity.md` | 스토어 연결(Tailscale/LAN) 이슈 + 자동 폴백 핸드오프 프롬프트 |

## 주요 커맨드

```sh
node scripts/inject-context.mjs [--cwd <dir>]        # 공유 컨텍스트 블록 출력
node scripts/record-fact.mjs --type decision "..."   # 명시 기록 (비밀은 exit 3 차단)
node scripts/distill-session.mjs --file <transcript> # 세션 증류 + 검역 스윕
node scripts/librarian-sync.mjs [--strict]           # outbox → sov 사서 inbox 배달 (Phase 5)
node scripts/doctor.mjs                              # 배선 자가진단
node scripts/cross-verify.mjs                        # 20경로 커버리지 매트릭스 재실행
node scripts/reexplain.mjs log|report                # 재설명 계측 (2주 관문 보조지표)
node --test 'tests/*.test.mjs'                       # 전체 테스트 (73)
```

## 2주 실사용 관문 (진행 중)

시나리오 테스트는 전부 통과 상태. 최종 합격은 **2주 실사용에서 "다시 설명하는" 체감이 사라졌는지** 사용자 확인으로 판정한다. 재설명이 발생할 때마다 `reexplain.mjs log`로 기록하고, 2주 후 `report`의 주간 추이가 0에 수렴하는지 본다.
