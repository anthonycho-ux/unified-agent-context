import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { SERVER_SPEC } from './config.mjs';
import { validateFact } from './schema.mjs';
import { assertSafe } from './secret-gate.mjs';

const TOOL_SAVE = 'context_save';
const TOOL_GET = 'context_get';
const TOOL_SEARCH = 'context_search';

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

  static async connect(serverSpec = SERVER_SPEC) {
    const client = new Client(
      { name: 'unified-agent-context', version: '0.1.0' },
      { capabilities: {} },
    );
    const transport = new StdioClientTransport({
      ...serverSpec,
      env: { ...process.env, ...serverSpec.env },
      stderr: 'ignore',
    });

    await client.connect(transport);
    return new ContextStore(client, transport);
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

  async close() {
    try {
      await this.client.close();
    } finally {
      await this.transport.close().catch(() => {});
    }
  }
}
