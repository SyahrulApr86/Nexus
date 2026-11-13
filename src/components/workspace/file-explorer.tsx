"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDownUp, ChevronRight, ChevronsDownUp, FilePen, FolderPlus } from "lucide-react";
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

export function FileExplorer() {
  const w = useWorkspace();
  const { actions } = w;
  const expanded = useMemo(() => new Set(w.prefs.expanded), [w.prefs.expanded]);
  const root = useMemo(() => buildTree(w.tree.notes, w.tree.folders), [w.tree]);
  const rows = useMemo(() => flatten(root, expanded, w.prefs.sort), [root, expanded, w.prefs.sort]);
  const activeId = w.focusView.type === "note" ? w.focusView.id : null;
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const menu = useMenu();
  const [menuItems, setMenuItems] = useState<{ label: string; items: MenuItem[] }>({ label: "", items: [] });
  const sortMenu = useMenu();
  const listRef = useRef<HTMLDivElement>(null);

  const tabbable = focusKey && rows.some((r) => r.key === focusKey) ? focusKey : (activeId ?? rows[0]?.key ?? null);

  const toggle = (path: string, open?: boolean) =>
    actions.setExpanded((s) => {
      if (open ?? !s.has(path)) s.add(path);
      else s.delete(path);
      return s;
    });

  const focusRow = (key: string) => {
    setFocusKey(key);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus());
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
        { label: "Move to…", onSelect: () => actions.renameNote(n) },
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

  // APG tree keyboard model.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>, row: Row, i: number) => {
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
      openMenu(row, e.currentTarget);
    }
  };

  const dropProps = (folder: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("application/x-nexus-note")) return;
      e.preventDefault();
      setDropTarget(folder);
    },
    onDragLeave: () => setDropTarget((t) => (t === folder ? null : t)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropTarget(null);
      const id = e.dataTransfer.getData("application/x-nexus-note");
      if (id) actions.moveNote(id, folder);
    },
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center justify-center gap-0.5 px-2" role="toolbar" aria-label="File explorer">
        <IconButton label="New note" shortcut="Alt+N" onClick={() => actions.newNote("")}>
          <FilePen />
        </IconButton>
        <IconButton label="New folder" onClick={() => actions.newFolder("")}>
          <FolderPlus />
        </IconButton>
        <IconButton label="Change sort order" aria-haspopup="menu" onClick={(e) => sortMenu.openBelow(e.currentTarget)}>
          <ArrowDownUp />
        </IconButton>
        <IconButton label="Collapse all" onClick={() => actions.setExpanded(() => new Set())} disabled={!w.prefs.expanded.length}>
          <ChevronsDownUp />
        </IconButton>
      </div>

      <div
        ref={listRef}
        role="tree"
        aria-label="Notes and folders"
        className={`min-h-0 flex-1 overflow-y-auto px-2 pb-6 ${dropTarget === "" ? "bg-hover" : ""}`}
        {...dropProps("")}
      >
        {w.treeStatus === "loading" && (
          <div className="space-y-3 px-2 py-2" aria-label="Loading notes">
            {[72, 56, 88, 64, 48].map((x, i) => (
              <Bar key={i} w={`${x}%`} h={10} />
            ))}
          </div>
        )}
        {w.treeStatus === "error" && (
          <div className="px-2 py-3 text-[13px] text-muted">
            <p>Couldn’t load your notes.</p>
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
        {rows.map((row, i) => {
          const isActive = row.kind === "note" && row.note.id === activeId;
          const common = {
            "data-key": row.key,
            role: "treeitem",
            tabIndex: row.key === tabbable ? 0 : -1,
            "aria-level": row.depth + 1,
            onFocus: () => setFocusKey(row.key),
            onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => onKeyDown(e, row, i),
            onContextMenu: (e: React.MouseEvent) => openMenu(row, e),
            style: { paddingLeft: 8 + row.depth * 16 },
          } as const;
          if (row.kind === "dir")
            return (
              <div
                key={row.key}
                {...common}
                aria-expanded={row.open}
                aria-selected={false}
                onClick={() => {
                  setFocusKey(row.key);
                  toggle(row.path);
                }}
                {...dropProps(row.path)}
                className={`flex h-8 cursor-pointer select-none items-center gap-1 rounded-md pr-2 text-muted outline-offset-[-2px] transition-colors hover:bg-hover hover:text-fg md:h-7 ${
                  dropTarget === row.path ? "bg-active" : ""
                }`}
              >
                <ChevronRight
                  aria-hidden="true"
                  className={`size-4 shrink-0 stroke-[1.5] text-faint transition-transform duration-150 ${row.open ? "rotate-90" : ""}`}
                />
                <span className="truncate">{row.name}</span>
              </div>
            );
          return (
            <div
              key={row.key}
              {...common}
              aria-selected={isActive}
              aria-current={isActive ? "page" : undefined}
              draggable
              onDragStart={(e) => e.dataTransfer.setData("application/x-nexus-note", row.note.id)}
              onClick={(e) => {
                setFocusKey(row.key);
                actions.open(row.note.id, e.ctrlKey || e.metaKey ? "tab" : "current");
              }}
              onAuxClick={(e) => e.button === 1 && actions.open(row.note.id, "tab")}
              className={`flex h-8 cursor-pointer select-none items-center rounded-md pr-2 outline-offset-[-2px] transition-colors md:h-7 ${
                isActive ? "bg-active font-medium text-accent-ink" : "text-fg hover:bg-hover"
              }`}
            >
              <span className="truncate pl-5">{row.note.name}</span>
            </div>
          );
        })}
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
