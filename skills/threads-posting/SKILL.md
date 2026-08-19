---
name: threads-posting
description: Publish posts on Threads (threads.com) for the user. Use whenever the user wants to write, draft, or publish a Threads post or thread, with or without an attached image, including "post this", "write a post using this image", or a pasted block of raw post text.
---

# Threads Posting

## Core rule: the user's text IS the post

- **Attached media is part of the post (the user, 2026-08-19: "update your skill to include the media that I attach. they're important for visual communication").** When the user attaches images to a post request, attach them to the post by default. They are proof and visual communication, not decoration. Confirm only the overall post (text + media) in one gate; do not drop the media.
- When the user supplies their own text, treat it as final copy. Apply a light pass only: fix dictation artifacts, doubled words, and obvious typos. Never rewrite sentences, reorder ideas, add polish, or smooth the voice. AI-flavored rewriting is the failure mode.
- Keep every name, alias, and code-switch (English/Korean mixing, tool names, quoted phrases) exactly as written. If the user publicly refers to the agent by an alias different from its private name, keep the alias verbatim and never surface the private name publicly.
- No emojis, no hashtags, no engagement bait, no calls to action unless the user wrote them.

## Hard rule: commas and periods only

- Post copy may use ONLY commas and periods as punctuation. No quotation marks, parentheses, question marks, exclamation marks, colons, semicolons, dashes, or ellipses.
- Rework phrasing so quoted speech becomes plain reported clauses and parenthetical asides become separate sentences or comma appositives. (Stated by the user as a hard rule, 2026-07-20.)

## Register: plain declarative endings for drafts

- Drafted posts default to plain 평서체 endings (한다, 아니다, 했다), not 습니다체, which matches the approved essay/aphorism register. The user's own supplied text keeps its original endings untouched. (Corrected 2026-07-20.)

## Insights analysis (for engagement growth)

Trigger: the user asks to analyze Buffer insights, wants engagement growth, or asks what is/isn't working on their Threads presence. The data source is publish.buffer.com/insights (Post insights tab), the same logged-in session used for posting.

### What to capture each run (30-day window by default)

1. Summary block: posts count, total followers, reactions, comments, engagement rate, views, quotes, reposts, each with the % vs the prior 30-day window.
2. Top 5 posts: rank, metric, date, and the opening text of each. These are the highest-value inputs.
3. Any clear deltas: which metric moved up or down the most, and by how much.

### The 6 metrics that matter (Hermes consult, 2026-08-19)

1. Engagement rate by reach (reactions + replies + reposts + quotes / reach). Benchmarks: >5% winner, 2-4% normal, <1.5% miss. Followers checked monthly only.
2. Reach trend per post (median, not total) — is the algorithm expanding beyond followers?
3. Reply ratio (replies / likes + replies) — conversation quality; replies are Threads' strongest signal.
4. Format performance — text vs image vs thread vs link. Current pattern is text + proof; test image-of-machine-working vs text-only.
5. Timing signal — replies per post by hour/day of sent time (not impressions).
6. Theme signal — classify each post (personal proof + forward claim / machine demo / question CTA / other); track win-rate per theme.

### How to turn the data into engagement actions

- Compare the top posts against the bottom of the pack for the same window (scroll the Performance table if visible). The gap between them is the lesson.
- Map each top post to the user's documented winning shapes: a personal proof point welded to a forward claim about AI/agents; show the machine doing the work with the product named; plain declarative Korean; no hashtags. If a top post does not match a known shape, note the shape as a candidate.
- Name one or two concrete moves for the next week, tied to observed data, not generic advice. Example moves: post more of shape X because posts shaped like Y got 2x reactions; reply faster to comments because comment volume is rising but reply rate lags; repeat a specific story type at the time of day that won.
- Output as a short brief: 5 lines or fewer, verdict first, one visual card when a substantive reply is due.

### Engagement playbook (Hermes consult, 2026-08-19)

- Hook = first line is the whole job. Put the personal proof point in line 1.
- Reply to comments within ~2 hours; first-hour replies compound reach. Replies are the deliverable, not likes.
- 15-30 min/day of reciprocity replying to accounts you follow; the algorithm reads it as network activity.
- One-post stories win on reach; use 3-5 post threads only when the story needs a build. Claim in post 1 either way.
- End with one open question; skip follow me. Questions roughly double reply rate.
- 3-5 posts/week beats daily burnout; consistency beats volume.
- No hashtags: put the keyword in the first line instead (searchable, no clutter).
- Flag deviations: posts without a proof point, hashtags sneaking in, English drift, hook buried past line 1.

