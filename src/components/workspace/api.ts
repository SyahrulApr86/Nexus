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

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
    });
  } catch {
    throw new ApiError("You appear to be offline. Check your connection and try again.", 0);
  }
  // The caller decides what a 401 means: unsaved text must never be dropped by a redirect.
  if (res.status === 401) throw new ApiError("Your session ended. Sign in again.", 401);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? fallbackMessage(res.status), res.status, data);
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
};
