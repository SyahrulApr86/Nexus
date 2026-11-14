"use client";

import { useEffect, useRef, useState } from "react";
import { FileWarning } from "lucide-react";
import { canvasTitle, parseCanvas } from "@/lib/canvas";
import { Editor } from "../editor";
import { sameNoteMeta, shallowEqual, useWorkspaceActions, useWorkspaceSelector, type CachedNote } from "../store";
import { Bar } from "../ui";
import { CanvasBoard } from "./board";

/** Re-render only when the server text replaced the note (a new rev) or it was renamed, never on our own saves. */
const sameRev = (a: CachedNote | undefined, b: CachedNote | undefined) => a === b || (sameNoteMeta(a, b) && a!.rev === b!.rev);

/**
 * A .canvas note in a tab: the canvas editor, or a read-only explanation with "Open as text" when
 * the file is not valid JSON Canvas. Changes go through the workspace's normal save path.
 */
export function CanvasView({ id, focused, onClose }: { id: string; focused: boolean; onClose: () => void }) {
  const actions = useWorkspaceActions();
  const note = useWorkspaceSelector((s) => s.notes[id], sameRev);
  const w = useWorkspaceSelector(
    (s) => ({ error: s.noteErrors[id], known: s.tree.notes.find((n) => n.id === id)?.name, liveContent: s.liveContent, focusTick: s.focusTick }),
    shallowEqual,
  );
  const [asText, setAsText] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const ready = !!note;
  const { peekFocusRequest, clearFocusRequest } = actions;

  // An open that asked for focus (new canvas, quick switcher) lands on the canvas itself.
  useEffect(() => {
    if (!ready || !focused || !peekFocusRequest(id)) return;
    const raf = requestAnimationFrame(() => {
      clearFocusRequest(id);
      host.current?.querySelector<HTMLElement>(".canvas-root, .cm-content")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [id, ready, focused, peekFocusRequest, clearFocusRequest, note?.rev, w.focusTick]);

  // The newest local text: a remount (new rev) starts from what the server replaced it with.
  const content = note ? w.liveContent(id) : "";
  // This view re-renders on a new server version (rev), not on our own edits, so this parses rarely.
  const parsed = note && !asText ? parseCanvas(content) : null;

  if (w.error && !note) {
    const gone = w.error.status === 404;
    return (
      <div className="mx-auto max-w-[42rem] px-6 py-10 md:px-10">
        <h1 className="sr-only">{w.known ?? "Canvas"}</h1>
        <p className="text-muted">
          {gone ? "This canvas no longer exists. It was deleted or moved, maybe on another device." : w.error.status === 0 ? w.error.message : "Couldn’t load this canvas. Try again in a moment."}
        </p>
        <button type="button" className="mt-3 font-medium text-accent-ink hover:underline" onClick={gone ? onClose : () => actions.loadNote(id)}>
          {gone ? "Close tab" : "Try again"}
        </button>
      </div>
    );
  }

  if (!note)
    return (
      <div className="flex h-full flex-col gap-3 p-6" role="status" aria-busy="true">
        <span className="sr-only">Loading canvas…</span>
        <Bar w="30%" h={14} />
        <Bar w="55%" h={120} />
      </div>
    );

  if (asText)
    return (
      <div ref={host} className="mx-auto w-full max-w-[42rem] px-5 pb-8 pt-4 md:px-10 md:pt-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h1 className="min-w-0 truncate text-[16px] font-semibold" translate="no">
            {note.name}
          </h1>
          <button type="button" onClick={() => setAsText(false)} className="rounded-md px-2 py-1 font-medium text-accent-ink hover:bg-hover">
            Open as canvas
          </button>
        </div>
        <Editor
          key={`${note.id}:${note.rev}`}
          label={`${note.name}, canvas file as text`}
          initial={content}
          onChange={(c) => actions.onChange(note.id, c)}
          noteNames={() => []}
          tagNames={() => []}
          exists={() => true}
          onOpenLink={() => {}}
          onOpenTag={() => {}}
        />
      </div>
    );

  if (!parsed?.ok)
    return (
      <div ref={host} className="mx-auto max-w-[42rem] px-6 py-10 md:px-10">
        <h1 className="mb-3 text-[16px] font-semibold" translate="no">
          {note.name}
        </h1>
        <div role="alert" className="flex items-start gap-3 rounded-lg border border-border px-4 py-3">
          <FileWarning aria-hidden="true" className="mt-0.5 size-5 shrink-0 stroke-[1.5] text-negative" />
          <div>
            <p className="font-medium">This canvas can’t be shown</p>
            <p className="mt-1 text-[13px] leading-5 text-muted">{parsed?.error} Nothing was changed. Open it as text to fix it, or restore an earlier version from its history.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setAsText(true)}
          className="mt-4 inline-flex h-10 items-center rounded-lg bg-accent px-4 font-medium text-navy hover:brightness-95"
        >
          Open as text
        </button>
      </div>
    );

  return (
    <div ref={host} className="flex h-full min-h-0 flex-col">
      {/* The board is the whole view; its name is in the tab and the breadcrumb. */}
      <h1 className="sr-only" translate="no">
        {canvasTitle(note.name)}
      </h1>
      <CanvasBoard
        key={`${note.id}:${note.rev}`}
        noteId={note.id}
        name={note.name}
        initial={parsed.doc}
        onSave={(json) => actions.onChange(note.id, json)}
      />
    </div>
  );
}
