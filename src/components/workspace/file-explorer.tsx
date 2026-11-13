"use client";

import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDownUp, ChevronRight, ChevronsDownUp, EllipsisVertical, FilePen, FolderPlus } from "lucide-react";
import type { TreeNote } from "./api";
import { useWorkspace, type SortOrder } from "./store";
import { Bar, IconButton, Menu, useMenu, type MenuItem } from "./ui";

type Dir = { name: string; path: string; dirs: Map<string, Dir>; notes: TreeNote[] };
type Row =
  | { kind: "dir"; key: string; path: string; name: string; depth: number; parent: string | null; open: boolean }
  | { kind: "note"; key: string; note: TreeNote; depth: number; parent: string | null };

function buildTree(notes: TreeNote[], folders: string[]): Dir {
  const root: Dir = { name: "", path: "", dirs: new Map(), notes: [] };
  const ensure = (path: string): Dir => {
    if (!path) return root;
    let cur = root;
    let acc = "";
    for (const part of path.split("/")) {
      acc = acc ? `${acc}/${part}` : part;
      if (!cur.dirs.has(part)) cur.dirs.set(part, { name: part, path: acc, dirs: new Map(), notes: [] });
      cur = cur.dirs.get(part)!;
    }
    return cur;
  };
  folders.forEach(ensure);
  for (const n of notes) {
    const i = n.path.lastIndexOf("/");
    ensure(i === -1 ? "" : n.path.slice(0, i)).notes.push(n);
  }
  return root;
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { numeric: true });
const dirOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

function sortNotes(notes: TreeNote[], sort: SortOrder) {
  const s = [...notes];
  if (sort === "name-asc") s.sort(byName);
  if (sort === "name-desc") s.sort((a, b) => byName(b, a));
  if (sort === "modified-desc") s.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
  if (sort === "modified-asc") s.sort((a, b) => +new Date(a.updatedAt) - +new Date(b.updatedAt));
  return s;
}

/** Flatten the visible part of the tree in display order (folders first, like Obsidian). */
function flatten(root: Dir, expanded: Set<string>, sort: SortOrder): Row[] {
  const rows: Row[] = [];
  const walk = (dir: Dir, depth: number, parent: string | null) => {
    const dirs = [...dir.dirs.values()].sort(sort === "name-desc" ? (a, b) => byName(b, a) : byName);
    for (const d of dirs) {
      const open = expanded.has(d.path);
      rows.push({ kind: "dir", key: `d:${d.path}`, path: d.path, name: d.name, depth, parent, open });
      if (open) walk(d, depth + 1, `d:${d.path}`);
    }
    for (const n of sortNotes(dir.notes, sort)) rows.push({ kind: "note", key: n.id, note: n, depth, parent });
  };
  walk(root, 0, null);
  return rows;
}

const SORT_LABELS: Record<SortOrder, string> = {
  "name-asc": "File name (A to Z)",
  "name-desc": "File name (Z to A)",
  "modified-desc": "Modified time (new to old)",
  "modified-asc": "Modified time (old to new)",
};

/**
 * One tree row. Only primitive props, so typing in the editor (which re-renders
 * the explorer) does not reconcile every row. Events are handled on the tree.
 */
