# Unified Agent Context

[English](README.md) | **한국어** | [中文](README.zh-CN.md) | [日本語](README.ja.md) | [Español](README.es.md)

모든 새 AI 채팅은 기억상실에서 시작한다. 어제 Claude에게 README는 영어가
기본이라고 말했는데, 오늘 아침엔 Codex가 묻는다. 오늘 밤엔 세 번째 에이전트가
또 물을 것이다. 에이전트는 다섯인데, 그들이 공유하는 유일한 기억은 당신뿐이다.
당신은 자신을 재설명 한 번에 하나씩 소모하고 있다.

**Unified Agent Context가 그것을 끝낸다.** 아무 에이전트에게나 한 번만 말하라.
다른 모든 에이전트가 바로 다음 세션에서 그것을 알고 있다. 자동으로, 모든
기기에서, 비밀 정보는 차단된 채로.

당신이 기억을 손으로 잇는 일은 없다. 한 에이전트의 컨텍스트를 다른 에이전트로
옮겨 붙이는 일도 없다. 그게 약속의 전부다. 당신이 직접 해야 하는 순간이 오면,
UAC 는 실패한 것이다.

![UAC 27초 데모](artifacts/promo/uac-promo.gif)

## 어떻게 동작하나

```
에이전트들 ──(MCP stdio, 원격이면 ssh 경유)──► mcp-memory-keeper (정본: store-host ~/.uac/data/memory)
   │  ▲
   │  └─ 세션 시작: 증류된 사실만 주입 (훅 또는 지시 pull) — scripts/inject-context.mjs
   └──── 세션 중 명시 기록 (record-fact) / 종료 자동 증류 (distill-session)
              └─ 모든 저장 경로는 중앙 fail-closed 비밀 게이트 경유 (차단 or redact)
              └─ 영구 팩트는 사서 outbox 큐잉 → librarian-sync가 store-host Letta "The Noticer" inbox로 배달 (Phase 5)
```

쉽게 말하면 이렇다.

- 모든 에이전트가 하나의 공유 메모리를 읽고 쓴다.
- 선호는 어디서나 따라온다. 프로젝트 결정은 그 프로젝트 안에만 머문다.
- 결정과 선호는 영원히 보관된다. 작업 상태는 90일 뒤에 사라진다.
- 원본 대화는 세션에 주입되지 않는다. 비밀이 지워진 채 콜드 아카이브에만 남는다.
- 모든 저장은 비밀 게이트를 지난다. 키와 비밀번호는 기본적으로 차단된다.
- 저장소에 연결이 안 되면 에이전트가 조용히 넘어가지 않고 크게 알린다.
- 정본 저장소는 store-host라는 홈서버 한 대에 있다. 다른 기기는 ssh로 접근한다.

## 문서

| 문서 | 내용 |
|------|------|
| `docs/phase0-comparison.md` | 어떤 저장소를 골랐고, 왜 골랐나. |
| `docs/phase1-storage.md` | 스키마, 스코프, 보존 기간, 비밀 게이트. |
| `docs/phase2-hooks.md` | 다섯 에이전트를 각각 어떻게 연결했나. |
| `docs/phase3-write-paths.md` | 사실이 기록되는 다섯 가지 길, 그리고 증류와 검역. |
| `docs/phase4-coverage-matrix.md` | 스무 개 전달 경로, 전부 테스트로 검증. |
| `docs/phase5-librarian.md` | 영구 팩트를 큐레이션하는 사서 레인. |
| `docs/phase6-remote.md` | 정본 저장소의 store-host 이전, 그리고 ssh 접근. |
| `docs/onboarding.md` | 새 에이전트가 5분 안에 합류하는 법. |
| `docs/handoff-tailscale-connectivity.md` | 저장소 연결이 끊길 때 대처법. |

## 커맨드

```sh
node scripts/inject-context.mjs [--cwd <dir>]        # 공유 컨텍스트 블록 출력
node scripts/record-fact.mjs --type decision "..."   # 명시 기록 (비밀은 exit 3 차단)
node scripts/distill-session.mjs --file <transcript> # 세션 증류 + 검역 스윕
node scripts/librarian-sync.mjs [--strict]           # outbox → store-host 사서 inbox 배달 (Phase 5)
node scripts/doctor.mjs                              # 배선 자가진단
node scripts/cross-verify.mjs                        # 20경로 커버리지 매트릭스 재실행
node scripts/reexplain.mjs log|report                # 재설명 계측 (2주 관문 보조지표)
node --test 'tests/*.test.mjs'                       # 전체 테스트 (73)
```

## 2주 테스트

시나리오 테스트는 전부 통과했다. 진짜 테스트는 따로 있다. 2주 동안 실제로
쓰면서, 같은 말을 두 번 하는 순간이 아직도 있는지 보는 것이다. 반복이 생길
때마다 `reexplain.mjs log`로 기록한다. 주간 횟수가 0으로 떨어지면 UAC는 성공이다.

## 크레딧

**[GJC, Gajae Code](https://github.com/Yeachan-Heo/gajae-code)**, AI 코딩
에이전트와 함께 처음부터 끝까지 만들었다. 저장소 페이즈들, 다섯 언어 README의
이야기 스타일, 위의 프로모 애니메이션까지 GJC가 구현하고 검증하고 배포했다.
만드는 동안 UAC 자신의 공유 메모리를 쓰고 있었다.
