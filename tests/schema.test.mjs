import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateFact,
  makeFact,
  SchemaError,
  RETENTION_BY_FACT_TYPE,
} from '../src/schema.mjs';

const VALID = Object.freeze({
  statement: 'DB는 Postgres로 전환',
  fact_type: 'decision',
  scope: 'project:hermes',
  created_at: '2026-07-07T00:00:00.000Z',
  updated_at: '2026-07-07T00:00:00.000Z',
  source_ref: 'session:abc',
  dedupe_key: 'deadbeefdeadbeef',
  retention_class: 'permanent',
  sensitivity_class: 'normal',
});

describe('validateFact', () => {
  test('accepts a fully valid fact and returns a normalized copy', () => {
    const fact = validateFact({ ...VALID, extra_field: 'dropped' });
    assert.deepEqual(fact, VALID);
    assert.ok(!('extra_field' in fact));
  });

  test('rejects invalid fact_type enum', () => {
    assert.throws(
      () => validateFact({ ...VALID, fact_type: 'opinion' }),
      (err) => err instanceof SchemaError && err.issues.some((i) => i.path === 'fact_type'),
    );
  });

  test('rejects missing required fields with one issue per field', () => {
    try {
      validateFact({ statement: 'x' });
      assert.fail('expected SchemaError');
    } catch (err) {
      assert.ok(err instanceof SchemaError);
      const paths = err.issues.map((i) => i.path);
      for (const f of ['fact_type', 'scope', 'created_at', 'updated_at', 'source_ref', 'dedupe_key', 'retention_class', 'sensitivity_class']) {
        assert.ok(paths.includes(f), `missing issue for ${f}`);
      }
    }
  });

  test('rejects malformed scope and non-ISO timestamps', () => {
    assert.throws(() => validateFact({ ...VALID, scope: 'team:alpha' }), SchemaError);
    assert.throws(() => validateFact({ ...VALID, created_at: '2026-07-07' }), SchemaError);
  });

  test('rejects retention_class inconsistent with fact_type policy', () => {
    assert.throws(
      () => validateFact({ ...VALID, fact_type: 'decision', retention_class: 'days90' }),
      (err) => err instanceof SchemaError && err.issues.some((i) => i.path === 'retention_class'),
    );
  });

  test('rejects non-object input', () => {
    assert.throws(() => validateFact(null), SchemaError);
    assert.throws(() => validateFact('fact'), SchemaError);
  });
});

describe('makeFact', () => {
  test('fills defaults: timestamps, source_ref, sensitivity, scope=global', () => {
    const fact = makeFact({ statement: '커밋 메시지는 영어로', fact_type: 'preference' });
    assert.equal(fact.scope, 'global');
    assert.equal(fact.sensitivity_class, 'normal');
    assert.equal(fact.source_ref, 'unknown');
    assert.equal(fact.created_at, fact.updated_at);
    assert.ok(!Number.isNaN(Date.parse(fact.created_at)));
  });

  test('dedupe_key is deterministic for same statement+scope and differs across scopes', () => {
    const a1 = makeFact({ statement: '같은 문장', fact_type: 'decision', scope: 'project:a' });
    const a2 = makeFact({ statement: '같은 문장', fact_type: 'decision', scope: 'project:a' });
    const b = makeFact({ statement: '같은 문장', fact_type: 'decision', scope: 'project:b' });
    assert.equal(a1.dedupe_key, a2.dedupe_key);
    assert.notEqual(a1.dedupe_key, b.dedupe_key);
    assert.match(a1.dedupe_key, /^[0-9a-f]{16}$/);
  });

  test('TTL policy mapping: decision/preference→permanent, project_state→days90', () => {
    assert.equal(makeFact({ statement: 's', fact_type: 'decision' }).retention_class, 'permanent');
    assert.equal(makeFact({ statement: 's', fact_type: 'preference' }).retention_class, 'permanent');
    assert.equal(makeFact({ statement: 's', fact_type: 'project_state' }).retention_class, 'days90');
  });

  test('RETENTION_BY_FACT_TYPE covers every storable fact_type with valid classes', () => {
    for (const t of ['decision', 'preference', 'project_state']) {
      assert.ok(['permanent', 'days90', 'days180'].includes(RETENTION_BY_FACT_TYPE[t]), t);
    }
    assert.equal(RETENTION_BY_FACT_TYPE.decision, 'permanent');
  });

  test('rejects makeFact without statement', () => {
    assert.throws(() => makeFact({ fact_type: 'decision' }), SchemaError);
  });
});