const TreeRow = memo(function TreeRow({
  rowKey,
  kind,
  name,
  depth,
  open,
  active,
  tabbable,
  dropTarget,
}: {
  rowKey: string;
  kind: "dir" | "note";
  name: string;
  depth: number;
  open: boolean;
  active: boolean;
  tabbable: boolean;
  dropTarget: boolean;
}) {
  const more = (
    <button
      type="button"
      tabIndex={-1}
      data-more=""
      aria-haspopup="menu"
      aria-label={`More options for ${name}`}
      className="ml-auto grid size-11 shrink-0 place-items-center rounded-md text-faint opacity-0 transition-opacity hover:bg-hover hover:text-fg group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100 md:size-7"
    >
      <EllipsisVertical aria-hidden="true" className="size-4 stroke-[1.5]" />
    </button>
  );
  const common = {
    "data-key": rowKey,
    "data-kind": kind,
    role: "treeitem",
    "aria-label": name,
    "aria-level": depth + 1,
    tabIndex: tabbable ? 0 : -1,
    style: { paddingLeft: 8 + depth * 16 },
  } as const;
  if (kind === "dir")
    return (
      <div
        {...common}
        aria-expanded={open}
        aria-selected={false}
        className={`group flex h-11 cursor-pointer select-none items-center gap-1 rounded-md text-muted outline-offset-[-2px] transition-colors hover:bg-hover hover:text-fg md:h-7 ${
          dropTarget ? "bg-active" : ""
        }`}
      >
        <ChevronRight
          aria-hidden="true"
          className={`size-4 shrink-0 stroke-[1.5] text-faint transition-transform duration-150 ${open ? "rotate-90" : ""}`}
        />
        <span className="truncate" translate="no">
          {name}
        </span>
        {more}
      </div>
    );
  return (
    <div
      {...common}
      aria-selected={active}
      aria-current={active ? "page" : undefined}
      draggable
      className={`group flex h-11 cursor-pointer select-none items-center rounded-md outline-offset-[-2px] transition-colors md:h-7 ${
        active ? "bg-active font-medium text-accent-ink" : "text-fg hover:bg-hover"
      }`}
    >
      <span className="truncate pl-5" translate="no">
        {name}
      </span>
      {more}
    </div>
  );
});