### Cadence and delivery

- Default cadence: weekly, matching the weekly content pipeline. The routine reads the page, captures the numbers, and drafts the brief.
- Delivery: keep the brief in the session chat unless the user has asked for Telegram push; a push goes through the Hermes Telegram path (hermes send --to telegram on store-host), never a new Aside routine.
- Do not publish anything from this analysis without the user's explicit go. This is analysis and recommendation, not auto-posting.

### Tribe-building lens (the user, 2026-08-19)

- the user's stated intent for social media is to build his own tribe in the Seth Godin sense (Tribe, the book): a community of people who share his values and identity, not a follower count or audience. Recorded to UAC as dedupe 63a1d8c0165c85f5 so Hermes and other agents share it.
- Evaluate every analysis output and content move against the question: does this build the tribe (shared values, belonging, identity) or just chase vanity metrics? The winning content shapes are means; tribe-building is the end.

## When the user gives only an image or a rough idea

1. Read the attached image/page fully first.
2. Check the user's recent posts on their profile for register (language, length, tone) before drafting.
3. Lead with ONE committed draft in that register plus a marked recommendation; offer numbered alternatives (post as-is / tweak / different angle). Do not present a menu of equal drafts.

## Claims need sources

- For research-backed, factual, or "I checked" posts, default to including source URLs.
- Prefer a final thread segment titled like `출처` / `Sources` with full URLs (CDC, EPA, papers, etc.).
- Do not invent sources. Only cite URLs actually used.
- Skip the sources segment only for pure opinion, diary, or when the user explicitly wants no links.

## Character limits and threading

- Threads caps each post at 500 characters. Count characters programmatically before publishing.
- Over-limit text becomes a multi-post thread: split at natural paragraph seams, never mid-thought.
- Attach media to post 1 when media is present (multi-image carousel via a single `setFiles([...])` call, verified 2026-08-19).
- **Link-preview card blocks the media button (verified 2026-08-19).** Auto-generated URL preview cards (e.g. a bare `commandcode.ai` mention becomes a card) remove the Attach media button from the composer. Remove the card first (its Remove button appears in the snapshot near the card), then the media button returns. A post cannot hold both an attached image and a link preview card.

## Default publish path: Buffer API


Use Buffer GraphQL as the default way to publish. Browser automation on threads.com is the fallback.

### Credentials and channel (look up live; do not hardcode secrets)

1. Load `BUFFER_API_KEY` from the user's Hermes env on store-host (`~/.hermes/.env`), or another known env location the user points to. Never print the full key.
2. Endpoint: `POST https://api.buffer.com` with `Authorization: Bearer <key>` and JSON body `{ "query", "variables?" }`.
3. Resolve org + Threads channel each session (or when the last known IDs fail):

```graphql
query {
  account {
    organizations { id name }
  }
}
```

```graphql
query {
  channels(input: { organizationId: "ORG_ID" }) {
    id
    name
    service
  }
}
```

4. Use the channel where `service` is `threads` (and the name matches the intended profile if multiple exist).

### Create / share now

Immediate publish:

```graphql
mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    ... on PostActionSuccess {
      post { id text status dueAt }
    }
    ... on MutationError { message }
  }
}
```

Variables shape (single post):

```json
{
  "input": {
    "text": "POST TEXT",
    "channelId": "THREADS_CHANNEL_ID",
    "schedulingType": "automatic",
    "mode": "shareNow",
    "assets": []
  }
}
```

`ShareMode` values: `shareNow`, `addToQueue`, `shareNext`, `customScheduled` (use `dueAt` ISO UTC with custom).

### Confirm the post actually sent

`createPost` returns `status: "sending"`. Poll with this shape, NOT `post(id:)`, which does not exist and silently returns null:

```graphql
query($input: PostInput!) { post(input: $input) { id status text createdAt } }
```

Variables: `{"input": {"id": "<postId>"}}`. Expect `sent` within about 15 seconds. Write both the mutation and poll bodies to JSON files and `scp` them before curling on the remote host; inline SSH heredocs let the shell consume GraphQL `$variable` names.

