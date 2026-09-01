import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repoRoot, 'scripts', 'fitness-check.mjs');

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'uac-fitness-'));
const dataDir = path.join(tmp, 'memory');
const historyFile = path.join(tmp, 'maintenance', 'fitness-history.jsonl');

test.after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function seedDb(dir) {
  await fs.mkdir(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'context.db'));
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, name TEXT, updated_at TEXT);
    CREATE TABLE context_items (
      id INTEGER PRIMARY KEY, session_id TEXT, key TEXT, value TEXT,
      category TEXT, priority TEXT, channel TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE context_changes (sequence_id INTEGER PRIMARY KEY, item_id TEXT, created_at TEXT);
  `);
  const now = new Date();
  const recent = now.toISOString().slice(0, 19).replace('T', ' '); // 'YYYY-MM-DD HH:MM:SS' 형식
  const stale = new Date(now.getTime() - 90 * 86400000).toISOString(); // ISO 형식, 90일 전
  db.prepare('INSERT INTO sessions (id, name, updated_at) VALUES (?, ?, ?)').run('s-live', 'Live Session', recent);
  db.prepare('INSERT INTO sessions (id, name, updated_at) VALUES (?, ?, ?)').run('s-orphan', 'Orphan Session', recent);
  const insert = db.prepare(
    'INSERT INTO context_items (session_id, key, value, category, priority, channel, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  insert.run('s-live', 'k1', 'v', 'note', 'normal', 'global', recent, recent);
  insert.run('s-live', 'k2', 'v', 'note', 'normal', 'old-channel', recent, stale);
  insert.run('s-ghost', 'k3', 'v', 'note', 'normal', 'global', recent, recent); // 고아 항목
  db.prepare('INSERT INTO context_changes (item_id, created_at) VALUES (?, ?)').run('k1', recent);
  db.close();
  return { recent, stale };
}

async function runScript(args) {
  try {
    const { stdout, stderr } = await execFileAsync('node', ['--no-warnings', script, ...args]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

test('정상 DB: 보고서 6개 섹션과 주의 표시가 나오고 exit 0', async () => {
  await seedDb(dataDir);
  const stray = path.join(tmp, 'stray-context.db');
  await fs.writeFile(stray, 'x');

  const r = await runScript(['--data-dir', dataDir, '--history-file', historyFile, '--stray-db', stray, '--dry-run']);
  assert.equal(r.code, 0, r.stderr);
  for (const section of ['## 1. 크기 / WAL', '## 2. 테이블 규모', '## 3. 채널 활동', '## 4. 세션', '## 5. 성장 추이', '## 6. 좌표 DB']) {
    assert.ok(r.stdout.includes(section), `섹션 누락: ${section}`);
  }
  assert.ok(r.stdout.includes('[주의] old-channel'), '비활성 채널 표시 누락');
  assert.ok(r.stdout.includes('고아 세션'), '고아 세션 표시 누락');
  assert.ok(r.stdout.includes('고아 항목: 1개'), '고아 항목 표시 누락');
  assert.ok(r.stdout.includes(`발견: ${stray}`), '좌표 DB 탐지 누락');
});

test('첫 실행은 기준선 없음을 솔직히 표시하고, 두 번째 실행부터 추이를 보고한다', async () => {
  const dir = path.join(tmp, 'memory2');
  await seedDb(dir);
  const hist = path.join(tmp, 'maintenance2', 'h.jsonl');

  const first = await runScript(['--data-dir', dir, '--history-file', hist, '--dry-run']);
  assert.equal(first.code, 0, first.stderr);
  assert.ok(first.stdout.includes('측정 불가 (기준선 없음'), '기준선 없음 표시 누락');
  // dry-run은 히스토리를 쓰지 않아야 한다
  await assert.rejects(fs.access(hist), 'dry-run인데 히스토리 파일이 생김');

  await runScript(['--data-dir', dir, '--history-file', hist]); // 기준선 기록
  const second = await runScript(['--data-dir', dir, '--history-file', hist, '--dry-run']);
  assert.equal(second.code, 0, second.stderr);
  assert.ok(second.stdout.includes('기준선:'), '기준선 비교 누락');
  assert.ok(second.stdout.includes('/일'), '일일 증가율 누락');
});

test('DB가 없으면 우회하지 않고 멈추며 exit 1', async () => {
  const emptyDir = path.join(tmp, 'empty');
  await fs.mkdir(emptyDir, { recursive: true });
  const r = await runScript(['--data-dir', emptyDir, '--dry-run']);
  assert.equal(r.code, 1);
  assert.ok(r.stdout.includes('DB를 열 수 없음'), '실패 보고 누락');
  assert.ok(!r.stdout.includes('## 1.'), '실패했는데 본문이 출력됨');
});
