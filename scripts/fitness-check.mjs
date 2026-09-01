#!/usr/bin/env node
// UAC 공유 메모리 주간 점검 (fitness check).
// 정본 스토어(context.db)를 읽기 전용으로 열어 상태 보고서를 만든다.
// DB에는 절대 쓰지 않는다. 유일한 쓰기는 성장 추이 기록용 히스토리 파일뿐이며
// --dry-run이면 그것도 생략한다.
//
// Usage:
//   node scripts/fitness-check.mjs [--data-dir <dir>] [--history-file <path>]
//                                  [--stale-days <n>] [--stray-db <path>]... [--dry-run]
//
// exit 0 = 보고서 생성 성공 (주의 항목이 있어도 0). exit 1 = DB를 열 수 없어 보고 불가.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = {
    dataDir: process.env.UAC_FITNESS_DATA_DIR ?? process.env.UAC_DATA_DIR ?? path.join(repoRoot, 'data', 'memory'),
    historyFile: undefined,
    staleDays: 30,
    strayDbs: [],
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--data-dir') args.dataDir = argv[++i];
    else if (argv[i] === '--history-file') args.historyFile = argv[++i];
    else if (argv[i] === '--stale-days') args.staleDays = Number(argv[++i]);
    else if (argv[i] === '--stray-db') args.strayDbs.push(argv[++i]);
    else if (argv[i] === '--dry-run') args.dryRun = true;
    else {
      process.stderr.write(`unknown arg: ${argv[i]}\n`);
      process.exit(2);
    }
  }
  if (!Number.isFinite(args.staleDays) || args.staleDays < 1) {
    process.stderr.write('--stale-days는 1 이상의 숫자여야 한다\n');
    process.exit(2);
  }
  args.historyFile ??= path.join(path.dirname(args.dataDir), 'maintenance', 'fitness-history.jsonl');
  if (args.strayDbs.length === 0) {
    // 알려진 좌표 후보: 예전 설치 잔재가 발견된 위치들.
    args.strayDbs = [
      '/home/dev/mcp-data/memory-keeper/context.db',
      path.join(os.homedir(), 'mcp-data/memory-keeper/context.db'),
    ].filter((p, i, a) => a.indexOf(p) === i);
  }
  return args;
}

