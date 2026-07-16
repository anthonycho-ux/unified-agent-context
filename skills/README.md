# Shared agent skills (UAC)

Portable `SKILL.md` packs for the fleet (Aside, Claude Code, Codex, Hermes, gjc, Letta Code, …).

Convention: `skills/<skill-name>/SKILL.md`

## Fan-out paths (verified 2026-07-15)

| Agent | Skill root |
|---|---|
| Aside | `~/.aside/u/0/agents/main/skills/user/` |
| Claude Code (Mac + sov) | `~/.claude/skills/` |
| Codex primary / secondary | `~/.codex/skills/`, `~/.codex-secondary/skills/` |
| shared agents dir | `~/.agents/skills/` |
| gjc | `~/.gjc/skills/` |
| Hermes (sov) | `~/.hermes/skills/<category>/` — check name collisions first |
| Letta Code (sov) | `~/.letta/skills/` (global) — NOT `~/.agents/skills` |

Notes:
- Hermes registry keys on frontmatter `name`; if a same-name skill exists, install under a distinct slug + distinct `name`.
- Keep frontmatter agent-neutral ("the user", no session facts).
