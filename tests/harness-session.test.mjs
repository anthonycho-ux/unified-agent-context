import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(repoRoot, 'src');

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uac-harness-session-'));
process.env.UAC_DATA_DIR = dataDir;

const { ContextStore } = await import(pathToFileURL(path.join(srcDir, 'store-adapter.mjs')).href);
const { recordDecision } = await import(pathToFileURL(path.join(srcDir, 'recorder.mjs')).href);

const serverSpec = {
  command: 'node',
  args: [path.join(repoRoot, 'node_modules/mcp-memory-keeper/dist/index.js')],
  env: { DATA_DIR: dataDir },
};

test.after(async () => {
  delete process.env.UAC_SESSION_NAME;
  await fs.rm(dataDir, { recursive: true, force: true });
});

test('UAC_SESSION_NAME이 있으면 하네스 세션에 기록되고, 다른 프로세스(기본 세션)에서도 읽힌다', async () => {
  process.env.UAC_SESSION_NAME = 'uac-test-harness';

  // 쓰기 측: 하네스 이름으로 세션을 시작하고 팩트를 기록한다.
  const writer = await ContextStore.connect(serverSpec);
  try {
    await recordDecision('하네스 세션 출처 추적 테스트', { scope: 'project:harness-session', store: writer });
    const sessions = await writer.callTool('context_session_list', {});
    const text = sessions?.content?.find((p) => p?.type === 'text')?.text ?? '';
    assert.ok(text.includes('uac-test-harness'), '하네스 세션이 생성되지 않음');
  } finally {
    await writer.close();
  }

  // 읽기 측: env 없이(기본 세션으로) 연결필 때 공개 항목이 그대로 보여야 한다.
  delete process.env.UAC_SESSION_NAME;
  const reader = await ContextStore.connect(serverSpec);
  try {
    const facts = await reader.getFacts({ scope: 'project:harness-session' });
    assert.ok(
      facts.some((f) => f.statement === '하네스 세션 출처 추적 테스트'),
      '다른 세션에서 쓴 공개 항목이 읽히지 않음',
    );
  } finally {
    await reader.close();
  }
});
