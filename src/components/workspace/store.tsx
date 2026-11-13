"use client";

import {
  createContext,
  startTransition,
  use,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, ApiError, type FullNote, type Tree, type TreeNote } from "./api";
import { useDialogs, type DialogApi } from "./dialogs";
import type { Toast } from "./ui";
import type { EditorHandle } from "./editor";
import { basename, dirname, linkKey } from "@/lib/markdown/parse";
import { signOut } from "@/lib/auth-client";

/* ------------------------------------------------------------------ */
/* Layout model: tab groups (max two, side by side), tabs with history */
/* ------------------------------------------------------------------ */

export type NoteMode = "edit" | "read";
export type View = { type: "note"; id: string; mode: NoteMode } | { type: "graph" } | { type: "empty" };
export type Tab = { key: string; history: View[]; index: number };
export type Group = { key: string; tabs: Tab[]; active: number };
export type Layout = { groups: Group[]; focus: number };
export type OpenTarget = "current" | "tab" | "split";

let seq = 0;
const uid = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;
export const currentView = (t: Tab): View => t.history[t.index];
const sameView = (a: View, b: View) => a.type === b.type && (a.type !== "note" || (b.type === "note" && a.id === b.id));
const newTab = (view: View): Tab => ({ key: uid(), history: [view], index: 0 });
const newGroup = (tabs: Tab[] = []): Group => ({ key: uid(), tabs, active: 0 });
const HISTORY_CAP = 60;

function pushView(tab: Tab, view: View): Tab {
  const cur = currentView(tab);
  if (sameView(cur, view)) return tab;
  const history = [...tab.history.slice(0, tab.index + 1), view].slice(-HISTORY_CAP);
  return { ...tab, history, index: history.length - 1 };
}

type Action =
  | { type: "open"; view: View; target: OpenTarget }
  | { type: "activate"; group: number; tab: number }
  | { type: "close"; group: number; tab: number }
  | { type: "closeOthers"; group: number; tab: number }
  | { type: "history"; delta: -1 | 1 }
  | { type: "mode"; mode?: NoteMode }
  | { type: "focus"; group: number }
  | { type: "drop"; ids: Set<string> }
  | { type: "replace"; layout: Layout };

function clone(s: Layout): Layout {
  return { focus: s.focus, groups: s.groups.map((g) => ({ ...g, tabs: [...g.tabs] })) };
}

function layoutReducer(state: Layout, a: Action): Layout {
  switch (a.type) {
    case "open": {
      const s = clone(state);
      if (a.target === "split") {
        if (s.groups.length < 2) {
          s.groups.push(newGroup([newTab(a.view)]));
          return { ...s, focus: s.groups.length - 1 };
        }
        const gi = s.focus === 0 ? 1 : 0;
        const g = s.groups[gi];
        g.tabs.push(newTab(a.view));
        g.active = g.tabs.length - 1;
        return { ...s, focus: gi };
      }
      if (!s.groups.length) s.groups.push(newGroup());
      const gi = Math.min(s.focus, s.groups.length - 1);
      const g = s.groups[gi];
      const cur = g.tabs[g.active];
      if (!cur) {
        g.tabs = [newTab(a.view)];
        g.active = 0;
      } else if (a.target === "tab" && currentView(cur).type !== "empty") {
        g.tabs.splice(g.active + 1, 0, newTab(a.view));
        g.active += 1;
      } else {
        g.tabs[g.active] = pushView(cur, a.view);
      }
      return { ...s, focus: gi };
    }
    case "activate": {
      const s = clone(state);
      const g = s.groups[a.group];
      if (!g || !g.tabs[a.tab]) return state;
      g.active = a.tab;
      return { ...s, focus: a.group };
    }
    case "focus":
      return a.group === state.focus || !state.groups[a.group] ? state : { ...state, focus: a.group };
    case "close": {
      const s = clone(state);
      const g = s.groups[a.group];
      if (!g) return state;
      g.tabs.splice(a.tab, 1);
      if (a.tab < g.active || g.active >= g.tabs.length) g.active = Math.max(0, g.active - 1);
      if (!g.tabs.length && s.groups.length > 1) {
        s.groups.splice(a.group, 1);
        return { ...s, focus: 0 };
      }
      return s;
    }
    case "closeOthers": {
      const s = clone(state);
      const g = s.groups[a.group];
      if (!g?.tabs[a.tab]) return state;
      g.tabs = [g.tabs[a.tab]];
      g.active = 0;
      return { ...s, focus: a.group };
    }
    case "history": {
      const s = clone(state);
      const g = s.groups[s.focus];
      const t = g?.tabs[g.active];
      if (!t) return state;
      const index = t.index + a.delta;
      if (index < 0 || index >= t.history.length) return state;
      g.tabs[g.active] = { ...t, index };
      return s;
    }
    case "mode": {
      const s = clone(state);
      const g = s.groups[s.focus];
      const t = g?.tabs[g.active];
      const v = t && currentView(t);
      if (!t || !v || v.type !== "note") return state;
      const mode = a.mode ?? (v.mode === "edit" ? "read" : "edit");
      const history = [...t.history];
      history[t.index] = { ...v, mode };
      g.tabs[g.active] = { ...t, history };
      return s;
    }
    case "drop": {
      const s = clone(state);
      for (const g of s.groups) {
        g.tabs = g.tabs.map((t) => {
          const kept = t.history.filter((v) => v.type !== "note" || !a.ids.has(v.id));
          if (kept.length === t.history.length) return t;
          const history = kept.length ? kept : [{ type: "empty" } as View];
          return { ...t, history, index: Math.min(t.index, history.length - 1) };
        });
      }
      return s;
    }
    case "replace":
      return a.layout;
  }
}

