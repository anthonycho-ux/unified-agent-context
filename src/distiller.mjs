import { archiveConversation } from './archive.mjs';
import { ContextStore } from './store-adapter.mjs';
import { makeFact } from './schema.mjs';
import { assertSafe, SecretBlockedError } from './secret-gate.mjs';
import { llmExtractCandidates } from './llm-extract.mjs';

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

// LLM 증류 사용 여부 (opt-in). 기본은 규칙 기반 extractCandidates.
// UAC_DISTILL_LLM=1|true|on|yes 이면 LLM 추출을 시도하고, 실패 시 규칙 기반으로 폴백한다.
function llmDistillEnabled() {
  const flag = String(process.env.UAC_DISTILL_LLM ?? '').toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'on' || flag === 'yes';
}

/**
 * 후보 추출기 해석: 인젝션된 extract 함수 > (opt-in) LLM 추출 > 규칙 기반 폴백.
 * 어떤 경우에도 배열을 반환한다 (LLM 실패는 null → 규칙 기반으로 폴백).
 */
async function resolveCandidates(content, extract) {
  if (typeof extract === 'function') {
    const injected = await extract(content);
    return Array.isArray(injected) ? injected : extractCandidates(content);
  }
  if (llmDistillEnabled()) {
    const viaLlm = await llmExtractCandidates(content);
    if (Array.isArray(viaLlm)) return viaLlm;
  }
  return extractCandidates(content);
}

/**
 * 세션 종료 자동 증류(auto_distill):
 * 후보 추출(규칙 기반 기본, UAC_DISTILL_LLM 시 LLM) →
 * 후보별 비밀 게이트(fail-closed: 비밀 후보는 저장하지 않음) → dedupe upsert 저장 →
 * 원본은 archive_ingest 경로로 콜드 아카이브(비밀 시 redact-only).
 * @param {Function} [extract] 선택적 추출기 오버라이드(content)=>[{statement,fact_type}] (동기/비동기).
 */
export async function distillSession({ content, scope, sessionId, store, extract }) {
  const candidates = await resolveCandidates(content, extract);

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
      // 자동 증류분은 proposed 후보로만 저장한다. 사용자 발화 근거로 승격되기 전까지 주입 제외.
      await connected.storeFact(
        makeFact({ ...candidate, scope, source_ref: `session:${sessionId}`, status: 'proposed' }),
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
