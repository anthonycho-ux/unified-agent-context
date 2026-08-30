# Basecamp 5 operations: fleet account, CLI, and agent integration

<!-- Author: Sol, 2026-08-30. Sources: live browser verification of account <basecamp-account-id>, basecamp.com/agents, github.com/basecamp/basecamp-cli (v0.9.1), basecamp.com/pricing. -->

TL;DR: Basecamp 5 (2026) is agent-ready: official CLI, SDK, MCP server, and agent skills. Fleet account <basecamp-account-id> (Hermes Basecamp, <account-email>, Free plan, 3-project cap). CLI is installed on store-host but NOT yet authenticated as of 2026-08-30; auth requires the user's manual Launchpad login (account password is not stored anywhere agent-accessible; Google is not linked to this account).

## Verified account facts (2026-08-30, live from the Aside browser)

- Account ID: **<basecamp-account-id>** (in URL path app.basecamp.com/<basecamp-account-id>/)
- Slug: **Hermes Basecamp**; profile name: **Hermes**; login email: **<account-email>**
- Plan: **Basecamp Free** — max 3 projects, 1 GB storage, cannot archive projects (only permanently delete, no undo; delete frees a project slot)
- Browser session works from the Aside browser; launchpad.37signals.com session is separate and may require re-login even when app.basecamp.com still works
- Project slots (after 2026-08-30 cleanup): our집 (id 48692046, created by Sol with description), and two planned slots: 리서치-라이팅, 구직. The two original test projects (My Project, Making a Podcast sample) were permanently deleted.

## CLI (official, installed on store-host)

- Binary: `/home/user/bin/basecamp`, version **0.9.1** (install one-liner: `curl -fsSL https://basecamp.com/install-cli | bash`; brew: `brew install --cask basecamp/tap/basecamp-cli`)
- Agent-facing: JSON output with breadcrumbs, `--help --agent` structured discovery on every command, `basecamp commands --json` full catalog
- MCP server: `basecamp mcp` runs on stdin/stdout — 15 domain tools (projects, todos, cards, messages, campfires, boosts, schedules, files, people, automation, reports, everything, clientside, forwards, account)
- Profiles: `basecamp profile set-default <name>` or `BASECAMP_PROFILE=<name>`
- Health: `basecamp doctor [--json]`
- Agent plugins: `basecamp setup claude` / `basecamp setup codex`; skills at github.com/basecamp/basecamp-cli/tree/main/skills/basecamp

## Auth state and quirks (all verified live 2026-08-26 / 2026-08-30)

- `basecamp auth status` on store-host: **authenticated: false** as of 2026-08-30 ~01:00 MDT. Shell-out auth still required before any CLI Basecamp operation.
- **Google sign-in requires an already-linked account.** "Sign in with Google" on launchpad.37signals.com returns "Looks like you haven't linked up that Google account yet" for first-time registration. The <account-email> account is NOT Google-linked; only the user's explicit signup password logs in.
- **Signup has no email verification gate.** app.basecamp.com/signup/account/new?plan=free_v3 provisions the account immediately (explicit password required at signup; Google OAuth creation is not offered).
- **CLI auth flow (headless):** `basecamp auth login --device-code --no-browser` prints a launchpad authorization URL, then waits for you to paste a callback URL (redirect_uri http://127.0.0.1:8976/callback). After approving in a browser, the browser redirects to 127.0.0.1:8976/callback?code=... and shows a connection error — that is expected; copy the full URL from the address bar and paste it into the CLI prompt. On store-host, run the login inside tmux (`tmux new-session -d -s bc "basecamp auth login --device-code --no-browser --remote"`), then `tmux send-keys -t bc '<callback-url>' Enter`.
- **The account password is not stored anywhere agent-accessible** (checked: Aside vault, store-host ~/.hermes/.env, ~/.config/basecamp on Mac and store-host — the config dir holds only .last-run-version and .update-check). Only the user knows it. A future agent hitting this wall should ask the user to complete the Launchpad login in the browser (or the explicit password), then continue the flow autonomously.

## Command cheat sheet

```
basecamp auth status
basecamp auth login            # OAuth; --device-code --no-browser for headless
basecamp auth token            # print token (do not commit)
basecamp projects --json
basecamp search "<query>" --json
basecamp <command> --help --agent   # structured flag/gotcha discovery
basecamp commands --json            # full catalog
basecamp mcp                        # MCP server (stdio)
basecamp doctor                     # health checks
```

BC5 per-project tools (added one by one): Message Board, To-dos, Docs & Files, Calendar, Chat, Card Table, Automatic Check-ins, Email Forwards (project inbox capture), External link. Browser "Add a tool" buttons are plain form submits (POST) — slow to drive via automation; CLI is the intended path.

## Agent integration notes

- Agents get full Basecamp access: write documents, add/complete to-dos, answer check-ins, etc. (basecamp.com/agents)
- Read-only scope available: `basecamp auth login --scope read` (BC3 OAuth read scope; Launchpad ignores scope and always grants full)
- OAuth uses PKCE + local loopback callback with automatic token refresh; custom OAuth apps supported via BASECAMP_OAUTH_CLIENT_ID / SECRET / REDIRECT_URI (loopback with explicit port)
- Repos: github.com/basecamp/basecamp-cli, github.com/basecamp/basecamp-sdk, github.com/basecamp/bc-api (new 2026 API)

## Timeline for fleet recall

- 2026-08-26: account created via Hermes-initiated flow (launchpad OAuth, 127.0.0.1:8976 callback); CLI installed on store-host (version file updated 17:05)
- 2026-08-30 ~00:33: Sol verified dashboard from the Aside browser (projects: My Project, Making a Podcast sample)
- 2026-08-30 ~00:50–01:00: Basecamp operationalization plan (20 ideas) delivered; test projects deleted; 우리집 project created (48692046); CLI auth pending (blocked on account password / the user's manual login)

## Hermes setup notes (2026-08-26)
- Aug 26: Hermes-initiated Basecamp account <basecamp-account-id> setup via launchpad OAuth flow (127.0.0.1:8976 callback)
- Aug 26: Basecamp CLI version 0.9.1 installed on store-host (`~/.config/basecamp/` directory created)
- Aug 26: Initial project "Hermes Productivity" created for automation workflows
- Aug 26: Tools added (Message Board, To-dos, Docs & Files, Calendar, Chat, Card Table, Check-ins, Email Forwards, External links)
- Aug 26: OAuth setup complete via browser (password not stored, only the user knows)
- Aug 26: Browser session works via Aside; Launchpad session separate and requires re-login
- Aug 30: CLI auth status = unverified (requires manual password/login)
- Aug 30: Two project slots: 우리집 (48692046) and planned slots: 리서치-라이팅, 구직
