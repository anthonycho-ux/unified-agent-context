# Handoff prompt — UAC store connectivity (Tailscale) issue

Paste the block below to a coding agent working on this repo.

---

You are working on **Unified Agent Context (UAC)** in this `unified-agent-context` checkout,
a shared local memory store that multiple AI agents (Claude Code, Codex, Hermes, gajaecode,
lettacode) read/write so decisions and preferences carry across sessions. The canonical
store is an `mcp-memory-keeper` MCP server that lives on a self-hosted box **store-host**, reached
over SSH stdio-MCP. Config: `uac.config.json`. Host resolution: `src/config.mjs`. Connection:
`src/store-adapter.mjs` (`ContextStore.connect`). CLIs: `scripts/record-fact.mjs`,
`scripts/inject-context.mjs`.

## The problem
store-host is reachable two ways: SSH alias `store-host` (LAN) and `store-host-ts` (Tailscale).
The owner **often leaves Tailscale on at home and forgets to turn it off**, so connectivity
state is inconsistent:
- Tailscale ON (home or away): `store-host-ts` works; LAN `store-host` may or may not.
- Tailscale OFF at home: only LAN `store-host` works; `store-host-ts` times out.

Originally `uac.config.json` hardcoded a single `host: "store-host"`, so whenever that one route was
down, `record-fact` / `inject-context` failed with `MCP error -32000: Connection closed` and
facts silently didn't persist. Neither single host is always correct.

## The fix already applied (verify, don't redo)
Make UAC try candidate hosts in priority order and use the first that connects:
- `uac.config.json` now has `"host": "store-host-ts"`, `"fallbackHosts": ["store-host"]` (store-host-ts first
  because Tailscale is usually on; LAN store-host as fallback).
- `src/config.mjs`: `resolveServerSpec()` now returns an **array** of specs; exports
  `SERVER_SPECS` (ordered candidates) plus `SERVER_SPEC = SERVER_SPECS[0]` for back-compat.
  Added `UAC_STORE_HOST` env override (forces a single host, no fallback). `local` and the
  test escape hatches (`UAC_SERVER_ENTRY` / `UAC_DATA_DIR` / `UAC_REMOTE=0`) still return a
  single local spec.
- `src/store-adapter.mjs`: `connect()` iterates `SERVER_SPECS`, returns the first successful
  connection, closes failed transports, throws the last error only if all candidates fail.
- All 73 tests pass (`node --test 'tests/*.test.mjs'`).

## What to do
1. Confirm connectivity is currently up: `ssh -o BatchMode=yes -o ConnectTimeout=8 store-host-ts hostname`
   (fall back to `store-host`). If both time out, the tunnel/LAN is down — this is an environment
   issue, not a code bug; the code will degrade cleanly.
2. Live-verify the fallback end to end once a host is reachable:
   `node scripts/record-fact.mjs --type preference "connectivity self-test $(date +%s)"`
   then `node scripts/inject-context.mjs` and confirm the marker appears. Delete/ignore the
   marker after.
3. Consider hardening (optional, discuss first):
   - Lower per-candidate `ConnectTimeout` (currently 10s) so a fully-offline attempt fails
     faster than ~20s across two candidates, or probe reachability (TCP:22) in parallel and
     pick the winner instead of serial timeouts.
   - Emit a one-line degraded-mode warning naming which hosts were tried when all fail.
4. Do NOT commit blindly: the repo has other in-progress uncommitted work
   (`src/config.mjs`, `src/store-adapter.mjs`, `README.md`, librarian files). Stage and commit
   only the connectivity-related changes with a clear message; leave unrelated work untouched.

## Guardrails
- Keep the test escape hatches working (tests must never SSH).
- Don't hardcode IPs in committed code; use SSH aliases (`store-host`, `store-host-ts`) and let ssh_config
  resolve them.
- Preserve `window`-free, dependency-light behavior; this is CLI/MCP code.
