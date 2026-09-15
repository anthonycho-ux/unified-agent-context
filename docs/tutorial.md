# Tutorial — using Unified Agent Context day to day

This is the **human** guide. When UAC is working, you should almost never
think about it. This page is what to do on the rare days you *do* touch it.

If you are wiring a brand-new agent into the system, use
[`onboarding.md`](./onboarding.md) instead (5-minute join procedure).

---

## The one-sentence mental model

> Write a **fact** once. Every agent gets it next session — **in its own voice**.

| Layer | What lives there | Do you manage it? |
|-------|------------------|-------------------|
| Shared store (UAC) | Neutral facts: preferences, decisions, project state | Yes — record once |
| Per-agent flavor | How that fact is phrased for Claude / Aside / Hermes / … | No — adapters do it |
| Persona files (`SOUL.md`, agent style notes) | Tone, habits, tool idioms | Local only — never put these in UAC |

**Conflict rule:** facts → shared store wins. Style → the local agent wins.

---

## 0. Prerequisites (once)

```sh
export UAC_HOME=/path/to/unified-agent-context   # this repo
cd "$UAC_HOME"
node scripts/doctor.mjs                          # wiring self-check
```

If `doctor` complains about the store host, see
[`handoff-tailscale-connectivity.md`](./handoff-tailscale-connectivity.md)
(`sov-ts` → `sov` fallback).

Your agents should already be hooked up (session-start inject + optional
MCP). If not, finish [`onboarding.md`](./onboarding.md) first.

---

## 1. Tell one agent something once

### The easy way (preferred)
Just say it in a normal session:

> "Going forward, serious projects live under `~/Projects`."

If that agent is wired correctly, it (or its session-end distill hook) will
record a **preference** or **decision**. You should not have to open a
terminal.

### The explicit way (when you want to be sure)

```sh
# Global preference (follows you into every project)
node "$UAC_HOME/scripts/record-fact.mjs" \
  --type preference \
  "Serious development projects live under ~/Projects, not flat in home."

# Project decision (stays inside one repo)
node "$UAC_HOME/scripts/record-fact.mjs" \
  --type decision \
  --scope project:unified-agent-context \
  "Ship per-agent inject adapters before offline queue v2."
```

**Write like a fact, not an order.**

- Good: `User wants action-first replies (decision first, context after).`
- Bad: `You must always put DECIDE at the top of every message.`

The second form steals every agent's flavor. The first form lets each agent
render the same truth in its own dialect.

Secrets (API keys, tokens, passwords) are blocked by the secret gate. Do not
try to store them.

---

## 2. Confirm other agents already know

Next session in **any** wired agent, you should not need to re-explain.

To inspect what will be injected:

```sh
# Generic block (back-compat default)
node "$UAC_HOME/scripts/inject-context.mjs"

# Agent-flavored block (after adapters land)
node "$UAC_HOME/scripts/inject-context.mjs" --agent claude-code
node "$UAC_HOME/scripts/inject-context.mjs" --agent aside
node "$UAC_HOME/scripts/inject-context.mjs" --agent hermes
node "$UAC_HOME/scripts/inject-context.mjs" --agent codex
```

Same underlying facts. Different wording and different relevance filters.
That is the feature.

Quick round-trip self-test:

```sh
MARKER="tutorial self-test $(date +%s)"
node "$UAC_HOME/scripts/record-fact.mjs" --type preference "$MARKER"
node "$UAC_HOME/scripts/inject-context.mjs" | grep -F "$MARKER" && echo OK
```

---

## 3. Daily habits that make UAC actually work

1. **Prefer natural conversation.** Explicit `record-fact` is for certainty
   and scripts, not for every thought.
2. **Log re-explanations.** Every time you catch yourself explaining the
   same thing again, that is a product bug signal:

   ```sh
   node "$UAC_HOME/scripts/reexplain.mjs" log "had to restate Projects-folder convention" --agent claude-code
   node "$UAC_HOME/scripts/reexplain.mjs" report
   ```

   The 2-week gate is simple: weekly re-explain count should trend to zero.
3. **Keep project decisions in the project.** Do not dump every local
   implementation choice into `global`.
4. **Never put persona into the store.** "Be concise" as a *preference* is
   fine. Pasting a whole system prompt is not.

---

## 4. How agent flavor is supposed to feel

Example fact in the store:

> `preference: User wants action-first replies.`

| Agent | What inject roughly becomes |
|-------|-----------------------------|
| Claude Code | Lead status/PR notes with the conclusion; details below. |
| Aside | Lead with `**DECIDE:**` / `**Blocked on you:**` / `**No action needed.**`; use option buttons for 2–4 choices. |
| Hermes | One-line conclusion first on cards/status, then evidence. |

If two agents start sounding identical, the adapter layer is too thin or
someone stored imperative "you must…" instructions. Fix the **fact wording**,
not the agents.

Design detail: [`handoff-agent-flavor-adapters.md`](./handoff-agent-flavor-adapters.md).

---

## 5. When something feels broken

| Symptom | What to try |
|---------|-------------|
| Agent forgot a preference | `inject-context.mjs` — is the fact there? If no, re-record. If yes, check that agent's session-start hook / onboarding. |
| Store connection errors | `ssh -o ConnectTimeout=8 sov-ts hostname` then `sov`; see connectivity handoff. |
| Fact rejected on write | Probably the secret gate (exit 3) — remove credentials and rephrase. |
| Wrong project saw a decision | Scope leak — check `--scope` / channel. Project facts use `project:<git-root-basename>`. |
| All agents sound the same | Fact is imperative; rewrite as a neutral claim. Or adapter missing for that agent. |
| Wiring unsure | `node scripts/doctor.mjs` |

---

## 6. What "done" feels like

You stop opening this page.

You tell Claude a preference on Monday. Codex on Tuesday already knows.
Aside on Friday phrases it like Aside, not like Claude. You almost never run
`record-fact` by hand. `reexplain.mjs report` is boring.

That is the product.

---

## Related docs

| Doc | Audience |
|-----|----------|
| [`onboarding.md`](./onboarding.md) | You, wiring a new agent (5 min) |
| [`handoff-agent-flavor-adapters.md`](./handoff-agent-flavor-adapters.md) | Coding agents implementing adapters |
| `README.md` | Pitch + architecture overview |
| `docs/phase*.md` | Deep design notes |
