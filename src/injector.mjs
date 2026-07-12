import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { ContextStore } from './store-adapter.mjs';
import { resolveProjectId, localSpec } from './config.mjs';
import { unionFacts } from './merge.mjs';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);

const LOG_PATH = () => process.env.UAC_LOG_PATH ?? path.join(REPO_ROOT, 'data/logs/injector.log');
const HEALTH_PATH = () => process.env.UAC_HEALTH_PATH ?? path.join(REPO_ROOT, 'data/health/injector.json');
const METRICS_PATH = () => process.env.UAC_METRICS_PATH ?? path.join(REPO_ROOT, 'data/metrics/injector-metrics.json');

export class InjectorDegradedError extends Error {
  constructor(reason) {
    super(`Injector degraded: ${reason}`);
    this.name = 'InjectorDegradedError';
    this.reason = reason;
  }
}

async function appendLog(event) {
  const file = LOG_PATH();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${JSON.stringify(event)}\n`, 'utf8');
}

async function writeHealth(state) {
  const file = HEALTH_PATH();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function bumpMetrics(fields) {
  const file = METRICS_PATH();
  await fs.mkdir(path.dirname(file), { recursive: true });
  let metrics = { inject_count: 0, degraded_count: 0 };
  try {
    metrics = { ...metrics, ...JSON.parse(await fs.readFile(file, 'utf8')) };
  } catch {
    // first write
  }
  for (const key of fields) metrics[key] = (metrics[key] ?? 0) + 1;
  metrics.updated_at = new Date().toISOString();
  await fs.writeFile(file, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
  return metrics;
}

function renderBlock(projectScope, globalFacts, projectFacts) {
  const lines = ['## 공유 컨텍스트 (unified-agent-context)', ''];
  if (globalFacts.length === 0 && projectFacts.length === 0) {
    lines.push('_아직 공유된 사실이 없습니다. 중요한 결정/선호는 공유 메모리에 기록하세요._');
    return lines.join('\n');
  }
  if (globalFacts.length > 0) {
    lines.push('### 전역 선호');
    for (const f of globalFacts) lines.push(`- ${f.statement}`);
    lines.push('');
  }
  if (projectFacts.length > 0) {
    lines.push(`### 프로젝트 컨텍스트 (${projectScope})`);
    for (const f of projectFacts) lines.push(`- [${f.fact_type}] ${f.statement}`);
  }
  return lines.join('\n').trimEnd();
}

async function degrade(reason, projectId) {
  process.stderr.write(`[uac-injector] DEGRADED: ${reason}\n`);
  const ts = new Date().toISOString();
  await appendLog({ ts, event: 'injector_degraded', reason, projectId });
  await writeHealth({ status: 'degraded', ts, reason });
  await bumpMetrics(['inject_count', 'degraded_count']);
  if (process.env.UAC_STRICT === '1') {
    throw new InjectorDegradedError(reason);
  }
  return { block: '', facts: [], degraded: true, reason };
}

export async function getInjectionBlock({ cwd = process.cwd(), scope, store, sovStore, localStore } = {}) {
  const projectId = scope?.startsWith('project:') ? scope.slice('project:'.length) : resolveProjectId(cwd);
  const projectScope = scope === 'global' ? null : `project:${projectId}`;

  const readSource = (conn, sc) =>
    typeof conn.getFactsPaged === 'function' ? conn.getFactsPaged({ scope: sc }) : conn.getFacts({ scope: sc });

  // Open + read one source independently so a connect/read failure in one source
  // (e.g. sov unreachable when Tailscale is off) never aborts the other.
  const openAndRead = async (injected, makeConn) => {
    let conn = injected;
    let created = false;
    try {
      if (!conn) {
        conn = await makeConn();
        created = true;
      }
      const globalFacts = await readSource(conn, 'global');
      const projectFacts = projectScope ? await readSource(conn, projectScope) : [];
      return { facts: [...globalFacts, ...projectFacts], conn, created };
    } catch (error) {
      return { facts: null, conn, created, error };
    }
  };

  const [sovResult, localResult] = await Promise.all([
    openAndRead(sovStore ?? store ?? null, () => ContextStore.connect()),
    openAndRead(localStore ?? null, () => ContextStore.connect(localSpec())),
  ]);

  try {
    const sovFacts = sovResult.facts;
    const localFacts = localResult.facts;

    if (sovFacts === null && localFacts === null) {
      const reason = `all sources failed: sov=${sovResult.error?.message ?? sovResult.error}; local=${localResult.error?.message ?? localResult.error}`;
      // degrade() throws InjectorDegradedError under UAC_STRICT; otherwise returns a degraded block.
      return await degrade(reason, projectId);
    }

    const unioned = unionFacts(localFacts ?? [], sovFacts ?? []);
    const globalFacts = unioned.filter((fact) => fact.scope === 'global');
    const projectFacts = projectScope ? unioned.filter((fact) => fact.scope === projectScope) : [];

    const ts = new Date().toISOString();
    const partial = sovFacts === null || localFacts === null;
    if (partial) {
      const failed = sovFacts === null ? 'sov' : 'local';
      await writeHealth({ status: 'partial', ts, reason: `${failed} source unavailable` });
    } else {
      await writeHealth({ status: 'ok', ts });
    }
    await bumpMetrics(['inject_count']);

    return {
      block: renderBlock(projectScope ?? 'global', globalFacts, projectFacts),
      facts: unioned,
      degraded: false,
      partial,
    };
  } catch (error) {
    if (error instanceof InjectorDegradedError) throw error;
    return degrade(error?.message ?? String(error), projectId);
  } finally {
    for (const result of [sovResult, localResult]) {
      if (result.created && result.conn) {
        await result.conn.close().catch(() => {});
      }
    }
  }
}
