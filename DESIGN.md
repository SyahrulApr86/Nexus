---
name: Nexus
description: Connected markdown notes in the browser; an Obsidian-class workspace drawn as a blueprint atlas, where the note is the sheet.
colors:
  ink-navy: "#02070a"
  canvas-white: "#ffffff"
  panel-blue-grey: "#f2f4f7"
  hover: "#e8ecf1"
  active: "#e3e8ee"
  hairline: "#d3d8e0"
  rule: "#e6e9ee"
  mist-line-art: "#b1b7c3"
  control-edge: "#7a8290"
  slate-text: "#4d5562"
  fog-text: "#5e6674"
  accent-blue: "#0297de"
  accent-blue-ink: "#01669a"
  accent-blue-wash: "#e1f3fb"
  on-accent: "#02070a"
  mark-orange: "#fc734d"
  mark-orange-ink: "#b42a03"
  mark-orange-wash: "#ffe8e0"
  highlight-peach: "#ffd9cc"
  negative-red: "#c4242a"
  positive-green: "#247b50"
  dark-canvas: "#02070a"
  dark-panel: "#0b131a"
  dark-hover: "#131d26"
  dark-active: "#18232e"
  dark-hairline: "#1f2b36"
  dark-rule: "#141e27"
  dark-mist: "#3d4d5c"
  dark-control: "#5d6f80"
  dark-text: "#e8eef2"
  dark-slate: "#a9b5c0"
  dark-fog: "#8a98a5"
  dark-accent-ink: "#36aeeb"
  dark-mark-ink: "#ff8a66"
typography:
  display-title:
    fontFamily: "Hanken Grotesk, ui-sans-serif, sans-serif"
    fontSize: "32px"
    fontWeight: 500
    lineHeight: "38px"
    letterSpacing: "-0.03em"
  stat-value:
    fontFamily: "Hanken Grotesk, ui-sans-serif, sans-serif"
    fontSize: "32px"
    fontWeight: 400
    lineHeight: "38px"
    letterSpacing: "-0.02em"
  note-body:
    fontFamily: "Literata, ui-serif, Georgia, serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.65
  ui-lead:
    fontFamily: "Hanken Grotesk, ui-sans-serif, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "24px"
  ui-body:
    fontFamily: "Hanken Grotesk, ui-sans-serif, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  ui-label:
    fontFamily: "Hanken Grotesk, ui-sans-serif, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
  code:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.84em"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  tag: "2px"
  panel: "8px"
spacing:
  grid: "4px"
  ribbon: "44px"
  tab-bar: "40px"
  row: "28px"
  sheet-inset: "8px"
  left-sidebar: "260px"
  right-sidebar: "280px"
  measure: "672px"
components:
  button-primary:
    backgroundColor: "{colors.accent-blue}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.panel}"
    height: "36px"
    padding: "0 16px"
  button-ghost:
    backgroundColor: "{colors.canvas-white}"
    textColor: "{colors.ink-navy}"
    borderColor: "{colors.control-edge}"
    rounded: "{rounded.panel}"
    height: "36px"
  icon-button:
    textColor: "{colors.fog-text}"
    rounded: "{rounded.panel}"
    size: "32px"
  input-field:
    backgroundColor: "{colors.canvas-white}"
    borderColor: "{colors.control-edge}"
    rounded: "{rounded.panel}"
    height: "32px"
  tree-row-active:
    backgroundColor: "{colors.active}"
    textColor: "{colors.accent-blue-ink}"
    rounded: "{rounded.panel}"
  tag-chip:
    backgroundColor: "{colors.mark-orange-wash}"
    textColor: "{colors.mark-orange-ink}"
    rounded: "{rounded.tag}"
  note-sheet:
    backgroundColor: "{colors.canvas-white}"
    borderColor: "{colors.hairline}"
    rounded: "{rounded.panel}"
  callout:
    backgroundColor: "{colors.panel-blue-grey}"
    borderColor: "{colors.hairline}"
    rounded: "{rounded.panel}"
---

# Design System: Nexus

> Classification: INTERNAL

## Overview

**Creative North Star: "A blueprint atlas of your notes."**

