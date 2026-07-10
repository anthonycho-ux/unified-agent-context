import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(repoRoot, 'src');

const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'uac-injector-'));
const dataDir = path.join(tmpRoot, 'memory');
const logPath = path.join(tmpRoot, 'logs/injector.log');
const healthPath = path.join(tmpRoot, 'health/injector.json');
const metricsPath = path.join(tmpRoot, 'metrics/injector-metrics.json');

process.env.UAC_DATA_DIR = dataDir;
process.env.UAC_LOG_PATH = logPath;
process.env.UAC_HEALTH_PATH = healthPath;
process.env.UAC_METRICS_PATH = metricsPath;
delete process.env.UAC_STRICT;

// Real modules only — no stub fallback.
const { ContextStore } = await import(pathToFileURL(path.join(srcDir, 'store-adapter.mjs')).href);
const { makeFact } = await import(pathToFileURL(path.join(srcDir, 'schema.mjs')).href);
const { getInjectionBlock, InjectorDegradedError } = await import(pathToFileURL(path.join(srcDir, 'injector.mjs')).href);

const serverSpec = {
  command: 'node',
  args: [path.join(repoRoot, 'node_modules/mcp-memory-keeper/dist/index.js')],
  env: { DATA_DIR: dataDir },
};
test.before(async () => {
  const store = await ContextStore.connect(serverSpec);
  try {
    await store.storeFact(makeFact({ statement: '모든 답변은 한국어로 한다', fact_type: 'preference', scope: 'global', source_ref: 'test' }));
    await store.storeFact(makeFact({ statement: 'DB는 Postgres로 전환한다', fact_type: 'decision', scope: 'project:alpha', source_ref: 'test' }));
    await store.storeFact(makeFact({ statement: 'beta 전용 비밀 아님 결정', fact_type: 'decision', scope: 'project:beta', source_ref: 'test' }));
    await store.storeFact(makeFact({ statement: '브라우저 세션은 Aside에서 확인한다', fact_type: 'project_state', scope: 'project:alpha', source_ref: 'test', tags: ['browser'] }));
    await store.storeFact(makeFact({ statement: '커밋은 관련 파일만 포함한다', fact_type: 'preference', scope: 'global', source_ref: 'test', tags: ['git'] }));
  } finally {
    await store.close();
  }
});

