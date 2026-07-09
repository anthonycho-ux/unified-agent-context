# Phase 6 — 기기 독립 접근 (정본 스토어 sov 이전)

- 일시: 2026-07-08
- 배경: "어느 기기/환경에서 시작하든 같은 컨텍스트" — 정본을 항상 켜져 있는 sov로 이전

## 아키텍처

```
Mac (또는 미래의 어떤 기기)                 sov (정본 보유, 24/7)
────────────────────────                  ─────────────────────
UAC CLI/훅
  └─ ContextStore.connect()
       └─ spawn: ssh sov "DATA_DIR=… ──▶  mcp-memory-keeper (stdio-MCP)
                 exec node …index.js"        └─ ~/.uac/data/memory/context.db  ← 정본
sov 로컬 세션 (Hermes/Letta):
  ~/unified-agent-context (host:"local") ──▶  같은 DB를 직접 스폰
```

- 전송: **stdio-MCP over ssh** — Tailscale ssh 키 재사용, 신규 데몬/포트/인증 0개.
- 스토어 해석 우선순위 (`src/config.mjs`): `UAC_SERVER_ENTRY`/`UAC_DATA_DIR`(테스트·오버라이드, 로컬) → `UAC_REMOTE=0`(탈출구) → `uac.config.json` store 블록(`host:"local"`=직접, 원격=ssh) → 레거시 로컬.
- 새 기기 합류 = repo clone + `uac.config.json`에 `host:"sov"` + ssh 키. 끝.

## 마이그레이션 기록

- Mac `data/memory/context.db` (30 items) → `sov:~/.uac/data/memory/context.db` (scp, WAL 0B 상태에서 단일 파일 복사).
- 서버 버전 양쪽 mcp-memory-keeper **0.14.0** 일치 확인 후 이전.
- sov 배포: `~/unified-agent-context` (rsync, config는 local 변형).
- Mac의 옛 `data/memory/context.db`는 롤백용으로 보존 (주입 경로에서는 미사용).

## 검증 (2026-07-08 라이브)

- Mac `inject-context.mjs` → sov 스토어의 팩트 출력 ✓
- Mac `record-fact.mjs` → sov의 sqlite 파일에서 직접 확인 ✓
- sov `inject-context.mjs` → Mac에서 기록한 팩트 포함 출력 ✓
- 전체 스위트 73/73 (테스트는 `UAC_DATA_DIR` 격리로 전부 로컬 유지) ✓

## 정직한 한계

- **오프라인 기기에서 기록 불가** — ssh 불가 시 injector는 기존 degraded 모드(4증거 방출)로 처리되지만 record-fact는 실패한다. 오프라인 로컬 큐 + 재동기화는 v2.
- iPhone은 직접 접속 대상이 아님 — iPhone의 Hermes는 sov 게이트웨이를 경유하므로 sov 로컬 경로로 커버된다.
- 다중 기기 동시 쓰기는 SQLite 락에 의존 — 현 사용 패턴(단일 사용자)에서는 충분, 팀 규모는 v2 원격 MCP 서버 필요.
