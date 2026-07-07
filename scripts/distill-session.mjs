#!/usr/bin/env node
// 세션 종료 자동 증류 CLI (auto_distill + archive_ingest + 검역 스윕).
// Usage: node scripts/distill-session.mjs [--file <transcript>] [--scope project:<id>|global] [--session-id <id>] [--cwd <dir>]
// transcript는 --file 또는 stdin으로 받는다.
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { distillSession } from '../src/distiller.mjs';
import { sweepQuarantine } from '../src/quarantine.mjs';
import { ContextStore } from '../src/store-adapter.mjs';
import { resolveProjectId } from '../src/config.mjs';

function parseArgs(argv) {
  const args = { file: undefined, scope: undefined, sessionId: undefined, cwd: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file') args.file = argv[++i];
    else if (argv[i] === '--scope') args.scope = argv[++i];
    else if (argv[i] === '--session-id') args.sessionId = argv[++i];
    else if (argv[i] === '--cwd') args.cwd = argv[++i];
  }
  return args;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const { file, scope, sessionId, cwd } = parseArgs(process.argv.slice(2));
const content = file ? await fs.readFile(file, 'utf8') : await readStdin();

if (!content.trim()) {
  process.stderr.write('[uac-distill] empty transcript — nothing to do\n');
  process.exit(0);
}

const resolvedScope = scope ?? `project:${resolveProjectId(cwd)}`;
const resolvedSession = sessionId ?? randomUUID();

const store = await ContextStore.connect();
try {
  const result = await distillSession({ content, scope: resolvedScope, sessionId: resolvedSession, store });
  const sweep = await sweepQuarantine({ scope: resolvedScope, store });
  process.stdout.write(
    `DISTILLED stored=${result.stored} skipped_secrets=${result.skipped_secrets} archived=1 redacted=${result.redacted} quarantined=${sweep.quarantined}\n`,
  );
  process.exit(0);
} catch (error) {
  process.stderr.write(`[uac-distill] ERROR: ${error?.message ?? error}\n`);
  process.exit(1);
} finally {
  await store.close().catch(() => {});
}
