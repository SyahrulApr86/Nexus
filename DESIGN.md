---
name: Nexus
description: Connected markdown notes in the browser; an Obsidian-class workspace, dark first, drawn with the precision of a blueprint. The note is the sheet.
colors:
  # Dark (the showcase; the public pages use this set)
  frame-navy: "#02070a"
  sheet: "#070f15"
  raised: "#0c161e"
  hover: "#101c26"
  active: "#15232e"
  hairline: "#18252f"
  rule: "#111c25"
  mist: "#2c3c49"
  control-edge: "#55697b"
  text: "#e9eef2"
  slate: "#a2b0bc"
  fog: "#8796a3"
  accent-blue: "#0297de"
  accent-blue-ink: "#3fb2ee"
  accent-line: "#0297de"
  accent-wash: "#0a2537"
  on-accent: "#02070a"
  mark-orange: "#fc734d"
  mark-orange-ink: "#ff8f6e"
  mark-wash: "#2b1913"
  highlight: "#55291b"
  negative: "#f0707a"
  positive: "#3fc07a"
  # Light (same structure, follows the system or data-theme="light")
  light-frame: "#eef1f5"
  light-sheet: "#ffffff"
  light-raised: "#ffffff"
  light-hover: "#e5eaf0"
  light-active: "#dde4eb"
  light-hairline: "#d9dfe6"
  light-rule: "#e8ecf0"
  light-mist: "#b1b7c3"
  light-control-edge: "#7a8494"
  light-text: "#02070a"
  light-slate: "#47505d"
  light-fog: "#59636f"
  light-accent-ink: "#01669a"
  light-accent-line: "#01669a"
  light-accent-wash: "#e0f2fb"
  light-mark-ink: "#b02a04"
  light-mark-wash: "#ffe8df"
  light-highlight: "#ffd6c7"
  light-negative: "#c4242a"
  light-positive: "#247b50"
typography:
  display-title:
    fontFamily: "Hanken Grotesk, ui-sans-serif, sans-serif"
    fontSize: "40px"
    fontWeight: 500
    lineHeight: "46px"
    letterSpacing: "-0.035em"
  display-title-phone:
    fontFamily: "Hanken Grotesk, ui-sans-serif, sans-serif"
    fontSize: "30px"
    fontWeight: 500
    lineHeight: "36px"
    letterSpacing: "-0.035em"
  section-title:
    fontFamily: "Hanken Grotesk, ui-sans-serif, sans-serif"
    fontSize: "24px"
    fontWeight: 500
    lineHeight: "30px"
    letterSpacing: "-0.035em"
  stat-value:
    fontFamily: "Hanken Grotesk, ui-sans-serif, sans-serif"
    fontSize: "40px"
    fontWeight: 400
    lineHeight: "40px"
    letterSpacing: "-0.035em"
  note-body:
    fontFamily: "Literata, ui-serif, Georgia, serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.7
  note-heading:
    fontFamily: "Hanken Grotesk, ui-sans-serif, sans-serif"
    fontWeight: 600
    note: "h1 1.6em/-0.025em, h2 1.32em/-0.02em, h3 1.1em/-0.01em"
  palette-input:
    fontFamily: "Hanken Grotesk, ui-sans-serif, sans-serif"
    fontSize: "17px"
    letterSpacing: "-0.01em"
  ui:
    fontFamily: "Hanken Grotesk, ui-sans-serif, sans-serif"
    fontSize: "13px"
    lineHeight: "20px"
  ui-dialog:
    fontFamily: "Hanken Grotesk, ui-sans-serif, sans-serif"
    fontSize: "14px"
    lineHeight: "20px"
  meta:
    fontFamily: "Hanken Grotesk, ui-sans-serif, sans-serif"
    fontSize: "12px"
    lineHeight: "16px"
  code:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.84em"
rounded:
  tag: "2px"
  key: "4px"
  control: "6px"
  panel: "8px"
spacing:
  base: "4px"
  rail: "52px"
  sidebar-left: "264px"
  sidebar-right: "288px"
  sheet-inset: "8px"
  tab-strip: "40px"
  view-header: "44px"
  status-bar: "28px"
  tree-row: "28px"
  note-measure: "46rem"
