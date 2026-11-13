"use client";

import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDownUp, ChevronRight, ChevronsDownUp, EllipsisVertical, FilePen, FolderPlus } from "lucide-react";
import type { TreeNote } from "./api";
import { shallowEqual, useWorkspaceActions, useWorkspaceSelector, type SortOrder } from "./store";
import { Bar, IconButton, Menu, useMenu, type MenuItem } from "./ui";
// --- canvas track: .canvas files get their own icon and a "New canvas" command ---
import { LayoutDashboard } from "lucide-react";
import { canvasTitle, isCanvasPath } from "@/lib/canvas";
import { newCanvas } from "./canvas/create";
// --- end canvas track ---
/* attachments-ui: attachments listed with the notes */
import type { AttachmentKind } from "@/lib/markdown/attachments";
import { useAttachments } from "./attachments/context";
import { AttachmentIcon, attachmentMenu } from "./attachments/explorer";
import { ATTACHMENT_ROW, attachmentKind, attachmentRowPath, attachmentTreeRows, embedLink, filesOf, isAttachmentRow } from "./attachments/model";
/* end attachments-ui */

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

/** [width %, depth]: two folders, one of them open, then loose notes. */
const SKELETON_ROWS: [number, number][] = [
  [44, 0],
  [36, 0],
  [62, 1],
  [48, 1],
  [70, 0],
  [54, 0],
  [40, 0],
];

const SORT_LABELS: Record<SortOrder, string> = {
  "name-asc": "File name (A to Z)",
  "name-desc": "File name (Z to A)",
  "modified-desc": "Modified time (new to old)",
  "modified-asc": "Modified time (old to new)",
};

