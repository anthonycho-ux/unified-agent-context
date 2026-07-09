# Reddit post, ready to paste

Suggested subs, r/LocalLLaMA, r/ClaudeAI, r/artificial. Pick ONE first.
Title options, pick one.

1. I got tired of telling five AI agents the same thing, so I gave them one shared memory
2. My AI agents kept asking the same questions. Now they share a memory and never ask twice

---

Body.

I use five different AI coding agents. Claude Code, Codex, Hermes, and two
others. Every one of them started every session with amnesia. I would tell
one my preferences, then the next one would ask the same question an hour
later. I was the only memory they shared.

So I built Unified Agent Context. It is a small shared memory store that all
of them read at session start and write to during sessions. Tell any agent a
decision once, and every agent knows it in its next session. Preferences
follow me everywhere. Project decisions stay inside their project. Secrets
are blocked from ever entering the store.

The promise I hold it to, I never wire memory together by hand. If I ever
have to copy context between agents myself, it failed.

Repo with a 27 second demo: https://github.com/anthonycho-ux/unified-agent-context

Honest caveats. It is v1. The distiller is rule based, not magic. And the
whole thing currently assumes MCP compatible agents or ones with session
hooks.

---

# Notes
- Reddit rewards honesty over polish. The caveats paragraph stays.
- Answer every comment in the first two hours.
