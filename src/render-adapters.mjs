export const AGENT_IDS = Object.freeze([
  'generic',
  'claude-code',
  'codex',
  'hermes',
  'aside',
  'gajaecode',
  'lettacode',
]);

const ADAPTERS = Object.freeze({
  generic: {
    title: 'generic',
    tags: null,
    render: renderGeneric,
  },
  'claude-code': {
    title: 'Claude Code',
    tags: ['coding', 'git', 'repo', 'terminal', 'test', 'docs', 'infra'],
    render: (context) => renderCodingAgent(context, 'Claude Code'),
  },
  codex: {
    title: 'Codex',
    tags: ['coding', 'git', 'repo', 'terminal', 'test', 'docs', 'infra'],
    render: (context) => renderCodingAgent(context, 'Codex'),
  },
  gajaecode: {
    title: 'Gajae Code',
    tags: ['coding', 'git', 'repo', 'terminal', 'test', 'docs', 'infra'],
    render: (context) => renderCodingAgent(context, 'Gajae Code'),
  },
  lettacode: {
    title: 'Letta Code',
    tags: ['coding', 'git', 'repo', 'terminal', 'test', 'docs', 'infra'],
    render: (context) => renderCodingAgent(context, 'Letta Code'),
  },
  aside: {
    title: 'Aside',
    tags: ['browser', 'web', 'site', 'ui', 'workflow', 'status'],
    render: renderAside,
  },
  hermes: {
    title: 'Hermes',
    tags: ['kanban', 'status', 'workflow', 'handoff', 'infra'],
    render: renderHermes,
  },
});

const SHARED_TAGS = new Set(['all', 'shared', 'global', 'preference', 'decision', 'project']);

function formatType(type) {
  return String(type).replaceAll('_', ' ');
}

function formatTypeTitle(type) {
  return formatType(type).replace(/\b\w/g, (char) => char.toUpperCase());
}

function hasRelevantTag(fact, adapter) {
  if (adapter.tags === null) return true;
  const tags = Array.isArray(fact.tags) ? fact.tags : [];
  if (tags.length === 0) return true;
  return tags.some((tag) => SHARED_TAGS.has(tag) || adapter.tags.includes(tag));
}

function filterFacts(facts, adapter) {
  return facts.filter((fact) => hasRelevantTag(fact, adapter));
}

function splitFacts(facts) {
  return {
    globalFacts: facts.filter((fact) => fact.scope === 'global'),
    projectFacts: facts.filter((fact) => fact.scope !== 'global'),
  };
}

export function normalizeAgentId(agentId = 'generic') {
  const normalized = String(agentId || 'generic').trim();
  if (!AGENT_IDS.includes(normalized)) {
    throw new Error(`Unsupported UAC agent "${normalized}". Expected one of: ${AGENT_IDS.join(', ')}`);
  }
  return normalized;
}

export function renderContextBlock({ agentId = 'generic', projectScope, globalFacts, projectFacts }) {
  const normalizedAgentId = normalizeAgentId(agentId);
  const adapter = ADAPTERS[normalizedAgentId];
  const facts = filterFacts([...globalFacts, ...projectFacts], adapter);
  const split = splitFacts(facts);
  return adapter.render({
    projectScope: projectScope ?? 'global',
    globalFacts: split.globalFacts,
    projectFacts: split.projectFacts,
    adapter,
  });
}

export function relevantFactsForAgent(agentId, facts) {
  const adapter = ADAPTERS[normalizeAgentId(agentId)];
  return filterFacts(facts, adapter);
}

function renderGeneric({ projectScope, globalFacts, projectFacts }) {
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

function renderCodingAgent({ projectScope, globalFacts, projectFacts, adapter }) {
  const lines = [
    `## UAC Shared Context for ${adapter.title}`,
    '',
    'Conflict rule: shared facts win for facts; local agent files win for style.',
    '',
  ];
  if (globalFacts.length === 0 && projectFacts.length === 0) {
    lines.push('_No relevant shared facts yet._');
    return lines.join('\n');
  }
  if (globalFacts.length > 0) {
    lines.push('### Global Preferences');
    for (const fact of globalFacts) lines.push(`- ${fact.statement}`);
    lines.push('');
  }
  if (projectFacts.length > 0) {
    lines.push(`### Project Facts (${projectScope})`);
    for (const fact of projectFacts) lines.push(`- ${formatTypeTitle(fact.fact_type)}: ${fact.statement}`);
  }
  return lines.join('\n').trimEnd();
}

function renderAside({ projectScope, globalFacts, projectFacts }) {
  const lines = [
    '## UAC Shared Context for Aside',
    '',
    '**DECIDE:** Treat these as shared facts only; Aside local voice and browser workflow stay local.',
    '',
  ];
  if (globalFacts.length === 0 && projectFacts.length === 0) {
    lines.push('**No action needed.** No relevant shared facts yet.');
    return lines.join('\n');
  }
  if (globalFacts.length > 0) {
    lines.push('### Relevant Global Facts');
    for (const fact of globalFacts) lines.push(`- ${fact.statement}`);
    lines.push('');
  }
  if (projectFacts.length > 0) {
    lines.push(`### Relevant Project Facts (${projectScope})`);
    for (const fact of projectFacts) lines.push(`- ${formatType(fact.fact_type)}: ${fact.statement}`);
  }
  return lines.join('\n').trimEnd();
}

function renderHermes({ projectScope, globalFacts, projectFacts }) {
  const lines = [
    '## UAC Shared Context for Hermes',
    '',
    'Status note: shared store is authoritative for facts; Hermes persona remains local.',
    '',
  ];
  if (globalFacts.length === 0 && projectFacts.length === 0) {
    lines.push('- No relevant shared facts yet.');
    return lines.join('\n');
  }
  if (globalFacts.length > 0) {
    lines.push('### Global Signals');
    for (const fact of globalFacts) lines.push(`- ${fact.statement}`);
    lines.push('');
  }
  if (projectFacts.length > 0) {
    lines.push(`### Board / Project Signals (${projectScope})`);
    for (const fact of projectFacts) lines.push(`- ${formatType(fact.fact_type)} | ${fact.statement}`);
  }
  return lines.join('\n').trimEnd();
}