/* ------------------------------------------------------------------ */
/* Persisted preferences                                               */
/* ------------------------------------------------------------------ */

export type LeftView = "files" | "search";
export type RightView = "backlinks" | "outgoing" | "tags" | "outline";
export type SaveState = "saved" | "dirty" | "saving" | "error";
export type SortOrder = "name-asc" | "name-desc" | "modified-desc" | "modified-asc";
export type Theme = "system" | "light" | "dark";
export type Drawer = "left" | "right" | null;
export type PaletteMode = "notes" | "commands" | null;

type Prefs = {
  leftOpen: boolean;
  leftView: LeftView;
  rightOpen: boolean;
  rightView: RightView;
  sort: SortOrder;
  expanded: string[];
};
const PREFS_KEY = "nexus-prefs";
const LAYOUT_KEY = "nexus-layout";
const defaultPrefs: Prefs = {
  leftOpen: true,
  leftView: "files",
  rightOpen: true,
  rightView: "backlinks",
  sort: "name-asc",
  expanded: [],
};

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const SAVE_DELAY = 700;

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

export type User = { name: string; email: string };

type WorkspaceValue = ReturnType<typeof useWorkspaceState>;
const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace() {
  const v = use(WorkspaceContext);
  if (!v) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return v;
}

export function WorkspaceProvider({ user, children }: { user: User; children: ReactNode }) {
  const value = useWorkspaceState(user);
  return (
    <WorkspaceContext value={value}>
      {children}
      {value.dialogNode}
    </WorkspaceContext>
  );
}

