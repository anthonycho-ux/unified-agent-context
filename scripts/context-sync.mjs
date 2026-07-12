#!/usr/bin/env node
// Bidirectional reconcile between the local mcp-memory-keeper and the canonical
// store-host store. One pass = pull store-host->local and push local->store-host so the local store
// becomes a full replica (every MCP-native reader sees cross-machine facts).
//
// Contract (see the approved plan Interface Contracts):
//   - reconcile({ localStore, sovStore, now }) is a PURE orchestration: it never
//     calls process.exit; the CLI wrapper owns exit codes and always exits 0.
//   - Writes are strict-newer-only (diffForReconcile); equal-time is a no-op, so
//     repeated runs converge with no oscillation.
//   - Only fact categories (decision/preference/project_state) are propagated;
//     poison/mismatched/secret rows are warned-and-skipped without stalling.
//   - Replication uses saveFactValidated({ queueLibrarian: false }) so it never
//     re-publishes to the librarian.
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { ContextStore } from '../src/store-adapter.mjs';
import { localSpec, sovSpecs } from '../src/config.mjs';
import { diffForReconcile } from '../src/merge.mjs';
import { validateFact, dedupeKey } from '../src/schema.mjs';
import { assertSafe } from '../src/secret-gate.mjs';

const FACT_CATEGORIES = new Set(['decision', 'preference', 'project_state']);

/**
 * Validate one raw store row before it is allowed to replicate.
 * @returns {{ fact: object } | { skip: true } | null}
 *   - `{ fact }`   — a valid fact ready to reconcile.
 *   - `{ skip: true }` — a fact-category row that failed integrity/secret checks
 *                        (counted as skipped; never propagated).
 *   - `null`       — a non-fact row (intentional filter; not counted).
 */
export function validateRawRow(row, scope) {
  if (!row || !FACT_CATEGORIES.has(row.category)) {
    return null; // not a UAC fact row — silently filtered, not a skip.
  }

  let fact;
  try {
    fact = JSON.parse(row.value);
  } catch {
    console.warn(`[context-sync] skip: unparseable value for key ${row.key} in ${scope}`);
    return { skip: true };
  }

  const recomputed = dedupeKey(fact.statement, fact.scope);
  if (
    fact.scope !== scope ||
    row.key !== recomputed ||
    fact.dedupe_key !== recomputed ||
    row.category !== fact.fact_type
  ) {
    console.warn(`[context-sync] skip: identity mismatch for key ${row.key} in ${scope}`);
    return { skip: true };
  }

  try {
    assertSafe(fact.statement, 'distilled_fact');
    return { fact: validateFact(fact) };
  } catch (error) {
    console.warn(`[context-sync] skip: ${error.message} for key ${row.key} in ${scope}`);
    return { skip: true };
  }
}

async function collectFacts(store, scope) {
  const facts = [];
  let skipped = 0;
  for (const row of await store.getRawItemsPaged({ scope })) {
    const result = validateRawRow(row, scope);
    if (result?.fact) {
      facts.push(result.fact);
    } else if (result?.skip) {
      skipped += 1;
    }
  }
  return { facts, skipped };
}

/**
 * Bidirectional reconcile. Pure orchestration — no process.exit, no CLI concerns.
 * @returns {Promise<{pushed:number,pulled:number,skipped:number,failed:number,scopes:string[]}>}
 */
export async function reconcile({ localStore, sovStore, now = () => new Date() } = {}) {
  void now; // reserved for future cursor/staleness logic; kept in the contract.

  const scopeSet = new Set(['global']);
  for (const channel of await localStore.getChannels()) {
    if (typeof channel === 'string' && channel) scopeSet.add(channel);
  }
  for (const channel of await sovStore.getChannels()) {
    if (typeof channel === 'string' && channel) scopeSet.add(channel);
  }
  const scopes = [...scopeSet];

  let pushed = 0;
  let pulled = 0;
  let skipped = 0;
  let failed = 0;

  for (const scope of scopes) {
    const local = await collectFacts(localStore, scope);
    const store-host = await collectFacts(sovStore, scope);
    skipped += local.skipped + store-host.skipped;

    const { toSov, toLocal } = diffForReconcile(local.facts, store-host.facts);

    for (const fact of toSov) {
      try {
        await sovStore.saveFactValidated(fact, { queueLibrarian: false });
        pushed += 1;
      } catch (error) {
        failed += 1;
        console.warn(`[context-sync] push failed for ${fact.dedupe_key} (${scope}): ${error.message}`);
      }
    }

    for (const fact of toLocal) {
      try {
        await localStore.saveFactValidated(fact, { queueLibrarian: false });
        pulled += 1;
      } catch (error) {
        failed += 1;
        console.warn(`[context-sync] pull failed for ${fact.dedupe_key} (${scope}): ${error.message}`);
      }
    }
  }

  return { pushed, pulled, skipped, failed, scopes };
}

async function connectSov() {
  const specs = sovSpecs();
  for (const spec of specs) {
    try {
      return await ContextStore.connect(spec);
    } catch {
      // try the next candidate host (store-host-ts -> store-host)
    }
  }
  return null;
}

async function main() {
  let localStore = null;
  let sovStore = null;
  try {
    localStore = await ContextStore.connect(localSpec());
    sovStore = await connectSov();
    if (!sovStore) {
      console.warn('[context-sync] no store-host host reachable; skipping this cycle (will retry).');
      return;
    }
    const report = await reconcile({ localStore, sovStore });
    console.log(
      `[context-sync] pushed=${report.pushed} pulled=${report.pulled} ` +
        `skipped=${report.skipped} failed=${report.failed} scopes=${report.scopes.length}`,
    );
  } catch (error) {
    console.warn(`[context-sync] cycle degraded: ${error?.message ?? error}`);
  } finally {
    await localStore?.close().catch(() => {});
    await sovStore?.close().catch(() => {});
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  // Degrade-safe: a scheduled cycle must never crash the machine's launchd job.
  await main();
  process.exit(0);
}
