Classification: INTERNAL

# Landing, Round 2: what was built and why

Status: Round 2 production page at `/`. Base direction D chosen by the lead (owner delegated the choice), with G's visible markdown tokens grafted on. Not yet seen by the owner.

## Premise carried from Round 1

- From D: the note is the hero. A person's daily note is the largest text on the page, in ink. Everything Nexus says about itself is small Hanken Grotesk in `--muted`.
- From G: structure is typed. `[[ ]]`, `#`, `##`, `>`, `![[` stay visible in JetBrains Mono, in `--faint`, and a token that starts a line hangs left of the text edge by exactly its own width (cells are 0.6em, so `margin-left: -(n × 0.6em + gap)`). The words keep one edge.
- One gutter (`--gutter`) runs down the whole page: the hero sheet's text edge, every section, and the footer share it, so the hung tokens in "What it does" fall in the same column as the ones in the hero.

## Decisions that differ from Round 1

| Round 1 | Round 2 | Why |
|---|---|---|
| D on an orange canvas, orange-shaded chrome | App frame (`--frame`) with one white sheet (navy `#0a1219` in dark) | Owner rule: orange marks tags and highlights only. The sheet is where notes live in the app, so the note sits on a sheet and product chrome sits on the frame. |
| Vollkorn for the note | Literata (the app's note face), opsz auto, weight 500 | The note on the landing page is set in the same face the person will write in. Vollkorn was not clearly better; no new family to load. |
| D: links in the note left uncoloured | Link targets in `--accent-ink`, tag in `--mark-ink` | That is how the editor shows them; blue = link, orange = tag. |
| D: action not a coloured control | "Open your vault" is the blue filled button | Owner rule: blue is the primary action. |
| "Wednesday, 13 November" | "Friday, 13 November" | 13 November 2026 is a Friday. |
| Note sized in vw only | `clamp(2.25rem, 1.15rem + 5vw, 6rem)` | Has a rem term, so it grows with browser zoom (WCAG 1.4.4); max 6rem. |

## Sections (product truth only)

1. Hero: file path `Daily notes/2026-11-13.md`, the note, h1 "Notes that link to each other, in plain markdown.", one line of promise, "Open your vault" (→ `/login`, or `/vault` when a session exists) and "Self-host" (→ `#self-host`).
2. What it does: links and backlinks, graph, search operators, live preview, callouts/embeds/math/Mermaid (reading view), phone/PWA (no offline mode yet, said plainly), history (kept by the server; the browse/restore panel is not built yet, said plainly).
3. Your files stay yours: plain .md, export .zip that opens in Obsidian, import from Obsidian (attachments and .obsidian settings skipped, as Settings says today).
4. Self-host: the deploy commands from README, comments in English; sign-up closed by default and `NEXUS_ALLOW_SIGNUP`; loopback port behind an HTTPS proxy. Copy button with a polite live region.
5. Working together: marked "Planned"; one account per vault today.
6. Footer.

No stats, testimonials, logos or prices.

## Texture

One texture, once: paper grain behind the hero note (light), sparse graphite speckle (dark). Two 160 px tiling PNGs generated with a seeded noise script (`public/landing/grain-paper.png`, `grain-graphite.png`, about 15 KB each), not SVG and not feTurbulence. Alpha stays under 10% so text contrast on the sheet is unchanged in practice. Removed under `prefers-reduced-transparency: reduce`, `prefers-contrast: more` and forced colours.

## Motion

One moment: the hero's typed tokens settle into the gutter (opacity and a 0.35em slide, 520 ms, ease-out quint, staggered 70 ms) after the words are already on screen. Visible by default; runs only under `prefers-reduced-motion: no-preference`.

## Implementation

- `src/app/page.tsx`: `generateMetadata` (title, description, canonical, robots index/follow, Open Graph, Twitter card). `metadataBase` is the origin of `BETTER_AUTH_URL` (then `NEXT_PUBLIC_APP_URL`), read at request time after `connection()`, because a Docker image is built without `.env` and a build-time value would bake in `http://localhost:3000`. The Host header is not used. A `<Suspense>` marker that awaits `connection()` declares the request-time metadata; the page body stays in the prerendered shell (`◐ /`).
- `src/app/opengraph-image.tsx`: next/og card of the hero. Fonts in `src/app/fonts/`: Literata (opsz 72, wght 500) and JetBrains Mono (wght 400) instanced from the google/fonts OFL variable files and subset to Latin; OFL texts alongside. No Reserved Font Names.
- `src/components/landing/`: `landing.tsx` (sections), `vault-link.tsx` (async server link in `<Suspense>`; the prerendered fallback is `/login`; no session cookie means no auth lookup), `copy-button.tsx`, `landing.css`.
- Styles are a plain prefixed stylesheet (`lp-*`), not a CSS module: the turbopack rule for `*.css` in `next.config.ts` runs CSS modules through the Tailwind loader as plain CSS, so module class names come out `undefined`. If that rule is narrowed to non-module CSS, the file can become a module.

## Verification (2026-11-14, dev server)

- Headless Chrome screenshots at 1440×900 and 390×844, light and dark: no horizontal scroll (scrollWidth = clientWidth in all four).
- accesslint 0.21 (94 rules): 0 violations at 1440 dark, 390 light, 390 dark, and 780 light.
- Keyboard: Tab order wordmark → Self-host → Open your vault → hero button → Self-host → Copy → code block (scrollable, focusable) → footer links; every stop shows the `--focus` ring; targets 44 px tall (copy 36 px).
- Signed out: every "Open your vault" → `/login`. Signed in: → `/vault`.

## Verification, round-2 fixes (2026-11-14)

- Reflow at 320 CSS px (WCAG 1.4.10): the hero link targets use normal spaces (they wrap), and under 22.5rem the note size is 1.875rem so "13 November —" fits. Text ranges of the hero checked against the sheet's inner edge at 320, 340, 360, 361, 365, 375, 390, 720 and 1440, light and dark: none past it; scrollWidth = clientWidth. Only the code block scrolls, inside its own focusable `pre`.
- Production build with `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` unset, then the standalone server run with `BETTER_AUTH_URL=https://notes.example.com`: canonical, og:url, og:image and twitter:image all use that origin; a forged Host header does not change them; `/opengraph-image` returns 200 image/png.

## Open for the owner

- The h1 is small by premise (D's risk: the page may under-explain). Judge on screen.
- Hung tokens are approximate on fallback fonts (before Literata/JetBrains load): `display: swap` may shift them briefly.
