import { serve } from "@hono/node-server";
import { buildApp } from "./app.js";
import { env } from "./env.js";

const { app, injectWebSocket } = buildApp();

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`Nexus server listening on :${info.port}`);
});

injectWebSocket(server);
