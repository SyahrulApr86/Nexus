Classification: INTERNAL

# Round 1 — pre-handoff source check

Scope: source-level only (HTML, CSS, copy, capsules, font files and licences). **No visual inspection was done.** No page was opened, rendered, screenshotted or inspected with a browser, browser automation, Claude in Chrome, Playwright, Puppeteer, Computer Use or image analysis. Text widths were estimated by adding up glyph advance widths with fontTools; that is arithmetic on font data, not rendering. Legibility, composition, optical balance, typesetting quality and visual independence are unproven and remain the human's judgement.

Date: 2026-11-13. Author: one author for all ten directions.

## Files

```
design/landing/round-1/
  index.html            neutral links A–J (default browser styling, no <style>)
  A.html … J.html       ten dependency-free pages; fonts loaded by relative @font-face URLs
  capsules/A.md … J.md  concept capsules — withhold until the first visual response
  fonts/<family>/       16 font files + licence/log files (30 files, 7.7 MB)
  contrast.py           WCAG contrast checker holding every canvas/text pair used
  SOURCE-CHECK.md       this file
```

No PNG, WebP, JPEG, PDF, screenshot, thumbnail or SVG exists in the folder. No SVG markup or `data:image` URI exists in any file.

## Checks against CONCEPT-ROUNDS.md and VERIFICATION.md

The checks were run with a script against every page. Results:

| Check | Result |
|---|---|
| A–J exist as ten separate pages | Pass |
| No external dependency; every `url()` is a local `fonts/` file that exists on disk | Pass |
| `index.html` links A–J in order, label = letter only, no styling, ranking or descriptions | Pass |
| All six working-copy items present verbatim in every page (no-break spaces normalised) | Pass, 10/10 |
| No word outside the working-copy vocabulary | Pass, 10/10 |
| Only allowed elements: html, head, meta, title, style, body, main, div, h1, p, span, b (b = the matched keyword in J) | Pass |
| No borders, outlines, shadows, gradients, filters, masks, clip paths, transforms, animation, transitions, pseudo-elements, background images, text decoration, opacity, list markers, SVG, canvas, img, hr, links or forms inside A–J | Pass |
| One flat background colour per page (same value on html and body) | Pass |
| `lang="en"`, `<title>Nexus</title>`, exactly one h1 | Pass, 10/10 |
| Classification label at the top of every authored file | Pass |
| Capsules A–J exist, each with premise, font/source/licence/fallback, colour roles with proportion and contrast, scale, case, spacing, margins, whitespace, signature, invariants, allowed variation, prohibited normalisation, risks and Round 2 notes | Pass (manual read) |

Deliberate repetitions (allowed: they do not change meaning):

- A repeats item 6 at the foot of both sides. That is the direction's premise.
- In every page the words "Open your vault" appear twice. Item 3 begins with the same three words as item 5, so this is a property of the supplied copy, not an addition.

Sequence changes (allowed; words unchanged). Item order as it appears in each page's source:

| Order | Directions |
|---|---|
| Copy order 1–6 | C, G |
| 1, 2, 3, 6 on this side, then 4, 5, 6 on the other side | A |
| 1, 6, 2, 3, 4, 5 | D |
| 1, 2, 3, 6, 4, 5 | F |
| 1, 2, 3, 4, 6, 5 | B, E, H, I, J |

DOM order equals visual order on every page, so assistive technology reads the same sequence a sighted reader sees.

## Colour

Every active text colour, checked with `contrast.py` (WCAG 2.x relative luminance):

| Dir. | Canvas | Text colours (role → ratio) | Depth |
|---|---|---|---|
| A | `#E6F5FC` | `#02070A` primary 18.15 · `#015A86` secondary 6.71 | 2 |
| B | `#2A0E05` | `#FFE1D6` primary 14.61 · `#FC734D` secondary 6.62 | 2 |
| C | `#0297DE` | `#02070A` primary 6.25 | 1 |
| D | `#FC734D` | `#02070A` primary 7.42 · `#4A1504` secondary 5.50 | 2 |
| E | `#01334D` | `#E3F3FC` primary 11.69 · `#7FCDF3` secondary 7.54 | 2 |
| F | `#FFE6DD` | `#02070A` primary 16.98 | 1 |
| G | `#FFFFFF` | `#02070A` primary 20.24 · `#01639A` secondary 6.46 · `#5D6870` tertiary 5.71 · `#B42A03` accent 6.42 | 4 |
| H | `#9ED8F5` | `#02070A` primary 13.11 · `#014A70` secondary 6.14 · `#6B2008` accent 7.41 | 3 |
| I | `#02070A` | `#0297DE` primary 6.25 · `#FC734D` secondary 7.42 | 2 |
| J | `#E9ECEE` | `#02070A` primary 17.06 · `#4F5B62` secondary 5.89 | 2 |

