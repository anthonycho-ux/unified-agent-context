# How to use Kimi Code CLI as a subagent (orchestrator instructions)

Audience: orchestrator agents, primarily Claude Desktop.
Kimi Code CLI ("kimi") is a full-stack execution agent running on the user's Mac.
It can be invoked non-interactively via one-shot `kimi -p` calls. Verified 2026-07-24.

## 1. Invocation

### Basic one-shot call (standard form for synchronous delegation)

```bash
cd <working directory> && kimi -p "<prompt>" --output-format text
```

- Prompt mode (`-p`) is already fully autonomous on its own. Do NOT add `--auto`
  or `-y`: kimi rejects both with `Cannot combine --prompt with --auto` (verified
  on 0.29.1 by Claude Code's end-to-end run, 2026-07-24).
- `--output-format stream-json`: when the caller must machine-parse progress and results.
- `-m <model alias>`: only when a specific model is required. Defaults to default_model in config.

### Continuing a conversation (when multi-turn is needed)

```bash
kimi -p "first instruction"        # starts a new session
kimi -c -p "follow-up"             # continues the previous session for this directory
kimi -S <sessionId> -p "follow-up" # resumes a specific session
```

### Timeouts and async

- Allow 120s for light tasks, 600s+ for tasks involving builds or tests.
- For longer work, run it in the shell background and have kimi write a done-file
  (e.g. /tmp/task-done.json), then poll for it. kimi exits as soon as it finishes.

## 2. Kimi's strengths — delegate these

Give kimi work that is "hands-on execution on the local Mac". The orchestrator judges
and coordinates; kimi executes and verifies.

1. **Local Mac execution.** Shell, filesystem, git, builds, tests, package management.
   For code changes, provide paths and a done-condition, then delegate.
2. **GUI automation (orca computer).** Reads screens, clicks, and types in desktop apps.
   This is the only door for apps with no API or apps that need a logged-in session.
   It can even drive Claude Desktop itself (bundle id com.anthropic.claudefordesktop).
   It is slow and brittle, so prefer structured channels when one exists.
3. **Fleet skill library.** 100+ verified recipes: browser automation, Apple apps
   (Notes, Reminders, iMessage), document generation (docx, xlsx, pptx, pdf),
   social posting (X, Threads), image card rendering, and more. Ask for the outcome
   and kimi finds the right skill.
4. **Parallel fan-out.** Subagent swarms up to 128 parallel workers. Use for
   codebase-wide sweeps, bulk file transforms, and multi-angle research.
5. **Background jobs and scheduling.** Long-running monitors and recurring work
   can run on kimi's cron.
6. **Web research.** Built-in search and page fetching.
7. **store-host server offload.** Heavy, long, unattended work goes to `ssh store-host`
   (Ryzen 7, 61 GB RAM, always-on; no GPU).
   - `ssh store-host '<command>'` runs a non-interactive, non-login bash shell, which
     reads none of `.bashrc`, `.bash_profile`, or `.profile`. On store-host the real
     PATH additions (`~/.local/bin`, `~/.npm-global/bin`) live in `.profile`,
     reached only through `.bash_profile`, which only a login shell sources.
     Two failure modes result: tools installed there report as missing
     (`grok`, `hermes`, `omo`, `pi`, `qwen`, `copilot`, `cursor-agent`,
     `reasonix`, `agent-browser` all failed this way), and tools that DO
     resolve via the bare default PATH (`claude`, `codex`, `letta`) silently
     run an older, separately-installed copy instead of the current one
     (verified 2026-08-02: plain ssh gave claude 2.1.173 / codex 0.114.0 /
     letta 0.29.2, login shell gave 2.1.212 / 0.144.5 / 0.30.1).
   - Fix: always invoke as `ssh store-host 'bash -lc "<command>"'`, never bare
     `ssh store-host '<command>'`. No store-host-side file changes needed or made; this is
     purely how the orchestrator must call it.
8. **Shared memory (UAC).** kimi reads and writes UAC. Decisions the orchestrator
   records with record-fact.mjs are picked up by kimi at next session start, and
   lessons kimi records flow back the same way. Context moves without file passing.

## 3. Briefing format

Put these five lines in every delegation prompt. This is the verified standard.

```
Goal: <one-sentence objective>
Context: <relevant file paths, current state, results of prior steps>
Constraints: <what not to touch, rules to follow, forbidden commands>
Done-when: <verifiable completion condition>
Verification: <artifact that proves completion, e.g. test output, file path, command result>
```

- Use absolute paths. kimi's working directory is set by the caller's cwd.
- Vague goals make kimi predict and act; a wrong prediction is wasted work.
  The more concrete Done-when is, the less rework there is.

## 4. Verification rules

- Do not trust kimi's "done" report on its own. Bake one of these into the
  completion condition: re-run tests, inspect the diff, verify the file exists.
- Destructive commands (rm -rf, git reset, push, etc.) must be explicitly
  forbidden or explicitly allowed in the briefing. With no instruction, kimi
  only takes locally reversible actions on its own.
- A failure report is as valuable as a success report. kimi reports failures
  plainly, without dressing them up.

## 5. Channel selection

| Purpose | Channel |
|---|---|
| Task delegation with result return | `kimi -p` one-shot call |
| Multi-turn working conversation | `kimi -c` / `kimi -S` session resume |
| Sharing facts, decisions, lessons | UAC record-fact.mjs (read at next session start) |
| Talking to the Claude Desktop app's own context | orca computer GUI path (last resort) |

## 6. Good to know

- kimi sessions are bound to a working directory. To continue a topic, use `-c`
  from the same cwd.
- `kimi doctor` validates configuration. If calls behave oddly, start there.
- kimi's replies follow the user's style rules (Korean, plain prose). If you need
  machine-parseable output, use stream-json or require an output file.
