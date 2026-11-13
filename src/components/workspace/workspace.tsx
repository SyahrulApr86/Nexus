"use client";

import { useEffect, useMemo } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarDays,
  ChevronsUpDown,
  CircleHelp,
  FilePen,
  FileSearch,
  Files,
  GitFork,
  Hash,
  Info,
  Link2,
  ListTree,
  Menu as MenuIcon,
  PanelLeft,
  Pencil,
  Search,
  Settings,
  SquareTerminal,
  Waypoints,
} from "lucide-react";
import { WorkspaceProvider, useWorkspace, type User, type RightView, type LeftView } from "./store";
import { FileExplorer } from "./file-explorer";
import { SearchView } from "./search-view";
import { BacklinksView, OutgoingView, OutlineView, TagsView } from "./right-views";
import { TabGroup } from "./tab-group";
import { Palette, type Command } from "./palette";
import { SettingsDialog } from "./settings";
import { IconButton, Menu, Toasts, useMenu } from "./ui";

export function Workspace({ user }: { user: User }) {
  return (
    <WorkspaceProvider user={user}>
      <Shell />
    </WorkspaceProvider>
  );
}

/* ------------------------------------------------------------------ */
/* Brand mark: the product name written as a wikilink                  */
/* ------------------------------------------------------------------ */

