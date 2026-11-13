/**
 * Entry point of the collaboration service (docker compose service "collab", `pnpm collab:dev`).
 */
import { configFromEnv } from "./config";
import { startCollabServer } from "./server";

async function main() {
  const config = configFromEnv();
  const collab = await startCollabServer(config);
  console.log(`[collab] listening on ${config.host}:${collab.port}`);

  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[collab] ${signal}: saving open notes`);
    // Docker sends SIGKILL 10 s after SIGTERM; saving every open note takes far less.
    collab
      .close()
      .then(() => process.exit(0))
      .catch((err) => {
        console.error("[collab] shutdown failed", { name: (err as Error)?.name });
        process.exit(1);
      });
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}

main().catch((err) => {
  // Configuration errors carry no secrets; database errors are reduced to their class and code.
  const e = err as { name?: string; message?: string; code?: string };
  console.error("[collab] failed to start:", e.name === "Error" ? e.message : { name: e.name, code: e.code });
  process.exit(1);
});