When the post copy contains Korean or other non-ASCII text, write the JSON programmatically (`JSON.stringify` via Node) instead of a shell heredoc: heredocs can silently corrupt the file mid-content (verified 2026-08-19, `JSON.parse` failed exactly at a long Korean line). Validate with `node -e "JSON.parse(require('fs').readFileSync('file.json','utf8'))"` before scp.

### Multi-post Threads threads via Buffer

Pass every segment in `metadata.threads.thread`, including the first. Top-level `text` must match the first thread item.

```json
{
  "input": {
    "text": "FIRST SEGMENT",
    "channelId": "THREADS_CHANNEL_ID",
    "schedulingType": "automatic",
    "mode": "shareNow",
    "assets": [],
    "metadata": {
      "threads": {
        "thread": [
          { "text": "FIRST SEGMENT" },
          { "text": "SECOND SEGMENT" }
        ]
      }
    }
  }
}
```

Prefer GraphQL variables for Korean/quoted text so escaping stays clean. Run the publish call from an environment that already has the key (typically store-host via SSH) so the key never lands in chat logs.

### Images

- Buffer supports image posts / per-thread-segment assets. Prefer Buffer's documented image/asset flow when posting media.
- If media upload via Buffer is blocked or unclear, fall back to browser attach on threads.com.

### Topic tags (not a hashtag, verified 2026-08-20)

- Threads has a native topic tag feature, one tag per post shown as a pill, entered in the composer via a dedicated topic control, distinct from typing `#` inline. It is separate from the no-hashtags rule above.
- Buffer's GraphQL API exposes it as `metadata.threads.topic` (plain string) inside `ThreadsPostMetadataInput`.
- To set or change it on an existing draft, `editPost` requires `text` to be resent alongside `metadata` even when only the topic is changing, otherwise it returns `InvalidInputError: Post must have either text or media`.
- Reading it back: `metadata` on `post` is a union (`PostMetadata`), query it as `metadata { ... on ThreadsPostMetadata { topic } }`, not a flat field.
- Only set a topic when the user asks for one; it is not part of the default post shape.

## Publish path notes (2026-08-19)

- The Buffer legacy REST API (api.bufferapp.com) still answers but the key stored in store-host `~/.hermes/.env` returned 401 for both REST and GraphQL on 2026-08-19. The publish.buffer.com web UI (same logged-in browser session) works without any key and lets the user publish or schedule directly. When the API key is dead, use the web UI path; when the key works, the GraphQL path above is still the default.
- Composer quirks observed 2026-08-19: the character counter in the composer shows remaining characters, not total. The Schedule Post button immediately schedules to the next queue slot when clicked, it does not open a menu first. To publish immediately from the edit view, use the More Posting Actions menu and choose Now, then Save. The timezone selector may default to Asia/Seoul; verify the shown time matches the user's intent (America/Edmonton) before saving a schedule.

## Fallback: browser on threads.com

Use only when Buffer is unavailable, the channel is disconnected, the media path needs the native composer, the user asks for on-site composition, or the target is a reply to someone else. Buffer `createPost` only publishes on the user's own profile; it cannot notify another account.

1. For a new post, click "What's new?" (or "Create"). For a reply to an OP, open their post URL, expand the inline composer, and stay on that thread. A localhost or file:// page never reaches them.
2. Fill the first textbox (Playwright `fill` works on the contenteditable).
3. Attach media via "Attach media" + `filechooser`. To attach multiple local images in one go, pass all paths as an array to one `setFiles` call (`chooser.setFiles([path1, path2])`). A local visualization is shared as a screenshot attached to the reply, not as a URL.
4. "Add to thread" for each subsequent segment; fill each new textbox.
5. After fill, verify with `.innerText()` — snapshot trees can falsely duplicate contenteditable text.
6. After a successful reply, Threads may immediately open an Edit dialog on the live reply. That is not unpublished. Proof is the parent thread showing the reply plus the Posted toast. Do not Post again.

### Meta AI (meta.ai) for original image creation and curation (verified 2026-08-19)

