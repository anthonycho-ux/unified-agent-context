---
name: editorial-minimal-design
description: Design long-form reading pages with editorial minimal, a content-first page design system for single-page essay sites, editorial layout, and long-form web story pages where the writing is the product. One signature element carries the identity, everything else stays quiet.
---

# Editorial minimal

Editorial minimal is a design system with one rule: the writing is the product, so the page must do nothing to compete with it. One signature element carries the identity. Everything else stays quiet. If a reader remembers the layout before the essay, the layout failed.

## When to use

Reach for this system on single-essay pages, long-form reading experiences, and any content where the words are the product. Think a personal essay, a report that reads like a story, an article page, a letter.

The contrast case matters as much as the fit. SaaS marketing landing pages need a different system entirely: product shots, gradient hero sections, stacked proof, conversion pressure. That energy is correct there and wrong here. Do not blend the two. A landing page styled like an essay undersells, an essay styled like a landing page suffocates.

## Design tokens

Measured live from seths.blog on 2026-08-05. The source implements the same look in a WordPress theme using PT Serif plus Source Sans Pro, but the tokens are the system and the fonts are just one delivery of it.

- **Two-tone top rule.** 8px `#ff8c00` stacked over 8px `#ffb900`. Rendered only at the top-left. This is the page's only color, and it is enough.
- **Reading column.** 512 to 740px wide, centered or offset, on a white background. The column is generous but bounded, so the eye returns to the text instead of wandering.
- **Body text.** Serif (PT Serif class), 17.6px, line-height 1.55 to 1.6, ink `#2c3e50`. A soft dark rather than pure black keeps long reading comfortable.
- **Links.** Royal blue `#003eff`, no underline at rest, underline only on hover. The color change is the affordance, the underline is the confirmation.
- **Headlines.** Heavy sans (Source Sans Pro class), weight 900, roughly 2.2em, letter-spacing -0.02em, line-height 1.1, black. Heavy and tight so the title carries presence without needing decoration.
- **Masthead.** Tiny. A small portrait-size logo, quiet 16px sans section labels, and a small 12.8px date line set above titles. The masthead introduces, it does not announce.
- **Separation.** Whitespace only. No borders, no cards, no hero image, no imagery competing with the writing. Space between blocks does the work that lines and boxes do elsewhere.

## Anti-patterns

The lesson of this system is the restraint, not the relics. Do not copy the source's dated implementation. Three specific traps to avoid.

`user-scalable=no` breaks accessibility by blocking pinch zoom on mobile. Never ship it. Let readers zoom.

IE-era shim comments are dead weight from the mid-2010s. No current reader needs them, and no current codebase benefits from them.

The mid-2010s Google Fonts pairing (PT Serif with Source Sans Pro) was a good match then. It is not sacred now. The modern equivalent is one heavy sans plus one serif from any current source, loaded with modern font delivery and `font-display: swap`. Pinch zoom allowed, keyboard focus visible, reduced motion respected. The system is the discipline, not the byte-for-byte copy.

## Application recipe

Five steps, in order.

1. **Name the subject and the page's single job.** One sentence for each. The subject is what the writing is about. The job is what the reader should carry away. If you cannot write both sentences, you are not ready to design.
2. **Choose ONE signature element that embodies the subject.** A color, a rule, a numeral style, a single repeated motif. This is the only place the page gets to be loud.
3. **Derive 4 to 6 named hex tokens from it.** Give each token a role and a name, not just a value. The signature color, the ink, the link blue, the quiet gray for dates. Naming forces you to decide what each color is for.
4. **Build everything else quiet around the signature.** Apply the tokens above: a bounded reading column, serif body, heavy sans headlines, a tiny masthead, whitespace separation. Restraint is a choice you make at every element, not a mood you declare once.
5. **Run a self-critique pass and remove one accessory before shipping.** Look at the finished page and delete the least necessary non-text element. Then look again. If the page survives both removals, it was carrying accessories, not structure.

## Provenance

Tokens measured live from seths.blog, 2026-08-05. akimbo.com is the contrast case: a podcast landing site that shares almost nothing with the blog's language, which is exactly why the pair is instructive. Two products of one author, two honest systems. Editorial minimal is for one of them.
