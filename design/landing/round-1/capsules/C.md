Classification: INTERNAL

# C — concept capsule

Status: Round 1 typography-led direction. Not selected, not locked. Visual quality unverified (source written and checked; never rendered by the author). Withhold until the human has given a first visual response.

## Premise

Nexus keeps notes as plain `.md` files (working copy: "in plain markdown", "Your notes stay .md files"; product principle 1: "Plain files first"). A plain text file carries characters, line breaks and blank lines, and nothing else: no type sizes, weights or colours.

The page carries only what such a file carries: one monospaced face, one size, one weight, one text colour. Hierarchy comes only from order, blank lines and an offset measured in characters.

Translation test: this behaves like a plain `.md` file because the file holds no sizes or styles, only characters and line breaks, so the design uses one face, size, weight and colour and separates items by exactly one blank line.

## Font

- Commit Mono — file `CommitMonoV143-VF.woff2` (version 1.143), variable wght 200–700 and ital 0–1. Used at weight 400, upright only.
- Designer: Eigil Nikolajsen. Location not stated in the repository; the designer's website is on a `.dk` domain, so Denmark is an ASSUMPTION.
- Primary source: https://github.com/eigilnikolajsen/commit-mono (`src/fonts/fontlab/CommitMonoV143-VF.woff2`, the variable webfont the project's own site uses; main branch, downloaded 2026-11-13). The zipped release was not used. ASSUMPTION: the file matches release 1.143 in design.
- Licence: font under SIL OFL 1.1 (`fonts/commit-mono/LICENSE-FONT`); the repository's code is MIT (separate file, not copied). No Reserved Font Name. Free; no account.
- Requirements written before the search: monospace; one weight is enough; built for reading continuous sentences; clean `[ ] # —` within the cell.
- Features: none applied; ligatures off. The default instance is weight 200, so weight 400 is set explicitly.
- Fallback: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace. Technical only, but any monospace keeps the character-cell logic, so this direction degrades more gently than the others.
- Paid alternative: not researched; the open face meets every written requirement.
- Google Fonts: not used as a source; distribution status there not checked.

## Colour (one text colour)

| Role | Value | Derivation | Governs | Share | Contrast on canvas |
|---|---|---|---|---|---|
| Canvas | `#0297DE` | pinned blue | whole page | — | — |
| Primary | `#02070A` | pinned ink | every character | 100% | 6.25:1 |

Colour rule: one text colour; no colour may mark links, tags, the name or the action.

## Type scale and behaviour

- One size for every element: clamp(15 px, 0.55rem + 0.75vw, 20 px), which gives 15 px on a 390 px phone and 19.6 px at 1440 px.
- Line height 1.6. Weight 400. No tracking change. No italics, no bold, no case transforms. The h1 inherits the paragraph font exactly.
- No-break spaces in "13 November" and before the em dash.
- Natural soft wrapping; no hard wraps (a fixed column count would overflow a phone).

## Space

- Column max 60ch.
- Left offset: 2ch on phones; 8ch from 896 px up. Right padding 2ch.
- Top offset: three lines. Bottom: six lines.
- Exactly one blank line (one line height) after every item. Flush left, ragged right.
- Order: copy order 1–6.

## Signature relationship

The name is no larger than any sentence; the only structure is the blank line.

## Invariants if continued

- One face, one size, one weight, one colour.
- Blank-line separation; offsets in whole characters.
- Copy order as written.

## Allowed variation

- The size value per viewport; the offset in whole characters; the measure in characters.

## Prohibited normalisation

- Enlarging or bolding the name or the action; adding a second colour for links or tags; syntax highlighting; centring; adding headings in a second size.

## Assumptions and risks

- May be read as unfinished, or as a code or terminal reference. Human judgement needed.
- The action has no visual distinction; it is found by its words and position only.
- 15 px monospace on phones is on the small side, though contrast is 6.25:1.
- Long reading on a fully saturated blue canvas is untested.
- Working copy weekday mismatch (13 November 2026 is a Friday), kept as supplied.

## Round 2 translation

Every artifact behaves like a text file: sections separated by blank lines, emphasis only by position measured in characters. Interactive elements need an affordance that keeps one size and one colour (for example, a character-based indent or a fixed position). That affordance must be decided with the human after a lock. Never add a second size to rescue hierarchy.
