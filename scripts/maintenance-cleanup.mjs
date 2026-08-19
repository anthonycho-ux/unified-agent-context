#!/usr/bin/env node
// UAC 주간 정리 (cleanup). fitness-check가 읽기 전용 계량기라면, 이것은 승인된 항목만
// 실제로 지우는 청소기다. 기본은 dry-run(개수만 보고)이며, --apply가 있어야만 삭제한다.
//
// 현재 정리 대상:
//   - feature_flag_evaluations: N일(기본 7일) 지난 평가 로그.
//     서버가 매 도구 호출마다 'debug_logging' (항상 꺼진 플래그) 평가를 한 줄씩 쌓는 것으로,
//     내용이 전부 동일해 보관 가치가 없다. 감사 로그(feature_flag_audit)는 건드리지 않는다.
//
// Usage:
//   node scripts/maintenance-cleanup.mjs [--data-dir <dir>] [--days <n>] [--apply]
//
// exit 0 = 정상 (dry-run 포함). exit 1 = DB를 열 수 없음.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = {
    dataDir: process.env.UAC_FITNESS_DATA_DIR ?? process.env.UAC_DATA_DIR ?? path.join(repoRoot, 'data', 'memory'),
    days: 7,
    apply: false,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--data-dir') args.dataDir = argv[++i];
    else if (argv[i] === '--days') args.days = Number(argv[++i]);
    else if (argv[i] === '--apply') args.apply = true;
    else {
      process.stderr.write(`unknown arg: ${argv[i]}\n`);
      process.exit(2);
    }
  }
  if (!Number.isFinite(args.days) || args.days < 1) {
    process.stderr.write('--days는 1 이상의 숫자여야 한다\n');
    process.exit(2);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const dbPath = path.join(args.dataDir, 'context.db');
const lines = [];
const say = (s = '') => lines.push(s);

say(`# UAC cleanup — ${new Date().toISOString()}`);
say(`대상: ${dbPath} (${args.apply ? 'APPLY: 실제 삭제' : 'dry-run: 개수만 보고'})`);
say();

let db = null;
try {
  if (!fs.existsSync(dbPath)) {
    throw new Error('파일이 없음');
  }
  db = new DatabaseSync(dbPath);
} catch (error) {
  say(`## 치명적 실패`);
  say(`- DB를 열 수 없음: ${error.message}`);
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(1);
}

// evaluated_at은 'YYYY-MM-DD HH:MM:SS'(UTC) 형식. sqlite datetime 함수와 그대로 비교 가능하다.
const cutoff = new Date(Date.now() - args.days * 86400000)
  .toISOString()
  .slice(0, 19)
  .replace('T', ' ');

try {
  const total = db.prepare('SELECT COUNT(*) AS n FROM feature_flag_evaluations').get().n;
  const stale = db
    .prepare('SELECT COUNT(*) AS n FROM feature_flag_evaluations WHERE evaluated_at < ?')
    .get(cutoff).n;
  say(`## feature_flag_evaluations`);
  say(`- 전체: ${total.toLocaleString()}행 / ${args.days}일 이상 경과: ${stale.toLocaleString()}행 (기준 ${cutoff} UTC)`);
  if (stale > 0 && args.apply) {
    const result = db
      .prepare('DELETE FROM feature_flag_evaluations WHERE evaluated_at < ?')
      .run(cutoff);
    say(`- 삭제 완료: ${result.changes.toLocaleString()}행`);
  } else if (stale > 0) {
    say(`- dry-run이라 삭제하지 않음. 실행하려면 --apply.`);
  } else {
    say(`- 정리 대상 없음.`);
  }
} catch (error) {
  say(`## feature_flag_evaluations`);
  say(`- 측정 불가 (${error.message})`);
}

db.close();
process.stdout.write(lines.join('\n') + '\n');
process.exit(0);
