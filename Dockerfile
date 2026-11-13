# syntax=docker/dockerfile:1

FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /app

# --- Dependencies (full, incl. dev: needed for build and migrations) ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# --- Build the Next.js standalone server ---
FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build
# Real-time collaboration service: one self-contained bundle, run by compose service "collab".
RUN node collab/build.mjs

# --- One-shot migration runner (docker compose service "migrate") ---
FROM deps AS migrate
COPY drizzle ./drizzle
COPY scripts ./scripts
CMD ["node", "scripts/migrate.mjs"]

# --- Minimal runtime image ---
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S nexus && adduser -S nexus -G nexus
# Attachment storage (NEXUS_DATA_DIR). A new named volume mounted here copies this owner and mode.
RUN mkdir -p /data && chown nexus:nexus /data && chmod 750 /data
ENV NEXUS_DATA_DIR=/data
COPY --from=build --chown=nexus:nexus /app/.next/standalone ./
COPY --from=build --chown=nexus:nexus /app/.next/static ./.next/static
COPY --from=build --chown=nexus:nexus /app/public ./public
COPY --from=build --chown=nexus:nexus /app/build/collab/server.mjs ./collab/server.mjs
USER nexus
EXPOSE 3000
CMD ["node", "server.js"]
