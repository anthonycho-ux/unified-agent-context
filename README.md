# Unified Agent Context

**English** | [한국어](README.ko.md) | [中文](README.zh-CN.md) | [日本語](README.ja.md) | [Español](README.es.md)

Every new AI chat starts with amnesia. Yesterday you told Claude you like your
READMEs in English. This morning Codex asked. Tonight a third assistant will
ask again. You run five AI agents, and you are the only memory they share.
You are spending yourself one re-explanation at a time.

**Unified Agent Context ends that.** Tell any agent a decision once. Every
other agent knows it in its very next session. Automatically, on every
machine, with secrets locked out by design.

![UAC in 27 seconds](artifacts/promo/uac-promo.gif)

## How it works

```
Agents ──(MCP stdio, over ssh when remote)──► mcp-memory-keeper (canonical: store-host ~/.uac/data/memory)
   │  ▲
   │  └─ Session start: inject distilled facts only (hook or instructed pull) — scripts/inject-context.mjs
   └──── During session: explicit record (record-fact) / on exit: auto-distill (distill-session)
              └─ Every write path goes through a central fail-closed secret gate (block or redact)
              └─ Permanent facts queue into the librarian outbox → librarian-sync delivers to the
                 store-host Letta "The Noticer" inbox (Phase 5)
```

In plain words.

- All your agents read and write one shared memory.
- A preference follows you everywhere. A project decision stays inside its project.
- Decisions and preferences are kept forever. Day to day work state expires after 90 days.
- Raw conversations are never injected into sessions. They rest in a cold archive, and secrets are scrubbed on the way in.
- Every write passes a secret gate. Keys and passwords are blocked by default.
- If the store is unreachable, agents say so loudly instead of guessing quietly.
- The main store lives on one home server named store-host. Every other machine reaches it over ssh.

## The docs

| Doc | What it covers |
|-----|----------------|
| `docs/phase0-comparison.md` | Which store we picked, and why. |
| `docs/phase1-storage.md` | The schema, the scopes, retention, and the secret gate. |
| `docs/phase2-hooks.md` | How each of the five agents is wired in. |
| `docs/phase3-write-paths.md` | The five ways facts get written, plus distillation and quarantine. |
| `docs/phase4-coverage-matrix.md` | Twenty delivery paths, tested and verified. |
| `docs/phase5-librarian.md` | The librarian lane that curates permanent facts. |
| `docs/phase6-remote.md` | Moving the main store to store-host, and reaching it over ssh. |
| `docs/onboarding.md` | How a new agent joins in five minutes. |
| `docs/handoff-tailscale-connectivity.md` | What to do when the store connection flakes. |

## The commands

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

## The two week test

All the scenario tests pass. The real test is different. After two weeks of
daily use, do you still catch yourself explaining the same thing twice. Log
every repeat with `reexplain.mjs log`. If the weekly count falls to zero,
UAC works.

## Credits

Built end to end with **[GJC, Gajae Code](https://github.com/Yeachan-Heo/gajae-code)**,
an AI coding agent. The store phases, the story style of this README in five
languages, and the promo animation above were implemented, verified, and
shipped by GJC. While building UAC it was using the shared memory of UAC itself.