- Every pair passes 4.5:1, so none relies on the large-text exception.
- Depth coverage: 1 colour (C, F), 2 (A, B, D, E, I, J), 3 (H), 4 (G). Requirement met.
- Every canvas is distinct.
- Derived values keep the pinned hues: orange shades and tints sit at about 13–15°, blue at about 199–202°, and neutrals come from the ink hue (about 202–205°).

Role governance (share of copy characters; the capsules record area notes):

| Dir. | Shares |
|---|---|
| A | ink 57% / blue 43% |
| B | peach 95% / orange 5%; the orange covers the largest area (the spine) |
| D | ink 20% (the display note, most of the area) / rust 80% |
| E | 77 / 23 |
| G | 82 / 8 / 5 / 5; the three minor roles sit in the largest lines and form the hanging token column |
| H | 47 / 28 / 25 |
| I | 54 / 46 |
| J | 67 / 33 |

No colour is applied to an arbitrary single word. Every role follows a rule written in its capsule: side, binding, chrome, reach, layer, item, mood, match.

## Fonts — provenance and licence

The type requirements were written for all ten directions before any font source was opened. They are recorded in each capsule; a summary follows.

- A: scholarly text face, italic, small caps, old-style figures, width axis.
- B: one sans family with several genuine widths.
- C: monospace for continuous reading.
- D: text serif robust at 100 px and above.
- E: legibility-first sans with unambiguous I l 1 and 0 O.
- F: variable sans with continuous slant and a wide weight range.
- G: one family with proportional and monospaced states.
- H: width axis down to extra-condensed, weights and italics.
- I: sturdy text face for light-on-dark with an optical-size axis and italic.
- J: reference face with a strong bold and a compact width.

All files were taken from the designers' or foundries' own repositories. Google Fonts was not used as a source. All are SIL OFL 1.1. No account, purchase or licence acceptance was involved.

| Dir. | Family, version | Files (sha256 first 16 hex) | Designer / foundry, stated location | Primary source | Reserved Font Name |
|---|---|---|---|---|---|
| A | Junicode 2, 2.003 | JunicodeVF-Roman.woff2 `a5838c9ed2cd6eca`, JunicodeVF-Italic.woff2 `71add8ebed5f6272` | Peter S. Baker, Charlottesville VA, US | github.com/psb1558/Junicode-font | none |
| B | Sofia Sans, 4.101 | SofiaSans[wght].ttf `a3e1019b8867e21b`, SofiaSansExtraCondensed[wght].ttf `69b42c883ad334de` | Lettersoup (Botio Nikoltchev), Berlin; designed for Sofia, Bulgaria | github.com/lettersoup/Sofia-Sans | none |
| C | Commit Mono, 1.143 | CommitMonoV143-VF.woff2 `f342ca6c3f2597e6` | Eigil Nikolajsen; location not stated (.dk website; Denmark = ASSUMPTION) | github.com/eigilnikolajsen/commit-mono | none |
| D | Vollkorn, 5.000 | Vollkorn[wght].ttf `d4d26fd39d2d41c7`, Vollkorn-Italic[wght].ttf `2ba5fc8c143d65a3` | Friedrich Althausen, Germany | github.com/FAlthausen/Vollkorn-Typeface | none |
| E | Andika, 7.000 | Andika-Regular.woff2 `bd46cba17fb1ee30`, Andika-Bold.woff2 `d42a45070e8e85ed` | SIL Global; location not stated (US = ASSUMPTION) | github.com/silnrsi/font-andika (release v7.000) | "Andika", "SIL" — files used unmodified |
| F | Commissioner, 1.012 | Commissioner[FLAR,VOLM,slnt,wght].ttf `866b403dd8ab4168` | Kostas Bartsokas, Greece | github.com/kosbarts/Commissioner | none |
| G | Recursive, 1.085 | Recursive_VF_1.085.woff2 `145e9fc086d13403` | Arrow Type (Stephen Nixon), Brooklyn NY, US | github.com/arrowtype/recursive | none |
| H | Archivo, 2.001 | Archivo[wdth,wght].ttf `664bbeb10522dac3`, Archivo-Italic[wdth,wght].ttf `99e6e9a40bc1af88` | Omnibus-Type, Buenos Aires | github.com/Omnibus-Type/Archivo | none |
| I | Piazzolla, 2.005 | Piazzolla[opsz,wght].woff2 `9bf8fba7efc1eaa3`, Piazzolla-Italic[opsz,wght].woff2 `5b6663be156c4daf` | Juan Pablo del Peral, Huerta Tipográfica / HT Fonts; org location United Kingdom (Argentine origin = ASSUMPTION) | github.com/huertatipografica/piazzolla (release v2.005) | none |
| J | Besley*, 4.000 | Besley[wdth,wght].woff2 `3e944187f59bc67a` | indestructible type* (Owen Earl); location unverified | github.com/indestructible-type/Besley | none |

