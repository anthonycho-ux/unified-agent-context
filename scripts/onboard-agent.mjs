#!/usr/bin/env node
// unified-agent-context 신규 하네스 온보닝 도구.
// 사용: node scripts/onboard-agent.mjs --harness <이름> [--dry-run]
//        node scripts/onboard-agent.mjs --list
// 각 어댑터는 멱등이다 — 이미 배선된 항목은 "already wired"로 건너뛴다.
// --dry-run은 계획만 출력하고 아무것도 쓰지 않는다. 실제 쓰기 전에는 항상 .bak-uac-<date> 백업.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const UAC = path.resolve(new URL('..', import.meta.url).pathname);
const SERVER = path.join(UAC, 'node_modules/mcp-memory-keeper/dist/index.js');
const DATA_DIR = path.join(UAC, 'data/memory');
const INJECTOR = path.join(UAC, 'scripts/inject-context.mjs');

// 테스트 격리용 홈 오버라이드 (UAC_ONBOARD_HOME > HOME)
const HOME = process.env.UAC_ONBOARD_HOME || os.homedir();

const dateStamp = () => new Date().toISOString().slice(0, 10).replaceAll('-', '');

async function readOrNull(p) {
  try { return await fs.readFile(p, 'utf8'); } catch { return null; }
}

async function backupOnce(p, ctx) {
  if (ctx.backedUp.has(p)) return;
  if ((await readOrNull(p)) !== null) {
    const dest = `${p}.bak-uac-${dateStamp()}`;
    if (!ctx.dryRun) await fs.copyFile(p, dest);
    ctx.log.push(`  backup: ${p} → ${dest}`);
  }
  ctx.backedUp.add(p);
}

/** 텍스트 파일에 marker가 없으면 block을 추가(또는 markerLine 앞에 삽입)한다. */
async function ensureTextBlock({ file, marker, block, insertBefore }, ctx) {
  const cur = await readOrNull(file);
  if (cur !== null && cur.includes(marker)) {
    ctx.log.push(`  already wired: ${file} (marker: ${marker})`);
    return false;
  }
  let next;
  if (cur === null) {
    next = block.endsWith('\n') ? block : block + '\n';
  } else if (insertBefore && cur.includes(insertBefore)) {
    next = cur.replace(insertBefore, block + '\n' + insertBefore);
  } else {
    next = cur.replace(/\n?$/, '\n\n') + block + '\n';
  }
  if (ctx.dryRun) {
    ctx.log.push(`  would write: ${file}\n${indent(block)}`);
    return true;
  }
  await backupOnce(file, ctx);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, next);
  ctx.log.push(`  wrote: ${file}`);
  return true;
}

/** JSON 파일을 읽어 mutate(obj)로 갱신한다. marker가 이미 있으면 건너뛴다. */
async function ensureJsonBlock({ file, marker, base, mutate }, ctx) {
  const cur = await readOrNull(file);
  if (cur !== null && cur.includes(marker)) {
    ctx.log.push(`  already wired: ${file} (marker: ${marker})`);
    return false;
  }
  let obj = base();
  if (cur !== null) {
    try { obj = JSON.parse(cur); } catch {
      ctx.log.push(`  SKIP: ${file} — JSON 파손, 수동 확인 필요`);
      return false;
    }
  }
  mutate(obj);
  const next = JSON.stringify(obj, null, 2) + '\n';
  if (ctx.dryRun) {
    ctx.log.push(`  would write: ${file}\n${indent(next)}`);
    return true;
  }
  await backupOnce(file, ctx);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, next);
  ctx.log.push(`  wrote: ${file}`);
  return true;
}

/** 설정 파일 직접 편집이 위험한 경우 — 안남만 출력한다. */
function manualStep(text, ctx) {
  ctx.log.push(`  MANUAL: ${text}`);
  return false;
}

const indent = (s) => s.split('\n').map((l) => '    | ' + l).join('\n');

const KIMI_HOOK = path.join(UAC, 'scripts/kimi-user-prompt-hook.sh');

