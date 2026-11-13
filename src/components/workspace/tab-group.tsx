"use client";

import { ViewTransition, useEffect, useId, useState, type KeyboardEvent } from "react";
import { ArrowLeft, ArrowRight, BookOpen, EllipsisVertical, GitFork, PanelRight, Pencil, Plus, X } from "lucide-react";
import { useWorkspace, currentView, type View, type Tab } from "./store";
import { Editor } from "./editor";
import { Reader } from "./reader";
import { GraphView } from "./graph-view";
import { Bar, IconButton, Menu, Shortcut, useMenu, type MenuItem } from "./ui";
import { dirname } from "@/lib/markdown/parse";

function useViewTitle() {
  const w = useWorkspace();
  return (v: View) =>
    v.type === "graph" ? "Graph view" : v.type === "empty" ? "New tab" : (w.notes[v.id]?.name ?? w.tree.notes.find((n) => n.id === v.id)?.name ?? "Loading…");
}

/* ------------------------------------------------------------------ */
/* Tab bar                                                             */
/* ------------------------------------------------------------------ */

function TabBar({ gi, panelId, last }: { gi: number; panelId: string; last: boolean }) {
  const w = useWorkspace();
  const g = w.layout.groups[gi];
  const title = useViewTitle();
  const menu = useMenu();
  const [menuTab, setMenuTab] = useState(0);

  const focusTab = (i: number) =>
    requestAnimationFrame(() => document.getElementById(`tab-${g.key}-${i}`)?.focus());

  const onKeyDown = (e: KeyboardEvent, i: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const n = (i + (e.key === "ArrowRight" ? 1 : -1) + g.tabs.length) % g.tabs.length;
      w.actions.activate(gi, n);
      focusTab(n);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const n = e.key === "Home" ? 0 : g.tabs.length - 1;
      w.actions.activate(gi, n);
      focusTab(n);
    } else if (e.key === "Delete") {
      e.preventDefault();
      w.actions.closeTab(gi, i);
    } else if ((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu") {
      e.preventDefault();
      setMenuTab(i);
      menu.openBelow(e.currentTarget);
    }
  };

  const items: MenuItem[] = [
    { label: "Close", shortcut: "Alt+W", onSelect: () => w.actions.closeTab(gi, menuTab) },
    { label: "Close others", onSelect: () => w.actions.closeOthers(gi, menuTab), disabled: g.tabs.length < 2 },
    "separator",
    { label: "Open to the right", onSelect: () => w.actions.splitTab(gi, menuTab) },
  ];

  return (
    <div className="hidden h-10 shrink-0 items-end gap-1 pr-2 md:flex">
      <div role="tablist" aria-label={w.layout.groups.length > 1 ? `Tabs, group ${gi + 1}` : "Tabs"} className="flex min-w-0 items-end gap-0.5 overflow-x-auto">
        {g.tabs.map((t: Tab, i) => {
          const selected = i === g.active;
          const v = currentView(t);
          return (
            <div key={t.key} className="group relative flex shrink-0 items-center">
              <button
                id={`tab-${g.key}-${i}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                onClick={() => w.actions.activate(gi, i)}
                onAuxClick={(e) => e.button === 1 && w.actions.closeTab(gi, i)}
                onKeyDown={(e) => onKeyDown(e, i)}
                onContextMenu={(e) => {
                  setMenuTab(i);
                  menu.openAt(e);
                }}
                className={`relative flex h-9 max-w-56 items-center gap-1.5 rounded-t-lg pl-3 pr-8 text-[13px] outline-offset-[-2px] transition-colors ${
                  selected
                    ? "z-10 -mb-px border border-b-0 border-border bg-sheet text-fg"
                    : "text-muted hover:bg-hover hover:text-fg"
                }`}
              >
                {selected && w.layout.focus === gi && (
                  <span aria-hidden="true" className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-accent" />
                )}
                {v.type === "graph" && <GitFork aria-hidden="true" className="size-3.5 shrink-0 stroke-[1.5] text-faint" />}
                <span className="truncate">{title(v)}</span>
              </button>
              <button
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                title="Close tab"
                onClick={() => w.actions.closeTab(gi, i)}
                className={`absolute right-1.5 top-1/2 z-20 grid size-5 -translate-y-1/2 place-items-center rounded text-faint transition-opacity hover:bg-hover hover:text-fg ${
                  selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}
              >
                <X className="size-3.5 stroke-[1.5]" />
              </button>
            </div>
          );
        })}
      </div>
      <IconButton label="New tab" shortcut="Alt+T" className="mb-0.5 size-7" onClick={() => w.actions.openView({ type: "empty" }, "tab")}>
        <Plus />
      </IconButton>
      <div className="flex-1" />
      {last && (
        <IconButton
          label={w.prefs.rightOpen ? "Hide right sidebar" : "Show right sidebar"}
          aria-pressed={w.prefs.rightOpen}
          className="mb-0.5 hidden lg:inline-flex"
          onClick={() => w.actions.showRight()}
        >
          <PanelRight />
        </IconButton>
      )}
      {menu.anchor && <Menu anchor={menu.anchor} label="Tab actions" items={items} onClose={menu.close} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* View header: back, forward, breadcrumb, mode, more options          */
/* ------------------------------------------------------------------ */

function ViewHeader({ gi, tab, view }: { gi: number; tab?: Tab; view: View }) {
  const w = useWorkspace();
  const title = useViewTitle();
  const more = useMenu();
  const note = view.type === "note" ? w.notes[view.id] : undefined;
  const canBack = !!tab && tab.index > 0;
  const canForward = !!tab && tab.index < tab.history.length - 1;
  const folders = note ? dirname(note.path).split("/").filter(Boolean) : [];

  const go = (delta: -1 | 1) => {
    w.actions.focusGroup(gi);
    if (delta === -1) w.actions.back();
    else w.actions.forward();
  };

  const items: MenuItem[] = note
    ? [
        { label: "Open in new tab", onSelect: () => w.actions.open(note.id, "tab") },
        { label: "Open to the right", onSelect: () => w.actions.open(note.id, "split") },
        "separator",
        { label: "Rename…", onSelect: () => w.actions.renameNote(note) },
        { label: "Move to…", onSelect: () => w.actions.renameNote(note) },
        { label: "Reveal in file explorer", onSelect: () => w.actions.reveal(note.path) },
        { label: "Copy path", onSelect: () => navigator.clipboard?.writeText(`${note.path}.md`).then(() => w.actions.notify("Path copied")) },
        "separator",
        { label: "Delete note", danger: true, onSelect: () => w.actions.deleteNote(note) },
      ]
    : [{ label: "Close tab", onSelect: () => w.actions.closeTab(gi, w.layout.groups[gi].active) }];

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
                onClick={() => w.actions.reveal(`${folders.slice(0, i + 1).join("/")}/x`)}
                className="truncate rounded px-1 text-faint hover:bg-hover hover:text-fg"
              >
                {f}
              </button>
              <span aria-hidden="true" className="text-faint">
                /
              </span>
            </li>
          ))}
          <li className="min-w-0 truncate px-1 text-muted" aria-current="page">
            {title(view)}
          </li>
        </ol>
      </nav>
      {view.type === "note" && (
        <IconButton
          label={view.mode === "edit" ? "Switch to reading view" : "Switch to editing view"}
          shortcut="Ctrl+E"
          onClick={() => {
            w.actions.focusGroup(gi);
            w.actions.setMode();
          }}
        >
          {view.mode === "edit" ? <BookOpen /> : <Pencil />}
        </IconButton>
      )}
      <IconButton label="More options" aria-haspopup="menu" onClick={(e) => more.openBelow(e.currentTarget)}>
        <EllipsisVertical />
      </IconButton>
      {more.anchor && <Menu anchor={more.anchor} label="More options" items={items} onClose={more.close} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

function InlineTitle({ id, name, path }: { id: string; name: string; path: string }) {
  const w = useWorkspace();
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]); // eslint-disable-line react-hooks/set-state-in-effect -- follow an external rename
  const folder = dirname(path);
  const commit = () => {
    const clean = value.trim().replace(/[\\/]/g, "-");
    if (!clean || clean === name) return setValue(name);
    void w.actions.renameNote({ id, path }, folder ? `${folder}/${clean}` : clean);
  };
  return (
    <h1 className="mb-4">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
            w.editor.current?.focus();
          }
          if (e.key === "Escape") {
            setValue(name);
            (e.target as HTMLInputElement).blur();
          }
        }}
        aria-label="Note title"
        spellCheck={false}
        className="w-full rounded-md bg-transparent font-note text-[30px] font-semibold leading-tight tracking-[-0.01em] outline-none focus-visible:outline-2 focus-visible:outline-offset-4"
      />
    </h1>
  );
}

