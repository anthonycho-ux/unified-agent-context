import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(repoRoot, 'src');
const testDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uac-librarian-data-'));
const testLibrarianDir = path.join(testDataDir, 'librarian');
process.env.UAC_DATA_DIR = testDataDir;
process.env.UAC_LIBRARIAN_DIR = testLibrarianDir;

const { queueForLibrarian, flushOutbox, renderDigest, LIBRARIAN_DIR } = await import(
  pathToFileURL(path.join(srcDir, 'librarian.mjs')).href
);
const { makeFact } = await import(pathToFileURL(path.join(srcDir, 'schema.mjs')).href);

const OUTBOX = path.join(LIBRARIAN_DIR, 'outbox.jsonl');
const SENT = path.join(LIBRARIAN_DIR, 'sent.jsonl');

test.after(async () => {
  await fs.rm(testDataDir, { recursive: true, force: true });
});

async function resetLibrarianDir() {
  await fs.rm(LIBRARIAN_DIR, { recursive: true, force: true });
}

async function readLines(file) {
  try {
    return (await fs.readFile(file, 'utf8')).split('\n').filter((line) => line.trim() !== '');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

test('queueForLibrarian queues permanent facts as valid JSONL', async () => {
  await resetLibrarianDir();
  const fact = makeFact({
    statement: 'librarian queue decision fact',
    fact_type: 'decision',
    scope: 'project:librarian',
    source_ref: 'test:queue',
  });

  const result = await queueForLibrarian(fact);
  assert.equal(result.queued, true);

  const lines = await readLines(OUTBOX);
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).statement, 'librarian queue decision fact');
});

test('queueForLibrarian dedupes by dedupe_key across outbox and sent', async () => {
  await resetLibrarianDir();
  const fact = makeFact({
    statement: 'librarian dedupe fact',
    fact_type: 'preference',
    scope: 'global',
    source_ref: 'test:dedupe',
  });

  assert.equal((await queueForLibrarian(fact)).queued, true);
  assert.deepEqual(await queueForLibrarian(fact), { queued: false, reason: 'duplicate' });

  // sent에 이관된 뒤에도 중복 큐잉되지 않는다.
  await flushOutbox({ runRemote: async () => '/remote/inbox/uac-test.md' });
  assert.deepEqual(await queueForLibrarian(fact), { queued: false, reason: 'duplicate' });
  assert.equal((await readLines(OUTBOX)).length, 0);
  assert.equal((await readLines(SENT)).length, 1);
});

test('queueForLibrarian skips non-permanent and sensitive facts', async () => {
  await resetLibrarianDir();
  const projectState = makeFact({
    statement: 'ephemeral project state fact',
    fact_type: 'project_state',
    scope: 'project:librarian',
    source_ref: 'test:skip',
  });
  const sensitive = makeFact({
    statement: 'sensitive decision fact',
    fact_type: 'decision',
    scope: 'project:librarian',
    source_ref: 'test:skip',
    sensitivity_class: 'sensitive',
  });

  assert.deepEqual(await queueForLibrarian(projectState), { queued: false, reason: 'not permanent' });
  assert.deepEqual(await queueForLibrarian(sensitive), { queued: false, reason: 'sensitive' });
  assert.equal((await readLines(OUTBOX)).length, 0);
});

test('queueForLibrarian never throws on invalid input', async () => {
  await resetLibrarianDir();
  const result = await queueForLibrarian({ statement: '' });
  assert.equal(result.queued, false);
  assert.match(result.reason, /^error:/);
});

test('flushOutbox delivers digest, moves rows to sent, clears outbox', async () => {
  await resetLibrarianDir();
  const factA = makeFact({ statement: 'flush fact alpha', fact_type: 'decision', scope: 'project:flush', source_ref: 'test:flush-a' });
  const factB = makeFact({ statement: 'flush fact beta', fact_type: 'preference', scope: 'global', source_ref: 'test:flush-b' });
  await queueForLibrarian(factA);
  await queueForLibrarian(factB);

  const calls = [];
  const result = await flushOutbox({
    runRemote: async ({ host, inbox, filename, content }) => {
      calls.push({ host, inbox, filename, content });
      return `${inbox}/${filename}`;
    },
    now: new Date('2026-07-08T00:00:00.000Z'),
  });

  assert.equal(result.delivered, 2);
  assert.equal(result.degraded, false);
  assert.equal(calls.length, 1);
  assert.match(calls[0].content, /flush fact alpha/);
  assert.match(calls[0].content, /flush fact beta/);
  assert.match(calls[0].content, /single-writer/);
  assert.equal((await readLines(OUTBOX)).length, 0);

  const sent = (await readLines(SENT)).map((line) => JSON.parse(line));
  assert.equal(sent.length, 2);
  assert.ok(sent.every((row) => row.delivered_at === '2026-07-08T00:00:00.000Z'));
});

test('flushOutbox preserves outbox on delivery failure (degraded mode)', async () => {
  await resetLibrarianDir();
  const fact = makeFact({ statement: 'degraded delivery fact', fact_type: 'decision', scope: 'project:degraded', source_ref: 'test:degraded' });
  await queueForLibrarian(fact);

  const result = await flushOutbox({
    runRemote: async () => {
      throw new Error('ssh: connect to host store-host: no route');
    },
  });

  assert.equal(result.delivered, 0);
  assert.equal(result.degraded, true);
  assert.match(result.reason, /no route/);
  assert.equal((await readLines(OUTBOX)).length, 1);
});

test('renderDigest includes frontmatter, counts, and per-fact provenance', () => {
  const fact = makeFact({ statement: 'digest render fact', fact_type: 'decision', scope: 'project:digest', source_ref: 'test:digest' });
  const digest = renderDigest([fact], new Date('2026-07-08T00:00:00.000Z'));

  assert.match(digest, /^---\ndescription: /);
  assert.match(digest, /1 candidate fact\(s\)/);
  assert.match(digest, /\[decision \| project:digest\] digest render fact/);
  assert.match(digest, new RegExp(`key: ${fact.dedupe_key}`));
});

test('storeFact queues permanent facts into librarian outbox (integration)', async () => {
  await resetLibrarianDir();
  const { ContextStore } = await import(pathToFileURL(path.join(srcDir, 'store-adapter.mjs')).href);
  const store = await ContextStore.connect();
  try {
    const fact = makeFact({
      statement: 'store integration librarian fact',
      fact_type: 'decision',
      scope: 'project:librarian-integration',
      source_ref: 'test:integration',
    });
    await store.storeFact(fact);
  } finally {
    await store.close();
  }

  const lines = await readLines(OUTBOX);
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).statement, 'store integration librarian fact');
});
