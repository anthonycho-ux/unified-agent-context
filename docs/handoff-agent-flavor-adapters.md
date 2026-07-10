# Handoff — standardize UAC context, preserve each agent's flavor

Paste-ready brief for a coding agent continuing this work in Orca.
Repo: `/Users/<mac-user>/unified-agent-context` · public: https://github.com/anthonycho-ux/unified-agent-context

---

## Mission
UAC already unifies **facts** across agents. Next improvement: make the shared
store more standardized *without* turning every agent into the same voice.

Owner framing (2026-07-09, Aside sidepanel on this repo):
> "컨텍스트를 어떻게 표준화하되 각 에이전트 맛은 살릴까?"
> (How do we standardize context while keeping each agent's flavor?)

## Design decision (approved direction — implement, don't re-debate)

**Split content from voice.**

| Layer | Lives where | Sync? | Contents |
|---|---|---|---|
| Shared facts | UAC store on sov (`mcp-memory-keeper`) | Yes | Agent-neutral claims only: preferences, decisions, project state |
| Local voice / persona | Each agent's own files (Aside `SOUL.md`, Claude `CLAUDE.md` style notes, Hermes system persona, etc.) | **No** | Tone, tool idioms, UI patterns, role flavor |
| Render adapter | New per-agent inject path | Yes (code in this repo) | Translates the same facts into that agent's native prompt dialect + filters by relevance |

Conflict rule (one line): **facts → shared store wins; style → local wins.**

### Neutral fact shape (what may be written to the store)
- Prefer declarative world/user claims, not imperative agent instructions.
  - Good: `the user wants action-first replies (decision/action first, context after).`
  - Bad: `You must always put DECIDE at the top and use ask_user_question.`
- Keep existing scopes: `global` (preferences) vs `project:<git-root>` (decisions/state).
- Keep secret gate fail-closed. Never write credentials/tokens.

### Per-agent render adapters (what to build)
Evolve `scripts/inject-context.mjs` (and any MCP inject path) from **one shared block**
into **adapter-selected output**:

1. `inject-context.mjs --agent <id>` where `<id>` ∈ `claude-code | codex | hermes | aside | gajaecode | lettacode | generic`.
2. Each adapter:
   - pulls the same scoped facts from the store
   - applies a **relevance filter** (e.g. browser-site quirks → Aside only; git conventions → coding agents)
   - formats into that agent's native dialect (markdown rules, CLAUDE.md bullets, Hermes system notes, etc.)
3. Default without `--agent` remains the current generic block for back-compat.

Example of one fact, three dialects:

Fact (store): `preference: action-first replies`

- Claude Code: "Lead PR/status explanations with the conclusion; details below."
- Aside: "Lead with `**DECIDE:**` / `**Blocked on you:**` / `**No action needed.**`; use `ask_user_question` for 2–4 discrete options."
- Hermes: "Kanban / status summaries: one-line conclusion first, then evidence."

### Explicitly out of scope for this task
- Persona/soul files (do not sync or overwrite).
- Folding agent-skills-sync into UAC (separate sibling idea; see owner memory).
- Live MCP skill registry.
- Committing unrelated uncommitted work in the tree.

## Repo orientation (read first)
- `CLAUDE.md` — agent orientation
- `README.md` + `docs/phase*.md` — architecture
- `docs/handoff-tailscale-connectivity.md` — store host fallback (sov-ts → sov) already applied; live failover not fully exercised
- Key code: `uac.config.json`, `src/config.mjs`, `src/store-adapter.mjs`, `scripts/inject-context.mjs`, `scripts/record-fact.mjs`
- Tests: `node --test 'tests/*.test.mjs'` (73 passing as of handoff)

## Implementation plan (smallest useful slice first)

### Phase A — contract (docs + schema, no behavior break)
1. Document the fact-vs-voice split and neutral-claim rules in `docs/` (this file can become the design source; add a short pointer from README or phase docs).
2. Define agent ids + relevance tags (e.g. fact metadata `tags: ["browser","coding","infra"]` or infer from type/scope). Prefer the minimal extension that doesn't break existing store rows.

### Phase B — adapter skeleton
1. Refactor inject path: fetch facts once → `render(agentId, facts)` → stdout.
2. Ship `generic` (= current behavior) + at least **two** real adapters (`claude-code`, `aside` or `hermes`).
3. Unit tests for: neutral fact formatting, relevance filter inclusion/exclusion, back-compat default.

### Phase C — write-path hygiene
1. Soft guidance in `record-fact.mjs` / docs: reject or rewrite imperative "you must…" phrasing into neutral claims when type is preference/decision (start as warning/docs if hard rewrite is risky).
2. Keep secret gate and scopes intact.

### Phase D — verify on real agents
1. `node scripts/inject-context.mjs --agent claude-code` and `--agent aside` produce distinct, useful blocks from the same store.
2. Confirm a coding agent session and an Aside-oriented dump both stay on-flavor.
3. Do not require sov if tests use local escape hatches (`UAC_REMOTE=0` / `UAC_SERVER_ENTRY` / `UAC_DATA_DIR`).

## Acceptance criteria
- [ ] Design written into repo docs (not only chat memory)
- [ ] `inject-context.mjs --agent <id>` works for ≥2 agents + generic default
- [ ] Same underlying facts → different renderings
- [ ] Relevance filter drops clearly irrelevant facts per agent class
- [ ] 73+ tests green; new adapter tests added
- [ ] No persona files modified; no secrets written
- [ ] Commit only this task's files with a clear message

## Broader context (owner intent, do not expand scope without asking)
- UAC is the active improvement focus "for the next little while"
- Feedback loop: weekly Aside routine `UAC feedback iteration` (Fridays 9am MT) checks GitHub + reexplain ledger
- v2 roadmap already in README: offline local queue + resync; self-hosted remote MCP + auth for claude.ai — **not** this handoff unless blocked on adapters
- Business filter: this is a showcase for multi-agent infra consulting; keep the pitch crisp ("write a fact once; every agent gets it in its own dialect")

## Guardrails
- Tests must never SSH
- No hardcoded IPs; use `sov` / `sov-ts` aliases
- Leave unrelated dirty/untracked files alone
- Prefer smallest PR that proves the adapter pattern over a grand rewrite

---

## Suggested first agent message (if launching cold)

You are continuing **Unified Agent Context (UAC)** at `/Users/<mac-user>/unified-agent-context`.
Read `CLAUDE.md` and `docs/handoff-agent-flavor-adapters.md` first.
Implement Phase A + Phase B: document the fact-vs-voice split, then make
`scripts/inject-context.mjs` accept `--agent <id>` with `generic` (current
behavior) plus at least two real adapters and tests. Do not sync persona files.
Keep all 73 existing tests green. Commit only related files when the slice works.
