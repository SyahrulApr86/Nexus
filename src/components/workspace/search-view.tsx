"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { api, type SearchHit } from "./api";
import { shallowEqual, useWorkspaceActions, useWorkspaceSelector } from "./store";
import { Bar, CLEAR_BUTTON, nf, useShown } from "./ui";

/** `tag` is set when the whole query is one #tag, for the empty-result copy. */
type Result = { query: string; tag: string | null; hits: SearchHit[] };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Search across the vault. Every query goes to /api/search, which reads a bare #tag as tag:tag, so
 * a tag combines with words and operators (`#work line:todo`).
 */
export function SearchView() {
  const actions = useWorkspaceActions();
  // `version` moves on saves (not keystrokes): a saved edit can change the hits.
  const w = useWorkspaceSelector((s) => ({ searchQuery: s.searchQuery, version: s.version }), shallowEqual);
  const q = w.searchQuery;
  const [result, setResult] = useState<Result | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [attempt, setAttempt] = useState(0);
  const inputId = useId();
  const hintId = useId();
  const [rootRef, shown] = useShown<HTMLDivElement>();
  // The request last answered, so showing the view again does not search again for nothing.
  const done = useRef("");
  const want = `${q.trim()}\u0000${w.version}\u0000${attempt}`;

  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setResult(null); // eslint-disable-line react-hooks/set-state-in-effect -- clear when the query empties
      setStatus("idle");
      done.current = "";
      return;
    }
    // Hidden (collapsed sidebar, closed drawer): search once the view is on screen again.
    if (!shown || done.current === want) return;
    let live = true;
    const t = setTimeout(async () => {
      setStatus("loading");
      try {
        const tag = /^#[^\s#]+$/.test(query) ? query.slice(1) : null;
        const r: Result = { query, tag, hits: await api.search(query) };
        if (live) {
          done.current = want;
          // A background refresh after an autosave usually returns the same hits: keep the old object.
          setResult((prev) => (same(prev, r) ? prev : r));
          setStatus("idle");
        }
      } catch {
        if (live) {
          setResult(null);
          setStatus("error");
        }
      }
    }, 180);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // `want` covers q, the version and the retry count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [want, shown]);

  const count = result?.hits.length ?? 0;
  const summary = result
    ? count === 0
      ? result.tag !== null
        ? `No notes tagged #${result.tag}`
        : "No matches"
      : `${nf.format(count)} ${count === 1 ? "note" : "notes"}`
    : "";
  // One short, always-mounted announcement instead of a live results list.
  const announcement =
    status === "error" ? "Search failed." : result ? (count === 0 ? summary : `${summary} for “${result.query}”`) : "";

  return (
    <div ref={rootRef} className="flex h-full flex-col">
      <div className="px-3 pb-3 pt-3">
        <label htmlFor={inputId} className="sr-only">
          Search notes
        </label>
        <div className="flex h-8 items-center gap-2 rounded-md border border-control bg-sheet pl-2.5 pr-1 pointer-coarse:h-11 focus-within:outline focus-within:outline-2 focus-within:outline-[var(--focus)]">
          <Search aria-hidden="true" className="size-4 shrink-0 stroke-[1.5] text-faint" />
          <input
            id={inputId}
            type="search"
            value={q}
            autoFocus
            onChange={(e) => actions.setSearchQuery(e.target.value)}
            placeholder="Search…"
            aria-describedby={hintId}
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-faint md:text-[14px] [&::-webkit-search-cancel-button]:hidden"
          />
          {q && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                actions.setSearchQuery("");
                document.getElementById(inputId)?.focus();
              }}
              className={CLEAR_BUTTON}
            >
              <X aria-hidden="true" className="size-4 stroke-[1.5]" />
            </button>
          )}
        </div>
        <p id={hintId} className="mt-2 text-[12px] leading-5 text-faint">
          Narrow results with <Code>#tag</Code>, <Code>path:folder</Code> or <Code>line:word</Code>.
        </p>
      </div>

      <p role="status" className="sr-only">
        {announcement}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-6">
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
        {status === "error" && (
          <div className="px-2 py-2 text-[13px] text-muted">
            <p>Search failed. Check your connection.</p>
            <button
              type="button"
              className="mt-2 font-medium text-accent-ink hover:underline"
              onClick={() => {
                setStatus("loading");
                setAttempt((n) => n + 1);
              }}
            >
              Try again
            </button>
          </div>
        )}
        {result && <p className="px-2 pb-2 text-[12px] text-faint tabular">{summary}</p>}
        <ul>
          {result?.hits.map((h) => (
            <li key={h.id} className="border-b border-rule last:border-b-0">
              <button
                type="button"
                onClick={(e) => actions.open(h.id, e.ctrlKey || e.metaKey ? "tab" : "current")}
                className="block w-full rounded-md px-2 py-2.5 text-left transition-colors hover:bg-hover"
              >
                <span className="block truncate text-[13px] font-medium text-fg" translate="no">
                  {h.name}
                </span>
                {h.path.includes("/") && (
                  <span className="block truncate text-[12px] text-faint" translate="no">
                    {h.path.slice(0, h.path.lastIndexOf("/"))}
                  </span>
                )}
                {/* Tag and other operator-only queries come back without a snippet. */}
                {h.snippet && <Snippet text={h.snippet} />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Code({ children }: { children: string }) {
  return (
    <kbd className="kbd" translate="no">
      {children}
    </kbd>
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
