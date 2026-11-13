> Classification: INTERNAL

# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Anyone who thinks in notes and wants them connected. The owner confirmed four groups, with no single primary one:

- Knowledge workers: meeting notes, research and work ideas captured daily, moving between laptop and phone.
- Students and researchers: lectures, theses, literature notes linked to each other.
- Developers and engineers: technical documentation, code snippets, project notes in markdown.
- Writers and creators: drafts, content ideas, worldbuilding.

Today the product has one user (the owner, for personal notes). Selling it to many users is the stated next step if it proves good.

## Product Purpose

Nexus is an Obsidian-style knowledge base that runs in the browser: markdown notes connected by `[[wikilinks]]`, with backlinks, tags, search, a graph view and daily notes. Success means a person can open their vault from any device, write and link notes without friction, and leave at any time with their files intact.

## Positioning

The owner confirmed four reasons to choose Nexus over desktop Obsidian:

1. It runs in the browser. Open the vault from any phone or laptop without installing anything and without paying for a sync service.
2. The files stay yours. Notes are plain markdown, the whole vault exports to a `.zip` that opens in Obsidian, and an Obsidian vault can be imported.
3. It can be self-hosted. One Docker Compose file runs it on your own server, so the data never leaves your control.
4. Team collaboration (planned, not built). Shared vaults and writing together.

## Operating Context

- Used on desktop browsers for long writing sessions and on phones for quick capture and lookup.
- People arrive with existing Obsidian vaults and expect Obsidian's conventions: ribbon, file explorer, tabs, backlinks, graph, command palette, hotkeys.
- Deployed with Docker Compose (Postgres + Next.js) on any VPS; moving servers means exporting the vault or dumping the database.

## Capabilities and Constraints

Built: email and password accounts; one vault per user (schema supports many vaults and many users); notes and folders with drag and drop; markdown editor (CodeMirror 6) with `[[` and `#` autocomplete and autosave; reading view; rename that rewrites every link to the note; backlinks, outgoing links and outline; full-text search; tags including nested tags and frontmatter tags; graph view; daily notes; clickable task checkboxes; Obsidian vault import (.zip or .md) and export (.zip); light and dark themes.

Not built yet: Live Preview editing, attachments and embeds (`![[note]]` renders as a link), callouts, Mermaid, math, templates, bookmarks, version history, canvas, publishing, real-time collaboration, email verification and password reset, billing.

Interface language: English (app and landing page).

Undecided: pricing, plans and licensing for a paid offer.

## Brand Commitments

- Name: Nexus.
- Primary palette, set by the owner: #02070A (very dark blue-black), #0297DE (bright blue), #FC734D (red-orange).
- The app workspace should look and behave more like Obsidian; the owner supplied an Obsidian screenshot (ribbon, file explorer, tab bar, view header with back and forward, inline title, graph view in a split pane) as the reference.
- The landing page may use textured backgrounds; the owner listed examples: felt texture, fluted glass, thermal gradients, water ripples, speckled graphite, single-hue landscapes, blueprint grids, halftone, grainy gradients, grass texture, dithered images, paper texture, contour lines, cloud sky, pixel mosaics, lens distortion, stippled gradients, square-dot grids, blurred photos, iridescent shapes, impressionist paintings, ASCII and pixels.

## Evidence on Hand

- The working product itself (screens can be shown as real interface).
- No logo or brand mark exists; the name is the only identity asset.
- No customers, testimonials, reviews, press, usage numbers, benchmarks or prices exist. None may be invented.

## Product Principles

1. Plain files first: nothing the product does may trap a note in a format the user cannot take away.
2. Familiar where it matters: an Obsidian user should find their way without being taught.
3. Every device is a first-class device: the phone is not a degraded desktop.
4. The note is the hero: chrome stays quiet so writing and reading stay in front.
5. Honest about what exists: planned features are labelled as planned.

## Accessibility & Inclusion

Target WCAG 2.2 Level AA across the app and the landing page; the owner asked for the full accessibility skill set (audit, scan, inspect, diff, fix) to be applied.
