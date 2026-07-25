# Product Requirements Document: Nexus

**Product Name**: Nexus
**Document Version**: 1.0
**Type**: Markdown Note-Taking Web Application
**Target Users**: Developers and knowledge workers who need cloud-synced note-taking accessible from any device via browser

---

## 1. Product Overview

Nexus is a browser-based Markdown note-taking application with server-backed storage, wikilink-based knowledge graph navigation, and full-text search. It is designed for developers and knowledge workers who think in structured, linked notes (similar to Obsidian or Roam Research) but want a zero-install, cloud-synced experience accessible from any modern browser.

### 1.1 Vision

Give technical users a fast, keyboard-first, Markdown-native note-taking tool that works identically across devices without requiring a desktop app, local file sync tool, or manual backup process. Notes live on the server; the browser is a thin, responsive view layer.

### 1.2 Core Value Propositions

1. **Zero-install cloud sync** — log in from any browser, same vault everywhere.
2. **Markdown-native editing** — CommonMark with live split-pane preview, no proprietary format.
3. **Wikilink knowledge graph** — `[[Note Title]]` linking with autocomplete and a visual graph explorer.
4. **Keyboard-first workflow** — command palette (`Ctrl+P`), full keyboard navigation, no mouse required for core actions.
5. **Data safety by default** — versioned trash, no silent data loss.

### 1.3 Non-Goals (Out of Scope for v1)

- Real-time collaborative editing / shared vaults (single-user tool only)
- Native mobile or desktop apps (browser-only, tablet-friendly but not mobile-first)
- Rich media storage (images/video are referenced by URL only, not uploaded/hosted)
- Offline-first architecture (server is the only system of record; local caching is best-effort)
- Social login / SSO (email + password only)
- Internationalization / localization (English UI only)
- Email verification at signup (accounts active immediately)
- Audit logging of sensitive operations (deferred to v2)

---

## 2. Target Users & Personas

**Primary persona: "Dana the Developer"**
Software engineer or technical knowledge worker who takes notes across multiple devices (work laptop, personal desktop, occasionally tablet). Comfortable with Markdown syntax, keyboard shortcuts, and command palettes (inspired by VS Code / Obsidian workflows). Wants notes that link to each other and a way to visually explore how ideas connect. Values speed and reliability over visual flourish.

**Secondary persona: "Karin the Knowledge Worker"**
Non-engineer but technically literate (PM, researcher, analyst). Migrating from another note tool (Obsidian, Bear, plain text files) and needs to import an existing corpus of Markdown files without losing wikilinks or tags.

---

## 3. User Stories

Each story includes priority, rationale, an independent test, and acceptance scenarios in Given/When/Then form. Priorities: **P1** = MVP-blocking, **P2** = core value, **P3** = polish/differentiation.

### US1 — User Registration & Login (P1)

A knowledge worker registers with email and password, logs in, and accesses a private workspace.

**Independent Test**: Register → log in → verify workspace access → log out → verify workspace inaccessible → log back in.

**Acceptance Scenarios**:
1. Given a new user fills in email and a valid password (≥8 chars, uppercase, lowercase, digit, special character) and submits registration, then an account is created and they land in their workspace.
2. Given a password that fails strength requirements, then the user sees specific feedback on which requirement(s) failed (e.g., "Password must include at least one special character").
3. Given correct login credentials, then the user is authenticated and sees their notes workspace.
4. Given incorrect credentials, then the user sees a generic error and stays on the login page (no indication of whether email or password was wrong — prevents enumeration).
5. Given a logged-in user signs out, then all session data is cleared and they return to the login page.
6. Given an authenticated user's session expires, then they are redirected to login with a "session expired" notification.

### US1b — Password Reset (P1)

A user recovers access via a time-limited email reset link.

**Independent Test**: Request reset → receive email/token → click link → set new password → log in with new credentials → verify old password rejected.

