#!/usr/bin/env node
// collect-persona-metrics.mjs — mechanical persona input layer.
// Emits a per-agent metrics JSON to stdout (or --out <file>).
// Everything here is measured, not described. Missing data = null, never guessed.

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const sh = (cmd) => { try { return execSync(cmd, { encoding: 'utf8', timeout: 15000 }).trim(); } catch { return null; } };
const count = (dir, pred) => { try { return readdirSync(dir).filter(pred).length; } catch { return null; } };

const metrics = { collected_at: new Date().toISOString(), agents: {} };

// devin — skills inventory + ruleset surface
{
  const dir = join(HOME, '.agents/skills');
  const skills = count(dir, f => statSync(join(dir, f)).isDirectory());
  const verbs = {};
  try {
    for (const d of readdirSync(dir)) {
      const v = d.split('-')[0];
      verbs[v] = (verbs[v] || 0) + 1;
    }
  } catch {}
  const top = Object.entries(verbs).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([verb, n]) => `${verb}:${n}`);
  const agentsMd = join(HOME, '.config/devin/AGENTS.md');
  const sections = existsSync(agentsMd)
    ? (readFileSync(agentsMd, 'utf8').match(/^## /gm) || []).length : null;
  metrics.agents.devin = {
    skills_total: skills, skills_top_verbs: top, ruleset_sections: sections,
    measurable: skills != null,
  };
}

// letta — memfs repo: files, commits, sweep artifacts
{
  const base = join(HOME, '.letta/lc-local-backend/memfs');
  let memfs = null;
  try {
    memfs = join(base, readdirSync(base)[0], 'memory');
  } catch {}
  const files = memfs ? sh(`find "${memfs}" -type f | wc -l`) : null;
  const commits = memfs ? sh(`git -C "${memfs}" rev-list --count HEAD 2>/dev/null`) : null;
  const sweeps = memfs && existsSync(join(memfs, 'memory/auto-sweep/results.md'))
    ? sh(`grep -c '^' "${join(memfs, 'memory/auto-sweep/results.md')}"`) : null;
  metrics.agents.letta = {
    memory_files: files && +files, memfs_commits: commits && +commits,
    autosweep_lines: sweeps && +sweeps,
    measurable: memfs != null,
  };
}

// omo — session count + memory footprint
{
  const sessDir = join(HOME, '.omo/agent/sessions');
  const sessions = existsSync(sessDir)
    ? sh(`find "${sessDir}" -name '*.json' | wc -l`) : null;
  const memDir = join(HOME, '.omo/memory/agents');
  const agents = count(memDir, f => statSync(join(memDir, f)).isDirectory());
  metrics.agents.omo = {
    session_files: sessions && +sessions, memory_agent_dirs: agents,
    measurable: sessions != null,
  };
}

// claude — project session history + ruleset
{
  const projDir = join(HOME, '.claude/projects');
  const sessions = existsSync(projDir)
    ? sh(`find "${projDir}" -name '*.jsonl' | wc -l`) : null;
  const claudeMd = join(HOME, '.claude/CLAUDE.md');
  const rules = existsSync(claudeMd)
    ? (readFileSync(claudeMd, 'utf8').match(/^## /gm) || []).length : null;
  metrics.agents.claude = {
    session_logs: sessions && +sessions, ruleset_sections: rules,
    measurable: sessions != null,
  };
}

// pi — ephemeral subagent; no persistent state to measure
metrics.agents.pi = { measurable: false, note: 'ephemeral; state lives in dispatch log' };

// fleet-level: agent-dispatch hop count as collaboration signal
{
  const log = join(HOME, '.local/share/agent-dispatch/log.tsv');
  metrics.fleet = {
    dispatch_hops: existsSync(log) ? +sh(`wc -l < "${log}"`) : null,
  };
}

const out = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1] : null;
const json = JSON.stringify(metrics, null, 2) + '\n';
if (out) { (await import('node:fs')).writeFileSync(out, json); console.log(`wrote ${out}`); }
else console.log(json);
