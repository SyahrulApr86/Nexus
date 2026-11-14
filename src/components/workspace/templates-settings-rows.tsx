"use client";

/** Settings rows for templates and properties, rendered inside the settings dialog. */

import { useId, useMemo, type ReactNode } from "react";
import { formatDate, normalizeFolder, templatesIn } from "@/lib/templates";
import { shallowEqual, useWorkspaceSelector } from "./store";
import { setTemplatePrefs, useTemplatePrefs, type ShowProperties } from "./templates-settings";

type RowComponent = (props: { title: string; description?: string; children: ReactNode }) => ReactNode;

const SHOW: { id: ShowProperties; label: string; hint: string }[] = [
  { id: "visible", label: "Visible", hint: "A form at the top of the note" },
  { id: "hidden", label: "Hidden", hint: "Kept in the file, out of sight" },
  { id: "source", label: "Source", hint: "Raw YAML in the editor" },
];

export const FIELD =
  "h-9 w-full rounded-lg border border-control bg-sheet px-3 text-[16px] placeholder:text-faint md:text-[14px] sm:w-60 pointer-coarse:h-11";

export function Field({
  label,
  value,
  onChange,
  placeholder,
  list,
  problem,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  list?: string;
  problem?: string | null;
  hint?: string;
}) {
  const id = useId();
  const noteId = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[12px] font-medium text-muted">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        list={list}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem || hint ? noteId : undefined}
        className={`${FIELD} ${problem ? "border-negative" : ""}`}
      />
      {(problem || hint) && (
        <p id={noteId} className={`text-[12px] leading-4 ${problem ? "text-negative" : "text-faint"}`}>
          {problem ?? hint}
        </p>
      )}
    </div>
  );
}

export function TemplateSettings({ Row }: { Row: RowComponent }) {
  const prefs = useTemplatePrefs();
  const { folders, notes } = useWorkspaceSelector((s) => ({ folders: s.tree.folders, notes: s.tree.notes }), shallowEqual);
  const foldersId = useId();
  const folder = normalizeFolder(prefs.folder);
  const templates = useMemo(() => templatesIn(notes, folder), [notes, folder]);
  const folderKnown = !folder || templates.length > 0 || folders.some((f) => f.toLowerCase() === folder.toLowerCase());
  // Fixed sample date, so the preview reads the same on every render.
  const sample = useMemo(() => new Date(2026, 0, 5, 14, 30), []);

  return (
    <>
      <Row
        title="Templates"
        description="Notes in this folder show up under “Insert template” in the command palette. {{title}}, {{date}} and {{time}} are filled in; {{date:YYYY-MM-DD}} takes a format."
      >
        <div className="flex flex-col gap-3">
          <Field
            label="Template folder"
            value={prefs.folder}
            onChange={(v) => setTemplatePrefs({ folder: v })}
            placeholder="Templates"
            list={foldersId}
            problem={folderKnown ? null : `There is no folder called “${folder}” yet.`}
            hint={folderKnown ? `${templates.length} ${templates.length === 1 ? "template" : "templates"}` : undefined}
          />
          <datalist id={foldersId}>
            {folders.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
          <Field
            label="Date format"
            value={prefs.dateFormat}
            onChange={(v) => setTemplatePrefs({ dateFormat: v })}
            placeholder="YYYY-MM-DD"
            hint={`For example ${formatDate(sample, prefs.dateFormat || "YYYY-MM-DD")}`}
          />
          <Field
            label="Time format"
            value={prefs.timeFormat}
            onChange={(v) => setTemplatePrefs({ timeFormat: v })}
            placeholder="HH:mm"
            hint={`For example ${formatDate(sample, prefs.timeFormat || "HH:mm")}`}
          />
        </div>
      </Row>
      {/* daily: the daily note template lives with the other daily note settings (calendar/daily-settings.tsx) */}
      <Row title="Properties in notes" description="Frontmatter at the top of a note can show as an editable form, stay hidden, or show as YAML source.">
        <fieldset>
          <legend className="sr-only">Show properties</legend>
          <div className="flex flex-col gap-1">
            {SHOW.map((o) => (
              <label key={o.id} className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-hover">
                <input
                  type="radio"
                  name="show-properties"
                  value={o.id}
                  checked={prefs.showProperties === o.id}
                  onChange={() => setTemplatePrefs({ showProperties: o.id })}
                  className="mt-1 size-4 accent-[var(--accent)]"
                />
                <span>
                  <span className="block">{o.label}</span>
                  <span className="block text-[12px] text-faint">{o.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </Row>
    </>
  );
}