Nexus is a working notebook drawn like a technical atlas. The owner's reference (DESIGN/, a "blueprint atlas" style) sets the look: a white canvas, monochrome ink and muted slate, hairline structure, flat tone steps instead of shadows, radii of 8px and 2px only, a 4px grid, and one rationed accent. The Obsidian structure stays: ribbon, file explorer, tab bar, the note as a white sheet on a blue-grey frame, right sidebar for links and outline, status bar.

The accent is rationed exactly like the reference's: **blue #0297DE** marks the primary action, the active item, focus and data points (the current node in the graph, the latest edit in the vault plan). **Orange #FC734D** stands in for the reference's data green and marks things: #tags, ==highlights== and search hits. Everything else is ink, slate and hairline.

Nexus's signature visual in this style is its own vault drawn as schematic line-art: the graph view as ink nodes on hairline edges with blue and orange dots as the only colour, and the "No file is open" view's vault plan, one hairline bar per note grouped by folder, the latest edit marked by a blue dot.

The proprietary faces of the reference are not used. Hanken Grotesk takes their roles (display set at 32px/500 with -0.03em tracking; UI at 12-15px), Literata stays the reading face of the note, and JetBrains Mono appears only in real code. There are no uppercase mono category labels: a section opens with a two-column header instead (title left, description right).

**Key characteristics**
- White canvas sheet inset 8px on a blue-grey panel frame; dark mode is a navy canvas with the panel one tone step up.
- Hairlines carry the structure; nothing at rest casts a shadow. Only what floats (menus, dialogs, the palette, drawers, toasts) does.
- Radii are 8px (panels, cards, buttons, inputs, menus, dialogs, the sheet) and 2px (tags, chips, keycaps). The Tailwind radius scale is remapped in `globals.css` so no other value can appear.
- Display type is rationed to one place per surface: the inline note title, a dialog or empty-state title, a stat value.

## Colors

Tokens live in `src/app/globals.css` with both themes. Reference role names are aliases: `--canvas` (= `--sheet`), `--panel` (= `--frame`), `--ink` (= `--fg`), `--slate` (= `--muted`), `--hairline` (= `--border`). The older names keep working for the public pages.

| Role | Light | Dark | Use | Checked |
| --- | --- | --- | --- | --- |
| Canvas (sheet) | #ffffff | #02070a | where notes live | |
| Panel (frame) | #f2f4f7 | #0b131a | ribbon, sidebars, tab bar, code and callout fill | |
| Hover / active | #e8ecf1 / #e3e8ee | #131d26 / #18232e | row and button states, the neutral active pill | |
| Ink | #02070a | #e8eef2 | text | 18.4:1 on panel / 16.0:1 |
| Slate | #4d5562 | #a9b5c0 | secondary text | 6.1:1 on active / 7.6:1 |
| Fog | #5e6674 | #8a98a5 | tertiary text, meta, icons | 4.7:1 on active / 5.4:1 |
| Hairline | #d3d8e0 | #1f2b36 | sheet edge, dividers (decorative) | |
| Rule | #e6e9ee | #141e27 | row rules, one step quieter | |
| Mist | #b1b7c3 | #3d4d5c | schematic line-art: graph edges, vault plan baseline | |
| Control edge | #7a8290 | #5d6f80 | input and button edges, scrollbars | 3.5:1 on panel / 3.6:1 |
| Accent blue | #0297de | #0297de | fills and marks: primary button, active tab bar, caret, data points | |
| Accent ink | #01669a | #36aeeb | blue as text: links, active item, focus ring (light) | 5.1:1 on active / 6.4:1 |
| On accent | #02070a | #02070a | label on a blue fill | 6.3:1 |
| Mark orange / ink / wash | #fc734d / #b42a03 / #ffe8e0 | #fc734d / #ff8a66 / #312221 | tags, highlights, search hits | 5.5:1 ink on wash / 6.6:1 |

