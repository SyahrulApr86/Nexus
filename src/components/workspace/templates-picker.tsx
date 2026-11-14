"use client";

/**
 * "Insert template": a fuzzy picker over the notes in the template folder. The chosen
 * template goes in at the caret (editing view) or at the end (reading view); an empty note
 * becomes the template. Its frontmatter merges into the note's.
 */

import { useId, useMemo, useState } from "react";
import { FileText } from "lucide-react";
import { applyTemplate, normalizeFolder, renderTemplate, templatesIn } from "@/lib/templates";
import { diffText } from "@/lib/markdown/frontmatter-edit";
import { shallowEqual, useWorkspaceActions, useWorkspaceSelector } from "./store";
import type { Command } from "./palette";
import type { TreeNote } from "./api";
import { Modal, Shortcut } from "./ui";
import {
  closeTemplatePicker,
  openTemplatePicker,
  readTemplatePrefs,
  requestAddProperty,
  setTemplatePrefs,
  useRequests,
  useTemplatePrefs,
} from "./templates-settings";

/** Subsequence fuzzy match; lower is better, null is no match. */
function fuzzy(query: string, text: string): number | null {
  const q = query.toLowerCase().trim();
  const t = text.toLowerCase();
  if (!q) return 0;
  const direct = t.indexOf(q);
  if (direct !== -1) return direct;
  let ti = 0;
  let gaps = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    gaps += found - ti;
    ti = found + 1;
  }
  return 100 + gaps;
}

/** Command palette entries for the note in focus. */
export function templateCommands(noteId: string): Command[] {
  return [
    { id: "insert-template", label: "Insert template", run: openTemplatePicker },
    {
      id: "add-property",
      label: "Add file property",
      run: () => {
        if (readTemplatePrefs().showProperties !== "visible") setTemplatePrefs({ showProperties: "visible" });
        requestAddProperty(noteId);
      },
    },
  ];
}

/** Mounted once in the workspace; shows the picker while it is requested. */
export function TemplatePickerHost() {
  const open = useRequests().picker;
  return open ? <TemplatePicker /> : null;
}

function TemplatePicker() {
  const actions = useWorkspaceActions();
  const w = useWorkspaceSelector(
    (s) => ({ view: s.focusView, notes: s.tree.notes, editor: s.editor, liveContent: s.liveContent }),
    shallowEqual,
  );
  const prefs = useTemplatePrefs();
  const folder = normalizeFolder(prefs.folder);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const listId = useId();
  const hintId = useId();

  const templates = useMemo(() => templatesIn(w.notes, folder), [w.notes, folder]);
  const items = useMemo(
    () =>
      templates
        .map((n) => ({ n, score: Math.min(fuzzy(q, n.name) ?? 1e9, (fuzzy(q, n.path) ?? 1e9) + 50) }))
        .filter((x) => x.score < 1e9)
        .sort((a, b) => a.score - b.score)
        .map((x) => x.n),
    [templates, q],
  );
  const active = items[Math.min(sel, items.length - 1)];
  const view = w.view;
  const noteName = view.type === "note" ? w.notes.find((n) => n.id === view.id)?.name : undefined;

  const insert = async (tpl: TreeNote) => {
    closeTemplatePicker();
    if (view.type !== "note") {
      actions.notify("Open a note to insert a template into.");
      return;
    }
    const loaded = await actions.loadNote(tpl.id);
    if (!loaded) {
      actions.notify(`Couldn’t load the template “${tpl.name}”.`, { tone: "error" });
      return;
    }
    const p = readTemplatePrefs();
    const rendered = renderTemplate(w.liveContent(tpl.id), {
      title: noteName ?? "",
      now: new Date(),
      dateFormat: p.dateFormat,
      timeFormat: p.timeFormat,
    });
    const cur = w.liveContent(view.id);
    const h = w.editor.current;
    if (view.mode === "edit" && h) {
      const r = applyTemplate(cur, rendered, h.cursor());
      h.apply(diffText(cur, r.text), r.cursor);
      requestAnimationFrame(() => h.focus());
    } else {
      const r = applyTemplate(cur, rendered, cur.length);
      actions.onChange(view.id, r.text);
    }
    actions.notify(`Inserted “${tpl.name}”`);
  };

  const close = () => {
    closeTemplatePicker();
    // Opened from the palette, the picker's own opener is gone: go back to the note's text.
    const h = w.editor.current;
    if (view.type === "note" && view.mode === "edit" && h) requestAnimationFrame(() => h.focus());
  };

  return (
    <Modal label="Insert template" describedBy={hintId} onClose={close} className="max-w-xl" placement="top">
      <div className="overflow-hidden rounded-lg border border-mist bg-sheet shadow-[var(--shadow-float)]">
        <input
          data-autofocus
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={active ? `tpl-${active.id}` : undefined}
          aria-autocomplete="list"
          aria-label="Find a template"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (active) void insert(active);
            }
          }}
          placeholder="Find a template…"
          autoComplete="off"
          spellCheck={false}
          className="h-12 w-full border-b border-rule bg-transparent px-4 text-[16px] outline-none placeholder:text-faint"
        />
        <ul id={listId} role="listbox" aria-label="Templates" className="max-h-[min(50vh,420px)] overflow-y-auto p-1.5">
          {items.map((n, i) => (
            <li
              key={n.id}
              id={`tpl-${n.id}`}
              role="option"
              aria-selected={n === active}
              onPointerMove={() => setSel(i)}
              onClick={() => void insert(n)}
              className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 ${n === active ? "bg-active outline-2 outline-offset-[-2px] outline-[var(--focus)]" : ""}`}
            >
              <FileText aria-hidden="true" className="size-4 shrink-0 stroke-[1.5] text-faint" />
              <span className="truncate" translate="no">
                {n.name}
              </span>
              {n.path.slice(folder.length + 1) !== n.name && (
                <span className="ml-auto max-w-[45%] truncate text-[12px] text-faint" translate="no">
                  {n.path.slice(folder.length + 1, n.path.lastIndexOf("/"))}
                </span>
              )}
            </li>
          ))}
        </ul>
        {items.length === 0 && (
          <div role="status" className="px-4 pb-3 pt-1.5 text-muted">
            {templates.length === 0 ? (
              <p>
                No templates in “{folder || "no folder set"}”. Add notes to that folder, or pick another folder in{" "}
                <button
                  type="button"
                  className="font-medium text-accent-ink hover:underline"
                  onClick={() => {
                    close();
                    actions.setSettingsOpen("general");
                  }}
                >
                  Settings
                </button>
                .
              </p>
            ) : (
              <p>No matching templates</p>
            )}
          </div>
        )}
        <div id={hintId} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-rule px-4 py-2 text-[12px] text-faint [&>span]:whitespace-nowrap">
          <span className="inline-flex items-center gap-1.5">
            <Shortcut keys="↑" /> <Shortcut keys="↓" /> to move
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Shortcut keys="↵" /> to insert{w.view.type === "note" && w.view.mode === "edit" ? " at the cursor" : ""}
          </span>
          <span className="ml-auto inline-flex items-center gap-1.5">
            <Shortcut keys="Esc" /> to close
          </span>
        </div>
      </div>
    </Modal>
  );
}
