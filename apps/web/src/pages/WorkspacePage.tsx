import { Outlet, useNavigate } from "@tanstack/react-router";
import { useCurrentUser, useLogout } from "../api/auth.js";
import { useCreateNote, useNotes } from "../api/notes.js";
import { useFolderTree } from "../api/folders.js";
import { Button } from "../components/ui.js";
import { FolderTree } from "../components/FolderTree.js";
import { SearchPanel } from "../components/SearchPanel.js";

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

  const newNote = (folderId: string | null = null) =>
    createNote.mutate(
      { folderId },
      {
        onSuccess: (note) =>
          navigate({ to: "/notes/$noteId", params: { noteId: note.id } }),
      },
    );

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
        <div className="border-t border-border px-4 py-2 text-[13px] text-muted truncate">
          {user?.email}
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
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
