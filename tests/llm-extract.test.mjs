import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(repoRoot, 'src');

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uac-llm-'));
const archiveDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uac-llm-archive-'));
process.env.UAC_DATA_DIR = dataDir;
process.env.UAC_ARCHIVE_DIR = archiveDir;

const { llmExtractCandidates, parseFacts } = await import(pathToFileURL(path.join(srcDir, 'llm-extract.mjs')).href);
const { distillSession, extractCandidates } = await import(pathToFileURL(path.join(srcDir, 'distiller.mjs')).href);

test.after(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
  await fs.rm(archiveDir, { recursive: true, force: true });
});

// A fake OpenAI-compatible response wrapping the given assistant content.
function chatResponse(content) {
  return {
    ok: true,
    async json() {
      return { choices: [{ message: { role: 'assistant', content } }] };
    },
  };
}

test('parseFacts: {facts:[...]} 형태 파싱 + 타입 검증 + dedupe', () => {
  const out = parseFacts('{"facts":[{"statement":"DB를 Postgres로 전환한다","fact_type":"decision"},{"statement":"커밋은 영어로","fact_type":"preference"},{"statement":"무시","fact_type":"garbage"},{"statement":"DB를 Postgres로 전환한다","fact_type":"decision"}]}');
  assert.equal(out.length, 2, '유효 2건 (잘못된 타입 제외 + 중복 제거)');
  assert.equal(out[0].fact_type, 'decision');
  assert.equal(out[1].fact_type, 'preference');
});

test('parseFacts: 코드펜스/잡음에 둘러싸인 bare 배열도 파싱', () => {
  const out = parseFacts('여기 결과:\n```json\n[{"statement":"항상 rebase 사용","fact_type":"preference"}]\n```\n끝');
  assert.equal(out.length, 1);
  assert.equal(out[0].statement, '항상 rebase 사용');
});

test('parseFacts: 파싱 불가/비문자열 → null', () => {
  assert.equal(parseFacts('완전 잡소리 no json here'), null);
  assert.equal(parseFacts(null), null);
});

test('llmExtractCandidates: 빈 입력 → []', async () => {
  assert.deepEqual(await llmExtractCandidates('   '), []);
});

test('llmExtractCandidates: mock fetch 성공 경로', async () => {
  const fetch = async () => chatResponse('{"facts":[{"statement":"릴리스는 화요일에 한다","fact_type":"decision"}]}');
  const out = await llmExtractCandidates('아무 대화', { fetch });
  assert.equal(out.length, 1);
  assert.equal(out[0].fact_type, 'decision');
});

test('llmExtractCandidates: fetch throw → null (폴백 신호)', async () => {
  const fetch = async () => { throw new Error('connection refused'); };
  assert.equal(await llmExtractCandidates('x', { fetch }), null);
});

test('llmExtractCandidates: non-ok 응답 → null', async () => {
  const fetch = async () => ({ ok: false, async json() { return {}; } });
  assert.equal(await llmExtractCandidates('x', { fetch }), null);
});

test('distillSession: 주입 extract(async) 사용', async () => {
  const stored = [];
  const store = { async storeFact(fact) { stored.push(fact); }, async close() {} };
  const stmt = '이 문장은 스물다섯 자를 충분히 넘긴 결정 문장이다';
  const extract = async () => [{ statement: stmt, fact_type: 'decision' }];

  const result = await distillSession({ content: 'irrelevant', scope: 'project:t', sessionId: 's', store, extract });
  assert.equal(result.stored, 1);
  assert.equal(stored[0].statement, stmt);
  assert.equal(stored[0].status, 'proposed', '자동 증류분은 proposed');
});

test('distillSession: extract 비배열 반환 → 규칙 기반 폴백', async () => {
  const stored = [];
  const store = { async storeFact(fact) { stored.push(fact); }, async close() {} };
  const transcript = '오늘 회의에서 캐시는 Redis로 전환하기로 결정했다.';
  const extract = async () => 'not-an-array';

  const result = await distillSession({ content: transcript, scope: 'project:t', sessionId: 's2', store, extract });
  // 규칙 기반이 마커('결정')로 최소 1건 추출해야 한다.
  assert.ok(result.stored >= 1, `regex fallback stored=${result.stored}`);
  assert.ok(extractCandidates(transcript).length >= 1, 'sanity: regex가 후보를 뽑는다');
});
