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

const awsKey = `AKIA${'1234567890ABCDEF'}`;
const skKey = `sk-${'1234567890abcdefghijklmnopqrstuvwxyz'}`;
const pemBlock = `-----BEGIN ${'PRIVATE KEY'}-----\n${'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC'}\n-----END ${'PRIVATE KEY'}-----`;
const bearerToken = `eyJhbGciOiJIUzI1NiIs${'InR5cCI6IkpXVCJ9'}`;
const passwordValue = `correct-horse-${'battery-staple'}`;
const envSecretValue = `super${'secretvalue'}`;
const githubPat = `ghp_${'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8'}`;
const githubFinePat = `github_pat_${'11ABCDEFG0'}_${'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6'}`;
const googleApiKey = `AIza${'SyD4ummYFak3K3yF0rT3st1ngPurp0ses'}`;
const slackToken = `xoxb-${'123456789012'}-${'123456789012'}-${'FAKETOKENFAKETOKENFAKETOK'}`;
const stripeLiveKey = `sk_${'live'}_${'4eC39HqLyjWDarjtT1zdp7dc'}`;
const stripeTestKey = `sk_${'test'}_${'4eC39HqLyjWDarjtT1zdp7dc'}`;
const jwtToken = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${'eyJzdWIiOiIxMjM0NTY3ODkwIn0'}.${'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'}`;
const sendgridKey = `SG.${'FAKEKEYFAKEKEYFAKEKE'}.${'FAKESECRETFAKESECRETFAKESECRETFAKESECRETFAK'}`;
const hexSecret = `0123456789abcdef${'0123456789abcdef'}`;

const SECRET_CASES = [
  {
    name: 'AWS AKIA key',
    text: `배포 계정은 ${awsKey} 를 사용했다.`,
    rawSecret: awsKey,
  },
  {
    name: 'sk API key',
    text: `${'OPENAI'}_${'API_KEY'}=${skKey}`,
    rawSecret: skKey,
  },
  {
    name: 'PEM private key block',
    text: pemBlock,
    rawSecret: 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC',
  },
  {
    name: 'token/bearer assignment',
    text: `authorization: Bearer ${bearerToken}`,
    rawSecret: bearerToken,
  },
  {
    name: 'password assignment',
    text: `${'password'}=${passwordValue}`,
    rawSecret: passwordValue,
  },
  {
    name: 'env-style SECRET assignment',
    text: `MY_SERVICE_${'SECRET'}=${envSecretValue}`,
    rawSecret: envSecretValue,
  },
  {
    name: 'GitHub PAT (ghp_)',
    text: `깃허브 토큰은 ${githubPat} 였다.`,
    rawSecret: githubPat,
  },
  {
    name: 'GitHub fine-grained PAT (github_pat_)',
    text: `token: ${githubFinePat}`,
    rawSecret: githubFinePat,
  },
  {
    name: 'Google API key',
    text: `key = ${googleApiKey}`,
    rawSecret: googleApiKey,
  },
  {
    name: 'Slack bot token',
    text: `SLACK_TOKEN=${slackToken}`,
    rawSecret: slackToken,
  },
  {
    name: 'Stripe live key',
    text: `stripe key: ${stripeLiveKey}`,
    rawSecret: stripeLiveKey,
  },
  {
    name: 'Stripe test key',
    text: `stripe key: ${stripeTestKey}`,
    rawSecret: stripeTestKey,
  },
  {
    name: 'JWT',
    text: `access token was ${jwtToken}`,
    rawSecret: jwtToken,
  },
  {
    name: 'SendGrid API key',
    text: `SENDGRID_KEY=${sendgridKey}`,
    rawSecret: sendgridKey,
  },
  {
    name: 'unlabeled high-entropy hex (32 chars)',
    text: `seed: ${hexSecret}`,
    rawSecret: hexSecret,
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
