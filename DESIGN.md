---
name: Nexus
description: Connected markdown notes in the browser; an Obsidian-style workspace where the note is the sheet.
colors:
  ink-navy: "#02070a"
  link-blue: "#0297de"
  link-blue-ink: "#01669a"
  link-blue-wash: "#e1f3fb"
  tag-orange: "#fc734d"
  tag-orange-ink: "#b42a03"
  tag-orange-wash: "#ffe8e0"
  highlight-peach: "#ffd9cc"
  frame-mist: "#f1f4f7"
  sheet-white: "#ffffff"
  hover-mist: "#e9eef2"
  active-mist: "#e4eaef"
  border-hairline: "#dce3e9"
  rule-hairline: "#ebeff3"
  control-slate: "#7d8c99"
  text-muted: "#36424c"
  text-faint: "#566470"
  code-mist: "#eef2f5"
  negative-red: "#c4242a"
  positive-green: "#247b50"
  dark-sheet: "#0a1219"
  dark-hover: "#111c25"
  dark-active: "#16232e"
  dark-border: "#1a2731"
  dark-text: "#e6edf2"
  dark-link-ink: "#36aeeb"
  dark-tag-ink: "#ff8a66"
typography:
  note-title:
    fontFamily: "Literata, ui-serif, Georgia, serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: "36px"
    letterSpacing: "-0.01em"
  note-body:
    fontFamily: "Literata, ui-serif, Georgia, serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.65
  ui-body:
    fontFamily: "Hanken Grotesk, ui-sans-serif, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  ui-label:
    fontFamily: "Hanken Grotesk, ui-sans-serif, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "16px"
  dialog-title:
    fontFamily: "Hanken Grotesk, ui-sans-serif, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: "28px"
  code:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  hairline: "2px"
  chip: "4px"
  control: "6px"
  block: "8px"
  card: "12px"
  sheet: "14px"
spacing:
  ribbon: "44px"
  tab-bar: "40px"
  row: "28px"
  sheet-inset: "8px"
  left-sidebar: "260px"
  right-sidebar: "280px"
  measure: "700px"
components:
  button-primary:
    backgroundColor: "{colors.link-blue}"
    textColor: "{colors.ink-navy}"
    rounded: "{rounded.block}"
    height: "44px"
    padding: "0 16px"
  button-danger:
    backgroundColor: "{colors.negative-red}"
    textColor: "{colors.sheet-white}"
    rounded: "{rounded.block}"
    height: "40px"
    padding: "0 16px"
  icon-button:
    textColor: "{colors.text-faint}"
    rounded: "{rounded.control}"
    size: "28px"
  input-field:
    backgroundColor: "{colors.sheet-white}"
    textColor: "{colors.ink-navy}"
    rounded: "{rounded.block}"
    height: "44px"
    padding: "0 12px"
  tree-row:
    textColor: "{colors.text-muted}"
    rounded: "{rounded.control}"
    height: "{spacing.row}"
  tree-row-active:
    backgroundColor: "{colors.active-mist}"
    textColor: "{colors.ink-navy}"
  tag-chip:
    backgroundColor: "{colors.tag-orange-wash}"
    textColor: "{colors.tag-orange-ink}"
    rounded: "{rounded.chip}"
  note-sheet:
    backgroundColor: "{colors.sheet-white}"
    textColor: "{colors.ink-navy}"
    rounded: "{rounded.sheet}"
  toast:
    backgroundColor: "{colors.ink-navy}"
    textColor: "{colors.sheet-white}"
    rounded: "{rounded.block}"
---

# Design System: Nexus

> Classification: INTERNAL

## Overview

**Creative North Star: "The Note Is the Sheet"**

Nexus is a working notebook, not a dashboard. Every screen is built around one white sheet (navy in dark mode) where a note is read and written, set inside a quiet blue-grey frame that Obsidian users already know: ribbon, file explorer, tab bar and right sidebar on the frame, the note on the sheet. The frame is tinted from the navy's own hue and stays low in chroma, so it recedes. The sheet is where the contrast, the serif and the colour live.

Density is that of a desktop tool: 28px tree rows, 14px interface text, hairline borders, no shadows at rest. Brand shows only in precise details: the double-bracket mark set in type, blue that always means "this moves you" and orange that always means "this is marked". The interface refuses the look of a generated dashboard: no coloured nav pills, tinted icon tiles, gradient chrome, glows, glass or the old purple accent.

On a phone the same vault becomes one sheet with drawers. Phones are first-class devices, not degraded desktops: touch targets grow and safe areas are respected, but the hierarchy stays the same.

