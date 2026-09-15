# Handoff — session-digest bus (회의록 서랍)

Paste-ready brief for a coding agent continuing this work in Orca.
Repo: the `unified-agent-context` checkout on this machine (public repo URL in README).
Default worker: gjc via `orca terminal create --command <local-bin>/gjc` (user's stated prior).

---

## Context

UAC already unifies **facts** (preferences, decisions, project state) across
the user's fleet (Aside/Sol, Claude Code, gjc, Hermes, lettacode, Codex). What it
does not carry is **episodic continuity**: sessions evaporate, so each agent
greets the user as a stranger to whatever another agent did an hour ago. He
described the felt problem directly (2026-07-11, Aside sidepanel session):

> "I want to feel like I'm talking to one agent although I may talk to a dozen
> different coding agents."

Design conversation settled on the **회의록 서랍 (meeting-minutes drawer)**
principle, in his words:

> "내가 에이전트들이 서로 이야기 하는 걸 일일이 지켜볼 필요는 없지. 중요한 건
> 그런 논의를 서로 한다는 사실을 내가 확인하고 싶을 때 확인할 수 있는 게 중요해."
> (I don't need to watch agents talk in real time. What matters is that I can
> verify those discussions happened, whenever I choose to look.)

**This is NOT a UAC redesign.** It is one additive layer on the existing store:
every agent writes a ~10-line digest at session end, and injects recent
fleet-wide digests at session start. Records, not surveillance. No viewer UI in
v1 — the user inspects on demand by asking any agent (usually Sol) "what have
the agents been discussing," which the query path must support.

These decisions are settled — implement, don't re-debate.

## Validated procedure (manual runs that prove the write path)

The underlying write/read path already works end-to-end, exercised manually on
2026-07-11 from the Mac:

1. `node scripts/record-fact.mjs --type preference --scope global "<statement>"`
   → `RECORDED <dedupe_key> global` for four facts (dedupe keys
   `54acd348ecd775a3`, `f1a85d7a5e17ac34`, `9b72dba26e467781`, `2e491347e2b98417`).
2. Readback verified via `node scripts/inject-context.mjs` (all four statements
   present in the injection block).
3. Canonical persistence verified on store-host:
   `grep -rl "strongest-critic" ~/.uac/data/memory/` →
   `~/.uac/data/memory/context.db`.

The digest bus reuses exactly this pipeline (`src/recorder.mjs` →
`src/store-adapter.mjs` → ssh stdio-MCP `mcp-memory-keeper` on store-host, per
`uac.config.json`: host `store-host-ts`, fallback `store-host`, dataDir
`~/.uac/data/memory`). What's new is a fact shape for digests, a
session-end hook per agent, and a digest section in the injection block.

## Requirements

### 1. Digest fact shape (extend, minimally, what exists)

- `src/schema.mjs` `FACT_TYPES` is currently
  `{'decision','preference','project_state'}`, but `RETENTION_BY_FACT_TYPE`
  **already reserves `summary: 'days180'`**. Add `'summary'` to `FACT_TYPES`
  (and to the `record-fact.mjs` CLI usage string). Do not invent a new
  retention class.
- Scope: keep the existing validator (`global` | `project:<id>`) untouched.
  Digests use `project:<git-root-id>` when the session had a project cwd,
  else `global`.
- Statement format (machine-parseable header line + body, ≤ ~10 lines):

  ```
  digest [agent:<aside|claude-code|gjc|hermes|lettacode|codex>] [session:<id>] [at:<ISO8601>] [task:<task_id|->]
  did: <1-3 lines: what was discussed/decided/done>
  decided: <0-3 lines: decisions taken, if any>
  open: <0-3 lines: open threads / next steps>
  ```

- Dedupe: `dedupe_key = sha256(statement+scope)[:16]` (existing) — unique per
  session because the header embeds session id + timestamp. No schema change.
- Secret gate: all digest writes go through the existing fail-closed
  `assertSafe(statement, ...)` path in `src/recorder.mjs`. No bypass.
  Digests are summaries only — no credentials, no full transcripts.

### 2. Write path: `scripts/record-digest.mjs` + per-agent session-end hooks

- New thin CLI mirroring `record-fact.mjs`:
  `node scripts/record-digest.mjs --agent <id> --session <sid> [--task <task_id>] [--cwd <dir>] "<body>"`
  → composes the statement header, records with `fact_type: 'summary'`,
  `source_ref: 'hook:session-end:<agent>'`.
- Hooks (start with the two cheapest, stub the rest):
  - **Claude Code / Codex**: register a session-end (Stop) hook script the way
    notchi/vibe-notch register theirs — shell script calling record-digest with
    a summary produced by the agent itself (hook receives transcript path; v1
    may pass the agent's own last-summary or a truncated tail as body).
  - **Aside/Sol**: no native hook system — v1 is convention: Sol's memory
    pipeline / Sol itself calls record-digest at session close. Document this
    in the README section; do not build Aside-side code in this repo.
  - **Hermes / gjc / lettacode (store-host-side)**: wrapper-script integration point;
    if their wrappers are out of reach this pass, mark stubbed in the README.
- Degraded mode matches existing convention: if store-host is unreachable, warn on
  stderr, exit 0 (never crash a session close), and queue to a local spool
  under `data/digest-outbox/` (note: `.gitignore` already ignores `data/`
  entirely — **verified**, so spooled digests can never leak to the public
  repo; the canonical store lives on store-host outside the repo anyway).
  Flush the spool opportunistically on next successful write.

### 3. Read path: digests in the injection block + on-demand query

- Extend `src/injector.mjs` `getInjectionBlock()` with a second section:
  most recent digests (default: last 3 days or last 15 digests, whichever is
  smaller), all agents, both scopes, newest first, rendered compactly.
- On-demand query (the "drawer open" gesture):
  `node scripts/inject-context.mjs --digests [--days N] [--agent <id>]`
  prints digests only. This is what Sol (or any agent) runs when the user asks
  "what have the agents been discussing."
- Coordinate with the in-flight flavor-adapters work
  (`docs/handoff-agent-flavor-adapters.md`): if `--agent` adapter selection has
  landed, digests are a relevance-filtered section inside each adapter's
  output; if not, append to the generic block. Do not block on it.

### 4. Ledger linkage (investigated — schema is real, integration is optional-v1)

- Stage-1 unified task ledger lives on store-host:
  `~/.hermes/data/model-registry.db`, table `tasks`
  (schema: `~/.hermes/scripts/task-ledger-schema.sql`; PK `task_id`, plus
  `intent`, `state`, `owner_agent`, `evidence`, `parent_task_id`, ...).
- Linkage = the `[task:<task_id>]` header field when a digest corresponds to a
  delegated task; `-` otherwise. v1 writes the reference only (no FK, no write
  into the ledger DB). A later stage may join digest ↔ ledger for
  verified-outcome scoring (Stage 2). **Open integration point**: who passes
  task_id into the hook environment — propose `UAC_TASK_ID` env var honored by
  record-digest, set by the Orca/Controller wrappers when they spawn workers.

### Frequency / latency / storage

- Write: once per session close (plus spool flush). No streaming, no polling.
- Read: once per session start + on-demand queries. Staleness tolerance: hours.
- Storage: existing store-host store; `summary` facts auto-expire via the existing
  days180 retention sweep.

## Interface back to Aside (the contract — keep stable)

- Write: `node scripts/record-digest.mjs --agent aside --session <sid> [--task <id>] "<body>"` (exit 0 even when degraded).
- Read: `node scripts/inject-context.mjs` includes a `## Recent fleet digests`
  section; `--digests [--days N] [--agent <id>]` returns digests only.
- Fact shape: `fact_type: 'summary'`, statement header
  `digest [agent:..] [session:..] [at:..] [task:..]` — parseable by one regex.

## Non-goals

- No persona/soul syncing — flavor stays local (per the approved
  flavor-adapters direction; conflict rule unchanged: facts→store wins,
  style→local wins).
- No real-time relay/streaming, no watch-mode, no viewer UI in v1.
- No new datastore — reuse the store-host mcp-memory-keeper store.
- No full-transcript storage; digests are ≤ ~10-line summaries.
- No changes to routines/monitors, no Aside-internal code in this repo.
- No writes into the Hermes ledger DB (reference-only linkage in v1).

## Acceptance tests

1. **Write + persist**: `record-digest.mjs --agent claude-code --session t1 "did: test"` exits 0, prints `RECORDED <key> <scope>`, and the statement is present in `~/.uac/data/memory/context.db` on store-host within 60s.
2. **Readback**: after (1), `inject-context.mjs --digests --days 1` prints the digest; plain `inject-context.mjs` includes it in the fleet-digests section.
3. **Secret gate**: a digest body containing a fake `sk-...`-style token is rejected (exit 3, `BLOCKED`), and nothing is written to the store or spool.
4. **Degraded mode**: with store-host unreachable (e.g. bogus `UAC_STORE_HOST` override), record-digest exits 0, warns on stderr, spools to `data/digest-outbox/`; next successful run flushes the spool and the digest appears in the store.
5. **Ledger reference**: `UAC_TASK_ID=abc123 record-digest.mjs ...` (or `--task abc123`) produces a statement whose header contains `[task:abc123]`, retrievable via the digests query.
6. **Retention class**: the stored fact has `fact_type: 'summary'` and `retention_class: 'days180'` on readback validation.

## Repo orientation (read first)

- `docs/handoff-agent-flavor-adapters.md` — sibling in-flight work; match its conventions.
- `src/schema.mjs` — fact validation, `FACT_TYPES`, retention map (the one-line extension lives here).
- `src/recorder.mjs` — the only official write API; go through it.
- `src/store-adapter.mjs` — ssh stdio-MCP to store-host, `context_save`/`context_get`/`context_search`.
- `scripts/record-fact.mjs` / `scripts/inject-context.mjs` — CLI patterns to mirror.
- `uac.config.json` — store host resolution (`store-host-ts` → `store-host` fallback).

## Open integration points (flagged for the owner, not blockers)

1. **task_id plumbing**: `UAC_TASK_ID` env-var convention needs a matching
   change in the Orca/Controller wrapper scripts on store-host (out of this repo's
   scope) before ledger linkage is automatic; manual `--task` works meanwhile.
2. **Hermes/gjc/lettacode hooks**: store-host-side wrapper edits are a separate
   dispatch; v1 may ship with only Claude Code/Codex hooks + Aside convention.
3. **Public-repo privacy**: resolved — store is on store-host outside the repo and
   `data/` is fully gitignored (verified `.gitignore`: `data/` entry present);
   keep the spool under `data/` and never add a tracked digest fixture with
   real content.
4. **Flavor-adapters collision**: if `--agent` injection adapters land first,
   rebase the digest section into the adapter output rather than the generic
   block.
