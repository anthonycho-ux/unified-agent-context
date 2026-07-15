# Phase 7 ADR: Chat-Session → UAC Ingestion

Status: FROZEN 2026-07-12 (Fable architecture-freeze consult via Aside/Sol; the user resolved open questions same day)

## 1. Decision summary

**Ingest memories, not transcripts.** Each agent's own distilled memory is the preferred ingestion substrate: Aside's dreaming output (episodic daily pages) and Hermes's memory system are already high-quality LLM distillations. UAC ingests those via a nightly batch sweep with per-source watermark cursors, running an LLM fact-extraction + normalization pass (codex CLI headless on the Mac; store-host-local job for Hermes) that emits canonical, agent-neutral atomic facts through the existing `recorder.mjs` → secret-gate → outbox → Noticer-curator pipeline. Raw transcripts never leave the host they live on. Only Codex CLI (no self-memory) gets raw-transcript distillation. The 231-session Aside backlog is never re-distilled — its durable value already exists in the episodic pages, which are backfilled in full (tiny). Claude Code is covered by the session-digest-bus hook. Server-side surfaces (Claude Desktop, claude.ai, grok.com) are covered by a committed **quarterly manual export ritual** feeding an `ingest-inbox/` lane (Stage 4). Flood control is structural: hard per-sweep caps, LLM-enforced signal thresholds, single-writer curator as the promotion valve. No schema migration — only `source_ref` conventions and one ingestion module.

## 2. Frozen decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Distillation engine | Tiered: cheap gate (size/marker-density skip) → LLM extraction via codex CLI headless (`codex-primary`, pinned; NO account failover — fact-writing is side-effecting). Nightly launchd on Mac; Hermes lane = store-host cron (Stage 3). |
| 2 | Raw vs distilled | Memory-first. Aside: `memory/episodic/*.md`. Hermes: its memory output (not raw state.db). Codex: raw `archived_sessions/*.jsonl` (tail-truncated ~8k tokens). Provenance: `source_ref = memory:<agent>:<relpath>` / `session:<agent>:<sid>` / `hook:session-end:<agent>`. |
| 3 | Trigger model | Nightly scheduled batch sweep + per-source watermark cursors (`data/ingest-cursors.json`). No session-end SSH distillation (rejected previously for latency). Cursors advance ONLY on confirmed write. |
| 4 | Dedup/conflict | LLM-as-normalizer at source (canonical statement: English, declarative, present-tense, no session-local dates) + existing exact-hash upsert. Residual near-dupes/contradictions → Noticer curator merge authority. Embedding similarity deferred to v2. No dedupe_key change. |
| 5 | Flood control | Forward-only for transcripts; full backfill ONLY of existing Aside episodic pages. Caps: ≤10 facts/source/sweep, ≤25 facts/sweep total. Extraction restricted to decision/preference/durable-env facts with confidence field; below-threshold dropped, not queued. |
| 6 | Privacy | Raw transcripts never leave their host. Distillation runs where data lives. Only post-secret-gate distilled facts travel the existing outbox→store-host lane. Auto-distill fail-safe (skip); explicit writes fail-closed. |
| 7 | Budget (the user, 2026-07-12) | No hard monthly cap needed — codex runs on subscription auth, not metered API. Per-sweep fact caps bound volume. |
| 8 | Server-side gap (the user, 2026-07-12) | Quarterly manual data-export ritual COMMITTED (claude.ai/Claude Desktop zip + grok export) feeding `ingest-inbox/`; Stage 4 builds the parser lane. |
| 9 | Retention on entry (the user delegated to empirical test, 2026-07-12) | Stages 1-2 ingest as days90-pending (`project_state`-class retention for ingested facts pending curator promotion). Metrics hook records curator discard/merge rate. Flip condition: after ~50 ingested facts or 2 weeks, discard rate <20% → switch to permanent-on-entry; ≥20% → keep pending, tighten extraction prompt. |

## 3. Source verdicts

| Surface | Verdict | Mechanism | Stage |
|---|---|---|---|
| Aside (Sol) | INGEST-NOW | Nightly sweep of `~/.aside/u/0/agents/main/memory/episodic/*.md`, cursor, codex-headless extraction → recorder.mjs | 1 |
| Codex CLI | INGEST-NOW | Same sweep, `~/.codex/archived_sessions/*.rollout-*.jsonl`, one-time 13-file backfill under caps | 2 |
| Claude Code CLI | INGEST-NOW (digest) | Session-end Stop hook → digest bus; sweep promotes digest lines | 2-3 |
| Hermes | INGEST-LATER | store-host-local cron on Hermes memory output → canonical store directly | 3 |
| Claude Desktop / claude.ai | QUARTERLY EXPORT | Manual data-export zip → `ingest-inbox/` parsed by sweep | 4 |
| grok.com | QUARTERLY EXPORT | Same inbox lane | 4 |

## 4. Data flow

```
 MAC (16GB)                                             SOV (61GB, no GPU)
 Aside memory/episodic/*.md ──┐                        Hermes memory ──┐
 Codex archived_sessions ─────┤  NIGHTLY SWEEP          (Stage 3 cron) ▼
 Claude Code digests ─────────┤  cursor → cheap gate    ┌────────────────────┐
 ingest-inbox/ (quarterly) ───┘  → codex-primary LLM ──▶│ context.db (canon) │
        │                        → secret-gate          └─────────┬──────────┘
        ▼                        → recorder.mjs                   ▼
 local store + outbox.jsonl ────────ssh hourly──────▶  Letta "The Noticer"
 RAW TRANSCRIPTS NEVER CROSS ═══════════════════════   (promote/merge/discard)
```

## 5. Staged plan

| Stage | Deliverable | Acceptance test |
|---|---|---|
| 1 | `scripts/ingest-aside.mjs` + launchd plist (the user loads): cursor file, cheap gate, codex-headless extraction, caps, days90-pending retention, heartbeat fact per successful sweep, discard-rate metrics hook. Backfill existing episodic pages. | Run against one episodic page → 1-10 normalized facts w/ correct source_ref; immediate re-run stores 0 (idempotent); fake `sk-` token in page → skip-not-crash; facts on store-host after next hourly sync. |
| 2 | Source-adapter generalization; Codex transcript adapter; Claude Code digest hook | New Codex session → facts within 24h; 13-file backfill completes across ≤3 sweeps within caps; Stop hook exits 0 with store-host down (spool). |
| 3 | store-host-side Hermes lane (cron + vendored schema/gate module) | Hermes memory item → fact in canonical store w/ correct ref; visible on Mac within an hour. |
| 4 | `ingest-inbox/` export-zip parser (claude.ai + grok formats); retention flip decision per §2.9 metrics | Dropped export zip → capped facts; discard-rate report generated; retention decision executed. |

## 6. Risks

1. **Second-stage distillation drift** (re-importing Sol-flavored statements as facts) → extraction prompt hard-requires agent-neutral, self-contained statements with source quote; persona-vocabulary facts dropped; Noticer is second filter.
2. **Silent lane death** (launchd stops, auth expires, store-host down) → self-healing: cursor never advances without confirmed write; spool+retry next sweep; heartbeat fact per successful sweep — absence is the alarm.
3. **Curator overload** → per-sweep caps make bursts impossible by construction; Stage 4 measures merge/discard rate before any cap increase; days90 default ages mistakes out.
