import { ContextStore } from './store-adapter.mjs';
import { makeFact } from './schema.mjs';
import { assertSafe } from './secret-gate.mjs';
import { resolveProjectId } from './config.mjs';

/**
 * 명시 기록(explicit_write) 경로의 유일한 공식 API.
 * 모든 기록은 중앙 비밀 게이트를 fail-closed로 경유한다.
 */
export async function recordFact({ statement, fact_type, scope, source_ref = 'explicit', store }) {
  assertSafe(statement, 'explicit_write');
  const fact = makeFact({ statement, fact_type, scope, source_ref });

  const connected = store ?? (await ContextStore.connect());
  try {
    return await connected.storeFact(fact);
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
