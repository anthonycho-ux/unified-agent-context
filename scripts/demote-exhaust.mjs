#!/usr/bin/env node
// 대청소: 자동 증류로 저장된 사실(source_ref가 session:*)을 proposed로 강등한다.
// 명시 기록(explicit 등)은 건드리지 않는다. 삭제 없음 — 강등만 하므로 복구 가능.
// Usage: node scripts/demote-exhaust.mjs [--apply] [--source store-host|local|both]
// 기본은 dry-run(판정 결과만 출력). --apply를 줘야 실제로 쓴다.
import process from 'node:process';

import { ContextStore } from '../src/store-adapter.mjs';
import { localSpec } from '../src/config.mjs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const sourceArg = args.includes('--source') ? args[args.indexOf('--source') + 1] : 'both';

function isAutoDistilled(fact) {
  return typeof fact.source_ref === 'string' && fact.source_ref.startsWith('session:');
}

async function sweep(label, connectFn) {
  let store;
  try {
    store = await connectFn();
  } catch (error) {
    console.error(`[${label}] 연결 실패, 건너뜀: ${error?.message ?? error}`);
    return null;
  }

  const stats = { label, total: 0, alreadyProposed: 0, demoted: 0, keptExplicit: 0, foreign: 0 };
  try {
    const items = await store.getRawItemsPaged();
    for (const item of items) {
      stats.total++;
      let fact;
      try {
        fact = JSON.parse(item.value);
      } catch {
        stats.foreign++;
        continue;
      }
      if (!fact || typeof fact !== 'object' || !('dedupe_key' in fact) || !('fact_type' in fact)) {
        stats.foreign++;
        continue;
      }
      if (!isAutoDistilled(fact)) {
        stats.keptExplicit++;
        continue;
      }
      if (fact.status === 'proposed') {
        stats.alreadyProposed++;
        continue;
      }
      stats.demoted++;
      if (APPLY) {
        await store.overwriteRaw({
          key: item.key,
          value: JSON.stringify({ ...fact, status: 'proposed', updated_at: new Date().toISOString() }),
          scope: item.channel,
          category: item.category,
        });
      } else if (stats.demoted <= 10) {
        console.log(`  [강등 예정] (${item.channel}) ${String(fact.statement).slice(0, 80)}`);
      }
    }
  } finally {
    await store.close().catch(() => {});
  }
  return stats;
}

const jobs = [];
if (sourceArg === 'store-host' || sourceArg === 'both') {
  jobs.push(['store-host', () => ContextStore.connect()]);
}
if (sourceArg === 'local' || sourceArg === 'both') {
  jobs.push(['local', () => ContextStore.connect(localSpec())]);
}

const results = [];
for (const [label, fn] of jobs) {
  console.log(`--- ${label} ${APPLY ? '(APPLY)' : '(dry-run)'} ---`);
  const stats = await sweep(label, fn);
  if (stats) {
    results.push(stats);
    console.log(
      `  전체 ${stats.total} | 명시 유지 ${stats.keptExplicit} | 강등 ${APPLY ? '완료' : '대상'} ${stats.demoted} | 기강등 ${stats.alreadyProposed} | 비팩트 ${stats.foreign}`,
    );
  }
}

if (results.length === 0) {
  console.error('접근 가능한 스토어가 없습니다.');
  process.exit(1);
}
