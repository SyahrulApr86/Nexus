import { Link } from "@tanstack/react-router";
import { useTagNotes } from "../api/tags.js";

/** FR-019: notes filtered by a selected tag (US7-S3). */
export function TagPage({ tagName }: { tagName: string }) {
  const { data: notes, isLoading } = useTagNotes(tagName);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-[24px] font-semibold tracking-heading">
          <span className="tag-chip mr-2 inline-block align-middle text-[16px]">
            #{tagName}
          </span>
          Tagged notes
        </h1>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        {isLoading ? (
          <p className="text-muted">Loading…</p>
        ) : !notes || notes.length === 0 ? (
          <p className="text-muted">No notes carry this tag.</p>
        ) : (
          <ul className="flex max-w-2xl flex-col gap-2">
            {notes.map((n) => (
              <li key={n.id}>
                <Link
                  to="/notes/$noteId"
                  params={{ noteId: n.id }}
                  className="block rounded-card border border-border bg-card px-4 py-3 hover:bg-surface"
                >
                  <span className="block truncate text-[15px] font-medium text-ink">
                    {n.title || "Untitled"}
                  </span>
                  <span className="text-[12px] text-muted">
                    Updated {new Date(n.updatedAt).toLocaleString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
