// G002 red-team harness (leader-run). Creates transcripts under artifacts/.
import { mkdtempSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ContextStore } from '../src/store-adapter.mjs';
import { makeFact } from '../src/schema.mjs';
import { SecretBlockedError } from '../src/secret-gate.mjs';

const repo = path.resolve(new URL('..', import.meta.url).pathname);
const out = (name) => path.join(repo, 'artifacts', name);
const log = (file, line) => { appendFileSync(file, line + '\n'); console.log(line); };

const dataDir = mkdtempSync(path.join(tmpdir(), 'g002-redteam-'));
const spec = { command: 'node', args: [path.join(repo, 'node_modules/mcp-memory-keeper/dist/index.js')], env: { DATA_DIR: dataDir } };

let failures = 0;
const check = (file, cond, label) => { log(file, `${cond ? 'PASS' : 'FAIL'}: ${label}`); if (!cond) failures++; };


const syntheticSk = `sk-proj-${'abcdefghijklmnopqrstuvwxyz012345'}`;
const syntheticAws = `AKIA${'IOSFODNN7EXAMPLE'}`;
const syntheticPem = `-----BEGIN RSA ${'PRIVATE KEY'}-----\n${'MIIEow'}\n-----END RSA ${'PRIVATE KEY'}-----`;
const syntheticEnvSecret = `abcd${'1234efgh5678'}`;
// ---- 1. scope leakage attack ----
{
  const f = out('g002-redteam-scope.txt');
  writeFileSync(f, `== G002 scope-leak red-team ${new Date().toISOString()} (DATA_DIR=${dataDir}) ==\n`);
  const store = await ContextStore.connect(spec);
  for (let i = 0; i < 10; i++) {
    await store.storeFact(makeFact({ statement: `alpha 결정 ${i}`, fact_type: 'decision', scope: 'project:alpha', source_ref: 'redteam' }));
  }
  await store.storeFact(makeFact({ statement: 'beta 결정', fact_type: 'decision', scope: 'project:beta', source_ref: 'redteam' }));
  await store.storeFact(makeFact({ statement: '전역 선호: 한국어', fact_type: 'preference', scope: 'global', source_ref: 'redteam' }));
  await store.storeFact(makeFact({ statement: 'alpha2 함정 결정', fact_type: 'decision', scope: 'project:alpha2', source_ref: 'redteam' }));

  const beta = await store.getFacts({ scope: 'project:beta' });
  check(f, beta.length === 1 && beta.every((x) => x.scope === 'project:beta'), `beta 조회 격리 (got ${beta.length})`);
  const globalFacts = await store.getFacts({ scope: 'global' });
  check(f, globalFacts.length === 1 && globalFacts.every((x) => x.scope === 'global'), `global 조회에 프로젝트 항목 0건 (got ${globalFacts.length})`);
  const alpha = await store.getFacts({ scope: 'project:alpha' });
  check(f, alpha.length === 10 && alpha.every((x) => x.scope === 'project:alpha'), `유사 채널명 project:alpha2 미혼입 (got ${alpha.length})`);
  check(f, alpha.length > 0, '콜론 포함 채널명 실동작');
  await store.close();
}

// ---- 2. gate bypass attack ----
{
  const f = out('g002-redteam-gate.txt');
  writeFileSync(f, `== G002 gate-bypass red-team ${new Date().toISOString()} ==\n`);
  const store = await ContextStore.connect(spec);
  const variants = [
    `API 배포 완료 ${syntheticSk} 로 테스트했다`,
    `자격증명은\n${syntheticAws}\n이다`,
    syntheticPem,
    `export ${'OPENAI'}_${'SECRET'}_${'TOKEN'}=${syntheticEnvSecret}`,
  ];
  let blocked = 0;
  for (const v of variants) {
    try {
      await store.storeFact(makeFact({ statement: v, fact_type: 'decision', scope: 'project:gate', source_ref: 'redteam' }));
      log(f, `NOT-BLOCKED: ${JSON.stringify(v.slice(0, 40))}`);
    } catch (e) {
      if (e instanceof SecretBlockedError) { blocked++; log(f, `BLOCKED(${e.patterns?.join(',')}): ${JSON.stringify(v.slice(0, 40))}`); }
      else throw e;
    }
  }
  check(f, blocked === variants.length, `비밀 변형 ${variants.length}종 전부 차단 (blocked=${blocked})`);
  const persisted = await store.getFacts({ scope: 'project:gate' });
  check(f, persisted.length === 0, `차단 후 영속 0건 (got ${persisted.length})`);
  // finding: secret in source_ref (contract scans statement only)
  let srefStored = false;
  try {
    await store.storeFact(makeFact({ statement: '정상 결정 문장', fact_type: 'decision', scope: 'project:gate2', source_ref: `${'token'}=${syntheticSk}` }));
    srefStored = true;
  } catch (e) { if (!(e instanceof SecretBlockedError)) throw e; }
  log(f, `FINDING(non-blocking): source_ref 내 비밀은 ${srefStored ? '저장됨 — 계약상 statement만 스캔 (Phase 3에서 전 필드 스캔 확장 권고)' : '차단됨'}`);
  await store.close();
}

// ---- 3. archive attack ----
{
  const f = out('g002-redteam-archive.txt');
  writeFileSync(f, `== G002 archive red-team ${new Date().toISOString()} ==\n`);
  process.env.UAC_ARCHIVE_DIR = mkdtempSync(path.join(tmpdir(), 'g002-archive-'));
  const { archiveConversation } = await import('../src/archive.mjs?fresh=' + Date.now());
  const secret = syntheticSk;
  const res = await archiveConversation({ scope: 'project:arch', sessionId: 'rt-1', content: `대화 로그. 키는 ${secret} 입니다.` });
  const bytes = readFileSync(res.path, 'utf8');
  check(f, res.redacted === true, 'redacted 플래그 true');
  check(f, !bytes.includes(secret), '파일 바이트에 원문 secret 부재');
  check(f, bytes.includes('[REDACTED:'), 'REDACTED 마커 존재');
  log(f, `archive path: ${res.path}`);
}

console.log(failures === 0 ? 'G002_REDTEAM_ALL_PASS' : `G002_REDTEAM_FAILURES=${failures}`);
process.exit(failures === 0 ? 0 : 1);
