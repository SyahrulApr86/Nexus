import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTags } from "../api/tags.js";

/** FR-018: sidebar tag list with counts; click filters (FR-019). */
export function TagsSection() {
  const { data: tags } = useTags();
  const [open, setOpen] = useState(true);

  if (!tags || tags.length === 0) return null;

  return (
    <div className="border-t border-border px-2 py-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 rounded-control px-2 py-1 text-[12px] font-medium uppercase tracking-wide text-muted hover:text-ink"
      >
        <span aria-hidden="true" className="inline-block w-3">
          {open ? "▾" : "▸"}
        </span>
        Tags
      </button>
      {open && (
        <ul aria-label="Tags" className="mt-1 flex flex-col gap-0.5">
          {tags.map((t) => (
            <li key={t.name}>
              <Link
                to="/tags/$tagName"
                params={{ tagName: t.name }}
                className="flex items-center justify-between rounded-control px-2 py-1 text-[14px] text-ink hover:bg-card"
                activeProps={{ className: "bg-card font-medium" }}
              >
                <span className="truncate">#{t.name}</span>
                <span className="ml-2 shrink-0 text-[12px] text-muted">
                  {t.noteCount}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
