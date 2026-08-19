---
name: threads-posting
description: Publish posts on Threads (threads.com) for the user. Use whenever the user wants to write, draft, or publish a Threads post or thread, with or without an attached image, including "post this", "write a post using this image", or a pasted block of raw post text.
---

# Threads Posting

## Core rule: the user's text IS the post

- When the user supplies their own text, treat it as final copy. Apply a light pass only: fix dictation artifacts, doubled words, and obvious typos. Never rewrite sentences, reorder ideas, add polish, or smooth the voice. AI-flavored rewriting is the failure mode.
- Keep every name, alias, and code-switch (English/Korean mixing, tool names, quoted phrases) exactly as written. If the user publicly refers to the agent by an alias different from its private name, keep the alias verbatim and never surface the private name publicly.
- No emojis, no hashtags, no engagement bait, no calls to action unless the user wrote them.

## Hard rule: commas and periods only

- Post copy may use ONLY commas and periods as punctuation. No quotation marks, parentheses, question marks, exclamation marks, colons, semicolons, dashes, or ellipses.
- Rework phrasing so quoted speech becomes plain reported clauses and parenthetical asides become separate sentences or comma appositives. (Stated by the user as a hard rule, 2026-07-20.)

## Register: plain declarative endings for drafts

- Drafted posts default to plain 평서체 endings (한다, 아니다, 했다), not 습니다체, which matches the approved essay/aphorism register. The user's own supplied text keeps its original endings untouched. (Corrected 2026-07-20.)

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
- Attach media to post 1 when media is present.

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

## Fallback: browser on threads.com

Use only when Buffer is unavailable, the channel is disconnected, the media path needs the native composer, the user asks for on-site composition, or the target is a reply to someone else. Buffer `createPost` only publishes on the user's own profile; it cannot notify another account.

1. For a new post, click "What's new?" (or "Create"). For a reply to an OP, open their post URL, expand the inline composer, and stay on that thread. A localhost or file:// page never reaches them.
2. Fill the first textbox (Playwright `fill` works on the contenteditable).
3. Attach media via "Attach media" + `filechooser`. To attach multiple local images in one go, pass all paths as an array to one `setFiles` call (`chooser.setFiles([path1, path2])`). A local visualization is shared as a screenshot attached to the reply, not as a URL.
4. "Add to thread" for each subsequent segment; fill each new textbox.
5. After fill, verify with `.innerText()` — snapshot trees can falsely duplicate contenteditable text.
6. After a successful reply, Threads may immediately open an Edit dialog on the live reply. That is not unpublished. Proof is the parent thread showing the reply plus the Posted toast. Do not Post again.

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