**Acceptance Scenarios**:
1. Given a user submits their email on "Forgot Password", then a reset link is sent and a confirmation message is shown **regardless of whether the email is registered** (prevents email enumeration).
2. Given a valid reset link, when the user sets a new password meeting strength requirements, then the password updates, the reset link is invalidated (single-use), and the user is redirected to login with a success notification.
3. Given an expired or already-used reset link, then the user sees an "invalid link" message directing them to request a new one.
4. Given 5 consecutive failed login attempts within 15 minutes, then the account is locked for 15 minutes with a notification shown on subsequent attempts.

### US2 — Create, Edit, and Preview Notes (P1)

Core value proposition: create/edit Markdown notes with a live split-pane preview, auto-saved to the server.

**Independent Test**: Create note → type Markdown → verify live preview → edit → verify persistence after reload → open from a different device.

**Acceptance Scenarios**:
1. Given "New Note" is clicked, then a blank note opens with an empty preview pane.
2. Given the user types Markdown (headings, lists, bold, italic, code blocks), then the preview updates in real time with rendered HTML.
3. Given unsaved changes exist and the user navigates away or closes the tab, then auto-save has already triggered (no data loss).
4. Given a saved note is reopened from the note list, then the editor loads full content and the preview renders correctly.
5. Given a note is edited concurrently in another tab/session, then the user is notified of the conflict (last-write-wins with notification, not silent overwrite).

### US3 — Note Organization with Folders/Vaults (P2)

Hierarchical folder structure with manual drag-reorder and sort toggles.

**Independent Test**: Create folders → create/move notes between folders → verify sidebar tree reflects hierarchy → reload → verify structure persists.

**Acceptance Scenarios**:
1. Given a new folder is created from the sidebar, then it appears in the tree and notes can be created inside it.
2. Given a note is dragged to another folder, then it moves and folder note-counts update.
3. Given a folder with contents is deleted, then the user is prompted to confirm and all contained notes move to trash.
4. Given a folder is renamed, then the new name appears in the sidebar and all notes retain their folder association.
5. Given a note is drag-reordered within a folder, then the new order is persisted to the server.
6. Given a sort toggle (title A-Z/Z-A, date newest/oldest) is applied, then notes reorder accordingly, temporarily overriding manual position.

### US4 — Wikilink Navigation Between Notes (P2)

`[[Note Title]]` syntax with autocomplete, clickable navigation, and broken-link handling.

**Independent Test**: Create two notes → type `[[Note2]]` in Note1 → verify link renders → click to navigate → type `[[NonExistent]]` → verify broken-link style → click → offer to create.

**Acceptance Scenarios**:
1. Given the user types `[[` in the editor, then an autocomplete dropdown appears, filtered by the typed fragment, showing existing note titles.
2. Given a suggestion is selected (click or keyboard), then `[[Note Title]]` is inserted at the cursor and the dropdown closes.
3. Given a note contains a valid wikilink, when rendered in preview, then it appears as a clickable link, styled distinctly from external URLs.
4. Given a wikilink in preview is clicked, then the editor navigates to the referenced note.
5. Given a wikilink references a non-existent note, then it renders with distinct "broken" styling (e.g., red/dashed) and clicking it offers to create the missing note.
6. Given the user types `[[` inside a code block or inline code span, then autocomplete does NOT trigger.

### US5 — Full-Text Search (P2)

Debounced, fuzzy, real-time search across titles and content.

**Independent Test**: Create notes with known keywords → search exact and misspelled terms → verify ranked results → search nonexistent term → verify empty state.

**Acceptance Scenarios**:
1. Given a search query is typed, then matching notes appear within 500ms, including fuzzy/typo-tolerant matches (e.g., "recieve" matches "Receive").
2. Given a search result is clicked, then the note opens in the editor.
3. Given the query changes, then results update in real time without requiring Enter.
4. Given no matches exist, then a "No notes found" message is shown.
5. Given a likely misspelling with no exact matches, the system MAY suggest "Did you mean: X?" based on fuzzy results.
6. Given a query is 1-2 characters, then results are still returned but the UI signals the query is too short for meaningful ranking.

