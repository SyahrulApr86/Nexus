import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCreateNote, useNote, useUpdateNote } from "../api/notes.js";
import { ApiError } from "../api/client.js";
import { Editor } from "../components/Editor.js";
import { MarkdownPreview } from "../components/MarkdownPreview.js";
import { useToast } from "../components/Toast.js";
import { wikilinkAutocomplete } from "../components/wikilinkAutocomplete.js";
import { ConfirmDialog } from "../components/Dialogs.js";

const AUTOSAVE_DEBOUNCE_MS = 1000; // FR-006

export function NoteEditorScreen({ noteId }: { noteId: string }) {
  const { data, isLoading } = useNote(noteId);
  const update = useUpdateNote();
  const createNote = useCreateNote();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const editorExtensions = useMemo(() => [wikilinkAutocomplete()], []);

  const [missingLink, setMissingLink] = useState<string | null>(null);

  const openWikilink = useCallback(
    (title: string, resolvedId: string | null) => {
      if (resolvedId) {
        navigate({ to: "/notes/$noteId", params: { noteId: resolvedId } });
        return;
      }
      // FR-012: broken link — offer to create the missing note
      setMissingLink(title);
    },
    [navigate],
  );

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving">(
    "saved",
  );
  // The server updatedAt our edits are based on (optimistic concurrency)
  const baseRef = useRef<string | null>(null);
  const loadedNoteRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef({ title: "", content: "" });

  // Load note into local state when it arrives / note switches
  useEffect(() => {
    if (!data) return;
    if (loadedNoteRef.current === data.note.id) return;
    loadedNoteRef.current = data.note.id;
    setTitle(data.note.title);
    setContent(data.note.content);
    baseRef.current = data.note.updatedAt;
    latestRef.current = { title: data.note.title, content: data.note.content };
    setSaveState("saved");
  }, [data]);

  // Serialize flushes: overlapping saves must never race each other, and a
  // conflict retry must send the LATEST content, not the snapshot that lost.
  const flushChainRef = useRef<Promise<void>>(Promise.resolve());

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    flushChainRef.current = flushChainRef.current.then(async () => {
      const { title, content } = latestRef.current;
      setSaveState("saving");
      try {
        const note = await update.mutateAsync({
          noteId,
          title,
          content,
          baseUpdatedAt: baseRef.current ?? undefined,
        });
        baseRef.current = note.updatedAt;
        setSaveState("saved");
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          // US2-S5: last-write-wins with notification, never silent
          toast(
            "This note was changed in another session. Your latest edit replaced that version.",
            "warning",
          );
          const note = await update.mutateAsync({
            noteId,
            ...latestRef.current, // freshest state at retry time
          });
          baseRef.current = note.updatedAt;
          setSaveState("saved");
        } else {
          setSaveState("dirty");
          toast("Autosave failed. Retrying on next change.", "warning");
        }
      }
    });
    return flushChainRef.current;
  }, [noteId, toast, update]);

  const scheduleSave = useCallback(() => {
    setSaveState("dirty");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
  }, [flush]);

  // Flush pending changes on tab close/hide (US2-S3: no data loss)
  useEffect(() => {
    const onPageHide = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        // keepalive lets the request outlive the closing tab
        void fetch(`/api/notes/${noteId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          keepalive: true,
          body: JSON.stringify(latestRef.current),
        });
      }
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onPageHide);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        void flush();
      }
    };
  }, [noteId, flush]);

  // Live conflict pushes from other sessions (US10) — refetch note list
  useEffect(() => {
    return () => {
      qc.invalidateQueries({ queryKey: ["note", noteId] });
    };
  }, [noteId, qc]);

  // US10-S3: queued changes sync when connectivity returns
  useEffect(() => {
    const onOnline = () => {
      if (timerRef.current) void flush();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [flush]);

  if (isLoading || !data) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mx-auto w-full max-w-5xl px-8 pb-2 pt-6">
        <div className="flex items-baseline gap-3">
          <label htmlFor="note-title" className="sr-only">
            Note title
          </label>
          <input
            id="note-title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              latestRef.current.title = e.target.value;
              scheduleSave();
            }}
            className="min-w-0 flex-1 bg-transparent text-[28px] font-semibold tracking-heading text-ink outline-none placeholder:text-mist"
            placeholder="Untitled"
          />
          <span
            className="shrink-0 text-[12px] text-muted"
            data-testid="save-state"
            role="status"
          >
            {saveState === "saved"
              ? "Saved"
              : saveState === "saving"
                ? "Saving…"
                : "Unsaved changes"}
          </span>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 border-t border-border">
        <div className="min-h-0 border-r border-border">
          <Editor
            value={content}
            extensions={editorExtensions}
            onChange={(v) => {
              setContent(v);
              latestRef.current.content = v;
              scheduleSave();
            }}
          />
        </div>
        <div className="min-h-0 bg-surface/40" data-testid="preview">
          <MarkdownPreview
            content={content}
            links={data.links}
            onOpenWikilink={openWikilink}
            onTagClick={(tag) =>
              navigate({ to: "/tags/$tagName", params: { tagName: tag } })
            }
          />
        </div>
      </div>
      <ConfirmDialog
        open={missingLink !== null}
        title="Create missing note"
        message={`"${missingLink ?? ""}" doesn't exist yet. Create it?`}
        confirmLabel="Create note"
        onConfirm={() => {
          if (!missingLink) return;
          createNote.mutate(
            { title: missingLink },
            {
              onSuccess: (note) =>
                navigate({ to: "/notes/$noteId", params: { noteId: note.id } }),
            },
          );
        }}
        onClose={() => setMissingLink(null)}
      />
    </div>
  );
}
