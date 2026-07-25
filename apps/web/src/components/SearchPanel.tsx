import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { SearchResultDto } from "@nexus/shared";
import { api } from "../api/client.js";

const DEBOUNCE_MS = 200;

/** FR-013/FR-014: debounced fuzzy search with keyboard-first combobox UI. */
export function SearchPanel() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [input]);

  const { data, isFetching } = useQuery({
    queryKey: ["search", query],
    enabled: query.length > 0,
    queryFn: () =>
      api<{ results: SearchResultDto[]; tooShort: boolean }>(
        `/search?q=${encodeURIComponent(query)}`,
      ),
    placeholderData: (prev) => prev, // keep list stable while typing
  });

  useEffect(() => {
    setActive(0);
  }, [data?.results]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const results = data?.results ?? [];
  const showPanel = open && query.length > 0;

  const openResult = (r: SearchResultDto) => {
    setOpen(false);
    setInput("");
    navigate({ to: "/notes/$noteId", params: { noteId: r.id } });
  };

  return (
    <div ref={rootRef} className="relative px-4 pb-2">
      <label htmlFor="vault-search" className="sr-only">
        Search notes
      </label>
      <input
        id="vault-search"
        type="search"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-activedescendant={
          showPanel && results[active] ? `${listId}-${active}` : undefined
        }
        autoComplete="off"
        placeholder="Search notes…"
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && results[active]) {
            e.preventDefault();
            openResult(results[active]!);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className="w-full rounded-control border border-border bg-card px-3 py-2 text-[14px] text-ink placeholder:text-muted"
      />
      {showPanel && (
        <div className="absolute left-4 right-4 z-20 mt-1 max-h-80 overflow-auto rounded-card border border-border bg-card shadow-lg">
          {data?.tooShort && (
            <p className="border-b border-border px-3 py-1.5 text-[12px] text-muted">
              Short query — keep typing for better ranking
            </p>
          )}
          <ul id={listId} role="listbox" aria-label="Search results">
            {results.map((r, i) => (
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events
              <li
                key={r.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onClick={() => openResult(r)}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer px-3 py-2 ${
                  i === active ? "bg-surface" : ""
                }`}
              >
                <span className="block truncate text-[14px] font-medium text-ink">
                  {r.title || "Untitled"}
                </span>
                <span className="block truncate text-[12px] text-muted">
                  {r.snippet || "(empty note)"}
                </span>
              </li>
            ))}
          </ul>
          {results.length === 0 && !isFetching && (
            <p className="px-3 py-3 text-[14px] text-muted">No notes found</p>
          )}
        </div>
      )}
    </div>
  );
}
