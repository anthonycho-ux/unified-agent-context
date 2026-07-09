# Unified Agent Context

**English** | [한국어](README.ko.md) | [中文](README.zh-CN.md) | [日本語](README.ja.md) | [Español](README.es.md)

A v1 system that unifies the context/memory of multiple AI agents (claude code, codex, hermes, gajaecode, lettacode, …) into a single shared local store.

**One-line goal:** decisions and preferences made in any agent carry over to every agent's new session — without re-explaining.

## Architecture (canonical store = store-host, device-independent access)

```
Agents ──(MCP stdio, over ssh when remote)──► mcp-memory-keeper (canonical: store-host ~/.uac/data/memory)
   │  ▲
   │  └─ Session start: inject distilled facts only (hook or instructed pull) — scripts/inject-context.mjs
   └──── During session: explicit record (record-fact) / on exit: auto-distill (distill-session)
              └─ Every write path goes through a central fail-closed secret gate (block or redact)
              └─ Permanent facts queue into the librarian outbox → librarian-sync delivers to the
                 store-host Letta "The Noticer" inbox (Phase 5)
```

- Scopes: `global` (preferences) vs `project:<git-root-basename>` (decisions/work state) — cross-project leakage blocked (enforced by server-side queries)
- TTL: decision/preference kept permanently, project_state 90 days
- Raw conversations go to cold archive only (never injected; secrets are redact-only)
- Degraded mode: when the server is unreachable, emit 4 evidences (warning/log/health/metric); `UAC_STRICT=1` turns it into a hard failure
- Device independence: the canonical store lives on store-host — other machines (e.g. the Mac) reach it via ssh spawn configured in `uac.config.json` (Phase 6)
- Planned for v2: offline local queue + resync / self-hosted remote MCP + auth → claude.ai joining

## Documentation

| Doc | Contents |
|-----|----------|
| `docs/phase0-comparison.md` | Store candidate comparison + adoption rationale |
| `docs/phase1-storage.md` | Schema / scopes / TTL / secret gate |
| `docs/phase2-hooks.md` | Wiring for the 5 harnesses + degraded mode |
| `docs/phase3-write-paths.md` | The 5 write paths + distillation/quarantine |
| `docs/phase4-coverage-matrix.md` | 20-path coverage matrix + verification tiers |
| `docs/phase5-librarian.md` | Letta librarian handoff lane (single-writer curation) |
| `docs/phase6-remote.md` | Canonical store move to store-host + ssh stdio-MCP access |
| `docs/onboarding.md` | **New-agent onboarding procedure (5 min)** |
| `docs/handoff-tailscale-connectivity.md` | Store connectivity (Tailscale/LAN) issue + auto-fallback handoff prompt |

## Key commands

```sh
node scripts/inject-context.mjs [--cwd <dir>]        # print the shared context block
node scripts/record-fact.mjs --type decision "..."   # explicit record (secrets blocked with exit 3)
node scripts/distill-session.mjs --file <transcript> # distill a session + quarantine sweep
node scripts/librarian-sync.mjs [--strict]           # deliver outbox → store-host librarian inbox (Phase 5)
node scripts/doctor.mjs                              # wiring self-check
node scripts/cross-verify.mjs                        # re-run the 20-path coverage matrix
node scripts/reexplain.mjs log|report                # re-explanation metrics (2-week gate aux indicator)
node --test 'tests/*.test.mjs'                       # full test suite (73)
```

## 2-week real-use gate (in progress)

All scenario tests pass. Final acceptance is judged by the user: **does the feeling of "explaining things again" disappear over 2 weeks of real use?** Every time a re-explanation happens, log it with `reexplain.mjs log`; after 2 weeks, check whether the weekly trend in `report` converges to zero.
