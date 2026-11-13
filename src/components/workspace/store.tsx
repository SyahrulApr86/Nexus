"use client";

import {
  createContext,
  startTransition,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import { api, ApiError, type ConflictNote, type FullNote, type Tree, type TreeNote } from "./api";
import { useDialogs, type DialogApi } from "./dialogs";
import type { Toast } from "./ui";
import type { EditorHandle } from "./editor";
import { basename, dirname, extractTags, extractWikiLinks, linkKey } from "@/lib/markdown/parse";
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
  | { type: "merge" }
  | { type: "replace"; layout: Layout };

/**
 * Keep the history entries that pass, and point the index at the entry the
 * user was on (or the nearest earlier one that survives), not a clamped number.
 */
function keepHistory(t: Tab, keep: (v: View) => boolean): Tab | null {
  const history: View[] = [];
  let index = -1;
  t.history.forEach((v, i) => {
    if (!keep(v)) return;
    history.push(v);
    if (i <= t.index) index++;
  });
  if (!history.length) return null;
  if (history.length === t.history.length) return t;
  return { ...t, history, index: Math.max(0, index) };
}

/** Same rule for a group's active tab after some tabs are removed. */
function survivingIndex<T>(items: T[], active: number, kept: (x: T) => boolean) {
  let n = -1;
  items.forEach((x, i) => {
    if (i <= active && kept(x)) n++;
  });
  return Math.max(0, n);
}

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
        // "Open to the right" always lands in the rightmost pane.
        const gi = s.groups.length - 1;
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
      const keep = (v: View) => v.type !== "note" || !a.ids.has(v.id);
      for (const g of s.groups) {
        g.tabs = g.tabs.map((t) => keepHistory(t, keep) ?? { ...t, history: [{ type: "empty" }], index: 0 });
      }
      return s;
    }
    case "merge": {
      // Phone: one pane. Fold every other group into the first, keeping the focused tab active.
      if (state.groups.length < 2) return state;
      const tabs: Tab[] = [];
      let active = 0;
      state.groups.forEach((g, gi) => {
        if (gi === state.focus) active = tabs.length + g.active;
        tabs.push(...g.tabs);
      });
      return { groups: [{ ...state.groups[0], tabs, active: Math.min(active, Math.max(0, tabs.length - 1)) }], focus: 0 };
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
export type SaveState = "saved" | "dirty" | "saving" | "error" | "signedOut";
export type SettingsSection = "general" | "hotkeys";
/** A cached note. `rev` changes only when the server text replaced what the editor showed. */
export type CachedNote = FullNote & { rev: number };
export type NoteError = { status: number; message: string };
type FocusRequest = { id: string; target: "editor" | "title" };
type PendingSave = { content: string; timer?: ReturnType<typeof setTimeout> };
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
const RETRY_DELAY = 3000;
const PUBLISH_EVERY = 300;
const DRAFT_PREFIX = "nexus-unsaved:";
const KEEPALIVE_LIMIT = 60 * 1024;
const PHONE = "(max-width: 767px)";

const matches = (q: string) => typeof window !== "undefined" && window.matchMedia(q).matches;

function writeDraft(id: string, content: string) {
  try {
    localStorage.setItem(DRAFT_PREFIX + id, JSON.stringify({ content, at: Date.now() }));
  } catch {}
}
function readDraft(id: string): { content: string; at: number } | null {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + id);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function clearDraft(id: string) {
  try {
    localStorage.removeItem(DRAFT_PREFIX + id);
  } catch {}
}
/** Below 768px there is one pane: splits become tabs. */
const narrowTarget = (target: OpenTarget): OpenTarget => (target === "split" && matches(PHONE) ? "tab" : target);
const retryable = (status: number) => status === 0 || status === 408 || status === 429 || status >= 500;

/** What a note links to and which tags it carries, as comparable strings: the refresh signals compare these. */
function signals(md: string) {
  const links = [...new Set(extractWikiLinks(md).map((l) => linkKey(l.target)))].sort().join("\n");
  return { links, tags: extractTags(md).sort().join("\n") };
}
const isConflictNote = (d: unknown): d is ConflictNote =>
  !!d && typeof (d as ConflictNote).content === "string" && typeof (d as ConflictNote).updatedAt === "string";

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

export type User = { name: string; email: string };

export type WorkspaceValue = ReturnType<typeof useWorkspaceState>;
export type WorkspaceActions = WorkspaceValue["actions"];
const WorkspaceContext = createContext<WorkspaceValue | null>(null);
const ActionsContext = createContext<WorkspaceActions | null>(null);

/** The newest workspace value plus subscribers, so a selector re-renders only when its slice changes. */
type WorkspaceStore = { get: () => WorkspaceValue; set: (v: WorkspaceValue) => void; subscribe: (fn: () => void) => () => void };
const StoreContext = createContext<WorkspaceStore | null>(null);

function createWorkspaceStore(initial: WorkspaceValue): WorkspaceStore {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (v) => {
      if (v === value) return;
      value = v;
      listeners.forEach((fn) => fn());
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** Everything at once. Re-renders on every workspace change, including the published text while typing. */
export function useWorkspace() {
  const v = use(WorkspaceContext);
  if (!v) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return v;
}

/** The actions only. Their identity never changes, so a component using just these never re-renders for workspace state. */
export function useWorkspaceActions(): WorkspaceActions {
  const a = use(ActionsContext);
  if (!a) throw new Error("useWorkspaceActions must be used inside <WorkspaceProvider>");
  return a;
}

/**
 * One slice of the workspace. The component re-renders only when `isEqual` says
 * the slice changed (Object.is by default, so return state as it is, or pass a
 * shallow compare when the selector builds a new object or array).
 */
export function useWorkspaceSelector<T>(
  selector: (w: WorkspaceValue) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const store = use(StoreContext);
  if (!store) throw new Error("useWorkspaceSelector must be used inside <WorkspaceProvider>");
  // Memoised per store value and selector: getSnapshot must return the same result until something changed.
  const cache = useRef<{ value: WorkspaceValue; selector: unknown; result: T } | null>(null);
  const getSnapshot = () => {
    const value = store.get();
    const c = cache.current;
    if (c?.value === value && c.selector === selector) return c.result;
    const next = selector(value);
    const result = c && isEqual(c.result, next) ? c.result : next;
    cache.current = { value, selector, result };
    return result;
  };
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

export function WorkspaceProvider({ user, children }: { user: User; children: ReactNode }) {
  const value = useWorkspaceState(user);
  const [store] = useState(() => createWorkspaceStore(value));
  // After commit, so selector subscribers never read a value React has not committed.
  useLayoutEffect(() => store.set(value), [store, value]);
  return (
    <StoreContext value={store}>
      <ActionsContext value={value.actions}>
        <WorkspaceContext value={value}>
          {children}
          {value.dialogNode}
        </WorkspaceContext>
      </ActionsContext>
    </StoreContext>
  );
}

function useWorkspaceState(user: User) {
  const { api: dialogRaw, node: dialogNode } = useDialogs();
  const dialog: DialogApi = useMemo(
    () => ({ prompt: dialogRaw.prompt, confirm: dialogRaw.confirm }),
    [dialogRaw.prompt, dialogRaw.confirm],
  );

  const [tree, setTree] = useState<Tree>({ notes: [], folders: [] });
  const [treeStatus, setTreeStatus] = useState<"loading" | "ready" | "error">("loading");
  const [notes, setNotes] = useState<Record<string, CachedNote>>({});
  const [noteErrors, setNoteErrors] = useState<Record<string, NoteError>>({});
  const [layout, dispatch] = useReducer(layoutReducer, { groups: [newGroup()], focus: 0 });
  const [prefs, setPrefs] = useState<Prefs>(defaultPrefs);
  const [save, setSaveState] = useState<SaveState>("saved");
  const [drawer, setDrawerState] = useState<Drawer>(null);
  const [palette, setPalette] = useState<PaletteMode>(null);
  const [settingsOpen, setSettingsOpenState] = useState<false | SettingsSection>(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [version, setVersion] = useState(0);
  // Narrower refresh signals: bumped only when links (backlinks, outgoing, graph) or tags changed.
  const [linksVersion, setLinksVersion] = useState(0);
  const [tagsVersion, setTagsVersion] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [theme, setThemeState] = useState<Theme>("system");
  const [vaultName, setVaultName] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [focusTick, setFocusTick] = useState(0); // re-runs the note's focus effect when the note is already open
  // One editor handle per tab group, keyed by the group's stable key.
  const [editors] = useState(() => new Map<string, RefObject<EditorHandle | null>>());

  const pending = useRef(new Map<string, PendingSave>());
  const live = useRef(new Map<string, string>()); // newest text per note, ahead of `notes`
  const savingNow = useRef(new Map<string, Promise<void>>());
  const loading = useRef(new Map<string, Promise<FullNote | null>>());
  const publishTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const lastPublish = useRef(new Map<string, number>());
  const saveRef = useRef<SaveState>("saved");
  const saveProblemShown = useRef(false);
  const signedOut = useRef(false); // a save got 401: stop retrying until a save succeeds again
  const saveToasts = useRef<number[]>([]); // save-problem toasts, cleared once saving works again
  const lastFail = useRef(new Map<string, number>()); // status of each note's last failed save
  const stuckToasts = useRef(new Map<string, number>()); // one toast per note whose save can't be retried
  const gone = useRef(new Set<string>()); // saves got 404: the note was deleted elsewhere; text kept as a draft
  const recoverRef = useRef<(id: string) => void>(() => {});
  // Optimistic concurrency: the server's updatedAt (and text) this device last saw for each note.
  const baseAt = useRef(new Map<string, string>());
  const serverText = useRef(new Map<string, string>());
  const conflicts = useRef(new Map<string, ConflictNote>()); // saves got 409: the note changed elsewhere
  const conflictToasts = useRef(new Map<string, number[]>());
  const force = useRef(new Set<string>()); // "Keep mine": the next save overwrites without a base
  const deleted = useRef(new Set<string>()); // deleted from this device: late saves for these are moot
  const resolveRef = useRef<(id: string, keep: "mine" | "theirs") => void>(() => {});
  const focusRequest = useRef<FocusRequest | null>(null);
  const navSeq = useRef(0);
  const toastSeq = useRef(0);
  const errorToasts = useRef(new Set<number>());
  const layoutRef = useRef(layout);
  const notesRef = useRef(notes);
  const treeRef = useRef(tree);
  const drawerRef = useRef<Drawer>(null);

  useLayoutEffect(() => {
    layoutRef.current = layout;
    notesRef.current = notes;
    treeRef.current = tree;
    drawerRef.current = drawer;
  });

  const setSave = useCallback((next: SaveState) => {
    saveRef.current = next;
    setSaveState(next);
  }, []);

  /** Bump the refresh signals: `version` always, the narrower ones only when asked. */
  const bumpSignals = useCallback((links: boolean, tags: boolean) => {
    setVersion((v) => v + 1);
    if (links) setLinksVersion((v) => v + 1);
    if (tags) setTagsVersion((v) => v + 1);
  }, []);
  /** Nothing waits to save and nothing is stuck: the status can say "Saved". */
  const settled = () =>
    !pending.current.size && !savingNow.current.size && !gone.current.size && !conflicts.current.size && !signedOut.current;

  /* ---------------- derived ---------------- */

  const focusGroup = layout.groups[layout.focus] ?? layout.groups[0];
  const focusTab = focusGroup?.tabs[focusGroup.active];
  const focusView: View = useMemo(() => (focusTab ? currentView(focusTab) : { type: "empty" }), [focusTab]);
  const activeNote = focusView.type === "note" ? notes[focusView.id] : undefined;

  const editorFor = useCallback(
    (gi: number): RefObject<EditorHandle | null> => {
      const key = layout.groups[gi]?.key ?? "none";
      let r = editors.get(key);
      if (!r) {
        r = { current: null };
        editors.set(key, r);
      }
      return r;
    },
    [layout.groups, editors],
  );
  const editor = editorFor(layout.focus);

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
  const noteNames = useCallback(() => treeRef.current.notes.map((n) => n.name), []);
  const tagCache = useRef<string[]>([]);
  useEffect(() => {
    api
      .tags()
      .then((t) => (tagCache.current = t.map((x) => x.tag)))
      .catch(() => {});
  }, [tagsVersion]);
  const tagNames = useCallback(() => tagCache.current, []);
  /** The newest text of a note, including keystrokes not yet published to `notes`. */
  const liveContent = useCallback((id: string) => live.current.get(id) ?? notesRef.current[id]?.content ?? "", []);

  /* ---------------- feedback ---------------- */

  const dismissToast = useCallback((id: number) => {
    errorToasts.current.delete(id);
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  /**
   * Show a toast. Errors stay until dismissed and are never pushed out by later
   * toasts; everything else leaves on its own.
   */
  const notify = useCallback(
    (message: string, opts?: Toast["action"] | { action?: Toast["action"]; tone?: "error" }) => {
      const o = opts && "run" in opts ? { action: opts } : (opts ?? {});
      const id = ++toastSeq.current;
      const error = o.tone === "error";
      const action = o.action ?? (error ? { label: "Dismiss", run: () => {} } : undefined);
      if (error) errorToasts.current.add(id);
      setToasts((t) => {
        const next = [...t, { id, message, action }];
        while (next.length > 3) {
          const drop = next.findIndex((x) => !errorToasts.current.has(x.id));
          if (drop === -1 || drop === next.length - 1) break;
          next.splice(drop, 1);
        }
        return next;
      });
      if (!error) setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), o.action ? 8000 : 4000);
      return id;
    },
    [],
  );

  const fail = useCallback(
    (e: unknown) => {
      const message =
        e instanceof ApiError
          ? e.status >= 500
            ? "Something went wrong on our side. Try again in a moment."
            : e.message
          : "Something went wrong. Try again.";
      notify(message, { tone: "error" });
    },
    [notify],
  );

  /* ---------------- loading ---------------- */

  const refreshTree = useCallback(async () => {
    const t = await api.tree();
    setTree(t);
    setTreeStatus("ready");
    return t;
  }, []);

  /** Fetch a note. Concurrent calls for one id share a request. */
  const loadNote = useCallback(
    (id: string): Promise<FullNote | null> => {
      const inFlight = loading.current.get(id);
      if (inFlight) return inFlight;
      const run = (async () => {
        try {
          const fresh = await api.get(id);
          const cur = notesRef.current[id];
          const localText = live.current.get(id) ?? cur?.content;
          const editing =
            pending.current.has(id) || savingNow.current.has(id) || conflicts.current.has(id) || gone.current.has(id);
          const older = !!cur && Date.parse(fresh.updatedAt) < Date.parse(cur.updatedAt);
          let content = (editing || older) && localText !== undefined ? localText : fresh.content;
          // The base for the next save moves only when this device has seen the server's text:
          // a newer server text under local edits must still answer 409 when they are saved.
          if (!older && (content === fresh.content || fresh.content === serverText.current.get(id) || !baseAt.current.has(id))) {
            baseAt.current.set(id, fresh.updatedAt);
            serverText.current.set(id, fresh.content);
          }
          // A draft this device never managed to save, newer than the server copy.
          if (!cur && !editing) {
            const draft = readDraft(id);
            if (draft && draft.content !== fresh.content && draft.at > Date.parse(fresh.updatedAt)) {
              content = draft.content;
              pending.current.set(id, { content });
              scheduleRef.current(id, SAVE_DELAY);
              setSave("dirty");
              notify(`Restored unsaved changes in “${fresh.name}”`);
            } else if (draft) clearDraft(id);
          }
          const replaced = cur !== undefined && localText !== content;
          live.current.set(id, content);
          setNotes((m) => {
            const c = m[id];
            return {
              ...m,
              [id]: {
                ...fresh,
                content,
                updatedAt: older && c ? c.updatedAt : fresh.updatedAt,
                rev: (c?.rev ?? 0) + (replaced ? 1 : 0),
              },
            };
          });
          setNoteErrors((e) => {
            if (!(id in e)) return e;
            const { [id]: _, ...rest } = e;
            void _;
            return rest;
          });
          return fresh;
        } catch (err) {
          const status = err instanceof ApiError ? err.status : -1;
          setNoteErrors((e) => ({
            ...e,
            [id]: { status, message: err instanceof ApiError ? err.message : "Couldn’t load this note." },
          }));
          // A deleted note: drop its stale row from the explorer and switcher.
          if (status === 404) void refreshTree().catch(() => {});
          return null;
        } finally {
          loading.current.delete(id);
        }
      })();
      loading.current.set(id, run);
      return run;
    },
    // scheduleRef is a ref; setSave and notify are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refreshTree],
  );

  /* ---------------- saving ---------------- */

  const scheduleRef = useRef<(id: string, delay: number) => void>(() => {});
  /** The persistent "deleted elsewhere" toast with its "Save as new note" action. Returns the toast id. */
  const goneToastRef = useRef<(id: string) => number>(() => 0);
  const flushRef = useRef<(id: string) => Promise<void>>(async () => {});

  const schedule = useCallback((id: string, delay: number) => {
    const e = pending.current.get(id);
    if (!e) return;
    if (e.timer) clearTimeout(e.timer);
    e.timer = setTimeout(() => {
      const x = pending.current.get(id);
      if (x) x.timer = undefined;
      void flushRef.current(id);
    }, delay);
  }, []);

  /**
   * Save one note. Saves for a note never overlap: a flush during a save waits
   * for it and then sends whatever is newest, so an old body can never land last.
   */
  const flush = useCallback(
    async (id: string): Promise<void> => {
      const inFlight = savingNow.current.get(id);
      if (inFlight) {
        await inFlight;
        return flushRef.current(id);
      }
      const p = pending.current.get(id);
      if (!p) return;
      if (p.timer) clearTimeout(p.timer);
      pending.current.delete(id);
      // Deleted here, or waiting for the user to pick a version: nothing to send.
      if (deleted.current.has(id) || conflicts.current.has(id)) {
        if (settled()) setSave("saved");
        return;
      }
      setSave("saving");
      const base = force.current.has(id) ? undefined : baseAt.current.get(id);
      const run = (async () => {
        try {
          const r = await api.save(id, p.content, base);
          force.current.delete(id);
          baseAt.current.set(id, r.updatedAt);
          const before = serverText.current.get(id);
          serverText.current.set(id, p.content);
          const was = before === undefined ? null : signals(before);
          const now = signals(p.content);
          signedOut.current = false;
          lastFail.current.delete(id);
          const stuck = stuckToasts.current.get(id);
          if (stuck !== undefined) {
            stuckToasts.current.delete(id);
            dismissToast(stuck);
          }
          if (!pending.current.has(id)) clearDraft(id);
          setNotes((m) => (m[id] ? { ...m, [id]: { ...m[id], updatedAt: r.updatedAt } } : m));
          if (saveProblemShown.current && !pending.current.size) {
            saveProblemShown.current = false;
            saveToasts.current.splice(0).forEach(dismissToast);
            notify("All changes saved");
          }
          bumpSignals(was?.links !== now.links, was?.tags !== now.tags);
        } catch (err) {
          const status = err instanceof ApiError ? err.status : 0;
          // Deleted from this device while the save ran: the delete wins and nothing is left to keep.
          if (deleted.current.has(id)) {
            pending.current.delete(id);
            clearDraft(id);
            return;
          }
          if (status === 409 && err instanceof ApiError && isConflictNote((err.data as { note?: unknown })?.note)) {
            // Changed on another device since this text was based on it. Keep the local text, stop
            // autosaving it, and let the user pick: overwrite with theirs, or load theirs.
            const theirs = (err.data as { note: ConflictNote }).note;
            const e = pending.current.get(id);
            if (e?.timer) clearTimeout(e.timer);
            pending.current.delete(id);
            writeDraft(id, live.current.get(id) ?? p.content);
            conflicts.current.set(id, theirs);
            lastFail.current.delete(id);
            if (!conflictToasts.current.has(id)) {
              const name = notesRef.current[id]?.name ?? "this note";
              conflictToasts.current.set(id, [
                notify(`“${name}” changed on another device, so your edits aren’t saved yet. Your text is kept here.`, {
                  tone: "error",
                  action: { label: "Keep mine", run: () => resolveRef.current(id, "mine") },
                }),
                notify(`Or replace your text in “${name}” with the other device’s version.`, {
                  tone: "error",
                  action: { label: "Load theirs", run: () => resolveRef.current(id, "theirs") },
                }),
              ]);
            }
            setSave("error");
            return;
          }
          lastFail.current.set(id, status);
          // Re-queue only if nothing newer was typed meanwhile; the newer edit wins.
          if (!pending.current.has(id)) pending.current.set(id, { content: p.content });
          writeDraft(id, pending.current.get(id)!.content);
          if (status === 401) {
            const e = pending.current.get(id);
            if (e?.timer) clearTimeout(e.timer);
            if (e) e.timer = undefined;
            if (!signedOut.current)
              saveToasts.current.push(notify("You’re signed out, so changes aren’t saving. They’re kept on this device until you sign in.", {
                tone: "error",
                action: { label: "Sign in", run: () => window.open("/login", "_blank", "noopener") },
              }));
            signedOut.current = true;
            saveProblemShown.current = true;
            setSave("signedOut");
            return;
          }
          if (retryable(status)) {
            if (!pending.current.get(id)?.timer) scheduleRef.current(id, RETRY_DELAY);
            if (!saveProblemShown.current)
              saveToasts.current.push(
                notify(
                  status === 0
                    ? "You’re offline. Changes are kept on this device and save when you reconnect."
                    : "Couldn’t save your changes. Retrying…",
                  { tone: "error" },
                ),
              );
          } else {
            const name = notesRef.current[id]?.name ?? "this note";
            if (status === 404) {
              // Deleted elsewhere: retrying can never work. Keep the text as a draft and offer to save it anew.
              const e = pending.current.get(id);
              if (e?.timer) clearTimeout(e.timer);
              pending.current.delete(id);
              gone.current.add(id);
            }
            // One toast per note, however often the save is tried again.
            if (!stuckToasts.current.has(id))
              stuckToasts.current.set(
                id,
                status === 404 ? goneToastRef.current(id) : notify(`Couldn’t save “${name}”. ${(err as Error).message}`, { tone: "error" }),
              );
          }
          saveProblemShown.current = true;
          setSave("error");
          return;
        } finally {
          savingNow.current.delete(id);
        }
        if (pending.current.size) setSave("dirty");
        else if (gone.current.size || conflicts.current.size) setSave("error");
        else if (!savingNow.current.size) setSave("saved");
        // An edit whose timer fired while this save ran is still waiting: send it now.
        if (pending.current.has(id) && !pending.current.get(id)!.timer) void flushRef.current(id);
      })();
      savingNow.current.set(id, run);
      return run;
    },
    [notify, dismissToast, setSave, bumpSignals],
  );

  useLayoutEffect(() => {
    scheduleRef.current = schedule;
    flushRef.current = flush;
  });

  const publish = useCallback((id: string) => {
    publishTimers.current.delete(id);
    lastPublish.current.set(id, Date.now());
    const content = live.current.get(id);
    if (content === undefined) return;
    if (pending.current.has(id)) writeDraft(id, content);
    startTransition(() => setNotes((m) => (m[id] && m[id].content !== content ? { ...m, [id]: { ...m[id], content } } : m)));
  }, []);

  /**
   * Editor keystrokes. The newest text lives in refs; the shared `notes` state
   * (word count, outline, reading view) follows at most every 300 ms, so typing
   * does not re-render the whole workspace on each key.
   */
  const onChange = useCallback(
    (id: string, content: string) => {
      live.current.set(id, content);
      if (deleted.current.has(id)) return;
      const held = gone.current.has(id) || conflicts.current.has(id);
      if (held) {
        // Deleted or changed elsewhere: nothing to save to until the user decides. Keep the newest text on this device.
        writeDraft(id, content);
      } else {
        const prev = pending.current.get(id);
        pending.current.set(id, { content, timer: prev?.timer });
      }
      if (!signedOut.current && !held) {
        schedule(id, SAVE_DELAY);
        if (saveRef.current !== "dirty") setSave("dirty");
      }
      if (!publishTimers.current.has(id)) {
        const wait = PUBLISH_EVERY - (Date.now() - (lastPublish.current.get(id) ?? 0));
        if (wait <= 0) publish(id);
        else publishTimers.current.set(id, setTimeout(() => publish(id), wait));
      }
    },
    [schedule, publish, setSave],
  );

  const flushAll = useCallback(async () => {
    await Promise.all([...pending.current.keys()].map((id) => flush(id)));
  }, [flush]);

  // Never lose an edit: save when the tab hides, send what fits on unload, and
  // keep a copy on this device until the server confirms it.
  useEffect(() => {
    const keepDrafts = () => {
      for (const [id, p] of pending.current) writeDraft(id, p.content);
    };
    const onHide = () => {
      if (document.visibilityState !== "hidden") return;
      keepDrafts();
      for (const id of [...pending.current.keys()]) void flush(id);
    };
    const onPageHide = () => {
      keepDrafts();
      for (const [id, p] of pending.current) {
        if (deleted.current.has(id) || conflicts.current.has(id)) continue;
        // With the base: a note changed elsewhere answers 409 and the draft stays for the next visit.
        const body = JSON.stringify({ content: p.content, baseUpdatedAt: force.current.has(id) ? undefined : baseAt.current.get(id) });
        if (new Blob([body]).size > KEEPALIVE_LIMIT) continue; // too large for keepalive: the draft stays
        fetch(`/api/notes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body, keepalive: true })
          .then((r) => r.ok && clearDraft(id))
          .catch(() => {});
      }
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pending.current.size || savingNow.current.size || signedOut.current || gone.current.size || conflicts.current.size) {
        keepDrafts();
        e.preventDefault();
      }
    };
    // Back from signing in on another tab, or back online: try again at once.
    // Only saves that failed for a passing reason are retried; a 400 or 413 would just fail again.
    const onReturn = () => {
      for (const id of [...pending.current.keys()]) {
        const s = lastFail.current.get(id);
        // Edits typed while signed out never tried to save, so they have no failure yet.
        if (s === undefined ? signedOut.current : s === 401 || retryable(s)) void flush(id);
      }
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("focus", onReturn);
    window.addEventListener("online", onReturn);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("focus", onReturn);
      window.removeEventListener("online", onReturn);
    };
  }, [flush]);

  /* ---------------- navigation ---------------- */

  const setDrawer = useCallback((d: Drawer) => {
    drawerRef.current = d;
    setDrawerState(d);
  }, []);

  const openView = useCallback(
    (view: View, target: OpenTarget = "current") => {
      navSeq.current++;
      setDrawer(null);
      startTransition(() => dispatch({ type: "open", view, target: narrowTarget(target) }));
    },
    [setDrawer],
  );

  /**
   * Open a note. The view switches at once (a skeleton shows while it loads),
   * so a slow earlier click can never override a later one.
   * `focus` moves keyboard focus into the note once it has mounted.
   */
  const open = useCallback(
    async (id: string, target: OpenTarget = "current", mode: NoteMode = "edit", opts?: { focus?: FocusRequest["target"] }) => {
      navSeq.current++;
      const fromDrawer = drawerRef.current !== null;
      setDrawer(null);
      void loadNote(id); // a cached note shows at once and refreshes in the background
      if (opts?.focus || fromDrawer) {
        focusRequest.current = { id, target: opts?.focus ?? "editor" };
        setFocusTick((n) => n + 1);
      }
      startTransition(() => dispatch({ type: "open", view: { type: "note", id, mode }, target: narrowTarget(target) }));
    },
    [loadNote, setDrawer],
  );

  const back = useCallback(() => {
    navSeq.current++;
    startTransition(() => dispatch({ type: "history", delta: -1 }));
  }, []);
  const forward = useCallback(() => {
    navSeq.current++;
    startTransition(() => dispatch({ type: "history", delta: 1 }));
  }, []);
  const setMode = useCallback((mode?: NoteMode) => dispatch({ type: "mode", mode }), []);
  const activate = useCallback((group: number, tab: number) => {
    navSeq.current++;
    startTransition(() => dispatch({ type: "activate", group, tab }));
  }, []);
  const focusGroupAt = useCallback((group: number) => dispatch({ type: "focus", group }), []);
  const closeTab = useCallback(
    (group: number, tab: number) => {
      navSeq.current++;
      const t = layoutRef.current.groups[group]?.tabs[tab];
      const v = t && currentView(t);
      if (v?.type === "note") void flush(v.id);
      dispatch({ type: "close", group, tab });
    },
    [flush],
  );
  const closeOthers = useCallback((group: number, tab: number) => dispatch({ type: "closeOthers", group, tab }), []);
  const splitTab = useCallback(
    (group: number, tab: number) => {
      const t = layoutRef.current.groups[group]?.tabs[tab];
      if (!t) return;
      dispatch({ type: "focus", group });
      openView(currentView(t), "split");
    },
    [openView],
  );
  const cycleTab = useCallback(
    (delta: 1 | -1) => {
      const l = layoutRef.current;
      const g = l.groups[l.focus];
      if (!g || g.tabs.length < 2) return;
      activate(l.focus, (g.active + delta + g.tabs.length) % g.tabs.length);
    },
    [activate],
  );

  /* ---------------- first load: tree, prefs, layout, URL ---------------- */

  // Before paint, so the saved sidebar layout shows from the first client frame.
  useLayoutEffect(() => {
    // localStorage is client-only, so these cannot be initial state without a hydration mismatch.
    setPrefs(readJSON(PREFS_KEY, defaultPrefs));
    let t: string | null = null;
    try {
      t = localStorage.getItem("nexus-theme");
    } catch {}
    setThemeState(t === "light" || t === "dark" ? t : "system");
  }, []);

  useEffect(() => {
    // Read the deep link before anything can rewrite the URL.
    const fromUrl = new URLSearchParams(window.location.search).get("n");
    api
      .vault()
      .then((v) => setVaultName(v.name))
      .catch(() => {});
    (async () => {
      let t: Tree;
      try {
        t = await refreshTree();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401 && !pending.current.size) {
          // A full navigation also drops the stale in-memory vault.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.assign("/login");
          return;
        }
        setTreeStatus("error");
        setRestoring(false);
        return;
      }
      const ids = new Set(t.notes.map((n) => n.id));
      const saved = readJSON<Layout | null>(LAYOUT_KEY, null);
      const valid = (v: View) => v.type !== "note" || ids.has(v.id);
      let next: Layout | null = null;
      if (saved?.groups?.length) {
        const groups = saved.groups
          .map((g) => {
            const kept = g.tabs.map((tb) => keepHistory(tb, valid));
            const tabs = kept.filter((x): x is Tab => !!x);
            return { ...g, tabs, active: Math.min(survivingIndex(kept, g.active, (x) => !!x), Math.max(0, tabs.length - 1)) };
          })
          .filter((g, i) => g.tabs.length || i === 0);
        next = { groups, focus: Math.min(saved.focus, groups.length - 1) };
      }
      if (next) dispatch({ type: "replace", layout: next });
      if (matches(PHONE)) dispatch({ type: "merge" });
      if (fromUrl && ids.has(fromUrl)) {
        void loadNote(fromUrl);
        dispatch({ type: "open", view: { type: "note", id: fromUrl, mode: "edit" }, target: "current" });
      } else if (!next?.groups.some((g) => g.tabs.length) && t.notes[0]) {
        const recent = [...t.notes].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))[0];
        void loadNote(recent.id);
        dispatch({ type: "open", view: { type: "note", id: recent.id, mode: "edit" }, target: "current" });
      }
      setRestoring(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist layout and preferences once the saved ones have been read.
  useEffect(() => {
    if (!restoring) writeJSON(LAYOUT_KEY, layout);
  }, [layout, restoring]);
  useEffect(() => {
    if (!restoring) writeJSON(PREFS_KEY, prefs);
  }, [prefs, restoring]);

  // Keep ?n= in sync so the open note can be bookmarked or shared across devices.
  useEffect(() => {
    if (restoring) return;
    const url = new URL(window.location.href);
    const id = focusView.type === "note" ? focusView.id : null;
    if (url.searchParams.get("n") === id) return;
    if (id) url.searchParams.set("n", id);
    else url.searchParams.delete("n");
    window.history.replaceState(null, "", url);
  }, [focusView, restoring]);

  // The browser tab names the focused note. The server title comes back when the workspace unmounts.
  const titleName =
    focusView.type === "note" ? (notes[focusView.id]?.name ?? index.byId.get(focusView.id)?.name ?? null) : focusView.type === "graph" ? "Graph view" : null;
  useEffect(() => {
    const before = document.title;
    return () => {
      document.title = before;
    };
  }, []);
  useEffect(() => {
    document.title = titleName ? `${titleName} — Nexus` : "Nexus";
  }, [titleName]);

  // Load notes that become visible (restored tabs, history steps) and are not cached yet.
  useEffect(() => {
    for (const g of layout.groups) {
      for (const tb of g.tabs) {
        const v = currentView(tb);
        if (v.type === "note" && !notes[v.id] && !noteErrors[v.id]) void loadNote(v.id);
      }
    }
  }, [layout, notes, noteErrors, loadNote]);

  // Phone: one pane, and drawers close when the window grows past their breakpoint.
  useEffect(() => {
    const phone = window.matchMedia(PHONE);
    const md = window.matchMedia("(min-width: 768px)");
    const lg = window.matchMedia("(min-width: 1024px)");
    const onPhone = () => phone.matches && dispatch({ type: "merge" });
    const onMd = () => md.matches && drawerRef.current === "left" && setDrawer(null);
    const onLg = () => lg.matches && drawerRef.current === "right" && setDrawer(null);
    phone.addEventListener("change", onPhone);
    md.addEventListener("change", onMd);
    lg.addEventListener("change", onLg);
    return () => {
      phone.removeEventListener("change", onPhone);
      md.removeEventListener("change", onMd);
      lg.removeEventListener("change", onLg);
    };
  }, [setDrawer]);

  /* ---------------- note actions ---------------- */

  const createAndOpen = useCallback(
    async (path: string, content = "", target: OpenTarget = "current", focus: FocusRequest["target"] = "editor") => {
      const seq = ++navSeq.current;
      try {
        const n = await api.create(path, content);
        await refreshTree();
        // Still create the note, but do not steal the view if the user moved on.
        if (seq === navSeq.current) await open(n.id, target, "edit", { focus });
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
      const seq = ++navSeq.current;
      try {
        const res = await api.resolve(target, true);
        if (!res.id) return;
        await refreshTree();
        if (seq === navSeq.current) await open(res.id, t);
        if (res.created) notify(`Created “${basename(target)}”`);
      } catch (e) {
        fail(e);
      }
    },
    [findNote, open, refreshTree, notify, fail],
  );

  /** Create "Untitled" (then "Untitled 1", …) in the folder and put the cursor in its title. */
  const newNote = useCallback(
    async (folder = "") => {
      const taken = new Set(treeRef.current.notes.map((n) => n.path.toLowerCase()));
      const at = (name: string) => (folder ? `${folder}/${name}` : name);
      let name = "Untitled";
      for (let i = 1; taken.has(at(name).toLowerCase()); i++) name = `Untitled ${i}`;
      await createAndOpen(at(name), "", "current", "title");
    },
    [createAndOpen],
  );

  const dailyNote = useCallback(async () => {
    const d = new Date();
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const seq = ++navSeq.current;
    try {
      // Empty body: the inline title already shows the date.
      const res = await api.resolve(`Daily/${iso}`, true);
      if (!res.id) return;
      if (res.created) await refreshTree();
      if (seq === navSeq.current) await open(res.id, "current", "edit", { focus: "editor" });
    } catch (e) {
      fail(e);
    }
  }, [open, refreshTree, fail]);

  /** Re-fetch cached notes in the background; open editors keep their state unless the text changed. */
  const revalidateCached = useCallback(() => {
    for (const id of Object.keys(notesRef.current)) void loadNote(id);
  }, [loadNote]);

  /** Returns true when the note was renamed. */
  const renameNote = useCallback(
    async (n: { id: string; path: string }, nextPath?: string): Promise<boolean> => {
      const target =
        nextPath ??
        (await dialog.prompt({
          title: "Rename note",
          label: "Name or path",
          value: n.path,
          confirm: "Rename",
          hint: "Links to this note are updated everywhere.",
        }));
      if (!target || target === n.path) return false;
      await flush(n.id);
      try {
        const res = await api.rename(n.id, target);
        await refreshTree();
        setNotes((m) => (m[n.id] ? { ...m, [n.id]: { ...m[n.id], path: res.path, name: res.name } } : m));
        // Other notes may have had their links rewritten. The tag pane lists notes by name.
        revalidateCached();
        const text = serverText.current.get(n.id);
        bumpSignals(true, text === undefined || signals(text).tags !== "");
        if (res.updatedLinks)
          notify(`Renamed. Updated links in ${res.updatedLinks} ${res.updatedLinks === 1 ? "note" : "notes"}`);
        return true;
      } catch (e) {
        fail(e);
        return false;
      }
    },
    [dialog, flush, refreshTree, revalidateCached, notify, fail, bumpSignals],
  );

  const forget = useCallback((ids: string[]) => {
    for (const id of ids) {
      const p = pending.current.get(id);
      if (p?.timer) clearTimeout(p.timer);
      pending.current.delete(id);
      live.current.delete(id);
      gone.current.delete(id);
      conflicts.current.delete(id);
      force.current.delete(id);
      baseAt.current.delete(id);
      serverText.current.delete(id);
      lastFail.current.delete(id);
      const t = stuckToasts.current.get(id);
      stuckToasts.current.delete(id);
      if (t !== undefined) dismissToast(t);
      conflictToasts.current.get(id)?.forEach(dismissToast);
      conflictToasts.current.delete(id);
      clearDraft(id);
    }
    setNotes((m) => {
      const next = { ...m };
      for (const id of ids) delete next[id];
      return next;
    });
  }, [dismissToast]);

  /** "Save as new note" for a note deleted elsewhere while it had unsaved text. */
  const recoverDeleted = useCallback(
    async (id: string) => {
      const content = live.current.get(id) ?? readDraft(id)?.content ?? notesRef.current[id]?.content ?? "";
      const base = notesRef.current[id]?.path ?? "Recovered note";
      const taken = new Set(treeRef.current.notes.map((n) => n.path.toLowerCase()));
      let path = `${base} (recovered)`;
      for (let i = 2; taken.has(path.toLowerCase()); i++) path = `${base} (recovered ${i})`;
      // The toast with this action has just closed. Forget it, so a failure can offer the action again.
      const shown = stuckToasts.current.get(id);
      stuckToasts.current.delete(id);
      if (shown !== undefined) dismissToast(shown);
      const n = await createAndOpen(path, content, "current", "editor");
      if (!n) {
        // createAndOpen showed why. Keep the draft and offer "Save as new note" again.
        if (gone.current.has(id) && !stuckToasts.current.has(id)) stuckToasts.current.set(id, goneToastRef.current(id));
        return;
      }
      gone.current.delete(id);
      lastFail.current.delete(id);
      const t = stuckToasts.current.get(id);
      stuckToasts.current.delete(id);
      if (t !== undefined) dismissToast(t);
      dispatch({ type: "drop", ids: new Set([id]) });
      forget([id]);
      if (settled()) setSave("saved");
    },
    [createAndOpen, dismissToast, forget, setSave],
  );

  /** A save answered 409: overwrite the other version with this device's text, or take theirs. */
  const resolveConflict = useCallback(
    (id: string, keep: "mine" | "theirs") => {
      const theirs = conflicts.current.get(id);
      if (!theirs) return;
      conflicts.current.delete(id);
      conflictToasts.current.get(id)?.forEach(dismissToast);
      conflictToasts.current.delete(id);
      if (keep === "mine") {
        force.current.add(id);
        pending.current.set(id, { content: liveContent(id) });
        void flushRef.current(id);
        return;
      }
      const p = pending.current.get(id);
      if (p?.timer) clearTimeout(p.timer);
      pending.current.delete(id);
      force.current.delete(id);
      clearDraft(id);
      live.current.set(id, theirs.content);
      baseAt.current.set(id, theirs.updatedAt);
      const before = serverText.current.get(id);
      serverText.current.set(id, theirs.content);
      // A new rev tells the editor to show the server text in place of what it holds.
      setNotes((m) =>
        m[id] ? { ...m, [id]: { ...m[id], content: theirs.content, updatedAt: theirs.updatedAt, rev: m[id].rev + 1 } } : m,
      );
      const was = before === undefined ? null : signals(before);
      const now = signals(theirs.content);
      bumpSignals(was?.links !== now.links, was?.tags !== now.tags);
      if (settled()) setSave("saved");
    },
    [dismissToast, liveContent, bumpSignals, setSave],
  );

  useLayoutEffect(() => {
    recoverRef.current = (id) => void recoverDeleted(id);
    resolveRef.current = resolveConflict;
    goneToastRef.current = (id) =>
      notify(
        `Couldn’t save “${notesRef.current[id]?.name ?? "this note"}”. It was deleted, maybe on another device. Your text is kept on this device.`,
        { tone: "error", action: { label: "Save as new note", run: () => recoverRef.current(id) } },
      );
  });

  const deleteNote = useCallback(
    async (n: { id: string; name: string }) => {
      const ok = await dialog.confirm({
        title: `Delete “${n.name}”?`,
        body: "The note is removed from this vault. Links to it stay in other notes and show as not created yet.",
        confirm: "Delete note",
        danger: true,
      });
      if (!ok) return;
      // From here on, saves for this note are moot: drop what waits, and let a save that is
      // already running land before the delete so it cannot come back as a 404 afterwards.
      deleted.current.add(n.id);
      const p = pending.current.get(n.id);
      if (p?.timer) clearTimeout(p.timer);
      pending.current.delete(n.id);
      await savingNow.current.get(n.id);
      try {
        await api.remove(n.id);
        const text = serverText.current.get(n.id);
        dispatch({ type: "drop", ids: new Set([n.id]) });
        forget([n.id]);
        if (settled()) setSave("saved");
        await refreshTree();
        bumpSignals(true, text === undefined || signals(text).tags !== "");
        notify(`Deleted “${n.name}”`);
      } catch (e) {
        // Still there: the editor's text saves again from the next keystroke.
        deleted.current.delete(n.id);
        fail(e);
      }
    },
    [dialog, forget, refreshTree, notify, fail, bumpSignals, setSave],
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
      await flushAll();
      try {
        await api.mvdir(path, to);
        await refreshTree();
        // Move cached notes in place so open editors keep cursor, undo and scroll.
        setNotes((m) => {
          const next: Record<string, CachedNote> = {};
          for (const [k, v] of Object.entries(m)) {
            if (!v.path.startsWith(`${path}/`)) next[k] = v;
            else next[k] = { ...v, path: `${to}${v.path.slice(path.length)}` };
          }
          return next;
        });
        revalidateCached();
        bumpSignals(true, true);
      } catch (e) {
        fail(e);
      }
    },
    [dialog, flushAll, refreshTree, revalidateCached, fail, bumpSignals],
  );

  const deleteFolder = useCallback(
    async (path: string) => {
      const inside = treeRef.current.notes.filter((n) => n.path.startsWith(`${path}/`));
      const ok = await dialog.confirm({
        title: `Delete folder “${basename(path)}”?`,
        body: inside.length
          ? `${inside.length} ${inside.length === 1 ? "note" : "notes"} inside it will be deleted too.`
          : "The folder is empty.",
        confirm: "Delete folder",
        danger: true,
      });
      if (!ok) return;
      const ids = inside.map((n) => n.id);
      for (const id of ids) {
        deleted.current.add(id);
        const p = pending.current.get(id);
        if (p?.timer) clearTimeout(p.timer);
        pending.current.delete(id);
      }
      await Promise.all(ids.map((id) => savingNow.current.get(id)));
      try {
        await api.rmdir(path);
        dispatch({ type: "drop", ids: new Set(ids) });
        forget(ids);
        if (settled()) setSave("saved");
        await refreshTree();
        bumpSignals(true, true);
      } catch (e) {
        ids.forEach((id) => deleted.current.delete(id));
        fail(e);
      }
    },
    [dialog, forget, refreshTree, fail, bumpSignals, setSave],
  );

  /* ---------------- panels ---------------- */

  const showLeft = useCallback(
    (view?: LeftView) => {
      if (matches("(min-width: 768px)")) {
        setPrefs((p) => (view && (!p.leftOpen || p.leftView !== view) ? { ...p, leftOpen: true, leftView: view } : view ? p : { ...p, leftOpen: !p.leftOpen }));
      } else {
        if (view) setPrefs((p) => ({ ...p, leftView: view }));
        setDrawer(drawerRef.current === "left" && !view ? null : "left");
      }
    },
    [setDrawer],
  );

  const showRight = useCallback(
    (view?: RightView) => {
      if (matches("(min-width: 1024px)")) {
        setPrefs((p) => (view && (!p.rightOpen || p.rightView !== view) ? { ...p, rightOpen: true, rightView: view } : view ? p : { ...p, rightOpen: !p.rightOpen }));
      } else {
        if (view) setPrefs((p) => ({ ...p, rightView: view }));
        setDrawer(drawerRef.current === "right" && !view ? null : "right");
      }
    },
    [setDrawer],
  );

  const setLeftView = useCallback((leftView: LeftView) => setPrefs((p) => ({ ...p, leftView })), []);
  const setRightView = useCallback((rightView: RightView) => setPrefs((p) => ({ ...p, rightView })), []);
  const setSort = useCallback((sort: SortOrder) => setPrefs((p) => ({ ...p, sort })), []);
  const setExpanded = useCallback(
    (fn: (s: Set<string>) => Set<string>) => setPrefs((p) => ({ ...p, expanded: [...fn(new Set(p.expanded))] })),
    [],
  );
  /** `true` opens the general section. */
  const setSettingsOpen = useCallback(
    (v: boolean | SettingsSection) => setSettingsOpenState(v === true ? "general" : v),
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
      const done = (r: { created: number; updated: number }) => {
        revalidateCached();
        bumpSignals(true, true);
        notify(`Imported ${r.created} new and ${r.updated} updated ${r.created + r.updated === 1 ? "note" : "notes"}`);
      };
      try {
        // Saved text first, so the plan and the import see what this device shows.
        await flushAll();
        const plan = await api.importPlan(files);
        if (!Array.isArray(plan.conflicts)) {
          // A server without the dry run imported already. Report it rather than import twice.
          await refreshTree();
          done({ created: plan.created ?? 0, updated: plan.updated ?? 0 });
          return;
        }
        const n = plan.conflicts.length;
        if (n > 0) {
          const shown = plan.conflicts.slice(0, 5).map((path) => `“${path}”`);
          const more = n - shown.length;
          const list = more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(", ").replace(/, ([^,]*)$/, " and $1");
          const ok = await dialog.confirm({
            title: `Replace ${n} existing ${n === 1 ? "note" : "notes"}?`,
            body: `The import replaces the text of ${list} with the imported ${n === 1 ? "file" : "files"}.`,
            confirm: n === 1 ? "Replace note" : "Replace notes",
            danger: true,
          });
          if (!ok) return;
        }
        notify("Importing…");
        const r = await api.importFiles(files);
        await refreshTree();
        done(r);
      } catch (e) {
        fail(e);
      }
    },
    [dialog, flushAll, notify, refreshTree, revalidateCached, fail, bumpSignals],
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
    await flushAll();
    let ok = false;
    try {
      ok = !(await signOut()).error;
    } catch {
      ok = false;
    }
    // A failed sign-out must not look like one that worked: the session would still be valid.
    if (!ok) {
      notify("Couldn’t sign out. Check your connection and try again.", { tone: "error" });
      return;
    }
    // A full reload clears every cached note from memory after signing out.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }, [flushAll, notify]);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  /** A pending request to focus this note, if there is one. */
  const peekFocusRequest = useCallback((id: string) => {
    const r = focusRequest.current;
    return r && r.id === id ? r.target : null;
  }, []);
  /** Called once focus has landed (a remounting editor may need the request again before that). */
  const clearFocusRequest = useCallback((id: string) => {
    if (focusRequest.current?.id === id) focusRequest.current = null;
  }, []);

  // Stable identity: components that only call actions do not re-render while you type.
  const actions = useMemo(
    () => ({
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
      bump,
      peekFocusRequest,
      clearFocusRequest,
    }),
    [
      open, openView, openLink, openTag, back, forward, setMode, activate, focusGroupAt, closeTab, closeOthers,
      splitTab, cycleTab, onChange, flush, loadNote, refreshTree, createAndOpen, newNote, dailyNote, renameNote,
      deleteNote, moveNote, newFolder, renameFolder, deleteFolder, showLeft, showRight, setLeftView, setRightView,
      setSort, setExpanded, setDrawer, setSettingsOpen, searchFor, reveal, importFiles, exportVault, setTheme,
      logout, notify, dismissToast, bump, peekFocusRequest, clearFocusRequest,
    ],
  );

  return {
    user,
    dialog,
    dialogNode,
    vaultName,
    // data
    tree,
    treeStatus,
    notes,
    noteErrors,
    version,
    linksVersion,
    tagsVersion,
    save,
    restoring,
    focusTick,
    liveContent,
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
    // editor handles: one per tab group, and the focused group's
    editorFor,
    editor,
    actions,
  };
}