### US6 — Interactive Graph View (P3)

Visual, pannable/zoomable node-link diagram of the wikilink network.

**Independent Test**: Create notes with wikilinks between them → open graph view → verify nodes/edges render → pan/zoom → click node → verify navigation.

**Acceptance Scenarios**:
1. Given a vault with wikilinked notes, then the graph view displays a node-link diagram with notes as labeled nodes and wikilinks as edges.
2. Given the graph is open, then drag pans and scroll zooms smoothly.
3. Given a node is clicked, then the editor opens that note.
4. Given a large vault (500+ notes), then the graph renders without browser freeze (clustering/viewport culling applied to maintain >30fps).
5. Given a note has no wikilinks, then it appears as an isolated node at the periphery.

### US7 — Tag System (P3)

Inline `#tagname` extraction, aggregation, and click-to-filter.

**Independent Test**: Write `#project-alpha` in a note → verify it appears in the tag list → click it → verify only matching notes shown.

**Acceptance Scenarios**:
1. Given `#tagname` is typed in note content, then it renders as a styled tag element in preview.
2. Given a vault has tagged notes, then the tag list/sidebar shows all tags with note counts.
3. Given a tag is clicked, then the note list filters to notes containing that tag.

### US8 — Command Palette (P3)

`Ctrl+P` / `Cmd+P` fuzzy command search and execution.

**Independent Test**: Press `Ctrl+P` → type "new note" → Enter → verify note created. Repeat for other commands.

**Acceptance Scenarios**:
1. Given `Ctrl+P`/`Cmd+P` is pressed, then a command palette overlay opens with a search input.
2. Given a partial command name is typed, then matching commands list in real time with keyboard navigation (arrow keys).
3. Given a command is highlighted and Enter is pressed, then it executes and the palette closes.
4. Given the palette is open, pressing Escape closes it without side effects (no residual overlay blocking clicks).

### US9 — Dark/Light Mode (P3)

Theme toggle with OS-preference default and persisted override.

**Independent Test**: Toggle light→dark → verify all UI adapts → refresh → verify persistence.

**Acceptance Scenarios**:
1. Given a first-time visit, then the theme defaults to the OS/browser `prefers-color-scheme`.
2. Given the theme is toggled (settings or command palette), then the entire interface transitions immediately.
3. Given dark mode was selected, then it persists across sessions without re-selection.

### US10 — Multi-Device Sync (P3)

Server-backed storage means all devices see the same vault; WebSocket pushes live updates to open sessions.

**Independent Test**: Create a note on Device A → log in on Device B → verify note appears → edit on B → verify visible on A.

**Acceptance Scenarios**:
1. Given a user creates/edits notes on Device A, then changes save to the server.
2. Given the user logs in on Device B, then all notes from Device A appear with latest content.
3. Given connectivity is lost with unsaved local changes, then an offline indicator shows and changes queue for sync on reconnect.

### US11 — Export Vault (P3)

One-click export of the entire vault as a ZIP of plain `.md` files preserving folder hierarchy.

**Independent Test**: Create notes across folders → export → extract ZIP → verify content and structure match.

**Acceptance Scenarios**:
1. Given "Export Vault" is triggered, then a ZIP downloads containing `.md` files in the same folder hierarchy.
2. Given the ZIP is extracted and opened in any Markdown editor, then all content (including wikilinks and tags as plain text) is readable.
3. Given a 1000+ note vault, then export completes and download begins within 10 seconds.

### US12 — Trash Management with Version History (P2)

Soft-delete with full version history; restore or permanently delete.

**Independent Test**: Create note → edit multiple times → delete → open trash → verify note + full history → restore → verify intact → permanently delete → verify irrecoverable.

