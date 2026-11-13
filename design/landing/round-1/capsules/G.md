Classification: INTERNAL

# G — concept capsule

Status: Round 1 typography-led direction. Not selected, not locked. Visual quality unverified (source written and checked; never rendered by the author). Withhold until the human has given a first visual response.

## Premise

In Nexus, structure is typed as characters: `[[ ]]` makes a link, `#` makes a tag, and files end in `.md` (working copy items 3, 4, 6; "in plain markdown"). Developers and writers type these tokens by hand.

The page keeps every typed token visible. Tokens are set in the monospaced state of the same family, in a recessive colour, and hung outside the text edge by exactly their own width, so the words stay aligned. Link targets and the tag name get their own colour. The person's note uses the family's casual state. The name and the action carry the accent.

Translation test: this behaves like markdown source because structure is made of typed characters that stand in front of the words, so the design sets those characters monospaced and grey and hangs them into the left margin by their exact cell width.

## Font

- Recursive — `Recursive_VF_1.085.woff2`, version 1.085, variable MONO 0–1, CASL 0–1, wght 300–1000, slnt −15–0, CRSV 0–1.
- Designer: Arrow Type (Stephen Nixon; GitHub profile location Brooklyn, NY).
- Primary source: https://github.com/arrowtype/recursive (`fonts/ArrowType-Recursive-1.085/Recursive_Web/woff2_variable/`, main branch, downloaded 2026-11-13).
- Licence: SIL OFL 1.1 (`fonts/recursive/LICENSE.txt`). No Reserved Font Name. Free; no account.
- Requirements written before the search: one family that switches between proportional (prose) and monospaced (markup) with shared design.
- Axis settings:
  - Prose: MONO 0, CASL 0, wght 400 (text), 640 (headline), 700 (name), 760 (action).
  - Typed tokens: MONO 1, CASL 0, wght 400; each cell is exactly 0.6em.
  - Note content: MONO 0, CASL 1, wght 500.
- Fallback: "Segoe UI", "Helvetica Neue", sans-serif. Technical only: the mono/casual states and the exact 0.6em hanging are lost.
- Paid alternative: not researched; the open family meets every written requirement.
- Google Fonts: the repository holds a `recursive_for_googlefonts` folder, so the family is co-distributed there. Not used as a source. Familiarity risk.

## Colour (four text colours)

| Role | Value | Derivation | Governs | Share of copy (characters, 406) | Contrast on canvas |
|---|---|---|---|---|---|
| Canvas | `#FFFFFF` | neutral white | whole page | — | — |
| Primary | `#02070A` | pinned ink | prose | 82% | 20.24:1 |
| Secondary | `#01639A` | pinned blue shaded toward ink | link targets "Project kickoff", "Q4 roadmap"; tag name "planning" | 8% | 6.46:1 |
| Tertiary | `#5D6870` | neutral derived from the ink hue | typed tokens `[[ ]] # .md .zip` (monospaced) | 5% | 5.71:1 |
| Accent | `#B42A03` | pinned orange shaded toward black | name (h1) and action (item 5) | 5% | 6.42:1 |

Secondary, tertiary and accent are small by character count. They sit in the largest lines (note at up to 44 px, action at up to 41 px), and the tertiary tokens form the hanging column that defines the left edge. Pinned `#0297DE` fails on white at text size (3.24:1) and would only qualify for text of 24 px and above.

Colour rule: one colour per layer (prose / target / typed / call), never per word for emphasis.

## Type scale and behaviour

Sizes computed from the CSS at 390 px / 1440 px.

| Element | Size | Weight | Line height | Notes |
|---|---|---|---|---|
| Name (h1) | 20 px | 700 | 1.2 | accent |
| Headline (item 2) | 35.2 / 73.6 px | 640 | 1.02 | tracking −0.022em, max 11em, balanced |
| Items 3, 4 | 17.6 / 21.6 px | 400 | 1.5 | measure 34em |
| Action (item 5) | 25.6 / 40.6 px | 760 | 1.1 | accent |
| Note (item 6) | 21.4 / 44.5 px | 500, CASL 1 | 1.16 | four lines, three hanging tokens |

- Order: copy order 1–6, the note last.
- Line breaks:
  - Item 3 breaks after "Type", so `[[ ` starts the next line and hangs.
  - The note is set as "Wednesday, 13 November — Linked" / "[[Project kickoff]] to" / "[[Q4 roadmap]]." / "#planning".
- Hang amounts (negative text-indent): `[[ ` 1.8em, `[[` 1.2em, `#` 0.6em.
- Case as supplied. No-break spaces in "13 November", before the em dash, inside link titles.

## Space

- Text edge at clamp(35 px, 14vw, 208 px) from the left. The margin holds the hung tokens.
- Right clamp(16 px, 6vw, 96 px); top clamp(24 px, 5vh, 56 px); bottom clamp(64 px, 12vh, 128 px).
- Gaps: clamp(28 px, 6vh, 64 px) after the name; clamp(24 px, 4vh, 40 px) between paragraphs and before the action; clamp(48 px, 10vh, 104 px) before the note.
- One text column, flush left at the text edge; only tokens cross it.

## Signature relationship

Typed tokens hang outside the text edge as a grey monospaced column while the words stay aligned.

## Invariants if continued

- Tokens always visible, monospaced, recessive and hung by their exact width.
- Link targets in the secondary colour.
- One family switching states (MONO for typed, CASL for the person's note).

## Allowed variation

- Which lines begin with tokens (a line-breaking choice); sizes; the margin width.

## Prohibited normalisation

- Hiding tokens; turning link targets into underlined hyperlinks; highlighting other words; using a second family for the monospaced layer.

## Assumptions and risks

- May read as a code-editor or developer-tool look, a familiar formula. Human judgement needed.
- On phones the forced break leaves a line ending "Type". The first note line wraps after the em dash on narrow screens, which is acceptable.
- Four colours on white could fragment longer copy with more tokens.
- Font file is 719 KB.
- Working copy weekday mismatch (13 November 2026 is a Friday), kept as supplied.

## Round 2 translation

This direction transfers directly to the editor and reading views: tokens visible, recessive and hung. In landing sections, every product example (a link, a tag, a file) shows its typed form hanging in the margin. Monospaced cells set the hang widths, so they stay exact at any size.
