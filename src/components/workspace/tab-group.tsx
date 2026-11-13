"use client";

import {
  ViewTransition,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { ArrowLeft, ArrowRight, BookOpen, EllipsisVertical, GitFork, PanelRight, Pencil, Plus, X } from "lucide-react";
import {
  currentView,
  sameItems,
  sameNoteMeta,
  shallowEqual,
  useWorkspaceActions,
  useWorkspaceSelector,
  type CachedNote,
  type View,
  type Tab,
  type WorkspaceValue,
} from "./store";
import { Editor } from "./editor";
import { Reader } from "./reader";
import { GraphView } from "./graph-view";
import { Bar, IconButton, Menu, Shortcut, useMenu, type MenuItem } from "./ui";
import { dirname } from "@/lib/markdown/parse";
import { openShare } from "./share-dialog"; // vaults-ui
/* templates-properties */
import { Properties } from "./properties";
import { hideFrontmatter } from "./properties-extension";
import { useTemplatePrefs } from "./templates-settings";
/* end templates-properties */

/** Focus an element once it exists (checked each frame, for up to half a second). */
function focusWhenReady(find: () => HTMLElement | null | undefined, tries = 30) {
  requestAnimationFrame(() => {
    const el = find();
    if (el?.isConnected) el.focus();
    else if (tries > 0) focusWhenReady(find, tries - 1);
  });
}

/** A view's title. Reads names only, so selecting it does not follow note text. */
function viewTitle(w: WorkspaceValue, v: View) {
  return v.type === "graph" ? "Graph view" : v.type === "empty" ? "New tab" : (w.notes[v.id]?.name ?? w.tree.notes.find((n) => n.id === v.id)?.name ?? "Loading…");
}

/* ------------------------------------------------------------------ */
/* Tab bar                                                             */
/* ------------------------------------------------------------------ */

function TabBar({ gi, panelId, last }: { gi: number; panelId: string; last: boolean }) {
  const actions = useWorkspaceActions();
  const { layout, drawer, rightOpen } = useWorkspaceSelector(
    (w) => ({ layout: w.layout, drawer: w.drawer, rightOpen: w.prefs.rightOpen }),
    shallowEqual,
  );
  const g = layout.groups[gi];
  const titles = useWorkspaceSelector((w) => (w.layout.groups[gi]?.tabs ?? []).map((t) => viewTitle(w, currentView(t))), sameItems);
  const listRef = useRef<HTMLDivElement>(null);
  const menu = useMenu();
  const [menuTab, setMenuTab] = useState(0);

  // Wait until the tab is the selected one: view transitions can hold the commit for a few frames.
  const focusTab = (i: number, key = g.key) =>
    focusWhenReady(() => {
      const el = document.getElementById(`tab-${key}-${i}`);
      return el?.getAttribute("aria-selected") === "true" ? el : null;
    });

  /** Close a tab and keep keyboard focus on a tab that still exists. */
  const closeAndRefocus = (i: number) => {
    const remaining = g.tabs.length - 1;
    const other = layout.groups.find((_, k) => k !== gi);
    actions.closeTab(gi, i);
    // The next tab, else the previous one (APG); then the other pane; then the empty view.
    if (remaining > 0) focusTab(i < g.active ? g.active - 1 : Math.min(g.active, remaining - 1));
    else if (other) focusTab(other.active, other.key);
    else focusWhenReady(() => document.getElementById(panelId)?.querySelector<HTMLElement>("[data-empty-view] button"));
  };

  const onKeyDown = (e: KeyboardEvent, i: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const n = (i + (e.key === "ArrowRight" ? 1 : -1) + g.tabs.length) % g.tabs.length;
      actions.activate(gi, n);
      focusTab(n);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const n = e.key === "Home" ? 0 : g.tabs.length - 1;
      actions.activate(gi, n);
      focusTab(n);
    } else if (e.key === "Delete") {
      e.preventDefault();
      closeAndRefocus(i);
    } else if ((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu") {
      e.preventDefault();
      setMenuTab(i);
      menu.openBelow(e.currentTarget);
    }
  };

  const items: MenuItem[] = [
    { label: "Close tab", shortcut: "Alt+W", onSelect: () => closeAndRefocus(menuTab) },
    { label: "Close other tabs", onSelect: () => actions.closeOthers(gi, menuTab), disabled: g.tabs.length < 2 },
    "separator",
    { label: "Open to the right", onSelect: () => actions.splitTab(gi, menuTab) },
  ];

  // An active tab past the edge of an overflowing strip scrolls into view (only the strip moves).
  const activeKey = g.tabs[g.active]?.key;
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-tab-key="${CSS.escape(activeKey ?? "")}"]`);
    if (!list || !el || list.scrollWidth <= list.clientWidth) return;
    const box = list.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const delta = r.left < box.left ? r.left - box.left : r.right > box.right ? r.right - box.right : 0;
    if (!delta) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollBy({ left: delta, behavior: smooth ? "smooth" : "auto" });
  }, [activeKey, g.tabs.length]);

  return (
    <div className="hidden h-10 shrink-0 items-end gap-1 pl-4 pr-2 md:flex pointer-coarse:h-12">
      {/* pb-px lets the selected tab paint over the sheet's top hairline; pl-4 clears the sheet's rounded corner. */}
      <div ref={listRef} role="tablist" aria-label={layout.groups.length > 1 ? `Tabs, group ${gi + 1}` : "Tabs"} className="relative z-10 -mb-px flex min-w-0 items-end gap-0.5 overflow-x-auto overflow-y-hidden pb-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {g.tabs.map((t: Tab, i) => {
          const selected = i === g.active;
          const v = currentView(t);
          return (
            <div key={t.key} data-tab-key={t.key} className="group relative flex shrink-0 items-center">
              <button
                id={`tab-${g.key}-${i}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                onClick={() => actions.activate(gi, i)}
                onAuxClick={(e) => e.button === 1 && actions.closeTab(gi, i)}
                onKeyDown={(e) => onKeyDown(e, i)}
                onContextMenu={(e) => {
                  setMenuTab(i);
                  menu.openAt(e);
                }}
                className={`relative flex h-9 max-w-56 items-center gap-1.5 rounded-t-lg pl-3 pr-8 text-[13px] pointer-coarse:h-11 pointer-coarse:pr-10 outline-offset-[-2px] transition-colors ${
                  selected
                    ? "z-10 -mb-px border border-b-0 border-border bg-sheet text-fg"
                    : "text-muted hover:bg-hover hover:text-fg"
                }`}
              >
                {selected && layout.focus === gi && (
                  <span aria-hidden="true" className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-accent" />
                )}
                {v.type === "graph" && <GitFork aria-hidden="true" className="size-3.5 shrink-0 stroke-[1.5] text-faint" />}
                <span className="truncate" translate={v.type === "note" ? "no" : undefined}>
                  {titles[i]}
                </span>
              </button>
              <button
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                title="Close tab"
                onClick={() => actions.closeTab(gi, i)}
                // 24px to see, 44px to touch: the ::after pad widens the hit area on coarse pointers.
                className={`absolute right-1.5 top-1/2 z-20 grid size-6 -translate-y-1/2 place-items-center rounded text-faint transition-opacity hover:bg-hover hover:text-fg pointer-coarse:right-2.5 pointer-coarse:opacity-100 pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5 ${
                  selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}
              >
                <X className="size-3.5 stroke-[1.5]" />
              </button>
            </div>
          );
        })}
      </div>
      <IconButton label="New tab" shortcut="Alt+T" className="mb-0.5 size-7 pointer-coarse:size-11" onClick={() => actions.openView({ type: "empty" }, "tab")}>
        <Plus />
      </IconButton>
      <div className="flex-1" />
      {last && (
        <>
          {/* 768-1023px: the right sidebar is a drawer. */}
          <IconButton
            label={drawer === "right" ? "Hide right sidebar" : "Show right sidebar"}
            aria-expanded={drawer === "right"}
            aria-controls="right-sidebar"
            className="mb-0.5 lg:hidden"
            onClick={() => actions.showRight()}
          >
            <PanelRight />
          </IconButton>
          <IconButton
            label={rightOpen ? "Hide right sidebar" : "Show right sidebar"}
            className="mb-0.5 hidden lg:inline-flex"
            onClick={() => actions.showRight()}
          >
            <PanelRight />
          </IconButton>
        </>
      )}
      {menu.anchor && <Menu anchor={menu.anchor} label="Tab actions" items={items} onClose={menu.close} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* View header: back, forward, breadcrumb, mode, more options          */
/* ------------------------------------------------------------------ */

function ViewHeader({ gi, tab, view }: { gi: number; tab?: Tab; view: View }) {
  const actions = useWorkspaceActions();
  const w = useWorkspaceSelector((s) => ({ tree: s.tree, layout: s.layout, title: viewTitle(s, view) }), shallowEqual);
  const more = useMenu();
  const moreButton = useRef<HTMLButtonElement>(null);
  const [moving, setMoving] = useState(false);
  // Name and path only: the header does not follow the note's text.
  const note = useWorkspaceSelector((s) => (view.type === "note" ? s.notes[view.id] : undefined), sameNoteMeta);
  const canBack = !!tab && tab.index > 0;
  const canForward = !!tab && tab.index < tab.history.length - 1;
  // The tree has the path and name before the note body arrives, so the breadcrumb is final from the start.
  const known = view.type === "note" ? w.tree.notes.find((n) => n.id === view.id) : undefined;
  const path = note?.path ?? known?.path;
  const folders = path ? dirname(path).split("/").filter(Boolean) : [];
  const current = view.type !== "note" || note || known ? w.title : "";

  /** Destination folders for "Move to…": the vault root, then every folder. */
  const moveItems = (n: { id: string; path: string }): MenuItem[] => {
    const here = dirname(n.path);
    const all = [...w.tree.folders].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return [{ path: "", label: "Vault root" }, ...all.map((f) => ({ path: f, label: f }))].map((f) => ({
      label: f.label,
      checked: f.path === here,
      disabled: f.path === here,
      onSelect: () => actions.moveNote(n.id, f.path),
    }));
  };

  const go = (delta: -1 | 1) => {
    actions.focusGroup(gi);
    if (delta === -1) actions.back();
    else actions.forward();
  };

  const items: MenuItem[] = note
    ? [
        { label: "Open in new tab", onSelect: () => actions.open(note.id, "tab") },
        { label: "Open to the right", onSelect: () => actions.open(note.id, "split") },
        "separator",
        { label: "Rename…", onSelect: () => actions.renameNote(note) },
        {
          label: "Move to…",
          // A second menu at the same button: pick the destination folder.
          onSelect: () => {
            setMoving(true);
            if (moreButton.current) more.openBelow(moreButton.current);
          },
        },
        { label: "Reveal in file explorer", onSelect: () => actions.reveal(note.path) },
        { label: "Copy path", onSelect: () => navigator.clipboard?.writeText(`${note.path}.md`).then(() => actions.notify("Path copied")) },
        { label: "Share…", onSelect: () => openShare(note) }, // vaults-ui
        "separator",
        { label: "Delete note", danger: true, onSelect: () => actions.deleteNote(note) },
      ]
    : [{ label: "Close tab", onSelect: () => actions.closeTab(gi, w.layout.groups[gi].active) }];

  return (
    <div className="hidden h-11 shrink-0 items-center gap-1 px-2 md:flex">
      <IconButton label="Navigate back" shortcut="Ctrl+Alt+←" disabled={!canBack} onClick={() => go(-1)}>
        <ArrowLeft />
      </IconButton>
      <IconButton label="Navigate forward" shortcut="Ctrl+Alt+→" disabled={!canForward} onClick={() => go(1)}>
        <ArrowRight />
      </IconButton>
      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 justify-center px-2">
        <ol className="flex min-w-0 items-center gap-1 text-[13px]">
          {folders.map((f, i) => (
            <li key={i} className="flex min-w-0 items-center gap-1">
              <button
                type="button"
                onClick={() => actions.reveal(`${folders.slice(0, i + 1).join("/")}/x`)}
                translate="no"
                className="truncate rounded px-1 text-faint hover:bg-hover hover:text-fg"
              >
                {f}
              </button>
              <span aria-hidden="true" className="text-faint">
                /
              </span>
            </li>
          ))}
          <li className="min-w-0 truncate px-1 text-muted" aria-current="page" translate={view.type === "note" ? "no" : undefined}>
            {current}
          </li>
        </ol>
      </nav>
      {view.type === "note" && (
        <IconButton
          label={view.mode === "edit" ? "Switch to reading view" : "Switch to editing view"}
          shortcut="Mod+E"
          onClick={() => {
            actions.focusGroup(gi);
            actions.setMode();
          }}
        >
          {view.mode === "edit" ? <BookOpen /> : <Pencil />}
        </IconButton>
      )}
      <IconButton
        ref={moreButton}
        label="More options"
        aria-haspopup="menu"
        aria-expanded={!!more.anchor}
        onClick={(e) => {
          setMoving(false);
          more.openBelow(e.currentTarget);
        }}
      >
        <EllipsisVertical />
      </IconButton>
      {more.anchor && (
        <Menu
          anchor={more.anchor}
          label={moving && note ? `Move ${note.name} to` : "More options"}
          items={moving && note ? moveItems(note) : items}
          onClose={more.close}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

const TITLE_CLASS =
  "block w-full resize-none overflow-hidden rounded-md bg-transparent font-note text-[24px] font-semibold leading-8 tracking-[-0.01em] [overflow-wrap:anywhere] [field-sizing:content] focus-visible:outline-2 focus-visible:outline-offset-4 md:text-[28px] md:leading-9";

/**
 * The note's name as an editable title. Wraps instead of clipping; Enter or
 * blur renames (and rewrites links), Escape cancels.
 */
function InlineTitle({
  id,
  name,
  path,
  inputRef,
  onDone,
}: {
  id: string;
  name: string;
  path: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onDone: () => void;
}) {
  const actions = useWorkspaceActions();
  const [value, setValue] = useState(name);
  const cancelling = useRef(false);
  const folder = dirname(path);

  // Height fallback for browsers without field-sizing: grow with the wrapped text.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el || CSS.supports("field-sizing", "content")) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, [value, inputRef]);

  const commit = () => {
    if (cancelling.current) return;
    const clean = value.trim().replace(/[\\/]/g, "-");
    if (!clean || clean === name) return setValue(name);
    void actions.renameNote({ id, path }, folder ? `${folder}/${clean}` : clean).then((ok) => {
      if (!ok) setValue(name);
    });
  };
  return (
    <h1 className="mb-4">
      <textarea
        ref={inputRef}
        rows={1}
        value={value}
        // A title is one line: pasted line breaks become spaces.
        onChange={(e) => setValue(e.target.value.replace(/\s*[\r\n]+\s*/g, " "))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
            onDone();
          } else if (e.key === "Escape") {
            // blur() fires focusout synchronously; the flag stops that commit.
            cancelling.current = true;
            setValue(name);
            e.currentTarget.blur();
            cancelling.current = false;
          }
        }}
        aria-label="Note title"
        spellCheck={false}
        className={TITLE_CLASS}
      />
    </h1>
  );
}

/* templates-properties */
const HIDE_FRONTMATTER = [hideFrontmatter];
/* end templates-properties */

/** In edit mode the editor owns the text, so the host ignores published text; the reader shows it. */
const sameForMode = (mode: "edit" | "read") => (a: CachedNote | undefined, b: CachedNote | undefined) =>
  a === b || (sameNoteMeta(a, b) && a!.rev === b!.rev && (mode === "edit" || a!.content === b!.content));

function NoteView({ id, mode, gi, focused, onClose }: { id: string; mode: "edit" | "read"; gi: number; focused: boolean; onClose: () => void }) {
  const actions = useWorkspaceActions();
  const note = useWorkspaceSelector((s) => s.notes[id], sameForMode(mode));
  const w = useWorkspaceSelector(
    (s) => ({
      error: s.noteErrors[id],
      known: s.tree.notes.find((n) => n.id === id)?.name,
      handle: s.editorFor(gi),
      exists: s.exists,
      noteNames: s.noteNames,
      tagNames: s.tagNames,
      liveContent: s.liveContent,
      focusTick: s.focusTick,
    }),
    shallowEqual,
  );
  const error = w.error;
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const handle = w.handle;
  const ready = !!note;
  const { peekFocusRequest, clearFocusRequest } = actions;
  /* templates-properties */
  const showProperties = useTemplatePrefs().showProperties;
  const formFrontmatter = showProperties !== "source";
  /* end templates-properties */

  // Focus the note once it has mounted, when the open asked for it (quick switcher, new note, drawer).
  // Wait a frame: a freshly mounted editor can be recreated within the same commit.
  useEffect(() => {
    if (!ready || !focused || !peekFocusRequest(id)) return;
    const raf = requestAnimationFrame(() => {
      const target = peekFocusRequest(id);
      clearFocusRequest(id);
      if (target === "title" || (target && mode === "read")) {
        titleRef.current?.focus();
        if (target === "title") titleRef.current?.select();
      } else if (target) handle.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [id, mode, ready, focused, handle, peekFocusRequest, clearFocusRequest, note?.rev, w.focusTick]);

  if (error && !note) {
    const gone = error.status === 404;
    const offline = error.status === 0;
    const known = w.known;
    return (
      <div className="mx-auto max-w-[42rem] px-6 py-10 md:px-10">
        <h1 className="sr-only">{known ?? "Note"}</h1>
        <p className="text-muted">
          {gone
            ? "This note no longer exists. It was deleted or moved, maybe on another device."
            : offline
              ? error.message
              : "Couldn’t load this note. Try again in a moment."}
        </p>
        <button
          type="button"
          className="mt-3 font-medium text-accent-ink hover:underline"
          onClick={gone ? onClose : () => actions.loadNote(id)}
        >
          {gone ? "Close tab" : "Try again"}
        </button>
      </div>
    );
  }
  if (!note) return <NoteSkeleton />;
  return (
    <div className="mx-auto w-full max-w-[42rem] px-5 pb-8 pt-4 md:px-10 md:pt-6">
      <InlineTitle
        key={note.name}
        id={note.id}
        name={note.name}
        path={note.path}
        inputRef={titleRef}
        onDone={() => (mode === "edit" ? handle.current?.focus() : undefined)}
      />
      {/* templates-properties */}
      {showProperties === "visible" && <Properties id={note.id} gi={gi} mode={mode} />}
      {/* end templates-properties */}
      {mode === "edit" ? (
        <Editor
          // A new rev means the server text replaced what this editor showed: remount with it.
          // templates-properties: switching how frontmatter shows remounts it too.
          key={`${note.id}:${note.rev}:${formFrontmatter ? "form" : "source"}`}
          extensions={formFrontmatter ? HIDE_FRONTMATTER : undefined}
          label={`${note.name}, note text`}
          initial={w.liveContent(note.id)}
          onChange={(c) => actions.onChange(note.id, c)}
          noteNames={w.noteNames}
          tagNames={w.tagNames}
          exists={w.exists}
          onOpenLink={(t, nt) => actions.openLink(t, nt)}
          onOpenTag={actions.openTag}
          handleRef={handle}
        />
      ) : (
        <Reader
          noteId={note.id}
          content={note.content}
          exists={w.exists}
          onOpenLink={actions.openLink}
          onOpenTag={actions.openTag}
          onToggleTask={(c) => actions.onChange(note.id, c)}
          hideFrontmatter={formFrontmatter}
        />
      )}
    </div>
  );
}

/** Placeholder laid out like NoteView: same padding, a title line and 28px text lines, so nothing moves when the note arrives. */
function NoteSkeleton({ label = "Loading note…" }: { label?: string }) {
  return (
    <div className="mx-auto w-full max-w-[42rem] px-5 pb-8 pt-4 md:px-10 md:pt-6" role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className="mb-4 flex h-8 items-center md:h-9">
        <Bar w="45%" h={22} />
      </div>
      {["100%", "92%", "96%", "76%"].map((width, i) => (
        <div key={i} className="flex h-7 items-center">
          <Bar w={width} h={12} />
        </div>
      ))}
    </div>
  );
}

function EmptyView({ gi }: { gi: number }) {
  const actions = useWorkspaceActions();
  const w = useWorkspaceSelector(
    (s) => ({ g: s.layout.groups[gi], noNotes: s.tree.notes.length === 0, treeStatus: s.treeStatus }),
    shallowEqual,
  );
  const g = w.g;
  const rows: [string, string, () => void][] = [
    ["Create new note", "Alt+N", () => actions.newNote("")],
    ["Go to file", "Mod+O", () => actions.setPalette("notes")],
    ["Open today’s daily note", "Mod+D", () => actions.dailyNote()],
    ["Open graph view", "Mod+G", () => actions.openView({ type: "graph" })],
  ];
  return (
    <div className="grid h-full place-items-center px-6 py-12" data-empty-view>
      <div className="w-full max-w-xs">
        <h1 className="mb-4 text-[16px] font-medium">No file is open</h1>
        <ul className="space-y-1">
          {rows.map(([label, keys, run]) => (
            <li key={label}>
              <button type="button" onClick={run} className="flex w-full items-center justify-between gap-4 rounded-md px-2 py-1.5 text-left text-accent-ink hover:bg-sheet-hover">
                {label}
                <Shortcut keys={keys} />
              </button>
            </li>
          ))}
          {g?.tabs.length > 0 && (
            <li>
              <button type="button" onClick={() => actions.closeTab(gi, g.active)} className="w-full rounded-md px-2 py-1.5 text-left text-muted hover:bg-sheet-hover">
                Close tab
              </button>
            </li>
          )}
        </ul>
        {w.noNotes && w.treeStatus === "ready" && (
          <p className="mt-6 text-[13px] leading-5 text-faint">
            Have an Obsidian vault? Import it from Settings, or drop in .md files there. Your files stay plain markdown.
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Group                                                               */
/* ------------------------------------------------------------------ */

export function TabGroup({ gi }: { gi: number }) {
  const actions = useWorkspaceActions();
  const { layout, restoring } = useWorkspaceSelector((s) => ({ layout: s.layout, restoring: s.restoring }), shallowEqual);
  const g = layout.groups[gi];
  const tab = g?.tabs[g.active];
  const view: View = tab ? currentView(tab) : { type: "empty" };
  const title = useWorkspaceSelector((s) => viewTitle(s, view));
  const panelId = useId();
  const focused = layout.focus === gi;
  const last = gi === layout.groups.length - 1;
  // The pane is the transition boundary, so a note switch is clipped to the sheet.
  const viewKey = view.type === "note" ? `note:${view.id}` : view.type;

  return (
    <section
      aria-label={layout.groups.length > 1 ? `Pane ${gi + 1}` : undefined}
      // Phones show one pane only.
      className={`${layout.groups.length > 1 && !focused ? "hidden md:flex" : "flex"} min-w-0 flex-1 flex-col`}
      onPointerDownCapture={() => !focused && actions.focusGroup(gi)}
      onFocusCapture={() => !focused && actions.focusGroup(gi)}
    >
      <TabBar gi={gi} panelId={panelId} last={last} />
      <div
        id={panelId}
        role="tabpanel"
        aria-label={title}
        className={`flex min-h-0 flex-1 flex-col overflow-hidden bg-sheet md:rounded-[16px] md:border md:border-border ${
          last ? "md:mr-2" : ""
        } ${layout.groups.length > 1 && !focused ? "md:opacity-[0.985]" : ""}`}
      >
        <ViewHeader gi={gi} tab={tab} view={view} />
        <ViewTransition key={viewKey} enter="note-in" exit="note-out" default="none">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-scroll-root>
            {view.type === "note" ? (
              <NoteView
                id={view.id}
                mode={view.mode}
                gi={gi}
                focused={focused}
                onClose={() => actions.closeTab(gi, g.active)}
              />
            ) : view.type === "graph" ? (
              <GraphView />
            ) : restoring ? (
              <NoteSkeleton label="Opening your tabs…" />
            ) : (
              <EmptyView gi={gi} />
            )}
          </div>
        </ViewTransition>
      </div>
    </section>
  );
}
