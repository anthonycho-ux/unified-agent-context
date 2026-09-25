import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(repoRoot, 'src');

const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'uac-union-'));
process.env.UAC_LOG_PATH = path.join(tmpRoot, 'logs/injector.log');
process.env.UAC_HEALTH_PATH = path.join(tmpRoot, 'health/injector.json');
process.env.UAC_METRICS_PATH = path.join(tmpRoot, 'metrics/injector-metrics.json');
delete process.env.UAC_STRICT;
// 이 스위트는 항상 알려진 JS 서버를 띄운다 (assertNodeSpec). 설정된 entry가
// 바이너리여도 테스트는 node 경로를 고정한다 — 롤백 경로의 통합 커버리지이기도 하다.
process.env.UAC_SERVER_ENTRY ??= path.join(repoRoot, 'node_modules', 'mcp-memory-keeper', 'dist', 'index.js');

const { ContextStore } = await import(pathToFileURL(path.join(srcDir, 'store-adapter.mjs')).href);
const { makeLocalSpec } = await import(pathToFileURL(path.join(srcDir, 'config.mjs')).href);
const { makeFact } = await import(pathToFileURL(path.join(srcDir, 'schema.mjs')).href);
const { getInjectionBlock, InjectorDegradedError } = await import(pathToFileURL(path.join(srcDir, 'injector.mjs')).href);

function assertNodeSpec(spec) {
  if (spec.command !== 'node' && spec.command !== process.execPath
      && path.basename(spec.command) !== 'node') {
    throw new Error(`refusing non-node spec in test: ${spec.command}`);
  }
  return spec;
}

const throwingStore = {
  getFactsPaged: async () => {
    throw new Error('source down (synthetic)');
  },
  getFacts: async () => {
    throw new Error('source down (synthetic)');
  },
  close: async () => {},
};

test.after(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

function decision(statement, scope, updatedAt) {
  return makeFact({ statement, fact_type: 'decision', scope, source_ref: 'test:union', updated_at: updatedAt });
}

async function withTwoStores(fn) {
  const dirSov = await fs.mkdtemp(path.join(os.tmpdir(), 'uac-union-storeHost-'));
  const dirLocal = await fs.mkdtemp(path.join(os.tmpdir(), 'uac-union-local-'));
  const storeHost = await ContextStore.connect(assertNodeSpec(makeLocalSpec(dirSov)));
  const local = await ContextStore.connect(assertNodeSpec(makeLocalSpec(dirLocal)));
  try {
    return await fn({ storeHost, local });
  } finally {
    await storeHost.close().catch(() => {});
    await local.close().catch(() => {});
    await fs.rm(dirSov, { recursive: true, force: true });
    await fs.rm(dirLocal, { recursive: true, force: true });
  }
}

test('union: merges both sources, dedupes by key, newer copy wins', async () => {
  await withTwoStores(async ({ storeHost, local }) => {
    await storeHost.storeFact(decision('storeHost only global fact', 'global'));
    await storeHost.storeFact(decision('shared project fact', 'project:x', '2026-01-01T00:00:00.000Z'));
    await storeHost.storeFact(decision('other project fact', 'project:z'));
    await local.storeFact(decision('local only global fact', 'global'));
    await local.storeFact(decision('shared project fact', 'project:x', '2026-05-01T00:00:00.000Z'));

    const result = await getInjectionBlock({ sovStore: storeHost, localStore: local, scope: 'project:x' });
    assert.equal(result.degraded, false);
    assert.equal(result.partial, false);

    const statements = result.facts.map((f) => f.statement).sort();
    assert.deepEqual(statements, ['local only global fact', 'shared project fact', 'storeHost only global fact']);

    // exactly one copy of the shared fact, and it is the newer (local) one.
    const shared = result.facts.filter((f) => f.statement === 'shared project fact');
    assert.equal(shared.length, 1);
    assert.equal(shared[0].updated_at, '2026-05-01T00:00:00.000Z');
    // project:z fact is not in scope project:x
    assert.ok(!statements.includes('other project fact'));
  });
});

test('storeHost down: falls back to local-only, partial health, not degraded', async () => {
  await withTwoStores(async ({ local }) => {
    await local.storeFact(decision('survives storeHost outage', 'global'));
    const result = await getInjectionBlock({ sovStore: throwingStore, localStore: local, scope: 'global' });
    assert.equal(result.degraded, false);
    assert.equal(result.partial, true);
    assert.deepEqual(result.facts.map((f) => f.statement), ['survives storeHost outage']);
    const health = JSON.parse(await fs.readFile(process.env.UAC_HEALTH_PATH, 'utf8'));
    assert.equal(health.status, 'partial');
  });
});

test('local down: falls back to storeHost-only, partial health, not degraded', async () => {
  await withTwoStores(async ({ storeHost }) => {
    await storeHost.storeFact(decision('survives local outage', 'global'));
    const result = await getInjectionBlock({ sovStore: storeHost, localStore: throwingStore, scope: 'global' });
    assert.equal(result.degraded, false);
    assert.equal(result.partial, true);
    assert.deepEqual(result.facts.map((f) => f.statement), ['survives local outage']);
  });
});

test('both sources down: degrades (empty block)', async () => {
  const result = await getInjectionBlock({ sovStore: throwingStore, localStore: throwingStore, scope: 'global' });
  assert.equal(result.degraded, true);
  assert.equal(result.block, '');
});

test('both sources down under UAC_STRICT=1: throws InjectorDegradedError', async () => {
  process.env.UAC_STRICT = '1';
  try {
    await assert.rejects(
      () => getInjectionBlock({ sovStore: throwingStore, localStore: throwingStore, scope: 'global' }),
      InjectorDegradedError,
    );
  } finally {
    delete process.env.UAC_STRICT;
  }
});
