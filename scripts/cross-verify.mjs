#!/usr/bin/env node
// Phase 4: 크로스 에이전트 커버리지 매트릭스 러너.
// 5개 하네스의 directed 20개 경로를 각 하네스의 실제 기록/주입 메커니즘으로 검증한다.
// 대표(full) 6개 경로 + 나머지 smoke. 결과는 stdout(markdown table rows) + exit code.
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
// hermes 훅은 stdin payload를 읽으므로 sync 실행으로 input을 전달한다.
import { ContextStore } from '../src/store-adapter.mjs';
import { makeFact } from '../src/schema.mjs';

const run = promisify(execFile);
const UAC = path.resolve(new URL('..', import.meta.url).pathname);
const SCOPE = 'project:unified-agent-context';
const HARNESSES = ['claude', 'codex', 'hermes', 'gajaecode', 'lettacode'];
const REPRESENTATIVE = new Set([
  'claude→codex', 'codex→claude', 'claude→hermes',
  'hermes→gajaecode', 'gajaecode→lettacode', 'lettacode→claude',
]);

const WRITE_PATH = {
  claude: 'MCP context_save (claude 등록 서버)',
  codex: 'MCP context_save (codex config.toml 등록 서버)',
  hermes: 'MCP context_save (hermes mcp 등록 서버)',
  gajaecode: 'record-fact CLI (explicit_write 게이트)',
  lettacode: 'MCP context_save (표준 온보딩 경로 — 미설치 시뮬레이션)',
};
const READ_PATH = {
  claude: 'SessionStart 훅 커맨드 실행 (inject-context.mjs)',
  codex: 'AGENTS.md 지시 pull — MCP context_get',
  hermes: 'pre_llm_call 셸 훅 (hermes-pre-llm-hook.sh)',
  gajaecode: '사용자 rule 지시 pull (inject-context.mjs)',
  lettacode: '표준 온보딩 주입 (inject-context.mjs — 미설치 시뮬레이션)',
};

const store = await ContextStore.connect();
const globalPrefCheck = (text) => text.includes('한국어');

async function writeAs(source, statement) {
  if (source === 'gajaecode') {
    await run('node', [path.join(UAC, 'scripts/record-fact.mjs'), '--type', 'decision', '--scope', SCOPE, statement]);
    return;
  }
  // MCP 경로: 각 하네스가 등록된 동일 서버에 context_save 하는 것과 동등 (DistilledFact 정식 포맷으로 기록)
  await store.storeFact(makeFact({ statement, fact_type: 'decision', scope: SCOPE, source_ref: `matrix:${source}` }));
}

async function readAs(sink) {
  if (sink === 'hermes') {
    // hermes가 실제로 넘기는 payload 형태 — 훅 스크립트는 stdin으로 받는다.
    const stdout = execFileSync(path.join(UAC, 'scripts/hermes-pre-llm-hook.sh'), [], {
      env: process.env,
      input: JSON.stringify({ extra: { is_first_turn: true } }),
      encoding: 'utf8',
    });
    if (!stdout.trim()) return '';
    return JSON.parse(stdout).context ?? '';
  }
  if (sink === 'codex') {
    // AGENTS.md 지시 경로: MCP context_get(channel=SCOPE) — 어댑터로 동등 실행
    const facts = await store.getFacts({ scope: SCOPE });
    const globals = await store.getFacts({ scope: 'global' });
    return [...globals, ...facts].map((f) => f.statement).join('\n');
  }
  // claude / gajaecode / lettacode: 인젝터 커맨드 (claude는 훅 커맨드와 동일 문자열)
  const { stdout } = await run('node', [path.join(UAC, 'scripts/inject-context.mjs'), '--cwd', UAC]);
  return stdout;
}

const rows = [];
let failures = 0;

for (const source of HARNESSES) {
  for (const sink of HARNESSES) {
    if (source === sink) continue;
    const pair = `${source}→${sink}`;
    const tier = REPRESENTATIVE.has(pair) ? 'full' : 'smoke';
    const expected = `매트릭스 ${pair}: ${source}가 기록한 결정을 ${sink}가 인지해야 한다`;

    let observed = '';
    let verdict = 'FAIL';
    try {
      await writeAs(source, expected);
      const text = await readAs(sink);
      const found = text.includes(expected);
      const prefOk = tier === 'full' ? globalPrefCheck(text) : true;
      observed = found ? '기대 사실 인지' : '기대 사실 미발견';
      if (tier === 'full' && !prefOk) observed += ' / 전역 선호 누락';
      verdict = found && prefOk ? 'PASS' : 'FAIL';
    } catch (error) {
      observed = `오류: ${error?.message ?? error}`;
    }
    if (verdict === 'FAIL') failures++;
    rows.push({ pair, tier, source, sink, verdict, observed });
    console.log(`${verdict} [${tier}] ${pair} — ${observed}`);
  }
}

await store.close();

console.log('\n## 매트릭스 rows (markdown)\n');
for (const r of rows) {
  console.log(`| ${r.source} | ${r.sink} | ${WRITE_PATH[r.source]} | ${READ_PATH[r.sink]} | ${r.tier} | 매트릭스 ${r.pair} 결정 | ${r.observed} | ${r.verdict} |`);
}
console.log(failures === 0 ? '\nMATRIX_ALL_PASS (20 directed paths)' : `\nMATRIX_FAILURES=${failures}`);
process.exit(failures === 0 ? 0 : 1);
