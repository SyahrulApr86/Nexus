import { useEffect, useMemo, useState, type DragEvent } from "react";
import { Link } from "@tanstack/react-router";
import type { FolderDto, NoteSummaryDto } from "@nexus/shared";
import {
  useCreateFolder,
  useDeleteFolder,
  useMoveFolder,
  useMoveNote,
  useRenameFolder,
  useReorderNote,
} from "../api/folders.js";
import { useDeleteNote } from "../api/notes.js";
import { Menu } from "./Menu.js";
import { MoveDialog } from "./MoveDialog.js";
import { ConfirmDialog, PromptDialog } from "./Dialogs.js";
import { useToast } from "./Toast.js";

type SortMode = "manual" | "title-asc" | "title-desc" | "date-new" | "date-old";

const SORT_LABELS: Record<SortMode, string> = {
  manual: "Manual order",
  "title-asc": "Title A-Z",
  "title-desc": "Title Z-A",
  "date-new": "Newest first",
  "date-old": "Oldest first",
};

function sortNotes(notes: NoteSummaryDto[], mode: SortMode): NoteSummaryDto[] {
  const copy = [...notes];
  switch (mode) {
    case "title-asc":
      return copy.sort((a, b) => a.title.localeCompare(b.title));
    case "title-desc":
      return copy.sort((a, b) => b.title.localeCompare(a.title));
    case "date-new":
      return copy.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    case "date-old":
      return copy.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    default:
      return copy.sort((a, b) => a.position - b.position);
  }
}

interface MoveTarget {
  kind: "note" | "folder";
  id: string;
  title: string;
}

type FolderDialog =
  | { kind: "new-folder"; parentId: string | null }
  | { kind: "rename"; folder: FolderDto }
  | { kind: "delete"; folder: FolderDto };

