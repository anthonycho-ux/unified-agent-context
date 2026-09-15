# Handoff: Herdr hacker-terminal panel wall

**Date:** 2026-08-29
**From:** Claude Code (Sonnet 5), session in the `unified-agent-context` checkout
**To:** Aside CLI, commandcode CLI (or any agent asked to touch this layout next)

## What exists right now

The user asked for a sci-fi hacker-terminal look. I split the Herdr workspace/tab
around this Claude Code session's own pane into a 5-column x 2-row grid (10 panes)
and launched a different looping visual effect in each. This session's own pane
(`w3:p1R`) was deliberately left alone — do not pipe effects into it, it's a live
agent console.

Workspace/tab: `w3` / `w3:tG` (Herdr IDs — re-verify with `herdr pane list --workspace w3`,
IDs can shift if panes close).

| Pane ID | Effect script | Command running |
|---|---|---|
| `w3:p1R` | — (this agent's own console) | do not touch |
| `w3:p21` | hex dump scroll | `python3 <scratch>/panels/hexdump.py` |
| `w3:p1X` | fake port scanner, looped | `while true; do python3 <scratch>/panels/scan.py; done` |
| `w3:p22` | binary rain | `python3 <scratch>/panels/binary.py` |
| `w3:p1Y` | fake system log tail | `python3 <scratch>/panels/log.py` |
| `w3:p23` | "bypassing firewall" progress bars | `python3 <scratch>/panels/progress.py` |
| `w3:p1Z` | base64 noise scroll | `python3 <scratch>/panels/base64noise.py` |
| `w3:p24` | red ASCII banner + uptime/whoami | `python3 <scratch>/panels/banner.py` |
| `w3:p10` | real `top -o cpu` | `top -o cpu` |
| `w3:p25` | live ping | `while true; do ping -c1 -t1 1.1.1.1 2>&1; sleep 0.5; done` |
| `w3:p26` | brute-force hash decrypt loop | `python3 <scratch>/panels/decrypt.py` |

## Absolute paths

Scripts live at:

```
/private/tmp/claude-501/<session-slug>/<session-id>/scratchpad/panels/
```

Files in that directory: `matrix.py`, `hexdump.py`, `scan.py`, `binary.py`, `log.py`,
`progress.py`, `base64noise.py`, `banner.py`, `decrypt.py`.

**Warning:** this is a session-scoped Claude Code scratchpad
(`/private/tmp/claude-501/...`), not a durable project path — it can be cleaned up
by the OS or the harness between sessions. If you want this panel wall to survive
past this session, copy the `panels/` directory somewhere durable (e.g.
`~/scripts/hacker-panels/`) before relying on it, and update the `herdr pane run`
commands above to point at the new path.

`matrix.py` (classic green Matrix rain) was written but never assigned to a pane —
it's available in the same directory if you want to swap it in for any panel.

## How to modify or tear down

- Inspect current layout: `herdr pane layout --pane w3:p1R` (or `--current` from
  inside that pane).
- Re-point a pane to a different effect: `herdr pane run <pane_id> "<command>"`.
- Close a pane: `herdr pane close <pane_id>`.
- Kill an effect without closing the pane: `herdr pane send-keys <pane_id> C-c`,
  or just `herdr pane run <pane_id> "<new command>"` to replace it outright.
- All effects loop forever by design (`while true` or an internal `while` loop) —
  expect to Ctrl-C or `pane run` over them to stop, they will not exit on their own.

## Gotcha hit during setup (repeat this, don't re-derive it)

`herdr pane split <id> --direction right --ratio R` gives the **original** pane a
width of `R` and the **new** pane gets `1-R`. For N equal columns, don't apply the
same ratio to each successive split — the ratio must be computed against the
*shrinking remainder*: `1/N, 1/(N-1), 1/(N-2), ..., 1/2`. For 5 columns that's
`0.2, 0.25, 0.3333, 0.5`. Getting this backwards produces lopsided
105/20/4/1/1-width columns instead of five even ones (had to close and redo once
this session).

Also: `$HERDR_PANE_ID` inside a running agent's shell is *that agent's own pane*.
Splitting off of it is fine (that's how this layout was built — column 1 is the
leftover sliver of the original pane), but never `pane run` a command straight at
the un-split pane ID if you're currently occupying it — it types into your own
prompt instead of a separate display surface.
