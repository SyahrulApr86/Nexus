/*
 * Nexus service worker: lets the installed app open the vault without a connection.
 *
 * - /vault navigations: network first, the last good copy when offline.
 * - /_next/static (hashed JS, CSS, fonts) and the app icons: stale-while-revalidate.
 * - /api/** is never cached here. Note data offline lives in IndexedDB, per user, and the
 *   workspace reads it itself. Auth responses and anything that sets a cookie never reach a cache.
 * - A new version waits until the page asks for it ("Update available — Reload"), so a tab is
 *   never switched to new code under its feet.
 * - Signing out deletes these caches from the page.
 *
 * Bump VERSION whenever this file's caching rules change: activate deletes every other version.
 */
const VERSION = "v1";
const SHELL = `nexus-shell-${VERSION}`;
const STATIC = `nexus-static-${VERSION}`;
const KEEP = new Set([SHELL, STATIC]);
const SHELL_PATH = "/vault";

self.addEventListener("install", (event) => {
  // The first install has nothing to replace and activates at once. An update waits for "skip-waiting".
  event.waitUntil(Promise.resolve());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith("nexus-") && !KEEP.has(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.origin && event.origin !== self.location.origin) return;
  const data = event.data || {};
  if (data.type === "skip-waiting") self.skipWaiting();
  else if (data.type === "warm") event.waitUntil(warm(Array.isArray(data.urls) ? data.urls : [], data.shell === true));
});

/** Never store a response that sets a cookie, is not ours, or is not a plain success. */
function cacheable(res) {
  return !!res && res.ok && res.type === "basic" && !res.redirected && !res.headers.has("set-cookie");
}

function isStatic(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/favicon.ico" ||
    url.pathname === "/icon.png" ||
    url.pathname === "/apple-icon.png"
  );
}

/** Cache what the page has already loaded (it ran before this worker controlled it). */
async function warm(urls, shell) {
  const cache = await caches.open(STATIC);
  await Promise.all(
    urls.map(async (u) => {
      try {
        const url = new URL(u, self.location.origin);
        if (url.origin !== self.location.origin || !isStatic(url) || (await cache.match(url.href))) return;
        const res = await fetch(url.href, { credentials: "same-origin" });
        if (cacheable(res)) await cache.put(url.href, res);
      } catch {}
    }),
  );
  if (shell) {
    try {
      const res = await fetch(SHELL_PATH, { credentials: "same-origin", headers: { Accept: "text/html" } });
      if (cacheable(res)) await (await caches.open(SHELL)).put(SHELL_PATH, res);
    } catch {}
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Data, auth and the realtime socket always go to the network, untouched.
  if (url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate" && (url.pathname === SHELL_PATH || url.pathname.startsWith(`${SHELL_PATH}/`))) {
    event.respondWith(networkFirst(req));
    return;
  }
  if (isStatic(url)) event.respondWith(staleWhileRevalidate(event, req));
});

async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (cacheable(res)) await cache.put(SHELL_PATH, res.clone());
    return res;
  } catch {
    // ?n=<note> and the like all open the same shell; the workspace reads the query itself.
    const hit = await cache.match(SHELL_PATH);
    return hit || offlinePage();
  }
}

async function staleWhileRevalidate(event, req) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req);
  const fresh = fetch(req)
    .then(async (res) => {
      if (cacheable(res)) await cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  if (hit) {
    event.waitUntil(fresh);
    return hit;
  }
  return (await fresh) || Response.error();
}

/** Shown when the vault was never opened on this device and there is no connection. */
function offlinePage() {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline · Nexus</title>
<style>
:root{color-scheme:light dark;--frame:#f1f4f7;--sheet:#fff;--fg:#02070a;--muted:#36424c;--link:#01669a;--focus:#01669a;--border:#dce3e9}
@media (prefers-color-scheme:dark){:root{--frame:#02070a;--sheet:#0a1219;--fg:#e6edf2;--muted:#a6b4bf;--link:#36aeeb;--focus:#0297de;--border:#1a2731}}
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:16px;background:var(--frame);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:28rem;background:var(--sheet);border:1px solid var(--border);border-radius:14px;padding:24px}
h1{font-size:20px;line-height:1.3;margin:0 0 8px}p{margin:0 0 16px;color:var(--muted)}
a{color:var(--link);text-underline-offset:3px}a:focus-visible{outline:2px solid var(--focus);outline-offset:2px;border-radius:2px}
</style></head><body><main><h1>You’re offline</h1><p>This vault hasn’t been opened on this device yet, so there is nothing saved here to show. Connect to the internet, then open it once to keep it for offline use.</p><a href="${SHELL_PATH}">Try again</a></main></body></html>`;
  return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
