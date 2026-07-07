import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(repoRoot, 'src');

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uac-distiller-'));
const archiveDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uac-distiller-archive-'));
process.env.UAC_DATA_DIR = dataDir;
process.env.UAC_ARCHIVE_DIR = archiveDir;

const { ContextStore } = await import(pathToFileURL(path.join(srcDir, 'store-adapter.mjs')).href);
const { extractCandidates, distillSession } = await import(pathToFileURL(path.join(srcDir, 'distiller.mjs')).href);
const { sweepQuarantine } = await import(pathToFileURL(path.join(srcDir, 'quarantine.mjs')).href);

const serverSpec = {
  command: 'node',
  args: [path.join(repoRoot, 'node_modules/mcp-memory-keeper/dist/index.js')],
  env: { DATA_DIR: dataDir },
};

const transcriptPassword = `super${'secret9012'}`;
const rogueSk = `sk-proj-${'abcdefghijklmnopqrstuvwxyz012345'}`;

const TRANSCRIPT = [
  '오늘 회의에서 DB는 SQLite에서 Postgres로 전환하기로 결정했다.',
  '그리고 커밋 메시지는 항상 영어로 작성하는 것을 선호한다.',
  '점심 뭐 먹지',
  '짧은 결정',
  '- 오늘 회의에서 DB는 SQLite에서 Postgres로 전환하기로 결정했다.',
  `자격증명 갱신: ${'password'}=${transcriptPassword} 값으로 서버 접속하기로 결정했다.`,
].join('\n');

test.after(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
  await fs.rm(archiveDir, { recursive: true, force: true });
});

test('extractCandidates: 마커 매칭 + 노이즈/중복 제거', () => {
  const candidates = extractCandidates(TRANSCRIPT);
  const statements = candidates.map((c) => c.statement);
  assert.ok(statements.some((s) => s.includes('Postgres로 전환')), '결정 후보 추출');
  assert.ok(candidates.some((c) => c.fact_type === 'preference' && c.statement.includes('영어로')), '선호 후보 추출');
  assert.ok(!statements.includes('점심 뭐 먹지'), '마커 없는 라인 제외');
  assert.ok(!statements.includes('짧은 결정'), '20자 미만 제외');
  assert.equal(statements.filter((s) => s.includes('Postgres로 전환')).length, 1, '불릿 중복 제거');
});

test('distillSession: 저장 + dedupe + 비밀 후보 skip + 아카이브 redact', async () => {
  const store = await ContextStore.connect(serverSpec);
  try {
    const r1 = await distillSession({ content: TRANSCRIPT, scope: 'project:dst', sessionId: 's1', store });
    assert.ok(r1.stored >= 2, `결정+선호 저장 (stored=${r1.stored})`);
    assert.equal(r1.skipped_secrets, 1, '비밀 후보 1건 skip (fail-closed)');
    assert.equal(r1.redacted, true, '원본에 비밀 있으므로 아카이브는 redact');

    const facts = await store.getFacts({ scope: 'project:dst' });
    assert.ok(facts.every((f) => !f.statement.includes(transcriptPassword)), '비밀 문장 미저장');
    const countAfterFirst = facts.length;

    // 같은 transcript 재증류 → dedupe로 증가 없음
    const r2 = await distillSession({ content: TRANSCRIPT, scope: 'project:dst', sessionId: 's2', store });
    assert.ok(r2.stored >= 2);
    const factsAfter = await store.getFacts({ scope: 'project:dst' });
    assert.equal(factsAfter.length, countAfterFirst, '재증류 후 중복 없음');

    // 아카이브 파일에 원문 비밀 부재
    const archived = await fs.readFile(r1.archive_path, 'utf8');
    assert.ok(!archived.includes(transcriptPassword), '아카이브 바이트에 비밀 부재');
    assert.ok(archived.includes('[REDACTED:'), 'redact 마커 존재');
  } finally {
    await store.close();
  }
});

test('sweepQuarantine: 게이트 우회 raw row의 비밀을 redact로 덮어쓴다', async () => {
  const store = await ContextStore.connect(serverSpec);
  try {
    // 에이전트가 raw MCP로 직접 저장한 상황 시뮬레이션 (게이트 우회)
    await store.callTool('context_save', {
      key: 'rogue_row',
      value: `외부 에이전트가 남긴 메모: api_${'key'}=${rogueSk}`,
      category: 'note',
      channel: 'project:quar',
    });

    const sweep = await sweepQuarantine({ scope: 'project:quar', store });
    assert.equal(sweep.quarantined, 1, 'foreign secret row 1건 검역');

    const rows = await store.getRawItems({ scope: 'project:quar' });
    const rogue = rows.find((r) => r.key === 'rogue_row');
    assert.ok(rogue, '행 유지');
    assert.ok(!rogue.value.includes('sk-proj-'), '비밀 제거됨');
    assert.ok(rogue.value.includes('[REDACTED:'), 'redact 마커');

    // 재스윕은 no-op
    const sweep2 = await sweepQuarantine({ scope: 'project:quar', store });
    assert.equal(sweep2.quarantined, 0);
  } finally {
    await store.close();
  }
});
