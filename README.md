# Nexus

Browser-based Markdown note-taking with server-side sync, wikilink knowledge
graph, full-text fuzzy search, versioned trash, and a keyboard-first workflow.
Built against [PRD.md](./PRD.md) with the visual system from
[DESIGN.md](./DESIGN.md).

## Stack

pnpm + Turborepo monorepo:

| Package | What |
|---|---|
| `apps/web` | React 18 + Vite SPA — TanStack Router/Query, CodeMirror 6, D3 graph, Tailwind v4 |
| `apps/server` | Hono (Node) API + WebSocket — Prisma/PostgreSQL, Redis sessions, pgcrypto content encryption |
| `packages/shared` | Wikilink/tag parser (single source of truth) + zod schemas + DTO types |
| `e2e` | Playwright end-to-end + axe-core WCAG 2.1 AA audits |

## Development

```bash
docker compose up -d          # PostgreSQL :5433, Redis :6380, Mailpit :8025
pnpm install
pnpm --filter @nexus/server db:generate
pnpm --filter @nexus/server db:deploy
pnpm dev                      # web on :5173, api on :3001
```

Open http://localhost:5173. Password-reset emails land in Mailpit
(http://localhost:8025).

Server config lives in `apps/server/.env` (see `.env.example`).

## Tests

```bash
pnpm test                                        # unit + integration (shared + server)
pnpm --filter @nexus/server exec vitest run --coverage   # with 80/70 coverage gates
pnpm test:e2e                                    # Playwright + axe (needs docker services)
```

Integration tests use the `nexus_test` database and Redis db 1 — safe to run
next to a dev session.

## Security notes

- **Transport (FR-027)**: the app must be served over TLS in production.
  Terminate HTTPS at your proxy (Caddy/nginx/traefik), proxy `/api` and the
  `/api/ws` WebSocket upgrade to the server port, and set
  `COOKIE_SECURE="true"` (default) so session cookies are `Secure`.
  HSTS at the proxy is recommended.
- **At rest (FR-026)**: note content is encrypted column-level via pgcrypto
  (`pgp_sym_encrypt`) with `CONTENT_ENCRYPTION_KEY`. Search runs on a derived
  tsvector lexeme index and plaintext titles — documented tradeoff: the index
  leaks content vocabulary, never the full text. Rotate the key by
  re-encrypting the `contentEnc` columns.
- **Sessions**: opaque tokens in Redis, httpOnly/SameSite=Lax cookies, rolling
  idle timeout (5–120 min, user-configurable). Account lockout: 5 failed
  logins / 15 min. Auth endpoints are IP rate-limited
  (`RATE_LIMIT_SCALE=1` in production).
- **Isolation (FR-025)**: every query is vault-scoped; cross-user access is
  covered by dedicated tests per endpoint.
- `ENABLE_DEV_SEED` must stay **unset/false** in production — it exposes a
  bulk seeding endpoint used only by performance tests.

## Requirement traceability

`TASKS.md` maps every FR/US/SC in the PRD to its implementation and tests.
