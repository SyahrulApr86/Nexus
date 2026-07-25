# Nexus — Requirement Traceability

Rule: a requirement is checked ONLY when its tests pass (unit/integration +
e2e where applicable), the flow is keyboard-operable, and axe WCAG 2.1 AA
passes on the touched UI.

**Suite status**: 30 shared · 85 server (91.5% line / 85% branch) · 59 e2e — all green.

## Phase 0 — Foundation ✅

- [x] Monorepo (pnpm + turbo): `apps/web`, `apps/server`, `packages/shared`, `e2e`
- [x] docker-compose: PostgreSQL 16 (:5433), Redis (:6380), Mailpit (:8025/:1025)
- [x] Prisma schema — every entity in PRD §7
- [x] Test harness: Vitest (`nexus_test` DB + Redis db1), Playwright + axe-core
- [x] CI: lint → typecheck → unit/integration w/ coverage gates → e2e + axe
- [x] Design tokens light + derived dark (accent darkened to `#0b5cd6` for AA;
      Electric Blue retained as the focus ring)

## Phase 1 — MVP ✅

### US1 — Registration & Login
- [x] FR-001 register + password policy, per-rule feedback — `schemas.test.ts`, `auth.test.ts`, `auth.spec.ts`
- [x] FR-002 login, generic error (anti-enumeration)
- [x] FR-002b lockout: 5 failures / 15 min
- [x] FR-003 logout + rolling idle timeout (5–120 min), `SESSION_EXPIRED`
- [x] E2E independent test + keyboard-only flow + axe

### US1b — Password Reset
- [x] FR-002a 60-min single-use token, identical acknowledgement, policy on new
      password, clears active lockout — `password-reset.test.ts`
- [x] E2E independent test via Mailpit + axe

### US2 — Notes: editor, preview, autosave
- [x] FR-004 note CRUD, vault-scoped — `notes.test.ts`
- [x] FR-026 content encrypted at rest (pgcrypto); plaintext absent from column
- [x] FR-005 live split-pane preview
- [x] FR-006 autosave debounced 1000ms; serialized flushes; conflict → 409 with
      notification, never a silent overwrite (US2-S5)
- [x] E2E independent test + keyboard + axe

## Phase 2 — Core Value ✅

### US3 — Folders
- [x] FR-007 CRUD + cascade soft-delete + cycle guard — `folders.test.ts`
- [x] FR-007a drag-reorder persisted, plus Alt+Arrow keyboard equivalent
- [x] FR-007b per-folder sort toggles
- [x] FR-008 sidebar tree with note counts
- [x] E2E independent test + keyboard + axe

### US4 — Wikilinks
- [x] FR-009 parse `[[…]]`, code-block/inline-code exclusion — `markdown.test.ts`
- [x] FR-010 autocomplete on `[[`, suppressed inside code — `wikilinks.test.ts`
- [x] FR-011 clickable links in preview
- [x] FR-012 broken-link styling + create-on-click; links re-resolve on
      create/rename/trash/restore
- [x] E2E independent test + axe

### US5 — Search
- [x] FR-013 fuzzy title (pg_trgm) + tsvector content, title ranked first
- [x] FR-014 debounced real-time results, unicode + regex-safe, short-query signal
- [x] E2E independent test + keyboard + axe

### US12 — Trash & Versions
- [x] FR-028 trash view (roots only) — `trash.test.ts`
- [x] FR-029 versions preserved, capped at 100 (oldest pruned)
- [x] FR-030 restore with history; root fallback + notification when the
      original folder was purged (US12-S7)
- [x] FR-031 permanent delete with confirmation
- [x] FR-032 read-only preview of any prior version
- [x] E2E independent test + keyboard + axe

## Phase 3 — Differentiation ✅

- [x] **US8** FR-020 Ctrl/Cmd+P palette: fuzzy commands, note jumps, arrow keys,
      clean Escape — `palette-theme.spec.ts`
- [x] **US9** FR-021/022 light + dark themes, OS default, palette toggle,
      server-persisted across sessions
- [x] **US7** FR-017 styled `#tags` in preview · FR-018 sidebar aggregation with
      counts · FR-019 tag filter view — `tags.test.ts`, `tags.spec.ts`
- [x] **US6** FR-015/016 canvas force-directed graph, pan/zoom, viewport culling,
      isolated nodes, accessible node list — `graph.test.ts`, `graph.spec.ts`
- [x] **US10** per-vault WebSocket rooms (server picks the room from the session
      cookie), live invalidation, offline indicator, reconnect flush — `sync.spec.ts`
- [x] **US11** FR-024 ZIP export preserving hierarchy, dedupe on collision
- [x] **US13** FR-033/034/035/036 single, bulk, and ZIP import; structure
      recreated; non-Markdown skipped; wikilinks/tags functional post-import

## Phase 4 — Hardening ✅

- [x] SC-010 axe WCAG 2.1 AA on every route, light **and** dark — `a11y-sweep.spec.ts`
- [x] FR-025 isolation verified per endpoint: reads, mutations, unauthenticated
      access, forged cookie — `isolation.test.ts`
- [x] Auth endpoints IP rate-limited (`RATE_LIMIT_SCALE=1` in production) — `rate-limit.test.ts`
- [x] FR-027 TLS deployment documented (README security notes)
- [x] Coverage gates enforced in vitest config + CI (≥80% line / ≥70% branch)
- [x] Full regression: all 13 user-story independent tests pass

### Measured success criteria

| ID | Target | Measured |
|----|--------|----------|
| SC-001 | first-use flow < 2 min | ~1 s (`sc-benchmarks.spec.ts`) |
| SC-001a | reset flow < 3 min | ~2 s |
| SC-002 | preview latency < 100 ms | 3–10 ms |
| SC-003 | search 5,000 notes < 1 s | 27–50 ms |
| SC-004 | graph 1,000 notes > 30 fps | sustained > 30 fps (`perf.spec.ts`) |
| SC-005 | 10,000-note sidebar < 500 ms | render < 500 ms, DOM bounded < 300 rows |
| SC-006 | all core actions keyboard-only | covered per story |
| SC-007 | cross-device availability < 5 s | 64 ms |
| SC-008 | export 500 notes < 10 s | 131 ms |
| SC-010 | WCAG 2.1 AA on every route | passing, both themes |
| SC-011 | restore with history < 3 s | 6 ms |
| SC-012 | import 100 files / 10 folders < 15 s | 826 ms |

SC-009 (user-rated editing experience) is a post-launch survey metric, not a
CI-verifiable gate — per PRD §6.

## Design decisions worth knowing

- **Search vs. encryption**: decrypt-in-SQL scanning measured 2.7 s at 5k notes,
  over the SC-003 budget. Content search now uses a derived `tsvector` column
  written at save time. Documented tradeoff: the index leaks content
  *vocabulary*; the content column itself stays pgp-encrypted (FR-026).
- **Tags**: extracted at write time into an indexed `text[]`, so aggregation
  never decrypts.
- **Dark theme**: derived from the DESIGN.md palette (midnight surfaces, light
  ink, blue accent), contrast-verified in both directions by the axe sweep.
