// Bundles the collaboration service into one file with no runtime dependencies:
// build/collab/server.mjs, run with `node build/collab/server.mjs` (pnpm collab:dev, Docker "collab").
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/**
 * The service imports src/lib/notes.ts, which pulls in Next-only modules it never calls:
 * "server-only" (throws outside React Server Components), next/headers and the Better Auth
 * instance, both reached through src/lib/session.ts. They are replaced by empty stand-ins.
 */
const stubs = {
  name: "nexus-stubs",
  setup(b) {
    b.onResolve({ filter: /^(server-only|next\/headers|@\/lib\/auth)$/ }, (args) => ({ path: args.path, namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
      contents:
        args.path === "@/lib/auth"
          ? "export function getAuth() { throw new Error('Better Auth is not available in the collab service'); }"
          : args.path === "next/headers"
            ? "export async function headers() { throw new Error('next/headers is not available in the collab service'); }"
            : "",
      loader: "js",
    }));
  },
};

await build({
  absWorkingDir: root,
  entryPoints: ["collab/src/main.ts"],
  outfile: "build/collab/server.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  tsconfig: "tsconfig.json",
  // ws loads these optional native speed-ups inside try/catch.
  external: ["bufferutil", "utf-8-validate"],
  plugins: [stubs],
  // CommonJS dependencies (ws) call require(); an ES module has none of its own.
  banner: {
    js: "import { createRequire as __nexusCreateRequire } from 'node:module';\nconst require = __nexusCreateRequire(import.meta.url);",
  },
  legalComments: "linked",
  logLevel: "warning",
});
console.log("build/collab/server.mjs built");
