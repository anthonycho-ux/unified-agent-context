---
name: threads-posting
description: Publish posts on Threads (threads.com) for the user. Use whenever the user wants to write, draft, or publish a Threads post or thread, with or without an attached image, including "post this", "write a post using this image", or a pasted block of raw post text.
---

# Threads Posting

## Core rule: the user's text IS the post

- When the user supplies their own text, treat it as final copy. Apply a light pass only: fix dictation artifacts, doubled words, and obvious typos. Never rewrite sentences, reorder ideas, add polish, or smooth the voice. AI-flavored rewriting is the failure mode.
- Keep every name, alias, and code-switch (English/Korean mixing, tool names, quoted phrases) exactly as written. If the user publicly refers to the agent by an alias different from its private name, keep the alias verbatim and never surface the private name publicly.
- No emojis, no hashtags, no engagement bait, no calls to action unless the user wrote them.

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

1. Load `BUFFER_API_KEY` from the user's Hermes env on sov (`~/.hermes/.env`), or another known env location the user points to. Never print the full key.
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

Prefer GraphQL variables for Korean/quoted text so escaping stays clean. Run the publish call from an environment that already has the key (typically sov via SSH) so the key never lands in chat logs.

### Images

- Buffer supports image posts / per-thread-segment assets. Prefer Buffer's documented image/asset flow when posting media.
- If media upload via Buffer is blocked or unclear, fall back to browser attach on threads.com.

## Fallback: browser on threads.com

Use only when Buffer is unavailable, the channel is disconnected, media path needs the native composer, or the user asks for on-site composition.

1. Click "What's new?" (or "Create").
2. Fill the first textbox (Playwright `fill` works on the contenteditable).
3. Attach media via "Attach media" + `filechooser` when needed.
4. "Add to thread" for each subsequent segment; fill each new textbox.
5. After fill, verify with `.innerText()` — snapshot trees can falsely duplicate contenteditable text.

## Publish gate and verification

1. Before any externally visible publish, screenshot the draft (or thread segments) and use `request_action_confirmation` as the single approval gate. One gate, not multi-round drafting.
2. After Buffer `shareNow`, poll post status until `sent` (or surface `error`). Then open the live profile and confirm every segment + source links/media.
3. After browser Post, wait for the posting toast/profile update, reload profile if needed, confirm live text.
4. Capture a proof screenshot of the live post and include it in the final report.

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
