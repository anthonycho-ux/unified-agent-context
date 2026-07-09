#!/usr/bin/env node
// outbox의 후보 팩트를 sov의 사서(Letta "The Noticer") reference/inbox로 배달한다.
// 실패해도 outbox는 보존된다 (degraded). --strict면 degraded 시 exit 1.
import { flushOutbox, LIBRARIAN_SPEC, LIBRARIAN_DIR } from '../src/librarian.mjs';

const strict = process.argv.includes('--strict');

const result = await flushOutbox();

if (result.degraded) {
  console.error(`[librarian-sync] degraded: ${result.reason} — outbox 보존됨 (${LIBRARIAN_DIR})`);
  process.exit(strict ? 1 : 0);
}

if (result.delivered === 0) {
  console.log('[librarian-sync] outbox empty — nothing to deliver');
} else {
  console.log(`[librarian-sync] delivered ${result.delivered} fact(s) → ${LIBRARIAN_SPEC.host}:${result.remotePath}`);
}
