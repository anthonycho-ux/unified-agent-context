# ROUTING.md — implementation-task delegation fallback order (Mac)

Verified 2026-07-16 by Claude Code (direct filesystem + auth-token decode on the user's Mac).
Companion shared-store fact: dedupe_key `4814080805b18405` (scope `global`).

## The one thing that keeps biting the fleet

`codex-secondary` is **not** a second account. Both `~/.codex/auth.json` and
`~/.codex-secondary/auth.json` decode to the **same** ChatGPT account (same
`chatgpt_account_id`, same email, same `plus` plan, same org). A `CODEX_HOME`
switch gives a separate *session*, not a separate *quota*.

Consequence: when Primary hits an **account-level weekly usage cap**, Secondary
is capped too. Failing over to `codex-secondary` / `codex-web` only helps for
**CODEX_HOME-local** failures (corrupted token, broken session state), never for
an account cap. (Corroborated 2026-07-13: the codex secondary device-login also
returned 429 when the account was rate-limited.)

Current known state: **Primary Codex weekly cap active, blocked until 2026-07-22.**

## Fallback order for implementation (side-effecting) tasks

1. **Codex Primary** (`codex-primary`, `CODEX_HOME=~/.codex`) — default when quota is available.
2. ~~Codex Secondary~~ — **SKIP for usage-cap failures** (same account = same cap).
   Use `codex-secondary` *only* if the failure is CODEX_HOME-local (auth/session
   corruption on Primary), never as a quota workaround.
3. **Claude Code CLI** (local) — the healthy implementation fallback. Verified:
   v2.1.211, authed `<account-email>`, Claude Max 5x, valid credentials.
   No network dependency beyond Anthropic API. **Preferred fallback when Codex is capped.**
4. **gjc via `ssh store-host` / `store-host-ts`** (network-dependent) — store-host is reachable over SSH
   and carries its own `codex` + `claude` binaries. **PATH caveat (verified 2026-08-02):**
   a bare `ssh store-host '<cmd>'` runs a non-login shell that reads none of store-host's rc files,
   so it finds the OLD system-dir binaries (`/usr/bin/claude`, `/snap/bin/codex`,
   `/usr/local/bin/letta`), not the current home-dir installs. Always invoke as
   `ssh store-host 'bash -lc "<cmd>"'` to get the real versions. **Caveat:** gjc delegates to a
   model provider; if its role-agent overrides point at the (capped) OpenAI/Codex
   account, gjc fast-fails with 429 just like Primary. Before routing here, confirm
   gjc's `config.yml` role-agents point at a healthy provider (e.g. `claude-opus-4-8`),
   and that store-host's own codex auth is configured (unverified as of 2026-07-16 — no
   `~/.codex/auth.json` in store-host's default home).
5. **Ask the human (the user).** When 1–4 are unavailable or the task is
   consequential, escalate rather than silently degrade.

## Read-only / research tasks

Use `codex-web` (auto-fails Primary → Secondary on rate-limit). Still bound by the
same account cap, so on a weekly cap this also stalls — fall through to Claude Code
CLI or gjc(healthy-provider) as above.

## Guardrails

- **Never auto-retry side-effecting work across CODEX_HOME accounts** — duplicates
  actions and breaks provenance.
- **Verify before believing a routing fact.** A sandboxed agent (e.g. Aside/Sol)
  may not see `~/.local/bin` or `~/.codex*` paths and can wrongly conclude a worker
  is "missing." Confirm on the real host before rewriting shared facts.

## Visible-lane orchestration (2026-09-04, the user-verified)

Multi-step implementation work defaults to herdr coding-agent panes (grok/claude etc.) in a task-named workspace: the user watches work live in his herdr UI, dispatching agent verifies via herdr agent read and integrates. Short lookups and parallel research may stay on aside subagents. Hidden-lane principle: any dark-room subagent expected to run 2+ minutes needs a visible herdr mirror or starts in herdr instead. store-host-side builds: run the command inside a herdr pane over ssh so work stays visible. Evidence 2026-09-04: grok agent cndream-observer spawned by Sol (Aside) in workspace cndream-showcase; the user watched live and confirmed the workflow. Resilience corollary (2026-09-04): herdr panes run on the Mac host shell and keep working when Aside's sandboxed Bash tool is down (spawn ENOENT, socket-copy EINVAL), giving the user live monitoring even during Bash outages.
