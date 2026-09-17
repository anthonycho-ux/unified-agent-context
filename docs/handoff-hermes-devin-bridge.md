# Handoff — chat with Devin from Hermes gateway

Paste the block below to a coding agent working on sov (or to Devin CLI itself).

---

You are wiring **Hermes gateway** on the home server **sov** to a **local Devin CLI** agent, so
the owner can chat with Devin from Telegram/Discord/CLI through Hermes. The plugin is already
written and lives in this repo at `hermes-plugins/devin-bridge/`. Your job is to install it,
configure it, and verify it end to end. Do not rewrite it unless a step below fails.

## Why local CLI, not the cloud API

Cloud Devin sessions burn ACUs from the owner's Devin account on every relayed message. The
local `devin` CLI runs on sov under the owner's own login, so the bridge shells out to
`devin --print` instead of calling `https://api.devin.ai`. No Devin API key is needed.

## What the plugin does

- `devin_ask` tool — Hermes relays a message to `devin --print` and returns the reply.
- `/devin <message>` slash command — same path without Hermes's own LLM rewriting the prompt.
  Also `/devin new <message>`, `/devin status`, `/devin reset`.
- One Devin session is bound per Hermes chat thread (`platform:session_id`), stored in
  `$HERMES_HOME/devin-bridge/threads.json`. Follow-ups resume it with `devin --resume <id>`;
  if the session id can't be read back from `devin list --format json`, it falls back to
  `devin --continue`.

## Steps

1. **Install Devin CLI on sov and log in** (skip if `devin --version` already works):
   ```sh
   curl -fsSL https://cli.devin.ai/install.sh | bash
   devin auth login        # interactive, needs a TTY — run it in a real shell, not from the gateway
   devin auth status
   ```

2. **Create the chat workspace** — the directory Devin runs in for gateway chats. Use a real
   repo if you want Devin working on code, otherwise a scratch dir:
   ```sh
   mkdir -p ~/devin-chat
   ```

3. **Install the plugin** (symlink so repo updates land automatically):
   ```sh
   mkdir -p ~/.hermes/plugins
   ln -sfn ~/unified-agent-context/hermes-plugins/devin-bridge ~/.hermes/plugins/devin-bridge
   hermes plugins doctor          # must report devin-bridge loaded with 3 tools, 1 hook, 1 command
   ```

4. **Configure it** in `~/.hermes/config.yaml` (all keys optional; these are the defaults except
   `workspace`):
   ```yaml
   plugins:
     devin-bridge:
       workspace: /home/<user>/devin-chat   # absolute path Devin runs in
       devin_bin: devin                     # or the absolute path if PATH is minimal
       permission_mode: normal              # accept-edits if Devin should edit files unattended
       model: ""                            # e.g. opus; empty = CLI default
       timeout: 900                         # seconds per turn
   ```
   Note: the gateway service often has a minimal PATH. If `devin` is not found, set `devin_bin`
   to the absolute path (`~/.local/bin/devin` for the install-script default).

5. **Enable the toolset** for the surfaces you chat from:
   ```sh
   hermes tools enable devin_bridge --platform cli
   hermes tools enable devin_bridge --platform telegram   # repeat per platform you use
   ```

6. **Restart the gateway** and verify:
   ```sh
   hermes gateway stop && hermes gateway start && hermes gateway status
   ```

## Acceptance test (run all four)

1. CLI: `hermes chat` → `/devin what files are in this workspace?` → Devin answers with real
   directory contents, not a guess.
2. Continuity: follow up with `/devin and which of those is largest?` → the answer references
   the previous turn (proves `--resume` binding).
3. Isolation: from Telegram, `/devin status` → reports a different session id than the CLI thread.
4. Failure mode: `sudo mv $(command -v devin) /tmp/devin` (or set `devin_bin: nope`), then
   `/devin hi` → the reply is a clean `devin binary not found` error, the gateway keeps running.
   Restore afterwards.

Run the unit tests before and after any change:
```sh
python3 -m unittest discover -s hermes-plugins/devin-bridge/tests
```

## Known limits — fix these if they bite

- **Thread attribution.** Hermes tool handlers do not receive the session id, so the plugin
  records it from the `pre_llm_call` hook of the current turn. Under heavy concurrent traffic
  across platforms, two simultaneous turns could in principle bind to the wrong thread. The
  slash-command path has the same constraint. If Hermes later passes `session_id` into tool
  handler kwargs, `_thread_key()` already prefers it and the problem disappears.
- **Session id discovery.** `devin list --format json` field names are not a documented contract;
  `pick_latest_session()` accepts `session_id`/`id`/`sessionId`/`uuid` and falls back to
  `--continue`. If discovery silently stops working, that fallback keeps chats continuous but
  makes two threads in the same workspace share one Devin session — give each thread its own
  workspace if that matters.
- **Long turns.** A Devin turn can run for minutes; Telegram shows no typing indicator during
  the call. `timeout` caps it at 15 minutes by default.
- **Permissions.** `permission_mode: normal` means Devin asks before risky actions — and in
  `--print` mode there is nobody to ask, so those actions fail. Use `accept-edits` if you want
  unattended edits, and keep the workspace scoped to what Devin may touch.

## Alternative already checked

The hosted Devin MCP server (`https://mcp.devin.ai/mcp`, `mcp_servers.devin` in
`~/.hermes/config.yaml` with a `cog_` service-user key) gives Hermes cloud-session tools with
zero code. It was rejected as the default here because every message spends cloud ACUs. Add it
alongside the plugin if you want cloud handoffs for heavy work.
