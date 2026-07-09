# CLAUDE.md — agent orientation for Unified Agent Context (UAC)

Read this first if you're a coding agent working in this repo.

## What this is
UAC is a shared local memory store so multiple AI agents (Claude Code, Codex, Hermes,
gajaecode, lettacode) carry decisions/preferences across sessions without re-explaining.
The canonical store is an `mcp-memory-keeper` MCP server on the self-hosted box **sov**,
reached over SSH stdio-MCP. Facts are scoped `global` (preferences) or `project:<git-root>`
(decisions/state). Full architecture + phase docs are in `README.md` and `docs/`.

## Key files
- `uac.config.json` — store host + fallbacks, MCP entry, dataDir.
- `src/config.mjs` — host/spec resolution (`resolveServerSpec` → `SERVER_SPECS`).
- `src/store-adapter.mjs` — `ContextStore.connect()` (candidate fallback loop).
- `scripts/record-fact.mjs` — write a fact.  `scripts/inject-context.mjs` — read shared context.
- `scripts/doctor.mjs` — wiring self-check.  Tests: `node --test 'tests/*.test.mjs'` (73).

## Known issue: store connectivity (Tailscale/LAN)
sov is reachable via SSH alias `sov` (LAN) or `sov-ts` (Tailscale). The owner often leaves
Tailscale on and forgets to turn it off, so no single host is always reachable. UAC therefore
tries candidate hosts in priority order (`sov-ts` → `sov`) and uses the first that connects;
`UAC_STORE_HOST` forces one. If a `record-fact`/`inject-context` call fails with
`MCP error -32000: Connection closed`, first check whether any host is reachable
(`ssh -o ConnectTimeout=8 sov-ts hostname`) before treating it as a bug.

**Full context + troubleshooting + a paste-ready handoff prompt:**
see **`docs/handoff-tailscale-connectivity.md`**.

## Guardrails
- Tests must never SSH (keep the `UAC_SERVER_ENTRY` / `UAC_DATA_DIR` / `UAC_REMOTE=0`
  local-spec escape hatches intact).
- No hardcoded IPs in committed code — use SSH aliases and let ssh_config resolve them.
- Never write secrets to the store; the secret gate is fail-closed (respect it).
- This repo has in-progress uncommitted work; commit only changes related to your task with
  a clear message, and leave unrelated files untouched.
