"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarDays,
  ChevronsUpDown,
  FilePlus,
  FileSearch,
  Files,
  GitFork,
  Hash,
  Keyboard,
  Link2,
  ListTree,
  Menu as MenuIcon,
  PanelLeft,
  PanelRight,
  Pencil,
  Search,
  Settings,
  SquareTerminal,
  Waypoints,
} from "lucide-react";
import {
  WorkspaceProvider,
  sameNoteMeta,
  shallowEqual,
  useWorkspaceActions,
  useWorkspaceSelector,
  type InitialPrefs,
  type User,
  type RightView,
  type LeftView,
  type WorkspaceValue,
} from "./store";
import { FileExplorer } from "./file-explorer";
import { SearchView } from "./search-view";
import { BacklinksView, OutgoingView, OutlineView, TagsView } from "./right-views";
import { TabGroup } from "./tab-group";
import { Palette, type Command } from "./palette";
import { SettingsDialog } from "./settings";
import { Bar, IconButton, Menu, Toasts, useMenu } from "./ui";
import { splitFrontmatter } from "@/lib/markdown/parse";


export function Workspace({ user, initialPrefs }: { user: User; initialPrefs?: InitialPrefs }) {
  return (
    <WorkspaceProvider user={user} initialPrefs={initialPrefs}>
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

function Ribbon({ inert }: { inert: boolean }) {
  const a = useWorkspaceActions();
  const leftOpen = useWorkspaceSelector((w) => w.prefs.leftOpen);
  return (
    <nav aria-label="Ribbon" inert={inert} className="hidden w-11 shrink-0 flex-col items-center pb-2 md:flex">
      {/* The mark stays on screen when the left sidebar (which carries the full wordmark) is hidden. */}
      <div className="flex h-10 items-center">
        {!leftOpen && (
          <span translate="no" className="select-none text-[15px] font-semibold tracking-[-0.01em]">
            <span aria-hidden="true" className="text-accent-ink">
              [[]]
            </span>
            <span className="sr-only">Nexus</span>
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-col items-center gap-1">
        <IconButton label={leftOpen ? "Hide left sidebar" : "Show left sidebar"} onClick={() => a.showLeft()}>
          <PanelLeft />
        </IconButton>
        <IconButton label="Open quick switcher" shortcut="Mod+O" onClick={() => a.setPalette("notes")}>
          <FileSearch />
        </IconButton>
        <IconButton label="Open graph view" shortcut="Mod+G" onClick={() => a.openView({ type: "graph" }, "tab")}>
          <GitFork />
        </IconButton>
        <IconButton label="Open today’s daily note" shortcut="Mod+D" onClick={() => a.dailyNote()}>
          <CalendarDays />
        </IconButton>
        <IconButton label="Open command palette" shortcut="Mod+P" onClick={() => a.setPalette("commands")}>
          <SquareTerminal />
        </IconButton>
      </div>
      <div className="mt-auto flex flex-col items-center gap-1">
        <IconButton label="Keyboard shortcuts" onClick={() => a.setSettingsOpen("hotkeys")}>
          <Keyboard />
        </IconButton>
        <IconButton label="Settings" shortcut="Mod+," onClick={() => a.setSettingsOpen("general")}>
          <Settings />
        </IconButton>
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Sidebar view tabs: roving tabindex, arrows, Home and End            */
/* ------------------------------------------------------------------ */

function ViewTabs<T extends string>({
  label,
  prefix,
  views,
  value,
  onSelect,
  manual,
  className,
}: {
  label: string;
  prefix: string;
  views: { id: T; label: string; Icon: typeof Files }[];
  value: T;
  onSelect: (id: T) => void;
  /** Arrow keys only move focus; Enter or Space selects (for views that take focus when shown). */
  manual?: boolean;
  className: string;
}) {
  const onKeyDown = (e: ReactKeyboardEvent, i: number) => {
    const n =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? (i + 1) % views.length
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? (i - 1 + views.length) % views.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? views.length - 1
              : -1;
    if (n < 0) return;
    e.preventDefault();
    if (!manual) onSelect(views[n].id);
    document.getElementById(`${prefix}-tab-${views[n].id}`)?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className={className}>
      {views.map(({ id, label: name, Icon }, i) => (
        // IconButton: themed tooltip on hover and keyboard focus, 44px on touch.
        <IconButton
          key={id}
          id={`${prefix}-tab-${id}`}
          role="tab"
          aria-selected={value === id}
          aria-controls={`${prefix}-panel`}
          tabIndex={value === id ? 0 : -1}
          label={name}
          onClick={() => onSelect(id)}
          onKeyDown={(e) => onKeyDown(e, i)}
          className={value === id ? "bg-active text-fg!" : undefined}
        >
          <Icon />
        </IconButton>
      ))}
    </div>
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
  const actions = useWorkspaceActions();
  const vaultName = useWorkspaceSelector((w) => w.vaultName);
  const m = useMenu();
  return (
    <div className="shrink-0 px-2 pb-2 pt-1">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={!!m.anchor}
        aria-label={vaultName ? `Vault: ${vaultName}` : "Vault"}
        onClick={(e) => m.openBelow(e.currentTarget)}
        className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-hover pointer-coarse:h-11"
      >
        <span className="min-w-0 flex-1">
          {vaultName ? <span className="block truncate font-medium">{vaultName}</span> : <Bar w="55%" h={12} />}
        </span>
        <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 stroke-[1.5] text-faint" />
      </button>
      {m.anchor && (
        <Menu
          anchor={m.anchor}
          label="Vault"
          onClose={m.close}
          items={[
            { label: "Settings", shortcut: "Mod+,", onSelect: () => actions.setSettingsOpen("general") },
            { label: "Import notes…", onSelect: () => actions.setSettingsOpen("general") },
            { label: "Export vault as .zip", onSelect: actions.exportVault },
            "separator",
            { label: "Sign out", onSelect: actions.logout },
          ]}
        />
      )}
    </div>
  );
}

function LeftSidebar() {
  const actions = useWorkspaceActions();
  const { view, drawer, leftOpen } = useWorkspaceSelector(
    (w) => ({ view: w.prefs.leftView, drawer: w.drawer, leftOpen: w.prefs.leftOpen }),
    shallowEqual,
  );
  const open = drawer === "left";
  return (
    <aside
      id="left-sidebar"
      aria-label="Left sidebar"
      role={open ? "dialog" : undefined}
      aria-modal={open || undefined}
      tabIndex={-1}
      inert={!!drawer && !open}
      className={`fixed inset-y-0 left-0 z-40 flex w-[85vw] max-w-80 flex-col border-r border-border bg-frame shadow-[var(--shadow-float)] outline-none transition-[transform,visibility] duration-200 ease-[var(--ease-out-quint)]
        max-md:pl-[env(safe-area-inset-left)] md:static md:z-auto md:w-[260px] md:max-w-none md:shrink-0 md:translate-x-0 md:border-r-0 md:shadow-none md:visible
        ${open ? "visible translate-x-0" : "invisible -translate-x-full"}
        ${leftOpen ? "md:flex" : "md:hidden"}`}
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex h-10 shrink-0 items-center justify-between pl-3 pr-1 pointer-coarse:h-12">
        <Wordmark />
        {/* Manual activation: the search view takes focus when it appears. */}
        <ViewTabs
          label="Left sidebar views"
          prefix="left"
          views={LEFT_VIEWS}
          value={view}
          onSelect={actions.setLeftView}
          manual
          className="flex items-center gap-0.5"
        />
      </div>
      <div id="left-panel" role="tabpanel" aria-labelledby={`left-tab-${view}`} className="min-h-0 flex-1">
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

/** The focused note's name. The tree knows it before the note body loads, so a heading does not change mid-load. */
function focusedNoteName(w: WorkspaceValue) {
  const fv = w.focusView;
  return w.activeNote?.name ?? (fv.type === "note" ? w.tree.notes.find((n) => n.id === fv.id)?.name : undefined);
}

function RightSidebar() {
  const actions = useWorkspaceActions();
  const { view, drawer, rightOpen, noteName } = useWorkspaceSelector(
    (w) => ({ view: w.prefs.rightView, drawer: w.drawer, rightOpen: w.prefs.rightOpen, noteName: focusedNoteName(w) }),
    shallowEqual,
  );
  const open = drawer === "right";
  const current = RIGHT_VIEWS.find((v) => v.id === view)!;
  const heading = view !== "tags" && noteName ? `${current.label} for ${noteName}` : current.label;
  return (
    <aside
      id="right-sidebar"
      aria-label="Right sidebar"
      role={open ? "dialog" : undefined}
      aria-modal={open || undefined}
      tabIndex={-1}
      inert={!!drawer && !open}
      className={`fixed inset-y-0 right-0 z-40 flex w-[85vw] max-w-80 flex-col border-l border-border bg-frame shadow-[var(--shadow-float)] outline-none transition-[transform,visibility] duration-200 ease-[var(--ease-out-quint)] max-lg:pr-[env(safe-area-inset-right)]
        lg:static lg:z-auto lg:w-[280px] lg:max-w-none lg:shrink-0 lg:translate-x-0 lg:border-l-0 lg:shadow-none lg:visible
        ${open ? "visible translate-x-0" : "invisible translate-x-full"}
        ${rightOpen ? "lg:flex" : "lg:hidden"}`}
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ViewTabs
        label="Right sidebar views"
        prefix="right"
        views={RIGHT_VIEWS}
        value={view}
        onSelect={actions.setRightView}
        className="flex h-10 shrink-0 items-center gap-0.5 px-2 pointer-coarse:h-12"
      />
      <div id="right-panel" role="tabpanel" aria-labelledby={`right-tab-${view}`} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-6">
        {/* One line: a long note name is cut with an ellipsis; the full text is in the tooltip. */}
        <h2 className="truncate px-2 pb-0 pt-3 text-[13px] text-faint" title={heading}>
          {current.label}
          {view !== "tags" && noteName && (
            <span className="text-muted">
              {" "}
              for <span translate="no">{noteName}</span>
            </span>
          )}
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

/** Words of prose: markdown syntax (list markers, task boxes, fences, link targets) is not counted. */
function countWords(s: string) {
  const body = splitFrontmatter(s)
    .body.replace(/^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, "$1")
    .replace(/^[ \t]*(?:`{3,}|~{3,}).*$/gm, "")
    .replace(/\]\([^)\s]*(?:\s+"[^"]*")?\)/g, "]")
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
    .replace(/<!--[\s\S]*?-->|%%[\s\S]*?%%/g, " ");
  const m = body.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return m ? m.length : 0;
}

const SAVE_TEXT = {
  saved: "Saved",
  dirty: "Unsaved changes",
  saving: "Saving…",
  error: "Couldn’t save",
  signedOut: "Signed out, not saved",
} as const;

/** Text only, in the bar's own grey; colour only when something is wrong. */
function SaveLabel() {
  const save = useWorkspaceSelector((w) => w.save);
  const bad = save === "error" || save === "signedOut";
  return <span className={bad ? "text-negative" : undefined}>{SAVE_TEXT[save]}</span>;
}

/** The focused note's counts. Follows the published text (at most every 300 ms), not each keystroke. */
function NoteCounts() {
  const showRight = useWorkspaceActions().showRight;
  const { backlinks, content } = useWorkspaceSelector(
    (w) => ({ backlinks: w.activeNote?.backlinks.length ?? 0, content: w.activeNote?.content ?? "" }),
    shallowEqual,
  );
  const words = useMemo(() => countWords(content), [content]);
  return (
    <>
      <button type="button" onClick={() => showRight("backlinks")} className="tabular -mx-1 rounded px-1 hover:text-fg">
        {nf.format(backlinks)} {backlinks === 1 ? "backlink" : "backlinks"}
      </button>
      <span className="tabular">
        {nf.format(words)} {words === 1 ? "word" : "words"}
      </span>
      <span className="tabular">
        {nf.format(content.length)} {content.length === 1 ? "character" : "characters"}
      </span>
    </>
  );
}

function StatusBar({ inert }: { inert: boolean }) {
  const { hasNote, idle } = useWorkspaceSelector((w) => ({ hasNote: !!w.activeNote, idle: w.save === "saved" }), shallowEqual);
  return (
    <footer
      aria-label="Status bar"
      inert={inert}
      className="box-content hidden h-7 shrink-0 items-center justify-end gap-4 px-4 text-[12px] text-faint md:flex"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* First, so its changing width never moves the counters. Errors are announced by a toast.
          The idle "Saved" waits for the note: while it loads there is nothing to have saved. */}
      {(hasNote || !idle) && <SaveLabel />}
      {hasNote && <NoteCounts />}
    </footer>
  );
}

function PhoneTopBar({ inert }: { inert: boolean }) {
  const actions = useWorkspaceActions();
  const { v, drawer, save, name } = useWorkspaceSelector(
    (w) => ({
      v: w.focusView,
      drawer: w.drawer,
      // Only a problem shows here, so "dirty" and "saving" while typing do not re-render the bar.
      save: w.save === "error" || w.save === "signedOut" ? w.save : null,
      name: w.activeNote?.name,
    }),
    shallowEqual,
  );
  const bad = save !== null;
  return (
    <header
      inert={inert}
      className="box-content grid h-12 shrink-0 grid-cols-[1fr_minmax(0,auto)_1fr] items-center gap-1 border-b border-rule bg-frame px-1 md:hidden"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <IconButton
        label="Open files and search"
        aria-expanded={drawer === "left"}
        aria-controls="left-sidebar"
        className="size-11 justify-self-start"
        onClick={() => actions.showLeft()}
      >
        <MenuIcon />
      </IconButton>
      <p className="flex min-w-0 items-center justify-center gap-1.5 font-medium">
        <span className="truncate">{v.type === "graph" ? "Graph view" : (name ?? "Nexus")}</span>
        {bad && (
          <span className="shrink-0" title={SAVE_TEXT[save]}>
            <span aria-hidden="true" className="block size-1.5 rounded-full bg-negative" />
            <span className="sr-only">{SAVE_TEXT[save]}</span>
          </span>
        )}
      </p>
      <div className="flex items-center gap-1 justify-self-end">
        {v.type === "note" && (
          <IconButton
            label={v.mode === "edit" ? "Switch to reading view" : "Switch to editing view"}
            className="size-11"
            onClick={() => actions.setMode()}
          >
            {v.mode === "edit" ? <BookOpen /> : <Pencil />}
          </IconButton>
        )}
        <IconButton
          label="Open links and outline"
          aria-expanded={drawer === "right"}
          aria-controls="right-sidebar"
          className="size-11"
          onClick={() => actions.showRight()}
        >
          <PanelRight />
        </IconButton>
      </div>
    </header>
  );
}

/** A labelled phone bar button: icon over a 12px word, at least 56x56. */
function PhoneBarButton({
  label,
  text,
  primary,
  children,
  ...props
}: { label: string; text: string; primary?: boolean; children: React.ReactNode } & React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-label={label}
      className={`flex h-14 min-w-14 flex-1 flex-col items-center justify-center gap-1 rounded-md text-[12px] leading-none transition-colors active:bg-hover disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-5 [&_svg]:stroke-[1.5] ${
        primary ? "font-medium text-accent-ink" : "text-faint"
      }`}
      {...props}
    >
      <span aria-hidden="true" className="contents">
        {children}
      </span>
      <span aria-hidden="true">{text}</span>
    </button>
  );
}

function PhoneBottomBar({ inert }: { inert: boolean }) {
  const actions = useWorkspaceActions();
  const t = useWorkspaceSelector((w) => w.focusTab);
  return (
    <nav
      aria-label="Phone navigation"
      inert={inert}
      className="flex shrink-0 items-center justify-around border-t border-rule bg-frame px-1 md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <PhoneBarButton label="Navigate back" text="Back" disabled={!t || t.index === 0} onClick={actions.back}>
        <ArrowLeft />
      </PhoneBarButton>
      <PhoneBarButton label="Navigate forward" text="Forward" disabled={!t || t.index >= t.history.length - 1} onClick={actions.forward}>
        <ArrowRight />
      </PhoneBarButton>
      <PhoneBarButton label="Find or create a note" text="Find" onClick={() => actions.setPalette("notes")}>
        <FileSearch />
      </PhoneBarButton>
      <PhoneBarButton label="New note" text="New" primary onClick={() => actions.newNote("")}>
        <FilePlus />
      </PhoneBarButton>
      <PhoneBarButton label="Commands" text="Commands" onClick={() => actions.setPalette("commands")}>
        <SquareTerminal />
      </PhoneBarButton>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

const PHONE = "(max-width: 767px)";
const subscribePhone = (cb: () => void) => {
  const m = window.matchMedia(PHONE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
const usePhone = () => useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE).matches, () => false);

// macOS Option composes characters (Option+T is "†", Option+N a dead key), so fall back to the physical key.
const ALT_CODES: Record<string, string> = { KeyN: "n", KeyT: "t", KeyW: "w", BracketRight: "]", BracketLeft: "[" };

function Shell() {
  const a = useWorkspaceActions();
  // Everything the frame needs except note text: typing (which publishes text) does not re-render it.
  const w = useWorkspaceSelector(
    (s) => ({
      layout: s.layout,
      focusGroup: s.focusGroup,
      focusView: s.focusView,
      drawer: s.drawer,
      palette: s.palette,
      settingsOpen: s.settingsOpen,
      toasts: s.toasts,
      treeNotes: s.tree.notes,
    }),
    shallowEqual,
  );
  const note = useWorkspaceSelector((s) => s.activeNote, sameNoteMeta);
  const phone = usePhone();

  const commands: Command[] = useMemo(
    () => [
      { id: "new", label: "Create new note", shortcut: "Alt+N", run: () => a.newNote("") },
      { id: "open", label: "Open quick switcher", shortcut: "Mod+O", run: () => a.setPalette("notes") },
      { id: "daily", label: "Open today’s daily note", shortcut: "Mod+D", run: a.dailyNote },
      { id: "search", label: "Search in all notes", shortcut: "Mod+Shift+F", run: () => a.showLeft("search") },
      { id: "graph", label: "Open graph view", shortcut: "Mod+G", run: () => a.openView({ type: "graph" }, "tab") },
      // One pane on a phone: no "to the right".
      ...(phone ? [] : [{ id: "graph-split", label: "Open graph view to the right", run: () => a.openView({ type: "graph" }, "split") }]),
      { id: "mode", label: "Toggle reading and editing view", shortcut: "Mod+E", run: () => a.setMode() },
      { id: "tab", label: "New tab", shortcut: "Alt+T", run: () => a.openView({ type: "empty" }, "tab") },
      { id: "close-tab", label: "Close current tab", shortcut: "Alt+W", run: () => a.closeTab(w.layout.focus, w.focusGroup?.active ?? 0) },
      ...(note
        ? [
            ...(phone ? [] : [{ id: "split", label: "Open current note to the right", run: () => a.open(note.id, "split") }]),
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
      { id: "import", label: "Import notes", run: () => a.setSettingsOpen("general") },
      { id: "export", label: "Export vault as .zip", run: a.exportVault },
      { id: "theme-system", label: "Theme: match system", run: () => a.setTheme("system") },
      { id: "theme-light", label: "Theme: light", run: () => a.setTheme("light") },
      { id: "theme-dark", label: "Theme: dark", run: () => a.setTheme("dark") },
      { id: "settings", label: "Open settings", shortcut: "Mod+,", run: () => a.setSettingsOpen("general") },
      { id: "hotkeys", label: "Show keyboard shortcuts", run: () => a.setSettingsOpen("hotkeys") },
      { id: "logout", label: "Sign out", run: a.logout },
    ],
    [a, note, phone, w.layout.focus, w.focusGroup],
  );

  // The hotkey handler reads the latest view through a ref, so it is registered once.
  const now = useRef({ focus: w.layout.focus, active: w.focusGroup?.active ?? 0, view: w.focusView });
  useLayoutEffect(() => {
    now.current = { focus: w.layout.focus, active: w.focusGroup?.active ?? 0, view: w.focusView };
  });

  // Hotkeys, in the capture phase so the app's own keys win over the editor's.
  // Browsers keep Ctrl+N/T/W/Tab for themselves, so those actions use Alt.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented) return;
      // A modal (palette, settings, prompts) owns the keyboard while open.
      if (document.querySelector("dialog[open]")) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const run = (fn: () => void) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      };
      if (mod && e.altKey && e.key === "ArrowLeft") return run(a.back);
      if (mod && e.altKey && e.key === "ArrowRight") return run(a.forward);
      if (e.altKey && !mod) {
        const ak = /^[a-z[\]]$/i.test(e.key) ? k : ALT_CODES[e.code];
        if (ak === "n") return run(() => a.newNote(""));
        if (ak === "t") return run(() => a.openView({ type: "empty" }, "tab"));
        if (ak === "w") return run(() => a.closeTab(now.current.focus, now.current.active));
        if (ak === "]") return run(() => a.cycleTab(1));
        if (ak === "[") return run(() => a.cycleTab(-1));
        return;
      }
      // Ctrl+Alt+G and friends stay with the editor.
      if (!mod || e.altKey) return;
      if (k === "f" && e.shiftKey) return run(() => a.showLeft("search"));
      if (e.shiftKey) return;
      if (k === "o") run(() => a.setPalette("notes"));
      else if (k === "p") run(() => a.setPalette("commands"));
      else if (k === "n") run(() => a.newNote(""));
      else if (k === "e") run(() => a.setMode());
      else if (k === "g") run(() => a.openView({ type: "graph" }, "tab"));
      else if (k === "d") run(a.dailyNote);
      else if (k === "s") run(() => now.current.view.type === "note" && a.flush(now.current.view.id));
      else if (k === ",") run(() => a.setSettingsOpen("general"));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [a]);

  // Drawers act as modal dialogs on narrow screens: focus moves in, the rest is inert,
  // Escape or the scrim closes and returns focus to the button that opened it.
  const opener = useRef<HTMLElement | null>(null);
  const backToOpener = useRef(false);
  const closeDrawer = () => {
    backToOpener.current = true;
    a.setDrawer(null);
  };
  useEffect(() => {
    if (!w.drawer) return;
    const id = w.drawer === "left" ? "left-sidebar" : "right-sidebar";
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Retry for a few frames: the drawer is still visibility:hidden in the commit that opens it.
    let raf = 0;
    let tries = 20;
    const focusIn = () => {
      const aside = document.getElementById(id);
      (aside?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? aside)?.focus();
      if (!aside?.contains(document.activeElement) && tries-- > 0) raf = requestAnimationFrame(focusIn);
    };
    raf = requestAnimationFrame(focusIn);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector("dialog[open]")) return;
      backToOpener.current = true;
      a.setDrawer(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      const aside = document.getElementById(id);
      const back = backToOpener.current;
      backToOpener.current = false;
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active && active !== document.body && !aside?.contains(active)) return; // focus already moved on
        // Dismissed: back to the trigger. Closed by opening something: into the note.
        if (back && opener.current?.isConnected) opener.current.focus();
        else document.getElementById("workbench")?.focus();
      });
    };
  }, [w.drawer, a]);

  const covered = !!w.drawer;

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden bg-frame text-fg"
      style={{ paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}
    >
      <a
        href="#workbench"
        inert={covered}
        className="sr-only z-50 rounded-md bg-sheet px-3 py-2 focus:not-sr-only focus:fixed focus:left-2 focus:top-2"
      >
        Skip to note
      </a>
      <PhoneTopBar inert={covered} />
      <div className="flex min-h-0 flex-1">
        <Ribbon inert={covered} />
        <LeftSidebar />
        <main id="workbench" tabIndex={-1} inert={covered} className="flex min-w-0 flex-1 gap-2 outline-none">
          {w.layout.groups.map((g, gi) => (
            <TabGroup key={g.key} gi={gi} />
          ))}
        </main>
        <RightSidebar />
      </div>
      <StatusBar inert={covered} />
      <PhoneBottomBar inert={covered} />

      {/* Always mounted so it fades with the drawer instead of popping. */}
      <div
        aria-hidden="true"
        onClick={closeDrawer}
        className={`fixed inset-0 z-30 bg-[var(--scrim)] transition-opacity duration-200 ease-[var(--ease-out-quint)] ${
          w.drawer === "left" ? "md:hidden" : "lg:hidden"
        } ${w.drawer ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />
      {w.palette && (
        <Palette
          key={w.palette}
          mode={w.palette}
          notes={w.treeNotes}
          commands={commands}
          onOpen={(id, newTab) => a.open(id, newTab ? "tab" : "current", "edit", { focus: "editor" })}
          onCreate={(name) => a.createAndOpen(name)}
          onClose={() => a.setPalette(null)}
        />
      )}
      {w.settingsOpen && <SettingsDialog section={w.settingsOpen} />}
      <Toasts toasts={w.toasts} dismiss={a.dismissToast} />
    </div>
  );
}
