// Parity harness: run from ~/Projects/unified-agent-context (needs its node_modules).
// Usage: node /tmp/parity-harness.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = process.env.UAC_REPO ?? `${os.homedir()}/Projects/unified-agent-context`;
const SRC_DB = `${os.homedir()}/.uac/data/memory/context.db`;
const GO_BIN = `${REPO}/store-go/uac-store`;
const NODE_BIN = `${os.homedir()}/.local/share/mise/shims/node`;
const NODE_ENTRY = `${REPO}/node_modules/mcp-memory-keeper/dist/index.js`;

// identical fresh DB copies for each server
const dirs = {};
for (const impl of ['node', 'go']) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `parity-${impl}-`));
  fs.copyFileSync(SRC_DB, path.join(d, 'context.db'));
  dirs[impl] = d;
}

const BATTERY = [
  ['context_session_start', { name: 'parity-session', description: 'diff test' }],
  ['context_save', { key: 'k1', value: '{"a":1}', category: 'note', channel: 'test:parity' }],
  ['context_save', { key: 'k1', value: '{"a":2}', category: 'note', channel: 'test:parity' }], // upsert
  ['context_save', { key: 'k2', value: '한국어 테스트 ✓', private: true, channel: 'test:parity' }],
  ['context_save', { key: 'bad key', value: 'x' }],                       // invalid: spaces
  ['context_save', { key: 'semi;colon', value: 'x' }],                    // invalid: shell char
  ['context_save', { key: 'ok.dots-1', value: 'v', category: 'decision' }], // session default channel
  ['context_get', { includeMetadata: true, limit: 100 }],
  ['context_get', { includeMetadata: true, limit: 100, channel: 'test:parity' }],
  ['context_get', { includeMetadata: true, limit: 2, offset: 0 }],
  ['context_get', { includeMetadata: true, limit: 2, offset: 2 }],
  ['context_get', { includeMetadata: false, limit: 3, channel: 'test:parity' }],
  ['context_get', { includeMetadata: true, channel: 'test:parity' }],     // dynamic default limit
  ['context_get', { includeMetadata: true, channel: 'chan-nonexistent' }], // empty
  ['context_get', { key: 'k1', includeMetadata: true }],
  ['context_get', { keyPattern: 'k*', includeMetadata: true, channel: 'test:parity' }],
  ['context_get', { sort: 'key_asc', includeMetadata: true, limit: 3, channel: 'test:parity' }],
  ['context_get', { priorities: ['high', 'normal'], includeMetadata: true, channel: 'test:parity' }],
  ['context_search', { query: 'k1', includeMetadata: true }],
  ['context_search', { query: '테스트', includeMetadata: true }],
  ['context_search', { query: 'nomatch_zzz', includeMetadata: true }],
  ['context_search', { query: 'k%', includeMetadata: true }],             // LIKE escape
  ['context_search', { query: 'k', searchIn: ['key'], includeMetadata: true, channel: 'test:parity' }],
  ['context_search', { query: 'test', includeMetadata: false, limit: 2 }],
  ['context_session_start', { name: 'second', defaultChannel: 'custom-chan' }],
  ['context_save', { key: 'k3', value: 'defaulted' }],                    // → custom-chan
  ['context_get', { includeMetadata: true, channel: 'custom-chan' }],
];

function normalize(text) {
  return String(text)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<UUID>')
    .replace(/Session: [0-9a-f]{8}/g, 'Session: <SID8>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '<ISO>')
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}Z?/g, '<TS>');
}

async function run(impl, spec) {
  const transport = new StdioClientTransport({ ...spec, env: { ...process.env, ...spec.env }, stderr: 'ignore' });
  const client = new Client({ name: 'parity', version: '0' }, { capabilities: {} });
  const out = [];
  try {
    await client.connect(transport);
    for (const [tool, args] of BATTERY) {
      try {
        const r = await client.callTool({ name: tool, arguments: args });
        const t = r?.content?.find(p => p.type === 'text')?.text ?? '';
        out.push({ tool, args, text: normalize(t), isError: !!r?.isError });
      } catch (e) {
        out.push({ tool, args, text: `THROWN: ${normalize(e.message)}`, isError: true });
      }
    }
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
  return out;
}

const specs = {
  node: { command: NODE_BIN, args: [NODE_ENTRY], env: { DATA_DIR: dirs.node } },
  go:   { command: GO_BIN,  args: [],          env: { DATA_DIR: dirs.go } },
};

const [nodeOut, goOut] = [await run('node', specs.node), await run('go', specs.go)];

let diffs = 0;
for (let i = 0; i < BATTERY.length; i++) {
  const a = nodeOut[i], b = goOut[i];
  const label = `${a.tool} ${JSON.stringify(a.args)}`;
  if (a.text !== b.text || a.isError !== b.isError) {
    diffs++;
    console.log(`DIFF ${i}: ${label}`);
    console.log(`--- node ---\n${a.text}\n--- go ---\n${b.text}\n`);
  } else {
    console.log(`OK   ${i}: ${label}  [${a.text.length} chars${a.isError ? ', isError' : ''}]`);
  }
}
console.log(`\n=== ${diffs} diffs / ${BATTERY.length} cases ===`);

// dump DBs for row-level comparison
for (const impl of ['node', 'go']) {
  execSync(`sqlite3 ${path.join(dirs[impl], 'context.db')} "SELECT key, value, category, priority, channel, is_private, size FROM context_items ORDER BY key" > /tmp/parity-items-${impl}.txt`);
  execSync(`sqlite3 ${path.join(dirs[impl], 'context.db')} "SELECT name, description, branch, default_channel FROM sessions ORDER BY created_at, name" > /tmp/parity-sessions-${impl}.txt`);
}
execSync('diff /tmp/parity-items-node.txt /tmp/parity-items-go.txt && echo "items DB: identical" || echo "items DB: DIFFERS"');
execSync('diff /tmp/parity-sessions-node.txt /tmp/parity-sessions-go.txt && echo "sessions DB: identical" || echo "sessions DB: DIFFERS"');