**Acceptance Scenarios**:
1. Given a note with multiple saved versions is deleted, then the note and all versions move to trash and disappear from the folder list.
2. Given a folder with notes is deleted, then the folder and all contained notes (with versions) move to trash.
3. Given a trashed note is restored, then it returns to its original folder with the latest version active and all prior versions preserved.
4. Given "Permanently Delete" is chosen (with confirmation), then the item and all version history are irreversibly removed.
5. Given a note is restored to a folder that was also trashed and later restored, then the note correctly reappears in the restored folder.
6. Given a trashed item's version history is viewed, then any prior version's content can be previewed read-only.
7. Given a trashed note's original folder was permanently deleted, then restoring the note places it at the vault root with a notification explaining why.

### US13 — Import Existing Markdown Files (P3)

Single-file, bulk-file, and ZIP import with folder-structure recreation.

**Independent Test**: Prepare `.md` files with wikilinks/tags on disk → import single file → verify → bulk-import → verify all → zip and import → verify folder structure recreated.

**Acceptance Scenarios**:
1. Given a single `.md` file is imported, then a note is created using the filename as title and full content preserved.
2. Given multiple `.md` files are selected, then all become notes with original filenames as titles.
3. Given a ZIP with a folder hierarchy of `.md` files is imported, then the folder structure is recreated in Nexus with notes placed correctly.
4. Given imported content contains `[[wikilinks]]` and `#tags`, then they are parsed and functional post-import (wikilinks resolve if the target also exists).
5. Given an imported filename collides with an existing note title in the target folder, then the import creates the note with a numeric suffix (e.g., "Note (1)") rather than silently overwriting.

---

## 4. Edge Cases (Must Be Handled)

- Duplicate note titles in the same folder are allowed; notes are identified by internal ID, not title.
- `[[` inside a code block or inline code span must NOT trigger wikilink autocomplete.
- Deleting a folder whose notes are referenced by wikilinks elsewhere: links become "broken" (styled distinctly); the referenced content is recoverable from trash.
- Very large notes (50,000+ words): editor and preview must remain responsive (virtual scrolling/chunked rendering).
- Concurrent edits from multiple tabs/devices: last-write-wins with a conflict notification to the user (never silent overwrite).
- Browser tab closed with unsaved changes: auto-save must have already fired.
- Search must handle Unicode fully: CJK, Arabic, Cyrillic, emoji, and regex-reserved characters.
- Registering with an already-registered email: clear error message with a link to login.
- Password-reset email delivery failure: request is still acknowledged to the user; email queued for retry; reset link remains valid for the full 60-minute window.
- Account lockout triggered by an attacker targeting a legitimate user: auto-unlocks after 15 minutes; the legitimate user can also use password reset to regain access immediately.
- Graph view with zero-link notes: rendered as isolated peripheral nodes, not hidden.
- Browser back/forward must integrate with the History API (navigates between previously viewed notes/folders/views).
- Restoring a note whose original folder was permanently deleted: restores to vault root, with a notification.
- Version history for notes edited very frequently over months: cap at 100 versions per note; oldest versions pruned automatically beyond that.
- Importing invalid/binary content: reject with a clear error; only `.md`/`.markdown` extensions accepted.
- ZIP import containing non-Markdown files alongside `.md` files: non-Markdown files silently skipped.
- Fuzzy search with 1-2 character queries: still returns results but signals "too short for meaningful ranking."

---

## 5. Functional Requirements

Organized by domain. Each requirement is independently testable and traces to one or more user stories above.

