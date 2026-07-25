# Nexus — Progress Tracking

Rule: a requirement is checked ONLY when its tests (unit/integration + e2e where
applicable) pass, keyboard path works, and axe WCAG 2.1 AA passes on touched UI.

## Phase 0 — Foundation ✅

- [x] Monorepo scaffold (pnpm + turbo: apps/server, apps/web, packages/shared, e2e)
- [x] docker-compose: Postgres 16 (:5433) + Redis (:6380) + Mailpit (:8025/:1025)
- [x] Prisma schema — all entities per PRD §7 (User, Vault, Folder, Note, NoteVersion, WikilinkRef, PasswordResetToken)
- [x] Test harness: Vitest (server: nexus_test DB + Redis db1; shared), Playwright + axe-core
- [x] CI: lint + typecheck + unit/integration + e2e (.github/workflows/ci.yml)
- [x] Design tokens light + derived dark (DESIGN.md; accent darkened #0b5cd6 for WCAG AA — original Electric Blue kept for focus ring)
- [x] App shell: auth pages + workspace sidebar/main layout

## Phase 1 — MVP

### US1 — Registration & Login ✅
- [x] FR-001 register + password policy w/ per-rule feedback (unit: schemas.test.ts; integration: auth.test.ts; e2e)
- [x] FR-002 login; generic error anti-enumeration (integration + e2e)
- [x] FR-002b lockout 5 fails/15min (integration)
- [x] FR-003 logout + rolling idle timeout 5–120min, SESSION_EXPIRED code (integration)
- [x] E2E independent test US1 + keyboard-only flow + axe (login, register)

### US1b — Password Reset ✅
- [x] FR-002a 60-min single-use token, identical acknowledgement, policy on new pw, clears lockout (integration: password-reset.test.ts)
- [x] E2E independent test US1b (Mailpit) + axe (forgot-password)

### US2 — Notes: editor + preview + autosave
- [ ] FR-004 note CRUD API (vault-scoped, FR-025 isolation test)
- [ ] FR-026 content encrypted at rest (pgcrypto)
- [ ] FR-005 live split-pane preview (SC-002 <100ms)
- [ ] FR-006 autosave debounce 1000ms; conflict notification (US2-S5)
- [ ] E2E independent test US2 + keyboard + axe

## Phase 2 — Core Value

### US3 — Folders
- [ ] FR-007 folder CRUD + cascade soft-delete
- [ ] FR-007a drag-reorder persisted (+ keyboard alternative)
- [ ] FR-007b sort toggles
- [ ] FR-008 sidebar tree
- [ ] E2E + keyboard + axe

### US4 — Wikilinks
- [x] FR-009 parse [[..]] incl. code-block exclusion (shared/markdown.test.ts)
- [ ] FR-010 autocomplete on [[
- [ ] FR-011 clickable valid links in preview
- [ ] FR-012 broken-link styling + create-on-click
- [ ] E2E + keyboard + axe

### US5 — Search
- [ ] FR-013 fuzzy full-text, title>content ranking (SC-003 5k notes <1s benchmark)
- [ ] FR-014 real-time results
- [ ] E2E + keyboard + axe

### US12 — Trash & Versions
- [ ] FR-028 trash view
- [ ] FR-029 versions preserved on trash (cap 100)
- [ ] FR-030 restore w/ history (+ root fallback + notification)
- [ ] FR-031 permanent delete w/ confirmation
- [ ] FR-032 read-only version preview
- [ ] E2E + keyboard + axe

## Phase 3 — Differentiation

### US8 — Command Palette
- [ ] FR-020 Ctrl/Cmd+P palette, fuzzy, keyboard nav
### US9 — Theming
- [x] FR-021 dark + light themes (tokens; toggle UI pending)
- [x] FR-022 persist theme (server preference; integration test)
- [ ] Toggle via settings/palette + e2e both themes + axe
### US7 — Tags
- [x] FR-017 #tag parsing (shared tests)
- [ ] FR-017 styled render in preview
- [ ] FR-018 tag list w/ counts
- [ ] FR-019 filter by tag
### US6 — Graph
- [ ] FR-015 nodes/edges graph
- [ ] FR-016 pan/zoom (SC-004 1k notes >30fps)
### US10 — Sync
- [ ] WS per-vault rooms, live updates (SC-007 <5s), offline indicator
### US11 — Export
- [ ] FR-024 ZIP export w/ hierarchy (SC-008 500 notes <10s)
### US13 — Import
- [ ] FR-033 single .md
- [ ] FR-034 bulk
- [ ] FR-035 ZIP w/ structure (SC-012)
- [ ] FR-036 wikilinks/tags functional post-import

## Phase 4 — Hardening
- [ ] axe on every route, both themes (SC-010)
- [ ] All SC benchmarks measured (SC-002/003/004/005/007/008/011/012)
- [ ] FR-025 isolation verified per endpoint (second-user tests)
- [ ] FR-027 TLS config documented
- [ ] Coverage ≥80% line / ≥70% branch
- [ ] Full regression: 13 independent tests
