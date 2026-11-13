Classification: INTERNAL

# I — concept capsule

Status: Round 1 typography-led direction. Not selected, not locked. Visual quality unverified (source written and checked; never rendered by the author). Withhold until the human has given a first visual response.

## Premise

Nexus is keyboard-driven (Ctrl+O opens a note, Ctrl+P opens commands — supplied evidence). The copy is written in two grammatical moods:

- Imperatives, what you do: "Open your vault in any browser, on any device.", "Type [[ to connect one note to another,", "Export the whole vault as a .zip,", "open it in Obsidian,", "or run Nexus on your own server.", "Open your vault".
- Indicatives, what is then true: "Notes that link to each other, in plain markdown.", "and every link shows up as a backlink on the other side.", "Your notes stay .md files." These are joined by the record of what was done (the dated note line) and the name.

Each mood gets its own colour, style and axis. Commands are roman, red-orange, on the outer axis. What then holds is italic, blue, one step in.

Translation test: this behaves like a command and its result because each typed command is followed by a state that holds, so the design alternates imperative clauses (roman, orange, outer axis) with indicative clauses (italic, blue, one step in).

## Font

- Piazzolla — `Piazzolla[opsz,wght].woff2` and `Piazzolla-Italic[opsz,wght].woff2`, version 2.005, variable opsz 8–30 and wght 100–900. Optical size is automatic (font-optical-sizing: auto).
- Designer: Juan Pablo del Peral (AUTHORS.txt). Foundry: Huerta Tipográfica / HT Fonts. The GitHub organisation lists its location as United Kingdom; the foundry's Argentine origin is an ASSUMPTION from general knowledge.
- Primary source: https://github.com/huertatipografica/piazzolla/releases/tag/v2.005 (`Piazzolla.zip` → `Piazzolla/variable/woff2/`; release dated 2022-01-13; downloaded 2026-11-13).
- Licence: SIL OFL 1.1 (`fonts/piazzolla/OFL.txt`). No Reserved Font Name. Free; no account.
- Requirements written before the search: a sturdy text face for light-on-dark colour at body and display sizes; an optical-size axis; italic.
- Weights: 520 imperative (roman), 400 indicative (italic), 300 name (italic), 700 action (roman).
- Fallback: "Iowan Old Style", Georgia, serif. Technical only.
- Paid alternative: not researched; the open family meets every written requirement.
- Google Fonts: not used as a source; distribution status there not checked.

## Colour (two text colours, pinned values only)

| Role | Value | Derivation | Governs | Share of copy (characters, ≈ 401) | Contrast on canvas |
|---|---|---|---|---|---|
| Canvas | `#02070A` | pinned ink | whole page | — | — |
| Primary | `#0297DE` | pinned blue | indicative clauses, name, headline, dated record | 54% | 6.25:1 |
| Secondary | `#FC734D` | pinned orange | imperative clauses and the action | 46% | 7.42:1 |

Only the three pinned colours are used.

Colour rule: colour follows grammatical mood, clause by clause.

## Type scale and behaviour

Sizes computed from the CSS at 390 px / 1440 px.

| Element | Size | Style / weight | Line height | Notes |
|---|---|---|---|---|
| Clauses (items 2, 3, 4) | 21.25 / 37.5 px | imperative roman 520; indicative italic 400 | 1.18 | max 24em each |
| Name (h1) | 54.4 / 148.8 px | italic 300, tracking −0.02em | 0.9 | indicative axis |
| Dated record (item 6) | 17 / 23.3 px (max(17 px, 0.62em)) | italic 400 | 1.35 | max 34em |
| Action (item 5) | 24.4 / 43.1 px | roman 700 | 1.05 | imperative axis |

- Each clause starts on its own line. Line breaks fall only at clause boundaries; clauses wrap naturally inside their axis.
- Case as supplied. No-break spaces in "13 November", before the em dash, inside link titles.

## Space

- Imperative axis: the left padding, clamp(16 px, 7vw, 120 px).
- Indicative axis: one step further in, by clamp(28 px, 11vw, 176 px).
- Right clamp(16 px, 5vw, 80 px); top clamp(24 px, 5vw, 72 px); bottom clamp(48 px, 10vw, 112 px).
- Groups separated by 0.95em; clauses within a group by 0.14em; the record set off by 1.6em; the action by 0.75em.

## Signature relationship

Two moods on two axes: roman orange commands at the edge, italic blue consequences one step in.

## Invariants if continued

- Mood mapped to colour, style and axis; pinned colours only; one clause per line.

## Allowed variation

- Step size; sizes; which clause opens each group.

## Prohibited normalisation

- Mixing moods within one colour; centring; turning commands into buttons or key-cap shapes.

## Assumptions and risks

- Treating the dated note line (past tense, "Linked …") as indicative is an interpretation: it records a result.
- Pinned blue on near-black reaches 6.25:1. Whether it holds comfortably at small sizes on every screen is a human judgement.
- The large light italic name depends on the font loading.
- Working copy weekday mismatch (13 November 2026 is a Friday), kept as supplied.

## Round 2 translation

In the product and documentation, imperative labels (commands, actions, shortcuts, command-palette entries) take the orange roman voice on the outer axis. State, confirmation and result text takes the blue italic voice one step in. Help pages can be written and set as command/result pairs.