### 5.1 Authentication & Session Management
- **FR-001**: Register with email + password. Password ≥8 chars, ≥1 uppercase, ≥1 lowercase, ≥1 digit, ≥1 special character. Reject non-conforming passwords with specific field-level feedback.
- **FR-002**: Log in with email + password.
- **FR-002a**: Password reset via emailed link with a time-limited (60 min), single-use token.
- **FR-002b**: Lock account for 15 minutes after 5 consecutive failed logins within a 15-minute window; show lockout notification on subsequent attempts.
- **FR-003**: Terminate session on logout and after a configurable idle timeout (default 30 min, range 5–120 min).

### 5.2 Note Editing
- **FR-004**: Markdown editor supporting create/read/update/delete of notes.
- **FR-005**: Live split-pane preview of Markdown, updating as the user types.
- **FR-006**: Auto-save to server, debounced 1000ms after typing stops (no manual save button).

### 5.3 Organization
- **FR-007**: Create, rename, move, delete folders forming a hierarchical vault.
- **FR-007a**: Manual drag-to-reorder of notes within a folder, persisted server-side.
- **FR-007b**: Per-folder sort toggles (title A-Z/Z-A, date newest/oldest) that temporarily override manual order.
- **FR-008**: Sidebar file tree showing the full folder/note hierarchy.

### 5.4 Wikilinks
- **FR-009**: Parse `[[Note Title]]` syntax in both editor and preview.
- **FR-010**: Autocomplete on `[[` trigger, filtered by typed fragment.
- **FR-011**: Render valid wikilinks as clickable navigation elements in preview.
- **FR-012**: Render broken wikilinks with distinct styling; offer to create the missing note on click.

### 5.5 Search
- **FR-013**: Full-text search across titles and content with fuzzy/typo-tolerant matching; title matches ranked above content-only matches.
- **FR-014**: Real-time result updates as the query changes.

### 5.6 Graph View
- **FR-015**: Interactive graph showing notes as nodes, wikilinks as edges.
- **FR-016**: Pan and zoom support in the graph view.

### 5.7 Tags
- **FR-017**: Recognize `#tagname` patterns, render as styled tag elements.
- **FR-018**: Aggregate and display all tags with note counts.
- **FR-019**: Filter notes by selected tag.

### 5.8 Command Palette & Theming
- **FR-020**: Command palette via `Ctrl+P`/`Cmd+P` supporting keyboard search and execution of application commands.
- **FR-021**: Support dark and light visual themes.
- **FR-022**: Persist theme preference across sessions.

### 5.9 Storage & Sync
- **FR-023**: Store all note data server-side, accessible from any device on authentication.
- **FR-024**: Export vault as ZIP of `.md` files preserving folder structure.

### 5.10 Security & Isolation
- **FR-025**: Isolate user data — no user may access another user's notes under any circumstance.
- **FR-026**: Encrypt note content column at rest (column-level encryption, e.g. pgcrypto). Metadata (title, timestamps, folder ID) may remain plaintext for indexing/search.
- **FR-027**: All browser↔server communication over encrypted transport (TLS).

### 5.11 Trash & Versioning
- **FR-028**: Trash view accessible from sidebar showing all deleted notes and folders.
- **FR-029**: Preserve all prior versions of a note when moved to trash.
- **FR-030**: Restore trashed items to original location with full version history intact.
- **FR-031**: Permanently delete from trash after confirmation, irreversibly removing all versions.
- **FR-032**: Preview read-only content of any prior version while a note is in trash.

### 5.12 Import
- **FR-033**: Import a single `.md` file as a new note; filename becomes title.
- **FR-034**: Import multiple `.md` files in one operation.
- **FR-035**: Import a ZIP archive of `.md` files, recreating the contained folder structure.
- **FR-036**: Parse wikilinks and tags in imported content, making them functional post-import.

---

## 6. Non-Functional Requirements / Success Criteria

Measurable, testable outcomes that gate release readiness.

