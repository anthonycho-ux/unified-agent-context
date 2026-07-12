function updatedAtMs(fact) {
  try {
    const timestamp = Date.parse(fact?.updated_at);
    return Number.isFinite(timestamp) ? timestamp : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

function hasEqualUpdatedAt(first, second) {
  const firstTimestamp = updatedAtMs(first);
  const secondTimestamp = updatedAtMs(second);
  return Number.isFinite(firstTimestamp) && firstTimestamp === secondTimestamp;
}

function collapseFacts(facts) {
  const collapsed = new Map();

  for (const fact of facts ?? []) {
    const key = scopeKey(fact);
    const existing = collapsed.get(key);
    if (!existing || isStrictlyNewer(fact, existing)) {
      collapsed.set(key, fact);
    }
  }

  return collapsed;
}

export function scopeKey(fact) {
  return `${fact.scope}\u0000${fact.dedupe_key}`;
}

export function isStrictlyNewer(incoming, existing) {
  const incomingTimestamp = updatedAtMs(incoming);
  const existingTimestamp = updatedAtMs(existing);
  return Number.isFinite(incomingTimestamp)
    && Number.isFinite(existingTimestamp)
    && incomingTimestamp > existingTimestamp;
}

export function unionFacts(localFacts, sovFacts) {
  const localByScopeKey = collapseFacts(localFacts);
  const sovByScopeKey = collapseFacts(sovFacts);
  const union = new Map(localByScopeKey);

  for (const [key, sovFact] of sovByScopeKey) {
    const localFact = union.get(key);
    if (!localFact || isStrictlyNewer(sovFact, localFact) || hasEqualUpdatedAt(sovFact, localFact)) {
      union.set(key, sovFact);
    }
  }

  return [...union.values()];
}

export function diffForReconcile(localFacts, sovFacts) {
  const localByScopeKey = collapseFacts(localFacts);
  const sovByScopeKey = collapseFacts(sovFacts);
  const toSov = [];
  const toLocal = [];

  for (const [key, localFact] of localByScopeKey) {
    const sovFact = sovByScopeKey.get(key);
    if (!sovFact || isStrictlyNewer(localFact, sovFact)) {
      toSov.push(localFact);
    }
  }

  for (const [key, sovFact] of sovByScopeKey) {
    const localFact = localByScopeKey.get(key);
    if (!localFact || isStrictlyNewer(sovFact, localFact)) {
      toLocal.push(sovFact);
    }
  }

  return { toSov, toLocal };
}
