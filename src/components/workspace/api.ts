export type TreeNote = { id: string; path: string; name: string; updatedAt: string };
export type Tree = { notes: TreeNote[]; folders: string[] };
export type NoteRef = { id: string; path: string; name: string };
export type Backlink = NoteRef & { context: string | null };
export type Mention = NoteRef & { context: string };
export type FullNote = NoteRef & {
  content: string;
  frontmatter: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  backlinks: Backlink[];
};
export type SearchHit = NoteRef & { snippet: string };
export type TagCount = { tag: string; count: number };
export type GraphData = {
  nodes: (NoteRef & { tags: string[]; ghost: boolean })[];
  edges: { source: string; target: string }[];
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    /** The parsed JSON body of the failed response, if any (a 409 carries the server's note). */
    public data?: unknown,
  ) {
    super(message);
  }
}

/* ------------------------------------------------------------------ */
/* Active vault                                                        */
/* ------------------------------------------------------------------ */

/**
 * Request header naming the vault a call acts on. The same string as VAULT_HEADER in
 * src/lib/session.ts, duplicated because that module is server-only (it reads the database).
 */
export const VAULT_HEADER = "x-nexus-vault";
/** The URL parameter that carries the active vault, next to ?n= for the open note. */
export const VAULT_PARAM = "v";
const LAYOUT_KEY = "nexus-layout"; // the workspace layout (store.tsx); one saved copy per vault below
const LAYOUT_OWNER_KEY = "nexus-layout-vault";
const layoutKeyOf = (vaultId: string) => `nexus-layout@${vaultId}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The active vault id, or null for the user's default vault (the server picks it). */
let activeVault: string | null = null;
let userKey: string | null = null;

/** localStorage key of one user's active vault. The email is hashed, so it is not stored as a key. */
function storageKeyFor(user: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < user.length; i++) h = Math.imul(h ^ user.charCodeAt(i), 0x01000193);
  return `nexus-vault:${(h >>> 0).toString(36)}`;
}
function lsGet(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

/** Saves the current layout under `from` and puts `to`'s saved layout (or none) in its place. */
function swapLayout(from: string | null, to: string) {
  if (from === to) return;
  const current = lsGet(LAYOUT_KEY);
  if (from && current) lsSet(layoutKeyOf(from), current);
  lsSet(LAYOUT_KEY, lsGet(layoutKeyOf(to)));
  lsSet(LAYOUT_OWNER_KEY, to);
}

/**
 * Picks the active vault before the first request: ?v= in the URL wins (a bookmark or another
 * tab), then the vault this user last used on this device. Puts ?v= in the URL and the vault's
 * own saved layout in place. Runs once per page; later calls return the same answer.
 */
export function initActiveVault(user: string): string | null {
  if (typeof window === "undefined") return null;
  if (userKey) return activeVault;
  userKey = storageKeyFor(user);
  const fromUrl = new URLSearchParams(window.location.search).get(VAULT_PARAM);
  const stored = lsGet(userKey);
  const id = fromUrl && UUID.test(fromUrl) ? fromUrl : stored && UUID.test(stored) ? stored : null;
  activeVault = id;
  if (!id) return null;
  lsSet(userKey, id);
  const owner = lsGet(LAYOUT_OWNER_KEY);
  // A layout saved before vaults were tracked belongs to no vault yet: adopt it rather than drop it.
  if (!owner) lsSet(LAYOUT_OWNER_KEY, id);
  else if (owner !== id) swapLayout(owner, id);
  const url = new URL(window.location.href);
  if (url.searchParams.get(VAULT_PARAM) !== id) {
    url.searchParams.set(VAULT_PARAM, id);
    window.history.replaceState(window.history.state, "", url);
  }
  return id;
}

/** The vault requests act on: an id, or null for the default vault. */
export const getActiveVault = () => activeVault;

/** Headers that name the active vault, for a fetch that does not go through req() (keepalive saves). */
export function vaultHeaders(): Record<string, string> {
  return activeVault ? { [VAULT_HEADER]: activeVault } : {};
}

/**
 * Opens vault `to` in a fresh page: nothing of the previous vault (open notes, caches, pending
 * timers) survives a navigation. `from` is the vault on screen now (its id, also when it is the
 * default one), so its layout is kept for when the user comes back.
 */
export function goToVault(to: string, from: string | null) {
  swapLayout(from ?? lsGet(LAYOUT_OWNER_KEY), to);
  if (userKey) lsSet(userKey, to);
  const url = new URL("/vault", window.location.origin);
  url.searchParams.set(VAULT_PARAM, to);
  window.location.assign(url);
}

/** Drops the saved layout of a deleted vault. */
export function forgetVaultLayout(vaultId: string) {
  lsSet(layoutKeyOf(vaultId), null);
}

let recovering = false;
/** The active vault is gone (deleted elsewhere): fall back to the default vault in a fresh page. */
function recoverFromMissingVault() {
  if (recovering || typeof window === "undefined") return;
  recovering = true;
  if (userKey) lsSet(userKey, null);
  lsSet(LAYOUT_OWNER_KEY, null);
  lsSet(LAYOUT_KEY, null);
  const url = new URL("/vault", window.location.origin);
  window.location.replace(url);
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  const vault = activeVault;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        ...(vault ? { [VAULT_HEADER]: vault } : {}),
      },
    });
  } catch {
    throw new ApiError("You appear to be offline. Check your connection and try again.", 0);
  }
  // The caller decides what a 401 means: unsaved text must never be dropped by a redirect.
  if (res.status === 401) throw new ApiError("Your session ended. Sign in again.", 401);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = (data as { error?: string }).error;
    // The named vault no longer exists (or never was this user's): open the default one instead.
    if (res.status === 404 && vault && error === "Vault not found") recoverFromMissingVault();
    throw new ApiError(error ?? fallbackMessage(res.status), res.status, data);
  }
  return data as T;
}

function fallbackMessage(status: number) {
  if (status === 413) return "That upload is too large. Try a smaller file.";
  if (status >= 500) return "Nexus couldn’t finish that. Try again in a moment.";
  return "That didn’t work. Reload the page and try again.";
}

const json = (body: unknown) => JSON.stringify(body);

export type ImportPlan = { conflicts: string[]; total: number };
/** A 409 from a save: the note as the server has it now. */
export type ConflictNote = { id: string; content: string; updatedAt: string };

function importBody(files: File[]) {
  const fd = new FormData();
  files.forEach((f) => fd.append("file", f));
  return fd;
}

export type VaultSummary = { id: string; name: string; createdAt: string; isDefault: boolean; notes: number };
export type ShareLink = { id: string; noteId: string; createdAt: string; expiresAt: string | null };

export const api = {
  tree: () => req<Tree>("/api/notes"),
  get: (id: string) => req<FullNote>(`/api/notes/${id}`),
  create: (path: string, content = "") => req<NoteRef>("/api/notes", { method: "POST", body: json({ path, content }) }),
  /** `baseUpdatedAt`: the server version this text was based on. A newer one answers 409 with the server's note. */
  save: (id: string, content: string, baseUpdatedAt?: string) =>
    req<{ id: string; updatedAt: string }>(`/api/notes/${id}`, { method: "PATCH", body: json({ content, baseUpdatedAt }) }),
  rename: (id: string, path: string) =>
    req<NoteRef & { updatedLinks: number }>(`/api/notes/${id}`, { method: "PATCH", body: json({ path }) }),
  remove: (id: string) => req(`/api/notes/${id}`, { method: "DELETE" }),
  mentions: (id: string) => req<Mention[]>(`/api/notes/${id}/mentions`),
  linkMention: (id: string, sourceId: string) =>
    req(`/api/notes/${id}/mentions`, { method: "POST", body: json({ sourceId }) }),
  resolve: (target: string, create = false, content?: string) =>
    req<Partial<NoteRef> & { id: string | null; created?: boolean }>("/api/resolve", {
      method: "POST",
      body: json({ target, create, content }),
    }),
  search: (q: string) => req<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`),
  tags: () => req<TagCount[]>("/api/tags"),
  byTag: (tag: string) => req<NoteRef[]>(`/api/tags?tag=${encodeURIComponent(tag)}`),
  graph: () => req<GraphData>("/api/graph"),
  mkdir: (path: string) => req("/api/folders", { method: "POST", body: json({ path }) }),
  mvdir: (from: string, to: string) => req("/api/folders", { method: "PATCH", body: json({ from, to }) }),
  rmdir: (path: string) => req(`/api/folders?path=${encodeURIComponent(path)}`, { method: "DELETE" }),
  vault: () => req<{ id: string; name: string }>("/api/vault"),
  importFiles: (files: File[]) =>
    req<{ created: number; updated: number }>("/api/vault/import", { method: "POST", body: importBody(files) }),
  /** Dry run of an import: which existing note paths it would replace. Writes nothing. */
  importPlan: (files: File[]) =>
    req<Partial<ImportPlan> & Partial<{ created: number; updated: number }>>("/api/vault/import?dryRun=1", {
      method: "POST",
      body: importBody(files),
    }),
  vaults: () => req<VaultSummary[]>("/api/vaults"),
  createVault: (name: string) => req<VaultSummary>("/api/vaults", { method: "POST", body: json({ name }) }),
  renameVault: (id: string, name: string) => req<Pick<VaultSummary, "id" | "name" | "createdAt">>(`/api/vaults/${id}`, { method: "PATCH", body: json({ name }) }),
  /** `confirm`: the vault's exact name, as the user typed it. */
  deleteVault: (id: string, confirm: string) => req(`/api/vaults/${id}`, { method: "DELETE", body: json({ confirm }) }),
  shares: (noteId: string) => req<ShareLink[]>(`/api/notes/${noteId}/share`),
  /** The URL is in this answer only: the server keeps a hash of the token. */
  createShare: (noteId: string, expiresInDays: number | null) =>
    req<ShareLink & { url: string }>(`/api/notes/${noteId}/share`, { method: "POST", body: json({ expiresInDays }) }),
  revokeShare: (id: string) => req(`/api/shares/${id}`, { method: "DELETE" }),
};
