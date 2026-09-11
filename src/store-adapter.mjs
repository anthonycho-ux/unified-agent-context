import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { SERVER_SPEC, SERVER_SPECS } from './config.mjs';
import { validateFact } from './schema.mjs';
import { assertSafe, scanSecrets } from './secret-gate.mjs';
import { queueForLibrarian } from './librarian.mjs';

const TOOL_SAVE = 'context_save';
const TOOL_GET = 'context_get';
const TOOL_SEARCH = 'context_search';
const PAGE_LIMIT = 100;

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = {
  days90: 90,
  days180: 180,
};

function normalizeScope(scope) {
  if (scope === undefined || scope === null || scope === '') {
    return undefined;
  }

  return scope;
}

function firstText(result) {
  return result?.content?.find((part) => part?.type === 'text')?.text ?? '';
}

function parseItems(result) {
  const text = firstText(result).trim();

  if (!text || text.startsWith('No matching context found') || text.startsWith('No results found')) {
    return [];
  }

  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch (error) {
    console.warn(`memory-keeper 응답을 JSON으로 해석하지 못해 건너뜁니다: ${error.message}`);
    return [];
  }
}
function paginationFromResult(result) {
  const text = firstText(result).trim();

  if (!text || text.startsWith('No matching context found') || text.startsWith('No results found')) {
    return {};
  }

  try {
    const parsed = JSON.parse(text);
    return parsed?.pagination && typeof parsed.pagination === 'object' ? parsed.pagination : {};
  } catch {
    return {};
  }
}

function nextPageOffset(result, offset, itemCount) {
  const pagination = paginationFromResult(result);
  if (itemCount === 0 || itemCount < PAGE_LIMIT || pagination.hasMore === false) {
    return null;
  }

  const nextOffset = Number.isInteger(pagination.nextOffset)
    ? pagination.nextOffset
    : offset + PAGE_LIMIT;
  if (nextOffset <= offset) {
    console.warn(`context_get pagination offset did not advance (${offset} -> ${nextOffset}); stopping.`);
    return null;
  }

  return nextOffset;
}

async function getItemsPaged(store, { scope } = {}) {
  const items = [];
  let offset = 0;

  while (true) {
    const result = await store.callTool(TOOL_GET, {
      channel: normalizeScope(scope),
      includeMetadata: true,
      limit: PAGE_LIMIT,
      offset,
    });
    const pageItems = parseItems(result);
    items.push(...pageItems);

    const nextOffset = nextPageOffset(result, offset, pageItems.length);
    if (nextOffset === null) {
      return items;
    }

    offset = nextOffset;
  }
}

function factsFromItems(items) {
  const facts = [];

  for (const item of items) {
    try {
      const parsed = JSON.parse(item.value);
      facts.push(validateFact(parsed));
    } catch (error) {
      console.warn(`외부 context row를 건너뜁니다: ${error.message}`);
    }
  }

  return facts;
}

function pruneCutoffMs(retentionClass) {
  const days = RETENTION_DAYS[retentionClass];
  return days === undefined ? null : days * DAY_MS;
}

export function prunable(fact, now = new Date()) {
  if (fact?.retention_class === 'permanent') {
    return false;
  }

  const cutoffMs = pruneCutoffMs(fact?.retention_class);
  if (cutoffMs === null) {
    return false;
  }

  const basis = fact.updated_at ?? fact.created_at;
  const basisMs = Date.parse(basis);
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);

  if (!Number.isFinite(basisMs) || !Number.isFinite(nowMs)) {
    return false;
  }

  return nowMs - basisMs >= cutoffMs;
}

export class ContextStore {
  constructor(client, transport) {
    this.client = client;
    this.transport = transport;
  }

  static async connect(serverSpec) {
    // 명시 스펙이 주어지면 그것만, 아니면 후보 목록을 순서대로 시도한다.
    // (store-host-ts → store-host 폴백: Tailscale on/off 상태와 무관하게 첫 연결 성공을 사용)
    const specs = serverSpec ? [serverSpec] : (SERVER_SPECS?.length ? SERVER_SPECS : [SERVER_SPEC]);
    let lastError;
    for (const spec of specs) {
      const client = new Client(
        { name: 'unified-agent-context', version: '0.1.0' },
        { capabilities: {} },
      );
      const transport = new StdioClientTransport({
        ...spec,
        env: { ...process.env, ...spec.env },
        stderr: 'ignore',
      });
      try {
        await client.connect(transport);
        // 하네스 출처 추적: UAC_SESSION_NAME이 있으면 그 이름의 세션을 시작한다.
        // (서버는 session_start마다 새 세션 행을 만들며, 공개 항목은 세션을 넘어 읽힌다.)
        // 실패할 때 기록 자체가 막히지 않도록 경고 후 기본 세션으로 진행한다.
        const sessionName = process.env.UAC_SESSION_NAME;
        if (sessionName) {
          try {
            await client.callTool({
              name: 'context_session_start',
              arguments: { name: sessionName, description: 'UAC 하네스 세션 (UAC_SESSION_NAME)' },
            });
          } catch (sessionError) {
            console.warn(`named session 시작 실패, 기본 세션으로 진행: ${sessionError.message}`);
          }
        }
        return new ContextStore(client, transport);
      } catch (error) {
        lastError = error;
        try { await transport.close(); } catch { /* 이미 닫힘 */ }
      }
    }
    throw lastError ?? new Error('no server spec available');
  }