**The Rationed Accent Rule.** Blue moves you (links, active item, focus, primary action, data points). Orange marks things (#tags, ==highlights==, search hits). Neither is decoration; callouts, cards and chrome stay ink, slate and hairline.

**The Checked Pair Rule.** Every text pair is at least 4.5:1, every control edge and focus ring at least 3:1, in both themes. New colours are tokens in `globals.css` with their ratio, never raw hex in a component.

## Typography

- **Display title** (Hanken Grotesk 500, 32px / 38px, -0.03em; 26px / 32px on phones): the inline note title (the note's h1), the empty-state title.
- **Stat value** (Hanken Grotesk 400, 32px / 38px, -0.02em, tabular figures): the vault's numbers in the empty view, label above in 14px slate.
- **Note body** (Literata 400, 17px, 1.65) on a 672px measure; note headings stay in Literata 600.
- **UI lead** (15px / 24px): the right-hand description of a two-column header, action rows.
- **UI body** (14px / 20px): tree rows, menus, sidebars, settings.
- **Label** (12-13px): status bar, captions, metadata. Sentence case; never tracked-out capitals.
- **Code** (JetBrains Mono, 0.84em): fenced blocks, inline code, frontmatter. Nowhere else.

## Layout

Desktop: 44px ribbon (mark at the top, actions, then a hairline and the keyboard and settings group anchored to the bottom), 260px file explorer with the vault switcher anchored to its foot under a hairline, 40px tab bar, the sheet inset 8px with an 8px radius and a hairline edge, 280px right sidebar, status bar. Tab groups split side by side. Below 1024px the right sidebar is a drawer; below 768px the workspace is one sheet with a 48px top bar, drawers and a bottom bar, with 44px touch targets. Spacing is on a 4px grid.

**Two-column section header.** Where a surface opens with a title (the empty view, settings rows), the title sits on the left and its description on the right; on phones they stack.

## Elevation

Flat. Depth comes from tone (panel vs canvas) and 1px hairlines.

- **Float** (`0 12px 28px rgb(2 7 10 / 0.12)`; dark `0 16px 36px rgb(0 0 0 / 0.5)`): menus, the command palette, dialogs, toasts, phone drawers. Nothing else.
- **Scrim** (`rgb(2 7 10 / 0.4)`; dark `rgb(0 0 0 / 0.6)`): behind dialogs and drawers.

## Shapes

8px for every panel-like thing (sheet, cards, buttons, inputs, menus, dialogs, code blocks, callouts, canvas cards and groups), 2px for tags, property chips and keycaps, full circles only for dots and avatars. Borders are 1px hairlines; no coloured side borders thicker than 1px. The mark is the word Nexus set between double brackets, never a drawn logo or a blue square.

## Components

- **Primary button:** accent blue fill, navy label (6.3:1), 8px radius. One per surface.
- **Ghost button:** canvas ground, 1px control edge, ink label.
- **Icon button:** 32px (44px on touch), fog icon at 18px / 1.5 stroke, hover fills with the hover tone; tooltip with its shortcut.
- **Tree row:** 28px, slate label; hover tone on hover; the active note gets the active pill with an accent-ink label.
- **Action rows** (empty view): full-width 44px rows split by rules, a chevron, the label in ink turning accent-ink on hover, the shortcut as keycaps on the right.
- **Stat row:** one strip between two hairlines, cells split by 1px dividers, label over value.
- **Callout:** panel fill, hairline edge, 8px radius; the kind's colour is on the title only.
- **Tag chip:** mark ink on mark wash, 2px radius.
- **Graph view:** ink nodes, mist hairline edges, hollow nodes for notes not created yet, blue for the current or hovered node, orange for tag matches.
- **Toast:** navy ground (dark: the active tone), light text, accent link, Float shadow.

## Do's and Don'ts

**Do**
- Keep blue and orange rationed to their jobs and under a few per cent of any screen.
- Use hairlines and tone steps for structure; keep shadows for what floats.
- Use only the 8px and 2px radii.
- Set the display moment in Hanken Grotesk with tight tracking, once per surface.
- Honour `prefers-reduced-motion`; motion is feedback only.

**Don't**
- Don't use gradients, glows, glass, emoji, icons in tinted tiles or coloured side borders thicker than 1px.
- Don't load or name the reference's proprietary faces, copy its wordmark, blue logo block or world map.
- Don't use mono or uppercase tracked labels as decoration.
- Don't set small text in #0297de on white; use the accent ink.