// ---------------------------------------------------------------------------
// 어댑터 레지스트리
// ---------------------------------------------------------------------------
export const adapters = {
  kimi: {
    description: 'Kimi Code CLI — mcp.json + UserPromptSubmit 훅 + ~/.agents/AGENTS.md 지시 폴백',
    steps: [
      {
        label: 'MCP unified-memory (~/.kimi-code/mcp.json)',
        run: (ctx) => ensureJsonBlock({
          file: path.join(HOME, '.kimi-code/mcp.json'),
          marker: 'unified-memory',
          base: () => ({ mcpServers: {} }),
          mutate: (obj) => {
            obj.mcpServers ??= {};
            obj.mcpServers['unified-memory'] = {
              command: 'node',
              args: [SERVER],
              env: { DATA_DIR },
            };
          },
        }, ctx),
      },
      {
        label: 'UserPromptSubmit 훅 (~/.kimi-code/config.toml)',
        run: (ctx) => ensureTextBlock({
          file: path.join(HOME, '.kimi-code/config.toml'),
          marker: 'kimi-user-prompt-hook.sh',
          insertBefore: '# >>> orca-managed-kimi-hooks',
          block:
            '[[hooks]]\n' +
            'event = "UserPromptSubmit"\n' +
            `command = "${KIMI_HOOK}"\n` +
            'timeout = 15\n',
        }, ctx),
      },
      {
        label: '지시 폴백 (~/.agents/AGENTS.md)',
        run: (ctx) => ensureTextBlock({
          file: path.join(HOME, '.agents/AGENTS.md'),
          marker: 'inject-context.mjs',
          block:
            '- UAC shared memory (unified-agent-context): if no "공유 컨텍스트 (unified-agent-context)" block was injected at session start, run `node ' + INJECTOR + ' --cwd $PWD` and read it before the first request. Record confirmed decisions/preferences with `node ' + path.join(UAC, 'scripts/record-fact.mjs') + ' --type decision|preference "..."` or MCP unified-memory `context_save` — channel `global` for user-wide prefs, `project:<git-root-basename>` for project decisions. Never store API keys/tokens/credentials in shared memory.',
        }, ctx),
      },
    ],
  },

  codex: {
    description: 'Codex CLI — config.toml MCP + AGENTS.md 지시 pull (훅 부재, 문서화된 제약)',
    steps: [
      {
        label: 'MCP unified-memory (~/.codex/config.toml)',
        run: (ctx) => ensureTextBlock({
          file: path.join(HOME, '.codex/config.toml'),
          marker: 'mcp_servers.unified-memory',
          block:
            '[mcp_servers.unified-memory]\n' +
            'command = "node"\n' +
            `args = ["${SERVER}"]\n` +
            `env = { DATA_DIR = "${DATA_DIR}" }\n`,
        }, ctx),
      },
      {
        label: '지시 pull (~/.codex/AGENTS.md)',
        run: (ctx) => ensureTextBlock({
          file: path.join(HOME, '.codex/AGENTS.md'),
          marker: '공유 컨텍스트 (unified-agent-context)',
          block:
            '\n## 공유 컨텍스트 (unified-agent-context)\n\n' +
            '세션 시작 시(첫 사용자 요청 처리 전) 반드시 다음을 수행하라:\n' +
            '1. `unified-memory` MCP 서버의 `context_get` 도구를 channel="global"로 호출해 전역 선호를 읽는다.\n' +
            '2. 현재 작업 디렉토리의 프로젝트 이름(git root basename)으로 channel="project:<이름>"을 `context_get` 호출해 프로젝트 결정을 읽는다.\n' +
            '3. 세션 중 중요한 결정/선호가 확정되면 `context_save`(category=decision|preference, channel=해당 스코프)로 기록한다.\n' +
            '4. API 키·토큰·자격증명은 절대 공유 메모리에 저장하지 않는다.',
        }, ctx),
      },
    ],
  },

  gjc: {
    description: 'Gajae Code (GJC) — mcp.json + rules 지시 pull',
    steps: [
      {
        label: 'MCP unified-memory (~/.gjc/agent/mcp.json)',
        run: (ctx) => ensureJsonBlock({
          file: path.join(HOME, '.gjc/agent/mcp.json'),
          marker: 'unified-memory',
          base: () => ({ mcpServers: {} }),
          mutate: (obj) => {
            obj.mcpServers ??= {};
            obj.mcpServers['unified-memory'] = {
              type: 'stdio',
              command: 'node',
              args: [SERVER],
              env: { DATA_DIR },
            };
          },
        }, ctx),
      },
      {
        label: '공유 컨텍스트 rule (~/.gjc/agent/rules/uac-shared-context.md)',
        run: (ctx) => ensureTextBlock({
          file: path.join(HOME, '.gjc/agent/rules/uac-shared-context.md'),
          marker: 'inject-context.mjs',
          block:
            '# 공유 컨텍스트 (unified-agent-context)\n\n' +
            '세션 시작 시(첫 사용자 요청 처리 전) `node ' + INJECTOR + ' --cwd $PWD`를 실행해 공유 컨텍스트 블록을 읽는다. ' +
            '세션 중 확정된 결정/선호는 `context_save`(channel=global|project:<git-root-basename>)로 기록한다. ' +
            'API 키·토큰·자격증명은 절대 저장하지 않는다.',
        }, ctx),
      },
    ],
  },

  hermes: {
    description: 'Hermes — pre_llm_call 훅 + MCP (config.yaml)',
    steps: [
      {
        label: 'pre_llm_call 훅 (~/.hermes/config.yaml)',
        run: async (ctx) => {
          const file = path.join(HOME, '.hermes/config.yaml');
          const cur = await readOrNull(file);
          if (cur !== null && cur.includes('hermes-pre-llm-hook.sh')) {
            ctx.log.push('  already wired: hermes hook');
            return false;
          }
          if (cur !== null && /^hooks:/m.test(cur)) {
            return manualStep('config.yaml에 hooks: 블록이 이미 있음 — pre_llm_call 항목을 수동 추가하거나 온보닝 문서 §2-A 참조', ctx);
          }
          return ensureTextBlock({
            file,
            marker: 'hermes-pre-llm-hook.sh',
            block:
              'hooks:\n' +
              '  pre_llm_call:\n' +
              `    - command: ${path.join(UAC, 'scripts/hermes-pre-llm-hook.sh')}\n` +
              '      timeout: 20\n',
          }, ctx);
        },
      },
      {
        label: 'MCP unified-memory (~/.hermes/config.yaml)',
        run: async (ctx) => {
          const file = path.join(HOME, '.hermes/config.yaml');
          const cur = await readOrNull(file);
          if (cur !== null && cur.includes('unified-memory')) {
            ctx.log.push('  already wired: hermes MCP');
            return false;
          }
          if (cur !== null && /^mcp_servers:/m.test(cur)) {
            return manualStep('config.yaml에 mcp_servers: 블록이 이미 있음 — unified-memory 항목을 수동 추가', ctx);
          }
          return ensureTextBlock({
            file,
            marker: 'unified-memory',
            block:
              'mcp_servers:\n' +
              '  unified-memory:\n' +
              '    command: node\n' +
              '    args:\n' +
              `      - ${SERVER}\n` +
              '    env:\n' +
              `      DATA_DIR: ${DATA_DIR}\n` +
              '    enabled: true\n',
          }, ctx);
        },
      },
    ],
  },

  claude: {
    description: 'Claude Code — SessionStart 훅 (settings.json) + MCP (CLI 등록)',
    steps: [
      {
        label: 'SessionStart 훅 (~/.claude/settings.json)',
        run: (ctx) => ensureJsonBlock({
          file: path.join(HOME, '.claude/settings.json'),
          marker: 'inject-context.mjs',
          base: () => ({ hooks: {} }),
          mutate: (obj) => {
            obj.hooks ??= {};
            obj.hooks.SessionStart ??= [];
            obj.hooks.SessionStart.push({
              hooks: [{ type: 'command', command: `node ${INJECTOR}` }],
            });
          },
        }, ctx),
      },
      {
        label: 'MCP unified-memory (claude mcp add)',
        run: async (ctx) => {
          const cur = await readOrNull(path.join(HOME, '.claude.json'));
          if (cur !== null && cur.includes('unified-memory')) {
            ctx.log.push('  already wired: claude MCP');
            return false;
          }
          return manualStep(
            `claude mcp add unified-memory --scope user --env DATA_DIR=${DATA_DIR} -- node ${SERVER}`,
            ctx,
          );
        },
      },
    ],
  },
};

