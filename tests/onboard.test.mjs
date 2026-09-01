import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 격리 홈 — 어댑터가 실제 사용자 설정을 건드리지 않도록 import 전에 설정
const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'uac-onboard-'));
process.env.UAC_ONBOARD_HOME = tmpHome;

const { adapters, genericSpec } = await import(
  pathToFileURL(path.join(repoRoot, 'scripts/onboard-agent.mjs')).href
);

const mkCtx = (dryRun = false) => ({ dryRun, log: [], backedUp: new Set() });

test('adapter registry: 5개 하네스, 각 step은 label+run 보유', () => {
  for (const name of ['kimi', 'codex', 'gjc', 'hermes', 'claude']) {
    assert.ok(adapters[name], `missing adapter: ${name}`);
    assert.ok(Array.isArray(adapters[name].steps) && adapters[name].steps.length > 0);
    for (const s of adapters[name].steps) {
      assert.equal(typeof s.label, 'string');
      assert.equal(typeof s.run, 'function');
    }
  }
});

test('kimi mcp: mcp.json 생성 + unified-memory 등록 + 멱등', async () => {
  const ctx = mkCtx();
  const step = adapters.kimi.steps[0];
  assert.equal(await step.run(ctx), true);
  const written = JSON.parse(await fs.readFile(path.join(tmpHome, '.kimi-code/mcp.json'), 'utf8'));
  const entry = written.mcpServers['unified-memory'];
  assert.equal(entry.command, 'node');
  assert.ok(entry.args[0].endsWith('mcp-memory-keeper/dist/index.js'));
  assert.ok(entry.env.DATA_DIR.endsWith('data/memory'));
  // 두 번째 실행은 no-op
  assert.equal(await step.run(mkCtx()), false);
});

test('kimi mcp: 기존 mcp.json의 다른 서버를 보존하며 병합', async () => {
  const home2 = await fs.mkdtemp(path.join(os.tmpdir(), 'uac-onboard2-'));
  process.env.UAC_ONBOARD_HOME = home2;
  const mod = await import(
    pathToFileURL(path.join(repoRoot, 'scripts/onboard-agent.mjs')).href + '?home2'
  );
  await fs.mkdir(path.join(home2, '.kimi-code'), { recursive: true });
  await fs.writeFile(
    path.join(home2, '.kimi-code/mcp.json'),
    JSON.stringify({ mcpServers: { other: { command: 'x' } } }),
  );
  assert.equal(await mod.adapters.kimi.steps[0].run(mkCtx()), true);
  const written = JSON.parse(await fs.readFile(path.join(home2, '.kimi-code/mcp.json'), 'utf8'));
  assert.deepEqual(written.mcpServers.other, { command: 'x' });
  assert.ok(written.mcpServers['unified-memory']);
});

test('kimi hook: orca 관리 블록 앞에 삽입, 관리 블록 불변, 멱등', async () => {
  const cfg = path.join(tmpHome, '.kimi-code/config.toml');
  const managed = '# >>> orca-managed-kimi-hooks (managed by Orca; do not edit) >>>\n[[hooks]]\nevent = "Stop"\ncommand = "orca"\n# <<< orca-managed-kimi-hooks <<<\n';
  await fs.writeFile(cfg, 'default_model = "kimi-code/k3"\n\n' + managed);
  const step = adapters.kimi.steps[1];
  assert.equal(await step.run(mkCtx()), true);
  const out = await fs.readFile(cfg, 'utf8');
  assert.ok(out.includes('kimi-user-prompt-hook.sh'));
  assert.ok(out.indexOf('kimi-user-prompt-hook.sh') < out.indexOf('orca-managed-kimi-hooks'));
  assert.ok(out.includes(managed.trimEnd().split('\n').pop())); // 종결 마커 유지
  assert.equal(out.match(/orca-managed-kimi-hooks \(managed by Orca; do not edit\)/g).length, 1);
  assert.equal(await step.run(mkCtx()), false); // 멱등
});

test('kimi AGENTS.md: 지시 폴백 마커 감지 시 no-op', async () => {
  const f = path.join(tmpHome, '.agents/AGENTS.md');
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(f, '# existing\ncontains inject-context.mjs already\n');
  assert.equal(await adapters.kimi.steps[2].run(mkCtx()), false);
  assert.equal(await fs.readFile(f, 'utf8'), '# existing\ncontains inject-context.mjs already\n');
});

test('dry-run은 아무 파일도 쓰지 않는다', async () => {
  const home3 = await fs.mkdtemp(path.join(os.tmpdir(), 'uac-onboard3-'));
  process.env.UAC_ONBOARD_HOME = home3;
  const mod = await import(
    pathToFileURL(path.join(repoRoot, 'scripts/onboard-agent.mjs')).href + '?home3'
  );
  const ctx = mkCtx(true);
  for (const step of mod.adapters.kimi.steps) await step.run(ctx);
  const entries = await fs.readdir(home3).catch(() => []);
  assert.deepEqual(entries, []);
});

test('generic spec: 미지원 하네스 안내에 핵심 스펙 포함', () => {
  const spec = genericSpec();
  assert.ok(spec.includes('mcp-memory-keeper/dist/index.js'));
  assert.ok(spec.includes('data/memory'));
  assert.ok(spec.includes('inject-context.mjs'));
  assert.ok(spec.includes('project:<git-root-basename>'));
});