| ID | Requirement | Target |
|----|-------------|--------|
| SC-001 | End-to-end first-use flow (register → login → create note → see preview) | < 2 minutes |
| SC-001a | Password reset flow (request → email → new password → login) | < 3 minutes |
| SC-002 | Markdown preview update latency after typing | < 100ms |
| SC-003 | Full-text search across 5,000 notes | < 1 second |
| SC-004 | Graph view with 1,000 notes, pan/zoom | > 30fps sustained, no browser freeze |
| SC-005 | Sidebar note list with 10,000 notes, initial render | < 500ms |
| SC-006 | All core actions (create note, search, open/close note, navigate folders, toggle theme, open command palette, export, open trash, restore) | Executable via keyboard only, no mouse required |
| SC-007 | Cross-device data availability after save | < 5 seconds under normal network conditions |
| SC-008 | Export of a 500-note vault to ZIP | < 10 seconds |
| SC-009 | User-rated editing experience ("smooth and responsive") | 90% positive in post-launch user testing *(not a CI-verifiable gate)* |
| SC-010 | WCAG 2.1 AA contrast and keyboard accessibility | Verified via automated audit (e.g. axe-core) on every route |
| SC-011 | Restore trashed note with full version history | < 3 seconds |
| SC-012 | Import ZIP of 100 files / 10 folders | < 15 seconds, all structure/wikilinks preserved |

**Additional non-functional constraints**:
- Optimistic UI: mutations (create/edit/delete) reflect in the UI immediately, with rollback on server rejection.
- Lazy loading: note lists and content fetched on demand, not eagerly.
- Virtual rendering for long lists to bound DOM node count.
- Animations subtle and brief (~150ms ease), respecting `prefers-reduced-motion`.

---

## 7. Data Model

### 7.1 Entities

- **User** — unique ID, email (unique), hashed password, display name (optional), theme preference, timestamps. Owns exactly one Vault.
- **Vault** — top-level container per user. One-to-one with User.
- **Folder** — hierarchical container within a vault. Attributes: ID, name, parent folder ID (null = root), position (ordering), soft-delete flag, timestamps.
- **Note** — Markdown document. Attributes: ID, title, content (Markdown), parent folder ID (nullable), position, soft-delete flag, timestamps. Content column is encrypted at rest.
- **Note Version** — immutable snapshot. Attributes: version ID, parent note ID, full content, timestamp, optional auto-generated change summary. Survives in trash; permanently removed only on explicit hard delete. Capped at 100 versions/note (oldest pruned).
- **Tag** — derived, not stored as a separate table: extracted from `#tagname` patterns in note content at read/index time. Attributes surfaced to the UI: name, associated note IDs, note count.
- **Wikilink Reference** — parsed link. Attributes: source note ID, target note title, resolved target note ID (nullable — null means broken link). Powers graph-view edges and click-navigation.

### 7.2 Relationships

```
User (1) ─── (1) Vault
Vault (1) ─── (N) Folder
Folder (1) ─── (N) Folder [self-referential, parent/child]
Folder (1) ─── (N) Note
Note (1) ─── (N) Note Version
Note (1) ─── (N) Wikilink Reference [as source]
Note (1) ─── (N) Wikilink Reference [as target, nullable]
```

### 7.3 Key Constraints

- One vault per user, enforced at creation (registration auto-creates a vault).
- Duplicate note titles permitted within the same folder — uniqueness is by ID only.
- Soft-delete (`isTrashed`/equivalent flag) used for both Notes and Folders; deleting a folder cascades soft-delete to all descendants (subfolders + notes).
- All queries scoped by vault/user ownership — no cross-user data leakage under any query path (this is a hard security requirement, not just a UX nicety).

---

## 8. Recommended Technical Architecture

This section is a recommendation, not a hard constraint — the implementing agent/team may substitute equivalent technologies, but the shape below is proven to satisfy the requirements above.

### 8.1 High-Level Shape

