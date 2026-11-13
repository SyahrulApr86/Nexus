Classification: INTERNAL

# H — concept capsule

Status: Round 1 typography-led direction. Not selected, not locked. Visual quality unverified (source written and checked; never rendered by the author). Withhold until the human has given a first visual response.

## Premise

"Export the whole vault as a .zip" (working copy item 4). Positioning: the files stay yours; the whole vault exports to a `.zip` that opens in Obsidian. An archive packs every file into one container, without loss and without reordering.

The page packs the whole copy into one justified, hyphenated run of text, with no line breaks and no gaps between items. Items are told apart only by width, weight, slope and colour inside the run. A condensed width packs more per line.

Translation test: this behaves like a `.zip` because every file is kept, in order, inside one container with nothing between them, so the design sets all six items as one continuous justified block at width 62 and separates them only by changes of width, weight, slope and colour.

## Font

- Archivo — `Archivo[wdth,wght].ttf` and `Archivo-Italic[wdth,wght].ttf`, version 2.001, variable wdth 62–125, wght 100–900.
- Foundry: Omnibus-Type (GitHub profile location Buenos Aires). README: a grotesque reminiscent of the late nineteenth century, designed for print and screen at the same time.
- Primary source: https://github.com/Omnibus-Type/Archivo (`fonts/variable/`, master branch, downloaded 2026-11-13).
- Licence: SIL OFL 1.1 (`fonts/archivo/OFL.txt`). No Reserved Font Name. Free; no account.
- Requirements written before the search: a genuine width axis down to extra-condensed; weights; italics; an even texture for justified, hyphenated setting.
- Settings:
  - wdth 62 for all running text; wdth 125 for the name and the action.
  - wght 380 text, 600 dated note, 800 headline, 900 name and action.
  - Italic for item 4.
- Fallback: "Arial Narrow", sans-serif. Technical only.
- Paid alternative: not researched; the open family meets every written requirement.
- Google Fonts: not used as a source; distribution status there not checked.

## Colour (three text colours)

| Role | Value | Derivation | Governs | Share of copy (characters, 406) | Contrast on canvas |
|---|---|---|---|---|---|
| Canvas | `#9ED8F5` | pinned blue tinted ≈ 60% toward white | whole page | — | — |
| Primary | `#02070A` | pinned ink | headline and item 3: what Nexus is and does | 47% | 13.11:1 |
| Secondary | `#014A70` | pinned blue shaded toward ink | item 4: what you keep and take away | 28% | 6.14:1 |
| Accent | `#6B2008` | pinned orange hue (≈15°) shaded toward black | name, dated note, action: identity, record, call | 25% | 7.41:1 |

All text is at least 33.6 px (large text). The 3:1 floor would apply, but every pair exceeds 4.5:1. Pinned `#FC734D` fails on this canvas.

Colour rule: colour changes only at item boundaries, never inside an item.

## Type scale and behaviour

- One size for all items: clamp(2.1rem, 1rem + 5.2vw, 6.5rem). That gives 36.3 px on a 390 px phone and 90.9 px at 1440 px; the rem component lets it grow under browser zoom.
- Line height 1.0. Justified; `hyphens: auto` (lang en); `hyphenate-limit-chars: 7 3 3` where supported. No tracking change.
- The block runs about 34 characters per line on a phone and about 50 on desktop.
- Order changed (sequence only): 1, 2, 3, 4, 6, 5. The run ends with the action.
- Case as supplied. There is no uppercase; the width jump (62 → 125) does the work case would do.
- One word space between items. No-break spaces in "13 November" and before the em dash.

## Space

- Padding clamp(12 px, 2.4vw, 40 px) on all four sides. The block fills the full width, with no max-width.
- No paragraph spacing and no line breaks between items.

## Signature relationship

The whole page is one packed, justified rectangle in which widths 62 and 125 meet inside the same run.

## Invariants if continued

- No breaks or gaps between items; one size; justified and hyphenated.
- Width as the main differentiator; colour roles by item.

## Allowed variation

- Item order; the block's size relative to the viewport; which items take width 125.

## Prohibited normalisation

- Splitting items into spaced paragraphs; adding separators, bullets or pipes; centring; switching to a normal-width face.

## Assumptions and risks

- Justified text at about 34 characters per line on phones can produce uneven word spacing; hyphenation dictionaries differ by browser and operating system.
- The name is set apart from the headline only by width and colour. Human judgement needed on whether items read as distinct.
- `display: inline` keeps the h1 and paragraph semantics for assistive technology, but item boundaries are not announced as pauses by every reader.
- Justified large text is acceptable at WCAG AA (1.4.8 is AAA).
- Working copy weekday mismatch (13 November 2026 is a Friday), kept as supplied.

## Round 2 translation

Treat display artifacts as packed containers: social cards, the export screen and documentation covers become full-width justified blocks with width jumps. Interactive interface needs separation for usability, so Round 2 must decide with the human how far packing extends beyond display surfaces.