test.after(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

test('주입 성공: 전역 선호 + 해당 프로젝트 사실 포함, 타 프로젝트 사실 배제', async () => {
  const store = await ContextStore.connect(serverSpec);
  try {
    const result = await getInjectionBlock({ scope: 'project:alpha', store });
    assert.equal(result.degraded, false);
    assert.match(result.block, /공유 컨텍스트/);
    assert.match(result.block, /한국어로 한다/);
    assert.match(result.block, /Postgres로 전환한다/);
    assert.ok(!result.block.includes('beta 전용'), '타 프로젝트(beta) 사실이 주입되면 안 된다');
  } finally {
    await store.close();
  }
  const health = JSON.parse(await fs.readFile(healthPath, 'utf8'));
  assert.equal(health.status, 'ok');
});

test('기본 generic 주입은 tagged fact까지 포함하는 기존 공유 블록을 유지한다', async () => {
  const store = await ContextStore.connect(serverSpec);
  try {
    const result = await getInjectionBlock({ scope: 'project:alpha', store });
    assert.equal(result.agent, 'generic');
    assert.match(result.block, /공유 컨텍스트/);
    assert.match(result.block, /브라우저 세션은 Aside에서 확인한다/);
    assert.match(result.block, /커밋은 관련 파일만 포함한다/);
  } finally {
    await store.close();
  }
});

test('claude-code adapter는 coding/git 사실을 포함하고 browser-only 사실을 제외한다', async () => {
  const store = await ContextStore.connect(serverSpec);
  try {
    const result = await getInjectionBlock({ agent: 'claude-code', scope: 'project:alpha', store });
    assert.equal(result.agent, 'claude-code');
    assert.match(result.block, /UAC Shared Context for Claude Code/);
    assert.match(result.block, /커밋은 관련 파일만 포함한다/);
    assert.ok(!result.block.includes('브라우저 세션은 Aside에서 확인한다'), 'browser-only 사실은 coding agent에서 제외');
    assert.ok(!result.facts.some((fact) => fact.statement.includes('브라우저 세션')));
  } finally {
    await store.close();
  }
});

test('aside adapter는 browser 사실을 포함하고 git-only 사실을 제외한다', async () => {
  const store = await ContextStore.connect(serverSpec);
  try {
    const result = await getInjectionBlock({ agent: 'aside', scope: 'project:alpha', store });
    assert.equal(result.agent, 'aside');
    assert.match(result.block, /UAC Shared Context for Aside/);
    assert.match(result.block, /브라우저 세션은 Aside에서 확인한다/);
    assert.ok(!result.block.includes('커밋은 관련 파일만 포함한다'), 'git-only 사실은 Aside에서 제외');
    assert.ok(!result.facts.some((fact) => fact.statement.includes('커밋은 관련 파일만')));
  } finally {
    await store.close();
  }
});

test('degraded mode: 서버 부재 시 4가지 증거(warning/log/health/metric) 전부 방출', async () => {
  const before = JSON.parse(await fs.readFile(metricsPath, 'utf8').catch(() => '{"degraded_count":0}'));
  // Force the degraded path with a store whose getFacts throws (server down).
  const throwingStore = { getFacts: async () => { throw new Error('server down (synthetic)'); }, close: async () => {} };
  const stderr2 = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => { stderr2.push(String(chunk)); return origWrite(chunk, ...rest); };
  let degradedResult;
  try {
    degradedResult = await getInjectionBlock({ scope: 'project:alpha', store: throwingStore });
  } finally {
    process.stderr.write = origWrite;
  }

  // (i) visible warning
  assert.ok(stderr2.some((c) => c.includes('[uac-injector] DEGRADED')), 'stderr warning 필요');
  // return shape
  assert.equal(degradedResult.degraded, true);
  assert.equal(degradedResult.block, '');
  // (ii) structured log
  const logLines = (await fs.readFile(logPath, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  const lastLog = logLines.at(-1);
  assert.equal(lastLog.event, 'injector_degraded');
  assert.ok(lastLog.ts && lastLog.reason);
  // (iii) health probe transition
  const health = JSON.parse(await fs.readFile(healthPath, 'utf8'));
  assert.equal(health.status, 'degraded');
  // (iv) metric increment
  const after = JSON.parse(await fs.readFile(metricsPath, 'utf8'));
  assert.ok((after.degraded_count ?? 0) > (before.degraded_count ?? 0), 'degraded_count 증가 필요');
});

test('UAC_STRICT=1: degraded는 InjectorDegradedError로 실패 처리 (fallback = 테스트 실패)', async () => {
  process.env.UAC_STRICT = '1';
  const throwingStore = { getFacts: async () => { throw new Error('server down (strict)'); }, close: async () => {} };
  try {
    await assert.rejects(
      () => getInjectionBlock({ scope: 'project:alpha', store: throwingStore }),
      InjectorDegradedError,
    );
  } finally {
    delete process.env.UAC_STRICT;
  }
});

test('성공 시 health가 ok로 복귀', async () => {
  const store = await ContextStore.connect(serverSpec);
  try {
    const result = await getInjectionBlock({ scope: 'project:alpha', store });
    assert.equal(result.degraded, false);
  } finally {
    await store.close();
  }
  const health = JSON.parse(await fs.readFile(healthPath, 'utf8'));
  assert.equal(health.status, 'ok');
});

test('CLI wrapper: 정상 실행 시 블록을 stdout으로 출력하고 exit 0', async () => {
  const { stdout } = await execFileAsync('node', [path.join(repoRoot, 'scripts/inject-context.mjs'), '--scope', 'project:alpha'], {
    env: { ...process.env, UAC_DATA_DIR: dataDir, UAC_LOG_PATH: logPath, UAC_HEALTH_PATH: healthPath, UAC_METRICS_PATH: metricsPath },
  });
  assert.match(stdout, /공유 컨텍스트/);
  assert.match(stdout, /Postgres로 전환한다/);
  assert.ok(!stdout.includes('beta 전용'));
});

test('CLI wrapper: --agent aside는 Aside dialect로 출력한다', async () => {
  const { stdout } = await execFileAsync('node', [path.join(repoRoot, 'scripts/inject-context.mjs'), '--agent', 'aside', '--scope', 'project:alpha'], {
    env: { ...process.env, UAC_DATA_DIR: dataDir, UAC_LOG_PATH: logPath, UAC_HEALTH_PATH: healthPath, UAC_METRICS_PATH: metricsPath },
  });
  assert.match(stdout, /UAC Shared Context for Aside/);
  assert.match(stdout, /브라우저 세션은 Aside에서 확인한다/);
  assert.ok(!stdout.includes('커밋은 관련 파일만 포함한다'));
});

test('CLI wrapper: UAC_STRICT=1 + 죽은 서버는 exit 2', async () => {
  const deadData = path.join(tmpRoot, 'no-server');
  await assert.rejects(
    () => execFileAsync('node', [path.join(repoRoot, 'scripts/inject-context.mjs'), '--scope', 'project:alpha'], {
      env: {
        ...process.env,
        UAC_STRICT: '1',
        UAC_DATA_DIR: deadData,
        UAC_SERVER_COMMAND_OVERRIDE_FOR_TEST: '1',
        UAC_LOG_PATH: logPath,
        UAC_HEALTH_PATH: healthPath,
        UAC_METRICS_PATH: metricsPath,
        // Poison the server entry so ContextStore.connect fails fast.
        UAC_SERVER_ENTRY: path.join(tmpRoot, 'missing-server.js'),
      },
      timeout: 20000,
    }),
    (err) => err.code === 2,
  );
});
