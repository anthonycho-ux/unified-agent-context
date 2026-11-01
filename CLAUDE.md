# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is
UAC is a shared local memory store so multiple AI agents (Claude Code, Codex, Hermes,
gajaecode, lettacode) carry decisions/preferences across sessions without re-explaining.
Facts are scoped `global` (preferences) or `project:<git-root-basename>` (decisions/state).
Architecture and phase history: `README.md` + `docs/phase*.md`. Fleet delegation context: `ROUTING.md`.

## Commands

```sh
npm test                                   # Node suite (~185 cases)
node --test tests/recorder.test.mjs        # one file
node --test --test-name-pattern "near-dup" tests/*.test.mjs   # one test
npm rebuild better-sqlite3                 # after any Node upgrade — see Known issues

cd store-go && go build -o uac-store .     # build the store binary (gitignored; not committed)

.venv-vlm/bin/python -m unittest discover -s tests/python -v   # Python room-change tests
./scripts/room-change-dev.sh               # Python tests + offline self-test (no models)
```

Daily CLIs (run from the repo root):

```sh
node scripts/inject-context.mjs [--cwd <dir>]         # print the session-start context block
node scripts/record-fact.mjs --type decision|preference|project_state [--scope <s>] [--author <a>] "..."
node scripts/distill-session.mjs --file <transcript>  # auto-distill + quarantine sweep
node scripts/context-sync.mjs                         # reconcile local <-> store-host (always exit 0)
node scripts/librarian-sync.mjs [--strict]            # deliver outbox -> store-host Letta inbox
node scripts/doctor.mjs                               # static hook/MCP wiring self-check
node scripts/onboard-agent.mjs --list | --harness <name> [--dry-run]
node scripts/cross-verify.mjs                         # 20-path cross-agent coverage matrix
```

## Architecture

Three layers; the boundaries are what matter.

### 1. The store (`store-go/`)
`store-go/uac-store` is a Go binary that is a drop-in replacement for the Node
`mcp-memory-keeper` server. It implements exactly four MCP tools — `context_session_start`,
`context_save`, `context_get`, `context_search` — over the same SQLite schema and DB file
(`$DATA_DIR/context.db`). Two modes: MCP on stdio, and `uac-store call <tool> '<json>'`
(one-shot, no handshake). The binary is **gitignored**, so a fresh clone must build it, or
point `UAC_SERVER_ENTRY` at `node_modules/mcp-memory-keeper/dist/index.js`.

### 2. Config + adapter (`src/config.mjs`, `src/store-adapter.mjs`)
`uac.config.json` names the store (`host`, `fallbackHosts`, `entry`, `dataDir`). Resolution
order in `resolveServerSpec()`:

1. `UAC_SERVER_ENTRY` / `UAC_DATA_DIR` / `UAC_REMOTE=0` → local spec (test escape hatches).
2. `UAC_STORE_HOST` → that host only, no fallback.
3. `store.host` (`local`, the current config) → spawn `store.entry` locally.
4. Remote host(s) → `ssh <host> DATA_DIR=... exec <entry>` stdio-MCP, tried in
   `store.host` → `store.fallbackHosts` order.

`ContextStore.connect()` walks the candidate specs and keeps the first that connects.
A JS entry is spawned under a canonical Node (`UAC_NODE` → mise shim); a native binary is
spawned directly and driven through `CliBackend` (one process per call). Every store call
goes through `ContextStore.callTool`, which turns `isError` results into exceptions.

### 3. Orchestration (`src/` + `scripts/`)
`src/` holds the logic; `scripts/` are thin CLI wrappers. The important modules:

- `schema.mjs` — the `DistilledFact` contract. Retention is **derived from** `fact_type`
  (`decision`/`preference` → `permanent`, `project_state` → `days90`), never chosen freely.
  `status: proposed` facts are excluded from injection until promoted.
- `secret-gate.mjs` — central fail-closed gate. `assertSafe(text, path)` requires a known
  write path (`explicit_write`, `auto_distill`, `archive_ingest`, `cold_archive`,
  `distilled_fact`) and throws `SecretBlockedError` on a match; `redactSecrets` is the
  archive-side counterpart.
- `recorder.mjs` — `explicit_write` path. Runs the near-dup gate (`near-dup.mjs`):
  *duplicate* returns the existing fact, *correction* stores the new one and tombstones the
  predecessor via `superseded_by`.
- `distiller.mjs` — `auto_distill`. Rule-based candidate extraction (opt-in LLM via
  `UAC_DISTILL_LLM=1`), secret-filtered, stored as `proposed`, raw transcript archived.
- `injector.mjs` — the read path. Reads the store-host source and the local source **in
  parallel**, unions by dedupe key (`merge.mjs`), drops `proposed` and tombstoned facts, and
  renders under a budget (30 global / 20 project / 8192 chars, `UAC_INJECT_*` overrides).
  A failed source degrades to partial rather than failing the block; `UAC_STRICT=1` makes
  degradation fatal (exit 2) for tests and CI.
- `librarian.mjs` — permanent, non-sensitive facts are queued to a local outbox and
  delivered by `librarian-sync` to the store-host Letta agent "The Noticer". Queueing never
  fails the write; delivery failure preserves the outbox.
- `archive.mjs`, `quarantine.mjs` — cold archive (secrets redacted, not blocked) and the
  sweep that re-checks raw rows and overwrites leaked values.
- `maps.mjs`, `llm-extract.mjs` — optional integrations; both take injectable
  `fetchImpl`/extractor so tests never touch the network.

`agent_context/` is a separate Python package (room change detection: SSIM pre-filter →
small VLM, backends `mlx`/`ollama`/`mock`) with its own `requirements-*.txt` and
`.venv-vlm`. It is not part of the Node test suite.

## Known issues

**Node ABI / better-sqlite3.** The Node store (`mcp-memory-keeper`) uses a native
`better-sqlite3` build locked to the Node that compiled it. After a Node upgrade, store
tests fail with `MCP error -32000: Connection closed` or `NODE_MODULE_VERSION` mismatch.
Fix with `npm rebuild better-sqlite3`. The Go store has no such coupling.

**Store connectivity (Tailscale/LAN).** When `uac.config.json` points at a remote host, it
is reachable via SSH alias `store-host` (LAN) or `store-host-ts` (Tailscale), and no single
host is always up. UAC tries candidates in priority order and uses the first that connects;
`UAC_STORE_HOST` forces one. On `MCP error -32000: Connection closed`, check reachability
(`ssh -o ConnectTimeout=8 store-host-ts hostname`) before treating it as a bug. Full
troubleshooting + handoff prompt: **`docs/handoff-tailscale-connectivity.md`**.

**Active handoff (agent flavor adapters):** standardize shared facts while keeping each
agent's voice local — **`docs/handoff-agent-flavor-adapters.md`**.

## Guardrails
- Tests must never SSH and must never hit the network (keep the `UAC_SERVER_ENTRY` /
  `UAC_DATA_DIR` / `UAC_REMOTE=0` local-spec escape hatches intact).
- No hardcoded IPs in committed code — use SSH aliases and let ssh_config resolve them.
- Never write secrets to the store; the secret gate is fail-closed (respect it).
- `store-go/uac-store` and `data/` are gitignored build/runtime artifacts — do not commit them.
- Match the surrounding file's language: `src/` and `scripts/` comments are mostly Korean,
  `agent_context/` and `docs/` are English.
- This repo has in-progress uncommitted work; commit only changes related to your task with
  a clear message, and leave unrelated files untouched.