/**
 * One tree row. Only primitive props, so a change elsewhere in the explorer
 * (focus, drop target) does not reconcile every row. Events are handled on the tree.
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
  canvas = false,
  icon /* attachments-ui */,
}: {
  rowKey: string;
  kind: "dir" | "note";
  name: string;
  depth: number;
  open: boolean;
  active: boolean;
  tabbable: boolean;
  dropTarget: boolean;
  /** canvas track: the row is a .canvas file. */
  canvas?: boolean;
  /* attachments-ui: set on attachment rows */
  icon?: AttachmentKind;
}) {
  const more = (
    <button
      type="button"
      tabIndex={-1}
      data-more=""
      aria-haspopup="menu"
      aria-label={`More options for ${name}`}
      className="ml-auto grid size-11 shrink-0 place-items-center rounded-md text-faint opacity-0 transition-opacity hover:bg-hover hover:text-fg group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100 md:size-7 md:pointer-coarse:size-11"
    >
      <EllipsisVertical aria-hidden="true" className="size-4 stroke-[1.5]" />
    </button>
  );
  const common = {
    "data-key": rowKey,
    "data-kind": kind,
    role: "treeitem",
    "aria-label": canvas ? `${canvasTitle(name)}, canvas` : name, // canvas track
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
        className={`group flex h-11 cursor-pointer select-none items-center gap-1 rounded-md text-muted outline-offset-[-2px] transition-colors hover:bg-hover hover:text-fg md:h-7 md:pointer-coarse:h-11 ${
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
      className={`group flex h-11 cursor-pointer select-none items-center rounded-md outline-offset-[-2px] transition-colors md:h-7 md:pointer-coarse:h-11 ${
        active ? "bg-active font-medium text-accent-ink" : "text-fg hover:bg-hover"
      }`}
    >
      {/* --- canvas track --- */}
      {canvas ? (
        <>
          <LayoutDashboard aria-hidden="true" className="ml-0.5 mr-1.5 size-3.5 shrink-0 stroke-[1.5] text-faint" />
          <span className="truncate" translate="no">
            {canvasTitle(name)}
          </span>
        </>
      ) : (
        /* --- end canvas track --- */
        <>
          {icon && <AttachmentIcon kind={icon} /> /* attachments-ui */}
          <span className={`truncate ${icon ? "" : "pl-5"}`} translate="no">
            {name}
          </span>
        </>
      )}
      {more}
    </div>
  );
});

export function FileExplorer() {
  const actions = useWorkspaceActions();
  // Not the note text: typing does not re-render the explorer.
  const w = useWorkspaceSelector(
    (s) => ({ prefs: s.prefs, tree: s.tree, treeStatus: s.treeStatus, focusView: s.focusView }),
    shallowEqual,
  );
  const expanded = useMemo(() => new Set(w.prefs.expanded), [w.prefs.expanded]);
  /* attachments-ui: attachment rows sort and nest like notes; their keys start with ATTACHMENT_ROW */
  const att = useAttachments();
  const showAtt = !!att?.settings.show;
  const attItems = att?.items;
  const attRows = useMemo(() => (showAtt && attItems ? attachmentTreeRows(attItems) : []), [showAtt, attItems]);
  const attKinds = useMemo(() => new Map((attItems ?? []).map((a) => [a.path, attachmentKind(a.mime)])), [attItems]);
  /* end attachments-ui */
  const root = useMemo(() => buildTree(attRows.length ? [...w.tree.notes, ...attRows] : w.tree.notes, w.tree.folders), [w.tree, attRows]);
  const rows = useMemo(() => flatten(root, expanded, w.prefs.sort), [root, expanded, w.prefs.sort]);
  const rowIndex = useMemo(() => new Map(rows.map((r, i) => [r.key, i])), [rows]);
  const activeId = w.focusView.type === "note" ? w.focusView.id
    : w.focusView.type === "attachment" ? `${ATTACHMENT_ROW}${w.focusView.path}` /* attachments-ui */ : null;
  const activePath = activeId ? (w.tree.notes.find((n) => n.id === activeId)?.path ?? (isAttachmentRow(activeId) ? attachmentRowPath(activeId) : undefined)) : undefined;
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

  // Scroll the active row into view once per activation. `rows` stays in the deps so this runs again
  // after auto-expanded ancestors render, but expanding, collapsing or sorting later must not scroll.
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    if (!activeId || revealed.current === activeId) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(activeId)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "nearest" });
    revealed.current = activeId;
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

  // After a keyboard move, return focus to the moved note once it renders in its new folder.
  const pendingFocus = useRef<{ id: string; folder: string; until: number } | null>(null);
  useEffect(() => {
    const p = pendingFocus.current;
    if (!p) return;
    if (Date.now() > p.until) return void (pendingFocus.current = null);
    const note = w.tree.notes.find((n) => n.id === p.id);
    if (!note || dirOf(note.path) !== p.folder) return;
    pendingFocus.current = null;
    const a = document.activeElement;
    if (a && a !== document.body && !listRef.current?.contains(a)) return;
    focusRow(p.id);
    // focusRow is a plain helper recreated each render; only tree changes matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, w.tree.notes]);

  const moveItems = (n: TreeNote): MenuItem[] => {
    const here = dirOf(n.path);
    const folders = [...w.tree.folders].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return [{ path: "", label: "Vault root" }, ...folders.map((f) => ({ path: f, label: f }))].map((f) => ({
      label: f.label,
      checked: f.path === here,
      disabled: f.path === here,
      onSelect: () => {
        // Open the destination first so the moved row stays mounted and can take focus back.
        const parts = f.path ? f.path.split("/") : [];
        if (parts.length)
          actions.setExpanded((s) => {
            parts.forEach((_, i) => s.add(parts.slice(0, i + 1).join("/")));
            return s;
          });
        pendingFocus.current = { id: n.id, folder: f.path, until: Date.now() + 10000 };
        actions.moveNote(n.id, f.path);
      },
    }));
  };

  const itemsFor = (row: Row): { label: string; items: MenuItem[] } => {
    /* attachments-ui */
    if (row.kind === "note" && isAttachmentRow(row.note.id) && att) return attachmentMenu(att, attachmentRowPath(row.note.id));
    if (row.kind === "dir")
      return {
        label: `Folder ${row.name}`,
        items: [
          { label: "New note", onSelect: () => actions.newNote(row.path) },
          { label: "New folder", onSelect: () => actions.newFolder(row.path) },
          { label: "New canvas", onSelect: () => void newCanvas(actions, row.path) }, // canvas track
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
        { label: "Copy path", onSelect: () => navigator.clipboard?.writeText(isCanvasPath(n.path) ? n.path : `${n.path}.md`).then(() => actions.notify("Path copied")) }, // canvas track: keep .canvas
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
    /* attachments-ui: open or delete an attachment; it has no rename */
    if (row.kind === "note" && isAttachmentRow(row.note.id) && (k === "Enter" || k === " " || k === "F2" || k === "Delete")) {
      e.preventDefault();
      const path = attachmentRowPath(row.note.id);
      if (k === "Delete") void att?.remove(path);
      else if (k !== "F2") att?.open(path, e.ctrlKey || e.metaKey ? "tab" : "current");
      return;
    }
    /* end attachments-ui */
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
    /* attachments-ui */ else if (isAttachmentRow(row.note.id)) att?.open(attachmentRowPath(row.note.id), e.ctrlKey || e.metaKey ? "tab" : "current");
    else actions.open(row.note.id, e.ctrlKey || e.metaKey ? "tab" : "current");
  };

  // Drag a note onto a folder row to move it there; anywhere else in the list moves it to the root.
  const folderAt = (target: EventTarget) => {
    const el = (target as Element).closest?.<HTMLElement>('[data-kind="dir"]');
    return el ? el.dataset.key!.slice(2) : "";
  };
  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      /* attachments-ui: files from the device upload into the folder under the pointer */
      const fileDrop = !!att && e.dataTransfer.types.includes("Files");
      if (fileDrop) e.dataTransfer.dropEffect = "copy";
      if (!e.dataTransfer.types.includes("application/x-nexus-note") && !fileDrop) return;
      e.preventDefault();
      setDropTarget(folderAt(e.target));
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDropTarget(null);
      /* attachments-ui */
      const files = att && e.dataTransfer.types.includes("Files") ? filesOf(e.dataTransfer) : [];
      if (files.length) {
        const folder = folderAt(e.target);
        if (folder) actions.setExpanded((s) => s.add(folder));
        void att!.uploadMany(files, folder);
        return;
      }
      /* end attachments-ui */
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
        // --- canvas track: right-click on blank space offers what a folder offers, at the vault root ---
        onContextMenu={(e) => {
          if ((e.target as Element).closest("[data-key]")) return;
          setMenuItems({
            label: "Vault root",
            items: [
              { label: "New note", onSelect: () => actions.newNote("") },
              { label: "New folder", onSelect: () => actions.newFolder("") },
              { label: "New canvas", onSelect: () => void newCanvas(actions, "") },
            ],
          });
          menu.openAt(e);
        }}
        // --- end canvas track ---
      >
        {w.treeStatus === "loading" && (
          <div role="status">
            <span className="sr-only">Loading notes…</span>
            {/* Rows at the size and indent of the tree that replaces them, so nothing shifts. */}
            {SKELETON_ROWS.map(([width, depth], i) => (
              <div
                key={i}
                aria-hidden="true"
                className="flex h-11 items-center md:h-7 md:pointer-coarse:h-11"
                style={{ paddingLeft: 28 + depth * 16 }}
              >
                <Bar w={`${width}%`} h={10} />
              </div>
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
              if (e.button === 1 && hit?.row.kind === "note" && isAttachmentRow(hit.row.note.id)) return void att?.open(attachmentRowPath(hit.row.note.id), "tab"); /* attachments-ui */
              if (e.button === 1 && hit?.row.kind === "note") actions.open(hit.row.note.id, "tab");
            }}
            onDragStart={(e) => {
              const hit = rowAt(e.target);
              /* attachments-ui: an attachment is not moved; dragged into a note it drops its embed link */
              if (hit?.row.kind === "note" && isAttachmentRow(hit.row.note.id)) {
                e.dataTransfer.setData("text/plain", embedLink(attachmentRowPath(hit.row.note.id)));
                e.dataTransfer.effectAllowed = "copy";
                return;
              }
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
                canvas={row.kind === "note" && isCanvasPath(row.note.path)} // canvas track
                icon={row.kind === "note" && isAttachmentRow(row.key) ? (attKinds.get(attachmentRowPath(row.key)) ?? "file") : undefined} /* attachments-ui */
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
