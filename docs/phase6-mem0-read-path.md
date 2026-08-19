# Phase 6 — mem0 read path (recovery plan after GPU retirement)

- When: 2026-08-12 (early morning)
- Context: after the GPU server was retired, the embedding server
  (port 8090, nomic-embed) went down, which broke mem0 CLI search. The
  fastembed (CPU) path kept working.

> **Status: historical / planned.** This document records a recovery
> plan from a past incident. The embedding-server dependent mem0 CLI
> path is not the current read path; treat this as background, not as
> the live architecture.

## Diagnosis (confirmed 2026-08-12)

| Component | Status | Notes |
|---|---|---|
| mem0 CLI (`~/.local/bin/mem0`) | ❌ search broken | depended on the GPU embedding server `localhost:8090` |
| `~/bin/memstore-hermes.py` | ✅ search worked | fastembed (BAAI/bge-base-en-v1.5), CPU, no server needed |
| LLM server (8080/8081) | ✅ alive | local GGUF |
| chroma store (`~/.letta/mem0_data`) | ✅ data exists | `letta_memories` collection, 1.6MB |
| qdrant (6333) | ❌ not running | separate project (knowledge indexing), unrelated to mem0 |

## Recovery plan (next steps)

1. Point the mem0 CLI setup at the same fastembed-based configuration as
   `memstore-hermes.py`:
   - embedder: `fastembed` + `BAAI/bge-base-en-v1.5` (CPU, no server)
   - llm: keep the existing local GGUF server
2. Add a mem0 search-results section to `getInjectionBlock` in
   `inject-context.mjs`:
   - merge relevant memories into the UAC block at session start
   - on failure, degrade (existing pattern); under `UAC_STRICT=1`, fail
3. Verify: `mem0 search` works without the GPU + injection includes memories

## Verified fact (tested at the time)

`python3 ~/bin/memstore-hermes.py --read "writing style preference"` → search
succeeded (relevant memories returned).

## Notes

- `memstore-hermes.py`'s read() setup was the source of truth: fastembed +
  chroma `letta_memories`
- The Noticer drain (`noticer-inbox-drain.py`) handles writes only; the read
  path was to be wired here
