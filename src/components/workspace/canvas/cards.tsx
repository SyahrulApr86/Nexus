"use client";

import { memo, useEffect, useRef } from "react";
import { ExternalLink, FileWarning, Globe, LayoutDashboard } from "lucide-react";
import { canvasTitle, isCanvasPath, isNoteFile } from "@/lib/canvas";
import { basename } from "@/lib/markdown/parse";
import { Editor, type EditorHandle } from "../editor";
import { Reader } from "../reader";
import { shallowEqual, useWorkspaceActions, useWorkspaceSelector } from "../store";

const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;

/** Display name of a file card's target: the note name without ".md". */
export function fileLabel(file: string) {
  return basename(file).replace(/\.md$/i, "");
}

/** Only http(s) URLs become links; anything else is shown as text. */
export function safeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Text card                                                           */
/* ------------------------------------------------------------------ */

export const TextCardBody = memo(function TextCardBody({
  text,
  editing,
  label,
  onChange,
}: {
  text: string;
  editing: boolean;
  label: string;
  onChange: (text: string) => void;
}) {
  const actions = useWorkspaceActions();
  const w = useWorkspaceSelector((s) => ({ exists: s.exists, noteNames: s.noteNames, tagNames: s.tagNames }), shallowEqual);
  const handle = useRef<EditorHandle | null>(null);
  // Editing starts with the caret in the card.
  useEffect(() => {
    if (!editing) return;
    const raf = requestAnimationFrame(() => handle.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [editing]);
  if (editing)
    return (
      <div className="canvas-editor h-full overflow-y-auto overscroll-contain px-4 py-3" data-canvas-scroll>
        <Editor
          initial={text}
          label={label}
          onChange={onChange}
          noteNames={w.noteNames}
          tagNames={w.tagNames}
          exists={w.exists}
          onOpenLink={(t, nt) => actions.openLink(t, nt)}
          onOpenTag={actions.openTag}
          handleRef={handle}
        />
      </div>
    );
  return (
    <div className="h-full overflow-y-auto overscroll-contain px-4 py-3" data-canvas-scroll>
      {text.trim() ? (
        <Reader content={text} exists={w.exists} onOpenLink={actions.openLink} onOpenTag={actions.openTag} onToggleTask={onChange} />
      ) : (
        <p className="text-[14px] text-faint">Empty card. Double-click or press Enter to write.</p>
      )}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/* File card: a note, a canvas or an image                             */
/* ------------------------------------------------------------------ */

export const FileCardBody = memo(function FileCardBody({ file, selfId }: { file: string; selfId: string }) {
  const actions = useWorkspaceActions();
  const target = useWorkspaceSelector((s) => s.findNote(file)?.id ?? null);
  const w = useWorkspaceSelector(
    (s) => ({ content: target ? s.notes[target]?.content : undefined, failed: target ? !!s.noteErrors[target] : false, exists: s.exists }),
    shallowEqual,
  );
  const note = isNoteFile(file);
  const canvas = isCanvasPath(file);
  const loaded = w.content !== undefined;

  // The card follows the note: it is loaded into the shared cache, so edits elsewhere show here.
  useEffect(() => {
    if (target && note && !canvas && !loaded && target !== selfId) void actions.loadNote(target);
  }, [target, note, canvas, loaded, selfId, actions]);

  if (IMAGE.test(file))
    return (
      // eslint-disable-next-line @next/next/no-img-element -- same-origin attachment, sized by the card
      <img src={`/api/attachments/file?path=${encodeURIComponent(file)}`} alt={basename(file)} draggable={false} className="h-full w-full rounded-[11px] object-contain" />
    );

  const name = canvas ? canvasTitle(basename(file)) : fileLabel(file);
  const header = (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-rule px-3">
      {canvas && <LayoutDashboard aria-hidden="true" className="size-3.5 shrink-0 stroke-[1.5] text-faint" />}
      {target ? (
        <button
          type="button"
          tabIndex={-1}
          data-canvas-open={target}
          className="min-w-0 truncate rounded text-[13px] font-medium text-accent-ink hover:underline"
          translate="no"
          title="Open note (double-click the card)"
        >
          {name}
        </button>
      ) : (
        <span className="min-w-0 truncate text-[13px] font-medium text-muted" translate="no">
          {name}
        </span>
      )}
    </div>
  );

  if (!note || !target)
    return (
      <div className="flex h-full flex-col">
        {header}
        <p className="flex items-start gap-2 px-3 py-3 text-[13px] leading-5 text-muted">
          <FileWarning aria-hidden="true" className="mt-0.5 size-4 shrink-0 stroke-[1.5] text-faint" />
          {note ? `“${file}” is not in this vault.` : "This file can’t be shown on a canvas."}
        </p>
      </div>
    );

  return (
    <div className="flex h-full flex-col">
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3" data-canvas-scroll>
        {canvas || target === selfId ? (
          <p className="text-[13px] text-muted">A canvas. Double-click to open it.</p>
        ) : loaded ? (
          <Reader
            noteId={target}
            content={w.content!}
            exists={w.exists}
            onOpenLink={actions.openLink}
            onOpenTag={actions.openTag}
            onToggleTask={(c) => actions.onChange(target, c)}
          />
        ) : w.failed ? (
          <p className="text-[13px] text-muted">Couldn’t load this note.</p>
        ) : (
          <p className="text-[13px] text-faint" role="status">
            Loading…
          </p>
        )}
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/* Web link card                                                       */
/* ------------------------------------------------------------------ */

export const LinkCardBody = memo(function LinkCardBody({ url }: { url: string }) {
  const href = safeUrl(url);
  let host = url;
  try {
    host = new URL(url).hostname || url;
  } catch {}
  return (
    <div className="flex h-full flex-col justify-center gap-1 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <Globe aria-hidden="true" className="size-4 shrink-0 stroke-[1.5] text-faint" />
        <span className="min-w-0 truncate text-[14px] font-medium" translate="no">
          {host}
        </span>
      </div>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          tabIndex={-1}
          className="inline-flex min-w-0 items-center gap-1 text-[13px] text-accent-ink hover:underline"
        >
          <span className="truncate">{url}</span>
          <ExternalLink aria-hidden="true" className="size-3.5 shrink-0 stroke-[1.5]" />
        </a>
      ) : (
        <span className="truncate text-[13px] text-muted">{url}</span>
      )}
    </div>
  );
});
