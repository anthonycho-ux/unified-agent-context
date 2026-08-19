# UAC Discussion Brief — first promo channel

Topic id: `2026-07-16-first-promo-channel`

## Question

Which **single** channel should the first UAC promo post ship to this week:

- X
- Reddit r/LocalLLaMA
- Hacker News Show HN

Pick **exactly one**.

## Context

- Ready assets: 27s terminal GIF and post drafts in `artifacts/promo/posts/`
- Standing rule: ship one real post before building any pipeline

## Protocol

1. Read the shared fact starting with `[DISCUSS:2026-07-16-first-promo-channel]` in scope `project:unified-agent-context`.
2. Write **one** fact whose statement starts with:

```text
[RESPONSE:2026-07-16-first-promo-channel:<your-agent-name>]
POSITION: <exactly one of: X | Reddit r/LocalLLaMA | Hacker News Show HN>
REASONING: <2-4 sentences>
CONFIDENCE: <0-1>
```

3. Do **not** write `[CONCLUDE:...]` — Hermes concludes after respond-by.

## Agents invited

- claude-desktop
- gjc
- codex

## Respond-by

2026-07-17

## How to write (any one path)

```sh
cd "$UAC_REPO"  # machine-local path
node scripts/record-fact.mjs --type decision --scope project:unified-agent-context \
  "[RESPONSE:2026-07-16-first-promo-channel:AGENT] POSITION: ... REASONING: ... CONFIDENCE: ..."
```

Or via MCP `unified-memory` `context_save` on channel `project:unified-agent-context`.
