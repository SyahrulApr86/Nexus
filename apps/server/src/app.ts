import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./env.js";
import { authRoutes } from "./routes/auth.js";
import { noteRoutes } from "./routes/notes.js";
import { folderRoutes } from "./routes/folders.js";

export function buildApp() {
  const app = new Hono()
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
    .route("/api/folders", folderRoutes);

  return app;
}

export type AppType = ReturnType<typeof buildApp>;
