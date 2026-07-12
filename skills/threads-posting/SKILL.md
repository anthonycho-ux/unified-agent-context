---
name: threads-posting
description: Publish posts on Threads (threads.com) for the user. Use whenever the user wants to write, draft, or publish a Threads post or thread, with or without an attached image.
---

# Threads Posting (portable behavior contract)

## Core rule: the user's text IS the post
- When the user supplies their own text, treat it as final copy. Apply a light pass only: fix dictation artifacts, doubled words, and obvious typos. Never rewrite sentences, reorder ideas, add polish, or smooth the voice. AI-flavored rewriting is the failure mode.
- Keep every name, alias, and code-switch (English/Korean mixing, tool names, quoted phrases) exactly as written. If the user publicly refers to an agent by a public alias, keep the alias verbatim and never surface any private agent name publicly.
- No emojis, no hashtags, no engagement bait, no calls to action unless the user wrote them.

## When the user gives only an image or a rough idea
1. Read any attached image/page fully first.
2. Check the user's recent Threads posts for register (language, length, tone) before drafting.
3. Lead with ONE committed draft in that register plus a marked recommendation; offer numbered alternatives (post as-is / tweak / different angle). Do not present a menu of equal drafts.

## Mechanics (handle silently, never make the user think about them)
- Threads caps each post at 500 characters. Count characters programmatically before composing.
- Over-limit text becomes a multi-post thread: split at natural paragraph seams, never mid-thought. Attach media to the first post.
- Verify each segment landed before adding the next, using whatever browsing/automation tooling the current agent has.

## Publish gate and verification
1. After composing the full thread, present the final composed state to the user as a single approval gate (screenshot or verbatim preview). One gate, not multi-round drafting.
2. Publishing is externally visible: never post without that explicit approval.
3. After posting, reload the profile and confirm the post text is live; verify all segments and media exist; include proof (screenshot or link) in the final report.

## Anti-goals
Unless explicitly asked, do not suggest hashtags, optimal posting times, translations to another language, engagement/reach optimizations, or unsolicited new post ideas.
