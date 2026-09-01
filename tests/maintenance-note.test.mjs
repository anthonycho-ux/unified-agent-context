import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(repoRoot, 'src');
const script = path.join(repoRoot, 'scripts', 'maintenance-note.mjs');

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'uac-note-'));
const dataDir = path.join(tmp, 'memory');

test.after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const reportFixture = `# UAC fitness 보고서 — 2026-07-28T00:00:00.000Z
대상: /x/context.db (dry-run)

## 1. 크기 / WAL
- context.db: 5.63 MB (수정: 0시간 전)
- journal_mode: wal

## 3. 채널 활동
- [주의] old-channel: 3항목, 최근 활동 40.0일 전 — 비활성

## 4. 세션
- 세션 없는 고아 항목: 0개

## 6. 좌표 DB
- [주의] 발견: /x/stray.db (440.0 KB, 수정 9.9일 전)
`;

test('maintenance-note: 아카이브 채널과 주입용 project_state 팩트 양쪽에 기록한다', async () => {
  await fs.mkdir(dataDir, { recursive: true });
  const reportPath = path.join(tmp, 'fitness.md');
  await fs.writeFile(reportPath, reportFixture);

  const env = {
    ...process.env,
    UAC_DATA_DIR: dataDir,
    UAC_SESSION_NAME: 'uac-test-maintenance',
  };
  const { stdout } = await execFileAsync('node', ['--no-warnings', script, '--report', reportPath], { env });
  assert.ok(stdout.includes('RECORDED weekly-fitness-'), `기록 실패: ${stdout}`);

  // 같은 스토어에 붙어서 두 갈래를 각각 확인한다.
  const { ContextStore } = await import(pathToFileURL(path.join(srcDir, 'store-adapter.mjs')).href);
  const store = await ContextStore.connect({
    command: 'node',
    args: [path.join(repoRoot, 'node_modules/mcp-memory-keeper/dist/index.js')],
    env: { DATA_DIR: dataDir },
  });
  try {
    const archive = await store.callTool('context_get', { channel: 'maintenance:unified-memory', includeMetadata: true, limit: 10 });
    const archiveText = archive?.content?.find((p) => p?.type === 'text')?.text ?? '';
    assert.ok(archiveText.includes('주의 2건'), '채널 아카이브에 판독 누락');
    assert.ok(archiveText.includes('old-channel'), '채널 아카이브에 주의 항목 누락');

    const facts = await store.getFacts({ scope: 'project:unified-agent-context' });
    assert.ok(
      facts.some((f) => f.statement.includes('UAC 주간 fitness') && f.statement.includes('주의 2건')),
      '주입용 project_state 팩트 누락',
    );
  } finally {
    await store.close();
  }
});

test('maintenance-note: 보고서 파일이 없으면 exit 1', async () => {
  try {
    await execFileAsync('node', ['--no-warnings', script, '--report', path.join(tmp, 'nope.md')], {
      env: { ...process.env, UAC_DATA_DIR: dataDir },
    });
    assert.fail('성공하면 안 됨');
  } catch (error) {
    assert.equal(error.code, 1);
  }
});
