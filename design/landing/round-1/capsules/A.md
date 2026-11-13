Classification: INTERNAL

# A — concept capsule

Status: Round 1 typography-led direction. Not selected, not locked. Visual quality unverified (source written and checked; never rendered by the author). Withhold until the human has given a first visual response.

## Premise

In Nexus a link has two ends. Typing `[[` writes the link in one note; the same link then shows up as a backlink on the note it points to (working copy item 3: "every link shows up as a backlink on the other side"; product feature: backlinks). Students and researchers read cross-references this way: the line is written in one place and received, in context, in another.

The page has two sides. The daily-note line, which contains two links, is set once at the foot of this side (where it is written) and again at the foot of the other side (where it is received).

Translation test: this behaves like a backlink because a link written in one note is shown again, with its line, on the other note, so the design repeats the note line at the foot of both sides and gives each side its own width, colour and alignment.

## Font

- Junicode 2 — files `JunicodeVF-Roman.woff2`, `JunicodeVF-Italic.woff2` (internal version 2.003), variable axes wght 300–700, wdth 75–125, ENLA 0–100 (ENLA not used).
- Designer: Peter S. Baker (independent; GitHub profile location Charlottesville, Virginia, US). README: rebuilt successor of a font made for the Medieval Unicode Font Initiative.
- Primary source: https://github.com/psb1558/Junicode-font (`webfiles/` folder, master branch, downloaded 2026-11-13).
- Licence: SIL Open Font License 1.1 (`fonts/junicode/OFL.txt`, copied unmodified). No Reserved Font Name. Web embedding and redistribution allowed with the licence attached. Free; no account.
- Requirements written before the search: scholarly text face; true italic; small caps; old-style figures; a genuine width axis for a second, apparatus voice; brackets that hold at text size.
- Features used: `smcp` (name), `onum` + `pnum` (all figures), default kerning and ligatures.
- Fallback: "Iowan Old Style", Georgia, serif. Technical only: the fallback has no width axis, so the two sides would differ by colour and alignment alone. Not proof of the typography.
- Paid alternative: not researched; the open face meets every written requirement.
- Google Fonts: not used as a source; distribution status there not checked.

## Colour (two text colours)

| Role | Value | Derivation | Governs | Share of copy (characters, 486 incl. the repeated line) | Contrast on canvas |
|---|---|---|---|---|---|
| Canvas | `#E6F5FC` | pinned blue `#0297DE` mixed 90% toward white | whole page | — | — |
| Primary | `#02070A` | pinned ink | this side: name, headline, item 3, the note as written | 57% | 18.15:1 |
| Secondary | `#015A86` | pinned blue shaded toward ink | the other side: item 4, action, the note as received | 43% | 6.71:1 |

Pinned `#0297DE` and `#FC734D` are not used as text: both fail 4.5:1 on a light canvas at text size. The blue hue lives in the canvas and the secondary shade.

Colour rule: colour marks the side, never individual words.

## Type scale and behaviour

Sizes computed from the CSS at 390 px / 1440 px viewport width.

| Element | Size | Weight | Width (wdth) | Style | Line height | Measure |
|---|---|---|---|---|---|---|
| Name (h1) | 17 / 17 px | 500 | 100 | small caps, tracking +0.12em | 1.2 | — |
| Headline (item 2) | 40 / 84.5 px | 400 | 100 | roman, tracking −0.012em, balanced wrap | 1.0 | max 9.2em |
| Item 3 | 18 / 22.4 px | 400 | 100 | roman | 1.45 | max 29em |
| Note as written | 18 / 22.4 px | 400 | 100 | italic | 1.4 | max 29em |
| Item 4 | 16.8 / 21.1 px | 400 | 75 | roman, flush right | 1.38 | max 21em |
| Action (item 5) | 25.6 / 41.3 px | 600 | 75 | roman, flush right | 1.05 | — |
| Note as received | 16.8 / 21.1 px | 400 | 75 | italic, flush right, balanced wrap | 1.38 | max 21em |

- Case: as supplied; small caps only on the name.
- Figures: old-style proportional ("13", "Q4").
- Punctuation: no-break spaces in "13 November", before the em dash, and inside "Project kickoff" and "Q4 roadmap" so a link title never splits across lines.
- Width axis rule: 100 on this side, 75 on the other side.

## Space

- Side margins clamp(20 px, 6vw, 104 px); top clamp(20 px, 4.5vw, 60 px); bottom clamp(40 px, 8vw, 96 px).
- At 960 px and wider: two columns 7fr : 4fr, gutter clamp(48 px, 9vw, 160 px). The other side sits low; the last baselines of both columns align (`align-items: last baseline`, fallback `end`), so the two note lines share one baseline.
- Below 960 px: one column; the other side follows the written note after clamp(56 px, 12vh, 112 px) and stays flush right, so the mirror becomes top/bottom plus left/right.
- Vertical silence: clamp(44 px, 13vh, 144 px) under the name; clamp(28 px, 5vh, 48 px) between headline and item 3; clamp(40 px, 9vh, 88 px) above each note line.
- This side flush left, ragged right; the other side flush right, ragged left.

## Signature relationship

The same note line appears twice, at the foot of each side: as written (normal width, ink, flush left) and as received (condensed width, deep blue, flush right), on one shared baseline on wide screens.

## Invariants if continued

- Two sides with opposite alignment.
- Width marks the side (wdth 100 vs 75); colour marks the side (ink vs deep blue).
- The note line repeated exactly at the foot of both sides.
- Small-caps name; old-style figures; one family.

## Allowed variation

- Column ratio and gutter; headline size; which secondary statements sit on the other side; one or two lines for the received note.

## Prohibited normalisation

- Removing the repetition; centring either side; equalising the two widths; drawing arrows, rules or connectors to show the link; styling individual words as hyperlinks.

## Assumptions and risks

- The repeated line may first read as a duplication error until "on the other side" is read. Human judgement needed.
- Screen readers announce the line twice. Kept on purpose: it is real repeated content, not decoration.
- Right-aligned multi-line paragraphs read more slowly, especially on phones.
- `last baseline` alignment is not supported everywhere; the fallback is bottom alignment.
- Each Junicode file is about 1 MB. A production build would subset it. OFL allows that (no Reserved Font Name), but subsetting counts as modification and the licence must travel with the files.
- Working copy says "Wednesday, 13 November"; 13 November 2026 is a Friday. Kept as supplied.

## Round 2 translation

Keep "this side / the other side" as the structural rule. In product screens, the backlinks area repeats the referring line in the condensed width and secondary colour, flush to the opposite edge. In landing sections, any statement with a counterpart (write/receive, export/import) can use the two-side setting. Never replace the repetition with icons or connecting lines.
