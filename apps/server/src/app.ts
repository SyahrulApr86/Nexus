import { Hono } from "hono";
import { cors } from "hono/cors";
import { createNodeWebSocket } from "@hono/node-ws";
import { getCookie } from "hono/cookie";
import { env } from "./env.js";
import { getSession } from "./lib/session.js";
import { joinVault } from "./lib/realtime.js";
import { authRoutes } from "./routes/auth.js";
import { noteRoutes } from "./routes/notes.js";
import { folderRoutes } from "./routes/folders.js";
import { searchRoutes } from "./routes/search.js";
import { trashRoutes } from "./routes/trash.js";
import { tagRoutes } from "./routes/tags.js";
import { graphRoutes } from "./routes/graph.js";
import { importExportRoutes } from "./routes/importExport.js";
import { devRoutes } from "./routes/dev.js";

export function buildApp() {
  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  // US10: per-vault realtime room. The session cookie on the upgrade request
  // determines the vault — clients can never choose a room (FR-025).
  app.get(
    "/api/ws",
    upgradeWebSocket((c) => {
      let leave: (() => void) | null = null;
      return {
        async onOpen(_evt, ws) {
          const token = getCookie(c, "nexus_session");
          const session = token ? await getSession(token) : null;
          if (!session) {
            ws.close(4401, "unauthenticated");
            return;
          }
          leave = joinVault(session.vaultId, (event) => {
            ws.send(JSON.stringify(event));
          });
          ws.send(JSON.stringify({ type: "joined" }));
        },
        onClose() {
          leave?.();
        },
      };
    }),
  );

  app
    .use(
      "*",
      cors({
        origin: env.APP_ORIGIN,
        credentials: true,
      }),
    )
    .get("/api/health", (c) => c.json({ ok: true }))
    .route("/api/auth", authRoutes)
    .route("/api/notes", noteRoutes)
    .route("/api/folders", folderRoutes)
    .route("/api/search", searchRoutes)
    .route("/api/trash", trashRoutes)
    .route("/api/tags", tagRoutes)
    .route("/api/graph", graphRoutes)
    .route("/api", importExportRoutes)
    .route("/api/dev", devRoutes);

  return { app, injectWebSocket };
}

export type AppType = ReturnType<typeof buildApp>["app"];