---

# Design System: Nexus

## Overview

Nexus is a notebook you work in for hours, so the design is built like an instrument: dark first,
precise, quiet chrome, and the note as the one bright, generous thing on screen. The direction is
"dark, luxurious, bold" in the Linear and Raycast sense: luxury is precision (one rhythm, crisp
hairlines, tight display type, tabular figures), not effects. The structural language comes from
the owner's blueprint reference (huge tight display type, hairline structure, flat surfaces, 8px and
2px radii, a 4px grid, one rationed accent, schematic line-art, no shadows at rest), rendered on the
brand navy.

The app style was dealt with the taste skill (`draw.mjs --app --kind workspace --keep palette,type`,
style `data-terminal`, seed 1915448899): an icon rail shell, and one selection mark used everywhere,
a 1px accent line as wide as the selected label on the nearest edge. Where the dealt sheet and the
owner's reference disagree on look, the reference wins (navy instead of neutral black, Hanken as the
display face).

Signature element: the vault drawn as schematic line-art. On the home view, the vault plan is one
hairline bar per note grouped by folder, the newest edit marked by the one blue dot; in the graph,
slate nodes on hairline edges over a 24px survey grid, the open note ringed in blue, tags in orange.

## Shell (structure)

- **Rail, 52px** on the frame: Nexus's own mark (a wikilink's `[[ ]]` holding one node) at the top;
  five destinations; utilities (shortcuts, settings, the account initial) at the foot behind a short
  hairline. The active destination is marked by a 1px accent line on the rail's right edge.
- **Left sidebar, 264px** on the frame: the scope first (vault switcher with the vault's initial in a
  ruled tile), then a "Find a note" field that opens the quick switcher, then text tabs "Files" and
  "Search" with the 1px accent line under the selected label, then the tree. The tree's header row
  states what it holds ("8 notes · 3 folders") with the tools at its right.
- **The sheet**: everything you work on sits on one inset panel, 8px from the window's top, right and
  bottom edges, radius 8, a hairline edge, no shadow. Inside it: panes split by hairlines, the right
  sidebar behind a hairline, and the status bar along the bottom.
- **Tab strip, 40px**: a ruled strip, tabs split by vertical hairlines; the selected tab is ink with
  the accent line under its label (grey line when its pane is not focused). No rounded browser tabs.
- **View header, 44px**: back, forward, a left-aligned breadcrumb (folders in fog, the current note in
  ink, chevrons between), presence, mode toggle, more.
- **Status bar, 28px**: a save dot and label on the left (blue at rest, red on failure), counts on the
  right split by hairline ticks, tabular figures.
- **Phone**: a 48px top bar (menu, title, mode, links), the sheet full width, a 5-item bottom bar with
  labels; both sidebars become drawers on the raised tone.

## Colors

Dark is the showcase: `#02070a` frame, the sheet one small step up (`#070f15`), overlays one more
(`#0c161e`), row states at `#101c26` and `#15232e`. Hairlines are `#18252f` (structure) and
`#111c25` (row rules); `#2c3c49` draws line-art and the edges of what floats; `#55697b` is the edge of
any control (>= 3:1). Text is `#e9eef2`, slate `#a2b0bc`, fog `#8796a3`: every one of them >= 4.5:1
on every ground including the active row (fog on active 5.28:1).

Blue `#0297de` is rationed: links (as `--accent-ink`, `#3fb2ee` dark / `#01669a` light), the
selection line (`--accent-line`, `#01669a` on light because `#0297de` is 2.9:1 on the light frame),
focus rings, the one primary button (navy label on blue, 6.3:1) and data points. Orange `#fc734d` only
marks things: tags, `==highlights==`, search hits (the palette colours the matched letters in
`--mark-ink`). Status red and green appear only for failure and for positive callouts.

Light follows the same structure: blue-grey frame `#eef1f5`, white sheet, the same roles.

## Typography

