import { ApiError, vaultHeaders } from "../api";

/* Version history requests (src/app/api/notes/[id]/history/**), with the active vault's header. */

export type RevisionReason = "autosave" | "rename" | "restore" | "import";
export type RevisionSummary = { id: string; createdAt: string; reason: RevisionReason; size: number; preview: string };
export type Revision = { id: string; createdAt: string; reason: RevisionReason; content: string };
export type NoteNow = { id: string; content: string; updatedAt: string };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...vaultHeaders() },
    });
  } catch {
    throw new ApiError("You appear to be offline. Check your connection and try again.", 0);
  }
  if (res.status === 401) throw new ApiError("Your session ended. Sign in again.", 401);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = (data as { error?: string }).error;
    const message =
      res.status === 409
        ? "The note changed since you opened its history."
        : res.status >= 500
          ? "Nexus couldn’t finish that. Try again in a moment."
          : error && error !== "conflict"
            ? error
            : "That didn’t work. Try again.";
    throw new ApiError(message, res.status, data);
  }
  return data as T;
}

const base = (noteId: string) => `/api/notes/${encodeURIComponent(noteId)}/history`;

export const historyApi = {
  list: (noteId: string) => call<RevisionSummary[]>(base(noteId)),
  get: (noteId: string, revisionId: string) => call<Revision>(`${base(noteId)}/${encodeURIComponent(revisionId)}`),
  /** The note as saved now: the right-hand side of every diff. */
  current: (noteId: string) => call<NoteNow & Record<string, unknown>>(`/api/notes/${encodeURIComponent(noteId)}`),
  /** Restore the whole revision, or only `hunks` (numbered against the note as of `baseUpdatedAt`). */
  restore: (noteId: string, revisionId: string, opts: { baseUpdatedAt: string; hunks?: number[] }) =>
    call<{ id: string; updatedAt: string }>(`${base(noteId)}/${encodeURIComponent(revisionId)}/restore`, {
      method: "POST",
      body: JSON.stringify(opts),
    }),
};
