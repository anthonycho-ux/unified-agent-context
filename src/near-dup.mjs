// Near-duplicate detection at record time (v2.1).
// dedupeKey is sha256 of exact statement text, so rephrased duplicates and
// corrections slipped through and accumulated. Similarity here uses an overlap
// coefficient (intersection / min set size) over a mixed tokenizer: Latin words
// stay whole, Hangul/CJK runs become character bigrams, because Korean endings
// (는, 다, 후/뒤) mutate freely and word-level Jaccard misses real rephrases.
// Thresholds are deliberately conservative: a false correction only costs a
// tombstone pointer, but a false duplicate silently drops a distinct fact.

export const DUPLICATE_THRESHOLD = 0.95;
export const CORRECTION_THRESHOLD = 0.72;

const HANGUL_RUN = /[\uAC00-\uD7A3]+/g;

function expandToken(token, out) {
  const runs = token.match(HANGUL_RUN);
  if (!runs) {
    out.add(token);
    return;
  }
  // CJK가 아닌 잔여 부분(숫자, 라틴)은 토큰으로 유지한다
  const rest = token.replace(HANGUL_RUN, ' ');
  for (const part of rest.split(/\s+/)) {
    if (part.length > 1) out.add(part);
  }
  for (const run of runs) {
    if (run.length === 1) {
      out.add(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i++) {
      out.add(run.slice(i, i + 2));
    }
  }
}

export function tokenize(statement) {
  if (typeof statement !== 'string') return new Set();
  const tokens = new Set();
  for (const raw of statement.toLowerCase().split(/\s+/)) {
    const token = raw.replace(/[^\p{L}\p{N}]/gu, '');
    if (token.length <= 1) continue;
    expandToken(token, tokens);
  }
  return tokens;
}

export function similarity(a, b) {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }
  return intersection / Math.min(tokensA.size, tokensB.size);
}

/**
 * Classify a new statement against existing statements (same fact_type + scope).
 * Returns { kind: 'duplicate'|'correction'|'new', similarity, index } where
 * index points at the closest existing statement (-1 when none).
 */
export function verdict(newStatement, existingStatements) {
  let best = { similarity: 0, index: -1 };
  (existingStatements ?? []).forEach((statement, index) => {
    const sim = similarity(newStatement, statement);
    if (sim > best.similarity) best = { similarity: sim, index };
  });
  if (best.similarity >= DUPLICATE_THRESHOLD) return { kind: 'duplicate', ...best };
  if (best.similarity >= CORRECTION_THRESHOLD) return { kind: 'correction', ...best };
  return { kind: 'new', ...best };
}
