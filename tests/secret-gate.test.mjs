import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  SecretBlockedError,
  assertSafe,
  redactSecrets,
  scanSecrets,
} from '../src/secret-gate.mjs';

const PATHS = [
  'distilled_fact',
  'cold_archive',
  'explicit_write',
  'auto_distill',
  'archive_ingest',
];

const SECRET_CASES = [
  {
    name: 'AWS AKIA key',
    text: '배포 계정은 AKIA1234567890ABCDEF 를 사용했다.',
    rawSecret: 'AKIA1234567890ABCDEF',
  },
  {
    name: 'sk API key',
    text: 'OPENAI_API_KEY=sk-1234567890abcdefghijklmnopqrstuvwxyz',
    rawSecret: 'sk-1234567890abcdefghijklmnopqrstuvwxyz',
  },
  {
    name: 'PEM private key block',
    text: '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----',
    rawSecret: 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC',
  },
  {
    name: 'token/bearer assignment',
    text: 'authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
    rawSecret: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  },
  {
    name: 'password assignment',
    text: 'password=correct-horse-battery-staple',
    rawSecret: 'correct-horse-battery-staple',
  },
  {
    name: 'env-style SECRET assignment',
    text: 'MY_SERVICE_SECRET=supersecretvalue',
    rawSecret: 'supersecretvalue',
  },
];

describe('secret gate fail-closed blocking', () => {
  for (const path of PATHS) {
    for (const secretCase of SECRET_CASES) {
      it(`blocks ${secretCase.name} on ${path}`, () => {
        assert.throws(
          () => assertSafe(secretCase.text, path),
          (error) => {
            assert.ok(error instanceof SecretBlockedError);
            assert.ok(error.patterns.length > 0);
            return true;
          },
        );
      });
    }
  }
});

describe('secret scanning negatives', () => {
  it('allows normal Korean and English prose', () => {
    const text = '오늘 회의에서는 장기 기억 저장 정책을 결정했다. This is ordinary project prose.';
    assert.deepEqual(scanSecrets(text), { found: false, patterns: [] });
    assert.doesNotThrow(() => assertSafe(text, 'distilled_fact'));
  });

  it('allows code without secrets', () => {
    const text = `const tokenName = 'sessionToken';\nfunction passwordRequired(user) { return Boolean(user); }`;
    assert.deepEqual(scanSecrets(text), { found: false, patterns: [] });
    assert.doesNotThrow(() => assertSafe(text, 'explicit_write'));
  });
});

describe('redactSecrets', () => {
  it('removes all original secret substrings and is safe to rescan', () => {
    const secretText = SECRET_CASES.map((entry) => entry.text).join('\n');
    const redacted = redactSecrets(secretText);

    for (const entry of SECRET_CASES) {
      assert.equal(redacted.includes(entry.rawSecret), false, `${entry.name} survived redaction`);
    }

    assert.match(redacted, /\[REDACTED:/);
    assert.deepEqual(scanSecrets(redacted), { found: false, patterns: [] });
  });
});
