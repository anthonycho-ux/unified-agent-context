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
//   - Local→store-host normalization (Option A): local rows that intend to be facts
//     (fact category, or a value declaring a valid fact_type) are canonicalized
//     into first-class facts (recomputed dedupe_key, filled timestamps/source_ref,
//     schema-default retention) before push. Sov stays strict. Rows with no fact
//     intent are filtered; unnormalizable/secret rows are warned-and-skipped.
//   - Replication uses saveFactValidated({ queueLibrarian: false }) so it never
//     re-publishes to the librarian.
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { ContextStore } from '../src/store-adapter.mjs';
import { localSpec, sovSpecs } from '../src/config.mjs';
import { diffForReconcile } from '../src/merge.mjs';
import { validateFact, makeFact, dedupeKey } from '../src/schema.mjs';
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

/**
 * Convert a value/row timestamp (ISO or SQLite "YYYY-MM-DD HH:MM:SS") to a
 * canonical ISO string that schema.isIsoDate round-trips, or null if unusable.
 */
function toIsoTimestamp(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const candidate = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const ms = Date.parse(candidate);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Option A — local→store-host normalization. A local raw row that *intends* to be a
 * fact is canonicalized into a first-class UAC fact instead of being dropped.
 *
 * Fact intent (per the approved brief) is:
 *   - a fact-category row (category ∈ {decision, preference, project_state}), OR
 *   - any value that declares a valid `fact_type`.
 * The statement is taken from `value.statement` for a fact-shaped object, or —
 * for a fact-category row whose value is plain text (not a JSON object) — from
 * the raw value itself (this is how agents saved decisions via `context_save`
 * with a bare string). Normalization then:
 *   - recomputes `dedupe_key = sha256(statement+scope)[:16]` (key === dedupe_key);
 *   - fills `created_at`/`updated_at` from the value or the store's stable row
 *     metadata (deterministic → idempotent, never the wall clock);
 *   - stamps `source_ref = normalized:context_save`;
 *   - applies schema-default `retention_class` (RETENTION_BY_FACT_TYPE) and
 *     `sensitivity_class` (honoring an explicit `sensitive`).
 *
 * The integrity gate stays fail-closed: rows with no fact intent are filtered
 * (null, not counted); fact-intent rows that cannot form a valid fact — empty /
 * missing statement, structured-but-not-a-fact value, no stable timestamp, or
 * secret-bearing statement — are skipped (counted, never propagated).
 *
 * @returns {{ fact: object } | { skip: true } | null}
 */
export function normalizeRawRow(row, scope) {
  if (!row) return null;

  const isFactCategory = FACT_CATEGORIES.has(row.category);

  // Parse the value once. A plain-object value is treated as a (partial) fact;
  // an unparseable value is genuine plain text.
  let parsedObj = null;
  let parseFailed = false;
  try {
    const parsed = JSON.parse(row.value);
    if (isPlainObject(parsed)) parsedObj = parsed;
  } catch {
    parseFailed = true;
  }

  // Category is authoritative when it is itself a fact category; otherwise a
  // valid `fact_type` declared inside an object value carries the intent (e.g. a
  // note-category row whose payload explicitly declares fact_type:'decision').
  const declaredType = parsedObj && FACT_CATEGORIES.has(parsedObj.fact_type) ? parsedObj.fact_type : null;
  const factType = isFactCategory ? row.category : declaredType;
  if (!factType) {
    return null; // task/progress/note/error/warning/... — intentional filter, not a skip.
  }

  // Resolve the canonical statement.
  let statement;
  if (parsedObj) {
    statement = parsedObj.statement; // structured fact object
  } else if (isFactCategory && parseFailed && typeof row.value === 'string') {
    statement = row.value; // plain-text fact-category row (raw string is the statement)
  }
  if (typeof statement !== 'string' || statement.trim() === '') {
    return { skip: true }; // fact intent but no usable statement — fail-closed.
  }

  const createdAt =
    (parsedObj && toIsoTimestamp(parsedObj.created_at)) ||
    toIsoTimestamp(row.created_at) ||
    toIsoTimestamp(row.updated_at);
  if (!createdAt) {
    // No stable timestamp anywhere → refuse rather than fabricate one with the
    // wall clock (which would re-push every pass and break idempotency).
    console.warn(`[context-sync] skip: no stable timestamp for key ${row.key} in ${scope}`);
    return { skip: true };
  }
  const updatedAt = (parsedObj && toIsoTimestamp(parsedObj.updated_at)) || toIsoTimestamp(row.updated_at) || createdAt;

  let fact;
  try {
    fact = makeFact({
      statement,
      fact_type: factType,
      scope,
      created_at: createdAt,
      updated_at: updatedAt,
      source_ref: 'normalized:context_save',
      sensitivity_class: parsedObj && parsedObj.sensitivity_class === 'sensitive' ? 'sensitive' : 'normal',
      // dedupe_key + retention_class deliberately omitted: makeFact recomputes
      // dedupe_key from statement+scope and applies RETENTION_BY_FACT_TYPE.
    });
  } catch (error) {
    console.warn(`[context-sync] skip: ${error.message} for key ${row.key} in ${scope}`);
    return { skip: true };
  }

  try {
    assertSafe(fact.statement, 'distilled_fact');
  } catch (error) {
    console.warn(`[context-sync] skip: ${error.message} for key ${row.key} in ${scope}`);
    return { skip: true };
  }

  return { fact };
}

async function collectFacts(store, scope, validate = validateRawRow) {
  const facts = [];
  let skipped = 0;
  for (const row of await store.getRawItemsPaged({ scope })) {
    const result = validate(row, scope);
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
    // Local→store-host is the only normalization direction: local fact-intent rows are
    // canonicalized on the way up. Sov (the canonical store) stays strict so a
    // malformed row there is never silently "healed" back into local.
    const local = await collectFacts(localStore, scope, normalizeRawRow);
    const store-host = await collectFacts(sovStore, scope, validateRawRow);
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
