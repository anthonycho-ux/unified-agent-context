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
const script = path.join(repoRoot, 'scripts', 'maintenance-cleanup.mjs');

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'uac-cleanup-'));
const dataDir = path.join(tmp, 'memory');

test.after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function seedDb() {
  const db = new DatabaseSync(path.join(dataDir, 'context.db'));
  db.exec('CREATE TABLE feature_flag_evaluations (id TEXT, flag_id TEXT, flag_key TEXT, enabled INTEGER, reason TEXT, context TEXT, evaluated_at TEXT)');
  const insert = db.prepare('INSERT INTO feature_flag_evaluations (id, flag_id, flag_key, enabled, reason, context, evaluated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const recent = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const old = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  insert.run('r1', 'f1', 'debug_logging', 0, 'Flag globally disabled', '{}', recent);
  insert.run('r2', 'f1', 'debug_logging', 0, 'Flag globally disabled', '{}', recent);
  insert.run('o1', 'f1', 'debug_logging', 0, 'Flag globally disabled', '{}', old);
  insert.run('o2', 'f1', 'debug_logging', 0, 'Flag globally disabled', '{}', old);
  insert.run('o3', 'f1', 'debug_logging', 0, 'Flag globally disabled', '{}', old);
  db.close();
}

function rowCount() {
  const db = new DatabaseSync(path.join(dataDir, 'context.db'), { readOnly: true });
  const n = db.prepare('SELECT COUNT(*) AS n FROM feature_flag_evaluations').get().n;
  db.close();
  return n;
}

async function runScript(args) {
  try {
    const { stdout, stderr } = await execFileAsync('node', ['--no-warnings', script, ...args]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

test('cleanup: dry-run은 개수만 보고하고 삭제하지 않는다', async () => {
  await fs.mkdir(dataDir, { recursive: true });
  seedDb();

  const r = await runScript(['--data-dir', dataDir, '--days', '7']);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.stdout.includes('전체: 5행'), '전체 개수 누락');
  assert.ok(r.stdout.includes('경과: 3행'), '경과 개수 누락');
  assert.ok(r.stdout.includes('dry-run이라 삭제하지 않음'));
  assert.equal(rowCount(), 5, 'dry-run인데 행이 지워짐');
});

test('cleanup: --apply는 오래된 행만 지우고 최근 행은 남긴다', async () => {
  const r = await runScript(['--data-dir', dataDir, '--days', '7', '--apply']);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.stdout.includes('삭제 완료: 3행'), '삭제 보고 누락');
  assert.equal(rowCount(), 2, '최근 행까지 지워짐');
});

test('cleanup: DB가 없으면 exit 1', async () => {
  const emptyDir = path.join(tmp, 'empty');
  await fs.mkdir(emptyDir, { recursive: true });
  const r = await runScript(['--data-dir', emptyDir]);
  assert.equal(r.code, 1);
  assert.ok(r.stdout.includes('DB를 열 수 없음'));
});