// 'YYYY-MM-DD HH:MM:SS'(UTC)와 ISO 8601이 섞여 있으므로 둘 다 ms로 정규화한다.
function toMs(ts) {
  if (typeof ts !== 'string' || ts.trim() === '') return null;
  const normalized = ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z';
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

function fmtBytes(n) {
  if (n == null) return '측정 불가';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(2)} MB`;
}

function fmtAge(ms) {
  if (ms == null) return '측정 불가';
  const days = (Date.now() - ms) / 86400000;
  if (days < 1) return `${Math.max(0, Math.round(days * 24))}시간 전`;
  return `${days.toFixed(1)}일 전`;
}

function statOrNull(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

const args = parseArgs(process.argv.slice(2));
const dbPath = path.join(args.dataDir, 'context.db');
const lines = [];
const say = (s = '') => lines.push(s);

say(`# UAC fitness 보고서 — ${new Date().toISOString()}`);
say(`대상: ${dbPath}${args.dryRun ? ' (dry-run: 히스토리 기록 생략)' : ''}`);
say();

// --- 0. DB 열기 (읽기 전용) ---
let db = null;
try {
  db = new DatabaseSync(dbPath, { readOnly: true });
} catch (error) {
  say(`## 치명적 실패`);
  say(`- DB를 열 수 없음: ${error.message}`);
  say(`- 중단 규칙에 따라 추측으로 우회하지 않고 여기서 멈춘다.`);
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(1);
}

// --- 1. 파일 크기 / WAL 상태 ---
const dbStat = statOrNull(dbPath);
const walStat = statOrNull(dbPath + '-wal');
const shmStat = statOrNull(dbPath + '-shm');
let journalMode = '측정 불가';
try {
  journalMode = db.prepare('PRAGMA journal_mode').get()?.journal_mode ?? '측정 불가';
} catch { /* 읽기 전용에서도 pragma는 가능해야 하지만, 안 되면 표기만 */ }

say(`## 1. 크기 / WAL`);
say(`- context.db: ${fmtBytes(dbStat?.size)} (수정: ${dbStat ? fmtAge(dbStat.mtimeMs) : '측정 불가'})`);
say(`- journal_mode: ${journalMode}`);
say(`- WAL 파일: ${walStat ? fmtBytes(walStat.size) : '없음'} / SHM 파일: ${shmStat ? fmtBytes(shmStat.size) : '없음'}`);
if (walStat && walStat.size > 32 * 1024 * 1024) {
  say(`- [주의] WAL이 32MB를 넘음. 체크포인트가 밀려 있을 수 있음.`);
}
say();

// --- 2. 테이블 규모 (행 수 상위 10) ---
say(`## 2. 테이블 규모 (상위 10)`);
const tableCounts = [];
try {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  for (const { name } of tables) {
    const n = db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n;
    tableCounts.push([name, n]);
  }
  tableCounts.sort((a, b) => b[1] - a[1]);
  for (const [name, n] of tableCounts.slice(0, 10)) {
    say(`- ${name}: ${n.toLocaleString()}행`);
  }
} catch (error) {
  say(`- 측정 불가 (${error.message})`);
}
say();

// --- 3. 채널 활동 ---
say(`## 3. 채널 활동 (비활성 기준: ${args.staleDays}일)`);
try {
  const channels = db
    .prepare('SELECT channel, COUNT(*) AS n, MAX(updated_at) AS latest FROM context_items GROUP BY channel ORDER BY n DESC')
    .all();
  if (channels.length === 0) {
    say(`- 채널 없음 (context_items가 비어 있음)`);
  }
  const staleMs = args.staleDays * 86400000;
  for (const { channel, n, latest } of channels) {
    const latestMs = toMs(latest);
    const stale = latestMs != null && Date.now() - latestMs > staleMs;
    const label = latestMs == null ? '측정 불가' : fmtAge(latestMs);
    say(`- ${stale ? '[주의] ' : ''}${channel ?? '(null)'}: ${n}항목, 최근 활동 ${label}${stale ? ' — 비활성' : ''}`);
  }
} catch (error) {
  say(`- 측정 불가 (${error.message})`);
}
say();

// --- 4. 세션 고아 여부 ---
say(`## 4. 세션`);
try {
  const sessions = db
    .prepare('SELECT s.id, s.name, s.updated_at, (SELECT COUNT(*) FROM context_items i WHERE i.session_id = s.id) AS item_count FROM sessions s')
    .all();
  const orphanItems = db
    .prepare('SELECT COUNT(*) AS n FROM context_items WHERE session_id NOT IN (SELECT id FROM sessions)')
    .get().n;
  for (const s of sessions) {
    const orphan = s.item_count === 0;
    say(`- ${orphan ? '[주의] ' : ''}${s.name ?? s.id}: 항목 ${s.item_count}개, 최근 갱신 ${fmtAge(toMs(s.updated_at))}${orphan ? ' — 고아 세션' : ''}`);
  }
  say(`- 세션 없는 고아 항목: ${orphanItems}개${orphanItems > 0 ? ' [주의]' : ''}`);
} catch (error) {
  say(`- 측정 불가 (${error.message})`);
}
say();

// --- 5. 성장 추이 (히스토리 파일과 비교) ---
say(`## 5. 성장 추이`);
const snapshot = {
  ts: new Date().toISOString(),
  dbBytes: dbStat?.size ?? null,
  walBytes: walStat?.size ?? null,
  items: tableCounts.find(([n]) => n === 'context_items')?.[1] ?? null,
  changes: tableCounts.find(([n]) => n === 'context_changes')?.[1] ?? null,
};
let previous = null;
try {
  const raw = fs.readFileSync(args.historyFile, 'utf8').trim();
  const entries = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  previous = entries.at(-1) ?? null;
} catch { /* 첫 실행이면 파일이 없다 */ }

if (!previous) {
  say(`- 측정 불가 (기준선 없음. ${args.dryRun ? 'dry-run이라 기록도 생략' : '이번 실행이 기준선으로 기록됨'})`);
} else {
  const days = (Date.parse(snapshot.ts) - Date.parse(previous.ts)) / 86400000;
  if (!Number.isFinite(days) || days <= 0) {
    say(`- 측정 불가 (기준선 시각이 비정상: ${previous.ts})`);
  } else {
    const dbDelta = snapshot.dbBytes != null && previous.dbBytes != null ? snapshot.dbBytes - previous.dbBytes : null;
    const itemDelta = snapshot.items != null && previous.items != null ? snapshot.items - previous.items : null;
    say(`- 기준선: ${previous.ts} (${days.toFixed(1)}일 전)`);
    say(`- DB 크기: ${dbDelta == null ? '측정 불가' : `${dbDelta >= 0 ? '+' : ''}${fmtBytes(Math.abs(dbDelta))} (${fmtBytes(Math.abs(dbDelta) / days)}/일)`}`);
    say(`- context_items: ${itemDelta == null ? '측정 불가' : `${itemDelta >= 0 ? '+' : ''}${itemDelta}개 (${(itemDelta / days).toFixed(1)}개/일)`}`);
  }
}
if (!args.dryRun) {
  try {
    fs.mkdirSync(path.dirname(args.historyFile), { recursive: true });
    fs.appendFileSync(args.historyFile, JSON.stringify(snapshot) + '\n');
  } catch (error) {
    say(`- [주의] 히스토리 기록 실패: ${error.message}`);
  }
}
say();

// --- 6. 좌표(stray) DB 탐지 ---
say(`## 6. 좌표 DB (정본이 아닌 잔재 후보)`);
let strayFound = 0;
for (const p of args.strayDbs) {
  const st = statOrNull(p);
  if (st) {
    strayFound++;
    say(`- [주의] 발견: ${p} (${fmtBytes(st.size)}, 수정 ${fmtAge(st.mtimeMs)})`);
  } else {
    say(`- 없음: ${p}`);
  }
}
if (strayFound > 0) {
  say(`- 정본과 다른 DB가 발견되면 어느 쪽이 진짜인지 사람이 확인하고 정리 대상을 정한다. 이 스크립트는 삭제하지 않는다.`);
}
say();

db.close();
process.stdout.write(lines.join('\n') + '\n');
process.exit(0);
