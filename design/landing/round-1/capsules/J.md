Classification: INTERNAL

# J — concept capsule

Status: Round 1 typography-led direction. Not selected, not locked. Visual quality unverified (source written and checked; never rendered by the author). Withhold until the human has given a first visual response.

## Premise

Nexus has full-text search (supplied evidence). A search for a word finds every place it occurs, including inside other words and inflections.

The page is set as a keyword-in-context index for "link", the word the product is about. Every occurrence starts on one vertical axis in the heaviest weight: "link", "link", "back|link", "Link|ed". The words before each occurrence end at the axis; the words after it start there. Copy without the word (the name, item 4, the action) keeps its place around the axis in the second colour.

Translation test: this behaves like a search index because every match is shown at the same position with its context on both sides, so the design aligns each occurrence of "link" on one vertical axis and sets non-matching copy in the secondary colour.

## Font

- Besley* — `Besley[wdth,wght].woff2`, version 4.000, variable wdth 75–100, wght 400–900. Roman only.
- Foundry: indestructible type* (Owen Earl, per the README). Location not stated: unverified. README: inspired by the designs of Robert Besley; includes condensed and narrow widths, old-style and tabular figures, small caps.
- Primary source: https://github.com/indestructible-type/Besley (`fonts/webfonts/`, master branch, downloaded 2026-11-13).
- Licence: SIL OFL 1.1 (`fonts/besley/OFL.txt`; `FONTLOG.txt` copied). No Reserved Font Name. Free; no account.
- Requirements written before the search: a reference-work face with a strong bold for the matched term; a width compact enough to fit context on both sides of an axis on a phone.
- Settings: wdth 75 for all text; wght 400 for context, 900 for the matched word; the name at wdth 100, wght 700; tabular lining figures.
- Fallback: Rockwell, "Century Schoolbook", serif. Technical only.
- Paid alternative: not researched; the open family meets every written requirement.
- Google Fonts: not used as a source; distribution status there not checked.

## Colour (two text colours)

| Role | Value | Derivation | Governs | Share of copy (characters, 406) | Contrast on canvas |
|---|---|---|---|---|---|
| Canvas | `#E9ECEE` | neutral derived from the ink hue | whole page | — | — |
| Primary | `#02070A` | pinned ink | every line containing "link": items 2, 3, 6 | 67% | 17.06:1 |
| Secondary | `#4F5B62` | neutral derived from the ink hue | copy without "link": name, item 4, action | 33% | 5.89:1 |

Pinned orange and blue are not used as text; both fail on a light canvas at these sizes.

Colour rule: colour follows match / no match; the matched word itself is marked by weight, never by a highlight.

## Type scale and behaviour

- Base size clamp(1.0625rem, 0.84rem + 0.95vw, 1.75rem): 17.2 px on a 390 px phone, 27.1 px at 1440 px. Line height 1.32.
- Name 2.3em: 39.4 / 62.4 px.
- Matched word weight 900; context 400.
- Line breaks:
  - Item 3 is broken into phrase rows so that each matched row has a short context before the axis: "Open your vault in any browser," / "on any device. Type [[ to connect" / "one note to another, and" / "every | link shows up as a" / "back | link on the other side."
  - Item 6 is set as "Wednesday," / "13 November — | Linked [[Project kickoff]] to [[Q4 roadmap]]. #planning".
- Case as supplied. Inflections are split at the stem ("Link" + "ed"), as in a concordance.
- No-break spaces in "13 November" and before the em dash.

## Space

- Every item is the same two-cell grid: context before the axis, context after it.
- Axis at 54% of the content width below 768 px and 46% from 768 px up.
- Context-before cells are right-aligned, with 0.2em right padding (the word space a right edge would otherwise remove; 0 for "back"+"link"). Context-after cells are left-aligned.
- Non-matching items: the name and the action end at the axis (left of it); item 4 starts at the axis (right of it).
- Padding: top clamp(24 px, 6vh, 72 px); sides clamp(16 px, 6vw, 96 px); bottom clamp(48 px, 10vh, 112 px). Items separated by 1.05em.

## Signature relationship

A vertical column of "link" in the heaviest weight, made only by alignment.

## Invariants if continued

- One shared axis for every item.
- The matched word at weight 900; non-matching copy in the secondary colour.
- The split at word boundaries or stems, never mid-syllable for effect.

## Allowed variation

- The keyword per artifact ("vault", "note"); axis position; sizes.

## Prohibited normalisation

- Highlight boxes or backgrounds behind matches; colouring matches instead of using weight; dropping the alignment on phones.

## Assumptions and risks

- By premise, the name and the action are de-emphasised (grey). This is a conversion risk and a human judgement.
- On phones the cells are narrow (about 185 px and 158 px), so several rows wrap to two or three lines. Right-aligned multi-line context reads more slowly.
- The splits "back|link" and "Link|ed" may surprise readers; for assistive technology they are contiguous text ("backlink", "Linked").
- Working copy weekday mismatch (13 November 2026 is a Friday), kept as supplied.

## Round 2 translation

Use this on index-like artifacts: the search page, the documentation index, the changelog. Always align the queried term on one axis. Landing sections can each take one product word as their axis.
