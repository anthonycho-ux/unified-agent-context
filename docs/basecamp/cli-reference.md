# Basecamp 5 CLI verified reference

## Live corrections (2026-08-30, Sol, account <basecamp-account-id>): read this first if you hit these

- **checkins question create returns 422 validation on this account for EVERY documented payload**: default (title only), and explicit every_day days 1,2,3,4,5 time 5:00pm, and every_week days 5 time 4:30pm, and raw API posts all failed with envelope code validation. This contradicts the VERIFIED source-read claim below that 422 means an invalid schedule. The web UI create succeeds (question persists, asks weekly at 4:30pm). Working path: create check-in questions in the web UI, not via CLI, until upstream behavior is explained (candidate causes: BC5 API payload drift on the questionnaire endpoint, or a per-account flag; not investigated further 2026-08-30).
- **Project email-forwarding address is web-UI-only**: the personal capture address for a project is on the Email Forwards tool page, format <prefix>@app.basecamp.com (example seen: <dropbox-id>@app.basecamp.com). The API/SDK/CLI do not expose it (confirmed against forwards.go and the Inbox struct; the generic save@app.basecamp.com instruction is on the same page).
- **Basecamp Free = 1 project, confirmed live**: projects create while 1 project exists returns The project limit for this account has been reached (code limit_exceeded, HTTP 507, exit 10). The fix is permanently deleting a project (`basecamp projects delete <id>`) or upgrading. Do not plan a 2-project Free account.

Operational reference for the official Basecamp CLI (`basecamp`, 37signals), so an agent can drive Basecamp without guessing. Compiled 2026-08-30 against release v0.9.1. Every claim is marked VERIFIED with the source URL it was read from, or UNVERIFIED with the reason. This document supersedes all older Basecamp CLI notes in this repo where they conflict.

Provenance: https://github.com/basecamp/basecamp-cli is the official repo (organization basecamp, Go, MIT license, language Go, homepage https://basecamp.com/cli). Repository metadata read from the GitHub API: created 2026-01-09, last push 2026-08-29, 258 stars, default branch main. VERIFIED (https://api.github.com/repos/basecamp/basecamp-cli)

