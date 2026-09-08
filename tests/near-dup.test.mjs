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

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uac-near-dup-'));
process.env.UAC_DATA_DIR = dataDir;

const { similarity, verdict, tokenize, DUPLICATE_THRESHOLD, CORRECTION_THRESHOLD } =
  await import(pathToFileURL(path.join(srcDir, 'near-dup.mjs')).href);
const { recordFact } = await import(pathToFileURL(path.join(srcDir, 'recorder.mjs')).href);
const { ContextStore } = await import(pathToFileURL(path.join(srcDir, 'store-adapter.mjs')).href);

const serverSpec = {
  command: 'node',
  args: [path.join(repoRoot, 'node_modules/mcp-memory-keeper/dist/index.js')],
  env: { DATA_DIR: dataDir },
};

test.after(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

test('tokenize는 소문자 정규화하고, 한글은 문자 바이그램으로 확장한다', () => {
  const tokens = tokenize('Kimi Code CLI is retired, do not invoke Kimi!');
  for (const t of ['kimi', 'code', 'cli', 'is', 'retired', 'do', 'not', 'invoke']) {
    assert.ok(tokens.has(t), `missing token: ${t}`);
  }
  const ko = tokenize('만료된다');
  for (const t of ['만료', '료된', '된다']) {
    assert.ok(ko.has(t), `missing bigram: ${t}`);
  }
});

test('similarity: 동일 문장은 1, 무관 문장은 0', () => {
  assert.equal(similarity('kimi code cli is retired', 'kimi code cli is retired'), 1);
  assert.equal(similarity('kimi code cli is retired', 'stripe payments run on sov'), 0);
});

test('verdict: 임계값 경계에서 duplicate / correction / new를 분류한다', () => {
  const base = 'kimi code cli is retired as of 2026-09-02 do not invoke kimi';
  // 유사 문장: 대부분 토큰 공유 → duplicate 또는 correction 구간
  assert.equal(verdict(base, [base]).kind, 'duplicate');
  const slightRephrase = 'kimi code cli retired as of 2026-09-02 do not invoke kimi code';
  const v = verdict(slightRephrase, [base]);
  assert.ok(v.kind === 'duplicate' || v.kind === 'correction');
  assert.ok(v.similarity >= CORRECTION_THRESHOLD);
  assert.equal(verdict('stripe payments run on sov account', [base]).kind, 'new');
  assert.equal(verdict('anything', []).kind, 'new');
  assert.ok(DUPLICATE_THRESHOLD > CORRECTION_THRESHOLD);
});

test('기록: 유사 문장 재기록은 duplicate로 기존 팩트를 유지한다', async () => {
  const store = await ContextStore.connect(serverSpec);
  try {
    const first = await recordFact({
      statement: 'herdr pane 정리 규칙: 작업이 끝나면 생성한 패널을 닫는다',
      fact_type: 'preference', scope: 'global', author: 'pi/test',
      store,
    });
    assert.equal(first.recorded, 'new');

    const again = await recordFact({
      statement: 'herdr pane 정리 규칙: 작업이 끝나면 생성한 패널을 닫는다',
      fact_type: 'preference', scope: 'global', author: 'pi/other',
      store,
    });
    assert.equal(again.recorded, 'duplicate');
    assert.equal(again.dedupe_key, first.dedupe_key);
    assert.equal(again.author, 'pi/test'); // 기존 팩트의 author가 유지된다

    const facts = await store.getFacts({ scope: 'global' });
    const matches = facts.filter((f) => f.statement.includes('herdr pane 정리 규칙'));
    assert.equal(matches.length, 1);
  } finally {
    await store.close();
  }
});

test('기록: 중간 유사 문장은 correction으로 기록되고 이전 팩트에 tombstone이 남는다', async () => {
  const store = await ContextStore.connect(serverSpec);
  try {
    const first = await recordFact({
      statement: '구독 정책: 프로젝트 상태 팩트는 90일 후 만료된다',
      fact_type: 'decision', scope: 'project:nd', author: 'pi/test',
      store,
    });
    assert.equal(first.recorded, 'new');

    const corrected = await recordFact({
      statement: '구독 정책 결정: 프로젝트 상태 팩트는 90일 뒤 만료되고 갱신 가능하다',
      fact_type: 'decision', scope: 'project:nd', author: 'cmd/test',
      store,
    });
    assert.equal(corrected.recorded, 'corrected');
    assert.ok(corrected.superseded);
    assert.notEqual(corrected.dedupe_key, first.dedupe_key);

    const facts = await store.getFacts({ scope: 'project:nd' });
    const tombstone = facts.find((f) => f.dedupe_key === first.dedupe_key);
    assert.equal(tombstone.superseded_by, corrected.dedupe_key);
    assert.equal(corrected.author, 'cmd/test');
  } finally {
    await store.close();
  }
});

test('주입: tombstone 팩트는 주입 후보에서 제외된다', async () => {
  const { selectForInjection } = await import(pathToFileURL(path.join(srcDir, 'injector.mjs')).href);
  const facts = [
    { statement: '오래된 결정', fact_type: 'decision', status: 'verified', updated_at: '2026-01-01T00:00:00.000Z', superseded_by: 'abc123' },
    { statement: '살아있는 결정', fact_type: 'decision', status: 'verified', updated_at: '2026-01-02T00:00:00.000Z' },
    { statement: 'proposed 상태', fact_type: 'decision', status: 'proposed', updated_at: '2026-01-03T00:00:00.000Z' },
  ];
  const { selected } = selectForInjection(facts, 10);
  assert.deepEqual(selected.map((f) => f.statement), ['살아있는 결정']);
});

test('CLI: --author 플래그와 DUPLICATE 출력', async () => {
  const cli = path.join(repoRoot, 'scripts/record-fact.mjs');
  const env = { ...process.env, UAC_DATA_DIR: dataDir };
  const statement = 'near-dup CLI 검증용 선호: 기록 로그는 한 줄로 출력한다';
  const first = await execFileAsync('node', [cli, '--type', 'preference', '--scope', 'global', '--author', 'pi/clitest', statement], { env });
  assert.match(first.stdout, /^RECORDED [0-9a-f]{16} global/);
  const second = await execFileAsync('node', [cli, '--type', 'preference', '--scope', 'global', '--author', 'cmd/clitest', statement], { env });
  assert.match(second.stdout, /^DUPLICATE [0-9a-f]{16} global/);
});