Three faces, each with one job (owner-fixed): **Hanken Grotesk** for all interface text and for
display (note titles 40px/46 at -0.035em weight 500; screen titles 40px; settings section titles
24px; stat figures 40px at weight 400, tabular); **Literata** for note text (17px/1.7) with note
headings set in Hanken 600 with tight tracking, so prose and structure read apart; **JetBrains Mono**
only for real code, code blocks and YAML. Keycaps use Hanken at 11px/500. Interface body is 13px in
chrome, 14px in dialogs, meta 12px; nothing under 11px. Sentence case everywhere, no eyebrows.

## Layout

4px grid. Note column max 46rem (about 70 characters of Literata at 17px), 48px top padding on
desktop, the title then one meta line ("Created Nov 14, 2026"; on phones the folder too), 32px to the
text. Home view: a two-column header (title left, guidance right), a three-cell figure strip in one
ruled container, then "Start" (ruled rows with keycaps) beside the vault plan, using container
queries so it holds in a narrow pane. Settings: a 212px area list on the frame beside the area's own
view (one view per area: Appearance, Editor, Files and links, Import and export, Account, Hotkeys).

## Elevation

Flat. Nothing at rest casts a shadow; separation is a tone step or a hairline. Only what floats
(menus, dialogs, the palette, toasts, the canvas toolbar, drawers) uses `.float-panel`: the raised
tone, a mist edge, `--shadow-float` (dark `0 16px 40px -12px rgb(0 0 0 / .42)`, light
`0 6px 24px rgb(2 7 10 / .1)`), and the scrim behind modals.

## Shapes

Radius 8 for panels, the sheet, dialogs, menus and buttons; 6 for small controls and rows; 4 for
keycaps; 2 for tags and chips. Icons are Lucide outline at 1.5px, 17px in chrome.

## Components

- **Command palette (hero)**: 640px, top of screen, 56px input row (icon, 17px input, the mode named
  at the right), a caption row ("Recently edited", "4 matches", "25 commands"), 40px result rows
  (icon, name with the matched letters in orange ink, folder in fog, a relative date or the keycaps
  right-aligned); the active row is the active tone with the 1px accent line on its left edge; a
  40px hint bar on the frame tone.
- **Properties**: a ruled spec table under the title; keys in slate with a type icon, values read as
  text and show a control edge on focus (hover fills the row tone); tags as 2px orange chips.
- **Menus**: raised panel, 32px rows (44px on touch), the focused row with the accent line on its
  left edge, separators as full-width hairlines, danger items in red.
- **Buttons**: primary = blue fill, navy label, 8px radius, one per dialog; secondary = 1px control
  edge, transparent, ink label, hover fills; text actions in blue ink.
- **Right sidebar**: icon tabs with the accent line under the selected icon; a two-line heading (view
  name 15px/600, the note's name in fog); backlinks as ruled rows (name 13/500 ink, context in slate,
  the linked words in blue); tags with a 2px usage track (slate share of the most used tag).
- **Toasts**: raised tone (navy on light), mist edge, a 6px blue dot, 13px text, Dismiss.
- **Theme setting**: three drawn previews of the frame and sheet in each theme, as radio cards.
- **Canvas**: dot-grid board, cards with hairline edges (coloured cards keep their preset edge and
  wash), the toolbar floats on the raised tone.

## Do's and Don'ts

Do: keep the note the brightest, roomiest thing on screen; mark every selection with the one 1px
accent line; let hairlines and tone steps carry structure; set figures tabular; keep orange for tags,
highlights and search hits.

Don't: gradients, glows, glass or blur; emoji; eyebrow labels; monospace outside code; coloured left
borders thicker than 1px; shadows on anything that does not float; motion that is not feedback
(menus, dialogs and toasts rise 6px over 200ms; reduced motion turns all of it off).

## Shared with the public pages

The landing track uses the dark set above. Token names kept for them: `--sheet`, `--frame`, `--fg`,
`--muted`, `--border` (and aliases `--canvas`, `--panel`, `--ink`, `--slate`, `--hairline`);
utilities `bg-sheet`, `bg-frame`, `text-muted`, `border-border`, `font-note`, `font-ui`. New:
`--raised` / `bg-raised`, `--accent-line` / `bg-accent-line`, `.float-panel`, `.display`.
