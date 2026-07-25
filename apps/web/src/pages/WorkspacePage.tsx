import { useEffect, useMemo, useState } from "react";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import {
  useCurrentUser,
  useLogout,
  useUpdatePreferences,
} from "../api/auth.js";
import { useCreateNote, useNotes } from "../api/notes.js";
import { useFolderTree } from "../api/folders.js";
import { Button } from "../components/ui.js";
import { FolderTree } from "../components/FolderTree.js";
import { SearchPanel } from "../components/SearchPanel.js";
import { TagsSection } from "../components/TagsSection.js";
import {
  CommandPalette,
  type Command,
} from "../components/CommandPalette.js";

/**
 * Authenticated app shell: sidebar (notes, folders, search, trash) + main pane.
 */
export function WorkspacePage() {
  const { data: user } = useCurrentUser();
  const logout = useLogout();
  const navigate = useNavigate();
  const { data: notes } = useNotes();
  const { data: tree } = useFolderTree();
  const createNote = useCreateNote();
  const updatePrefs = useUpdatePreferences();
  const [paletteOpen, setPaletteOpen] = useState(false);

  const newNote = (folderId: string | null = null) =>
    createNote.mutate(
      { folderId },
      {
        onSuccess: (note) =>
          navigate({ to: "/notes/$noteId", params: { noteId: note.id } }),
      },
    );

  // FR-020: Ctrl/Cmd+P opens the palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      { id: "new-note", label: "New note", run: () => newNote(null) },
      {
        id: "new-folder",
        label: "New folder",
        run: () => window.dispatchEvent(new Event("nexus:new-folder")),
      },
      {
        id: "search",
        label: "Search notes",
        run: () => document.getElementById("vault-search")?.focus(),
      },
      { id: "trash", label: "Open trash", run: () => navigate({ to: "/trash" }) },
      { id: "graph", label: "Open graph", run: () => navigate({ to: "/graph" }) },
      {
        id: "theme-dark",
        label: "Theme: Dark",
        run: () => updatePrefs.mutate({ theme: "dark" }),
      },
      {
        id: "theme-light",
        label: "Theme: Light",
        run: () => updatePrefs.mutate({ theme: "light" }),
      },
      {
        id: "theme-system",
        label: "Theme: System",
        run: () => updatePrefs.mutate({ theme: "system" }),
      },
      {
        id: "logout",
        label: "Log out",
        run: () =>
          logout.mutate(undefined, {
            onSuccess: () => navigate({ to: "/login" }),
          }),
      },
    ];
    const noteJumps: Command[] =
      notes?.map((n) => ({
        id: `open-${n.id}`,
        label: `Open: ${n.title || "Untitled"}`,
        hint: "note",
        run: () =>
          navigate({ to: "/notes/$noteId", params: { noteId: n.id } }),
      })) ?? [];
    return [...base, ...noteJumps];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, navigate]);

  return (
    <div className="flex h-full">
      <aside
        aria-label="Vault navigation"
        className="flex w-72 shrink-0 flex-col border-r border-border bg-surface"
      >
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-[18px] font-semibold tracking-heading">
            Nexus
          </span>
          <Button
            variant="ghost"
            className="!px-3 !py-1.5 text-[14px]"
            onClick={() =>
              logout.mutate(undefined, {
                onSuccess: () => navigate({ to: "/login" }),
              })
            }
          >
            Log out
          </Button>
        </div>
        <SearchPanel />
        <div className="px-4 pb-2">
          <Button
            onClick={() => newNote(null)}
            disabled={createNote.isPending}
            className="w-full !py-2 text-[14px]"
          >
            New note
          </Button>
        </div>
        <FolderTree
          tree={tree ?? []}
          notes={notes ?? []}
          onCreateNote={newNote}
        />
        <TagsSection />
        <div className="border-t border-border px-2 py-2">
          <Link
            to="/graph"
            className="block rounded-control px-2 py-1.5 text-[14px] text-ink hover:bg-card"
            activeProps={{ className: "bg-card font-medium" }}
          >
            🕸 Graph
          </Link>
          <Link
            to="/trash"
            className="block rounded-control px-2 py-1.5 text-[14px] text-ink hover:bg-card"
            activeProps={{ className: "bg-card font-medium" }}
          >
            🗑 Trash
          </Link>
          <p className="truncate px-2 pt-1 text-[13px] text-muted">
            {user?.displayName || user?.email}
          </p>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
      <CommandPalette
        open={paletteOpen}
        commands={commands}
        onClose={() => setPaletteOpen(false)}
      />
    </div>
  );
}

export function WorkspaceHome() {
  return (
    <div className="flex h-full items-center justify-center text-muted">
      <p>Select or create a note to get started.</p>
    </div>
  );
}
