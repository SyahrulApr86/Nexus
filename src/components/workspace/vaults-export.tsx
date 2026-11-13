import { getActiveVault, vaultHeaders } from "./api";

/*
 * "Export vault as .zip" for the vault on screen. A plain navigation to /api/vault/export cannot
 * carry the X-Nexus-Vault header, so it would always download the default vault. The default vault
 * keeps that navigation (the browser streams the download); any other vault is fetched with its
 * header and saved from a blob.
 */

type Notify = (message: string, opts?: { tone?: "error" }) => number;

const EXPORT_URL = "/api/vault/export";
const FALLBACK_NAME = "nexus-vault.zip";

/** The file name from a Content-Disposition header, or a safe default. */
export function zipFileName(disposition: string | null) {
  const star = disposition?.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  let name: string | null = null;
  if (star) {
    try {
      name = decodeURIComponent(star[1].trim());
    } catch {
      name = null;
    }
  }
  name ??= disposition?.match(/filename\s*=\s*"([^"]*)"/i)?.[1] ?? disposition?.match(/filename\s*=\s*([^;\s]+)/i)?.[1] ?? null;
  // Only a bare file name: never a path.
  const base = name?.split(/[\\/]/).pop()?.trim();
  return base && base !== "." && base !== ".." ? base : FALLBACK_NAME;
}

function exportError(status: number, body: unknown) {
  const error = (body as { error?: unknown } | null)?.error;
  if (status === 401) return "Your session ended. Sign in again.";
  if (typeof error === "string" && error && status < 500) return error;
  if (status === 409) return "An export of this vault is already running.";
  if (status === 429) return "Too many exports. Try again later.";
  return "Couldn’t export the vault. Try again in a moment.";
}

let running = false;

/** Downloads the active vault as a .zip; problems are shown through `notify`. */
export async function exportActiveVault(notify: Notify) {
  if (!getActiveVault()) {
    window.location.assign(new URL(EXPORT_URL, window.location.origin));
    return;
  }
  if (running) return;
  running = true;
  try {
    let res: Response;
    try {
      res = await fetch(EXPORT_URL, { headers: vaultHeaders() });
    } catch {
      notify("You appear to be offline. Check your connection and try again.", { tone: "error" });
      return;
    }
    if (!res.ok) {
      const body: unknown = await res.json().catch(() => null);
      notify(exportError(res.status, body), { tone: "error" });
      return;
    }
    notify("Preparing your export…");
    let blob: Blob;
    try {
      blob = await res.blob();
    } catch {
      notify("The export was interrupted. Try again.", { tone: "error" });
      return;
    }
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = zipFileName(res.headers.get("Content-Disposition"));
      a.rel = "noopener";
      a.style.display = "none";
      document.body.append(a);
      a.click();
      a.remove();
    } finally {
      // Revoke after the click has handed the blob to the download.
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
  } finally {
    running = false;
  }
}