function useWorkspaceState(user: User) {
  const { api: dialog, node: dialogNode } = useDialogs();

  const [tree, setTree] = useState<Tree>({ notes: [], folders: [] });
  const [treeStatus, setTreeStatus] = useState<"loading" | "ready" | "error">("loading");
  const [notes, setNotes] = useState<Record<string, FullNote>>({});
  const [noteErrors, setNoteErrors] = useState<Record<string, string>>({});
  const [layout, dispatch] = useReducer(layoutReducer, { groups: [newGroup()], focus: 0 });
  const [prefs, setPrefs] = useState<Prefs>(defaultPrefs);
  const [save, setSave] = useState<SaveState>("saved");
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [palette, setPalette] = useState<PaletteMode>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [version, setVersion] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [theme, setThemeState] = useState<Theme>("system");
  const pending = useRef(new Map<string, { content: string; timer: ReturnType<typeof setTimeout> }>());
  const restored = useRef(false);
  const toastSeq = useRef(0);
  const editor = useRef<EditorHandle | null>(null);

  /* ---------------- derived ---------------- */

  const focusGroup = layout.groups[layout.focus] ?? layout.groups[0];
  const focusTab = focusGroup?.tabs[focusGroup.active];
  const focusView: View = useMemo(() => (focusTab ? currentView(focusTab) : { type: "empty" }), [focusTab]);
  const activeNote = focusView.type === "note" ? notes[focusView.id] : undefined;

  const index = useMemo(() => {
    const byPath = new Map<string, TreeNote>();
    const byName = new Map<string, TreeNote>();
    const byId = new Map<string, TreeNote>();
    for (const n of [...tree.notes].sort((a, b) => b.path.length - a.path.length)) {
      byPath.set(n.path.toLowerCase(), n);
      byName.set(n.name.toLowerCase(), n);
      byId.set(n.id, n);
    }
    return { byPath, byName, byId };
  }, [tree.notes]);

  const findNote = useCallback(
    (target: string) => {
      const k = linkKey(target);
      return index.byPath.get(k) ?? index.byName.get(basename(k));
    },
    [index],
  );
  const exists = useCallback((t: string) => !!findNote(t), [findNote]);
  const noteNames = useCallback(() => tree.notes.map((n) => n.name), [tree.notes]);
  const tagCache = useRef<string[]>([]);
  useEffect(() => {
    api
      .tags()
      .then((t) => (tagCache.current = t.map((x) => x.tag)))
      .catch(() => {});
  }, [version]);
  const tagNames = useCallback(() => tagCache.current, []);

  /* ---------------- feedback ---------------- */

  const notify = useCallback((message: string, action?: Toast["action"]) => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t.slice(-2), { id, message, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 6000 : 3500);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const fail = useCallback((e: unknown) => notify(e instanceof Error ? e.message : "Something went wrong"), [notify]);

  /* ---------------- loading ---------------- */

  const refreshTree = useCallback(async () => {
    const t = await api.tree();
    setTree(t);
    setTreeStatus("ready");
    return t;
  }, []);

  const loadNote = useCallback(async (id: string) => {
    try {
      const fresh = await api.get(id);
      // Keep unsaved local edits; take server metadata (backlinks, path) as fresh.
      setNotes((m) => ({ ...m, [id]: m[id] && pending.current.has(id) ? { ...fresh, content: m[id].content } : fresh }));
      setNoteErrors((e) => {
        if (!(id in e)) return e;
        const { [id]: _, ...rest } = e;
        void _;
        return rest;
      });
      return fresh;
    } catch (err) {
      setNoteErrors((e) => ({ ...e, [id]: err instanceof ApiError ? err.message : "Couldn’t load this note." }));
      return null;
    }
  }, []);

  /* ---------------- navigation ---------------- */

  const openView = useCallback((view: View, target: OpenTarget = "current") => {
    setDrawer(null);
    startTransition(() => dispatch({ type: "open", view, target }));
  }, []);

  const open = useCallback(
    async (id: string, target: OpenTarget = "current", mode: NoteMode = "edit") => {
      setDrawer(null);
      const cached = notes[id];
      if (!cached) await loadNote(id);
      else void loadNote(id); // refresh backlinks in the background
      startTransition(() => dispatch({ type: "open", view: { type: "note", id, mode }, target }));
    },
    [notes, loadNote],
  );

  const back = useCallback(() => startTransition(() => dispatch({ type: "history", delta: -1 })), []);
  const forward = useCallback(() => startTransition(() => dispatch({ type: "history", delta: 1 })), []);
  const setMode = useCallback((mode?: NoteMode) => dispatch({ type: "mode", mode }), []);
  const activate = useCallback(
    (group: number, tab: number) => startTransition(() => dispatch({ type: "activate", group, tab })),
    [],
  );
  const focusGroupAt = useCallback((group: number) => dispatch({ type: "focus", group }), []);
  const closeTab = useCallback(
    (group: number, tab: number) => {
      const t = layout.groups[group]?.tabs[tab];
      const v = t && currentView(t);
      if (v?.type === "note") void flush(v.id);
      dispatch({ type: "close", group, tab });
    },
    // flush is declared below and stable; listing layout keeps the closure current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout],
  );
  const closeOthers = useCallback((group: number, tab: number) => dispatch({ type: "closeOthers", group, tab }), []);
  const splitTab = useCallback(
    (group: number, tab: number) => {
      const t = layout.groups[group]?.tabs[tab];
      if (t) openView(currentView(t), "split");
    },
    [layout, openView],
  );
  const cycleTab = useCallback(
    (delta: 1 | -1) => {
      const g = layout.groups[layout.focus];
      if (!g || g.tabs.length < 2) return;
      activate(layout.focus, (g.active + delta + g.tabs.length) % g.tabs.length);
    },
    [layout, activate],
  );

  /* ---------------- saving ---------------- */

  const flush = useCallback(async (id: string) => {
    const p = pending.current.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.current.delete(id);
    setSave("saving");
    try {
      const r = await api.save(id, p.content);
      setNotes((m) => (m[id] ? { ...m, [id]: { ...m[id], updatedAt: r.updatedAt } } : m));
      setSave(pending.current.size ? "dirty" : "saved");
      setVersion((v) => v + 1);
    } catch {
      setSave("error");
      if (!pending.current.has(id))
        pending.current.set(id, { content: p.content, timer: setTimeout(() => void flush(id), 3000) });
    }
  }, []);

  const onChange = useCallback(
    (id: string, content: string) => {
      setNotes((m) => (m[id] ? { ...m, [id]: { ...m[id], content } } : m));
      const prev = pending.current.get(id);
      if (prev) clearTimeout(prev.timer);
      pending.current.set(id, { content, timer: setTimeout(() => void flush(id), SAVE_DELAY) });
      setSave("dirty");
    },
    [flush],
  );

  // Never lose an edit: flush when the tab hides or the page unloads.
  useEffect(() => {
    const flushAll = () => {
      for (const [id, p] of pending.current) {
        clearTimeout(p.timer);
        fetch(`/api/notes/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: p.content }),
          keepalive: true,
        });
      }
      pending.current.clear();
    };
    const onHide = () => document.visibilityState === "hidden" && flushAll();
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pending.current.size) {
        flushAll();
        e.preventDefault();
      }
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

  /* ---------------- first load: tree, prefs, layout, URL ---------------- */

  useEffect(() => {
    setPrefs(readJSON(PREFS_KEY, defaultPrefs));
    try {
      const t = localStorage.getItem("nexus-theme");
      setThemeState(t === "light" || t === "dark" ? t : "system");
    } catch {}
    (async () => {
      let t: Tree;
      try {
        t = await refreshTree();
      } catch {
        setTreeStatus("error");
        return;
      }
      const ids = new Set(t.notes.map((n) => n.id));
      const saved = readJSON<Layout | null>(LAYOUT_KEY, null);
      const valid = (v: View) => v.type !== "note" || ids.has(v.id);
      let next: Layout | null = null;
      if (saved?.groups?.length) {
        const groups = saved.groups
          .map((g) => {
            const tabs = g.tabs
              .map((tb) => {
                const history = tb.history.filter(valid);
                return history.length ? { ...tb, history, index: Math.min(tb.index, history.length - 1) } : null;
              })
              .filter((x): x is Tab => !!x);
            return { ...g, tabs, active: Math.min(g.active, Math.max(0, tabs.length - 1)) };
          })
          .filter((g, i) => g.tabs.length || i === 0);
        next = { groups, focus: Math.min(saved.focus, groups.length - 1) };
      }
      const fromUrl = new URLSearchParams(window.location.search).get("n");
      if (next) dispatch({ type: "replace", layout: next });
      const toLoad = new Set<string>();
      next?.groups.forEach((g) => g.tabs.forEach((tb) => {
        const v = currentView(tb);
        if (v.type === "note") toLoad.add(v.id);
      }));
      await Promise.all([...toLoad].map((id) => loadNote(id)));
      if (fromUrl && ids.has(fromUrl)) {
        await loadNote(fromUrl);
        dispatch({ type: "open", view: { type: "note", id: fromUrl, mode: "edit" }, target: "current" });
      } else if (!next?.groups.some((g) => g.tabs.length) && t.notes[0]) {
        const recent = [...t.notes].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))[0];
        await loadNote(recent.id);
        dispatch({ type: "open", view: { type: "note", id: recent.id, mode: "edit" }, target: "current" });
      }
      restored.current = true;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist layout and preferences.
  useEffect(() => {
    if (restored.current) writeJSON(LAYOUT_KEY, layout);
  }, [layout]);
  useEffect(() => {
    if (restored.current) writeJSON(PREFS_KEY, prefs);
  }, [prefs]);

  // Keep ?n= in sync so the open note can be bookmarked or shared across devices.
  useEffect(() => {
    const url = new URL(window.location.href);
    const id = focusView.type === "note" ? focusView.id : null;
    if (url.searchParams.get("n") === id) return;
    if (id) url.searchParams.set("n", id);
    else url.searchParams.delete("n");
    window.history.replaceState(null, "", url);
  }, [focusView]);

  // Load notes that become visible (restored tabs, history steps) and are not cached yet.
  useEffect(() => {
    for (const g of layout.groups) {
      for (const tb of g.tabs) {
        const v = currentView(tb);
        if (v.type === "note" && !notes[v.id] && !noteErrors[v.id]) void loadNote(v.id);
      }
    }
  }, [layout, notes, noteErrors, loadNote]);

  /* ---------------- note actions ---------------- */

  const createAndOpen = useCallback(
    async (path: string, content = "", target: OpenTarget = "current") => {
      try {
        const n = await api.create(path, content);
        await refreshTree();
        await open(n.id, target);
        setTimeout(() => editor.current?.focus(), 60);
        return n;
      } catch (e) {
        fail(e);
        return null;
      }
    },
    [open, refreshTree, fail],
  );

  const openLink = useCallback(
    async (target: string, newTab = false) => {
      const t = newTab ? "tab" : "current";
      const hit = findNote(target);
      if (hit) return open(hit.id, t);
      try {
        const res = await api.resolve(target, true);
        if (!res.id) return;
        await refreshTree();
        await open(res.id, t);
        if (res.created) notify(`Created “${basename(target)}”`);
      } catch (e) {
        fail(e);
      }
    },
    [findNote, open, refreshTree, notify, fail],
  );

  const newNote = useCallback(
    async (folder = "") => {
      const name = await dialog.prompt({
        title: "New note",
        label: "Name",
        value: "Untitled",
        confirm: "Create note",
        hint: folder ? `In ${folder}` : "Use / to put it in a folder, for example Projects/Roadmap",
      });
      if (name) await createAndOpen(folder ? `${folder}/${name}` : name);
    },
    [dialog, createAndOpen],
  );

  const dailyNote = useCallback(async () => {
    const d = new Date();
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    try {
      const res = await api.resolve(`Daily/${iso}`, true, `# ${iso}\n\n`);
      if (!res.id) return;
      if (res.created) await refreshTree();
      await open(res.id);
      setTimeout(() => editor.current?.focus(), 60);
    } catch (e) {
      fail(e);
    }
  }, [open, refreshTree, fail]);

  const renameNote = useCallback(
    async (n: { id: string; path: string }, nextPath?: string) => {
      const target =
        nextPath ??
        (await dialog.prompt({
          title: "Rename note",
          label: "Name or path",
          value: n.path,
          confirm: "Rename",
          hint: "Links to this note are updated everywhere.",
        }));
      if (!target || target === n.path) return;
      await flush(n.id);
      try {
        const res = await api.rename(n.id, target);
        await refreshTree();
        setNotes((m) => {
          const next: Record<string, FullNote> = {};
          for (const [k, v] of Object.entries(m)) if (k === n.id || pending.current.has(k)) next[k] = v;
          if (next[n.id]) next[n.id] = { ...next[n.id], path: res.path, name: res.name };
          return next;
        });
        setVersion((v) => v + 1);
        if (res.updatedLinks)
          notify(`Renamed. Updated links in ${res.updatedLinks} ${res.updatedLinks === 1 ? "note" : "notes"}`);
      } catch (e) {
        fail(e);
      }
    },
    [dialog, flush, refreshTree, notify, fail],
  );

  const deleteNote = useCallback(
    async (n: { id: string; name: string }) => {
      const ok = await dialog.confirm({
        title: `Delete “${n.name}”?`,
        body: "The note is removed from this vault. Links to it stay in other notes and show as not created yet.",
        confirm: "Delete note",
        danger: true,
      });
      if (!ok) return;
      const p = pending.current.get(n.id);
      if (p) clearTimeout(p.timer);
      pending.current.delete(n.id);
      try {
        await api.remove(n.id);
        dispatch({ type: "drop", ids: new Set([n.id]) });
        setNotes((m) => {
          const { [n.id]: _, ...rest } = m;
          void _;
          return rest;
        });
        await refreshTree();
        setVersion((v) => v + 1);
        notify(`Deleted “${n.name}”`);
      } catch (e) {
        fail(e);
      }
    },
    [dialog, refreshTree, notify, fail],
  );

  const moveNote = useCallback(
    (id: string, folder: string) => {
      const n = index.byId.get(id);
      if (!n || dirname(n.path) === folder) return;
      void renameNote(n, folder ? `${folder}/${n.name}` : n.name);
    },
    [index, renameNote],
  );

  const newFolder = useCallback(
    async (parent = "") => {
      const name = await dialog.prompt({ title: "New folder", label: "Name", confirm: "Create folder", hint: parent ? `In ${parent}` : undefined });
      if (!name) return;
      try {
        await api.mkdir(parent ? `${parent}/${name}` : name);
        await refreshTree();
        setPrefs((p) => ({ ...p, expanded: [...new Set([...p.expanded, parent].filter(Boolean))] }));
      } catch (e) {
        fail(e);
      }
    },
    [dialog, refreshTree, fail],
  );

  const renameFolder = useCallback(
    async (path: string) => {
      const to = await dialog.prompt({ title: "Rename folder", label: "Name or path", value: path, confirm: "Rename" });
      if (!to || to === path) return;
      for (const id of [...pending.current.keys()]) await flush(id);
      try {
        await api.mvdir(path, to);
        await refreshTree();
        setNotes({});
        setVersion((v) => v + 1);
      } catch (e) {
        fail(e);
      }
    },
    [dialog, flush, refreshTree, fail],
  );

  const deleteFolder = useCallback(
    async (path: string) => {
      const inside = tree.notes.filter((n) => n.path.startsWith(`${path}/`));
      const ok = await dialog.confirm({
        title: `Delete folder “${basename(path)}”?`,
        body: inside.length
          ? `${inside.length} ${inside.length === 1 ? "note" : "notes"} inside it will be deleted too.`
          : "The folder is empty.",
        confirm: "Delete folder",
        danger: true,
      });
      if (!ok) return;
      try {
        await api.rmdir(path);
        dispatch({ type: "drop", ids: new Set(inside.map((n) => n.id)) });
        await refreshTree();
        setVersion((v) => v + 1);
      } catch (e) {
        fail(e);
      }
    },
    [dialog, tree.notes, refreshTree, fail],
  );

  /* ---------------- panels ---------------- */

  const isWide = (q: string) => typeof window !== "undefined" && window.matchMedia(q).matches;

  const showLeft = useCallback((view?: LeftView) => {
    if (isWide("(min-width: 768px)")) {
      setPrefs((p) => (view && (!p.leftOpen || p.leftView !== view) ? { ...p, leftOpen: true, leftView: view } : view ? p : { ...p, leftOpen: !p.leftOpen }));
    } else {
      if (view) setPrefs((p) => ({ ...p, leftView: view }));
      setDrawer((d) => (d === "left" && !view ? null : "left"));
    }
  }, []);

  const showRight = useCallback((view?: RightView) => {
    if (isWide("(min-width: 1024px)")) {
      setPrefs((p) => (view && (!p.rightOpen || p.rightView !== view) ? { ...p, rightOpen: true, rightView: view } : view ? p : { ...p, rightOpen: !p.rightOpen }));
    } else {
      if (view) setPrefs((p) => ({ ...p, rightView: view }));
      setDrawer((d) => (d === "right" && !view ? null : "right"));
    }
  }, []);

  const setLeftView = useCallback((leftView: LeftView) => setPrefs((p) => ({ ...p, leftView })), []);
  const setRightView = useCallback((rightView: RightView) => setPrefs((p) => ({ ...p, rightView })), []);
  const setSort = useCallback((sort: SortOrder) => setPrefs((p) => ({ ...p, sort })), []);
  const setExpanded = useCallback(
    (fn: (s: Set<string>) => Set<string>) => setPrefs((p) => ({ ...p, expanded: [...fn(new Set(p.expanded))] })),
    [],
  );

  const searchFor = useCallback(
    (q: string) => {
      setSearchQuery(q);
      showLeft("search");
    },
    [showLeft],
  );

  const openTag = useCallback(
    (tag: string) => {
      setSelectedTag(tag);
      showRight("tags");
    },
    [showRight],
  );

  const reveal = useCallback(
    (path: string) => {
      const parts = path.split("/");
      setExpanded((s) => {
        parts.slice(0, -1).forEach((_, i) => s.add(parts.slice(0, i + 1).join("/")));
        return s;
      });
      showLeft("files");
    },
    [setExpanded, showLeft],
  );

  /* ---------------- vault & account ---------------- */

  const importFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      notify("Importing…");
      try {
        const r = await api.importFiles(files);
        await refreshTree();
        setNotes({});
        setVersion((v) => v + 1);
        notify(`Imported ${r.created} new and ${r.updated} updated ${r.created + r.updated === 1 ? "note" : "notes"}`);
      } catch (e) {
        fail(e);
      }
    },
    [notify, refreshTree, fail],
  );

  // A file download from an API route, not a page navigation.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  const exportVault = useCallback(() => window.location.assign("/api/vault/export"), []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    const root = document.documentElement;
    if (t === "system") delete root.dataset.theme;
    else root.dataset.theme = t;
    try {
      if (t === "system") localStorage.removeItem("nexus-theme");
      else localStorage.setItem("nexus-theme", t);
    } catch {}
  }, []);

  const logout = useCallback(async () => {
    for (const id of [...pending.current.keys()]) await flush(id);
    await signOut();
    // A full reload clears every cached note from memory after signing out.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }, [flush]);

  return {
    user,
    dialog: dialog as DialogApi,
    dialogNode,
    // data
    tree,
    treeStatus,
    notes,
    noteErrors,
    version,
    save,
    // layout
    layout,
    focusGroup,
    focusTab,
    focusView,
    activeNote,
    // panels
    prefs,
    drawer,
    palette,
    settingsOpen,
    searchQuery,
    selectedTag,
    theme,
    toasts,
    // lookups
    findNote,
    exists,
    noteNames,
    tagNames,
    // the focused group's editor (focus, jump to a heading)
    editor,
    // actions
    actions: {
      open,
      openView,
      openLink,
      openTag,
      back,
      forward,
      setMode,
      activate,
      focusGroup: focusGroupAt,
      closeTab,
      closeOthers,
      splitTab,
      cycleTab,
      onChange,
      flush,
      loadNote,
      refreshTree,
      createAndOpen,
      newNote,
      dailyNote,
      renameNote,
      deleteNote,
      moveNote,
      newFolder,
      renameFolder,
      deleteFolder,
      showLeft,
      showRight,
      setLeftView,
      setRightView,
      setSort,
      setExpanded,
      setDrawer,
      setPalette,
      setSettingsOpen,
      setSearchQuery,
      setSelectedTag,
      searchFor,
      reveal,
      importFiles,
      exportVault,
      setTheme,
      logout,
      notify,
      dismissToast,
      bump: () => setVersion((v) => v + 1),
    },
  };
}
