# Public pages: direction (landing, sign-in, sign-up, share)

Owner direction (latest): dark, luxurious, bold, Linear/Raycast class, built on the structural language of
the `DESIGN/` "blueprint atlas" reference rendered dark-first. This replaces the light-first atlas attempt.

## Direction

- Dealt with `draw.mjs --sector dev-tool --keep palette,type`: **The sentence is the layout**
  (seed 1228940191). Kept from it: one short sentence at poster scale with a piece of the product sitting
  inside it where a word would be (the inline graph slot in "Plain notes, [graph] linked."), and the
  section rhythm of statement-with-proof.
- Redrawn toward the owner's reference where they disagree (the reference wins): plain top bar instead of
  the dealt photographic hero; the real workspace shown big under the headline; hairline structure
  (owner-approved, so the inspector runs with `--allow hairline` and the lint lines carry
  `taste-skill-ignore` with that reason); two-column section headers; big stat values; schematic line art
  (graph, bars) as Nexus's own signature visual. The dealt "Architecture" photographs are not used.
- Idea sentence: *On this page, the note itself (a [[link]], a #tag, the vault's graph) becomes the
  sentence and its pictures.*
- The one live thing: the hero's workspace window. Type markdown in the left pane and the right pane
  renders it the way Live Preview does (the caret's line stays as source); the window tabs load two more
  example notes; the status bar counts words, outgoing links and tags as you type. It is built from
  `mini-markdown.tsx`, which builds React elements only (no HTML strings). Without script the textarea
  holds the first example and the preview is the server render. On a phone the panes stack.

## Tokens (landing uses the dark set always; share follows the system)

Same values as the SHARED TOKEN VALUES from design/app, defined landing-scoped in
`src/components/landing/tokens.css` as `--lp-*`:

| role | dark | light (share page only) |
| --- | --- | --- |
| canvas | #02070a | #ffffff |
| panel (one step) | #0b131a | #f2f4f7 |
| panel-2 (selected rows, inner panes) | #111c25 | #e9edf2 |
| ink | #e8eef2 | #02070a |
| slate (secondary text) | #a9b5c0 | #4d5562 |
| faint (metadata) | #8a98a5 | #5e6674 |
| hairline | #1f2b36 | #d3d8e0 |
| rule | #141e27 | #e6e9ee |
| mist (line art) | #2c3a47 | #b1b7c3 |
| control edge | #5d6f80 | #7a8290 |
| accent fill / focus | #0297de | #0297de |
| accent ink (links) | #36aeeb | #01669a |
| label on accent | #02070a (6.25:1) | #02070a |
| orange mark / ink | #fc734d / #ff8a66 | #fc734d / #b42a03 |

Added beyond the shared set (landing-only, suggest folding into DESIGN.md if the app wants them):
`--lp-panel-3` #172430 (a third tone step), `--lp-blue-soft` #062436, `--lp-orange-soft` #2e1710
(mark ground in dark).

Role mapping from the reference: carbon -> navy, electric blue -> #0297de rationed to the primary action,
active item, focus and graph data points; wireframe green -> orange for tags, highlights and search hits.

## Type

Hanken Grotesk for display and UI (display 500, tracking -0.045em, leading 0.94); Literata for note text
(the workspace window's preview, fragments' note lines, the share page); JetBrains Mono only inside
`<code>`/`<pre>` (terminal block, inline code, operators). This is the brand's third face; the inspector
warns "3 typefaces" and we keep it on purpose. Steps on the landing: display clamp(54px, 8vw, 124px),
title clamp(36px, 4.4vw, 64px), lead clamp(18px, 1.45vw, 21px), text 17px, small 15px. Interface
fragments keep the app's 12-15px.

## Structure (three structural changes per surface, all done)

Landing
1. Fixed left rail replaced by a plain sticky top bar (wordmark, four links, Sign in, one action); hero
   headline left with the lead and actions in the right five columns on the headline's baseline.
2. The real workspace (rail, file tree, tabs, split editor, backlinks pane, local graph, status bar) shown
   big under the headline as the live thing, taking more than half the first screen.
3. Each section its own composition: graph full width with the backlinks pane docked over its corner;
   search as a display-size query over results plus an operator table; canvas with a spec sheet; a
   panel-tone band with copy, phone and two-cursor collaboration; four big figures, terminal and exported
   files; a display-size close; footer with the name at full width.

Sign-in / sign-up
1. Split 7/5 with a divider replaced by a top bar plus a 12-column stage: display title, lead, and a 2x2
   glimpse of the vault (backlinks, search, canvas, graph crops) on the left; the form on one flat panel.
2. Inputs 48px, 8px corners, blue focus edge; the switch link sits under a hairline inside the panel.
3. The vault drawn as a floor of bars along the foot of the screen. The glimpse is desktop only.

Share page
1. Slim bar with a "Read-only note" tag; the note's own headings are demoted one level so the page has a
   single h1 (the note name).
2. Title block in Literata at display size with a meta row (updated date, reading time) and a rule.
3. The close is a band one tone up, signed "Shared from [[Nexus]]". The static 404 in `src/proxy.ts` is
   restyled to the same frame (copy unchanged); it cannot load the web fonts, so it uses system fallbacks.

Also: the landing OG image is redrawn dark (Literata headline on navy, bar floor) to match.

## Gate

- `lint.mjs` on all owned sources: 0 FAIL, 0 WARN.
- `inspect.mjs --allow hairline`: landing 0 FAIL at 1440/768/390 (WARN: 3 typefaces, no photographs or
  footage, spec rows, margin at 768); sign-in and sign-up 0 FAIL. The share page is a read surface, not a
  persuasion page, so it is inspected with `--app` (0 FAIL); in page mode it fails picture floor, focal
  point and first action by design.
- No photographs or footage: the honest pictures of a notes app are its own interface, so every picture is
  a `data-ui` crop of the dark workspace built in HTML.

## Critique (critique.md §4 shape), last round

- First screen: says what it is (headline, lead) and what to do (one blue action); the product fills the
  lower half and can be typed into. Score 8.
- Composition and variety: six sections, no two share a layout; one rest per page (the band). Score 7.5.
- Type: confident display scale and tracking; five steps outside fragments. Score 8.
- Colour: navy field with tone steps, one blue, orange only on tags and hits. Score 8.
- Imagery: all interface crops; strong for software, but no real screenshot of the revamped app yet.
  Score 7.
- Motion: headline rise, window settle, graph edges drawing in, entrances per section part, carets and
  cursors blinking, all off under reduced motion. Score 7.5.
- Still short: imagery should switch to real captures of the revamped dark workspace once design/app
  lands; the canvas and graph crops in the sign-in glimpse are dense at 380px wide; the 404 page has no
  brand fonts.
- Sample content to confirm: the example vault (Q4 roadmap, Weekly sync, Mira Chen, Lisbon trip), the
  collaboration lines and the reading-time estimate (220 words a minute).