export function FolderTree({
  tree,
  notes,
  onCreateNote,
}: {
  tree: FolderDto[];
  notes: NoteSummaryDto[];
  onCreateNote: (folderId: string | null) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [sortModes, setSortModes] = useState<Record<string, SortMode>>({});
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [dialog, setDialog] = useState<FolderDialog | null>(null);

  const createFolder = useCreateFolder();
  const renameFolder = useRenameFolder();
  const deleteFolder = useDeleteFolder();
  const moveFolder = useMoveFolder();
  const moveNote = useMoveNote();
  const reorderNote = useReorderNote();
  const deleteNote = useDeleteNote();
  const toast = useToast();

  const notesByFolder = useMemo(() => {
    const map = new Map<string | null, NoteSummaryDto[]>();
    for (const n of notes) {
      const list = map.get(n.folderId) ?? [];
      list.push(n);
      map.set(n.folderId, list);
    }
    return map;
  }, [notes]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const sortFor = (key: string | null) => sortModes[key ?? "root"] ?? "manual";
  const setSortFor = (key: string | null, mode: SortMode) =>
    setSortModes((m) => ({ ...m, [key ?? "root"]: mode }));

  const onNoteDragStart = (e: DragEvent, noteId: string) => {
    e.dataTransfer.setData("application/x-nexus-note", noteId);
    e.dataTransfer.effectAllowed = "move";
  };

  const onFolderDrop = (e: DragEvent, folderId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    const noteId = e.dataTransfer.getData("application/x-nexus-note");
    if (noteId) {
      moveNote.mutate({ noteId, folderId });
      toast("Note moved");
    }
  };

  const onNoteDropReorder = (e: DragEvent, target: NoteSummaryDto) => {
    e.preventDefault();
    e.stopPropagation();
    const noteId = e.dataTransfer.getData("application/x-nexus-note");
    if (!noteId || noteId === target.id) return;
    const dragged = notes.find((n) => n.id === noteId);
    if (!dragged) return;
    if (dragged.folderId !== target.folderId) {
      moveNote.mutate({ noteId, folderId: target.folderId });
    } else {
      reorderNote.mutate({ noteId, position: target.position });
    }
  };

  const reorderByKeyboard = (
    note: NoteSummaryDto,
    list: NoteSummaryDto[],
    direction: -1 | 1,
  ) => {
    const idx = list.findIndex((n) => n.id === note.id);
    const swap = list[idx + direction];
    if (!swap) return;
    reorderNote.mutate({ noteId: note.id, position: swap.position });
  };

  const newFolder = (parentId: string | null) =>
    setDialog({ kind: "new-folder", parentId });

  // Command palette dispatches this (FR-020 → FR-007)
  useEffect(() => {
    const onNewFolder = () => setDialog({ kind: "new-folder", parentId: null });
    window.addEventListener("nexus:new-folder", onNewFolder);
    return () => window.removeEventListener("nexus:new-folder", onNewFolder);
  }, []);

  const renderNotes = (folderId: string | null, depth: number) => {
    const list = sortNotes(notesByFolder.get(folderId) ?? [], sortFor(folderId));
    const manualList = sortNotes(notesByFolder.get(folderId) ?? [], "manual");
    return list.map((n) => (
      <li key={n.id}>
        <div
          role="none"
          className="group flex items-center"
          draggable
          onDragStart={(e) => onNoteDragStart(e, n.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => onNoteDropReorder(e, n)}
        >
          <Link
            to="/notes/$noteId"
            params={{ noteId: n.id }}
           
            className="block min-w-0 flex-1 truncate rounded-control px-2 py-1.5 text-[14px] text-ink hover:bg-card"
            activeProps={{ className: "bg-card font-medium" }}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
            onKeyDown={(e) => {
              // Keyboard alternative to drag-reorder (SC-006)
              if (e.altKey && e.key === "ArrowUp") {
                e.preventDefault();
                reorderByKeyboard(n, manualList, -1);
              } else if (e.altKey && e.key === "ArrowDown") {
                e.preventDefault();
                reorderByKeyboard(n, manualList, 1);
              }
            }}
          >
            {n.title || "Untitled"}
          </Link>
          <span
            role="none"
            className="opacity-0 focus-within:opacity-100 group-hover:opacity-100"
          >
            <Menu
              label={`Actions for note ${n.title || "Untitled"}`}
              items={[
                {
                  label: "Move to…",
                  onSelect: () =>
                    setMoveTarget({
                      kind: "note",
                      id: n.id,
                      title: n.title || "Untitled",
                    }),
                },
                {
                  label: "Move to trash",
                  danger: true,
                  onSelect: () => {
                    deleteNote.mutate(n.id);
                    toast("Note moved to trash");
                  },
                },
              ]}
            />
          </span>
        </div>
      </li>
    ));
  };

  const renderFolder = (folder: FolderDto, depth: number) => {
    const isOpen = expanded.has(folder.id);
    return (
      <li key={folder.id}>
        <div
          role="none"
          className="group flex items-center"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => onFolderDrop(e, folder.id)}
        >
          <button
            type="button"
           
            aria-expanded={isOpen}
            onClick={() => toggle(folder.id)}
            className="flex min-w-0 flex-1 items-center gap-1 rounded-control px-2 py-1.5 text-left text-[14px] font-medium text-ink hover:bg-card"
            style={{ paddingLeft: `${8 + depth * 14}px` }}
          >
            <span aria-hidden="true" className="inline-block w-3 text-muted">
              {isOpen ? "▾" : "▸"}
            </span>
            <span className="truncate">{folder.name}</span>
            <span className="ml-1 shrink-0 text-[12px] text-muted">
              {folder.noteCount}
            </span>
          </button>
          <span
            role="none"
            className="opacity-0 focus-within:opacity-100 group-hover:opacity-100"
          >
            <Menu
              label={`Actions for folder ${folder.name}`}
              items={[
                {
                  label: "New note here",
                  onSelect: () => {
                    setExpanded((p) => new Set(p).add(folder.id));
                    onCreateNote(folder.id);
                  },
                },
                { label: "New subfolder", onSelect: () => newFolder(folder.id) },
                {
                  label: "Rename",
                  onSelect: () => setDialog({ kind: "rename", folder }),
                },
                {
                  label: "Move to…",
                  onSelect: () =>
                    setMoveTarget({
                      kind: "folder",
                      id: folder.id,
                      title: folder.name,
                    }),
                },
                {
                  label: `Sort: ${SORT_LABELS[sortFor(folder.id)]}`,
                  onSelect: () => {
                    const modes = Object.keys(SORT_LABELS) as SortMode[];
                    const next =
                      modes[(modes.indexOf(sortFor(folder.id)) + 1) % modes.length]!;
                    setSortFor(folder.id, next);
                    toast(`Sorted: ${SORT_LABELS[next]}`);
                  },
                },
                {
                  label: "Delete folder",
                  danger: true,
                  onSelect: () => setDialog({ kind: "delete", folder }),
                },
              ]}
            />
          </span>
        </div>
        {isOpen && (
          <ul>
            {folder.children.map((child) => renderFolder(child, depth + 1))}
            {renderNotes(folder.id, depth + 1)}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div
      className="min-h-0 flex-1 overflow-auto px-2 pb-2"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => onFolderDrop(e, null)}
    >
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-[12px] font-medium uppercase tracking-wide text-muted">
          Notes
        </span>
        <div className="flex items-center gap-1">
          <Menu
            label="Sort root notes"
            items={(Object.keys(SORT_LABELS) as SortMode[]).map((m) => ({
              label: SORT_LABELS[m],
              onSelect: () => setSortFor(null, m),
            }))}
          >
            <span aria-hidden="true">⇅</span>
          </Menu>
          <button
            type="button"
            onClick={() => newFolder(null)}
            aria-label="New folder"
            className="rounded-control px-1.5 py-0.5 text-[14px] text-muted hover:bg-card hover:text-ink"
          >
            +📁
          </button>
        </div>
      </div>
      <ul aria-label="Folders and notes">
        {tree.map((f) => renderFolder(f, 0))}
        {renderNotes(null, 0)}
      </ul>
      <MoveDialog
        open={moveTarget !== null}
        title={`Move "${moveTarget?.title ?? ""}" to…`}
        tree={tree}
        excludeFolderId={moveTarget?.kind === "folder" ? moveTarget.id : undefined}
        onMove={(folderId) => {
          if (!moveTarget) return;
          if (moveTarget.kind === "note") {
            moveNote.mutate({ noteId: moveTarget.id, folderId });
          } else {
            moveFolder.mutate({ folderId: moveTarget.id, parentId: folderId });
          }
          toast("Moved");
        }}
        onClose={() => setMoveTarget(null)}
      />
      {dialog?.kind === "new-folder" && (
        <PromptDialog
          open
          title="New folder"
          label="Folder name"
          submitLabel="Create"
          onSubmit={(name) => {
            createFolder.mutate({ name, parentId: dialog.parentId });
            if (dialog.parentId)
              setExpanded((p) => new Set(p).add(dialog.parentId!));
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "rename" && (
        <PromptDialog
          open
          title="Rename folder"
          label="Folder name"
          submitLabel="Rename"
          initialValue={dialog.folder.name}
          onSubmit={(name) =>
            renameFolder.mutate({ folderId: dialog.folder.id, name })
          }
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDialog
          open
          title="Delete folder"
          message={`Delete "${dialog.folder.name}" and move all its contents to trash? You can restore it from the trash later.`}
          confirmLabel="Move to trash"
          danger
          onConfirm={() => {
            deleteFolder.mutate(dialog.folder.id);
            toast("Folder moved to trash");
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
