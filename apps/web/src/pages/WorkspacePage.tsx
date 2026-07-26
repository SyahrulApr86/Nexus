import { useEffect, useMemo, useState } from "react";
import {
  Link,
  Outlet,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
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
import { useRealtime } from "../lib/realtime.js";
import { ImportExport } from "../components/ImportExport.js";
import { Icon } from "../components/Icon.js";
import { Mark } from "../components/Mark.js";
import {
  CommandPalette,
  type Command,
} from "../components/CommandPalette.js";
import { SettingsDialog } from "../components/SettingsDialog.js";

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const connection = useRealtime();

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
        id: "export",
        label: "Export vault as ZIP",
        run: () => {
          window.location.href = "/api/export";
        },
      },
      {
        id: "settings",
        label: "Open settings",
        run: () => setSettingsOpen(true),
      },
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
  }, [notes, navigate]);

  // Below lg the sidebar becomes an overlay drawer: at 768px and under, a
  // fixed 256px rail plus a split editor left the panes unusable.
  const [navOpen, setNavOpen] = useState(false);
  const closeNav = () => setNavOpen(false);
  const { pathname } = useLocation();

  // Any navigation dismisses the drawer — creating a note, opening trash,
  // jumping from the palette — rather than leaving it over the content.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  const railLink =
    "flex items-center gap-2 rounded-control px-2 py-1.5 text-[13px] text-ink hover:bg-card";

  return (
    <div className="flex h-full">
      {navOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={closeNav}
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
        />
      )}
      <aside
        aria-label="Vault navigation"
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-border bg-surface transition-transform duration-150 lg:static lg:translate-x-0 ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-3 py-3">
          <Link
            to="/welcome"
            aria-label="Nexus home"
            className="flex items-center gap-2 rounded-control px-1 py-0.5 hover:bg-card"
          >
            <Mark size={22} className="text-accent" />
            <span className="text-[15px] font-semibold tracking-heading">
              Nexus
            </span>
          </Link>
          <button
            type="button"
            onClick={() =>
              logout.mutate(undefined, {
                onSuccess: () => navigate({ to: "/login" }),
              })
            }
            className="rounded-control px-2 py-1 text-[12px] text-muted hover:bg-card hover:text-ink"
          >
            Log out
          </button>
        </div>
        <SearchPanel />
        <div className="px-3 pb-2">
          <Button
            onClick={() => newNote(null)}
            disabled={createNote.isPending}
            className="w-full !gap-1.5 !py-1.5 text-[13px]"
          >
            <Icon name="plus" size={14} />
            New note
          </Button>
        </div>
        <FolderTree
          tree={tree ?? []}
          notes={notes ?? []}
          onCreateNote={newNote}
        />
        <TagsSection />
        <ImportExport />
        <div className="border-t border-border px-2 py-2">
          <Link
            to="/graph"
            className={railLink}
            activeProps={{ className: `${railLink} bg-card font-medium` }}
          >
            <Icon name="graph" className="text-muted" /> Graph
          </Link>
          <Link
            to="/trash"
            className={railLink}
            activeProps={{ className: `${railLink} bg-card font-medium` }}
          >
            <Icon name="trash" className="text-muted" /> Trash
          </Link>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className={`${railLink} w-full`}
          >
            <Icon name="settings" className="text-muted" /> Settings
          </button>
          <p className="flex items-center gap-2 truncate px-2 pt-1.5 text-[12px] text-muted">
            <span
              aria-hidden="true"
              className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                connection === "connected"
                  ? "bg-accent"
                  : connection === "connecting"
                    ? "bg-mist"
                    : "bg-danger"
              }`}
            />
            <span className="truncate">
              {user?.displayName || user?.email}
            </span>
            {connection === "offline" && (
              <span role="status" className="shrink-0 text-danger">
                Offline
              </span>
            )}
          </p>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 lg:hidden">
          <button
            type="button"
            aria-label="Open navigation"
            aria-expanded={navOpen}
            onClick={() => setNavOpen(true)}
            className="icon-button rounded-control border border-border px-2 py-1 text-ink"
          >
            <Icon name="menu" size={16} />
          </button>
          <Link
            to="/welcome"
            aria-label="Nexus home"
            className="flex items-center gap-1.5 rounded-control px-1 py-0.5 text-[13px] font-medium text-ink hover:bg-surface"
          >
            <Mark size={16} className="text-accent" />
            Nexus
          </Link>
        </div>
        <main className="min-h-0 flex-1">
          <Outlet />
        </main>
      </div>
      <CommandPalette
        open={paletteOpen}
        commands={commands}
        onClose={() => setPaletteOpen(false)}
      />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}

export function WorkspaceHome() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-80 text-center">
        <p className="text-[15px] font-medium text-ink">No note open</p>
        <p className="mt-1 text-[13px] text-muted">
          Pick a note from the sidebar, or create one.
        </p>
        <dl className="mt-6 space-y-2 text-left text-[13px] text-muted">
          {[
            ["Open command palette", "Ctrl+P"],
            ["Link a note while writing", "[[title"],
            ["Tag a note", "#topic"],
          ].map(([label, keys]) => (
            <div key={label} className="flex items-center justify-between">
              <dt>{label}</dt>
              <dd>
                <kbd className="rounded-[5px] border border-border bg-surface px-1.5 py-0.5 font-mono text-[11px] text-ink">
                  {keys}
                </kbd>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
