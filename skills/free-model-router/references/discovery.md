# Free model discovery playbook

How to find NEW free LLM providers/endpoints when the pool runs thin, using
free search engines and web bots. Update `pool.yaml` with whatever this
surfaces (verified before adding — see SKILL.md).

## Free search/bot channels (preference order)

| Channel | How | Cost | Best for |
|---------|-----|------|----------|
| Built-in `web_search` | tool call | free | quick current-offer queries |
| Grok free tier (X) | ask Grok (grok.com / X bot) to list free LLM API offers | free, rate-limited | broad aggregation, its training includes current offers |
| `aside` browser wrapper | `aside "<query>"` over SSH to MacBook | free | JS-heavy / WAF-blocked search pages (Google, Bing, Brave) |
| DuckDuckGo / Brave / Google directly | plain web search | free | finding provider homepages & terms |

`aside` is a local wrapper forwarding to the MacBook's AI browser. Use it when
a search page is JS-rendered, login-walled, or blocked to plain fetches.

## Copy-paste queries (include the current year)

- `free LLM API no credit card 2026`
- `free tier LLM API openai-compatible 2026`
- `free model endpoint openai-compatible base url 2026`
- `"free for limited time" LLM API 2026`
- `new free LLM API 2026 site:news.ycombinator.com`
- `site:reddit.com r/LocalLLaMA free API 2026`
- `site:reddit.com free LLM API no credit card 2026`
- `site:reddit.com openai-compatible free tier 2026`
- `free Grok API / free Gemini API / free Claude API 2026` (name specific
  providers you already use)
- Grok prompt: *"List every LLM provider with a current free API tier or
  free model endpoint as of <Month Year>. For each: provider, model id, whether
  it's OpenAI-compatible, and the known limit. Skip paid-only."*

## Places to watch (feed this into the pool weekly)

- **Reddit** — the biggest goldmine for fresh free-model finds. New providers
  and free-tier launches show up in discussion threads before they hit
  pricing pages or the news. Priorities:

  - **r/LocalLLaMA** — best single source. Search it for `free API`, `free
    tier`, `no credit card`, `openai-compatible`. Its weekly "who's offering
    free stuff" style threads and "I built X" posts surface new endpoints
    constantly. Also scan comments — providers themselves answer there.
  - **r/OpenAI, r/LocalLLaMA free-tier roundups** — aggregate current offers.
  - **r/SideProject, r/SaaS, r/artificial** — makers announce free tiers of
    new model gateways / proxies / BYOK routers.
  - **r/LocalLLaMA "free models" search pattern**: go to
    `reddit.com/r/LocalLLaMA/search?q=free+API&restrict_sr=on&sort=new` and
    read the newest threads; sort by `new`, not relevance, so recent offers
    surface first.
  - **Reddit scraping**: use the built-in `web_search` with
    `site:reddit.com r/LocalLLaMA free api 2026`, or the `aside` browser
    wrapper for JS-heavy subreddit search pages. Prefer `old.reddit.com`
    URLs when a page is heavy.
  - **Trap to avoid**: upvotes ≠ current. A 2-year-old "free tier" thread
    still ranks; ALWAYS check the thread date and the linked page's terms
    before adding anything. Reddit is discovery, not verification.
- **HN** — `news.ycombinator.com` "Show HN" / launch threads (new providers
  announce free tiers there first)
- **X/Twitter** — provider accounts: @OpenAI, @xai, @GoogleAI, @MoonshotAI,
  @DeepSeek, @NousResearch, @MistralAI, @groqinc; and "free API" hashtags
- **Provider pricing pages** — check the "pricing" page of any provider you
  already use; free tiers are added there without fanfare
- **RSS/aggregators** — LLM news roundups (e.g. The Rundown, TLDR AI) surface
  "free tier now available" items
- **Model catalogs** — `opencode models`, letta's model catalog
  (`~/.letta/cache/model-catalog.json`), and OpenRouter's free-model list
  (openrouter.ai/models?max_price=0) all expose new free ids directly

## Verification checklist (before adding to pool.yaml)

- [ ] Offer is CURRENT (page/terms dated this month-ish; free tier not
      "expired")
- [ ] Free tier is real — no mandatory credit card / no trial-only
- [ ] OpenAI-compatible endpoint (base URL + model id) if possible
- [ ] Auth shape known: none | API key env var | BYOK
- [ ] Rate limits noted in the entry (free tiers cap hard)
- [ ] Added to pool.yaml as `status: unknown`, then probed before `ok`
- [ ] `discovered_via` + `last_searched` date recorded

## Pool entry template for a new route

```yaml
  - id: <provider>-<model>
    target: openai-compatible slot (<base-url>)
    model: <model-id>
    cost: free
    byok: false            # true if bring-your-own-key
    status: unknown        # set ok only after a live probe passes
    verified: "<date>"
    discovered_via: "web_search / grok / aside / hn / ..."
    last_searched: "<date>"
    notes: >
      <free tier limit, expiry, gotchas>
```
