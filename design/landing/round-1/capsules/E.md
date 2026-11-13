Classification: INTERNAL

# E — concept capsule

Status: Round 1 typography-led direction. Not selected, not locked. Visual quality unverified (source written and checked; never rendered by the author). Withhold until the human has given a first visual response.

## Premise

People use Nexus for quick capture on phones (supplied users); product principle 3 says "Every device is a first-class device: the phone is not a degraded desktop"; the copy promises "Open your vault in any browser, on any device." On a phone held in one hand, the thumb reaches the lower part of the screen.

The page places all text at the lower edge of the first screen, with the action last and nearest the edge. The field above stays empty. Lines are phrase-length, the length of a capture.

Translation test: this behaves like one-handed phone use because the thumb reaches the lower part of the screen, so the design anchors the whole text stack to the bottom edge, ends with the action, and breaks the copy into phrase-length lines.

## Font

- Andika 7.000 (static Regular and Bold webfonts).
- Publisher: SIL Global (copyright line). The repository describes it as "designed especially for literacy use, taking into account the needs of beginning readers"; its letterforms are drawn so that similar letters are not confused. The organisation's location is not stated on GitHub; US base is an ASSUMPTION from general knowledge.
- Primary source: https://github.com/silnrsi/font-andika/releases/tag/v7.000 (`Andika-7.000.zip` → `web/Andika-Regular.woff2`, `web/Andika-Bold.woff2`; release dated 2025-06-02; downloaded 2026-11-13).
- Licence: SIL OFL 1.1 with Reserved Font Names "Andika" and "SIL" (`fonts/andika/OFL.txt`; `README.txt`, `FONTLOG.txt` copied). Files are used unmodified. Any modified version, including a subset, must be renamed. Free; no account.
- Requirements written before the search: a sans built for legibility at small sizes; unambiguous I l 1 and 0 O; open apertures; at least regular and bold.
- Fallback: Verdana, sans-serif. Technical only.
- Considered and dropped: Inclusive Sans (OFL). Its repository does not state the designer's location and points to a type course outside the listed regions, so provenance could not be confirmed.
- Paid alternative: not researched; the open family meets every written requirement.
- Google Fonts: not used as a source; distribution status there not checked.

## Colour (two text colours, one hue)

| Role | Value | Derivation | Governs | Share of copy (characters, 406) | Contrast on canvas |
|---|---|---|---|---|---|
| Canvas | `#01334D` | pinned blue shaded toward black | whole page | — | — |
| Primary | `#E3F3FC` | pinned blue tinted toward white | name, headline, items 3, 4 | 77% | 11.69:1 |
| Secondary | `#7FCDF3` | pinned blue, lighter tint | the captured note (item 6) and the action (item 5) | 23% | 7.54:1 |

Pinned orange `#FC734D` would pass on this canvas (4.87:1) but is left out so that the page stays in one hue. That is a decision, open to the human.

Colour rule: the two things done with the thumb (capture, open) share the secondary colour; everything said shares the primary.

## Type scale and behaviour

Fixed rem sizes, identical on phone and desktop. The phone is the reference size, and the desktop shows the same stack.

| Element | Size | Weight | Line height |
|---|---|---|---|
| Name (h1) | 34 px | 700 | 1.05 |
| Headline (item 2) | 20.8 px | 700 | 1.25 |
| Items 3, 4 | 17 px | 400 | 1.4 |
| Captured note (item 6) | 17 px | 400 | 1.4 |
| Action (item 5) | 28 px | 700 | 1.1 |

- Ratio action : text ≈ 1.65. Case as supplied.
- One phrase per line (each phrase is a block). Example: "Open your vault in any browser," / "on any device." / "Type [[ to connect one note to another," / "and every link shows up as a backlink" / "on the other side."
- No-break spaces in "13 November", before the em dash, inside link titles.

## Space

- Main area at least one screen tall; a flex column justified to the end, so the stack sits on the lower edge.
- Cross-axis end, so on wide screens the stack sits bottom-right. Stack width 100%, max 24rem.
- Padding: top clamp(32 px, 8vh, 80 px); sides clamp(16 px, 5.5vw, 88 px); bottom clamp(20 px, 3.2vh, 36 px).
- Gaps: 6.4 px after the name; 16.8 px after the headline; 13.6 px between paragraphs; 20 px before the action. Dense by design.
- Flush left inside the stack.

## Signature relationship

An empty upper field over a compact stack that sits on the lower edge and ends with the action nearest the edge.

## Invariants if continued

- Bottom anchoring of the first screen; action last and nearest the edge.
- Phrase-per-line; one hue in three values; a legibility-first face.

## Allowed variation

- Left or right placement on wide screens; size steps; phrase break points.

## Prohibited normalisation

- Moving the action to the top; filling the upper field with imagery or decoration; centring the stack vertically.

## Assumptions and risks

- The stack is about 500 px tall on a phone. On short viewports, or at 200% zoom, it becomes taller than the screen and reads top to bottom normally. That is an acceptable fallback, but the anchoring then disappears.
- The empty field may read as missing content. Human judgement needed.
- Bottom-right placement on desktop reverses the usual start of reading.
- Andika's literacy letterforms may read as educational.
- Working copy weekday mismatch (13 November 2026 is a Friday), kept as supplied.

## Round 2 translation

On phones, put primary capture and open actions in the lower reach zone. Keep the first screen of each landing section bottom-anchored, and keep phrase-length lines. Stay inside the blue hue for this context unless the human approves adding orange.
