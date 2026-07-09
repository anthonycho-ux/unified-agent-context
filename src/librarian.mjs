import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { DATA_DIR } from './config.mjs';
import { validateFact } from './schema.mjs';


/**
 * Librarian handoff lane (Phase 5).
 *
 * 단일 사서(single-writer) 규칙: 장기 기억 승격 판단은 store-host의 Letta 에이전트
 * "The Noticer"가 한다. UAC는 기고자(feeder)로서 후보 팩트를 outbox에 큐잉하고,
 * librarian-sync가 사서의 reference/inbox로 배달한다.
 *
 * 원칙:
 * - 큐잉은 로컬 저장 경로를 절대 실패시키지 않는다 (fail-safe, 항상 {queued} 반환).
 * - 배달 실패 시 outbox는 보존된다 (degraded mode — 다음 sync에서 재시도).
 * - 영구 보존 팩트(decision/preference)만 사서에게 간다. project_state는 로컬 소음.
 */

export const LIBRARIAN_DIR = process.env.UAC_LIBRARIAN_DIR ?? path.join(DATA_DIR, 'librarian');
export const LIBRARIAN_SPEC = Object.freeze({
  enabled: process.env.UAC_LIBRARIAN !== '0',
  host: process.env.UAC_LIBRARIAN_HOST ?? 'store-host',
  inbox:
    process.env.UAC_LIBRARIAN_INBOX ??
    '/home/user/.letta/agents/agent-e3b792d4-08b2-4b36-9016-aafd1a2a9c7f/memory/reference/inbox',
});

const OUTBOX = () => path.join(LIBRARIAN_DIR, 'outbox.jsonl');
const SENT = () => path.join(LIBRARIAN_DIR, 'sent.jsonl');

async function readJsonl(file) {
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const rows = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      // 손상 라인은 건너뛴다 — 배달 대상에서 제외될 뿐 파괴하지 않는다.
    }
  }
  return rows;
}

/**
 * 영구 팩트를 사서 outbox에 큐잉한다. 어떤 경우에도 throw하지 않는다.
 * @returns {Promise<{queued: boolean, reason?: string}>}
 */
export async function queueForLibrarian(fact) {
  try {
    if (!LIBRARIAN_SPEC.enabled) {
      return { queued: false, reason: 'disabled' };
    }

    const normalized = validateFact(fact);

    if (normalized.retention_class !== 'permanent') {
      return { queued: false, reason: 'not permanent' };
    }
    if (normalized.sensitivity_class !== 'normal') {
      return { queued: false, reason: 'sensitive' };
    }

    const [queued, sent] = await Promise.all([readJsonl(OUTBOX()), readJsonl(SENT())]);
    const seen = new Set([...queued, ...sent].map((row) => row.dedupe_key));
    if (seen.has(normalized.dedupe_key)) {
      return { queued: false, reason: 'duplicate' };
    }

    await fs.mkdir(LIBRARIAN_DIR, { recursive: true });
    await fs.appendFile(OUTBOX(), `${JSON.stringify(normalized)}\n`, 'utf8');
    return { queued: true };
  } catch (error) {
    return { queued: false, reason: `error: ${error.message}` };
  }
}

/** 사서가 읽는 배달물(markdown digest)을 렌더링한다. */
export function renderDigest(facts, now = new Date()) {
  const stamp = now.toISOString();
  const lines = [
    '---',
    'description: UAC candidate facts — feeder batch. Curate per librarian-role.md (single-writer rule).',
    '---',
    `# UAC inbox digest — ${stamp}`,
    '',
    `${facts.length} candidate fact(s) from unified-agent-context (Mac).`,
    'Decide per fact: promote to mem0 / merge / discard. Dedupe against mem0_dedup_hashes.json.',
    '',
  ];

  for (const fact of facts) {
    lines.push(`- [${fact.fact_type} | ${fact.scope}] ${fact.statement}`);
    lines.push(`  - source: ${fact.source_ref}, key: ${fact.dedupe_key}, at: ${fact.updated_at}`);
  }

  lines.push('');
  return lines.join('\n');
}

async function defaultRunRemote({ host, inbox, filename, content }) {
  const remotePath = `${inbox}/${filename}`;
  // execFileSync: 비동기 execFile은 stdin input 옵션을 지원하지 않는다 (cat이 stdin 대기로 hang).
  execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, `mkdir -p '${inbox}' && cat > '${remotePath}'`], {
    input: content,
    timeout: 30_000,
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  return remotePath;
}

/**
 * outbox를 사서 inbox로 배달한다.
 * 성공: outbox 비움 + sent.jsonl에 이관. 실패: outbox 보존 (degraded).
 * @returns {Promise<{delivered: number, degraded: boolean, reason?: string, remotePath?: string}>}
 */
export async function flushOutbox({ runRemote = defaultRunRemote, now = new Date() } = {}) {
  const facts = await readJsonl(OUTBOX());
  if (facts.length === 0) {
    return { delivered: 0, degraded: false, reason: 'outbox empty' };
  }

  const filename = `uac-${now.toISOString().replace(/[:.]/g, '-')}.md`;
  const content = renderDigest(facts, now);

  let remotePath;
  try {
    remotePath = await runRemote({ ...LIBRARIAN_SPEC, filename, content });
  } catch (error) {
    return { delivered: 0, degraded: true, reason: error.message };
  }

  const sentRows = facts.map((fact) => `${JSON.stringify({ ...fact, delivered_at: now.toISOString(), remote: remotePath })}\n`);
  await fs.appendFile(SENT(), sentRows.join(''), 'utf8');
  await fs.rm(OUTBOX(), { force: true });

  return { delivered: facts.length, degraded: false, remotePath };
}
