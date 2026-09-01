---
name: herdr-agents
description: Converse with coding agents (Claude Code, Codex, Grok, ...) that live in Herdr panes from another Herdr-managed pane - resolve the agent behind a pane, submit a prompt, wait for the reply, read the response, and relay it to the user. Use when the user says "ask claude", "check with the other agent", "have codex look at this", or wants a reply from an agent occupying another Herdr pane. Requires HERDR_ENV=1 and the herdr CLI in PATH. Not for launching or arranging panes the user did not tie to a conversation.
---

# Herdr agent conversations

Talk to the agent occupying another Herdr pane: find it, prompt it, wait, read the reply, relay
it. Verified against herdr 0.8.2 (2026-08-30); traps marked *observed live* actually happened.

## Preconditions

1. `test "${HERDR_ENV:-}" = 1` - if this fails, this agent is not inside Herdr; say so and stop.
2. Run `herdr --skill` once for the authoritative CLI manual. This skill covers the
   conversation loop and its traps; the manual covers full command syntax. Do not run bare
   `herdr` (it opens the TUI).

## Find the target

```bash
herdr agent list                                   # live agents, their panes, states
herdr pane list --workspace "$HERDR_WORKSPACE_ID"  # all panes, including agentless ones
```

- In `agent list` output the `agent` field is the agent **kind** (claude, codex, grok), NOT its
  registered name. Prompting a kind name fails with `agent_not_found` (*observed live*).
- The pane ID (`w3:p1R`) is the universal target - every agent command accepts it. Prefer it.
- An agent may be `idle`, `working`, `blocked`, `done`, or `unknown`. Only prompt `idle`/`done`
  agents. `unknown` means present but unclassified; do not assume it is finished.

## Conversation loop

```bash
# 1. Send and wait. --wait settles on the first idle/done/blocked; do not add --until.
herdr agent prompt w3:p1R "Check whether you can still see us. Report concisely." \
  --wait --timeout 180000

# 2. Read the reply (only works while the agent is idle - see traps).
herdr agent read w3:p1R --source recent-unwrapped --lines 80

# 3. Relay the key findings to the user; attribute the pane.
```

- Size `--timeout` above the expected turn length. Startup turns default to 30s; routine
  prompts to 120-180s; investigation-heavy tasks to 570s+.
- A prompt sent from a non-working state must change lifecycle state within 5 seconds or herdr
  returns `agent_prompt_stalled`. Re-check `agent get` before retrying.
- `--wait` tracks the turn lifecycle, not a guaranteed answer: an already-working agent may
  satisfy it by finishing its current turn. Confirm your answer arrived by reading the reply.

## Traps (observed live 2026-08-30, herdr 0.8.2)

- **Unsubmitted input text.** If the target's input box already holds typed-but-unsubmitted
  text, `agent prompt` APPENDS below it and the encoded Enter submits BOTH as one combined
  prompt. Check first: `herdr pane read <pane> --source visible --lines 10`. This is a feature
  if handled deliberately - lead your message with a newline and a marker ("Next task: ...") so
  the queued text and your addition read as one coherent prompt. Never clobber it with
  ctrl+u-style clears; the pending text is the user's typing.
- **send-keys Enter does not submit TUI inputs.** `pane send-keys <pane> enter`, `return`, and
  `ctrl+m` inject the key but Claude Code's input box does not submit. Only `agent prompt`'s
  encoded Enter (bracketed-paste aware) reliably submits. Do not burn turns trying alternatives.
- **Reads fail while working.** `agent read --source recent-unwrapped` errors with
  `agent_not_idle` while the agent is mid-turn; alternate-screen history only exists when idle.
  Peek with `--source visible`, or `herdr agent wait <pane> --timeout N` and read after.
- **Stale waits.** `agent wait` returns immediately when the agent is already idle - even if the
  prompt has not started a turn. Compare `state_change_seq` between the prompt result and a
  follow-up `agent get`, or read the pane, to confirm the turn actually began.
- **Alternate screen swallows output.** If raising `--lines` stops revealing more of a finished
  answer, the agent ran on the alternate screen and the rows are gone. Fallback: prompt the
  agent to write its full answer as Markdown to a file under `/tmp` and read that file.

## Blocked dialogs

`--wait` returning `blocked`, or a visible approval/question UI, means the agent is waiting on
its user. Read the dialog with `--source visible`, present the options to the user verbatim, and
stop. NEVER answer it yourself - no number keys, no Enter, no send-keys - unless the user
explicitly picks an answer.

## Safety rails for delegated tasks

- Delegation amplifies the target agent's reach. When asking it to do something risky (cleanup,
  deletion, config changes), embed the rails in the prompt text itself: inventory first,
  categorize findings, present the plan in its pane, and STOP for explicit user approval before
  any mutating command.
- Stay read-only toward panes you did not create. Never close workspaces, tabs, or panes; never
  run `herdr server stop`; never kill the main Herdr process.
- Keep the user's focus: use `--no-focus` for anything background.
