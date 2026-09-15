# Claude Desktop Handoff, UAC Discussion Lane

## Goal

Design a practical UAC discussion lane so the user can ask Hermes to discuss a topic with other agents, especially Claude Desktop, without manually copying context between Telegram, Discord, Desktop, Hermes, GJC, Codex, and Claude.

## Current observed state

Hermes verified UAC at the repository checkout (path is machine-local).

- `record-fact.mjs` works.
- `inject-context.mjs` works.
- Project fact recorded successfully.
- Current project scope is `project:unified-agent-context`.
- Doctor currently reports several wiring failures, including Claude MCP, GJC shared context rule, GJC MCP, Codex MCP, and Hermes MCP.
- Hermes pre LLM hook is OK.

The recorded project fact says.

`The user wants Telegram, Discord, Desktop, Hermes, GJC, Codex, and other agents to use UAC as the shared context layer for cross-agent discussion rather than isolated session search.`

## Design constraint

Do not build a live group chat first. Treat UAC as a shared meeting record.

The desired flow is.

1. Hermes writes a discussion brief into UAC.
2. Claude Desktop, GJC, Codex, and other agents read the same brief.
3. Each agent writes a short structured response back to UAC.
4. Hermes reads all responses and gives the user one recommended conclusion.

## What Claude Desktop should decide

Please review the UAC repo and propose the smallest working lane for Claude Desktop participation.

Answer these questions.

1. What exact format should a discussion brief use.
2. How should Claude Desktop discover briefs.
3. How should Claude Desktop write its response.
4. Should this be implemented as explicit UAC facts, markdown files under docs or data, or MCP records.
5. What is the minimal verification test proving Claude Desktop can read a brief and write back a response.

## Quality gate

The result must be understandable as a simple operating model, not only as config.

Use this acceptance test.

`The user gives one topic to Hermes. Claude Desktop sees the same topic through UAC. Claude Desktop writes a response. Hermes sees Claude Desktop's response through UAC. The user gets one synthesis.`

## Safety

Do not store secrets, API keys, tokens, auth codes, or private raw transcripts in UAC.
Do not change global Claude Desktop settings unless the user approves.
Prefer a reversible prototype.
