# Handoff: Mac cleanup + Obsidian wiki setup — 2026-08-29 evening session

**From:** Claude Code (Sonnet 5), Herdr-managed session
**To:** Aside (tomorrow morning routine) — build the user's todo list for the day from this

## What's fully done, no action needed

**Mac cleanup** (11 items resolved):
- Killed + disabled `caffeinate` LaunchAgent (was running nonstop, real battery cost)
- Removed dead Chromium PWA shims, 12 leftover Application Support folders (~887MB freed)
- Notch app decided: kept "Say No to Notch," removed tinyGreen + Notchi
- Jackett stopped + disabled (not used)
- Kiban wake-on-LAN heartbeat disabled (confirmed unnecessary — `sov` never sleeps)
- Movies-library mount switched from 2-min polling to event-driven `WatchPaths`
- `nightly-maintenance` and `model-scoreboard` investigated — both working as intended, false alarms

**Obsidian vault:**
- Migrated from iCloud sync to Dropbox CloudStorage:
  `/Users/<mac-user>/Library/CloudStorage/Dropbox/Obsidian/partnership-journal`
  (never write to the old iCloud path)
- Karpathy LLM Wiki plugin (`karpathywiki`, already installed, previously stalled since Aug 3)
  is now configured and verified working: routes through the user's own CC-PROXY
  (`sov-ts (local inference endpoint)`, model `z-ai/glm-5.3`), `llm_config_status: ok`
  confirmed by direct file read, not just the plugin's own claim.
- `Inbox unclassified` (a separate small vault, 1 real note) merged into
  `sources/Inbox unclassified/` inside partnership-journal; `watchedFolders` points there.

## Open items — the actual todo list material

1. **First real ingest never run.** The plugin is configured and live, but no ingest
   pass has actually happened yet on `sources/Inbox unclassified`. Run
   `Karpathy LLM Wiki: Ingest from folder` (Cmd+P in Obsidian) and see what it produces.

2. **Wiki reorganization decision, pending.** The existing wiki (144 pages, bulk-migrated
   Aug 15) mixes unrelated domains (golf trip planning + AI research methodology) in one
   flat namespace. Brainstormed 5 restructuring ideas, fact-checked the load-bearing claims:
   - Domain-first namespacing (`wiki/<domain>/...`) — the "flat namespace hurts link
     quality" justification did NOT hold up under fact-check (no real comparative study
     found; PKM community actually leans toward flat+links). Still may be right for
     the user's specific case, but decide on its own merits, not that claim.
   - Typed-edge graph instead of entity/concept split — stands on its own reasoning.
   - Event/decision-first ingest (merge with UAC's `record-fact` instead of a parallel
     knowledge store) — stands on its own reasoning, addresses a real risk (two knowledge
     stores drifting apart).
   - Auto-decay unresolved stubs instead of accumulating them forever (21 stub pages found
     tonight, schema's own "Fix Dead Links" creates more stubs than it resolves).
   - Physical `verified/` vs `draft/` folder split instead of an invisible `reviewed:` flag.

3. **Last known Lint numbers are stale.** 108 pages / 93 dead links / 14 orphans / 175
   ungrounded quotes — from before tonight's growth to 144 pages. A fresh Lint run
   (Cmd+P → "Karpathy LLM Wiki: Lint wiki") would give current numbers, but the plugin's
   local REST API was flaky tonight (stopped responding after ~30s at one point) —
   the user's own words: "the knowledge injection process is not stable yet, I'm still
   trying to find a better way to manage it." Don't force this if it's still unstable.

4. **Mac reboot still pending.** RAM was at 77MB free / 3.6GB swapped when checked —
   only real fix is a restart, entirely the user's call on timing.

## Architecture decision worth remembering

the user's own framing, recorded to UAC (`4b967a71f10bcc2f`, global): Obsidian is one of
several possible *viewers* for his knowledge, not the source of truth or the automation
layer. He runs an agent (cmd/Claude Code) alongside his vault every session, so UI-gated,
click-to-activate plugin designs (built for agentless human users) impose friction without
matching benefit. Prefer agents operating directly on vault files over routing through
plugin UI/REST where possible.

## For the morning routine specifically

Build the user a todo list from the "Open items" section above, in priority order. Don't
assume any of this changed overnight — check current state before assuming the reboot
happened, the ingest ran, etc.
