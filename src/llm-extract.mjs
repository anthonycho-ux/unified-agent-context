// LLM-based candidate extraction for session distillation.
//
// Same output contract as distiller.extractCandidates: [{ statement, fact_type }].
// fact_type ∈ {decision, preference, project_state}.
//
// Fail-open to regex: on ANY failure (no fetch, network error, bad JSON, non-ok
// response) this returns null so the caller can fall back to the regex extractor.
// It never throws. Secret filtering is NOT done here — the distiller runs every
// candidate through the fail-closed secret gate (auto_distill) regardless of source.

const DEFAULT_URL = process.env.UAC_LLM_URL ?? 'http://127.0.0.1:8081/v1/chat/completions';
const DEFAULT_MODEL = process.env.UAC_LLM_MODEL ?? 'Qwen3.5-9B-GLM5.1-Distill-v1-Q5_K_M.gguf';
const DEFAULT_TIMEOUT_MS = Number(process.env.UAC_LLM_TIMEOUT_MS ?? 30000);
const MAX_CANDIDATES = 20;
const MAX_INPUT_CHARS = 24000;
const VALID_TYPES = new Set(['decision', 'preference', 'project_state']);

const SYSTEM_PROMPT = [
  'You extract durable memory facts from a transcript between a user and AI coding agents.',
  'Keep ONLY facts worth carrying into future sessions: decisions that were made, and durable stated preferences.',
  'Drop chit-chat, questions, transient status, and anything ephemeral.',
  'Rewrite each fact as one clean, self-contained sentence, in the language it was stated (Korean or English).',
  'Classify each as decision (a choice or commitment made), preference (a durable rule or like/dislike), or project_state (current status of a project).',
  'Never include secrets, passwords, tokens, or keys.',
  'Output STRICT JSON only, no prose and no code fences: {"facts":[{"statement":"...","fact_type":"decision|preference|project_state"}]}',
].join('\n');

/**
 * Extract candidate facts from a transcript using an OpenAI-compatible chat endpoint.
 * @returns {Promise<Array<{statement:string,fact_type:string}>|null>} candidates, or null on failure.
 */
export async function llmExtractCandidates(text, opts = {}) {
  const input = String(text ?? '').trim();
  if (!input) return [];

  const url = opts.url ?? DEFAULT_URL;
  const model = opts.model ?? DEFAULT_MODEL;
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 1024,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: input.slice(0, MAX_INPUT_CHARS) },
        ],
      }),
      signal: controller.signal,
    });

    if (!res || res.ok === false) return null;
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    return parseFacts(content);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parse a model response into candidate facts. Tolerant of code fences and
 * surrounding prose. Returns null when nothing parseable is found.
 */
export function parseFacts(content) {
  if (typeof content !== 'string') return null;

  const json = extractJsonBlock(content);
  if (!json) return null;

  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  const arr = Array.isArray(parsed)
    ? parsed
    : (Array.isArray(parsed?.facts) ? parsed.facts : null);
  if (!arr) return null;

  const seen = new Set();
  const out = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const statement = typeof item.statement === 'string' ? item.statement.trim() : '';
    const fact_type = typeof item.fact_type === 'string' ? item.fact_type.trim() : '';
    if (!statement || !VALID_TYPES.has(fact_type)) continue;

    const key = statement.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ statement, fact_type });
    if (out.length >= MAX_CANDIDATES) break;
  }

  return out;
}

// Find the first balanced JSON object or array in a string, ignoring code fences
// and surrounding prose. Brace counting is naive (does not track strings) but is
// sufficient for the compact, secret-free JSON this prompt requests.
function extractJsonBlock(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;

  const objStart = body.indexOf('{');
  const arrStart = body.indexOf('[');
  if (objStart === -1 && arrStart === -1) return null;

  const useObj = objStart !== -1 && (arrStart === -1 || objStart < arrStart);
  const open = useObj ? '{' : '[';
  const close = useObj ? '}' : ']';
  const start = useObj ? objStart : arrStart;

  let depth = 0;
  for (let i = start; i < body.length; i++) {
    if (body[i] === open) depth++;
    else if (body[i] === close) {
      depth--;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  return null;
}
