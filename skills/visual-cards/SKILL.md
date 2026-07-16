---
name: visual-cards
description: Render designed dark-theme card images (diagrams, timelines, comparisons, contracts) from small HTML fragments for image-first communication with the user. Use whenever a reply should include a visual card. Token-efficient - the CSS design system is paid once in the template; each card costs only its content fragment.
---

# Visual Cards

The user communicates with images by standing agreement. This skill renders
one designed PNG card from a small HTML body fragment in ~2 seconds, locally,
with no AI image model and no server.

## Primary usage: Satori JSON renderer

Use this first. It is pure Node/WASM, no browser, no server, low-token.

```sh
node scripts/render-card.mjs /tmp/spec.json ./tmp/card.png
```

Minimal spec:

```json
{
  "tag": "Verdict",
  "title": "Design once. Content forever.",
  "sub": "Optional one-line explanation.",
  "rows": [{"k":"Key", "v":"Value"}],
  "steps": [{"q":"Step", "a":"Meaning"}],
  "bars": [{"label":"Old", "value":"4500 tokens", "pct":100, "color":"dim"}],
  "verdict": {"k":"Principle", "v":"Pay for structure once.", "color":"blue"},
  "width": 680,
  "height": 560
}
```

Use the old HTML/Orca renderer only as fallback when full CSS fidelity is required.

## Fallback usage: full-CSS browser screenshot

1. Write ONLY the card body fragment (content, not CSS) to a temp file:
   - `.tag` / `.tag.amber` - small uppercase label
   - `<h1>` - headline; `.sub` - subtitle; `<em>` - emphasis
   - `.pipe` > `.stage`(`.t`,`.d`) + `.arr` - horizontal pipeline
   - `.step` > `.rail`(`.dot`,`.line`) + `.sbody`(`.q`,`.a`) - vertical timeline
   - `.row`(`.k`,`.v`) - key-value rows
   - `.hi` / `.hi.blue` (`.k`,`.v`) - highlight verdict box
   - `.bar` / `.bar.amber` / `.bar.dim` (`.bl`, `.bt` with inline width, `.bv`) - comparison bars
2. Render:
   ```sh
   <skill-dir>/scripts/render.sh /tmp/body.html <session>/tmp/card.png [card-width]
   ```
3. Show in chat: `![caption](./tmp/card.png)` (verify with display() first).

## Requirements / notes

- Needs Orca running (`/usr/local/bin/orca`); uses its browser via `file://` -
  no http server needed.
- Save output under the session `tmp/` and reference with a relative path.
- Keep cards single-viewport (~680-700px wide, under ~900px tall).
- Design language: dark #14171c/#1d2129, blue #3b6df0 for facts/flow, amber
  #d8b06a for mirror/verdict, no emojis.
- Escape/avoid backticks and `$` in fragments written via heredoc.
