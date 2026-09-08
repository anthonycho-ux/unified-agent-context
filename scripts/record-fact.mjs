#!/usr/bin/env node
// 명시 기록 CLI (explicit_write 경로).
// Usage: node scripts/record-fact.mjs --type decision|preference|project_state [--scope project:<id>|global] [--author <agent>] [--cwd <dir>] "<문장>"
import { recordFact } from '../src/recorder.mjs';
import { resolveProjectId } from '../src/config.mjs';
import { SecretBlockedError } from '../src/secret-gate.mjs';

function parseArgs(argv) {
  const args = { type: undefined, scope: undefined, author: undefined, cwd: process.cwd(), statement: undefined };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--type') args.type = argv[++i];
    else if (argv[i] === '--scope') args.scope = argv[++i];
    else if (argv[i] === '--author') args.author = argv[++i];
    else if (argv[i] === '--cwd') args.cwd = argv[++i];
    else rest.push(argv[i]);
  }
  args.statement = rest.join(' ').trim();
  return args;
}

const { type, scope, author, cwd, statement } = parseArgs(process.argv.slice(2));

if (!type || !statement) {
  process.stderr.write('usage: record-fact.mjs --type decision|preference|project_state [--scope <scope>] [--author <agent>] "<문장>"\n');
  process.exit(1);
}

const resolvedScope = scope ?? (type === 'preference' ? 'global' : `project:${resolveProjectId(cwd)}`);

try {
  const fact = await recordFact({ statement, fact_type: type, scope: resolvedScope, source_ref: 'cli:record-fact', author: author });
  if (fact.recorded === 'duplicate') {
    process.stdout.write(`DUPLICATE ${fact.dedupe_key} ${fact.scope} (기존 팩트 유지)\n`);
  } else if (fact.recorded === 'corrected') {
    process.stdout.write(`RECORDED ${fact.dedupe_key} ${fact.scope} superseded=${fact.superseded}\n`);
  } else {
    process.stdout.write(`RECORDED ${fact.dedupe_key} ${fact.scope}\n`);
  }
  process.exit(0);
} catch (error) {
  if (error instanceof SecretBlockedError) {
    process.stderr.write(`[uac-record] BLOCKED: ${error.patterns.join(',')}\n`);
    process.exit(3);
  }
  process.stderr.write(`[uac-record] ERROR: ${error?.message ?? error}\n`);
  if (Array.isArray(error?.issues)) {
    for (const issue of error.issues) {
      process.stderr.write(`  - ${issue.path}: ${issue.message}\n`);
    }
  }
  process.exit(1);
}
