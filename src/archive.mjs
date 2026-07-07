import fs from 'node:fs/promises';
import path from 'node:path';

import { ARCHIVE_DIR } from './config.mjs';
import { redactSecrets, scanSecrets } from './secret-gate.mjs';

function sanitizeScope(scope) {
  return String(scope).replace(/[^a-zA-Z0-9._-]+/g, '--');
}

export async function archiveConversation({ scope, sessionId, content }) {
  const scan = scanSecrets(content);
  const safeContent = scan.found ? redactSecrets(content) : content;
  const dir = path.join(ARCHIVE_DIR, sanitizeScope(scope));
  const archivePath = path.join(dir, 'archive.jsonl');
  const record = {
    ts: new Date().toISOString(),
    scope,
    sessionId,
    content: safeContent,
  };

  await fs.mkdir(dir, { recursive: true });
  await fs.appendFile(archivePath, `${JSON.stringify(record)}\n`, 'utf8');

  return { path: archivePath, redacted: scan.found };
}
