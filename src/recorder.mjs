import { ContextStore } from './store-adapter.mjs';
import { makeFact } from './schema.mjs';
import { assertSafe } from './secret-gate.mjs';
import { resolveProjectId } from './config.mjs';
import { verdict } from './near-dup.mjs';

/**
 * 명시 기록(explicit_write) 경로의 유일한 공식 API.
 * 모든 기록은 중앙 비밀 게이트를 fail-closed로 경유한다.
 */
export async function recordFact({ statement, fact_type, scope, source_ref = 'explicit', author, store }) {
  assertSafe(statement, 'explicit_write');
  const fact = makeFact({ statement, fact_type, scope, source_ref, author });

  const connected = store ?? (await ContextStore.connect());
  try {
    // near-dup gate (v2.1): 같은 fact_type + scope의 기존 팩트와 비교해
    // duplicate / correction / new를 분류한다. 목록 조회 실패 시 평시 기록으로
    // 성능 저하한다. 기록을 막지 않는다.
    let supersededTarget = null;
    try {
      const existing = (await connected.getFacts({ scope: fact.scope }))
        .filter((f) => f.fact_type === fact.fact_type && !f.superseded_by);
      const outcome = verdict(fact.statement, existing.map((f) => f.statement));
      if (outcome.kind === 'duplicate' && existing[outcome.index]) {
        return { ...existing[outcome.index], recorded: 'duplicate' };
      }
      if (outcome.kind === 'correction' && existing[outcome.index]) {
        supersededTarget = existing[outcome.index];
      }
    } catch (nearDupError) {
      // near-dup 분류 실패는 기록 경로를 막지 않지만 (fail-open), 소리 내어 알린다
      // — 침묵하면 중복이 조용히 쌓인다 (cmd 리뷰 2026-09-07)
      console.warn(`[uac-record] near-dup 분류 실패, 평시 기록으로 진행: ${nearDupError?.message ?? nearDupError}`);
    }

    const saved = await connected.storeFact(fact);

    // correction이면 이전 팩트에 tombstone pointer를 남긴다 (lineage 유지,
    // librarian 큐잉은 생략 — tombstone은 신규 지식이 아니므로).
    if (supersededTarget) {
      try {
        await connected.saveFactValidated({
          ...supersededTarget,
          superseded_by: saved.dedupe_key,
          updated_at: new Date().toISOString(),
        }, { queueLibrarian: false });
      } catch {
        // tombstone 실패가 기록 자체를 실패시키지 않는다
      }
      return { ...saved, recorded: 'corrected', superseded: supersededTarget.dedupe_key };
    }

    return { ...saved, recorded: 'new' };
  } finally {
    if (!store) await connected.close().catch(() => {});
  }
}

export async function recordDecision(statement, { scope, cwd = process.cwd(), source_ref, store } = {}) {
  const resolvedScope = scope ?? `project:${resolveProjectId(cwd)}`;
  return recordFact({ statement, fact_type: 'decision', scope: resolvedScope, source_ref, store });
}

export async function recordPreference(statement, { scope = 'global', source_ref, store } = {}) {
  return recordFact({ statement, fact_type: 'preference', scope, source_ref, store });
}
