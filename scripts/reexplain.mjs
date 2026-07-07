#!/usr/bin/env node
// 재설명 발생 횟수 계측 (2주 실사용 관문의 정량 보조지표).
// Usage:
//   node scripts/reexplain.mjs log "<무엇을 재설명했나>" [--agent <이름>]
//   node scripts/reexplain.mjs report
import fs from 'node:fs/promises';
import path from 'node:path';

const REPO = path.resolve(new URL('..', import.meta.url).pathname);
const FILE = process.env.UAC_REEXPLAIN_PATH ?? path.join(REPO, 'data/metrics/reexplain.jsonl');

const [mode, ...rest] = process.argv.slice(2);

if (mode === 'log') {
  const agentIdx = rest.indexOf('--agent');
  const agent = agentIdx >= 0 ? rest.splice(agentIdx, 2)[1] : 'unknown';
  const what = rest.join(' ').trim();
  if (!what) {
    process.stderr.write('usage: reexplain.mjs log "<무엇을 재설명했나>" [--agent <이름>]\n');
    process.exit(1);
  }
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.appendFile(FILE, `${JSON.stringify({ ts: new Date().toISOString(), agent, what })}\n`, 'utf8');
  process.stdout.write('LOGGED\n');
} else if (mode === 'report') {
  let lines = [];
  try {
    lines = (await fs.readFile(FILE, 'utf8')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    // no data yet
  }
  if (lines.length === 0) {
    process.stdout.write('재설명 기록 0건 — 2주 관문 목표 상태.\n');
    process.exit(0);
  }
  const byWeek = new Map();
  for (const e of lines) {
    const d = new Date(e.ts);
    const onejan = new Date(d.getFullYear(), 0, 1);
    const week = `${d.getFullYear()}-W${String(Math.ceil(((d - onejan) / 86400000 + onejan.getDay() + 1) / 7)).padStart(2, '0')}`;
    byWeek.set(week, (byWeek.get(week) ?? 0) + 1);
  }
  process.stdout.write(`총 ${lines.length}건\n`);
  for (const [week, count] of [...byWeek.entries()].sort()) {
    process.stdout.write(`${week}: ${count}건\n`);
  }
} else {
  process.stderr.write('usage: reexplain.mjs log|report\n');
  process.exit(1);
}
