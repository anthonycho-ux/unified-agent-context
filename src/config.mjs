import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

// "~/..."을 실제 홈 디렉터리로 확장 (설정 파일을 기기 독립적으로 유지).
function expandHome(p) {
  if (typeof p !== 'string') return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

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

/**
 * 스토어 위치 해석 (Phase 6 — 기기 독립 접근).
 *
 * 우선순위:
 * 1. UAC_SERVER_ENTRY / UAC_DATA_DIR (테스트·명시 오버라이드) → 로컬 스폰
 * 2. UAC_REMOTE=0 → 로컬 스폰 (탈출구)
 * 3. uac.config.json의 store 블록:
 *    - host가 'local'이면 해당 dataDir로 로컬 스폰 (정본 보유 기기 = store-host)
 *    - host가 원격이면 ssh 너머 stdio-MCP 스폰 (Tailscale ssh 키 재사용, 신규 인증 없음)
 * 4. 아무것도 없으면 레거시 로컬 스폰
 */
function resolveServerSpec() {
  const localEntry = process.env.UAC_SERVER_ENTRY ?? path.join(repoRoot, 'node_modules', 'mcp-memory-keeper', 'dist', 'index.js');
  const localSpec = { command: 'node', args: [localEntry], env: { DATA_DIR } };

  if (process.env.UAC_SERVER_ENTRY || process.env.UAC_DATA_DIR || process.env.UAC_REMOTE === '0') {
    return [localSpec];
  }

  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'uac.config.json'), 'utf8'));
  } catch {
    return [localSpec];
  }

  const store = cfg?.store;
  if (!store?.entry || !store?.dataDir) {
    return [localSpec];
  }

  const localStoreSpec = { command: 'node', args: [store.entry], env: { DATA_DIR: expandHome(store.dataDir) } };

  // 명시 오버라이드: UAC_STORE_HOST가 있으면 그 호스트만 사용 (폴백 없음).
  const overrideHost = process.env.UAC_STORE_HOST;
  if (overrideHost) {
    return overrideHost === 'local' ? [localStoreSpec] : [sshSpec(overrideHost, store)];
  }

  if (!store.host || store.host === 'local') {
    return [localStoreSpec];
  }

  // 우선순위: store.host → store.fallbackHosts[] (첫 연결 성공을 사용).
  // Tailscale이 켜져 있는 경우가 많아 store-host-ts를 우선하고 LAN store-host를 폴백으로 두면,
  // Tailscale on/off 상태와 무관하게 기록이 실패하지 않는다.
  const hosts = [store.host, ...(Array.isArray(store.fallbackHosts) ? store.fallbackHosts : [])]
    .filter((h, i, arr) => h && h !== 'local' && arr.indexOf(h) === i);
  return hosts.map((h) => sshSpec(h, store));
}

// 원격 store-host 스토어에 ssh 너머 stdio-MCP를 스폰하는 스펙 한 개.
function sshSpec(host, store) {
  return {
    command: 'ssh',
    args: [
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=10',
      host,
      `DATA_DIR='${expandHome(store.dataDir)}' exec node '${store.entry}'`,
    ],
    env: {},
  };
}
export function localSpec({ dataDir = process.env.UAC_LOCAL_DATA_DIR ?? DATA_DIR } = {}) {
  const localEntry = process.env.UAC_SERVER_ENTRY ?? path.join(repoRoot, 'node_modules', 'mcp-memory-keeper', 'dist', 'index.js');

  return {
    command: 'node',
    args: [localEntry],
    env: { DATA_DIR: dataDir },
  };
}

export function sovSpecs() {
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'uac.config.json'), 'utf8'));
  } catch {
    return [];
  }

  const store = cfg?.store;
  if (!store?.entry || !store?.dataDir) {
    return [];
  }

  const overrideHost = process.env.UAC_STORE_HOST;
  if (overrideHost) {
    return overrideHost === 'local' ? [] : [sshSpec(overrideHost, store)];
  }

  if (!store.host || store.host === 'local') {
    return [];
  }

  const hosts = [store.host, ...(Array.isArray(store.fallbackHosts) ? store.fallbackHosts : [])]
    .filter((host, index, allHosts) => host && host !== 'local' && allHosts.indexOf(host) === index);
  return hosts.map((host) => sshSpec(host, store));
}

export function makeLocalSpec(dataDir) {
  return localSpec({ dataDir });
}

// 후보 스펙 목록 (우선순위 순). 첫 성공 연결을 store-adapter가 사용한다.
export const SERVER_SPECS = resolveServerSpec();
// 하위 호환: 단일 스펙 소비자를 위해 최우선 후보를 그대로 노출한다.
export const SERVER_SPEC = SERVER_SPECS[0];
