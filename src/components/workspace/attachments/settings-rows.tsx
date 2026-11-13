"use client";

import { useId, useState, type ComponentType, type ReactNode } from "react";
import { useAttachments } from "./context";
import { DEFAULT_ATTACHMENT_SETTINGS, cleanFolder, type AttachmentLocation } from "./model";

type RowProps = { title: string; description?: string; children: ReactNode };

const LOCATIONS: { id: AttachmentLocation; label: string; hint: string }[] = [
  { id: "root", label: "Vault root", hint: "Next to your top-level notes" },
  { id: "note", label: "Same folder as the current note", hint: "Keeps a note and its files together" },
  { id: "folder", label: "In the folder below", hint: "One place for every file" },
];

/** Settings for attachments, drawn with the settings dialog's own row. */
export function AttachmentSettingsRows({ Row }: { Row: ComponentType<RowProps> }) {
  const att = useAttachments();
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  if (!att) return null;
  const { settings, setSettings } = att;
  const folder = draft ?? settings.folder;
  const commit = () => {
    if (draft === null) return;
    setSettings({ folder: cleanFolder(draft) || DEFAULT_ATTACHMENT_SETTINGS.folder });
    setDraft(null);
  };

  return (
    <>
      <Row
        title="Default location for new attachments"
        description="Where images and files you paste or drop into a note are stored. The note gets an embed link to them."
      >
        <fieldset>
          <legend className="sr-only">Default location for new attachments</legend>
          <div className="flex flex-col gap-1">
            {LOCATIONS.map((l) => (
              <label key={l.id} className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-sheet-hover">
                <input
                  type="radio"
                  name="attachment-location"
                  value={l.id}
                  checked={settings.location === l.id}
                  onChange={() => setSettings({ location: l.id })}
                  className="mt-1 size-4 accent-[var(--accent)]"
                />
                <span>
                  <span className="block">{l.label}</span>
                  <span className="block text-[12px] text-faint">{l.hint}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="mt-2 px-2">
            <label htmlFor={`${id}-folder`} className="block text-[12px] font-medium text-muted">
              Attachment folder
            </label>
            <input
              id={`${id}-folder`}
              type="text"
              value={folder}
              disabled={settings.location !== "folder"}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit();
                }
              }}
              className="att-input mt-1 h-9 w-full max-w-64 rounded-lg border border-control bg-sheet px-3 text-[14px] disabled:opacity-60 max-md:h-11 max-md:text-[16px]"
            />
          </div>
        </fieldset>
      </Row>
      <Row title="Show attachments" description="List images, PDFs, audio and video in the file explorer next to your notes.">
        <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-sheet-hover">
          <input
            type="checkbox"
            checked={settings.show}
            onChange={(e) => setSettings({ show: e.target.checked })}
            className="size-4 accent-[var(--accent)]"
          />
          <span>Show in file explorer</span>
        </label>
      </Row>
    </>
  );
}