- No two directions share a family.
- Each licence file sits beside its fonts, copied unmodified, together with FONTLOG / README files where present. The OFL headers of Junicode and Commit Mono carry the designers' contact addresses. They are kept because the OFL requires the notice to travel with the fonts, and they are not reproduced anywhere else.
- Font files are unmodified: no subsetting, no format conversion.
- File names keep their original square brackets. CSS references them percent-encoded (`%5B` and `%5D`).

Glyph coverage (fontTools cmap check): every family has the em dash and the no-break space used by the copy. Several lack thin or hair spaces, so none are used.

Candidate considered and dropped: Inclusive Sans. Its designer's location is not stated in the repository, and the README points to a type course outside the listed regions.

Paid foundries were **not searched**. ISOLATION-PROTOCOL step 3 asks to include them, but every written requirement was met by an open face, and the brief allows a paid face to be recorded only "if a paid face would be ideal". No paid face was judged necessary, so no prices are recorded. If a direction is shortlisted, a paid search against the same written requirements can follow, before any acquisition and with the human's approval.

## Isolation audit (ISOLATION-PROTOCOL.md)

Allowed evidence used:

- the evidence capsule in the brief;
- the working copy;
- `PRODUCT.md`;
- the Latin sense of *nectere*, as supplied;
- the calendar fact that 13 November 2026 falls on a Friday (computed).

Functional research only:

- GitHub API (repository metadata, file trees, releases, profile location fields) for the eleven repositories above.
- Raw text files (licences, READMEs, font logs, AUTHORS) and font binaries from those repositories, plus two release archives (Piazzolla, Andika).
- One HTTP status request to SIL's download page (body not read).

Not opened at any point: type catalogues or specimen pages, Google Fonts, design galleries, award sites, competitor or Obsidian websites, UI kits, templates, icon libraries, image boards, generated imagery. README image links (specimens) were not opened.

No direction depends on a platform kit or a named style. Each page was written from a blank file around its own premise.

Pairwise independence review (source level):

- One overlap was found and rebuilt. F and G both placed item 6 as a large stack of short lines between items 3 and 4, which gave them the same reading path. G was rebuilt: copy order with the note last, set in four lines whose typed tokens hang as one margin column. F was left unchanged.
- No other pair shares a page skeleton, font family, size scale, case strategy, palette, alignment logic or whitespace rhythm in source. The alignment logic of each, in one line:
  - A: two sides, opposite alignment, feet on one baseline.
  - B: vertical spine with flush leaf.
  - C: single offset column, one size.
  - D: display note over a small multi-column chrome.
  - E: bottom-anchored stack.
  - F: one axis, alternating tempos.
  - G: hanging token margin.
  - H: one justified packed block.
  - I: two stepped axes by mood.
  - J: central keyword axis.
- Whether they are visually independent is for the human to judge.

## Accessibility at source level

- Semantic text only: one h1 per page, real `<p>` paragraphs, `lang="en"`.
- No interactive elements. Item 5 is set as text, as the brief asks, so keyboard and focus checks do not apply in Round 1.
- Contrast: every pair is 4.5:1 or better (table above).
- No motion of any kind.
- Text resizing:
  - Body text everywhere uses rem, or rem plus vw.
  - Two display elements are sized in viewport units only (inside rem-based clamps): B's vertical name and D's note line. They will not grow with browser zoom on large screens (WCAG 2.2 SC 1.4.4 Resize Text risk: text sized only in viewport units). This is recorded in both capsules for Round 2.
  - H was corrected during this check to include a rem component.
- Reflow at 390 px was checked by arithmetic on glyph advance widths against the CSS widths, not by rendering:
  - No unbreakable line exceeds the content width at 390 px.
  - D switches to phrase breaks at 560 px and below.
  - G's headline and first note line wrap rather than overflow.
  - `overflow-wrap: break-word` is set as a guard everywhere.
- Progressive CSS with fallbacks declared:
  - `align-items: last baseline` (A; falls back to `end`);
  - `svh` (B, E; a `vh`/`vw` declaration comes first);
  - `text-wrap: balance` (A, B, G);
  - `hyphenate-limit-chars` (H).

## Open issues for the human or the lead

1. The working copy reads "Wednesday, 13 November", but 13 November 2026 is a **Friday** (it was a Wednesday in 2024 and will be again in 2030). The copy was kept exactly as supplied. It is most visible in D, where the date is the largest text.
2. Several families are also distributed by Google Fonts. This is confirmed from the primary repositories for Sofia Sans, Commissioner and Recursive, and not checked for the others. That is a familiarity risk, not a licence issue.
3. Designer and foundry locations are partly unverified (C, E, I origin, J). Region was used as a discovery route only.
4. Canvases B (`#2A0E05`) and H (`#9ED8F5`), and several text tints and shades, are derived from the pinned hues rather than being the three pinned values. The brief allows this; the owner may still want to confirm.
