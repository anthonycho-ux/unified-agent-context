import { archiveConversation } from './archive.mjs';
import { ContextStore } from './store-adapter.mjs';
import { makeFact } from './schema.mjs';
import { assertSafe, SecretBlockedError } from './secret-gate.mjs';

const DECISION_MARKERS = /(결정|하기로|채택|전환|사용한다|decided|we will|adopt)/i;
const PREFERENCE_MARKERS = /(선호|항상|앞으로는|always|prefer)/i;
const MAX_CANDIDATES = 20;
const MIN_LENGTH = 20;

/**
 * 규칙 기반 v1 증류: transcript 텍스트에서 결정/선호 후보 문장을 추출한다.
 * LLM 기반 증류는 후속 단계에서 교체 가능(추출기만 갈아끼우면 됨).
 */
export function extractCandidates(text) {
  const seen = new Set();
  const candidates = [];

  for (const rawLine of String(text ?? '').split('\n')) {
    const line = rawLine.replace(/^[-*>\s\d.]+/, '').trim();
    if (line.length < MIN_LENGTH) continue;

    let factType = null;
    if (DECISION_MARKERS.test(line)) factType = 'decision';
    else if (PREFERENCE_MARKERS.test(line)) factType = 'preference';
    if (!factType) continue;

    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    candidates.push({ statement: line, fact_type: factType });
    if (candidates.length >= MAX_CANDIDATES) break;
  }

  return candidates;
}

/**
 * 세션 종료 자동 증류(auto_distill):
 * 후보별 비밀 게이트(fail-closed: 비밀 후보는 저장하지 않음) → dedupe upsert 저장 →
 * 원본은 archive_ingest 경로로 콜드 아카이브(비밀 시 redact-only).
 */
export async function distillSession({ content, scope, sessionId, store }) {
  const candidates = extractCandidates(content);

  const connected = store ?? (await ContextStore.connect());
  let stored = 0;
  let skippedSecrets = 0;
  try {
    for (const candidate of candidates) {
      try {
        assertSafe(candidate.statement, 'auto_distill');
      } catch (error) {
        if (error instanceof SecretBlockedError) {
          skippedSecrets++;
          continue;
        }
        throw error;
      }
      await connected.storeFact(
        makeFact({ ...candidate, scope, source_ref: `session:${sessionId}` }),
      );
      stored++;
    }
  } finally {
    if (!store) await connected.close().catch(() => {});
  }

  const archiveResult = await archiveConversation({ scope, sessionId, content });

  return {
    stored,
    skipped_secrets: skippedSecrets,
    archived: true,
    redacted: archiveResult.redacted,
    archive_path: archiveResult.path,
  };
}