- `www.meta.ai` is logged in under the same handle as Threads and Buffer (`<threads-handle>`). Prefer it over sourcing a found/stock image from Bing when the post needs an original visual, since it produces a purpose-built image instead of a repurposed one.
- Flow: Home or New chat, one-line description of the image. Meta AI returns two response variants side by side for an implicit A/B pick. Choose the stronger one, do not average or over-specify the prompt up front, iterate with a short follow-up instead.
- Each generated image exposes Use as reference (iterate from it), Download, and Add to favorites. Download saves as `.webp`. If the Threads composer or Buffer asset upload rejects webp, convert first: `sips -s format png in.webp --out out.png`.
- The Media tab holds the full Creations gallery plus curated preset prompts (isometric diorama, clean product shot, photo restoration, trending hairstyles, etc.) for common image treatments, useful when a quick styled shot is wanted without writing a full prompt.
- The Artifacts tab produces structured non-image content (guides, plans) more like a mini document than a chat reply. Only use it for a companion piece, never for post copy itself.
- The Scheduled tab (e.g. a standing daily headline briefing prompt) can source topic ideas for curation, but it is Meta's own internal reminder system with no delivery to the user's phone or the fleet. For anything that must reliably reach him, use Hermes cron on store-host per the standing scheduling rule, not meta.ai Scheduled.
- The public `@meta.ai` mention inside a Threads post or reply (tag it for a live AI-authored public reply, like Grok on X) is a Meta beta feature confirmed live only in Malaysia, Saudi Arabia, Mexico, Argentina, and Singapore as of mid-2026. Do not assume it works for this Calgary-based account; verify with a low-stakes test post before relying on it for real curation, and do not block a content plan on it.
- Hard rule: never publish Meta AI's own generated caption or reply text as post copy. It writes in its own assistant voice, not the user's plain 평서체 register. Use meta.ai strictly for image generation and idea sourcing, never for drafting the words that get published.

### Source an image from Bing (when needed)

Plain `curl` against `bing.com/images/search` returns a decoy result set of unrelated images even with a desktop UA and `mkt=en-US`, failing silently rather than erroring. Use a real browser tab instead: `openTab` the search URL, then `page.evaluate` over `a.iusc`, `JSON.parse` each element's `m` attribute, and read `t` (title) plus `murl`. Always sanity-check the titles against the query before trusting the URLs.

## Publish gate and verification

1. Before any externally visible publish, screenshot the draft (or thread segments) and use `request_action_confirmation` as the single approval gate. One gate, not multi-round drafting.
2. After Buffer `shareNow`, poll post status until `sent` (or surface `error`). Then open the live profile and confirm every segment + source links/media.
3. After browser Post, wait for the posting toast/profile update, reload profile if needed, confirm live text.
4. Multi-segment threads need per-segment live verification, not just a toast: a later segment (observed: the final one carrying a link preview card) can silently fail to publish while earlier segments succeed, with Threads recounting the thread as N/N. If a segment is missing after a reload, post it as a self-reply under the last live segment; the reply rejoins the thread numbering. Also, a single post cannot hold both an attached image and a link preview card — remove the card (URL stays as plain text) to attach media, or split them across segments.
5. To open the just-posted thread for review, never trust the first `/post/` href on the profile or DOM order: a pinned post can sit at the top of the profile and send you to the wrong thread (observed 2026-08-17). Match the post by its text or timestamp instead, e.g. scan each `/post/` anchor's nearest container text for the posted copy, or select by the newest timestamp.
6. Capture a proof screenshot of the live post and include it in the final report.

## Living skill (standing order)

This skill is incomplete by design. After every real Threads task with the user:

1. Notice what the user corrected, preferred, refused, or praised about voice, structure, sources, privacy, timing, media, or publish path.
2. If the lesson is durable and portable (not a one-off fact about a single post), edit this `SKILL.md` in the same session — do not wait to be asked.
3. Keep changes procedural and general: rules, defaults, failure modes, verification steps. Never hardcode secrets, one-off post text, or session-only prices/names.
4. When updating the Aside copy, sync the same change to any fleet copy under unified-agent-context `skills/threads-posting/` when that path exists.
5. Tell the user what changed in one short line after the edit.

Learning signal priority: explicit correction > repeated pattern > single praise. If a new rule conflicts with an older one, rewrite the old rule instead of stacking contradictions.

## Anti-goals

Unless explicitly asked, do not suggest hashtags, optimal posting times, translations to another language, engagement/reach optimizations, or unsolicited new post ideas.
