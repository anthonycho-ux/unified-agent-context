#!/usr/bin/env node
// 주간 fitness 결과를 공유 메모리에 기록한다.
// 두 갈래로 쓴다:
//   1) maintenance:unified-memory 채널 — 주간 보고서 전체 아카이브 (MCP로 조회 가능).
//   2) project:unified-agent-context 스코프의 project_state 팩트 — 주입 경로는
//      global/project 스코프만 읽으므로, 표면화는 이 쪽을 통한다 (retention 90일).
//
// Usage:
//   node scripts/maintenance-note.mjs --report <fitness.md> [--cleanup <cleanup.md>]
//
// exit 0 = 기록 성공. exit 1 = 보고서 파일 없음 또는 스토어 연결 실패.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContextStore } from '../src/store-adapter.mjs';
import { recordFact } from '../src/recorder.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = { report: undefined, cleanup: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--report') args.report = argv[++i];
    else if (argv[i] === '--cleanup') args.cleanup = argv[++i];
    else {
      process.stderr.write(`unknown arg: ${argv[i]}\n`);
      process.exit(2);
    }
  }
  return args;
}

// fitness 보고서에서 판독 핵심만 뽑는다: 날짜, [주의] 라인, 헤드라인 숫자.
export function summarizeReport(markdown) {
  const lines = markdown.split('\n');
  const title = lines.find((l) => l.startsWith('# UAC fitness 보고서'))?.replace(/^# /, '') ?? 'UAC fitness 보고서';
  const warnings = lines.filter((l) => l.includes('[주의]')).map((l) => l.replace(/^-\s*/, '').trim());
  const dbLine = lines.find((l) => l.startsWith('- context.db:'))?.replace(/^-\s*/, '') ?? null;
  const orphanLine = lines.find((l) => l.startsWith('- 세션 없는 고아 항목:'))?.replace(/^-\s*/, '') ?? null;
  return { title, warnings, dbLine, orphanLine };
}

const args = parseArgs(process.argv.slice(2));
if (!args.report || !fs.existsSync(args.report)) {
  process.stderr.write(`보고서 파일이 없음: ${args.report}\n`);
  process.exit(1);
}

const report = fs.readFileSync(args.report, 'utf8');
const { title, warnings, dbLine, orphanLine } = summarizeReport(report);
const date = new Date().toISOString().slice(0, 10);

let cleanupNote = null;
if (args.cleanup && fs.existsSync(args.cleanup)) {
  const deleted = fs.readFileSync(args.cleanup, 'utf8').split('\n').find((l) => l.includes('삭제 완료'));
  cleanupNote = deleted ? deleted.replace(/^-\s*/, '') : null;
}

const status = warnings.length > 0 ? `주의 ${warnings.length}건` : '양호';
const summaryLines = [
  `## ${title}`,
  `판독: ${status}`,
  dbLine ? `- ${dbLine}` : null,
  orphanLine ? `- ${orphanLine}` : null,
  cleanupNote ? `- cleanup: ${cleanupNote}` : null,
  ...warnings.map((w) => `- ${w}`),
  `- 전체 보고서: ${args.report} (sov)`,
].filter(Boolean);
const summary = summaryLines.join('\n');

const store = await ContextStore.connect();
try {
  // 1) 아카이브 채널
  await store.callTool('context_save', {
    key: `weekly-fitness-${date}`,
    value: summary,
    category: 'note',
    priority: warnings.length > 0 ? 'high' : 'normal',
    channel: 'maintenance:unified-memory',
  });

  // 2) 주입 경로용 project_state 팩트 (한 줄 판독)
  const oneLine = `UAC 주간 fitness (${date}): ${status}. ${warnings.map((w) => w.split('(')[0].trim()).join(' / ') || '이상 징후 없음'}`;
  await recordFact({
    statement: oneLine,
    fact_type: 'project_state',
    scope: 'project:unified-agent-context',
    source_ref: 'cron:maintenance-weekly',
    store,
  });

  process.stdout.write(`RECORDED weekly-fitness-${date} (maintenance:unified-memory + project:unified-agent-context)\n`);
  process.exit(0);
} catch (error) {
  process.stderr.write(`[maintenance-note] ERROR: ${error?.message ?? error}\n`);
  process.exit(1);
} finally {
  await store.close().catch(() => {});
}
