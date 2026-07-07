#!/usr/bin/env node
// claude code SessionEnd 훅: 세션 transcript를 자동 증류한다.
// stdin: claude hook JSON payload {session_id, transcript_path, cwd, ...}
import fs from 'node:fs/promises';
import { distillSession } from '../src/distiller.mjs';
import { sweepQuarantine } from '../src/quarantine.mjs';
import { ContextStore } from '../src/store-adapter.mjs';
import { resolveProjectId } from '../src/config.mjs';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

try {
  const payload = JSON.parse(await readStdin());
  const transcriptPath = payload.transcript_path;
  if (!transcriptPath) process.exit(0);

  // claude transcript는 JSONL — 사용자/어시스턴트 텍스트만 평문으로 취합.
  const raw = await fs.readFile(transcriptPath, 'utf8').catch(() => '');
  if (!raw.trim()) process.exit(0);

  const lines = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      const content = entry?.message?.content;
      if (typeof content === 'string') lines.push(content);
      else if (Array.isArray(content)) {
        for (const part of content) if (part?.type === 'text' && part.text) lines.push(part.text);
      }
    } catch {
      // non-JSON line — skip
    }
  }
  const text = lines.join('\n');
  if (!text.trim()) process.exit(0);

  const scope = `project:${resolveProjectId(payload.cwd ?? process.cwd())}`;
  const store = await ContextStore.connect();
  try {
    await distillSession({ content: text, scope, sessionId: payload.session_id ?? 'claude-session', store });
    await sweepQuarantine({ scope, store });
  } finally {
    await store.close().catch(() => {});
  }
  process.exit(0);
} catch (error) {
  // 세션 종료는 방해하지 않되, 실패는 구조화 로그로 남긴다 (조용한 스킵 금지).
  try {
    const fsp = await import('node:fs/promises');
    const pathMod = await import('node:path');
    const file = process.env.UAC_LOG_PATH ?? new URL('../data/logs/injector.log', import.meta.url).pathname;
    await fsp.default.mkdir(pathMod.default.dirname(file), { recursive: true });
    await fsp.default.appendFile(
      file,
      `${JSON.stringify({ ts: new Date().toISOString(), event: 'session_end_distill_failed', reason: error?.message ?? String(error) })}\n`,
      'utf8',
    );
  } catch {
    process.stderr.write(`[uac-distill] session-end distill failed: ${error?.message ?? error}\n`);
  }
  process.exit(0);
}