- **Monorepo** with a clear frontend/backend/shared-package split (e.g. Turborepo + pnpm workspaces).
- **Frontend**: SPA served over HTTPS, talking to backend via a type-safe RPC or REST layer.
- **Backend**: stateless API server, session-based auth (httpOnly, Secure, SameSite cookies), WebSocket channel for live sync notifications.
- **Database**: relational database (PostgreSQL recommended) for all note/folder/user data, with full-text search and fuzzy-match support (e.g. `pg_trgm`) and column-level encryption (`pgcrypto`) for note content.
- **Cache/session store**: Redis (or equivalent) for session state, rate limiting, and account-lockout counters.
- **Object storage**: only needed if rich media upload is added post-v1; not required for the v1 scope defined here.

### 8.2 Suggested Stack (proven-fit, not mandatory)

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Frontend framework | React 18 + Vite | Fast dev loop, wide ecosystem for CM6/D3 integration |
| Editor | CodeMirror 6 | Extensible for wikilink autocomplete, markdown syntax |
| Graph rendering | D3.js (force-directed layout) | Flexible pan/zoom, degree-based sizing, viewport culling |
| State/data fetching | TanStack Query + a typed RPC client | Optimistic updates, cache invalidation, type safety end-to-end |
| Routing | Any file/type-safe router | Deep-linkable notes (`/notes/:id`), auth-guarded routes |
| Styling | Tailwind CSS + a component primitive library | Design-token driven, dark/light theming |
| Backend framework | Lightweight HTTP framework (e.g. Hono) + typed RPC layer | Low overhead, easy WebSocket integration |
| ORM | Prisma (or equivalent) | Schema-as-code, migrations, type-safe queries |
| Auth | Session-cookie based (custom or a library like Better Auth) | Full control over lockout/reset logic per FR-002a/b |
| Realtime | WebSocket with per-vault "rooms" | Push note-updated events to other open sessions (US10) |
| ZIP handling | Streaming ZIP library both directions | Export (FR-024) and import (FR-035) |

### 8.3 Non-Negotiable Architectural Principles

1. **Server is the system of record.** Local/browser caching is permitted for responsiveness but must never be authoritative.
2. **Every data access path is scoped by ownership.** There is no code path that queries notes/folders without a vault/user filter.
3. **TDD is mandatory.** Every functional requirement above must have unit and/or integration test coverage before being marked complete. Coverage gates: ≥80% line, ≥70% branch (or team-agreed equivalent).
4. **Accessibility is a release gate, not a polish item.** WCAG 2.1 AA verified via automated audit on every route before a story is marked done.
5. **All mutating actions have keyboard equivalents** (SC-006) — do not ship a feature that is mouse-only.

---

## 9. API Surface (Conceptual)

Regardless of transport choice (REST/RPC), the backend must expose the following logical operations, grouped by domain:

**Auth**: register, login, logout, get-current-user, request-password-reset, reset-password, update-preferences (theme, idle timeout).

**Notes**: list (paginated, folder-scoped, cursor-based), get (with version summaries), create, update (content/title, with optimistic-concurrency check), delete (soft), move-to-folder, reorder, autocomplete-wikilink-suggestions.

**Folders**: get-tree (hierarchical, with note counts), create, rename, move, delete (cascading soft-delete).

**Search**: full-text search (fuzzy, ranked), get-all-tags (aggregated with counts), search-by-tag.

**Trash**: list-trashed-items (notes + folders), restore, permanently-delete, get-version-content (read-only preview).

