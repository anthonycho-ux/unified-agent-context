#!/usr/bin/env node
// unified-agent-context 배선 자가진단 (Phase 2).
// 각 하네스의 훅/MCP 배선이 실제 설정 파일에 존재하는지 정적 검증한다.
// exit 0 = 전 항목 OK (lettacode 미설치는 documented-constraint로 OK 처리), exit 1 = 배선 누락.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const HOME = os.homedir();
const UAC = path.resolve(new URL('..', import.meta.url).pathname);

const results = [];
const add = (harness, check, ok, note = '') => results.push({ harness, check, ok, note });

async function readOrNull(p) {
  try { return await fs.readFile(p, 'utf8'); } catch { return null; }
}

// claude code
{
  const settings = await readOrNull(path.join(HOME, '.claude/settings.json'));
  let hookOk = false;
  try {
    const d = JSON.parse(settings ?? '{}');
    hookOk = JSON.stringify(d.hooks?.SessionStart ?? []).includes('inject-context.mjs');
  } catch { /* invalid settings */ }
  add('claude code', 'SessionStart 훅', hookOk);
  const claudeJson = await readOrNull(path.join(HOME, '.claude.json'));
  add('claude code', 'MCP unified-memory', (claudeJson ?? '').includes('unified-memory'));
}

// gajaecode (GJC)
{
  const hookPath = path.join(HOME, '.gjc/hooks/uac-inject.mjs');
  const body = await readOrNull(hookPath);
  let syntaxOk = false;
  if (body) {
    try { await run('node', ['--check', hookPath]); syntaxOk = true; } catch { /* syntax error */ }
  }
  add('gajaecode', 'before_agent_start 훅', Boolean(body) && syntaxOk, syntaxOk ? '' : '파일 없음/문법 오류');
}

// hermes
{
  const cfg = await readOrNull(path.join(HOME, '.hermes/config.yaml'));
  add('hermes', 'pre_llm_call 훅', (cfg ?? '').includes('hermes-pre-llm-hook.sh'));
  add('hermes', 'MCP unified-memory', (cfg ?? '').includes('unified-memory'));
}

// codex
{
  const toml = await readOrNull(path.join(HOME, '.codex/config.toml'));
  add('codex', 'MCP unified-memory', (toml ?? '').includes('mcp_servers.unified-memory'));
  const agents = await readOrNull(path.join(HOME, '.codex/AGENTS.md'));
  add('codex', 'AGENTS.md 지시 pull', (agents ?? '').includes('공유 컨텍스트 (unified-agent-context)'), '훅 부재 — 문서화된 제약');
}

// lettacode
{
  let installed = false;
  try { await run('which', ['lettacode']); installed = true; } catch { /* not installed */ }
  add('lettacode', '설치 여부', true, installed ? '설치됨 — 온보딩 절차 적용 필요' : '미설치 (documented constraint) — 설치 시 온보딩 문서 절차 적용');
}

// injector core
{
  let ok = false;
  try { await run('node', ['--check', path.join(UAC, 'scripts/inject-context.mjs')]); ok = true; } catch { /* broken */ }
  add('core', 'inject-context.mjs 문법', ok);
}

let failures = 0;
for (const r of results) {
  if (!r.ok) failures++;
  console.log(`${r.ok ? 'OK  ' : 'FAIL'} | ${r.harness.padEnd(12)} | ${r.check}${r.note ? ` — ${r.note}` : ''}`);
}
console.log(failures === 0 ? 'DOCTOR_ALL_OK' : `DOCTOR_FAILURES=${failures}`);
process.exit(failures === 0 ? 0 : 1);
