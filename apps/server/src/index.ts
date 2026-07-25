import { serve } from "@hono/node-server";
import { buildApp } from "./app.js";
import { env } from "./env.js";

const app = buildApp();

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`Nexus server listening on :${info.port}`);
});
