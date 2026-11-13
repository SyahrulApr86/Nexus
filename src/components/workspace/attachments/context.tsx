"use client";

import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createAttachmentLookup, type AttachmentLookup } from "@/lib/markdown/attachments";
import { ApiError, attachmentsApi } from "../api";
import { useWorkspaceActions, useWorkspaceSelector, type OpenTarget } from "../store";
import {
  DEFAULT_ATTACHMENT_SETTINGS,
  baseName,
  embedLink,
  parseSettings,
  type AttachmentItem,
  type AttachmentSettings,
} from "./model";

const SETTINGS_KEY = "nexus-attachments";

export type UploadResult = { ok: true; item: AttachmentItem } | { ok: false; message: string };

export type AttachmentsValue = {
  items: AttachmentItem[];
  status: "loading" | "ready" | "error";
  lookup: AttachmentLookup;
  settings: AttachmentSettings;
  setSettings: (patch: Partial<AttachmentSettings>) => void;
  refresh: () => Promise<void>;
  /** Upload one file into `folder`. Never throws; a failure is returned (and not toasted). */
  upload: (file: File, folder: string) => Promise<UploadResult>;
  /** Upload several files in order, toasting failures; resolves with the ones that worked. */
  uploadMany: (files: File[], folder: string) => Promise<AttachmentItem[]>;
  /** Ask, then delete. Resolves true when the file is gone. */
  remove: (path: string) => Promise<boolean>;
  copyEmbed: (path: string) => void;
  open: (path: string, target?: OpenTarget) => void;
  notify: (message: string, error?: boolean) => void;
};

const noLookup: AttachmentLookup = () => null;
const Ctx = createContext<AttachmentsValue | null>(null);

/** The attachments state, or null outside the workspace (embeds and tests render without it). */
export function useAttachments(): AttachmentsValue | null {
  return use(Ctx);
}

/** The lookup the renderer resolves `![[file]]` with; resolves nothing outside the workspace. */
export function useAttachmentLookup(): AttachmentLookup {
  return use(Ctx)?.lookup ?? noLookup;
}

function readSettings(): AttachmentSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? parseSettings(JSON.parse(raw)) : DEFAULT_ATTACHMENT_SETTINGS;
  } catch {
    return DEFAULT_ATTACHMENT_SETTINGS;
  }
}

const messageOf = (e: unknown) =>
  e instanceof ApiError
    ? e.status >= 500
      ? "Nexus couldn’t store that file. Try again in a moment."
      : e.message
    : "That upload didn’t work. Try again.";

export function AttachmentsProvider({ children }: { children: ReactNode }) {
  const actions = useWorkspaceActions();
  const dialog = useWorkspaceSelector((s) => s.dialog);
  // The tree changes after creating, renaming, moving or deleting notes and folders: refetch then.
  const tree = useWorkspaceSelector((s) => s.tree);
  const [items, setItems] = useState<AttachmentItem[]>([]);
  const [status, setStatus] = useState<AttachmentsValue["status"]>("loading");
  const [settings, setSettingsState] = useState<AttachmentSettings>(DEFAULT_ATTACHMENT_SETTINGS);
  const seq = useRef(0);

  // localStorage is client-only: read after mount so the server render matches.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- a one-time read of browser storage
  useEffect(() => setSettingsState(readSettings()), []);

  const setSettings = useCallback((patch: Partial<AttachmentSettings>) => {
    setSettingsState((s) => {
      const next = parseSettings({ ...s, ...patch });
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    const n = ++seq.current;
    try {
      const all = await attachmentsApi.all();
      if (n !== seq.current) return;
      setItems(all);
      setStatus("ready");
    } catch {
      if (n === seq.current) setStatus((s) => (s === "ready" ? s : "error"));
    }
  }, []);

  useEffect(() => {
    // A data fetch on mount and after tree changes; the state it sets is the server's list.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh, tree]);

  const lookup = useMemo(() => createAttachmentLookup(items), [items]);

  const upload = useCallback(
    async (file: File, folder: string): Promise<UploadResult> => {
      try {
        const info = await attachmentsApi.upload(file, folder);
        const item: AttachmentItem = { ...info, createdAt: info.createdAt ?? new Date().toISOString() };
        // Show it at once; the refresh brings the sha256 that pins its URL. Folders may be new: refresh the tree.
        setItems((list) => [...list.filter((x) => x.path !== item.path), item]);
        void refresh();
        void actions.refreshTree().catch(() => {});
        return { ok: true, item };
      } catch (e) {
        return { ok: false, message: `${file.name || "File"}: ${messageOf(e)}` };
      }
    },
    [actions, refresh],
  );

  const uploadMany = useCallback(
    async (files: File[], folder: string) => {
      const done: AttachmentItem[] = [];
      for (const f of files) {
        const r = await upload(f, folder);
        if (r.ok) done.push(r.item);
        else actions.notify(r.message, { tone: "error" });
      }
      if (done.length)
        actions.notify(done.length === 1 ? `Uploaded ${baseName(done[0].path)}` : `Uploaded ${done.length} files`);
      return done;
    },
    [actions, upload],
  );

  const remove = useCallback(
    async (path: string) => {
      const name = baseName(path);
      const ok = await dialog.confirm({
        title: `Delete ${name}?`,
        body: "Notes that embed it will show it as missing. This can’t be undone.",
        confirm: "Delete",
        danger: true,
      });
      if (!ok) return false;
      try {
        await attachmentsApi.remove(path);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) {
          actions.notify(messageOf(e), { tone: "error" });
          return false;
        }
      }
      setItems((list) => list.filter((x) => x.path !== path));
      actions.notify(`Deleted ${name}`);
      void refresh();
      return true;
    },
    [actions, dialog, refresh],
  );

  const copyEmbed = useCallback(
    (path: string) => {
      const text = embedLink(path);
      const done = () => actions.notify("Embed link copied");
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => actions.notify("Couldn’t copy the link", { tone: "error" }));
    },
    [actions],
  );

  const open = useCallback(
    (path: string, target: OpenTarget = "current") => actions.openView({ type: "attachment", path }, target),
    [actions],
  );

  const notify = useCallback(
    (message: string, error?: boolean) => void actions.notify(message, error ? { tone: "error" } : undefined),
    [actions],
  );

  const value = useMemo<AttachmentsValue>(
    () => ({ items, status, lookup, settings, setSettings, refresh, upload, uploadMany, remove, copyEmbed, open, notify }),
    [items, status, lookup, settings, setSettings, refresh, upload, uploadMany, remove, copyEmbed, open, notify],
  );
  return <Ctx value={value}>{children}</Ctx>;
}
