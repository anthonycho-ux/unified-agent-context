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

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uac-recorder-'));
process.env.UAC_DATA_DIR = dataDir;

const { ContextStore } = await import(pathToFileURL(path.join(srcDir, 'store-adapter.mjs')).href);
const { recordFact, recordDecision, recordPreference } = await import(pathToFileURL(path.join(srcDir, 'recorder.mjs')).href);
const { SecretBlockedError } = await import(pathToFileURL(path.join(srcDir, 'secret-gate.mjs')).href);

const serverSpec = {
  command: 'node',
  args: [path.join(repoRoot, 'node_modules/mcp-memory-keeper/dist/index.js')],
  env: { DATA_DIR: dataDir },
};

const blockedSk = `sk-proj-${'abcdefghijklmnopqrstuvwxyz012345'}`;
const cliPassword = `hunter2${'secret'}`;

test.after(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

test('명시 기록 왕복: recordDecision이 프로젝트 스코프에 저장되고 조회된다', async () => {
  const store = await ContextStore.connect(serverSpec);
  try {
    const fact = await recordDecision('테스트 러너는 node:test를 사용하기로 결정', { scope: 'project:rec', store });
    assert.equal(fact.fact_type, 'decision');
    const facts = await store.getFacts({ scope: 'project:rec' });
    assert.ok(facts.some((f) => f.dedupe_key === fact.dedupe_key));
  } finally {
    await store.close();
  }
});

test('recordPreference 기본 스코프는 global', async () => {
  const store = await ContextStore.connect(serverSpec);
  try {
    const fact = await recordPreference('로그 메시지는 영어를 선호', { store });
    assert.equal(fact.scope, 'global');
  } finally {
    await store.close();
  }
});

test('비밀 포함 명시 기록은 SecretBlockedError로 차단되고 영속 0건', async () => {
  const store = await ContextStore.connect(serverSpec);
  try {
    await assert.rejects(
      () => recordFact({ statement: `배포 키는 ${blockedSk} 이다`, fact_type: 'decision', scope: 'project:sec', store }),
      SecretBlockedError,
    );
    const facts = await store.getFacts({ scope: 'project:sec' });
    assert.equal(facts.length, 0);
  } finally {
    await store.close();
  }
});

test('CLI: 정상 기록은 RECORDED 출력, 비밀은 exit 3', async () => {
  const env = { ...process.env, UAC_DATA_DIR: dataDir };
  const cli = path.join(repoRoot, 'scripts/record-fact.mjs');

  const { stdout } = await execFileAsync('node', [cli, '--type', 'decision', '--scope', 'project:cli', 'CLI에서 기록 경로를 검증하기로 결정'], { env });
  assert.match(stdout, /^RECORDED [0-9a-f]{16} project:cli/);

  await assert.rejects(
    () => execFileAsync('node', [cli, '--type', 'decision', '--scope', 'project:cli', `${'password'}=${cliPassword} 로 접속`], { env }),
    (err) => err.code === 3 && String(err.stderr).includes('[uac-record] BLOCKED'),
  );
});
