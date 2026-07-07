import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

export const DATA_DIR = process.env.UAC_DATA_DIR ?? path.join(repoRoot, 'data', 'memory');
export const ARCHIVE_DIR = process.env.UAC_ARCHIVE_DIR ?? path.join(repoRoot, 'data', 'archive');

export function resolveProjectId(cwd = process.cwd()) {
  const absoluteCwd = path.resolve(cwd);

  try {
    const gitRoot = execFileSync('git', ['-C', absoluteCwd, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    if (gitRoot) {
      return path.basename(gitRoot);
    }
  } catch {
    // Git이 없거나 저장소가 아니면 cwd 이름으로 폴백한다.
  }

  return path.basename(absoluteCwd);
}

export const SERVER_SPEC = {
  command: 'node',
  // UAC_SERVER_ENTRY: 테스트/교체용 서버 엔트리 오버라이드 (MCP 표준 스폰 스펙만 노출 — P3 결합 금지 유지).
  args: [process.env.UAC_SERVER_ENTRY ?? path.join(repoRoot, 'node_modules', 'mcp-memory-keeper', 'dist', 'index.js')],
  env: { DATA_DIR },
};
