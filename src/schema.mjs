import { createHash } from 'node:crypto';

export const RETENTION_BY_FACT_TYPE = Object.freeze({
  decision: 'permanent',
  preference: 'permanent',
  project_state: 'days90',
  summary: 'days180',
  note: 'days180',
});

const FACT_TYPES = new Set(['decision', 'preference', 'project_state']);
const RETENTION_CLASSES = new Set(['permanent', 'days90', 'days180']);
const SENSITIVITY_CLASSES = new Set(['normal', 'sensitive']);
const TAG_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

export class SchemaError extends Error {
  constructor(issues) {
    super('Invalid distilled fact');
    this.name = 'SchemaError';
    this.issues = issues;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isIsoDate(value) {
  if (typeof value !== 'string') return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function dedupeKey(statement, scope) {
  return createHash('sha256').update(`${statement}${scope}`).digest('hex').slice(0, 16);
}

function validateScope(scope) {
  return scope === 'global' || (typeof scope === 'string' && /^project:.+/.test(scope));
}

export function validateFact(obj) {
  const issues = [];

  if (!isPlainObject(obj)) {
    throw new SchemaError([{ path: '', message: 'fact must be an object' }]);
  }

  const required = [
    'statement',
    'fact_type',
    'scope',
    'created_at',
    'updated_at',
    'source_ref',
    'dedupe_key',
    'retention_class',
    'sensitivity_class',
  ];

  for (const field of required) {
    if (!(field in obj)) {
      issues.push({ path: field, message: 'is required' });
    }
  }

  if ('statement' in obj && (typeof obj.statement !== 'string' || obj.statement.trim() === '')) {
    issues.push({ path: 'statement', message: 'must be a non-empty string' });
  }

  if ('fact_type' in obj && !FACT_TYPES.has(obj.fact_type)) {
    issues.push({ path: 'fact_type', message: 'must be decision, preference, or project_state' });
  }

  if ('scope' in obj && !validateScope(obj.scope)) {
    issues.push({ path: 'scope', message: 'must be global or project:<id>' });
  }

  for (const field of ['created_at', 'updated_at']) {
    if (field in obj && !isIsoDate(obj[field])) {
      issues.push({ path: field, message: 'must be an ISO timestamp' });
    }
  }

  for (const field of ['source_ref', 'dedupe_key']) {
    if (field in obj && (typeof obj[field] !== 'string' || obj[field].trim() === '')) {
      issues.push({ path: field, message: 'must be a non-empty string' });
    }
  }

  if ('retention_class' in obj && !RETENTION_CLASSES.has(obj.retention_class)) {
    issues.push({ path: 'retention_class', message: 'must be permanent, days90, or days180' });
  }

  if (
    'fact_type' in obj &&
    FACT_TYPES.has(obj.fact_type) &&
    'retention_class' in obj &&
    RETENTION_CLASSES.has(obj.retention_class) &&
    obj.retention_class !== RETENTION_BY_FACT_TYPE[obj.fact_type]
  ) {
    issues.push({ path: 'retention_class', message: `must be ${RETENTION_BY_FACT_TYPE[obj.fact_type]} for ${obj.fact_type}` });
  }

  if ('sensitivity_class' in obj && !SENSITIVITY_CLASSES.has(obj.sensitivity_class)) {
    issues.push({ path: 'sensitivity_class', message: 'must be normal or sensitive' });
  }

  if ('tags' in obj) {
    if (!Array.isArray(obj.tags)) {
      issues.push({ path: 'tags', message: 'must be an array of tag strings' });
    } else {
      for (const [index, tag] of obj.tags.entries()) {
        if (typeof tag !== 'string' || !TAG_PATTERN.test(tag)) {
          issues.push({ path: `tags.${index}`, message: 'must match /^[a-z][a-z0-9_-]{0,31}$/' });
        }
      }
    }
  }

  if (issues.length > 0) {
    throw new SchemaError(issues);
  }

  const normalized = {
    statement: obj.statement,
    fact_type: obj.fact_type,
    scope: obj.scope,
    created_at: obj.created_at,
    updated_at: obj.updated_at,
    source_ref: obj.source_ref,
    dedupe_key: obj.dedupe_key,
    retention_class: obj.retention_class,
    sensitivity_class: obj.sensitivity_class,
  };

  if (Array.isArray(obj.tags) && obj.tags.length > 0) {
    normalized.tags = [...new Set(obj.tags)].sort();
  }

  return normalized;
}

export function makeFact(partial) {
  if (!isPlainObject(partial)) {
    throw new SchemaError([{ path: '', message: 'fact partial must be an object' }]);
  }

  const createdAt = partial.created_at ?? new Date().toISOString();
  const scope = partial.scope ?? 'global';
  const factType = partial.fact_type ?? 'project_state';
  const statement = partial.statement;
  const retentionClass = partial.retention_class ?? RETENTION_BY_FACT_TYPE[factType];

  return validateFact({
    ...partial,
    fact_type: factType,
    scope,
    created_at: createdAt,
    updated_at: partial.updated_at ?? createdAt,
    source_ref: partial.source_ref ?? 'unknown',
    dedupe_key: partial.dedupe_key ?? (typeof statement === 'string' ? dedupeKey(statement, scope) : undefined),
    retention_class: retentionClass,
    sensitivity_class: partial.sensitivity_class ?? 'normal',
  });
}
