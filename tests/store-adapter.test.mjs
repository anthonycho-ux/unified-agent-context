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

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function stubSchemaSource() {
  return `
import { createHash } from 'node:crypto';
export class SchemaError extends Error {
  constructor(issues) { super('Schema validation failed'); this.name = 'SchemaError'; this.issues = issues; }
}
export const RETENTION_BY_FACT_TYPE = { decision: 'permanent', preference: 'permanent', project_state: 'days90', summary: 'days180', note: 'days180' };
const TYPES = new Set(['decision', 'preference', 'project_state']);
const RETENTIONS = new Set(['permanent', 'days90', 'days180']);
const SENSITIVITY = new Set(['normal', 'sensitive']);
function iso(value) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)); }
export function validateFact(obj) {
  const issues = [];
  if (!obj || typeof obj !== 'object') issues.push('object required');
  if (typeof obj?.statement !== 'string' || obj.statement.length === 0) issues.push('statement required');
  if (!TYPES.has(obj?.fact_type)) issues.push('invalid fact_type');
  if (!(obj?.scope === 'global' || /^project:.+/.test(obj?.scope ?? ''))) issues.push('invalid scope');
  if (!iso(obj?.created_at)) issues.push('invalid created_at');
  if (!iso(obj?.updated_at)) issues.push('invalid updated_at');
  if (typeof obj?.source_ref !== 'string' || obj.source_ref.length === 0) issues.push('source_ref required');
  if (typeof obj?.dedupe_key !== 'string' || obj.dedupe_key.length === 0) issues.push('dedupe_key required');
  if (!RETENTIONS.has(obj?.retention_class)) issues.push('invalid retention_class');
  if (!SENSITIVITY.has(obj?.sensitivity_class)) issues.push('invalid sensitivity_class');
  if (issues.length) throw new SchemaError(issues);
  return { ...obj };
}
export function makeFact(partial) {
  const now = new Date().toISOString();
  const fact = {
    created_at: now,
    updated_at: now,
    source_ref: 'test',
    sensitivity_class: 'normal',
    ...partial,
  };
  fact.retention_class ??= RETENTION_BY_FACT_TYPE[fact.fact_type];
  fact.dedupe_key ??= createHash('sha256').update(fact.statement + fact.scope).digest('hex').slice(0, 16);
  return validateFact(fact);
}
`;
}

function stubGateSource() {
  return `
export class SecretBlockedError extends Error {
  constructor(patterns) { super('Secret blocked'); this.name = 'SecretBlockedError'; this.patterns = patterns; }
}
const RULES = [
  ['api_key', /api[_-]?key\s*[:=]\s*[^\s]+/ig],
  ['token', /token\s*[:=]\s*[^\s]+/ig],
  ['sk_key', /sk-[A-Za-z0-9_-]{20,}/g],
];
export function scanSecrets(text) {
  const patterns = [];
  for (const [name, re] of RULES) {
    re.lastIndex = 0;
    if (re.test(String(text))) patterns.push(name);
  }
  return { found: patterns.length > 0, patterns };
}
export function assertSafe(text) {
  const scan = scanSecrets(text);
  if (scan.found) throw new SecretBlockedError(scan.patterns);
}
export function redactSecrets(text) {
  let out = String(text);
  for (const [name, re] of RULES) out = out.replace(re, '[REDACTED:' + name + ']');
  return out;
}
`;
}

async function importSubject() {
  const schemaPath = path.join(srcDir, 'schema.mjs');
  const gatePath = path.join(srcDir, 'secret-gate.mjs');

  if (await exists(schemaPath) && await exists(gatePath)) {
    const [store, schema, gate] = await Promise.all([
      import(`${pathToFileURL(path.join(srcDir, 'store-adapter.mjs')).href}?t=${Date.now()}-${Math.random()}`),
      import(pathToFileURL(schemaPath).href),
      import(pathToFileURL(gatePath).href),
    ]);
    return { ...store, ...schema, ...gate };
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'uac-store-module-'));
  const tempSrc = path.join(tempRoot, 'src');
  await fs.mkdir(tempSrc, { recursive: true });
  await fs.writeFile(path.join(tempSrc, 'store-adapter.mjs'), await fs.readFile(path.join(srcDir, 'store-adapter.mjs'), 'utf8'));
  await fs.writeFile(path.join(tempSrc, 'config.mjs'), `export * from ${JSON.stringify(`${pathToFileURL(path.join(srcDir, 'config.mjs')).href}?t=${Date.now()}-${Math.random()}`)};\n`);
  await fs.writeFile(path.join(tempSrc, 'schema.mjs'), stubSchemaSource());
  await fs.writeFile(path.join(tempSrc, 'secret-gate.mjs'), stubGateSource());

  const [store, schema, gate] = await Promise.all([
    import(pathToFileURL(path.join(tempSrc, 'store-adapter.mjs')).href),
    import(pathToFileURL(path.join(tempSrc, 'schema.mjs')).href),
    import(pathToFileURL(path.join(tempSrc, 'secret-gate.mjs')).href),
  ]);
  return { ...store, ...schema, ...gate };
}

const { ContextStore, makeFact, prunable, SecretBlockedError } = await importSubject();

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
