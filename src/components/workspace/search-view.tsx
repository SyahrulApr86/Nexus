"use client";

import { useEffect, useId, useState } from "react";
import { Search, X } from "lucide-react";
import { api, type NoteRef, type SearchHit } from "./api";
import { useWorkspace } from "./store";
import { Bar } from "./ui";

type Result = { kind: "text"; hits: SearchHit[] } | { kind: "tag"; tag: string; hits: NoteRef[] };

/** Full-text search across the vault. A query starting with # lists the notes with that tag. */
export function SearchView() {
  const w = useWorkspace();
  const q = w.searchQuery;
  const [result, setResult] = useState<Result | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const inputId = useId();

  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setResult(null); // eslint-disable-line react-hooks/set-state-in-effect -- clear when the query empties
      setStatus("idle");
      return;
    }
    let live = true;
    const t = setTimeout(async () => {
      setStatus("loading");
      try {
        const r: Result = /^#\S+$/.test(query)
          ? { kind: "tag", tag: query.slice(1), hits: await api.byTag(query.slice(1)) }
          : { kind: "text", hits: await api.search(query) };
        if (live) {
          setResult(r);
          setStatus("idle");
        }
      } catch {
        if (live) setStatus("error");
      }
    }, 180);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, w.version]);

  const count = result?.hits.length ?? 0;

  return (
    <div className="flex h-full flex-col">
      <div className="px-3 pb-2 pt-1">
        <label htmlFor={inputId} className="sr-only">
          Search notes
        </label>
        <div className="flex h-9 items-center gap-2 rounded-lg border border-control bg-sheet px-2.5 focus-within:outline focus-within:outline-2 focus-within:outline-[var(--focus)]">
          <Search aria-hidden="true" className="size-4 shrink-0 stroke-[1.5] text-faint" />
          <input
            id={inputId}
            type="search"
            value={q}
            autoFocus
            onChange={(e) => w.actions.setSearchQuery(e.target.value)}
            placeholder="Search…"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-faint md:text-[14px] [&::-webkit-search-cancel-button]:hidden"
          />
          {q && (
            <button type="button" aria-label="Clear search" onClick={() => w.actions.setSearchQuery("")} className="rounded p-0.5 text-faint hover:text-fg">
              <X aria-hidden="true" className="size-4 stroke-[1.5]" />
            </button>
          )}
        </div>
        <p className="mt-2 text-[12px] leading-4 text-faint">
          Type <kbd className="kbd">#tag</kbd> to list notes with a tag.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6" aria-live="polite" aria-busy={status === "loading"}>
        {status === "loading" && !result && (
          <div className="space-y-4 px-2 py-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2">
                <Bar w="40%" h={12} />
                <Bar w="92%" h={10} />
              </div>
            ))}
          </div>
        )}
        {status === "error" && <p className="px-2 py-2 text-[13px] text-muted">Search failed. Check your connection and try again.</p>}
        {result && (
          <p className="px-2 pb-2 text-[12px] text-faint tabular">
            {count === 0
              ? result.kind === "tag"
                ? `No notes tagged #${result.tag}`
                : "No matches"
              : `${count} ${count === 1 ? "note" : "notes"}`}
          </p>
        )}
        <ul className="space-y-0.5">
          {result?.kind === "text" &&
            result.hits.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={(e) => w.actions.open(h.id, e.ctrlKey || e.metaKey ? "tab" : "current")}
                  className="block w-full rounded-md px-2 py-2 text-left transition-colors hover:bg-hover"
                >
                  <span className="block truncate font-medium">{h.name}</span>
                  {h.path.includes("/") && <span className="block truncate text-[12px] text-faint">{h.path.slice(0, h.path.lastIndexOf("/"))}</span>}
                  <Snippet text={h.snippet} />
                </button>
              </li>
            ))}
          {result?.kind === "tag" &&
            result.hits.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={(e) => w.actions.open(h.id, e.ctrlKey || e.metaKey ? "tab" : "current")}
                  className="block w-full truncate rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover"
                >
                  {h.name}
                </button>
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}

/** ts_headline wraps matches in << >>; render them as orange marks. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/<<|>>/);
  return (
    <span className="mt-1 line-clamp-3 block text-[13px] leading-5 text-muted">
      {parts.map((p, i) =>
        i % 2 ? (
          <mark key={i} className="rounded-sm bg-hl px-0.5 text-fg">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </span>
  );
}
