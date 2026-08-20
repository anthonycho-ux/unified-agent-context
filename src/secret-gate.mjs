const ALLOWED_PATHS = new Set([
  'distilled_fact',
  'cold_archive',
  'explicit_write',
  'auto_distill',
  'archive_ingest',
]);

const SECRET_PATTERNS = [
  {
    name: 'pem_private_key',
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  {
    name: 'aws_akia_key',
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    name: 'sk_api_key',
    regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    name: 'bearer_token',
    regex: /\bbearer\s+[A-Za-z0-9._~+/-]{12,}={0,2}\b/gi,
  },
  {
    name: 'api_key_assignment',
    regex: /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|token)\b\s*[:=]\s*["']?(?!\s*(?:true|false|null|undefined)\b)[A-Za-z0-9._~+/-]{8,}={0,2}["']?/gi,
  },
  {
    name: 'password_assignment',
    regex: /\bpassword\b\s*[:=]\s*["']?[^"'\s]{3,}["']?/gi,
  },
  {
    name: 'env_secret_assignment',
    regex: /^\s*(?:export\s+)?[A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD)[A-Z0-9_]*\s*=\s*["']?[^"'\s#]{4,}["']?/gmi,
  },
  {
    name: 'github_pat',
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  },
  {
    name: 'google_api_key',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    name: 'slack_token',
    regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g,
  },
  {
    name: 'stripe_key',
    regex: /\b[sr]k_(?:live|test)_[0-9A-Za-z]{16,}\b/g,
  },
  {
    name: 'jwt_token',
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    name: 'sendgrid_key',
    regex: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g,
  },
  {
    name: 'high_entropy_hex',
    regex: /\b[0-9a-f]{32,}\b/gi,
  },
  {
    name: 'base64_credential',
    regex: /\b(?:secret|token|key|password|credential)\b[^\n]{0,40}\b[A-Za-z0-9+/]{40,}={0,2}\b/gi,
  },
];

export class SecretBlockedError extends Error {
  constructor(patterns, message = 'Secret-like content blocked') {
    super(message);
    this.name = 'SecretBlockedError';
    this.patterns = [...patterns];
  }
}

function unique(items) {
  return [...new Set(items)];
}

function toText(text) {
  return typeof text === 'string' ? text : String(text ?? '');
}

export function scanSecrets(text) {
  const input = toText(text);
  const patterns = [];

  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(input)) {
      patterns.push(pattern.name);
    }
  }

  return { found: patterns.length > 0, patterns: unique(patterns) };
}

export function assertSafe(text, path) {
  if (!ALLOWED_PATHS.has(path)) {
    throw new SecretBlockedError(['invalid_gate_path'], `Unknown secret gate path: ${path}`);
  }

  const result = scanSecrets(text);
  if (result.found) {
    throw new SecretBlockedError(result.patterns);
  }
}

export function redactSecrets(text) {
  let redacted = toText(text);

  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    redacted = redacted.replace(pattern.regex, `[REDACTED:${pattern.name}]`);
  }

  return redacted;
}
