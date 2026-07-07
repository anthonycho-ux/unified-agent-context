#!/usr/bin/env node
// Phase 0 spike: MCP stdio round-trip tester.
// Usage: node roundtrip.mjs <candidate>
// Candidates: openmemory | mem0-mcp | server-memory | memory-keeper
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const candidates = {
  "openmemory": {
    command: "node",
    args: ["node_modules/openmemory/dist/index.js"],
    env: {},
    write: (tools) => ({ name: "add-memory", args: { content: "PHASE0_SPIKE decision: DB는 Postgres로 전환" } }),
    search: () => ({ name: "search-memories", args: { query: "PHASE0_SPIKE decision" } }),
  },
  "mem0-mcp": {
    command: "node",
    args: ["node_modules/mem0-mcp/dist/bin/mem0-mcp.js"],
    env: { MEM0_STORE_PATH: process.cwd() + "/data/mem0" },
    write: () => ({ name: "memory_store", args: { content: "PHASE0_SPIKE decision: DB는 Postgres로 전환", workspace: "global", project: "spike", checkpoint: "phase0" } }),
    search: () => ({ name: "memory_search", args: { query: "PHASE0_SPIKE decision", workspace: "global", project: "spike" } }),
    health: () => ({ name: "health", args: {} }),
  },
  "server-memory": {
    command: "node",
    args: ["node_modules/@modelcontextprotocol/server-memory/dist/index.js"],
    env: { MEMORY_FILE_PATH: process.cwd() + "/data/graph-memory.jsonl" },
    write: () => ({ name: "create_entities", args: { entities: [{ name: "Phase0SpikeDecision", entityType: "decision", observations: ["DB는 Postgres로 전환 (scope: project:spike)"] }] } }),
    search: () => ({ name: "search_nodes", args: { query: "Postgres" } }),
  },
  "memory-keeper": {
    command: "node",
    args: ["node_modules/mcp-memory-keeper/dist/index.js"],
    env: {},
    write: () => ({ name: "context_save", args: { key: "phase0_spike_decision", value: "DB는 Postgres로 전환", category: "decision" } }),
    search: () => ({ name: "context_get", args: { key: "phase0_spike_decision" } }),
  },
};

const name = process.argv[2];
const c = candidates[name];
if (!c) { console.error("unknown candidate: " + name); process.exit(2); }

const transport = new StdioClientTransport({
  command: c.command,
  args: c.args,
  env: { ...process.env, ...c.env },
  stderr: "pipe",
});
const client = new Client({ name: "phase0-spike-client", version: "1.0.0" });

const deadline = (ms, p, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout:${label}`)), ms))]);

try {
  await deadline(15000, client.connect(transport), "connect");
  const tools = await deadline(10000, client.listTools(), "listTools");
  console.log("TOOLS:", JSON.stringify(tools.tools.map(t => t.name)));

  if (c.health) {
    try {
      const h = await deadline(10000, client.callTool(c.health()), "health");
      console.log("HEALTH:", JSON.stringify(h.content).slice(0, 600));
    } catch (e) { console.log("HEALTH_ERR:", e.message); }
  }

  const w = c.write(tools.tools);
  try {
    const wr = await deadline(20000, client.callTool({ name: w.name, arguments: w.args }), "write");
    console.log("WRITE(" + w.name + "):", JSON.stringify(wr.content).slice(0, 600), "isError=" + (wr.isError ?? false));
  } catch (e) { console.log("WRITE_ERR:", e.message); }

  const s = c.search();
  try {
    const sr = await deadline(20000, client.callTool({ name: s.name, arguments: s.args }), "search");
    console.log("SEARCH(" + s.name + "):", JSON.stringify(sr.content).slice(0, 800), "isError=" + (sr.isError ?? false));
  } catch (e) { console.log("SEARCH_ERR:", e.message); }

  console.log("ROUNDTRIP_DONE:" + name);
} catch (e) {
  console.log("FATAL:", e.message);
} finally {
  try { await client.close(); } catch {}
  process.exit(0);
}
