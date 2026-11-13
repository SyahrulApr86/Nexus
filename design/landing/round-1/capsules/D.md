Classification: INTERNAL

# D — concept capsule

Status: Round 1 typography-led direction. Not selected, not locked. Visual quality unverified (source written and checked; never rendered by the author). Withhold until the human has given a first visual response.

## Premise

Product principle 4: "The note is the hero: chrome stays quiet so writing and reading stay in front." The daily-note line (working copy item 6: a dated entry with two links and a tag) is a person's own writing. The name, headline, explanations and action are the product talking about itself: chrome.

Hierarchy is inverted. The note is the largest text on the page, in ink. Everything the product says is small and set in a dark shade of the canvas's own hue.

Translation test: this behaves like the note being the hero because the product's chrome stays quiet around the person's writing, so the design sets the note at display size in ink and all product copy small, in a tonal shade of the canvas.

## Font

- Vollkorn — `Vollkorn[wght].ttf` and `Vollkorn-Italic[wght].ttf`, version 5.000, variable wght 400–900.
- Designer: Friedrich Althausen (GitHub profile location Germany).
- Primary source: https://github.com/FAlthausen/Vollkorn-Typeface (`fonts/variable/`, master branch, downloaded 2026-11-13).
- Licence: SIL OFL 1.1 (`fonts/vollkorn/OFL.txt`), with `Fontlog.txt` copied as the font log asks. No Reserved Font Name. Free; no account.
- Requirements written before the search: text serif that stays robust at 100 px and above (sturdy serifs, moderate contrast, large x-height); figures and brackets that hold at display size; a quiet small-size voice in the same family.
- Weights: 540 note, 400 chrome, 600 name, 700 action. Italic only for the headline inside the chrome. Lining proportional figures in the note.
- Fallback: "Iowan Old Style", Georgia, serif. Technical only.
- Paid alternative: not researched; the open family meets every written requirement.
- Google Fonts: not used as a source; distribution status there not checked.

## Colour (two text colours)

| Role | Value | Derivation | Governs | Share of copy (characters, 406) | Contrast on canvas |
|---|---|---|---|---|---|
| Canvas | `#FC734D` | pinned orange | whole page | — | — |
| Primary | `#02070A` | pinned ink | the note line (item 6) | 20% of characters, most of the text area | 7.42:1 |
| Secondary | `#4A1504` | pinned orange hue (≈15°) shaded toward black | name, headline, items 3, 4, 5 | 80% | 5.50:1 |

Pinned blue `#0297DE` is not used: about 1.2:1 on the orange canvas.

Colour rule: ink only for the person's note; product copy always in the canvas's own shade.

## Type scale and behaviour

Sizes computed from the CSS at 390 px / 1440 px.

| Element | Size | Weight / style | Line height | Notes |
|---|---|---|---|---|
| Note (item 6) | 35.2 / 100.8 px (7vw, max 112 px) | 540, roman, lining figures, tracking −0.012em | 0.98 | 4 lines on wide screens; 6 lines at 560 px and below |
| Name (h1) | 16 px | 600 | 1.3 | tracking +0.01em |
| Chrome text (items 2–5) | 15.7 / 17 px | 400; headline italic; action 700 | 1.45 | auto-fit columns, min 14.5rem |

- Ratio note : chrome ≈ 6 : 1 on desktop, ≈ 2.2 : 1 on phone.
- Note line breaks are fixed by phrase: "Wednesday, 13 November —" / "Linked [[Project kickoff]]" / "to [[Q4 roadmap]]." / "#planning". At 560 px and below, "13 November —" and "[[Project kickoff]]" drop to their own lines.
- Case as supplied; no small caps, no uppercase.
- No-break spaces in "13 November", before the em dash, inside link titles.

## Space

- Page padding: sides clamp(16 px, 4vw, 64 px); top clamp(16 px, 3.2vw, 48 px); bottom clamp(40 px, 6vw, 72 px).
- The note starts clamp(24 px, 7vh, 72 px) below the name.
- The chrome follows clamp(40 px, 9vh, 96 px) below the note, as an auto-fit grid (4 columns on a wide desktop, 1 on a phone), row gap 18 px, column gap clamp(24 px, 3vw, 48 px), max width 76rem.
- Everything flush left. The note's left edge, the name and the chrome share one edge.

## Signature relationship

The person's dated note fills the page in ink; everything Nexus says about itself sits underneath in small type, in the orange's own dark shade.

## Invariants if continued

- User content largest; product copy smallest.
- Chrome colour derived from the canvas hue; ink reserved for user content.
- Phrase-based line breaks for the note; one serif family.

## Allowed variation

- Which honest example note is shown (never an invented claim); number of chrome columns; note size within the viewport.

## Prohibited normalisation

- Enlarging the headline to compete with the note; colouring the links inside the note; turning the action into a coloured control.

## Assumptions and risks

- The product proposition (headline) is small; the page may under-explain what Nexus is. Human judgement needed.
- The action has low prominence by premise.
- The note is sized in `vw` (rem clamp only at the extremes). It is display text, but it will not grow with browser zoom on large screens (WCAG 2.2 SC 1.4.4 Resize Text risk: text sized only in viewport units). Chrome text is rem-based and does scale. Resolve in Round 2.
- Between about 560 and 620 px the first note line may wrap after "Wednesday," before the phone breakpoint applies; it degrades to the phone breaks, not to overflow.
- The weekday mismatch is most visible here, because the date is the largest text: 13 November 2026 is a Friday, the copy says Wednesday. Kept as supplied.

## Round 2 translation

Each landing section can lead with a real example note at display size, with product copy in small tonal type beneath. Product screenshots should show real notes large and the interface quiet. Keep the colour logic: ink for user content, the canvas's shade for product chrome.
