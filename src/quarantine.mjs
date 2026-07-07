import { scanSecrets, redactSecrets } from './secret-gate.mjs';

/**
 * 검역 스윕: 에이전트가 raw MCP context_save로 게이트를 우회해 저장한 비밀을 사후 차단한다.
 * 해당 스코프(채널)의 row 중 DistilledFact JSON으로 파싱되지 않는 foreign row의 value에
 * 비밀이 발견되면 redact된 값으로 동일 key에 덮어쓴다.
 */
export async function sweepQuarantine({ scope, store }) {
  const items = await store.getRawItems({ scope });

  let scanned = 0;
  let quarantined = 0;

  for (const item of items) {
    scanned++;

    // DistilledFact 정식 row는 storeFact 시점에 이미 게이트를 통과했다.
    let isDistilledFact = false;
    try {
      const parsed = JSON.parse(item.value);
      isDistilledFact = typeof parsed === 'object' && parsed !== null && 'dedupe_key' in parsed && 'fact_type' in parsed;
    } catch {
      // foreign row (JSON 아님)
    }
    if (isDistilledFact) continue;

    const scan = scanSecrets(item.value);
    if (!scan.found) continue;

    await store.overwriteRaw({
      key: item.key,
      value: redactSecrets(item.value),
      scope,
      category: item.category ?? 'note',
    });
    quarantined++;
  }

  return { scanned, quarantined };
}