export function FileExplorer() {
  const w = useWorkspace();
  const { actions } = w;
  const expanded = useMemo(() => new Set(w.prefs.expanded), [w.prefs.expanded]);
  const root = useMemo(() => buildTree(w.tree.notes, w.tree.folders), [w.tree]);
  const rows = useMemo(() => flatten(root, expanded, w.prefs.sort), [root, expanded, w.prefs.sort]);
  const rowIndex = useMemo(() => new Map(rows.map((r, i) => [r.key, i])), [rows]);
  const activeId = w.focusView.type === "note" ? w.focusView.id : null;
  const activePath = activeId ? w.tree.notes.find((n) => n.id === activeId)?.path : undefined;
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const menu = useMenu();
  const [menuItems, setMenuItems] = useState<{ label: string; items: MenuItem[] }>({ label: "", items: [] });
  const sortMenu = useMenu();
  const listRef = useRef<HTMLDivElement>(null);

  const tabbable = focusKey && rowIndex.has(focusKey) ? focusKey : (activeId ?? rows[0]?.key ?? null);

  // Reveal the active note: expand its folders whenever it changes, then bring its row into view.
  useEffect(() => {
    if (!activePath) return;
    const parts = activePath.split("/").slice(0, -1);
    const ancestors = parts.map((_, i) => parts.slice(0, i + 1).join("/"));
    if (ancestors.some((a) => !w.prefs.expanded.includes(a)))
      actions.setExpanded((s) => {
        ancestors.forEach((a) => s.add(a));
        return s;
      });
    // Only when the active note (or its path) changes, not when the user collapses a folder later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activePath]);

  useEffect(() => {
    if (!activeId) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(activeId)}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeId, rows]);

  const toggle = (path: string, open?: boolean) =>
    actions.setExpanded((s) => {
      if (open ?? !s.has(path)) s.add(path);
      else s.delete(path);
      return s;
    });

  const rowEl = (key: string) => listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`) ?? null;

  const focusRow = (key: string) => {
    setFocusKey(key);
    requestAnimationFrame(() => rowEl(key)?.focus());
  };

  const moveItems = (n: TreeNote): MenuItem[] => {
    const here = dirOf(n.path);
    const folders = [...w.tree.folders].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return [{ path: "", label: "Vault root" }, ...folders.map((f) => ({ path: f, label: f }))].map((f) => ({
      label: f.label,
      checked: f.path === here,
      disabled: f.path === here,
      onSelect: () => actions.moveNote(n.id, f.path),
    }));
  };

  const itemsFor = (row: Row): { label: string; items: MenuItem[] } => {
    if (row.kind === "dir")
      return {
        label: `Folder ${row.name}`,
        items: [
          { label: "New note", onSelect: () => actions.newNote(row.path) },
          { label: "New folder", onSelect: () => actions.newFolder(row.path) },
          "separator",
          { label: "Rename…", shortcut: "F2", onSelect: () => actions.renameFolder(row.path) },
          { label: "Delete", danger: true, onSelect: () => actions.deleteFolder(row.path) },
        ],
      };
    const n = row.note;
    return {
      label: `Note ${n.name}`,
      items: [
        { label: "Open in new tab", onSelect: () => actions.open(n.id, "tab") },
        { label: "Open to the right", onSelect: () => actions.open(n.id, "split") },
        "separator",
        { label: "Rename…", shortcut: "F2", onSelect: () => actions.renameNote(n) },
        {
          label: "Move to…",
          // A second menu at the same row: pick the destination folder.
          onSelect: () => {
            const el = rowEl(row.key);
            if (!el) return;
            setMenuItems({ label: `Move ${n.name} to`, items: moveItems(n) });
            menu.openBelow(el);
          },
        },
        { label: "Copy path", onSelect: () => navigator.clipboard?.writeText(`${n.path}.md`).then(() => actions.notify("Path copied")) },
        "separator",
        { label: "Delete", danger: true, onSelect: () => actions.deleteNote(n) },
      ],
    };
  };

  const openMenu = (row: Row, at: { clientX: number; clientY: number; preventDefault: () => void } | Element) => {
    setMenuItems(itemsFor(row));
    if (at instanceof Element) menu.openBelow(at);
    else menu.openAt(at);
  };

  /** The row an event happened in, from the delegated handlers on the tree. */
  const rowAt = (target: EventTarget) => {
    const el = (target as Element).closest?.<HTMLElement>("[data-key]");
    const i = el ? rowIndex.get(el.dataset.key!) : undefined;
    return i === undefined || !el ? null : { row: rows[i], i, el };
  };

  // APG tree keyboard model.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const hit = rowAt(e.target);
    if (!hit || e.target !== hit.el) return;
    const { row, i } = hit;
    const k = e.key;
    if (k === "ArrowDown" && rows[i + 1]) return (e.preventDefault(), focusRow(rows[i + 1].key));
    if (k === "ArrowUp" && rows[i - 1]) return (e.preventDefault(), focusRow(rows[i - 1].key));
    if (k === "Home" && rows[0]) return (e.preventDefault(), focusRow(rows[0].key));
    if (k === "End" && rows.length) return (e.preventDefault(), focusRow(rows[rows.length - 1].key));
    if (k === "ArrowRight" && row.kind === "dir") {
      e.preventDefault();
      if (!row.open) toggle(row.path, true);
      else if (rows[i + 1]?.parent === row.key) focusRow(rows[i + 1].key);
      return;
    }
    if (k === "ArrowLeft") {
      e.preventDefault();
      if (row.kind === "dir" && row.open) toggle(row.path, false);
      else if (row.parent) focusRow(row.parent);
      return;
    }
    if (k === "Enter" || k === " ") {
      e.preventDefault();
      if (row.kind === "dir") toggle(row.path);
      else actions.open(row.note.id, e.ctrlKey || e.metaKey ? "tab" : "current");
      return;
    }
    if (k === "F2") {
      e.preventDefault();
      if (row.kind === "dir") actions.renameFolder(row.path);
      else actions.renameNote(row.note);
      return;
    }
    if (k === "Delete") {
      e.preventDefault();
      if (row.kind === "dir") actions.deleteFolder(row.path);
      else actions.deleteNote(row.note);
      return;
    }
    if ((k === "F10" && e.shiftKey) || k === "ContextMenu") {
      e.preventDefault();
      openMenu(row, hit.el);
    }
  };

  const onClick = (e: React.MouseEvent) => {
    const hit = rowAt(e.target);
    if (!hit) return;
    const { row } = hit;
    setFocusKey(row.key);
    const more = (e.target as Element).closest("[data-more]");
    if (more) return openMenu(row, more);
    if (row.kind === "dir") toggle(row.path);
    else actions.open(row.note.id, e.ctrlKey || e.metaKey ? "tab" : "current");
  };

  // Drag a note onto a folder row to move it there; anywhere else in the list moves it to the root.
  const folderAt = (target: EventTarget) => {
    const el = (target as Element).closest?.<HTMLElement>('[data-kind="dir"]');
    return el ? el.dataset.key!.slice(2) : "";
  };
  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("application/x-nexus-note")) return;
      e.preventDefault();
      setDropTarget(folderAt(e.target));
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDropTarget(null);
      const id = e.dataTransfer.getData("application/x-nexus-note");
      if (id) actions.moveNote(id, folderAt(e.target));
    },
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center justify-center gap-0.5 px-2 md:h-10" role="toolbar" aria-label="File explorer">
        <IconButton label="New note" shortcut="Alt+N" className="max-md:size-11" onClick={() => actions.newNote("")}>
          <FilePen />
        </IconButton>
        <IconButton label="New folder" className="max-md:size-11" onClick={() => actions.newFolder("")}>
          <FolderPlus />
        </IconButton>
        <IconButton label="Change sort order" aria-haspopup="menu" className="max-md:size-11" onClick={(e) => sortMenu.openBelow(e.currentTarget)}>
          <ArrowDownUp />
        </IconButton>
        <IconButton
          label="Collapse all"
          className="max-md:size-11"
          onClick={() => actions.setExpanded(() => new Set())}
          disabled={!w.prefs.expanded.length}
        >
          <ChevronsDownUp />
        </IconButton>
      </div>

      <div
        className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-6 ${dropTarget === "" ? "bg-hover" : ""}`}
        aria-busy={w.treeStatus === "loading" || undefined}
        {...dropProps}
      >
        {w.treeStatus === "loading" && (
          <div role="status" className="space-y-3 px-2 py-2">
            <span className="sr-only">Loading notes</span>
            {[72, 56, 88, 64, 48].map((x, i) => (
              <Bar key={i} w={`${x}%`} h={10} />
            ))}
          </div>
        )}
        {w.treeStatus === "error" && (
          <div className="px-2 py-3 text-[13px] text-muted">
            <p role="alert">Couldn’t load your notes.</p>
            <button type="button" className="mt-2 font-medium text-accent-ink hover:underline" onClick={() => actions.refreshTree().catch(() => {})}>
              Try again
            </button>
          </div>
        )}
        {w.treeStatus === "ready" && rows.length === 0 && (
          <div className="px-2 py-3 text-[13px] text-muted">
            <p>No notes yet.</p>
            <button type="button" className="mt-2 font-medium text-accent-ink hover:underline" onClick={() => actions.newNote("")}>
              Create your first note
            </button>
          </div>
        )}
        {rows.length > 0 && (
          <div
            ref={listRef}
            role="tree"
            aria-label="Notes and folders"
            onClick={onClick}
            onKeyDown={onKeyDown}
            onFocus={(e) => {
              const hit = rowAt(e.target);
              if (hit && e.target === hit.el) setFocusKey(hit.row.key);
            }}
            onContextMenu={(e) => {
              const hit = rowAt(e.target);
              if (hit) openMenu(hit.row, e);
            }}
            onAuxClick={(e) => {
              const hit = rowAt(e.target);
              if (e.button === 1 && hit?.row.kind === "note") actions.open(hit.row.note.id, "tab");
            }}
            onDragStart={(e) => {
              const hit = rowAt(e.target);
              if (hit?.row.kind === "note") e.dataTransfer.setData("application/x-nexus-note", hit.row.note.id);
            }}
          >
            {rows.map((row) => (
              <TreeRow
                key={row.key}
                rowKey={row.key}
                kind={row.kind}
                name={row.kind === "dir" ? row.name : row.note.name}
                depth={row.depth}
                open={row.kind === "dir" && row.open}
                active={row.kind === "note" && row.note.id === activeId}
                tabbable={row.key === tabbable}
                dropTarget={row.kind === "dir" && dropTarget === row.path}
              />
            ))}
          </div>
        )}
      </div>

      {menu.anchor && <Menu anchor={menu.anchor} label={menuItems.label} items={menuItems.items} onClose={menu.close} />}
      {sortMenu.anchor && (
        <Menu
          anchor={sortMenu.anchor}
          label="Sort order"
          onClose={sortMenu.close}
          items={(Object.keys(SORT_LABELS) as SortOrder[]).map((s) => ({
            label: SORT_LABELS[s],
            checked: w.prefs.sort === s,
            onSelect: () => actions.setSort(s),
          }))}
        />
      )}
    </div>
  );
}