  async callTool(name, args) {
    const result = await this.client.callTool({ name, arguments: args });

    if (result?.isError) {
      throw new Error(firstText(result) || `${name} failed`);
    }

    return result;
  }

  async storeFact(fact) {
    const normalized = validateFact(fact);

    assertSafe(normalized.statement, 'distilled_fact');

    await this.callTool(TOOL_SAVE, {
      key: normalized.dedupe_key,
      value: JSON.stringify(normalized),
      category: normalized.fact_type,
      channel: normalizeScope(normalized.scope),
    });

    // Phase 5: 영구 팩트는 사서(Letta "The Noticer") outbox에 큐잉된다.
    // fail-safe — 큐잉 실패가 로컬 저장을 실패시키지 않는다.
    await queueForLibrarian(normalized);

    return normalized;
  }
  async saveFactValidated(fact, { queueLibrarian = false } = {}) {
    const normalized = validateFact(fact);

    assertSafe(normalized.statement, 'distilled_fact');

    await this.callTool(TOOL_SAVE, {
      key: normalized.dedupe_key,
      value: JSON.stringify(normalized),
      category: normalized.fact_type,
      channel: normalizeScope(normalized.scope),
    });

    if (queueLibrarian) {
      await queueForLibrarian(normalized);
    }

    return normalized;
  }


  async getFacts({ scope } = {}) {
    const result = await this.callTool(TOOL_GET, {
      channel: normalizeScope(scope),
      includeMetadata: true,
      limit: 100,
    });

    return factsFromItems(parseItems(result));
  }
  async getFactsPaged({ scope } = {}) {
    return factsFromItems(await getItemsPaged(this, { scope }));
  }


  async searchFacts(query, { scope } = {}) {
    const result = await this.callTool(TOOL_SEARCH, {
      query,
      searchIn: ['value'],
      channel: normalizeScope(scope),
      includeMetadata: true,
      limit: 100,
    });

    return factsFromItems(parseItems(result));
  }

  /**
   * 채널의 raw row를 그대로 반환한다 (검역 스윕 + reconcile 정규화용).
   * DistilledFact 파싱/검증 없이 {key, value, category, channel, created_at, updated_at}
   * 수준으로 노출한다. created_at/updated_at은 스토어 메타데이터(SQLite 포맷)이며
   * reconcile 정규화가 결정론적 타임스탬프 출처로 사용한다.
   */
  async getRawItems({ scope } = {}) {
    const result = await this.callTool(TOOL_GET, {
      channel: normalizeScope(scope),
      includeMetadata: true,
      limit: 100,
    });

    return parseItems(result).map((item) => ({
      key: item.key,
      value: item.value,
      category: item.category,
      channel: item.channel,
      created_at: item.created_at,
      updated_at: item.updated_at,
    }));
  }
  async getRawItemsPaged({ scope } = {}) {
    return (await getItemsPaged(this, { scope })).map((item) => ({
      key: item.key,
      value: item.value,
      category: item.category,
      channel: item.channel,
      created_at: item.created_at,
      updated_at: item.updated_at,
    }));
  }

  async getChannels() {
    const channels = new Set();

    for (const { channel } of await this.getRawItemsPaged()) {
      if (typeof channel === 'string') {
        channels.add(channel);
      }
    }

    return [...channels];
  }

  /**
   * raw row를 동일 key로 덮어쓴다 (검역 스윕의 redact 재저장 전용).
   * 비밀 게이트를 우회하지 않도록 저장 전 scanSecrets 재검사로 fail-closed 보장.
   */
  async overwriteRaw({ key, value, scope, category }) {
    const scan = scanSecrets(value);
    if (scan.found) {
      throw new Error(`overwriteRaw rejected: value still contains secrets (${scan.patterns.join(',')})`);
    }
    await this.callTool(TOOL_SAVE, {
      key,
      value,
      category,
      channel: normalizeScope(scope),
    });
  }

  async close() {
    try {
      await this.client.close();
    } finally {
      await this.transport.close().catch(() => {});
    }
  }
}
