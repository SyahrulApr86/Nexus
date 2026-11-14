"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { ApiError } from "../api";
import { useWorkspaceActions } from "../store";
import { Bar, IconButton, Modal } from "../ui";
import { historyApi, type NoteNow, type Revision, type RevisionSummary } from "./api";
import { expandGap, rowsOf, sideBySide, stats, type Row, type Segment, type SideRow } from "./diff";

/*
 * Version history: the note's saved versions on the left, the changes from the chosen one to the
 * note as it is now on the right, side by side or inline, with word-level marks inside edited
 * lines. Restore the whole version, or a single change from its own header. Changes are
 * focusable groups: Up and Down (or J and K) move between them, Tab reaches each one's button.
 */

type Target = { id: string; name: string };
let target: Target | null = null;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const setTarget = (t: Target | null) => {
  target = t;
  listeners.forEach((fn) => fn());
};

/** Opens version history for a note (from the note's more menu or the command palette). */
export const openHistory = (note: Target) => setTarget({ id: note.id, name: note.name });

export function HistoryHost() {
  const t = useSyncExternalStore(subscribe, () => target, () => null);
  if (!t) return null;
  return <HistoryDialog key={t.id} note={t} onClose={() => setTarget(null)} />;
}

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });
const formatDate = (iso: string) => dateFormat.format(new Date(iso));
const REASON: Record<RevisionSummary["reason"], string> = {
  autosave: "Edited",
  rename: "Before rename",
  restore: "Before restore",
  import: "Before import",
};
const sizeOf = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`);
const errorText = (e: unknown) => (e instanceof ApiError ? e.message : "That didn’t work. Try again.");

const VIEW_KEY = "nexus:history-view";
type ViewMode = "split" | "inline";
const readView = (): ViewMode => {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "inline" ? "inline" : "split";
  } catch {
    return "split";
  }
};

/** Two columns need the room: below 768px the diff is always inline. */
const WIDE = "(min-width: 768px)";
const subscribeWide = (fn: () => void) => {
  const m = window.matchMedia(WIDE);
  m.addEventListener("change", fn);
  return () => m.removeEventListener("change", fn);
};
const useWide = () => useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => true);

type Block = { kind: "rows"; rows: Row[] } | { kind: "hunk"; index: number; rows: Row[] };

/** Rows grouped so each change can be one focusable block. */
function blocksOf(rows: Row[]): Block[] {
  const out: Block[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (r.kind === "del" || r.kind === "add") {
      if (last?.kind === "hunk" && last.index === r.hunk) last.rows.push(r);
      else out.push({ kind: "hunk", index: r.hunk, rows: [r] });
    } else if (last?.kind === "rows") last.rows.push(r);
    else out.push({ kind: "rows", rows: [r] });
  }
  return out;
}

function HistoryDialog({ note, onClose }: { note: Target; onClose: () => void }) {
  const actions = useWorkspaceActions();
  const id = useId();
  const [list, setList] = useState<RevisionSummary[] | null>(null);
  const [current, setCurrent] = useState<NoteNow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<Record<string, Revision>>({});
  const [revError, setRevError] = useState<string | null>(null);
  const [chosenView, setViewState] = useState<ViewMode>(readView);
  const view: ViewMode = useWide() ? chosenView : "inline";
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [busy, setBusy] = useState<number | "all" | null>(null);
  const [status, setStatus] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const diffRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const setView = (v: ViewMode) => {
    setViewState(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };

  const load = useCallback(async () => {
    // Unsaved typing first, so "now" is what the editor shows.
    await actions.flush(note.id).catch(() => {});
    const [l, c] = await Promise.all([historyApi.list(note.id), historyApi.current(note.id)]);
    return { l, c: { id: c.id, content: c.content, updatedAt: c.updatedAt } };
  }, [actions, note.id]);

  useEffect(() => {
    let live = true;
    load().then(
      ({ l, c }) => {
        if (!live) return;
        setList(l);
        setCurrent(c);
        setSelected((s) => s ?? l[0]?.id ?? null);
      },
      (e: unknown) => live && setLoadError(errorText(e)),
    );
    return () => {
      live = false;
    };
  }, [load]);

  // Once the versions arrive, focus moves from the close button to the chosen version (the
  // list beside the diff, or the select on a phone), unless the reader has moved on already.
  const focused = useRef(false);
  useEffect(() => {
    if (!list?.length || focused.current) return;
    focused.current = true;
    requestAnimationFrame(() => {
      const a = document.activeElement;
      if (a && !a.matches('[aria-label="Close version history"]')) return;
      const item = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
      if (item && item.offsetParent) item.focus();
      else document.getElementById(`${id}-pick`)?.focus();
    });
  }, [list, id]);

  const revision = selected ? revisions[selected] : undefined;
  useEffect(() => {
    if (!selected || revisions[selected]) return;
    let live = true;
    historyApi.get(note.id, selected).then(
      (r) => {
        if (!live) return;
        setRevisions((m) => ({ ...m, [r.id]: r }));
        setRevError(null);
      },
      (e: unknown) => live && setRevError(errorText(e)),
    );
    return () => {
      live = false;
    };
  }, [note.id, selected, revisions]);

  const rows = useMemo(() => (revision && current ? rowsOf(revision.content, current.content) : null), [revision, current]);
  const shownRows = useMemo(() => {
    if (!rows || !revision || !current) return null;
    return rows.flatMap((r) => (r.kind === "gap" && expanded.has(r.from) ? expandGap(revision.content, current.content, r) : [r]));
  }, [rows, expanded, revision, current]);
  const blocks = useMemo(() => (shownRows ? blocksOf(shownRows) : []), [shownRows]);
  const totals = useMemo(() => (rows ? stats(rows) : null), [rows]);
  const summary = list?.find((r) => r.id === selected);

  const select = (rid: string) => {
    setSelected(rid);
    setExpanded(new Set());
    setActionError(null);
  };

  const refresh = async () => {
    const { l, c } = await load();
    setList(l);
    setCurrent(c);
  };

  const restore = async (hunk: number | null) => {
    if (!selected || !current || !summary || busy !== null) return;
    setBusy(hunk ?? "all");
    setActionError(null);
    try {
      await historyApi.restore(note.id, selected, { baseUpdatedAt: current.updatedAt, ...(hunk === null ? {} : { hunks: [hunk] }) });
      void actions.loadNote(note.id);
      if (hunk === null) {
        actions.notify(`Restored “${note.name}” to the version from ${formatDate(summary.createdAt)}`);
        onClose();
        return;
      }
      await refresh();
      setStatus(`Change ${hunk + 1} restored. The text it replaced is kept as a version.`);
      // Keep the reader where they were: the change that now sits at this position, or the last one.
      requestAnimationFrame(() => {
        const hunks = diffRef.current?.querySelectorAll<HTMLElement>("[data-hunk]");
        const next = hunks?.[Math.min(hunk, (hunks?.length ?? 1) - 1)];
        (next ?? diffRef.current)?.focus();
      });
    } catch (e) {
      setActionError(errorText(e));
      if (e instanceof ApiError && e.status === 409) await refresh().catch(() => {});
    } finally {
      setBusy(null);
    }
  };

  /* Keyboard: Up/Down or J/K between changes, from a change or the diff itself. */
  const moveHunk = (dir: 1 | -1, from?: Element | null) => {
    const hunks = [...(diffRef.current?.querySelectorAll<HTMLElement>("[data-hunk]") ?? [])];
    if (!hunks.length) return;
    const at = hunks.findIndex((h) => h === from || h.contains(from ?? null));
    const next = at < 0 ? (dir > 0 ? 0 : hunks.length - 1) : Math.max(0, Math.min(hunks.length - 1, at + dir));
    hunks[next].focus();
    hunks[next].scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  const onDiffKey = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target as HTMLElement;
    if (t.tagName === "BUTTON" && (e.key === "j" || e.key === "k")) return;
    const dir = e.key === "ArrowDown" || e.key === "j" ? 1 : e.key === "ArrowUp" || e.key === "k" ? -1 : 0;
    if (!dir || !(t === diffRef.current || t.hasAttribute("data-hunk"))) return;
    e.preventDefault();
    moveHunk(dir, t === diffRef.current ? null : t);
  };

  /* Versions list: a listbox, selection follows focus. */
  const onListKey = (e: KeyboardEvent) => {
    if (!list?.length) return;
    const i = list.findIndex((r) => r.id === selected);
    const to =
      e.key === "ArrowDown" ? Math.min(list.length - 1, i + 1) : e.key === "ArrowUp" ? Math.max(0, i - 1) : e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    select(list[to].id);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-rid="${list[to].id}"]`)?.focus());
  };

  const titleId = `${id}-title`;
  const same = !!rows && totals?.changes === 0;
  const hunkCount = totals?.changes ?? 0;

  return (
    <Modal label={`Version history of ${note.name}`} onClose={onClose} className="max-w-6xl">
      <div className="float-panel flex h-[calc(100dvh-24px)] flex-col overflow-hidden md:h-[min(86dvh,880px)]">
        <div className="flex shrink-0 items-start gap-3 border-b border-border px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[16px] font-medium leading-6">
              Version history
            </h2>
            <p className="truncate text-[13px] text-faint" translate="no">
              {note.name}
            </p>
          </div>
          <IconButton label="Close version history" className="-mr-2" onClick={onClose}>
            <X />
          </IconButton>
        </div>
        {loadError ? (
          <div className="p-5 text-[14px]">
            <p className="text-negative">{loadError}</p>
            <button type="button" className="mt-2 font-medium text-accent-ink hover:underline" onClick={() => location.reload()}>
              Reload the page
            </button>
          </div>
        ) : !list ? (
          <div className="space-y-3 p-5" aria-busy="true">
            <span className="sr-only">Loading versions…</span>
            <Bar w="40%" />
            <Bar w="70%" />
            <Bar w="55%" />
          </div>
        ) : list.length === 0 ? (
          <div className="max-w-prose p-5 text-[14px] leading-6 text-muted">
            <p className="font-medium text-fg">No earlier versions yet</p>
            <p className="mt-1">
              Nexus keeps a version when you come back to edit a note after five minutes, and before every import or restore. Versions
              are kept for 30 days.
            </p>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            {/* Versions: a select on a phone, a list beside the diff from tablet up. */}
            <div className="shrink-0 border-b border-border px-4 py-3 md:hidden">
              <label htmlFor={`${id}-pick`} className="mb-1.5 block text-[13px] font-medium text-muted">
                Compare with
              </label>
              <select
                id={`${id}-pick`}
                value={selected ?? ""}
                onChange={(e) => select(e.target.value)}
                className="h-11 w-full rounded-md border border-control bg-sheet px-2 text-[16px]"
              >
                {list.map((r) => (
                  <option key={r.id} value={r.id}>
                    {formatDate(r.createdAt)} · {REASON[r.reason]}
                  </option>
                ))}
              </select>
            </div>
            <ul
              ref={listRef}
              role="listbox"
              aria-label="Versions"
              onKeyDown={onListKey}
              className="hidden w-[272px] shrink-0 overflow-y-auto overscroll-contain border-r border-border bg-frame py-1.5 md:block"
            >
              {list.map((r) => {
                const on = r.id === selected;
                return (
                  <li
                    key={r.id}
                    role="option"
                    aria-selected={on}
                    data-rid={r.id}
                    tabIndex={on ? 0 : -1}
                    onClick={() => select(r.id)}
                    className="mx-1.5 cursor-pointer rounded-md px-3 py-2 outline-offset-[-2px] hover:bg-hover aria-selected:bg-active aria-selected:shadow-[inset_1px_0_0_var(--accent-line)]"
                  >
                    <span className="block text-[13px] font-medium tabular">{formatDate(r.createdAt)}</span>
                    <span className="block text-[12px] text-faint tabular">
                      {REASON[r.reason]} · {sizeOf(r.size)}
                    </span>
                    {r.preview && <span className="mt-1 line-clamp-2 block text-[12px] leading-4 text-muted">{r.preview}</span>}
                  </li>
                );
              })}
            </ul>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2.5 md:px-5">
                <p className="min-w-0 text-[13px] text-muted">
                  {summary && (
                    <>
                      From <span className="font-medium text-fg tabular">{formatDate(summary.createdAt)}</span> to now
                    </>
                  )}
                  {totals && !same && (
                    <span className="tabular">
                      {" · "}
                      {hunkCount === 1 ? "1 change" : `${hunkCount} changes`}, <span className="diff-count-add">{totals.added} added</span>,{" "}
                      <span className="diff-count-del">{totals.removed} removed</span>
                    </span>
                  )}
                </p>
                <div className="ml-auto flex items-center gap-2">
                  {hunkCount > 1 && (
                    <div className="flex items-center">
                      <IconButton label="Previous change" shortcut="K" onClick={() => moveHunk(-1, document.activeElement)}>
                        <ChevronUp />
                      </IconButton>
                      <IconButton label="Next change" shortcut="J" onClick={() => moveHunk(1, document.activeElement)}>
                        <ChevronDown />
                      </IconButton>
                    </div>
                  )}
                  <fieldset className="hidden h-8 items-stretch rounded-md border border-control p-0.5 md:flex">
                    <legend className="sr-only">Diff layout</legend>
                    {(
                      [
                        ["split", "Side by side"],
                        ["inline", "Inline"],
                      ] as const
                    ).map(([v, label]) => (
                      <label
                        key={v}
                        className="grid cursor-pointer place-items-center rounded-[4px] px-2.5 text-[12px] font-medium text-muted transition-colors hover:text-fg has-checked:bg-active has-checked:text-fg has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-[var(--focus)]"
                      >
                        <input type="radio" name={`${id}-view`} value={v} checked={view === v} onChange={() => setView(v)} className="sr-only" />
                        {label}
                      </label>
                    ))}
                  </fieldset>
                  <button
                    type="button"
                    onClick={() => void restore(null)}
                    disabled={!revision || same}
                    aria-disabled={busy !== null || undefined}
                    className="h-8 rounded-lg bg-accent px-3.5 text-[13px] font-medium text-navy transition-colors hover:brightness-95 disabled:opacity-50 pointer-coarse:h-11"
                  >
                    {busy === "all" ? "Restoring…" : "Restore this version"}
                  </button>
                </div>
              </div>
              <p role="status" className="sr-only">
                {status}
              </p>
              {actionError && (
                <p role="alert" className="shrink-0 border-b border-border px-5 py-2 text-[13px] text-negative">
                  {actionError}
                </p>
              )}
              <div
                ref={diffRef}
                tabIndex={0}
                role="region"
                aria-label="Changes"
                aria-describedby={hunkCount ? `${id}-keys` : undefined}
                onKeyDown={onDiffKey}
                className="diff min-h-0 flex-1 overflow-auto overscroll-contain outline-offset-[-2px]"
              >
                {revError ? (
                  <p className="p-5 text-[14px] text-negative">{revError}</p>
                ) : !shownRows ? (
                  <div className="space-y-3 p-5" aria-busy="true">
                    <Bar w="60%" />
                    <Bar w="80%" />
                  </div>
                ) : same ? (
                  <p className="p-5 text-[14px] text-muted">This version matches the note as it is now.</p>
                ) : (
                  <div className="pb-6">
                    {blocks.map((b, bi) =>
                      b.kind === "rows" ? (
                        <Rows
                          key={`r${bi}`}
                          rows={b.rows}
                          view={view}
                          onExpand={(from) => setExpanded((s) => new Set(s).add(from))}
                        />
                      ) : (
                        <section
                          key={`h${b.index}`}
                          data-hunk={b.index}
                          tabIndex={-1}
                          aria-label={hunkLabel(b, hunkCount)}
                          className="diff-hunk border-y border-rule outline-offset-[-2px]"
                        >
                          <div className="flex h-8 items-center gap-3 bg-frame px-4 text-[12px] text-faint md:px-5">
                            <span className="tabular">
                              Change {b.index + 1} of {hunkCount}
                            </span>
                            <button
                              type="button"
                              onClick={() => void restore(b.index)}
                              aria-disabled={busy !== null || undefined}
                              aria-label={`Restore change ${b.index + 1}`}
                              className="ml-auto rounded-sm font-medium text-accent-ink hover:underline pointer-coarse:py-3"
                            >
                              {busy === b.index ? "Restoring…" : "Restore this change"}
                            </button>
                          </div>
                          <Rows rows={b.rows} view={view} />
                        </section>
                      ),
                    )}
                  </div>
                )}
              </div>
              {hunkCount > 0 && (
                <p id={`${id}-keys`} className="hidden shrink-0 border-t border-border bg-frame px-5 py-2 text-[12px] text-faint md:block">
                  Up and Down arrows, or J and K, move between changes. Tab reaches each change’s restore button.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function hunkLabel(b: Extract<Block, { kind: "hunk" }>, total: number) {
  const del = b.rows.filter((r) => r.kind === "del").length;
  const add = b.rows.filter((r) => r.kind === "add").length;
  const parts = [del && `${del} ${del === 1 ? "line" : "lines"} removed`, add && `${add} ${add === 1 ? "line" : "lines"} added`].filter(Boolean);
  return `Change ${b.index + 1} of ${total}: ${parts.join(", ")}`;
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

function Rows({ rows, view, onExpand }: { rows: Row[]; view: ViewMode; onExpand?: (from: number) => void }) {
  if (view === "split") {
    return (
      <div className="diff-split">
        {sideBySide(rows).map((r, i) => (
          <SplitRow key={i} row={r} onExpand={onExpand} />
        ))}
      </div>
    );
  }
  return (
    <div className="diff-inline">
      {rows.map((r, i) =>
        r.kind === "gap" ? (
          <Gap key={i} row={r} onExpand={onExpand} />
        ) : r.kind === "same" ? (
          <div key={i} className="diff-row">
            <Num n={r.oldNo} />
            <Num n={r.newNo} />
            <span className="diff-sign" aria-hidden="true" />
            <Text>{r.text}</Text>
          </div>
        ) : (
          <div key={i} className={`diff-row ${r.kind === "del" ? "diff-del" : "diff-add"}`}>
            <Num n={r.kind === "del" ? r.oldNo : null} />
            <Num n={r.kind === "add" ? r.newNo : null} />
            <Sign kind={r.kind} />
            <Text>
              <Segments kind={r.kind} segments={r.segments} />
            </Text>
          </div>
        ),
      )}
    </div>
  );
}

function SplitRow({ row, onExpand }: { row: SideRow; onExpand?: (from: number) => void }) {
  if (row.kind === "gap") return <Gap row={row} onExpand={onExpand} />;
  if (row.kind === "same")
    return (
      <div className="diff-pair">
        <div className="diff-row">
          <Num n={row.oldNo} />
          <span className="diff-sign" aria-hidden="true" />
          <Text>{row.text}</Text>
        </div>
        <div className="diff-row">
          <Num n={row.newNo} />
          <span className="diff-sign" aria-hidden="true" />
          <Text>{row.text}</Text>
        </div>
      </div>
    );
  return (
    <div className="diff-pair">
      {row.left ? (
        <div className="diff-row diff-del">
          <Num n={row.left.oldNo} />
          <Sign kind="del" />
          <Text>
            <Segments kind="del" segments={row.left.segments} />
          </Text>
        </div>
      ) : (
        <div className="diff-row diff-none" aria-hidden="true" />
      )}
      {row.right ? (
        <div className="diff-row diff-add">
          <Num n={row.right.newNo} />
          <Sign kind="add" />
          <Text>
            <Segments kind="add" segments={row.right.segments} />
          </Text>
        </div>
      ) : (
        <div className="diff-row diff-none" aria-hidden="true" />
      )}
    </div>
  );
}

function Gap({ row, onExpand }: { row: Extract<Row, { kind: "gap" }>; onExpand?: (from: number) => void }) {
  return (
    <div className="diff-gap">
      <button type="button" onClick={() => onExpand?.(row.from)} className="rounded-sm font-medium text-accent-ink hover:underline">
        Show {row.count} unchanged {row.count === 1 ? "line" : "lines"}
      </button>
    </div>
  );
}

const Num = ({ n }: { n: number | null }) => (
  <span className="diff-num tabular" aria-hidden="true">
    {n ?? ""}
  </span>
);

const Sign = ({ kind }: { kind: "del" | "add" }) => (
  <span className="diff-sign">
    <span aria-hidden="true">{kind === "del" ? "−" : "+"}</span>
    <span className="sr-only">{kind === "del" ? "Removed: " : "Added: "}</span>
  </span>
);

const Text = ({ children }: { children: ReactNode }) => (
  <span className="diff-text" translate="no">
    {children}
  </span>
);

function Segments({ kind, segments }: { kind: "del" | "add"; segments: Segment[] }) {
  // A wholly changed line needs no word marks: the row's own tone says it.
  if (segments.length === 1 && segments[0].changed) return <>{segments[0].text || "​"}</>;
  const Mark = kind === "del" ? "del" : "ins";
  return (
    <>
      {segments.map((s, i) =>
        s.changed ? (
          <Mark key={i} className="diff-word">
            {s.text}
          </Mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}