**Graph**: get-graph-data (all nodes/edges/orphan-count for the vault), get-node-detail (single note's connections).

**Import/Export**: export-vault (streams a ZIP), import-files (single/bulk `.md`), import-zip (recreates folder structure).

**Realtime (WebSocket)**: join/leave per-vault room, broadcast `note:created` / `note:updated` / `note:deleted` events to all other sessions in the same vault.

Every mutating endpoint above must enforce authentication and vault ownership before touching data (FR-025).

---

## 10. Assumptions & Constraints

- Desktop and tablet browsers are the target; mobile browser support is desirable but not required for v1.
- Users have generally stable connectivity; full offline-first is a future enhancement, not v1 (a connectivity indicator and change-queue for brief interruptions is in-scope, per US10).
- Email + password is the only auth method for v1 — no social login/SSO.
- Password-reset emails are sent via a transactional email provider; email delivery reliability is treated as external — the app always acknowledges the reset request to the user regardless of provider status.
- Single-user tool: no shared vaults, no real-time co-editing, no comments.
- Notes are plain Markdown — no rich media upload/hosting in v1; image URLs render in preview but are not stored by the app.
- Tags are inline-derived only — no separate tag CRUD/management UI beyond filtering.
- Graph view is read-only visualization — no creating/deleting wikilinks by manipulating the graph directly.
- Sidebar shows the full folder tree; lazy-loading of very deep hierarchies is acceptable.
- Exported wikilinks/tags remain as literal `[[text]]`/`#tag` — this is intentional (standard Markdown-compatible plain text), not a bug.
- No i18n/l10n in v1 — English UI only.
- No onboarding/tutorial flow in v1 — target users are assumed familiar with Markdown note-taking concepts.
- No email verification at signup — accounts are active immediately after registration.
- No audit logging of sensitive operations in v1 (deferred to v2).

---

## 11. Suggested Delivery Phasing

This phasing exists to give a new implementation effort a sane order of operations. It is a recommendation for sequencing, not a rigid mandate.

**Phase 0 — Foundation** (blocks everything else)
Project scaffolding, database schema, auth infrastructure, base UI shell, CI pipeline with lint/typecheck/test gates.

**Phase 1 — MVP** (US1 + US1b + US2)
Registration, login, password reset, account lockout, and the core note editor with live preview and auto-save. **Ship/demo gate**: a user can register, create a note, edit it, and see it persist — this alone is a usable (if minimal) product.

**Phase 2 — Core Value** (US3, US4, US5, US12 — can parallelize after Phase 1)
Folder organization, wikilink navigation with autocomplete, full-text search, and versioned trash. These four together make Nexus a genuinely useful knowledge-management tool.

**Phase 3 — Differentiation & Polish** (US6, US7, US8, US9, US10, US11, US13 — can parallelize after Phase 2, mostly independent of each other)
Graph view, tags, command palette, theming, multi-device sync polish, export, import. US6 (graph) depends on US4 (wikilinks) being complete; US11/US13 depend on US3 (folders) for structure preservation.

**Phase 4 — Hardening**
Accessibility audit pass (SC-010) across all routes, performance verification against every SC target, security review (data isolation, encryption, TLS, rate limiting), full regression pass on all 13 user stories' independent tests.

---

## 12. Definition of Done (Per Feature)

A user story is not "done" until:

1. All acceptance scenarios for that story pass as automated tests (unit + integration, and end-to-end for the story's independent test).
2. The corresponding functional requirements are implemented and traceable.
3. Any relevant success criteria (SC-xxx) for that story are measured and meet target.
4. The feature is keyboard-operable end-to-end (no mouse-only paths) unless explicitly justified as an exception.
5. WCAG 2.1 AA automated audit passes on any new/changed UI surface.
6. Data-isolation is verified for any new data-access path (a second test user cannot read/write the resource).

---

## 13. Open Questions for Implementation Team

These are intentionally left for the implementing team/agent to decide, as they don't change product requirements:

- Exact backend framework/ORM choice (Section 8.2 is a recommendation).
- Whether wikilink/tag extraction happens purely client-side, server-side, or both (must be consistent — a wikilink recognized in the editor must resolve the same way in preview and in the graph).
- Materialized-view vs. on-the-fly computation for tag aggregation (US7) and graph data (US6) — a performance/complexity tradeoff, not a product requirement.
- Whether CodeMirror 6 or another editor component is used, as long as FR-004/005/009/010/011/012 are satisfied.
