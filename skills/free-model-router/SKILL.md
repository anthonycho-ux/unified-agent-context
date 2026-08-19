---
name: free-model-router
description: >-
  Pool and route free model endpoints when a coding agent hits a rate limit or
  auth failure (429/401/503). Use when the user says "hit rate limit", "key
  expired", "401/429", "route to a free model", "pool free models", or a
  provider/key is down and you need a working fallback model.
---

# Free Model Router

Keep working when a provider rate-limits, 401s, or dies — by pooling **free**
model endpoints and routing around the failure. This is a *knowledge + probe*
skill: it records what is currently free (and how to use it), and how to
verify a route is alive before committing to it.

## When to use

- A coding agent / letta / CLI tool returned **429, 401, 503, quota, or rate
  limit** and you need to keep going.
- User asks to "pool free models", "route around the rate limit", "switch to a
  free model".
- A configured provider key is expired/dead (e.g. letta `providers/auth.json`
  key that 401s) and you must pick a working slot.

## How to use

1. **Consult the pool** — read `references/pool.yaml`. It lists known free
   endpoints, their auth needs, and observed status. Always pair it with a live
   probe (statuses go stale fast).
2. **Probe before you commit** — run `scripts/probe.py` against candidate
   routes to confirm they are actually alive right now.
3. **Route** — for a tool that supports provider/model selection (letta
   agents, opencode, cc, etc.), point it at the cheapest verified-free route
   that fits the task. Prefer the first route whose probe passes.
4. **Record what you learned** — update `references/pool.yaml` (status, date,
   notes) so the next rate-limit event starts from better knowledge. Keep
   secrets OUT: reference env vars / secret-store names, never paste keys.
5. **Expand the pool when it's thin** — free tiers die and new ones appear
   constantly. When the pool has no alive free route, or as routine upkeep,
   run the discovery playbook (`references/discovery.md`) to find new free
   model offers using free search engines and web bots. Always verify before
   adding — see below.

## Keep the pool fresh (expand the provider list)

Free model offers churn weekly: "free for limited time" previews, BYOK
promotions, new providers undercutting on free tiers. The pool is only as good
as its last update. Treat expansion as part of this skill's job, not a one-off.

**When to run discovery:**
- No free route in the pool is alive right now.
- More than ~2 weeks since the last `verified` / `last_searched` date.
- User asks "are there any new free models?" or "find more free providers".

**How to discover (free channels, in preference order):**
1. Built-in `web_search` — cheapest; query for current free-tier LLM offers
   (include the current year).
2. Free web bots you already have — e.g. Grok's free tier on X, or a free
   chat/bot that can itself search. Ask it "list current free LLM API
   endpoints / free tiers as of <month year>".
3. Search engines via a browser wrapper (Google, Brave, DuckDuckGo, Bing) —
   use the local `aside` browser wrapper when pages are JS-heavy or
   WAF-blocked. Run queries like `site:*.ai free tier LLM API 2026`, "free
   LLM API no credit card", "free model endpoint openai-compatible".
4. Watch the right places — see `references/discovery.md` for a concrete
   channel/account list and copy-paste queries.

**Verify before adding to the pool:**
- The offer must be real and current: check the provider's own page/terms for
  "free tier", rate limits, and expiry ("free for limited time").
- Prefer `openai-compatible` endpoints (drop-in for most tools). Note the
  base URL, model id, and auth shape in the route entry.
- Probe it (`scripts/probe.py`) — add the route with `status: unknown` first,
  then mark `ok` only if a live probe passes. Never add an unprobed route as
  `ok`.
- Record the discovery channel + date in the entry (`discovered_via`,
  `last_searched`) so stale entries are visible.

**Gotcha:** free tiers are often gated by region, credit-card, or
"limited time". Read the terms before relying on a route for real work. Mark
any route whose terms are unclear as `unknown`, not `ok`.

## The decision rule

> If the current provider is dead → probe the pool in order → take the first
> free route that passes → note the swap in pool.yaml.

Ordering preference when multiple routes pass:

1. Truly free (`:free`, `-free`) and no BYOK key needed
2. Free but BYOK (bring-your-own-key, zero cost)
3. Cheapest paid — only if the task genuinely can't run on free

## Pool statuses

| status | meaning |
|--------|---------|
| `ok` | verified alive at last probe |
| `unknown` | not probed recently; must probe before use |
| `dead` | known broken (401/503); do not use |

## Worked example (from real session 2026-08-14)

Scenario: letta `-p` prompt failed with `401 ... API Key appears to be invalid
or may have expired`. The default route resolved to a dead BYOK key.

1. Read `~/.letta/route-prices.json` + `route-reorder.log` → found
   `opencode/deepseek-v4-flash-free` marked `VERIFY PASS PONG`.
2. Listed agents → found the Letta agent already on
   `openai-compatible/stepfun/step-3.7-flash:free`.
3. Routed the prompt with `--agent "$LETTA_AGENT_ID"`.
4. Task completed; pool.yaml updated with the verified routes.

## Gotchas

- **Statuses rot fast.** A route that passed yesterday may 503 today. Always
  probe; never trust a cached `ok` for a live decision.
- **Keys expire.** A "free" BYOK route dies the moment its key 401s — mark it
  `dead` and move on; do not burn cycles re-verifying.
- **Secrets never belong in the pool.** Store keys in the harness secret
  store / env; pool.yaml references them by name.
- **Free tiers have limits.** Watch for per-hour caps; rotate among multiple
  free routes if a task is long.
- **A dead default route is not a dead system.** Check per-agent model
  overrides — a specific agent may already be pinned to a working free model.
