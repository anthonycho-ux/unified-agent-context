import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(repoRoot, 'src');
const testDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uac-store-data-'));
process.env.UAC_DATA_DIR = testDataDir;

// Real modules only — no stub fallback. If src files are missing, tests must fail loudly.
const { ContextStore, prunable } = await import(pathToFileURL(path.join(srcDir, 'store-adapter.mjs')).href);
const { makeFact } = await import(pathToFileURL(path.join(srcDir, 'schema.mjs')).href);
const { SecretBlockedError } = await import(pathToFileURL(path.join(srcDir, 'secret-gate.mjs')).href);

test.after(async () => {
  await fs.rm(testDataDir, { recursive: true, force: true });
});

async function withStore(fn) {
  const store = await ContextStore.connect();
  try {
    return await fn(store);
  } finally {
    await store.close();
  }
}

test('storeFact -> getFacts round trip fully preserves schema fields', async () => {
  await withStore(async (store) => {
    const fact = makeFact({
      statement: 'round trip storage decision is preserved',
      fact_type: 'decision',
      scope: 'project:roundtrip',
      source_ref: 'test:roundtrip',
      sensitivity_class: 'normal',
    });

    const stored = await store.storeFact(fact);
    const facts = await store.getFacts({ scope: 'project:roundtrip' });

    assert.equal(facts.length, 1);
    assert.deepEqual(facts[0], stored);
  });
});

test('scope isolation uses server-side channel filtering for project:* and global', async () => {
  await withStore(async (store) => {
    const alpha = makeFact({ statement: 'alpha scoped fact', fact_type: 'project_state', scope: 'project:alpha', source_ref: 'test:alpha' });
    const beta = makeFact({ statement: 'beta scoped fact', fact_type: 'project_state', scope: 'project:beta', source_ref: 'test:beta' });
    const global = makeFact({ statement: 'global preference fact', fact_type: 'preference', scope: 'global', source_ref: 'test:global' });

    await store.storeFact(alpha);
    await store.storeFact(beta);
    await store.storeFact(global);

    assert.deepEqual((await store.getFacts({ scope: 'project:alpha' })).map((fact) => fact.statement), ['alpha scoped fact']);
    assert.deepEqual((await store.getFacts({ scope: 'project:beta' })).map((fact) => fact.statement), ['beta scoped fact']);
    assert.deepEqual((await store.getFacts({ scope: 'global' })).map((fact) => fact.statement), ['global preference fact']);
  });
});

test('dedupe_key overwrite yields one logical fact with updated updated_at', async () => {
  await withStore(async (store) => {
    const base = makeFact({
      statement: 'dedupe overwrite decision',
      fact_type: 'decision',
      scope: 'project:dedupe',
      source_ref: 'test:dedupe-1',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    const updated = { ...base, updated_at: '2026-01-02T00:00:00.000Z', source_ref: 'test:dedupe-2' };

    await store.storeFact(base);
    await store.storeFact(updated);

    const facts = await store.getFacts({ scope: 'project:dedupe' });
    assert.equal(facts.filter((fact) => fact.dedupe_key === base.dedupe_key).length, 1);
    assert.equal(facts[0].updated_at, '2026-01-02T00:00:00.000Z');
    assert.equal(facts[0].source_ref, 'test:dedupe-2');
  });
});

test('secret gate blocks storeFact before persistence', async () => {
  await withStore(async (store) => {
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz1234567890';
    const fact = makeFact({
      statement: `do not store api_key=${secret}`,
      fact_type: 'decision',
      scope: 'project:secret-gate',
      source_ref: 'test:secret',
    });

    await assert.rejects(() => store.storeFact(fact), SecretBlockedError);
    assert.equal((await store.getFacts({ scope: 'project:secret-gate' })).length, 0);
  });
});

test('prunable honors permanent retention', () => {
  const permanent = makeFact({
    statement: 'permanent decision survives pruning',
    fact_type: 'decision',
    scope: 'project:ttl',
    source_ref: 'test:ttl',
    created_at: '2020-01-01T00:00:00.000Z',
    updated_at: '2020-01-01T00:00:00.000Z',
  });
  const oldProjectState = makeFact({
    statement: `old project state ${createHash('sha256').update('ttl').digest('hex')}`,
    fact_type: 'project_state',
    scope: 'project:ttl',
    source_ref: 'test:ttl-old',
    created_at: '2020-01-01T00:00:00.000Z',
    updated_at: '2020-01-01T00:00:00.000Z',
  });

  assert.equal(prunable(permanent, new Date('2026-01-01T00:00:00.000Z')), false);
  assert.equal(prunable(oldProjectState, new Date('2020-04-01T00:00:00.000Z')), true);
});
