import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(repoRoot, 'src');
const scriptsDir = path.join(repoRoot, 'scripts');

// Librarian side effects must land in an observable temp dir (set before import).
const librarianDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uac-sync-lib-'));
process.env.UAC_LIBRARIAN_DIR = librarianDir;

const { ContextStore } = await import(pathToFileURL(path.join(srcDir, 'store-adapter.mjs')).href);
const { makeLocalSpec } = await import(pathToFileURL(path.join(srcDir, 'config.mjs')).href);
const { makeFact } = await import(pathToFileURL(path.join(srcDir, 'schema.mjs')).href);
const { reconcile } = await import(pathToFileURL(path.join(scriptsDir, 'context-sync.mjs')).href);

// Hard no-SSH guard: every store this suite spawns MUST be a local `node` server.
function assertNodeSpec(spec) {
  if (spec.command !== 'node') {
    throw new Error(`refusing non-node spec in test: ${spec.command}`);
  }
  return spec;
}

test.after(async () => {
  await fs.rm(librarianDir, { recursive: true, force: true });
});

async function withStores(fn) {
  const dirLocal = await fs.mkdtemp(path.join(os.tmpdir(), 'uac-sync-local-'));
  const dirSov = await fs.mkdtemp(path.join(os.tmpdir(), 'uac-sync-store-host-'));
  const local = await ContextStore.connect(assertNodeSpec(makeLocalSpec(dirLocal)));
  const store-host = await ContextStore.connect(assertNodeSpec(makeLocalSpec(dirSov)));
  try {
    return await fn({ local, store-host });
  } finally {
    await local.close().catch(() => {});
    await store-host.close().catch(() => {});
    await fs.rm(dirLocal, { recursive: true, force: true });
    await fs.rm(dirSov, { recursive: true, force: true });
  }
}

function decision(statement, scope, updatedAt) {
  return makeFact({
    statement,
    fact_type: 'decision',
    scope,
    source_ref: 'test:context-sync',
    updated_at: updatedAt,
  });
}

test('push-only: a fact present only locally is lifted to store-host', async () => {
  await withStores(async ({ local, store-host }) => {
    await local.storeFact(decision('push me to store-host', 'global'));
    const report = await reconcile({ localStore: local, sovStore: store-host });
    assert.equal(report.pushed, 1);
    assert.equal(report.pulled, 0);
    assert.equal(report.failed, 0);
    assert.deepEqual((await store-host.getFacts({ scope: 'global' })).map((f) => f.statement), ['push me to store-host']);
  });
});

test('pull-only: a fact present only on store-host is replicated to local', async () => {
  await withStores(async ({ local, store-host }) => {
    await store-host.storeFact(decision('pull me to local', 'project:x'));
    const report = await reconcile({ localStore: local, sovStore: store-host });
    assert.equal(report.pulled, 1);
    assert.equal(report.pushed, 0);
    assert.deepEqual((await local.getFacts({ scope: 'project:x' })).map((f) => f.statement), ['pull me to local']);
  });
});

test('newest-wins in each direction: strictly newer updated_at propagates', async () => {
  await withStores(async ({ local, store-host }) => {
    const key = 'same logical decision';
    await store-host.storeFact(decision(key, 'global', '2026-01-01T00:00:00.000Z'));
    await local.storeFact(decision(key, 'global', '2026-02-01T00:00:00.000Z'));
    const report = await reconcile({ localStore: local, sovStore: store-host });
    // local copy is newer -> pushed to store-host; store-host's older copy is not pulled back.
    assert.equal(report.pushed, 1);
    assert.equal(report.pulled, 0);
    const sovFacts = await store-host.getFacts({ scope: 'global' });
    assert.equal(sovFacts.length, 1);
    assert.equal(sovFacts[0].updated_at, '2026-02-01T00:00:00.000Z');
  });
});

test('equal-time is a no-op (no write trigger, no oscillation)', async () => {
  await withStores(async ({ local, store-host }) => {
    const fact = decision('identical on both sides', 'global', '2026-03-03T00:00:00.000Z');
    await local.storeFact(fact);
    await store-host.storeFact(fact);
    const report = await reconcile({ localStore: local, sovStore: store-host });
    assert.equal(report.pushed, 0);
    assert.equal(report.pulled, 0);
  });
});

test('idempotency: a second reconcile pass transfers nothing', async () => {
  await withStores(async ({ local, store-host }) => {
    await local.storeFact(decision('local one', 'global'));
    await store-host.storeFact(decision('store-host one', 'project:y'));
    const first = await reconcile({ localStore: local, sovStore: store-host });
    assert.ok(first.pushed + first.pulled >= 2);
    const second = await reconcile({ localStore: local, sovStore: store-host });
    assert.equal(second.pushed, 0);
    assert.equal(second.pulled, 0);
    assert.equal(second.failed, 0);
  });
});

test('category filter: non-fact rows are never propagated', async () => {
  await withStores(async ({ local, store-host }) => {
    await local.callTool('context_save', {
      key: 'note-1',
      value: JSON.stringify({ arbitrary: 'note payload' }),
      category: 'note',
      channel: 'global',
    });
    const report = await reconcile({ localStore: local, sovStore: store-host });
    assert.equal(report.pushed, 0);
    assert.equal(report.failed, 0);
    assert.equal((await store-host.getRawItems({ scope: 'global' })).length, 0);
  });
});

test('poison row is skipped but the rest of the cycle completes', async () => {
  await withStores(async ({ local, store-host }) => {
    const good = decision('valid decision alongside poison', 'global');
    await local.storeFact(good);
    // fact-category row whose key does not match its recomputed dedupe_key.
    await local.callTool('context_save', {
      key: 'tampered-key',
      value: JSON.stringify(good),
      category: 'decision',
      channel: 'global',
    });
    const report = await reconcile({ localStore: local, sovStore: store-host });
    assert.ok(report.skipped >= 1, 'poison row must be counted as skipped');
    assert.equal(report.failed, 0);
    assert.deepEqual((await store-host.getFacts({ scope: 'global' })).map((f) => f.statement), [good.statement]);
  });
});

test('replication uses saveFactValidated and never queues the librarian', async () => {
  await withStores(async ({ local, store-host }) => {
    // The librarian outbox is shared across this file, so measure the DELTA, not absence.
    const outbox = path.join(librarianDir, 'outbox.jsonl');
    const countLines = async () => {
      try {
        return (await fs.readFile(outbox, 'utf8')).split('\n').filter(Boolean).length;
      } catch {
        return 0;
      }
    };
    // Seed store-host WITHOUT the librarian side effect, then reconcile (pull) into local.
    await store-host.saveFactValidated(decision('replicated without publish', 'global'));
    const before = await countLines();
    const report = await reconcile({ localStore: local, sovStore: store-host });
    assert.equal(report.pulled, 1);
    assert.equal(await countLines(), before, 'reconcile pull must not append to the librarian outbox');

    // Sanity check the observation: storeFact (the genuine-write path) DOES queue.
    await store-host.storeFact(decision('genuine write publishes', 'global'));
    assert.ok((await countLines()) > before, 'storeFact should append to the librarian outbox');
  });
});