function NoteView({ id, mode, focused }: { id: string; mode: "edit" | "read"; focused: boolean }) {
  const w = useWorkspace();
  const note = w.notes[id];
  const error = w.noteErrors[id];
  if (error && !note)
    return (
      <div className="mx-auto max-w-[42rem] px-6 py-10 md:px-10">
        <p className="text-muted">{error}</p>
        <button type="button" className="mt-3 font-medium text-accent-ink hover:underline" onClick={() => w.actions.loadNote(id)}>
          Try again
        </button>
      </div>
    );
  if (!note)
    return (
      <div className="mx-auto max-w-[42rem] space-y-4 px-6 pt-6 md:px-10" aria-label="Loading note">
        <Bar w="45%" h={30} />
        <Bar w="100%" h={14} />
        <Bar w="92%" h={14} />
        <Bar w="76%" h={14} />
      </div>
    );
  return (
    <ViewTransition key={id} enter="note-in" exit="note-out" default="none">
      <div className="mx-auto w-full max-w-[42rem] px-5 pb-8 pt-4 md:px-10 md:pt-6">
        <InlineTitle id={note.id} name={note.name} path={note.path} />
        {mode === "edit" ? (
          <Editor
            key={note.id}
            label={`${note.name}, note text`}
            initial={note.content}
            onChange={(c) => w.actions.onChange(note.id, c)}
            noteNames={w.noteNames}
            tagNames={w.tagNames}
            exists={w.exists}
            onOpenLink={(t, nt) => w.actions.openLink(t, nt)}
            onOpenTag={w.actions.openTag}
            handleRef={focused ? w.editor : undefined}
          />
        ) : (
          <Reader
            content={note.content}
            exists={w.exists}
            onOpenLink={w.actions.openLink}
            onOpenTag={w.actions.openTag}
            onToggleTask={(c) => w.actions.onChange(note.id, c)}
          />
        )}
      </div>
    </ViewTransition>
  );
}