function Wordmark() {
  return (
    <span className="select-none text-[15px] font-semibold tracking-[-0.01em]" translate="no">
      <span aria-hidden="true" className="text-accent-ink">
        [[
      </span>
      Nexus
      <span aria-hidden="true" className="text-accent-ink">
        ]]
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Ribbon                                                              */
/* ------------------------------------------------------------------ */

function Ribbon() {
  const w = useWorkspace();
  const a = w.actions;
  return (
    <nav aria-label="Ribbon" className="hidden w-11 shrink-0 flex-col items-center pb-2 md:flex">
      <div className="flex h-10 items-center">
        <IconButton
          label={w.prefs.leftOpen ? "Hide left sidebar" : "Show left sidebar"}
          aria-pressed={w.prefs.leftOpen}
          onClick={() => a.showLeft()}
        >
          <PanelLeft />
        </IconButton>
      </div>
      <div className="mt-2 flex flex-col items-center gap-1">
        <IconButton label="Open quick switcher" shortcut="Ctrl+O" onClick={() => a.setPalette("notes")}>
          <FileSearch />
        </IconButton>
        <IconButton label="Open graph view" shortcut="Ctrl+G" onClick={() => a.openView({ type: "graph" }, "tab")}>
          <GitFork />
        </IconButton>
        <IconButton label="Open today’s daily note" shortcut="Ctrl+D" onClick={() => a.dailyNote()}>
          <CalendarDays />
        </IconButton>
        <IconButton label="Open command palette" shortcut="Ctrl+P" onClick={() => a.setPalette("commands")}>
          <SquareTerminal />
        </IconButton>
      </div>
      <div className="mt-auto flex flex-col items-center gap-1">
        <IconButton label="Hotkeys and help" onClick={() => a.setSettingsOpen(true)}>
          <CircleHelp />
        </IconButton>
        <IconButton label="Settings" shortcut="Ctrl+," onClick={() => a.setSettingsOpen(true)}>
          <Settings />
        </IconButton>
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Sidebars                                                            */
/* ------------------------------------------------------------------ */

const LEFT_VIEWS: { id: LeftView; label: string; Icon: typeof Files }[] = [
  { id: "files", label: "Files", Icon: Files },
  { id: "search", label: "Search", Icon: Search },
];

function VaultSwitcher() {
  const w = useWorkspace();
  const m = useMenu();
  return (
    <div className="shrink-0 px-2 pb-2 pt-1">
      <button
        type="button"
        aria-haspopup="menu"
        onClick={(e) => m.openBelow(e.currentTarget)}
        className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-hover"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">My Vault</span>
        </span>
        <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 stroke-[1.5] text-faint" />
      </button>
      {m.anchor && (
        <Menu
          anchor={m.anchor}
          label="Vault"
          onClose={m.close}
          items={[
            { label: "Settings", shortcut: "Mod+,", onSelect: () => w.actions.setSettingsOpen(true) },
            { label: "Import notes…", onSelect: () => w.actions.setSettingsOpen(true) },
            { label: "Export vault as .zip", onSelect: w.actions.exportVault },
            "separator",
            { label: "Sign out", onSelect: w.actions.logout },
          ]}
        />
      )}
    </div>
  );
}

function LeftSidebar() {
  const w = useWorkspace();
  const view = w.prefs.leftView;
  const open = w.drawer === "left";
  return (
    <aside
      aria-label="Left sidebar"
      className={`fixed inset-y-0 left-0 z-40 flex w-[85vw] max-w-80 flex-col border-r border-border bg-frame shadow-[var(--shadow-float)] transition-[transform,visibility] duration-200 ease-[var(--ease-out-quint)]
        md:static md:z-auto md:w-[260px] md:max-w-none md:shrink-0 md:translate-x-0 md:border-r-0 md:shadow-none md:visible
        ${open ? "visible translate-x-0" : "invisible -translate-x-full"}
        ${w.prefs.leftOpen ? "md:flex" : "md:hidden"}`}
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex h-10 shrink-0 items-center justify-between pl-3 pr-1">
        <Wordmark />
        <div role="tablist" aria-label="Left sidebar views" className="flex items-center gap-0.5">
          {LEFT_VIEWS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              aria-label={label}
              title={label}
              onClick={() => w.actions.setLeftView(id)}
              className={`grid size-8 place-items-center rounded-md transition-colors ${
                view === id ? "bg-active text-fg" : "text-faint hover:bg-hover hover:text-fg"
              }`}
            >
              <Icon aria-hidden="true" className="size-[18px] stroke-[1.5]" />
            </button>
          ))}
        </div>
      </div>
      <div role="tabpanel" aria-label={view === "files" ? "Files" : "Search"} className="min-h-0 flex-1">
        {view === "files" ? <FileExplorer /> : <SearchView />}
      </div>
      <VaultSwitcher />
    </aside>
  );
}

const RIGHT_VIEWS: { id: RightView; label: string; Icon: typeof Link2 }[] = [
  { id: "backlinks", label: "Backlinks", Icon: Link2 },
  { id: "outgoing", label: "Outgoing links", Icon: Waypoints },
  { id: "tags", label: "Tags", Icon: Hash },
  { id: "outline", label: "Outline", Icon: ListTree },
];

function RightSidebar() {
  const w = useWorkspace();
  const view = w.prefs.rightView;
  const open = w.drawer === "right";
  const current = RIGHT_VIEWS.find((v) => v.id === view)!;
  return (
    <aside
      aria-label="Right sidebar"
      className={`fixed inset-y-0 right-0 z-40 flex w-[85vw] max-w-80 flex-col border-l border-border bg-frame shadow-[var(--shadow-float)] transition-[transform,visibility] duration-200 ease-[var(--ease-out-quint)]
        lg:static lg:z-auto lg:w-[280px] lg:max-w-none lg:shrink-0 lg:translate-x-0 lg:border-l-0 lg:shadow-none lg:visible
        ${open ? "visible translate-x-0" : "invisible translate-x-full"}
        ${w.prefs.rightOpen ? "lg:flex" : "lg:hidden"}`}
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div role="tablist" aria-label="Right sidebar views" className="flex h-10 shrink-0 items-center gap-0.5 px-2">
        {RIGHT_VIEWS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            aria-label={label}
            title={label}
            onClick={() => w.actions.setRightView(id)}
            className={`grid size-8 place-items-center rounded-md transition-colors ${
              view === id ? "bg-active text-fg" : "text-faint hover:bg-hover hover:text-fg"
            }`}
          >
            <Icon aria-hidden="true" className="size-[18px] stroke-[1.5]" />
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={current.label} className="min-h-0 flex-1 overflow-y-auto px-2 pb-6">
        <h2 className="px-2 pb-2 pt-1 text-[13px] text-faint">
          {current.label}
          {view !== "tags" && w.activeNote && <span className="text-muted"> for {w.activeNote.name}</span>}
        </h2>
        {view === "backlinks" && <BacklinksView />}
        {view === "outgoing" && <OutgoingView />}
        {view === "tags" && <TagsView />}
        {view === "outline" && <OutlineView />}
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Status bar (desktop) and phone bars                                 */
/* ------------------------------------------------------------------ */

const nf = new Intl.NumberFormat("en");

function countWords(s: string) {
  const m = s.replace(/^---[\s\S]*?---\n?/, "").match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return m ? m.length : 0;
}

function SaveLabel() {
  const w = useWorkspace();
  const text = { saved: "Saved", dirty: "Unsaved changes", saving: "Saving…", error: "Couldn’t save, retrying" }[w.save];
  return (
    <span className={`inline-flex items-center gap-1.5 ${w.save === "error" ? "text-negative" : ""}`}>
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-full ${w.save === "saved" ? "bg-positive" : w.save === "error" ? "bg-negative" : "bg-mark"}`}
      />
      {text}
    </span>
  );
}

function StatusBar() {
  const w = useWorkspace();
  const note = w.activeNote;
  const words = useMemo(() => (note ? countWords(note.content) : 0), [note]);
  return (
    <footer
      aria-label="Status bar"
      className="hidden h-7 shrink-0 items-center justify-end gap-4 px-4 text-[12px] text-faint md:flex"
    >
      {note && (
        <>
          <button type="button" onClick={() => w.actions.showRight("backlinks")} className="tabular rounded px-1 hover:text-fg">
            {nf.format(note.backlinks.length)} {note.backlinks.length === 1 ? "backlink" : "backlinks"}
          </button>
          <span className="tabular">
            {nf.format(words)} {words === 1 ? "word" : "words"}
          </span>
          <span className="tabular">
            {nf.format(note.content.length)} {note.content.length === 1 ? "character" : "characters"}
          </span>
        </>
      )}
      <span role="status" aria-live="polite">
        <SaveLabel />
      </span>
    </footer>
  );
}

function PhoneTopBar() {
  const w = useWorkspace();
  const v = w.focusView;
  return (
    <header
      className="flex h-12 shrink-0 items-center gap-1 border-b border-rule bg-sheet px-1 md:hidden"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <IconButton label="Open files and search" className="size-11" onClick={() => w.actions.showLeft()}>
        <MenuIcon />
      </IconButton>
      <p className="min-w-0 flex-1 truncate text-center font-medium">
        {v.type === "graph" ? "Graph view" : (w.activeNote?.name ?? "Nexus")}
      </p>
      {v.type === "note" && (
        <IconButton
          label={v.mode === "edit" ? "Switch to reading view" : "Switch to editing view"}
          className="size-11"
          onClick={() => w.actions.setMode()}
        >
          {v.mode === "edit" ? <BookOpen /> : <Pencil />}
        </IconButton>
      )}
      <IconButton label="Open links and outline" className="size-11" onClick={() => w.actions.showRight()}>
        <Info />
      </IconButton>
    </header>
  );
}

function PhoneBottomBar() {
  const w = useWorkspace();
  const t = w.focusTab;
  return (
    <nav
      aria-label="Phone navigation"
      className="flex shrink-0 items-center justify-around border-t border-rule bg-frame md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <IconButton label="Navigate back" className="size-12" disabled={!t || t.index === 0} onClick={w.actions.back}>
        <ArrowLeft />
      </IconButton>
      <IconButton label="Navigate forward" className="size-12" disabled={!t || t.index >= t.history.length - 1} onClick={w.actions.forward}>
        <ArrowRight />
      </IconButton>
      <IconButton label="Find or create a note" className="size-12" onClick={() => w.actions.setPalette("notes")}>
        <FileSearch />
      </IconButton>
      <IconButton label="New note" className="size-12" onClick={() => w.actions.newNote("")}>
        <FilePen />
      </IconButton>
      <IconButton label="Commands" className="size-12" onClick={() => w.actions.setPalette("commands")}>
        <SquareTerminal />
      </IconButton>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

function Shell() {
  const w = useWorkspace();
  const a = w.actions;
  const note = w.activeNote;

  const commands: Command[] = useMemo(
    () => [
      { id: "new", label: "Create new note", shortcut: "Alt+N", run: () => a.newNote("") },
      { id: "open", label: "Open quick switcher", shortcut: "Mod+O", run: () => a.setPalette("notes") },
      { id: "daily", label: "Open today’s daily note", shortcut: "Mod+D", run: a.dailyNote },
      { id: "search", label: "Search in all notes", shortcut: "Mod+Shift+F", run: () => a.showLeft("search") },
      { id: "graph", label: "Open graph view", shortcut: "Mod+G", run: () => a.openView({ type: "graph" }, "tab") },
      { id: "graph-split", label: "Open graph view to the right", run: () => a.openView({ type: "graph" }, "split") },
      { id: "mode", label: "Toggle reading and editing view", shortcut: "Mod+E", run: () => a.setMode() },
      { id: "tab", label: "New tab", shortcut: "Alt+T", run: () => a.openView({ type: "empty" }, "tab") },
      ...(note
        ? [
            { id: "split", label: "Open current note to the right", run: () => a.open(note.id, "split") },
            { id: "rename", label: "Rename current note", run: () => a.renameNote(note) },
            { id: "reveal", label: "Reveal current note in file explorer", run: () => a.reveal(note.path) },
            { id: "delete", label: "Delete current note", run: () => a.deleteNote(note) },
          ]
        : []),
      { id: "backlinks", label: "Show backlinks", run: () => a.showRight("backlinks") },
      { id: "outline", label: "Show outline", run: () => a.showRight("outline") },
      { id: "tags", label: "Show tags", run: () => a.showRight("tags") },
      { id: "left", label: "Toggle left sidebar", run: () => a.showLeft() },
      { id: "right", label: "Toggle right sidebar", run: () => a.showRight() },
      { id: "import", label: "Import notes", run: () => a.setSettingsOpen(true) },
      { id: "export", label: "Export vault as .zip", run: a.exportVault },
      { id: "theme-system", label: "Theme: match system", run: () => a.setTheme("system") },
      { id: "theme-light", label: "Theme: light", run: () => a.setTheme("light") },
      { id: "theme-dark", label: "Theme: dark", run: () => a.setTheme("dark") },
      { id: "settings", label: "Open settings", shortcut: "Mod+,", run: () => a.setSettingsOpen(true) },
      { id: "logout", label: "Sign out", run: a.logout },
    ],
    [a, note],
  );

  // Hotkeys. Browsers keep Ctrl+N/T/W/Tab for themselves, so those actions use Alt.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (mod && e.altKey && e.key === "ArrowLeft") return run(a.back);
      if (mod && e.altKey && e.key === "ArrowRight") return run(a.forward);
      if (e.altKey && !mod) {
        if (k === "n") return run(() => a.newNote(""));
        if (k === "t") return run(() => a.openView({ type: "empty" }, "tab"));
        if (k === "w") return run(() => a.closeTab(w.layout.focus, w.focusGroup?.active ?? 0));
        if (e.key === "]") return run(() => a.cycleTab(1));
        if (e.key === "[") return run(() => a.cycleTab(-1));
        return;
      }
      if (!mod) return;
      if (k === "o") run(() => a.setPalette("notes"));
      else if (k === "p") run(() => a.setPalette("commands"));
      else if (k === "n" && !e.shiftKey) run(() => a.newNote(""));
      else if (k === "e") run(() => a.setMode());
      else if (k === "g") run(() => a.openView({ type: "graph" }, "tab"));
      else if (k === "d") run(a.dailyNote);
      else if (k === "f" && e.shiftKey) run(() => a.showLeft("search"));
      else if (k === "s") run(() => w.focusView.type === "note" && a.flush(w.focusView.id));
      else if (k === ",") run(() => a.setSettingsOpen(true));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [a, w.layout.focus, w.focusGroup, w.focusView]);

  // Escape closes an open drawer on the phone.
  useEffect(() => {
    if (!w.drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && a.setDrawer(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [w.drawer, a]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-frame text-fg">
      <a
        href="#workbench"
        className="sr-only z-50 rounded-md bg-sheet px-3 py-2 focus:not-sr-only focus:fixed focus:left-2 focus:top-2"
      >
        Skip to note
      </a>
      <PhoneTopBar />
      <div className="flex min-h-0 flex-1">
        <Ribbon />
        <LeftSidebar />
        <main id="workbench" tabIndex={-1} className="flex min-w-0 flex-1 gap-2 outline-none">
          {w.layout.groups.map((g, gi) => (
            <TabGroup key={g.key} gi={gi} />
          ))}
        </main>
        <RightSidebar />
      </div>
      <StatusBar />
      <PhoneBottomBar />

      {w.drawer && (
        <div
          aria-hidden="true"
          className={`fixed inset-0 z-30 bg-[var(--scrim)] ${w.drawer === "left" ? "md:hidden" : "lg:hidden"}`}
          onClick={() => a.setDrawer(null)}
        />
      )}
      {w.palette && (
        <Palette
          mode={w.palette}
          notes={w.tree.notes}
          commands={commands}
          onOpen={(id, newTab) => a.open(id, newTab ? "tab" : "current")}
          onCreate={(name) => a.createAndOpen(name)}
          onClose={() => a.setPalette(null)}
        />
      )}
      {w.settingsOpen && <SettingsDialog />}
      <Toasts toasts={w.toasts} dismiss={a.dismissToast} />
    </div>
  );
}
