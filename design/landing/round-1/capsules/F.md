Classification: INTERNAL

# F — concept capsule

Status: Round 1 typography-led direction. Not selected, not locked. Visual quality unverified (source written and checked; never rendered by the author). Withhold until the human has given a first visual response.

## Premise

The supplied users work at two speeds: "long writing sessions on laptops, quick capture on phones." The copy already holds both. There are short captured fragments (the name, the dated note line, the action) and long explanatory sentences (the headline, items 3 and 4).

Each speed gets its own tempo from one variable family. Quick fragments are heavy, slanted, plain-stroked and tightly set. Long text is light, upright, flared, modulated and openly set. With one text colour, tempo alone carries hierarchy.

Translation test: this behaves like two writing speeds because quick writing leans forward and drops stroke modulation while slow writing stays upright with modulated strokes and space (ASSUMPTION: general handwriting observation, not from the brief), so fast items use slant −12, weight 860, no flare and tight leading, and slow items use slant 0, weight 300–320, full flare and wide leading.

## Font

- Commissioner — `Commissioner[FLAR,VOLM,slnt,wght].ttf`, version 1.012, one variable file: wght 100–900, slnt −12–0, FLAR 0–100, VOLM 0–100.
- Designer: Kostas Bartsokas (GitHub profile location Greece). README: a low-contrast humanist sans; the flare axis turns the straight grotesque into flared (glyphic) terminals; the volume axis raises contrast and works together with flare.
- Primary source: https://github.com/kosbarts/Commissioner (`fonts/variable/`, master branch, downloaded 2026-11-13).
- Licence: SIL OFL 1.1 (`fonts/commissioner/OFL.txt`). No Reserved Font Name. Free; no account.
- Requirements written before the search: a variable sans with a continuous slant axis and a wide weight range; an extra expressive axis welcome.
- Axis settings:
  - Fast: wght 860, slnt −12, FLAR 0, VOLM 0.
  - Slow text: wght 320, slnt 0, FLAR 100, VOLM 40.
  - Slow headline: wght 300, slnt 0, FLAR 100, VOLM 100.
- Fallback: "Avenir Next", "Segoe UI", sans-serif. Technical only; slant, flare and volume are lost.
- Paid alternative: not researched; the open family meets every written requirement.
- Google Fonts: the README mentions a Google Fonts release; not used as a source here. Familiarity risk.

## Colour (one text colour)

| Role | Value | Derivation | Governs | Share | Contrast on canvas |
|---|---|---|---|---|---|
| Canvas | `#FFE6DD` | pinned orange tinted ≈ 80% toward white | whole page | — | — |
| Primary | `#02070A` | pinned ink | every character | 100% | 16.98:1 |

Colour rule: no colour separates the two tempos; only the axes do.

## Type scale and behaviour

Sizes computed from the CSS at 390 px / 1440 px.

| Element | Tempo | Size | Line height | Tracking / spacing | Measure |
|---|---|---|---|---|---|
| Name (h1) | fast | 36 / 70.2 px | 0.96 | −0.018em | — |
| Headline (item 2) | slow | 25.6 / 42.1 px | 1.3 | 0 | max 20em |
| Items 3, 4 | slow | 18 / 22 px | 1.75 | +0.008em; word spacing +0.05em | max 37em |
| Note (item 6) | fast | 36 / 70.2 px | 0.96 | −0.018em | one phrase per line (6 lines) |
| Action (item 5) | fast | 36 / 70.2 px | 0.96 | −0.018em | — |

- Order changed (sequence only): 1 fast, 2 slow, 3 slow, 6 fast, 4 slow, 5 fast. Fast and slow alternate.
- Case as supplied.
- No-break spaces in "13 November", before the em dash, inside link titles.

## Space

- One left axis at clamp(20 px, 8vw, 136 px); right clamp(20 px, 6vw, 96 px); top clamp(24 px, 6vh, 64 px); bottom clamp(64 px, 12vh, 128 px).
- Long pauses before slow blocks: clamp(44 px, 8vh, 88 px). Short pauses before fast blocks: clamp(24 px, 4vh, 40 px).
- Everything flush left on the one axis. No columns, no indents.

## Signature relationship

One face at two speeds on one axis: heavy slanted plain captures and light upright flared reading text, in a single colour.

## Invariants if continued

- One colour; tempo carried by slant, weight, flare, volume, leading and spacing.
- Fast and slow alternate; one left axis; one family.

## Allowed variation

- Which items count as fast (any short capture) or slow (any sustained reading); sizes; the length of the pauses.

## Prohibited normalisation

- Adding colour to separate tempos; using two families; centring; letting the slow text take heavy weights.

## Assumptions and risks

- The product proposition (headline) is set slow and light, so the heavy fragments may dominate it. Human judgement needed.
- Weights 300–320 on a light canvas are thin at 18 px on low-density screens.
- The handwriting-speed mapping is an author assumption, not supplied evidence.
- Working copy weekday mismatch (13 November 2026 is a Friday), kept as supplied.

## Round 2 translation

Map the two tempos onto product surfaces. Capture surfaces (quick entry, captured-item labels, primary actions) take the fast settings; reading and writing surfaces (note body, long explanations) take the slow settings. Keep one colour per surface and let the axes do the work.
