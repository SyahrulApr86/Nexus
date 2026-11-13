Classification: INTERNAL

# B — concept capsule

Status: Round 1 typography-led direction. Not selected, not locked. Visual quality unverified (source written and checked; never rendered by the author). Withhold until the human has given a first visual response.

## Premise

The name Nexus is Latin for a binding together (from *nectere*, to bind, to tie — supplied evidence). A bound volume is held at one edge: its title runs along the spine and every leaf is attached at that edge.

The page is set as a bound volume. The name runs down the spine at the left edge; every other line is attached flush to the spine across a narrow binding margin; the open side (fore-edge) and the foot keep wide margins.

Translation test: this behaves like a binding because every leaf is held at one edge and the title runs along that edge, so the design sets the name vertically along the left edge and hangs all text flush from it, with a narrow inner margin and wide outer and foot margins.

## Font

- Sofia Sans, two of its four width families: Sofia Sans (Normal) `SofiaSans[wght].ttf` and Sofia Sans Extra Condensed `SofiaSansExtraCondensed[wght].ttf`, internal version 4.101, variable wght 1–1000.
- Foundry: Lettersoup (Botio Nikoltchev; GitHub profile location Berlin). README: originally designed as a typeface for the capital city of Bulgaria; Latin, Greek and Cyrillic; four widths.
- Primary source: https://github.com/lettersoup/Sofia-Sans (`fonts/variable/Normal/`, `fonts/variable/Extra-Condensed/`, master branch, downloaded 2026-11-13).
- Licence: SIL OFL 1.1 (`fonts/sofia-sans/OFL.txt`). No Reserved Font Name. Free; no account.
- Requirements written before the search: one sans family with several genuine widths, extra-condensed for a vertical title, normal for text; weight range.
- Weights used: 300 headline, 400 text, 650 date, 820 spine and action.
- Fallback: "Arial Narrow" for the spine voice; "Helvetica Neue", Arial for text. Technical only; the width relationship is lost.
- Paid alternative: not researched; the open family meets every written requirement.
- Google Fonts: the README states the per-width split was made for inclusion in the Google Fonts catalogue. Not used as a source here; the family's wide distribution is a familiarity risk.

## Colour (two text colours)

| Role | Value | Derivation | Governs | Share of copy (characters, 406) | Contrast on canvas |
|---|---|---|---|---|---|
| Canvas | `#2A0E05` | pinned orange hue (≈14°) shaded to near black | whole page | — | — |
| Primary | `#FFE1D6` | pinned orange tinted toward white | the leaf: headline, items 3, 4, 6 | 95% | 14.61:1 |
| Secondary | `#FC734D` | pinned orange | spine title and action | 5% of characters, largest area on the page | 6.62:1 |

Pinned ink `#02070A` is not usable as text on this canvas; pinned blue is not part of this logic. The canvas is a derived shade, not one of the three pinned values (owner decision needed if continued).

Colour rule: the binding (spine) and the one action take the pinned orange; all leaf text takes the pale tint.

## Type scale and behaviour

Sizes computed from the CSS at 390 × 844 px / 1440 × 900 px.

| Element | Size | Family / weight | Case and spacing | Line height | Measure |
|---|---|---|---|---|---|
| Spine (h1) | ≈ 90 / ≈ 331 px (clamp(84 px, min(40svh, 23vw), 480 px)) | Extra Condensed 820 | uppercase via CSS, tracking +0.015em, vertical, reads top to bottom | 0.74 (spine thickness ≈ 0.74em) | one word |
| Headline | 30.4 / 60.6 px | Normal 300 | sentence case, tracking −0.015em, balanced wrap | 1.04 | max 10.5em |
| Items 3, 4 | 17 / 20.8 px | Normal 400 | — | 1.5 | max 30em |
| Note (item 6) | 17 / 20.8 px | Normal 400; date phrase 650 | — | 1.5 | max 30em |
| Action | 30.4 / 57.6 px | Extra Condensed 820 | uppercase via CSS, tracking +0.03em | 0.9 | — |

- Spine length ≈ 2.17em: ≈ 194 px on a 390 px phone, ≈ 718 px on a 1440 × 900 desktop.
- Uppercase is presentation only; the source text is "Nexus" and "Open your vault".
- No-break spaces in "13 November", before the em dash, inside link titles.

## Space

- Grid: [spine, auto] [leaf, 1fr]; binding gap clamp(12 px, 2.2vw, 36 px).
- Spine edge margin clamp(12 px, 1.6vw, 28 px); fore-edge margin clamp(16 px, 15vw − 32 px, 256 px); head clamp(16 px, 2.4vw, 32 px); foot clamp(64 px, 14vh, 144 px). Minimum height one screen.
- Leaf max 34rem; everything flush left; no indents; the spine is aligned to the top.
- Gaps: 1.1em between text paragraphs; clamp(28 px, 5vh, 48 px) after the headline and before the note; clamp(36 px, 7vh, 72 px) before the action.

## Signature relationship

The name is the spine — vertical, extra-condensed, orange — and every other line is attached flush to it.

## Invariants if continued

- Vertical name at the binding edge, set with genuine vertical writing (no rotation transforms).
- Extra-condensed for the spine voice, normal width for the leaf.
- Narrow inner margin against wide outer and foot margins.
- Flush-left leaf without indents; the spine voice is reused only for the action.

## Allowed variation

- Spine size and length; the leaf's measure; additional leaves (sections) attached to the same spine; spine on the right only for right-to-left contexts.

## Prohibited normalisation

- Rotating text with transforms instead of vertical writing; centring the leaf; drawing a vertical rule as a spine; giving body text the spine colour.

## Assumptions and risks

- Vertical text is read more slowly; screen readers read "Nexus" normally.
- On phones the spine covers only the top-left (≈ 194 px), so the binding reads less strongly at small sizes.
- The spine is sized in viewport units (svh/vw, inside a rem-based clamp minimum). It is display text, but it will not grow with browser zoom on large screens (WCAG 2.2 SC 1.4.4 Resize Text risk: text sized only in viewport units). Resolve in Round 2.
- `svh` needs a modern browser; a `vw`-only declaration precedes it as fallback.
- The derived dark canvas is outside the three pinned values.
- Working copy weekday mismatch (13 November 2026 is a Friday), kept as supplied.

## Round 2 translation

Keep the binding edge as the persistent element of every artifact: on landing sections the spine runs down the binding edge and section text attaches to it; on cards and social formats the spine sits on the long edge. Keep the two-width pair and the inner/outer margin asymmetry. Do not add rule lines or book imagery.
