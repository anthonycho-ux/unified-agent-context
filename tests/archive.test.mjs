import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(repoRoot, 'src');
const archiveDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uac-archive-data-'));
process.env.UAC_ARCHIVE_DIR = archiveDir;

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function stubGateSource() {
  return `
const RULES = [
  ['api_key', /api[_-]?key\s*[:=]\s*[^\s]+/ig],
  ['token', /token\s*[:=]\s*[^\s]+/ig],
  ['sk_key', /sk-[A-Za-z0-9_-]{20,}/g],
];
export class SecretBlockedError extends Error {
  constructor(patterns) { super('Secret blocked'); this.name = 'SecretBlockedError'; this.patterns = patterns; }
}
export function scanSecrets(text) {
  const patterns = [];
  for (const [name, re] of RULES) {
    re.lastIndex = 0;
    if (re.test(String(text))) patterns.push(name);
  }
  return { found: patterns.length > 0, patterns };
}
export function redactSecrets(text) {
  let out = String(text);
  for (const [name, re] of RULES) out = out.replace(re, '[REDACTED:' + name + ']');
  return out;
}
export function assertSafe(text) {
  const scan = scanSecrets(text);
  if (scan.found) throw new SecretBlockedError(scan.patterns);
}
`;
}

async function importArchive() {
  const gatePath = path.join(srcDir, 'secret-gate.mjs');

  if (await exists(gatePath)) {
    return import(`${pathToFileURL(path.join(srcDir, 'archive.mjs')).href}?t=${Date.now()}-${Math.random()}`);
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'uac-archive-module-'));
  const tempSrc = path.join(tempRoot, 'src');
  await fs.mkdir(tempSrc, { recursive: true });
  await fs.writeFile(path.join(tempSrc, 'archive.mjs'), await fs.readFile(path.join(srcDir, 'archive.mjs'), 'utf8'));
  await fs.writeFile(path.join(tempSrc, 'config.mjs'), `export * from ${JSON.stringify(`${pathToFileURL(path.join(srcDir, 'config.mjs')).href}?t=${Date.now()}-${Math.random()}`)};\n`);
  await fs.writeFile(path.join(tempSrc, 'secret-gate.mjs'), stubGateSource());

  return import(pathToFileURL(path.join(tempSrc, 'archive.mjs')).href);
}

const { archiveConversation } = await importArchive();

test.after(async () => {
  await fs.rm(archiveDir, { recursive: true, force: true });
});

async function readJsonl(file) {
  const text = await fs.readFile(file, 'utf8');
  return text.trimEnd().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('archiveConversation writes raw content when clean', async () => {
  const content = '사용자 선호: 한국어 문서화를 선호한다.';
  const result = await archiveConversation({ scope: 'project:alpha', sessionId: 'session-clean', content });
  const records = await readJsonl(result.path);

  assert.equal(result.redacted, false);
  assert.equal(records.length, 1);
  assert.match(result.path, /project--alpha\/archive\.jsonl$/);
  assert.equal(records[0].scope, 'project:alpha');
  assert.equal(records[0].sessionId, 'session-clean');
  assert.equal(records[0].content, content);
  assert.equal(typeof records[0].ts, 'string');
  assert.ok(!Number.isNaN(Date.parse(records[0].ts)));
});

test('archiveConversation stores only redacted content when secrets are present', async () => {
  const secret = 'sk-abcdefghijklmnopqrstuvwxyz1234567890';
  const result = await archiveConversation({
    scope: 'project:redact',
    sessionId: 'session-secret',
    content: `OPENAI_API_KEY=${secret}\nkeep this summary`,
  });
  const fileText = await fs.readFile(result.path, 'utf8');
  const records = await readJsonl(result.path);

  assert.equal(result.redacted, true);
  assert.equal(records.length, 1);
  assert.equal(records[0].scope, 'project:redact');
  assert.equal(records[0].sessionId, 'session-secret');
  assert.equal(fileText.includes(secret), false);
  assert.match(records[0].content, /\[REDACTED:/);
  assert.match(records[0].content, /keep this summary/);
});

test('archiveConversation appends JSONL records with stable shape', async () => {
  const first = await archiveConversation({ scope: 'global', sessionId: 'session-a', content: 'first clean note' });
  const second = await archiveConversation({ scope: 'global', sessionId: 'session-b', content: 'second clean note' });
  const records = await readJsonl(first.path);

  assert.equal(first.path, second.path);
  assert.equal(records.length, 2);
  assert.deepEqual(Object.keys(records[0]).sort(), ['content', 'scope', 'sessionId', 'ts']);
  assert.deepEqual(records.map((record) => record.content), ['first clean note', 'second clean note']);
});
