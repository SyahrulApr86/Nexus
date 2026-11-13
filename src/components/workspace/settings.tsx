"use client";

import { useRef } from "react";
import { X } from "lucide-react";
import { useWorkspace, type Theme } from "./store";
import { IconButton, Modal, Shortcut } from "./ui";

const HOTKEYS: [string, string][] = [
  ["Open quick switcher", "Mod+O"],
  ["Open command palette", "Mod+P"],
  ["Create new note", "Alt+N"],
  ["Toggle reading and editing view", "Mod+E"],
  ["Search in all notes", "Mod+Shift+F"],
  ["Open graph view", "Mod+G"],
  ["Open today’s daily note", "Mod+D"],
  ["New tab", "Alt+T"],
  ["Close tab", "Alt+W"],
  ["Next tab", "Alt+]"],
  ["Previous tab", "Alt+["],
  ["Navigate back", "Ctrl+Alt+←"],
  ["Navigate forward", "Ctrl+Alt+→"],
  ["Save now", "Mod+S"],
  ["Open settings", "Mod+,"],
];

const THEMES: { id: Theme; label: string; hint: string }[] = [
  { id: "system", label: "Match system", hint: "Light by day, navy at night, as your device sets it" },
  { id: "light", label: "Light", hint: "White sheets on a blue-grey frame" },
  { id: "dark", label: "Dark", hint: "Navy frame with dark sheets" },
];

function Row({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-rule py-5 last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
      <div className="max-w-sm">
        <h3 className="font-medium">{title}</h3>
        {description && <p className="mt-1 text-[13px] leading-5 text-muted">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function SettingsDialog({ section = "general" }: { section?: "general" | "hotkeys" }) {
  const w = useWorkspace();
  const file = useRef<HTMLInputElement>(null);
  const close = () => w.actions.setSettingsOpen(false);

  return (
    <Modal label="Settings" onClose={close} className="max-w-2xl" placement="top">
      {/* The header sits outside the scroller, so it can never cover a focused control. */}
      <div className="flex max-h-[min(80vh,calc(100dvh-12vh-1.5rem))] flex-col overflow-hidden rounded-xl border border-border bg-sheet shadow-[var(--shadow-float)]">
        <div className="flex shrink-0 items-center justify-between border-b border-rule px-6 py-3">
          <h2 className="text-[16px] font-medium">Settings</h2>
          <IconButton label="Close settings" onClick={close}>
            <X />
          </IconButton>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-6 pb-4">
          <Row title="Theme" description="Nexus follows your device until you pick one.">
            <fieldset>
              <legend className="sr-only">Theme</legend>
              <div className="flex flex-col gap-1">
                {THEMES.map((t) => (
                  <label key={t.id} className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-sheet-hover">
                    <input
                      type="radio"
                      name="theme"
                      value={t.id}
                      checked={w.theme === t.id}
                      onChange={() => w.actions.setTheme(t.id)}
                      className="mt-1 size-4 accent-[var(--accent)]"
                    />
                    <span>
                      <span className="block">{t.label}</span>
                      <span className="block text-[12px] text-faint">{t.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </Row>
          <Row title="Import notes" description="Upload an Obsidian vault as a .zip, or one or more .md files. Notes with the same path are overwritten; attachments and .obsidian settings are skipped.">
            <button
              type="button"
              onClick={() => file.current?.click()}
              className="h-9 rounded-lg border border-control px-4 font-medium transition-colors hover:bg-sheet-hover"
            >
              Choose files…
            </button>
            <input
              ref={file}
              type="file"
              accept=".zip,.md,application/zip,text/markdown"
              multiple
              hidden
              onChange={(e) => {
                void w.actions.importFiles([...(e.target.files ?? [])]);
                e.target.value = "";
              }}
            />
          </Row>
          <Row title="Export vault" description="Download every note as a .zip of plain .md files that opens in Obsidian.">
            <button
              type="button"
              onClick={w.actions.exportVault}
              className="h-9 rounded-lg border border-control px-4 font-medium transition-colors hover:bg-sheet-hover"
            >
              Download .zip
            </button>
          </Row>
          <Row title="Account" description={`Signed in as ${w.user.name}`}>
            <button
              type="button"
              onClick={w.actions.logout}
              className="h-9 rounded-lg border border-control px-4 font-medium transition-colors hover:bg-sheet-hover"
            >
              Sign out
            </button>
          </Row>
          <div className="py-5">
            <h3
              id="settings-hotkeys"
              tabIndex={-1}
              data-autofocus={section === "hotkeys" ? true : undefined}
              className="scroll-mt-4 font-medium"
            >
              Hotkeys
            </h3>
            <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
              {HOTKEYS.map(([label, keys]) => (
                <div key={label} className="flex items-center justify-between gap-3 text-[13px]">
                  <dt className="text-muted">{label}</dt>
                  <dd>
                    <Shortcut keys={keys} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </Modal>
  );
}
