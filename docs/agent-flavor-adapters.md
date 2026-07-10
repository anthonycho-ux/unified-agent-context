# Agent Flavor Adapters

UAC standardizes facts without standardizing voice.

## Split

| Layer | Lives where | Sync? | Contents |
| --- | --- | --- | --- |
| Shared facts | UAC store | Yes | Agent-neutral preferences, decisions, and project state |
| Local voice | Agent-local files and system prompts | No | Tone, persona, tool idioms, UI habits |
| Render adapter | `scripts/inject-context.mjs --agent <id>` | Yes | Formats the same facts for an agent's prompt dialect |

Conflict rule: **facts shared store wins; style local wins.**

## Supported Agents

`scripts/inject-context.mjs --agent <id>` accepts:

- `generic`
- `claude-code`
- `codex`
- `hermes`
- `aside`
- `gajaecode`
- `lettacode`

Omitting `--agent` is equivalent to `--agent generic` and preserves the legacy shared-context
block.

## Fact Shape

Facts remain neutral declarative claims:

- Good: `the user wants action-first replies.`
- Good: `This project keeps commits scoped to related files.`
- Bad: `You must always answer like Claude Code.`
- Bad: `Overwrite Aside's SOUL.md with this style.`

The optional `tags` field can narrow injection relevance without changing the fact itself.
Legacy facts without tags are treated as broadly relevant and remain visible to every adapter.

Recommended tags:

| Tag | Meaning |
| --- | --- |
| `coding` | coding agents, implementation, debugging |
| `git` | commit, branch, review, or history conventions |
| `browser` | browser/site/session quirks, Aside-oriented behavior |
| `status` | status summaries, kanban, handoffs |
| `infra` | environment, remote store, SSH, server setup |
| `docs` | documentation conventions |
| `workflow` | general process preferences |

## Relevance Rules

- `generic` renders all scoped facts.
- Coding adapters (`claude-code`, `codex`, `gajaecode`, `lettacode`) include untagged facts
  and facts tagged for coding work such as `coding`, `git`, `repo`, `terminal`, `test`,
  `docs`, or `infra`.
- `aside` includes untagged facts and browser/web/UI/workflow/status facts.
- `hermes` includes untagged facts and kanban/status/workflow/handoff/infra facts.

Shared tags (`all`, `shared`, `global`, `preference`, `decision`, `project`) are relevant to
every adapter.

## Out Of Scope

Adapters must not sync, edit, or overwrite persona files such as `CLAUDE.md`, Aside `SOUL.md`,
Hermes persona prompts, or other agent-local style files. They also do not weaken the
fail-closed secret gate.
