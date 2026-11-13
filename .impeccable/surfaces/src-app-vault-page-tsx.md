---
version: 1
slug: "src-app-vault-page-tsx"
primary_target: "src/app/vault/page.tsx"
related_targets: ["src/components/workspace/workspace.tsx","src/app/login/page.tsx","src/app/signup/page.tsx"]
---

# Surface brief: vault workspace (app)

Scope: the authenticated workspace at /vault (ribbon, sidebars, tab groups, editor, reading view, graph tab, palettes, dialogs) plus /login and /signup. Visitor mode: Operate.

Audience and job: knowledge workers, students and researchers, developers, writers. Long writing and linking sessions on a laptop; quick capture and lookup on a phone. Most frequent job: open a note and write; second: follow or create a [[link]].

Constraints: interface copy in English; WCAG 2.2 AA; Obsidian conventions the owner pinned (ribbon, file explorer, tab bar with new tab, view header with back and forward, inline title, right sidebar for backlinks and outline, status bar, graph view as a tab in a split). Palette pinned: #02070A, #0297DE, #FC734D. Owner approved: blue for links, active item and focus; orange for tags, highlights and search marks; theme follows the system (light: a white that suits the blue and orange; dark: navy); Literata for note text, Hanken Grotesk for the interface, JetBrains Mono for code.

## Direction contract

THESIS: the note is the sheet. A notebook's working surface sits inside a quiet blue-grey frame that Obsidian users already know; the interface refuses the generated-dashboard look (coloured nav pills, tinted icon tiles, gradient chrome) and the old purple accent.

OWN-WORLD: tinted L-frame from the navy hue (ribbon, sidebars, tab bar), white sheet in light and #02070A-based navy in dark, 1px hairlines, no shadows at rest. Blue moves you (links, active, focus, primary action); orange marks things (#tags, ==highlights==, search hits). The mark is two double brackets set in type, never a drawn logo.

STORY: an Obsidian user lands in a familiar workspace, finds the vault by name, opens a note, types [[ and sees connections gather as backlinks; on a phone the same vault opens as one sheet with drawers.

FIRST VIEWPORT: 44px ribbon on the left edge (mark at top, actions, settings at bottom); 260px file explorer with vault name and a toolbar (new note, new folder, sort, collapse); tab bar 40px with tabs and a new-tab button; the active note as a white sheet inset 8px with 16px corners: view header (back, forward, breadcrumb, reading toggle, more), inline title as the h1 at 28px, Literata body at 17px on a 700px measure; right sidebar 280px with backlinks, outgoing links, outline and tags; status bar with backlinks, words, characters and save state.

FORM: framed-sheet app style dealt by design-taste (seed 678493631, kind builder) under a pinned look. seed: none (pinned) "style halamannya bisa lebih mirip obsidian" plus "pallete warna utamanya adalah ini: #02070A, #0297DE, #FC734D".

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

Unresolved: Live Preview editing, attachments and embeds are product work outside this surface.
