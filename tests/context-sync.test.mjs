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
const { makeFact, dedupeKey } = await import(pathToFileURL(path.join(srcDir, 'schema.mjs')).href);
const { reconcile, normalizeRawRow } = await import(pathToFileURL(path.join(scriptsDir, 'context-sync.mjs')).href);

// Hard no-SSH guard: every store this suite spawns MUST be a local `node` server.
function assertNodeSpec(spec) {
  if (spec.command !== 'node' && spec.command !== process.execPath
      && path.basename(spec.command) !== 'node') {
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
    // A fact-category row whose value is a fact-shaped object with NO statement
    // is genuinely unnormalizable and MUST stay a fail-closed skip under Option A.
    await local.callTool('context_save', {
      key: 'poison-no-statement',
      value: JSON.stringify({ fact_type: 'decision', detail: 'malformed: object without a statement' }),
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
// --- Option A: local→store-host normalization of Claude Desktop-style raw rows ---

// A Claude Desktop `context_save` row: fact intent, human-readable key that does
// NOT match the recomputed dedupe_key, and missing every canonical field
// (dedupe_key/timestamps/source_ref/retention_class/sensitivity_class).
async function plantClaudeDesktopRow(store, { key, statement, factType = 'decision', scope = 'global', extra = {} } = {}) {
  await store.callTool('context_save', {
    key,
    value: JSON.stringify({ statement, fact_type: factType, ...extra }),
    category: factType,
    channel: scope,
  });
}

test('normalization (unit): a fact-intent row missing fields becomes a canonical fact', () => {
  const result = normalizeRawRow(
    {
      key: 'human_readable_key',
      value: JSON.stringify({ statement: 'Postgres is the primary datastore', fact_type: 'decision' }),
      category: 'decision',
      channel: 'global',
      created_at: '2026-07-13 08:54:00',
      updated_at: '2026-07-13 08:54:00',
    },
    'global',
  );
  assert.ok(result?.fact, 'row must normalize into a fact');
  const fact = result.fact;
  assert.equal(fact.dedupe_key, dedupeKey(fact.statement, fact.scope));
  assert.equal(fact.source_ref, 'normalized:context_save');
  assert.equal(fact.retention_class, 'permanent'); // RETENTION_BY_FACT_TYPE.decision
  assert.equal(fact.sensitivity_class, 'normal');
  assert.equal(fact.created_at, '2026-07-13T08:54:00.000Z');
  assert.equal(fact.updated_at, '2026-07-13T08:54:00.000Z');
});

test('normalization (unit): non-fact rows are filtered (null), unnormalizable fact rows skip', () => {
  // No fact intent → filtered, not counted.
  assert.equal(normalizeRawRow({ key: 'k', value: JSON.stringify({ text: 'a note' }), category: 'note', channel: 'global' }, 'global'), null);
  assert.equal(normalizeRawRow({ key: 'k', value: JSON.stringify({ progress: 50 }), category: 'progress', channel: 'global' }, 'global'), null);
  // Fact intent (category) but no statement → fail-closed skip.
  assert.deepEqual(
    normalizeRawRow({ key: 'k', value: JSON.stringify({ fact_type: 'decision' }), category: 'decision', channel: 'global', created_at: '2026-07-13 08:54:00' }, 'global'),
    { skip: true },
  );
  // A value that declares a valid fact_type promotes even a non-fact category.
  const promoted = normalizeRawRow(
    { key: 'k', value: JSON.stringify({ statement: 'promoted via declared fact_type', fact_type: 'preference' }), category: 'note', channel: 'global', created_at: '2026-07-13 08:54:00' },
    'global',
  );
  assert.equal(promoted?.fact?.fact_type, 'preference');
});

test('normalization (unit): a secret in the statement is fail-closed skipped', () => {
  const result = normalizeRawRow(
    { key: 'k', value: JSON.stringify({ statement: 'token is sk-proj-abcdefghijklmnopqrstuvwxyz012345', fact_type: 'decision' }), category: 'decision', channel: 'global', created_at: '2026-07-13 08:54:00' },
    'global',
  );
  assert.deepEqual(result, { skip: true });
});

test('normalization (e2e): a Claude Desktop-style row is normalized and pushed to store-host', async () => {
  await withStores(async ({ local, store-host }) => {
    const statement = 'User approved Option A for reconcile normalization';
    await plantClaudeDesktopRow(local, { key: 'user_option_a_20260712', statement });
    const report = await reconcile({ localStore: local, sovStore: store-host });
    assert.equal(report.pushed, 1, 'the normalized fact must be pushed to store-host');
    assert.equal(report.failed, 0);

    const sovFacts = await store-host.getFacts({ scope: 'global' });
    assert.equal(sovFacts.length, 1);
    const fact = sovFacts[0];
    assert.equal(fact.statement, statement);
    assert.equal(fact.fact_type, 'decision');
    assert.equal(fact.dedupe_key, dedupeKey(statement, 'global'));
    assert.equal(fact.source_ref, 'normalized:context_save');
    assert.equal(fact.retention_class, 'permanent');
    assert.equal(fact.sensitivity_class, 'normal');
    assert.ok(!Number.isNaN(Date.parse(fact.created_at)));
    assert.ok(!Number.isNaN(Date.parse(fact.updated_at)));

    // The store-host row's key IS the recomputed dedupe_key (key === dedupe_key on the wire).
    const sovRaw = await store-host.getRawItems({ scope: 'global' });
    assert.deepEqual(sovRaw.map((r) => r.key), [dedupeKey(statement, 'global')]);
  });
});

test('normalization (e2e): re-running reconcile is idempotent (no oscillation)', async () => {
  await withStores(async ({ local, store-host }) => {
    await plantClaudeDesktopRow(local, { key: 'idem_key', statement: 'normalized facts converge' });
    const first = await reconcile({ localStore: local, sovStore: store-host });
    assert.equal(first.pushed, 1);
    const second = await reconcile({ localStore: local, sovStore: store-host });
    assert.equal(second.pushed, 0, 'a normalized fact must not be re-pushed');
    assert.equal(second.pulled, 0, 'and must not be pulled back to local');
    assert.equal(second.failed, 0);
  });
});

test('normalization (unit): a plain-text fact-category row uses the raw value as its statement', () => {
  const value = 'Decision: enable avahi-daemon on store-host so LAN ssh works without Tailscale.';
  const result = normalizeRawRow(
    { key: 'store-host-lan-2026-07-12', value, category: 'decision', channel: 'global', created_at: '2026-07-12 19:50:33' },
    'global',
  );
  assert.ok(result?.fact, 'plain-text decision row must normalize');
  assert.equal(result.fact.statement, value);
  assert.equal(result.fact.fact_type, 'decision');
  assert.equal(result.fact.dedupe_key, dedupeKey(value, 'global'));
  assert.equal(result.fact.source_ref, 'normalized:context_save');
  assert.equal(result.fact.created_at, '2026-07-12T19:50:33.000Z');
});

test('normalization (unit): a plain-text NON-fact-category row is still filtered (null)', () => {
  // A note whose value is plain text has no fact intent → filtered, not promoted.
  assert.equal(
    normalizeRawRow({ key: 'k', value: 'just a passing thought', category: 'note', channel: 'global', created_at: '2026-07-12 19:50:33' }, 'global'),
    null,
  );
});

test('normalization (e2e): a plain-text decision row is normalized and pushed to store-host', async () => {
  await withStores(async ({ local, store-host }) => {
    const statement = 'Route `ssh store-host` over LAN first, Tailscale as fallback (verified 2026-07-11).';
    await local.callTool('context_save', {
      key: 'ssh_sov_auto_route_20260712',
      value: statement, // bare string, exactly how the real stuck rows were saved
      category: 'decision',
      channel: 'project:example-project',
    });
    const report = await reconcile({ localStore: local, sovStore: store-host });
    assert.equal(report.pushed, 1);
    assert.equal(report.failed, 0);
    const facts = await store-host.getFacts({ scope: 'project:example-project' });
    assert.equal(facts.length, 1);
    assert.equal(facts[0].statement, statement);
    assert.equal(facts[0].dedupe_key, dedupeKey(statement, 'project:example-project'));
    assert.equal(facts[0].source_ref, 'normalized:context_save');
  });
});