**Key Characteristics:**
- An L-shaped tinted frame around an inset white sheet with 14px corners.
- Two colour meanings and nothing else: blue moves, orange marks.
- Serif for the person's writing, grotesque for the interface, mono for code.
- Flat at rest; a shadow appears only on things that float (menus, dialogs, toasts).
- Light and dark follow the system; dark is navy, never grey-black.

## Colors

A navy-anchored neutral ramp with exactly two accents, each with a single job.

### Primary
- **Link Blue** (#0297de): fills and non-text marks — the primary button, the active tab underline, the caret, the graph's active node. Never used as small text on white (it fails contrast there).
- **Link Blue Ink** (#01669a; dark #36aeeb): blue as text — wikilinks, links, the active item label, the focus ring in light mode.
- **Link Blue Wash** (#e1f3fb): the faint ground under a selected or matched link row.

### Secondary
- **Tag Orange** (#fc734d): marks, never actions — tag dots, search-hit underlines, the highlight family.
- **Tag Orange Ink** (#b42a03; dark #ff8a66): #tags as text.
- **Highlight Peach** (#ffd9cc; dark #57312a): ==highlight== and search-match backgrounds.

### Neutral
- **Ink Navy** (#02070a): body text in light mode, the whole frame in dark mode, toast ground, the primary button's label.
- **Frame Mist** (#f1f4f7): ribbon, sidebars, tab bar in light mode.
- **Sheet White** (#ffffff; dark #0a1219): where notes live.
- **Hover / Active Mist** (#e9eef2 / #e4eaef; dark #111c25 / #16232e): row and button states on the frame.
- **Border Hairline** (#dce3e9; dark #1a2731): the sheet edge and card edges (decorative, 1.3:1).
- **Rule Hairline** (#ebeff3): dividers inside a surface.
- **Control Slate** (#7d8c99; dark #5d7182): input and button edges, scrollbars in use (≥ 3:1).
- **Text Muted** (#36424c) and **Text Faint** (#566470): secondary and tertiary text, each ≥ 4.5:1 on both frame and sheet.
- **Negative Red** (#c4242a) and **Positive Green** (#247b50): destructive actions and errors; success states.

### Named Rules
**The Two Meanings Rule.** Blue moves you (links, active item, focus, primary action). Orange marks things (#tags, ==highlights==, search hits). Neither colour is ever used for decoration, and they never swap jobs.

**The Checked Pair Rule.** Every text/ground pair is ≥ 4.5:1 and every control edge and focus ring is ≥ 3:1, in both themes. New tokens are added to `src/app/globals.css` with their ratio, never as raw hex in a component.

## Typography

**Note Font:** Literata (with ui-serif, Georgia)
**Interface Font:** Hanken Grotesk (with ui-sans-serif)
**Code Font:** JetBrains Mono (with ui-monospace)

**Character:** A warm text serif with a long reading measure carries the person's own writing; a plain, slightly humanist grotesque runs the tool around it and stays out of the way. Mono appears only for code, never for labels or data.

### Hierarchy
- **Note title** (600, 28px / 36px, -0.01em; 24px / 32px on phones): the inline title at the top of the sheet; it is the note's h1.
- **Note headings** (600, 1.6em / 1.35em / 1.15em, 1.25): h1–h3 inside a note; h4–h6 step down to 1em.
- **Note body** (400, 17px, 1.65): reading and Live Preview text on a 700px measure (about 70 characters).
- **Dialog title** (600, 22px, 28px): auth card and modal headings.
- **Interface body** (400, 14px, 20px): menus, tree rows, settings, sidebars.
- **Label** (500, 12px, 16px): status bar, section captions, metadata. Sentence case, never tracked-out capitals.
- **Code** (400, 13px, 1.6): fenced blocks; inline code at 0.88em of its context.

### Named Rules
**The Writing Wears Serif Rule.** Only text the person wrote is set in Literata. Anything the product says is Hanken Grotesk.

## Layout

Desktop is an Obsidian-style frame: a 44px ribbon on the left edge, a 260px file explorer, a 40px tab bar over each tab group, the active note as a sheet inset 8px from the frame, a 280px right sidebar (backlinks, outgoing links, outline, tags, bookmarks) and a status bar along the bottom. Tab groups split side by side. Sidebars are resizable and collapsible; the right sidebar hides below 1024px.

Below 768px the layout becomes one sheet: a 48px top bar, the left and right sidebars as drawers, a bottom bar, and "open to the right" turns into "open in a new tab". Safe-area insets pad every edge. On coarse pointers touch targets grow to at least 44px.

Spacing follows a 4px grid. Tree rows are 28px; sheet content has 40px side padding on desktop and 20px on phones; the note column is centred at 700px.

## Elevation & Depth

Flat by default: depth comes from tone (frame vs sheet) and 1px hairlines, not shadows. A shadow appears only on surfaces that float above the workspace.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 12px 32px rgb(2 7 10 / 0.14), 0 2px 6px rgb(2 7 10 / 0.08)`; dark `0 16px 40px rgb(0 0 0 / 0.55), 0 2px 8px rgb(0 0 0 / 0.4)`): menus, the command palette, dialogs, toasts, the drag ghost.
- **Scrim** (`rgb(2 7 10 / 0.45)`; dark `rgb(0 0 0 / 0.6)`): behind modal dialogs and phone drawers.

### Named Rules
**The Flat Sheet Rule.** Nothing that sits in the layout casts a shadow. Only things that float above it do.

## Shapes

Gently rounded, by size: 2px for inline marks, 4px for chips and inline code, 6px for icon buttons, rows and focus rings, 8px for buttons, inputs, code blocks and callouts, 10–12px for menus and cards, 14px for the note sheet. Borders are 1px hairlines; no coloured side borders thicker than 1px. The brand mark is two double brackets set in type around the word Nexus, never a drawn logo.

## Components

### Buttons
- **Shape:** rounded (8px).
- **Primary:** Link Blue fill with an Ink Navy label, 44px tall in forms. Hover dims slightly (brightness 95%); a busy primary keeps its width and shows the in-progress label ("Signing in…").
- **Danger:** Negative Red fill with a white label, used only for confirmations of destructive actions.
- **Icon button:** 28px square, Text Faint icon at 16px with a 1.5 stroke (Lucide), Hover Mist ground on hover, an accessible label and a tooltip with its shortcut.

### Tree rows (file explorer)
- 28px tall, 6px corners, Text Muted label. Hover shows Hover Mist; the active note gets Active Mist and Ink Navy text. It is an APG tree: arrow keys move, Enter opens, F2 renames, and it supports drag and drop between folders.

### Inputs / Fields
- **Style:** Sheet ground, 1px Control Slate edge, 8px corners, 16px text on phones (prevents zoom) and 14px on desktop.
- **Focus:** 2px focus ring offset 2px (Link Blue Ink in light, Link Blue in dark).
- **Error:** Negative Red edge plus a message below the field, linked with aria-describedby; focus moves to the first field with an error.

### Tags and highlights
- **Tag chip:** Tag Orange Ink text on Tag Orange Wash, 4px corners, set in the note's font size.
- **Highlight:** Highlight Peach behind the text, 2px corners. Search hits use the same treatment.

### Navigation
- **Ribbon:** a column of icon buttons on Frame Mist; the mark at the top, settings and help at the bottom.
- **Tabs:** 40px bar on the frame; the active tab joins the sheet (sheet ground, no bottom border); there are close and new-tab buttons. Alt+T / Alt+W / Alt+[ ] handle tabs.
- **Phone:** top bar with drawers and a bottom bar for search, new note and the quick switcher.

### Note sheet (signature)
- Sheet ground, 14px corners, 1px Border Hairline, inset 8px from the frame. The view header holds back, forward, a breadcrumb, the reading/editing toggle and a more menu. Then the inline title, then the note on a 700px measure. In dark mode the sheet is #0a1219 on an #02070a frame.

### Toasts
- Ink Navy ground (dark: Active Mist), white text, a Link Blue action label kept on one line, a dismiss button, the Float shadow. Error toasts persist; the others time out but pause on hover and focus.

## Do's and Don'ts

### Do:
- **Do** use blue only for movement (links, active item, focus, primary action) and orange only for marks (tags, highlights, search hits).
- **Do** add every new colour as a token in `src/app/globals.css`, for both themes, with its contrast ratio checked (≥ 4.5:1 text, ≥ 3:1 edges and rings).
- **Do** keep the note on the sheet: Literata at 17px on a 700px measure, with the inline title as the h1.
- **Do** follow Obsidian's conventions (ribbon, explorer, tabs, backlinks, command palette, hotkeys) when a choice is open; users arrive with Obsidian habits.
- **Do** use motion only as feedback (view transitions on note change, 150–200ms quint ease) and honour `prefers-reduced-motion`.
- **Do** write interface copy in English, sentence case, naming the action ("Create vault", "Replace notes").

### Don't:
- **Don't** use gradients, glows, glass or coloured nav pills, or put icons in tinted tiles.
- **Don't** add shadows to anything that sits in the layout; only floating surfaces get the Float shadow.
- **Don't** use tracked-out capital labels or a monospace face for non-code labels.
- **Don't** put coloured side borders thicker than 1px on callouts, cards or rows.
- **Don't** use emoji in interface copy, or bring back the old purple accent.
- **Don't** set small text in Link Blue (#0297de) on white; use Link Blue Ink.
