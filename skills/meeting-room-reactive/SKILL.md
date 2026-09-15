---
name: meeting-room-reactive
description: Join and stay reactive in the shared multi-agent meeting room (an append-only coordination file on neutral ground). Use whenever the user or another agent points you to a meeting room path, asks you to pay attention there, or when coordinating several agents across panes or hosts without a central server. Covers the room protocol, recreate recipe, per-host wake mechanisms, relay duty, and the exit-on-change lesson. Verified live 2026-08-29 (user, Claude, Sol, cmd four-way room).
---

# Meeting Room (Reactive, Multi-Agent)

## Goal

Participate in a shared meeting room as a real listener, not a silent reader: post in the correct format and get woken by new posts so the conversation actually moves. Born from a live four-way room (the user, Claude the Herdr-pane agent, Sol the Aside agent, cmd the Command Code agent) where the failure mode was agents going deaf.

## Intent

When several agents and the user share one coordination surface, the failure mode is not joining, it is going deaf: an agent reads the room once, then stops noticing new posts, and the user has to re-summon it. This skill makes the room genuinely conversational by specifying the format and, per agent host, the wake mechanism that actually fires. It does not claim sub-second push where none exists, because claiming it is how an agent ends up missing a reply and looking absent.

## Room basics

- A single plain file is the room. Neutral ground, nobody's own session. Everyone may post.
- Post format, one new line per entry: `[Name HH:MM:SS] message`, 24h clock. Append only (printf >> the file), never rewrite existing lines.
- Read the whole file to catch up before responding. Never respond to a relayed paraphrase before reading the room; the room is the source of truth and the auditable log.
- Post a presence line when joining: `[<your-name> HH:MM:SS] In the room and listening.` Then wait for the actual ask before building anything.

## Recreate recipe (if the room file is missing)

1. `mkdir -p <scratchpad-dir>` and `touch <scratchpad-dir>/meeting-room.md`.
2. Write back the header block from the last known room (path, protocol, per-agent posting mechanics) as `#` comment lines.
3. Arm the watcher (below), post a presence line, and start any input helper the room used (e.g. a `room-input.sh` for the user's viewer pane).

## Reactivity by host (honest per host)

- **Shell-host agents (Command Code / Claude in a pane / any agent with a background-shell monitor):** poll the file every ~1-2s and EXIT the watcher the moment a new line from a participant appears; the exit itself is the wake signal to the agent loop; after replying, re-arm with a fresh baseline. Filter out your own `[Name]` lines and viewer status noise (`[Room ...]` lines) so they never wake you. The trap: `tail -f` never exits, so it never wakes anyone. That is how a room goes deaf. Use `scripts/room-watch.sh <room-file> <wake-file> 1` (Mode B) or the inline pattern.
- **Aside (Sol):** no native local-file push hook (Aside event routines subscribe to browser/webpush origins, not local files). Do not claim sub-second file push. Options in order: (1) be in the active session and answer the same turn when @-mentioned — the ping is the zero-latency path; (2) arm `scripts/room-watch.sh` in Mode A (no third arg): the loop appends genuinely new lines to a wake file for free, and a session reads the wake file with zero cost when it chooses to check; (3) if minutes-scale attention is required, a heartbeat/cron wrapper around Mode A works but is polling with a floor. Respect any routine caps on the host.

## Watch every second without wasting tokens (the architecture)

The 1-second poller is a plain deterministic shell loop (free); the LLM is only ever woken by a real change. `scripts/room-watch.sh` implements two modes:

- **Mode A (background):** loop runs forever, appends only truly new lines to a wake file (default `/tmp/room-wake.txt`) plus a baseline file. No LLM in the loop; any session reads the wake file for free and pays tokens only when acting on real content.
- **Mode B (shell-host):** pass `1` as the third arg; on the first new line the loop exits 0. The exit wakes the agent loop, which replies and re-arms.

`scripts/room-mention-watch.sh` is the per-agent resilience layer: filter new lines for `@<your-name>` mentions and push into your own pane via an ALERT_CMD slot (e.g. a herdr prompt command), then exit. Primary relay plus per-agent self-wake beats either alone.

## Relay duty (primary + backup)

Designate one agent with a working watcher as the relay: when a post is addressed to an agent that has not reacted in ~30s, the relay forwards it through that agent's live channel (e.g. `herdr agent prompt <pane> "..."` for a Herdr-pane agent, `aside --session <id> "..."` for Aside) and notes the forward in the room. Per-agent mention watchers (above) are the backup so the relay is a resilience flag, not a dependency. Double answers are harmless; silence is the enemy.

## Bootstrap prompt (paste into any new agent)

```
Join the shared meeting room at <room-path> (read its header for mechanics).
1. If missing: recreate per header. 2. Post [Name HH:MM:SS] lines by appending only.
3. Arm scripts/room-watch.sh <room-path> <wake-file> 1, reply when it exits, re-arm after each reply.
4. Never tail -f: it never exits, so it never wakes anyone.
5. Relay duty: forward unanswered addressed posts via the target agent's live channel.
6. Lean thinks; acknowledge silently; speak only with substance.
```

## Honest limits and upgrade path

- File-based coordination wins below roughly dozens of agents: durable, human-readable, git-versionable, zero ops. Known weakness: push latency and fan-out; the compensation is the wake-on-change pattern above.
- At scale or cross-machine with real-time push: move to a broker, Google A2A, or an fs-events/SSE/webhook shim. Do not build that before the scale asks for it.
- A room under `/private/tmp` dies on reboot or pane teardown. If the room becomes load-bearing, move it to a durable home and update the path everywhere. Never leave real coordination only in `/private/tmp`.

## Sources

- Live four-way room (user, Claude, Sol, cmd), 2026-08-29: deaf-watcher diagnosis, exit-on-change fix, relay design, and ladder of mechanisms all observed working.
- Skill ported to UAC from Sol's Aside package (`~/.aside/u/0/skills/user/meeting-room-reactive/`, scripts by Sol/DocTpoint collaboration pattern); scripts included verbatim.
- `arxiv.org/abs/2608.23740` (AgentRoom: CRDT-backed shared workspace — the research-grade version of this pattern); `munderdiffl.in/blog/file-based-coordination-vs-message-queues` (file-based coordination trade-offs).
