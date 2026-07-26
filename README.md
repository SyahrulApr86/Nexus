# Nexus

Browser-based Markdown note-taking with server-side sync, wikilink knowledge
graph, full-text fuzzy search, versioned trash, and a keyboard-first workflow.

## Stack

pnpm + Turborepo monorepo:

| Package | What |
|---|---|
| `apps/web` | React 18 + Vite SPA. TanStack Router/Query, CodeMirror 6, D3 graph, Tailwind v4 |
| `apps/server` | Hono (Node) API + WebSocket. Prisma/PostgreSQL, Redis sessions, pgcrypto content encryption |
| `packages/shared` | Wikilink/tag parser (single source of truth) + zod schemas + DTO types |
| `e2e` | Playwright end-to-end + axe-core WCAG 2.1 AA audits |

## Requirements

- Node 20 or newer
- pnpm 9 or newer (`corepack enable` is enough)
- Docker with Compose, for PostgreSQL, Redis, and a local mail catcher

## Setup

### 1. Start the services

```bash
docker compose up -d
```

This brings up PostgreSQL on `:5433`, Redis on `:6380`, and Mailpit on `:8025`
(web UI) and `:1025` (SMTP). The ports are deliberately non-standard so they do
not collide with anything already running locally.

### 2. Install dependencies

```bash
pnpm install
```

### 3. Configure the server

```bash
cp apps/server/.env.example apps/server/.env
```

The defaults match the Docker services above. For local development set
`COOKIE_SECURE="false"`, otherwise the browser refuses to store the session
cookie over plain HTTP.

### 4. Create the database schema

```bash
pnpm --filter @nexus/server db:generate
pnpm --filter @nexus/server db:deploy
```

### 5. Run it

```bash
pnpm dev
```

The app is at http://localhost:5173 and the API at http://localhost:3001.
Register an account and you are in. Password reset emails are caught by
Mailpit, so open http://localhost:8025 to read them.

## Configuration

All server settings live in `apps/server/.env`.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection, used for sessions, lockouts and rate limits |
| `CONTENT_ENCRYPTION_KEY` | Key for the pgcrypto column encryption on note content. Changing it makes existing notes unreadable |
| `SMTP_HOST` / `SMTP_PORT` / `MAIL_FROM` | Outgoing mail for password resets |
| `APP_ORIGIN` | Where the web app is served from. Used for CORS and reset links |
| `PORT` | API port, `3001` by default |
| `COOKIE_SECURE` | `true` in production so session cookies are `Secure`. Set `false` for local HTTP |
| `RATE_LIMIT_SCALE` | Multiplier on the auth rate limits. Keep at `1` in production; raise it locally if you trip them |
| `ENABLE_DEV_SEED` | Exposes a bulk seeding endpoint used by the performance tests. Must stay unset or `false` in production |

## Tests

```bash
pnpm test                                                # shared + server
pnpm --filter @nexus/server exec vitest run --coverage   # with 80/70 coverage gates
pnpm test:e2e                                            # Playwright + axe
```

The integration tests use a separate `nexus_test` database and Redis database
1, so they are safe to run next to a dev session. The end-to-end suite starts
the web and API servers itself, but it does need Docker running.

## Deploying

```bash
pnpm build
pnpm --filter @nexus/server db:deploy
```

Serve `apps/web/dist` as static files and run the API behind a TLS-terminating
proxy. The proxy needs to forward `/api` to the API port, including the
WebSocket upgrade on `/api/ws` that powers live sync between devices. Serve
everything over HTTPS and leave `COOKIE_SECURE="true"` so the session cookie
keeps its `Secure` flag.

## How the pieces fit

- **Note content is encrypted at the column level.** Search runs against a
  derived lexeme index and the plaintext titles, so note bodies are never
  decrypted to answer a query.
- **Wikilinks and tags are parsed by one module** in `packages/shared`, used by
  the editor, the preview, and the server indexer alike. They cannot drift
  apart.
- **Every query is scoped to the signed-in person's vault.** No code path reads
  notes without that filter, and each endpoint has a test proving a second
  account cannot reach the first one's data.
- **Sessions are opaque tokens in Redis** with a rolling idle timeout that each
  person can set between 5 and 120 minutes.

## Tests as the specification

Every user-facing requirement has a test that names it. Server behaviour lives
in `apps/server/test`, browser flows in `e2e/tests`, and the parser rules in
`packages/shared/test`. Read those first if you want to know what the app
promises.