Latest release: v0.9.1, published 2026-08-12, prerelease false. VERIFIED (https://api.github.com/repos/basecamp/basecamp-cli/releases/latest)

## Install

One-liner for macOS / Linux / WSL2 / Git Bash:

```
curl -fsSL https://basecamp.com/install-cli | bash
```

VERIFIED (https://github.com/basecamp/basecamp-cli and https://github.com/basecamp/basecamp-cli/blob/main/install.md). Windows PowerShell uses `irm https://raw.githubusercontent.com/basecamp/basecamp-cli/main/scripts/install.ps1 | iex`. Alt installs: brew cask `basecamp/tap/basecamp-cli`, AUR `basecamp-cli`, deb/rpm/apk from the releases page, scoop, nix, go install, raw script at `scripts/install.sh`. The install script auto-detects non-interactive environments and skips the wizard, but still runs `basecamp setup agents` (best effort, one detected coding agent). Set `BASECAMP_SETUP_AGENT` to claude, codex, all, or none for the interpreter (not the fetch). VERIFIED (install.md)

Upgrade: `basecamp upgrade`. In-place for installer/tarball installs (Sigstore-verified download, transactional swap, version confirmation); delegates to brew/scoop for those; never touches system packages or go install (`upgrade_required` hint instead). Exit 0 only when no update or update applied and confirmed. VERIFIED (README)

Verify install:

```
basecamp --version
Expected: basecamp version X.Y.Z
basecamp auth status
Expected: Authenticated, or Authenticated (scope: read)
```

VERIFIED (install.md). If `basecamp: command not found`, add `$HOME/.local/bin` (or `$HOME/bin` for Git Bash, `$HOME/go/bin` for go install) to PATH. Same source.

Linux-specific trap: on Termux/Android the prebuilt binary and `go install` crash immediately with `SIGSYS: bad system call` (a transitive dependency probes clipboard tools in a package initializer and Android seccomp kills `faccessat2`); build from source with the Termux Go toolchain instead (requires Go 1.26.7+). VERIFIED (install.md). On Windows 11, Smart App Control blocks the unsigned `basecamp.exe` for releases up to v0.8.0-rc.1; use WSL2. VERIFIED (README, install.md)

## Authentication

### Login flow

`basecamp auth login` runs OAuth. The server advertises its issuer: a Basecamp 5 issuer runs the RFC 8628 device flow automatically (approve a code in a browser); the Launchpad fallback runs the authorization-code flow with a loopback callback. Once a modern issuer is selected, failures surface loudly rather than silently falling back. VERIFIED (README, https://raw.githubusercontent.com/basecamp/basecamp-cli/main/internal/auth/auth.go)

Flags (VERIFIED, auth.go and https://raw.githubusercontent.com/basecamp/basecamp-cli/main/internal/commands/auth.go):

| Flag | Meaning |
| --- | --- |
| `--scope read` | Read-only access. Only honored on BC3-style OAuth; ignored by Launchpad (its tokens are always read-write) |
| `--scope full` | Full read+write, default. Also ignored by Launchpad |
| `--device-code` | Headless RFC 8628 device flow with manual browser instructions. Implies `--remote` |
| `--no-browser` | Do not auto-open the browser, just print the URL |
| `--remote` | Force remote/headless mode: paste the callback URL instead of a local listener. Auto-detected when SSH env vars are present (unless `--local`). Implies `--no-browser` |
| `--local` | Force local mode, overriding SSH auto-detection. Mutually exclusive with `--remote` and with `--device-code` |

`basecamp auth login --device-code` is the dependable headless path for an SSH host: the CLI prints a URL and a code, you approve it in any browser, the CLI polls and stores the token. Top-level `basecamp login` is aliased to the same command. VERIFIED (auth.go, commands/auth.go)

### Remote callback paste flow

Local mode starts a loopback listener at `http://127.0.0.1:8976/callback` (constants `defaultCallbackAddr = 127.0.0.1:8976` and `defaultRedirectURI = http://127.0.0.1:8976/callback`). VERIFIED (auth.go)

Remote mode prints these instructions: open the auth URL in any browser, sign in, the browser then redirects to a URL starting with the redirect URI plus `?code=...&state=...`; that page shows a connection error which is expected (no listener exists on a remote host); copy the full URL from the address bar and paste it; the CLI extracts the code, validates the state parameter, and exchanges it. Timeout is 5 minutes. VERIFIED (auth.go)

Custom redirect URI precedence: `--redirect-uri` (internal option) > env `BASECAMP_OAUTH_REDIRECT_URI` > callback address > hardcoded default. Rules: the URI must be absolute http, host must be loopback (localhost, 127.0.0.1, [::1]), a port is required, no userinfo, no query, no fragment. VERIFIED (auth.go)

### Profiles and custom OAuth credentials

Named profiles bundle identity with environment:

```
basecamp profile create design-agent
basecamp profile set-default design-agent
basecamp profile list
basecamp profile show [name]
basecamp profile delete <name>
basecamp --profile design-agent todos list --in 12345
```

Profile names allow letters, numbers, hyphens, underscores, first char alphanumeric. Each profile stores its own OAuth credentials under key `profile:<name>`. `profile create` runs a login flow and becomes default only when it is the first profile. Actions post as the authenticated user of the selected profile. Selection order: `--profile` flag > `BASECAMP_PROFILE` env > `default_profile` config. VERIFIED (https://raw.githubusercontent.com/basecamp/basecamp-cli/main/internal/commands/profile.go, README)

Custom OAuth app credentials (e.g. a custom Launchpad integration):

| Variable | Purpose |
| --- | --- |
| `BASECAMP_OAUTH_CLIENT_ID` | OAuth client ID |
| `BASECAMP_OAUTH_CLIENT_SECRET` | OAuth client secret |
| `BASECAMP_OAUTH_REDIRECT_URI` | Redirect URI, must be `http://` loopback with explicit port |

Both ID and secret must be set together. VERIFIED (README, auth.go). `BASECAMP_TOKEN=...` env var bypasses OAuth entirely: every request uses it directly, no refresh; `basecamp auth token --stored` forces the stored OAuth token path. VERIFIED (auth.go, commands/auth.go)

### Credentials storage, never read it

`~/.config/basecamp/credentials.json` holds OAuth tokens (fallback when the OS keyring is unavailable). It must NEVER be read, logged, or echoed. Agents: never cat or grep this file; leak detection matters. Verify auth only through `basecamp auth status` (returns authenticated, source, oauth_type, scope when not Launchpad, expires_in, user_id). VERIFIED (README, SKILL.md config section, commands/auth.go). A leftover `~/.config/basecamp/client.json` from a removed development flow is obsolete and safe to delete. VERIFIED (README)

### Default account

`basecamp accounts list`, `basecamp accounts use <id>` (set default account), `basecamp accounts show` (details, limits, subscription). Global config `~/.config/basecamp/config.json` holds `account_id` among others; set it with `basecamp config set account_id <id> --global`. VERIFIED (__persistent flags__: SKILL.md accounts section, config.go)

## Configuration precedence

Precedence, highest first: flags > env > local > repo > global > system > defaults. VERIFIED (https://raw.githubusercontent.com/basecamp/basecamp-cli/main/internal/config/config.go)

Config files:

| Layer | Path |
| --- | --- |
| System | `/etc/basecamp/config.json` |
| Global | `~/.config/basecamp/config.json` (XDG_CONFIG_HOME aware) |
| Repo | `<git-root>/.basecamp/config.json` (committed to git; discovery bounded by $HOME) |
| Local | `.basecamp/config.json` walking down from CWD within the trust boundary |

Env vars read by config: `BASECAMP_BASE_URL`, `BASECAMP_ACCOUNT_ID`, `BASECAMP_PROJECT_ID`, `BASECAMP_TODOLIST_ID`, `BASECAMP_CACHE_DIR`, `BASECAMP_CACHE_ENABLED`, `BASECAMP_HINTS`, `BASECAMP_STATS`, `BASECAMP_LLM_*`, plus `BASECAMP_TOKEN`, `BASECAMP_PROFILE`, `BASECAMP_NONINTERACTIVE`, `BASECAMP_SETUP_AGENT`, `BASECAMP_SKIP_SETUP`. VERIFIED (config.go)

Trust gating: authority keys `base_url`, `default_profile`, `profiles` and the cache/LLM keys are IGNORED when read from an untrusted local or repo config, so a cloned repo cannot redirect OAuth tokens or substitute a costly model. Explicitly trust with `basecamp config trust [path]`, list with `--list`, revoke with `config untrust`. A `config set` of a trust-gated key into local config prints a warning pointing at `config trust`. `llm_api_key` is only ever read from global/system config or env, never local/repo. VERIFIED (config.go, https://raw.githubusercontent.com/basecamp/basecamp-cli/main/internal/commands/config.go)

Config management: `basecamp config show` (effective values plus source per key), `config init`, `config set <key> <value>` (default writes local; `--global` for global), `config unset <key>`, `config project --project <id|name>` (sets project_id non-interactively). Valid keys include account_id, project_id (alias project), todolist_id, base_url, scope, default_profile, format, plus the llm_* and experimental.* set. VERIFIED (commands/config.go)

Per-repo default project: a `.basecamp/config.json` file holding a JSON object with a project_id and a todolist_id (exact shape in the skill config section, https://github.com/basecamp/basecamp-cli/blob/main/skills/basecamp/SKILL.md). Most commands take `--in <project>` (flag) or fall back to the configured project. Create a project and remember its ID with `basecamp config set project_id <id>`. VERIFIED (SKILL.md, projects.go agent_notes)

## Output conventions

Every command supports these modes. VERIFIED (README, SKILL.md Output Modes and JSON Envelope sections)

| Flag | Behavior |
| --- | --- |
| `--json` | JSON envelope: `{ok, data, summary, breadcrumbs, meta}`; errors: `{ok:false, error, code, retryable, hint, meta}` |
| `--jq <expr>` | Built-in gojq filter, no external jq binary. Implies `--json`; runs on the envelope (data-only when combined with `--agent`). Never pipe to external jq |
| `--md` / `-m` | GFM tables, task lists, structured Markdown for humans |
| `--agent` | Raw JSON data with no envelope; errors `{ok:false,...}`; no interactive prompts |
| `--quiet` | Raw JSON data only; errors `{ok:false,...}` |
| `--ids-only` | IDs only |
| `--count` | Count only |
| `--help --agent` | Structured JSON discovery: flags, gotchas, subcommands for any command |
| `basecamp commands --json` | Full command catalog |
| `-v` / `-vv` | Verbose / trace |
| `--stats` | Session statistics |

Envelope key order is not part of the contract: the TTY path re-encodes through a map and alphabetizes keys, so match on key names, never position. `retryable` appears on every error envelope (true for transient: network, timeout, rate limit, circuit open, most 5xx; false for verdicts such as usage, not_found, auth, forbidden, validation, account limit, plus anything unclassified) and never on success. Key on `retryable` rather than code when deciding whether to retry. VERIFIED (README)

Prompt suppression: `--agent`, `--json`, `--quiet`, `--ids-only`, `--count` and env `BASECAMP_NONINTERACTIVE=1` suppress interactive pickers. `--md` does NOT suppress them: ambiguous targets (e.g. a project with multiple todosets and no `--todoset`) show a blocking picker on a TTY. Pass the disambiguating flag or set `BASECAMP_NONINTERACTIVE=1` (disables prompts, converts them to actionable errors, keeps the output format). VERIFIED (SKILL.md)

Breadcrumbs: success envelopes carry next-step commands, e.g. `.breadcrumbs[0].cmd`, so an agent can navigate. VERIFIED (SKILL.md, README)

Pagination: `--limit N` caps, `--all` fetches everything, `--page N` fetches exactly one page (some endpoints accept only page 1; `--all` walks pages). `--all` and `--limit` are mutually exclusive; `--page` cannot combine with either. Account-wide listings default to the first 100 items. VERIFIED (SKILL.md)

## Command reference

Project scope is mandatory for most commands: `--in <project>` or a configured project. Account-wide exceptions: `reports assigned`, `reports overdue`, `reports schedule`, `assignments`, `recordings <type>`, `notifications`, `gauges list`, plus seven list commands with `--all-projects` (todos, cards, messages, comments, files, forwards, checkins answers). Always pass `--all-projects` when you mean every project: a configured default project counts as in scope and silently degrades `--assignee` to a single-project client-side filter. VERIFIED (SKILL.md)

Required arguments are positional, never flags: `basecamp todos create content`, `basecamp cards create title`, `basecamp messages create title body`, `basecamp chat post text`, `basecamp comments create <id> text`, `basecamp webhooks create <url>`, `basecamp checkins answer create <id> text`. A missing positional returns code usage with the error naming the missing argument. VERIFIED (SKILL.md)

Content and stdin: `-` means read content from stdin on every content input (comments, messages create body, cards create body, todos create, docs create content, chat post, boost create, checkins answer, notes set) and on `--data`, `--body`, `--content`, `--description`, `--comment`, `--file` flags. A pipe is never consumed implicitly. A literal `-` elsewhere errors when stdin is piped (escape positionals after `--`). Trailing newlines are trimmed. VERIFIED (SKILL.md stdin section)

### Projects

```
basecamp projects list [--status active|archived|trashed] [--limit N] [--all] [--page 1] [--sort title|created|updated] [--reverse]
basecamp projects show <id> [--all]
basecamp projects create <name> [--description <text>]
basecamp projects update <id> [--name <name>] [--description <text>]
basecamp projects delete <id>        # alias trash; recoverable
```

`projects show` returns the project dock (enabled tools by default; `--all` includes disabled). Tool IDs for `basecamp tools` come from this dock array. There is no dedicated archive command: `basecamp api put projects/<id>/status/archived -d {}` archives, `.../status/active` unarchives, `.../status/trashed` trashes. VERIFIED (SKILL.md, https://raw.githubusercontent.com/basecamp/basecamp-cli/main/internal/commands/projects.go)

Creating a project returns its ID; use it with `basecamp config set project_id <id>`. VERIFIED (projects.go agent_notes)

### tools (dock tools, BC5 only)

`projects show <id>` lists dock tools with their IDs. VERIFIED (tools.go)

```
basecamp tools show <id> [--in <project>]
basecamp tools create [title] --type <type> [--in <project>] [--visible-to-clients]
basecamp tools update <id> <title>          # alias rename; same as update <id> <title>
basecamp tools rename <id> <title>
basecamp tools trash <id>                   # alias delete; permanently removes the tool and all its content
basecamp tools enable <id>
basecamp tools disable <id>                 # hides from dock, preserves content
basecamp tools reposition <id> --position N # alias move; 1-based
```

Create-by-type is Basecamp 5 only. `--type` is required and accepts a closed set (friendly names, canonical Rails classes, and aliases, all case/separator insensitive):

| Friendly | Canonical | Aliases |
| --- | --- | --- |
| chat | Chat::Transcript | campfire |
| inbox | Inbox | forwards, email |
| kanban_board | Kanban::Board | kanban, cardtable, cards, card |
| message_board | Message::Board | messageboard, messages, message |
| questionnaire | Questionnaire | questions, checkin, checkins, automaticcheckins |
| schedule | Schedule | calendar |
| todoset | Todoset | todosets, todos, todo, todolist |
| vault | Vault | docs, doc, documents, files |

`--visible-to-clients` is honored only for chat and kanban_board; other types inherit the project default. Tool title max 64 characters. `board` alone is rejected as ambiguous (message_board vs kanban_board). Disabling hides without deleting. VERIFIED (https://raw.githubusercontent.com/basecamp/basecamp-cli/main/internal/commands/tools.go)

### messages

```
basecamp messages list [--all-projects] [--in <project>]
basecamp messages show <id> [--in <project>]
basecamp messages create <title> <body> [--in <project>]
basecamp messages create <title> <body> --draft              # create as draft
basecamp messages create <title> <body> --no-subscribe       # silent, no notifications
basecamp messages publish <id>
basecamp messages update <id> [--title <t>] [--body <b>]
basecamp messages pin <id> / messages unpin <id>
```

Flags: `--draft`, `--no-subscribe`, `--subscribe <names>` (comma separated names/emails/IDs or me; mutually exclusive with `--no-subscribe`), `--message-board <id>` (only when the project has multiple message boards), `--visible-to-clients`. Body accepts Markdown and @mentions; the CLI converts to HTML. `messages list` returns only active; archived/trashed via `basecamp recordings messages --status archived|trashed`. VERIFIED (SKILL.md)

Client visibility rule that bites: team-authenticated callers create team-only by default; client-authenticated callers ALWAYS create client-visible records (an explicit `--visible-to-clients=false` is overridden server-side). VERIFIED (SKILL.md)

### chat

```
basecamp chat [--in <project>]                  # list chats (campfires)
basecamp chat messages [--in <project>]
basecamp chat post <text> [--in <project>]
basecamp chat line <line_id> [--in <project>]
basecamp chat update <line_id> <text> [--in <project>]
basecamp chat delete <line_id> --force [--in <project>]   # permanent, not trashable
```

Pings (direct messages) are not `chat` and not in `recordings`: discover threads via `notifications` and read/post lines through `basecamp api get/post /buckets/<circle_id>/chats/<chat_id>/lines.json`. VERIFIED (SKILL.md)

### todolists and todos

```
basecamp todolists list / show <id> / create <name> [--description <text>] [--visible-to-clients] / update <id>
basecamp todos list [--in <project>] [--list <id|name|url>] [--assignee <name>] [--status completed|incomplete|archived|trashed] [--overdue] [--all-projects] [--due with|without|overdue]
basecamp todos create <content> [--in <project>] [--list <id>] [--loose] [--assignee me] [--due tomorrow] [--notify-on-completion <names>]
basecamp todos complete <id> [id...]
basecamp todos uncomplete <id>
basecamp todos update <id> [--title] [--description] [--due] [--assignee] [--notify-on-completion] [--no-notify-on-completion]
basecamp todos position <id> --to 1 [--list <id|name|url>]
basecamp todos sweep --overdue --complete [--comment <text>] [--dry-run] [--in <project>]
basecamp assign <id> [id...] --to <person> [--in <project>]     # also --card / --step variants
basecamp unassign <id> [id...] --from <person> [--in <project>]
```

Smart defaults: `--assignee me` resolves to the current user; `--due tomorrow`, `--due +3`, `--due next week` parse naturally when setting a due date. On listings `--due` is a different flag: only `with`, `without`, `overdue`, only account-wide, so `todos list --due tomorrow` is rejected. `--overdue` and `--no-due-date` are their own listings. `--assignee` is server-side account-wide, client-side within a project. `--assignee` with `--unassigned` is refused. VERIFIED (SKILL.md)

Todo subtasks: stored as `Kanban::Step`; create via `basecamp api post /buckets/<project_id>/card_tables/cards/<parent_todo_id>/steps.json` with a JSON title body; update via raw `PUT .../card_tables/steps/<id>.json` which is partial, meaning send only changed fields (assignee_ids replaces the whole list; setting due_on to null clears the due date). VERIFIED (SKILL.md)

### docs, documents, files

`files` is a unified Docs & Files group with aliases: `basecamp files`, `basecamp docs` (alias documents), `basecamp vaults` (alias vault, folders), `basecamp uploads`. Persistent flags on the group: `--vault <id>` / `--folder <id>` (aliases, folder filter). VERIFIED (https://raw.githubusercontent.com/basecamp/basecamp-cli/main/internal/commands/files.go)

```
basecamp docs documents create <title> [content] [--folder <id>] [--in <project>]
basecamp docs documents create <title> - < body.md          # stdin content
basecamp files doc create <title> <body> [--in <project>]    # same leaf
basecamp files doc create <title> --draft [--in <project>]
basecamp files list [--vault <id>] [--all-projects] [--limit N] [--page 1] [--all]
basecamp files show <id> [--in <project>]
basecamp files update <doc_id> [--title <t>] [--content <c>] [--in <project>]   # partial-safe: preserves untouched field
basecamp files folder create <name> [--in <project>]
basecamp uploads create <file> [--folder <id>] [--description <text>] [--visible-to-clients] [--in <project>]
basecamp files download <id> [--out <dir>] [--in <project>]
basecamp files replace <upload_id> <file> [--description <text>]
basecamp files versions <upload_id> [--limit N] [--all]
```

Doc create flags: `--draft`, `--subscribe`, `--no-subscribe`, `--attach <file>` (repeatable), `--visible-to-clients`, `--folder`/`--vault`. Document body accepts Markdown and is converted to HTML. Untouched-field preservation on `files update` is CLI-side and documented as safe. VERIFIED (files.go, SKILL.md)

Client visibility caveat: `--visible-to-clients` is only honored in the project ROOT Docs & Files folder; targeting a nested `--vault`/`--folder` with that flag is a hard error raised before upload, because nested items inherit folder visibility and it cannot be changed per item afterward. VERIFIED (files.go, SKILL.md)

### cards and columns

```
basecamp cards list [--in <project>] [--card-table <id>] [--column <id>] [--all-projects] [--status] [--unassigned] [--no-due-date] [--not-now] [--overdue] [--sort] [--reverse]
basecamp cards show <id> [--in <project>]
basecamp cards create <title> [<body>] [--column <id>] [--in <project>] [--card-table <id>]
basecamp cards update <id> [--title <t>] [--due <date>] [--assignee me]
basecamp cards done <id|url> [--in <project>]                  # moves to Done column automatically
basecamp cards move <id> --to <column_id|name> [--position N] [--card-table <id>] [--in <project>]
basecamp cards move <id> --on-hold [--to <column_id>] [--in <project>]
basecamp cards move <id> --to-wormhole <wormhole_id|column_url> [--in <project>]   # async cross-project teleport; original ID 404s after
basecamp cards columns [--in <project>] [--card-table <id>]
basecamp cards column show <id> [--in <project>]
basecamp cards column create <title> [--description <text>] [--in <project>] [--card-table <id>]
basecamp cards column update <id|url> [--title <t>] [--description <text>] [--in <project>]
basecamp cards column move <id> --position 2 [--in <project>]
basecamp cards column on-hold <id|url>        # enable on-hold section; disable with column no-on-hold
basecamp cards column color <id> --color blue
basecamp cards column watch <id> / column unwatch <id>
basecamp cards steps <card_id> [--in <project>]
basecamp cards step create <title> --card <id> [--in <project>]
basecamp cards step complete <id> / step uncomplete <id>
basecamp cards wormholes list / wormholes create --to-column <id|url> / wormholes update / wormholes delete
```

If a project has multiple card tables you must pass `--card-table <id>`; otherwise an Ambiguous card table error shows the available IDs and names. `--assignee` and `--due with|without|overdue` are account-wide only on cards. `cards list` returns only active cards; archived/trashed via `basecamp recordings cards --status archived|trashed`. Completed cards sit in Done columns with `parent.type` of `Kanban::DoneColumn` and `completed: true`. Column moves do NOT update `updated_at` reliably as signal: read `basecamp events <card_id>` (an `adopted` event records every column move). There is NO column delete or archive command in the CLI: columns can be created, renamed, moved, recolored, watched, and given an on-hold section, but not deleted or archived through the CLI. Cards themselves have `basecamp cards trash/archive/restore` (recording lifecycle). VERIFIED (SKILL.md, https://raw.githubusercontent.com/basecamp/basecamp-cli/main/internal/commands/cards.go)

### checkins

```
basecamp checkins [--in <project>] [--questionnaire <id>]
basecamp checkins questions [--in <project>] [--questionnaire <id>]
basecamp checkins question <id> [--in <project>]
basecamp checkins question create <title> [--in <project>] [--questionnaire <id>] [--frequency ...] [--days 1,2,3,4,5] [--time 5:00pm] [--visible-to-clients]
basecamp checkins question update <id> <title> [--frequency ...] [--days ...] [--time ...]
basecamp checkins question pause <id> / resume <id> / answerers <id> / notify <id> [--on-answer|--no-on-answer|--digest-include-unanswered]
basecamp checkins answers <question_id> [--by me] [--in <project>] [--all-projects]
basecamp checkins answer create <question-id> <content> [--date YYYY-MM-DD] [--in <project>]
basecamp checkins answer update <id> <content> [--in <project>]
basecamp checkins reminders                  # your pending reminders, account-wide, no --in
```

Each project has one questionnaire (auto-detected, overridable with `--questionnaire <id>`). Schedule flags:

| Flag | Accepted values |
| --- | --- |
| `--frequency` / `-f` | every_day, every_week, every_other_week, every_month, on_certain_days (default every_day) |
| `--days` / `-d` | comma-separated integers, 0=Sun through 6=Sat (default 1,2,3,4,5) |
| `--time` | clock time such as 5:00pm (default 17:00) |
| `--questionnaire` | questionnaire ID (auto-detected) |

VERIFIED (https://raw.githubusercontent.com/basecamp/basecamp-cli/main/internal/commands/checkins.go, bc3-api questions.md)

422 Unprocessable Entity on create: the API requires `question[title]`, `question[schedule]` with frequency in exactly the five enum values and days in 0..6. The CLI validates that days parse as integers and that the time parses, but it does NOT validate the frequency enum or the day range, and passes them through to the API. A 422 therefore means you (or a caller) sent a frequency outside the enum or a day outside 0..6; the API classifies it as validation (envelope code validation, exit 9). The payload that always avoids it is the CLI default shape: frequency every_day, days 1,2,3,4,5, time 5:00pm (17:00), or explicit values from the tables above. VERIFIED (checkins.go create code path, bc3-api questions.md Create a question, https://raw.githubusercontent.com/basecamp/basecamp-cli/main/internal/output/codes.go)

### schedule

```
basecamp schedule info / schedule entries [--in <project>]
basecamp schedule show <id> [--date YYYYMMDD] [--in <project>]
basecamp schedule create <title> [--starts-at 2024-03-15T09:00:00Z] [--ends-at ...] [--all-day] [--notify] [--participants 1,2,3] [--no-subscribe|--subscribe <names>] [--visible-to-clients] [--in <project>]
basecamp schedule update <id> [--summary <title>] [--starts-at ...]
basecamp schedule settings --include-due [--in <project>]
basecamp reports schedule [--json]            # upcoming events across all projects
```

The mission wording schedule events create maps to `basecamp schedule create`; there is no events verb. VERIFIED (SKILL.md)

### checkins, search, misc

```
basecamp search <query> [--sort recency] [--limit 20] [--all] [--project <name>|--in] [--type todo|message|document|comment|card|file|ping|chat|check-in|event|folder|forward|client] [--creator me] [--since last_7_days|last_30_days|last_90_days|last_12_months|forever] [--file-type pdf] [--exclude-chat]
basecamp search metadata [--json]
basecamp url parse <url> [--json]             # returns account_id, project_id, type, recording_id, comment_id
basecamp attachments list <id|url> / attachments download <id> [--out dir] [--file <name>] [--index N] [--out -]
basecamp comments create <recording_id> <text> [--in <project>]       # replies are FLAT: reply to parent recording_id, not comment_id
basecamp comments show <url> [--json]         # cheap atoms: reply_target + paste-ready mention
basecamp comments thread <url> [--all] [--window N]
basecamp events <id|url> [--limit N] [--all]  # change history for one item
basecamp recordings <type> [--status archived|trashed] [--all] [--sort] [--direction]   # types: todos, messages, documents, comments, cards, uploads
basecamp recordings trash|archive|restore <id> [--in <project>]
basecamp recordings visibility <id> [--visible|--hidden] [--in <project>]
basecamp notifications [--json] / notifications read <id> / notifications bubbleups
basecamp people list [--project <project>] / people show <id> / people add <id> --project <p> / people remove <id> --project <p> / basecamp me
basecamp reports assigned [--json]            # my assigned work cross-project, defaults to me
basecamp assignments [--json] / assignments due overdue|due_today|due_tomorrow|due_later_this_week|due_next_week|due_later / assignments completed / assignments prioritize <id> / deprioritize / reorder --position N
basecamp gauges list / gauges needles --in <p> / gauges create --position 75 --color green --in <p>
basecamp bookmarks list / add / remove / check    # personal, account-wide, no --in
basecamp drafts list / notes show / notes set <content>
basecamp calendars show <id-or-url> / calendars update --color blue     # NO calendars list (no API index)
basecamp lineup list / create <name> <date> / update / delete           # account-wide markers
basecamp webhooks create <url> [--types Todo,Comment] [--in <project>] / update / delete
basecamp templates / templates construct <id> --name <name>             # poll construction until completed
basecamp api get|post|put|delete <path> [--data JSON]                   # escape hatch for unwrapped endpoints
basecamp attach <file> / upload <file>         # attachment staging primitives
basecamp doctor [--verbose|--json]             # CLI health, auth, connectivity, agent checks
```

Mention syntaxes, deterministic first: `[@Name](mention:SGID)` (zero API calls), `[@Name](person:ID)` (one call), `@sgid:VALUE`, fuzzy `@Name` / `@First.Last` (may be ambiguous; ambiguity returns an error with suggestions). Message/comment bodies accept Markdown, converted to HTML automatically. VERIFIED (SKILL.md)

Comments are flat: to reply, post to the parent recording_id; `url parse` returns the parent recording_id plus the comment_id in the fragment. `comments thread` gives the whole reply-ready context. VERIFIED (SKILL.md)

Search caps at 20 results by default; `--all` fetches every match. The API search endpoint was fixed in v0.8.0 era; `--project` scoping is server-side now. VERIFIED (SKILL.md, issue https://github.com/basecamp/basecamp-cli/issues/546 closed by PR 557)

## Forwards / inbox email address

```
basecamp forwards [--in <project>] [--inbox <id>]
basecamp forwards list [--all-projects] [--limit N] [--page 1] [--all]
basecamp forwards show <id|url> [--in <project>]
basecamp forwards inbox [--in <project>]       # inbox details (id, title, forwards_count, forwards_url)
basecamp forwards replies <forward_id|url> [--in <project>]
basecamp forwards reply <forward_id|url> <reply_id|url> [--in <project>]
```

Each project has one inbox (forward container), auto-detected from the project dock; `--inbox` overrides. VERIFIED (https://raw.githubusercontent.com/basecamp/basecamp-cli/main/internal/commands/forwards.go)

How to find the project email-forwarding address: the API does NOT expose it. `basecamp forwards inbox` returns the inbox resource (id, title Email Forwards, forwards_count, forwards_url) but the inbox model has no email address field: VERIFIED against the SDK Inbox struct (https://raw.githubusercontent.com/basecamp/basecamp-sdk/main/go/pkg/basecamp/forwards.go) and the bc3-api inbox payload (https://github.com/basecamp/bc3-api/blob/master/sections/inboxes.md). The address must be copied from the web UI: open the project Email Forwards tool and the Forward an email in flow, which generates and displays the project-specific address. The address format for Basecamp 3 was an @3.basecamp.com address, generic save@3.basecamp.com prompts you where to file the email, the personalized dropbox address files directly. That format fact is from the official 37signals Signal v. Noise announcement and a third-party integration guide; treat the exact BC5 suffix as UNVERIFIED, only the location (Forwards tool in the web UI) is reliable. See https://medium.com/signal-v-noise/new-in-basecamp-3-email-forwards-c0c9724a9f36 and https://www.postbox-inc.com/integrations/share-emails-in-basecamp

## MCP server and agent plugins

`basecamp mcp` serves an MCP server on stdin/stdout backed by the signed-in account; no separate binary or extra credentials. Requires authentication and a configured account (it refuses to prompt interactively because stdout belongs to the wire). Register as a stdio server:

```
claude mcp add basecamp -- basecamp mcp
basecamp mcp --read-only                 # read-only actions only
basecamp mcp --domains projects,todos    # narrow the surface, fails closed on unknown keys
```

Fifteen domain tools, each taking an action string plus a params object, with per-action schemas exposed through its describe action:

| Tool | Covers |
| --- | --- |
| basecamp_projects | projects CRUD, archive, unarchive, trash |
| basecamp_todos | todos, todolists, groups, todosets, hill charts |
| basecamp_cards | card tables, cards, columns, steps, wormholes |
| basecamp_messages | message boards, messages, comments, message types, pinning |
| basecamp_campfires | chat rooms, lines, uploads, chatbots |
| basecamp_boosts | reactions on recordings and events |
| basecamp_schedules | schedules, entries, timesheets, calendars |
| basecamp_files | vaults, documents, uploads, attachments |
| basecamp_people | profiles, pingable people, project access, OOO, preferences |
| basecamp_automation | check-ins, templates, webhooks, lineup, dock tools, recording lifecycle, events, search |
| basecamp_reports | progress, assigned/overdue, upcoming schedule, timelines |
| basecamp_everything | account-wide feeds (checkins, comments, files, forwards, messages, cards, todos) |
| basecamp_clientside | client approvals, correspondences, replies, visibility |
| basecamp_forwards | inboxes, forwards, replies |
| basecamp_account | account info, gauges, my assignments, notifications, bookmarks, notes, drafts |

VERIFIED (https://raw.githubusercontent.com/basecamp/basecamp-cli/main/internal/mcpserver/domains.go, README, https://raw.githubusercontent.com/basecamp/basecamp-cli/main/internal/commands/mcp.go)

Agent plugins: `basecamp setup claude` (hooks + skills) and `basecamp setup codex` (37signals marketplace). Manual Codex: `codex plugin marketplace add basecamp/claude-plugins` then `codex plugin add basecamp@37signals`. Plugins require the CLI on PATH and a CLI new enough to carry `agent-hook`; check with `basecamp agent-hook --help` (an unknown command reply means upgrade, then new session). `basecamp setup agents` installs the skill and connects detected agents non-interactively. Any agent can also point at skills/basecamp/SKILL.md in the repo. VERIFIED (README, install.md)

## Error codes

Envelope error codes and exit codes. VERIFIED (https://raw.githubusercontent.com/basecamp/basecamp-cli/main/internal/output/codes.go, SKILL.md Exit Codes and Error Handling)

| Envelope code | HTTP | Exit | Meaning | Retryable |
| --- | --- | --- | --- | --- |
| usage | 4xx | 1 | Wrong arguments; missing positional, bad flag combo, invalid name | false |
| not_found | 404 | 2 | ID or URL does not exist; also emitted with a hint when a required dock tool is missing or disabled for the project (e.g. checkins on a project without Automatic Check-ins, forwards without Email Forwards, cards without a Card Table). Mechanism VERIFIED in the dock auto-detection code; exact wording UNVERIFIED | false |
| auth | 401 | 3 | Not authenticated or token problem; hint says run `basecamp auth login` | false |
| forbidden | 403 | 4 | Insufficient scope or permission; hint says `basecamp auth login --scope full` | false |
| rate_limit | 429 | 5 | Too many requests; resilience layer handles Retry-After automatically | true |
| network | 6xx | 6 | Connectivity failure; run `basecamp doctor` | true |
| api | 5xx | 7 | API/gateway error; retry if retryable | varies |
| ambiguous | 4xx | 8 | Be more specific; use ID instead of name (e.g. Ambiguous card table) | false |
| validation | 422 | 9 | Unprocessable Entity from the API: request payload rejected (e.g. checkins question schedule violates the enum/range contract). Emitted by the SDK since v0.13.0 | false |
| limit_exceeded | 507 | 10 | Account limit reached (project limit, storage, user count). Emitted by the SDK since v0.14.0 | false |

`not_found` plus hint when a tool is disabled: commands that depend on a dock tool locate it by scanning the project dock (getDockToolID in forwards.go, getQuestionnaireID in checkins.go). When the tool is absent the command fails rather than guessing. VERIFIED mechanism (forwards.go, checkins.go); the user-visible hint text for each disabled-tool case is UNVERIFIED and should be read from the actual error.

Observed operator error, explained: the server message *The project limit for this account has been reached* fired on a Free plan account that already held 1 project, because the Free plan allows exactly 1 project. Create returns code limit_exceeded (retryable false). Fixes: delete (trash) the existing project via `basecamp projects delete <id>` to free the slot, or upgrade. VERIFIED (https://basecamp.com/pricing). The exact English string is the server message (italicized above); the code mapping (limit_exceeded, exit 10, 507) is VERIFIED from codes.go. UNVERIFIED: whether an archived project frees the slot on the Free plan; the pricing FAQ language says on Free you can run one project at a time and must delete the current one to start another, while paid plans count only active projects. Read that carefully before advising archive-vs-delete.

If a create on a Free plan hits a different ceiling, storage is 1 GB and users max 5 on Free; those also surface as account limits. VERIFIED (basecamp.com/pricing)

## Plan project limits

VERIFIED (https://basecamp.com/pricing)

| Plan | Active projects | Storage | Users |
| --- | --- | --- | --- |
| Free | 1 | 1 GB | 5 max |
| Freelancer (trial) | up to 3 active | 5 GB | 20 max |
| Studio | up to 10 active | 25 GB | unlimited |
| Pro | up to 25 active | 100 GB | unlimited |
| Unlimited | unlimited | 1000 GB | unlimited |

Archived or deleted projects do not count against paid plan totals. Free accounts cannot downgrade to plan tiers and deleting ends the slot rule: you can delete the current project and start another. VERIFIED (same source)

## Sources

- https://github.com/basecamp/basecamp-cli (README: quick start, auth, profiles, MCP, config, troubleshooting, upgrade)
- https://raw.githubusercontent.com/basecamp/basecamp-cli/main/skills/basecamp/SKILL.md (the bundled agent skill: invariants, output modes, quick reference, resource reference, config, errors, exit codes)
- https://github.com/basecamp/basecamp-cli/blob/main/install.md (installation, auth, agent setup, troubleshooting)
- https://api.github.com/repos/basecamp/basecamp-cli (repo metadata)
- https://api.github.com/repos/basecamp/basecamp-cli/releases/latest (v0.9.1, 2026-08-12)
- https://raw.githubusercontent.com/basecamp/basecamp-cli/main/internal/commands/tools.go (dock tool types, create-by-type)
- https://raw.githubusercontent.com/basecamp/basecamp-cli/main/internal/commands/forwards.go (inbox, forwards commands)
- https://raw.githubusercontent.com/basecamp/basecamp-cli/main/internal/commands/checkins.go (question create schedule flags and defaults)
- https://raw.githubusercontent.com/basecamp/basecamp-cli/main/internal/commands/auth.go and https://raw.githubusercontent.com/basecamp/basecamp-cli/main/internal/auth/auth.go (login flags, device flow, remote callback, redirect URI rules, callback address 127.0.0.1:8976)
- https://raw.githubusercontent.com/basecamp/basecamp-cli/main/internal/commands/profile.go (profiles)
- https://raw.githubusercontent.com/basecamp/basecamp-cli/main/internal/config/config.go (layers and precedence)
- https://raw.githubusercontent.com/basecamp/basecamp-cli/main/internal/commands/config.go (config set/unset/trust, valid keys)
- https://raw.githubusercontent.com/basecamp/basecamp-cli/main/internal/commands/mcp.go and https://raw.githubusercontent.com/basecamp/basecamp-cli/main/internal/mcpserver/domains.go (MCP server, 15 domains)
- https://raw.githubusercontent.com/basecamp/basecamp-cli/main/internal/commands/files.go (docs/documents/uploads leaves, folder flags)
- https://raw.githubusercontent.com/basecamp/basecamp-cli/main/internal/commands/cards.go (cards and columns command surface)
- https://raw.githubusercontent.com/basecamp/basecamp-cli/main/internal/commands/projects.go (projects surface)
- https://raw.githubusercontent.com/basecamp/basecamp-cli/main/internal/output/codes.go and https://raw.githubusercontent.com/basecamp/basecamp-cli/main/internal/output/errors.go (error and exit codes, validation 9, limit_exceeded 10)
- https://github.com/basecamp/bc3-api/blob/master/sections/questions.md (question create contract: frequency enum, days 0-6, time_of_day)
- https://github.com/basecamp/bc3-api/blob/master/sections/inboxes.md (inbox payload, no email field)
- https://raw.githubusercontent.com/basecamp/basecamp-sdk/main/go/pkg/basecamp/forwards.go (Inbox model, no email field)
- https://basecamp.com/pricing (plan limits)
- https://basecamp.com/agents (agents page, install one-liner)
- https://basecamp.com/5 (Basecamp 5 feature context: loose to-dos, subtasks, everything, markdown, tables)
- https://medium.com/signal-v-noise/new-in-basecamp-3-email-forwards-c0c9724a9f36 (official 37signals post: forwarding address behavior)
- https://github.com/basecamp/basecamp-cli/issues/546 and pulls/557 (search filter history)

Compiled 2026-08-30. Re-verify before trusting anything beyond the current release: run `basecamp --version` and `basecamp doctor --json` on the target host. This document carries no confidential material; credentials.json content stays unread by design.