function EmptyView({ gi }: { gi: number }) {
  const w = useWorkspace();
  const g = w.layout.groups[gi];
  const rows: [string, string, () => void][] = [
    ["Create new note", "Alt+N", () => w.actions.newNote("")],
    ["Go to file", "Mod+O", () => w.actions.setPalette("notes")],
    ["Open today’s daily note", "Mod+D", () => w.actions.dailyNote()],
    ["Open graph view", "Mod+G", () => w.actions.openView({ type: "graph" })],
  ];
  return (
    <div className="grid h-full place-items-center px-6 py-12">
      <div className="w-full max-w-xs">
        <h2 className="mb-4 text-[16px] font-medium">No file is open</h2>
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
              <button type="button" onClick={() => w.actions.closeTab(gi, g.active)} className="w-full rounded-md px-2 py-1.5 text-left text-muted hover:bg-sheet-hover">
                Close
              </button>
            </li>
          )}
        </ul>
        {w.tree.notes.length === 0 && w.treeStatus === "ready" && (
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
  const w = useWorkspace();
  const g = w.layout.groups[gi];
  const tab = g?.tabs[g.active];
  const view: View = tab ? currentView(tab) : { type: "empty" };
  const panelId = useId();
  const focused = w.layout.focus === gi;
  const last = gi === w.layout.groups.length - 1;
  const title = useViewTitle();

  return (
    <section
      aria-label={w.layout.groups.length > 1 ? `Pane ${gi + 1}` : undefined}
      className="flex min-w-0 flex-1 flex-col"
      onPointerDownCapture={() => !focused && w.actions.focusGroup(gi)}
      onFocusCapture={() => !focused && w.actions.focusGroup(gi)}
    >
      <TabBar gi={gi} panelId={panelId} last={last} />
      <div
        id={panelId}
        role="tabpanel"
        aria-label={title(view)}
        className={`flex min-h-0 flex-1 flex-col overflow-hidden bg-sheet md:rounded-[14px] md:border md:border-border ${
          last ? "md:mr-2" : ""
        } ${w.layout.groups.length > 1 && !focused ? "md:opacity-[0.985]" : ""}`}
      >
        <ViewHeader gi={gi} tab={tab} view={view} />
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-scroll-root>
          {view.type === "note" ? (
            <NoteView id={view.id} mode={view.mode} focused={focused} />
          ) : view.type === "graph" ? (
            <GraphView />
          ) : (
            <EmptyView gi={gi} />
          )}
        </div>
      </div>
    </section>
  );
}
