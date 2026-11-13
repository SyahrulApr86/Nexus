/**
 * Service worker registration and its "Update available" signal. The worker is registered from
 * the root layout on every page; the workspace listens for updates and offers a reload, so a new
 * version only takes over when the user says so.
 */

type Apply = () => void;
let pending: Apply | null = null;
const listeners = new Set<(apply: Apply) => void>();

/** Called with `apply` when a new version waits. Fires at once if one is already waiting. */
export function onServiceWorkerUpdate(fn: (apply: Apply) => void) {
  listeners.add(fn);
  if (pending) fn(pending);
  return () => void listeners.delete(fn);
}

function announce(reg: ServiceWorkerRegistration) {
  pending = () => {
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
    reg.waiting?.postMessage({ type: "skip-waiting" });
  };
  listeners.forEach((fn) => fn(pending!));
}

// Production always; `next dev` only when asked, since its unhashed chunks change on every edit.
const enabled = process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_NEXUS_SW_DEV === "true";

export async function registerServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (!enabled) {
    // A worker left over from an earlier build would keep serving old chunks.
    const regs = await navigator.serviceWorker.getRegistrations().catch(() => []);
    await Promise.all(regs.filter((r) => r.active?.scriptURL.endsWith("/sw.js")).map((r) => r.unregister()));
    return;
  }
  let reg: ServiceWorkerRegistration;
  try {
    reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  } catch {
    return;
  }
  // Only an update (a worker already controls this page) waits for the user.
  if (reg.waiting && navigator.serviceWorker.controller) announce(reg);
  reg.addEventListener("updatefound", () => {
    const next = reg.installing;
    next?.addEventListener("statechange", () => {
      if (next.state === "installed" && navigator.serviceWorker.controller) announce(reg);
    });
  });
  // This page loaded before the worker could see it: hand over what it fetched, and the vault page.
  await warmServiceWorker();
}

/** Ask the worker to cache what this page loaded (and the vault page): after install, or after its caches were cleared. */
export async function warmServiceWorker() {
  if (!enabled || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const active = (await navigator.serviceWorker.ready).active;
  const urls = performance
    .getEntriesByType("resource")
    .map((e) => e.name)
    .filter((u) => u.startsWith(`${location.origin}/_next/static/`));
  active?.postMessage({ type: "warm", urls, shell: location.pathname === "/vault" });
}