export function genericSpec() {
  return [
    '알 수 없는 하네스 — 수동 배선 스펙:',
    `  1. MCP stdio 등록: command=node args=["${SERVER}"] env DATA_DIR=${DATA_DIR} (서버 이름: unified-memory)`,
    `  2. 세션 시작 주입: node ${INJECTOR} --cwd <프로젝트> 의 stdout을 컨텍스트에 추가 (훅 또는 지시)`,
    `  3. 기록: node ${path.join(UAC, 'scripts/record-fact.mjs')} --type decision|preference "<문장>"`,
    '  4. 스코프: 전역 선호 = channel global, 프로젝트 결정 = channel project:<git-root-basename>',
    '  5. 금지: API 키/토큰/자격증명 저장 금지 (secret gate가 차단)',
    `  검증: node ${path.join(UAC, 'scripts/doctor.mjs')}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const list = args.includes('--list');
  const hIdx = args.indexOf('--harness');
  const harness = hIdx >= 0 ? args[hIdx + 1] : null;

  if (list) {
    for (const [name, a] of Object.entries(adapters)) console.log(`${name}\t${a.description}`);
    return;
  }
  if (!harness) {
    console.error('usage: node scripts/onboard-agent.mjs --harness <name> [--dry-run] | --list');
    process.exit(1);
  }
  const adapter = adapters[harness];
  if (!adapter) {
    console.log(genericSpec());
    process.exit(2);
  }

  const ctx = { dryRun, log: [], backedUp: new Set() };
  console.log(`onboard-agent: ${harness} ${dryRun ? '(dry-run — 쓰기 없음)' : ''}`);
  let changed = 0;
  for (const step of adapter.steps) {
    console.log(`• ${step.label}`);
    ctx.log = [];
    const did = await step.run(ctx);
    for (const l of ctx.log) console.log(l);
    if (did) changed++;
  }
  console.log(dryRun ? `dry-run 완료 — ${changed}개 항목이 적용 예정` : `완료 — ${changed}개 항목 적용`);
  if (!dryRun && changed > 0) console.log(`검증: node ${path.join(UAC, 'scripts/doctor.mjs')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
