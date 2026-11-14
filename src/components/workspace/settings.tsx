"use client";

import { useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { useWorkspace, type SettingsSection, type Theme } from "./store";
import { IconButton, Modal, Shortcut, isMac } from "./ui";
/* templates-properties */
import { TemplateSettings } from "./templates-settings-rows";
/* end templates-properties */
/* attachments-ui */
import { AttachmentSettingsRows } from "./attachments/settings-rows";
/* end attachments-ui */

/** Label, keys, and the Mac keys when they differ by more than Mod. */
const HOTKEYS: [string, string, string?][] = [
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
  ["Toggle the task on this line", "Mod+L"],
  ["Follow the link at the cursor", "Alt+Enter"],
  ["Follow the link in a new tab", "Shift+Alt+Enter"],
  ["Leave the editor, then press Tab", "Esc"],
  ["Make Tab move focus instead of indenting", "Ctrl+M", "Shift+Alt+M"],
];

const noopSubscribe = () => () => {};

const THEMES: { id: Theme; label: string; hint: string }[] = [
  { id: "system", label: "Match system", hint: "Light by day, navy at night, as your device sets it" },
  { id: "light", label: "Light", hint: "White sheets on a blue-grey frame" },
  { id: "dark", label: "Dark", hint: "Deep navy, the work one step lighter" },
];

/** What each theme looks like: the frame, the inset sheet, a title and lines of text, the blue mark. */
const PREVIEW = {
  light: { frame: "#eef1f5", sheet: "#ffffff", edge: "#d9dfe6", ink: "#02070a", line: "#b1b7c3", accent: "#01669a" },
  dark: { frame: "#02070a", sheet: "#070f15", edge: "#18252f", ink: "#e9eef2", line: "#2c3c49", accent: "#0297de" },
};

function ThemePreview({ id }: { id: Theme }) {
  const half = (t: (typeof PREVIEW)["light"], clip?: string) => (
    <g clipPath={clip}>
      <rect width="120" height="72" fill={t.frame} />
      <rect x="22" y="8" width="90" height="56" rx="3" fill={t.sheet} stroke={t.edge} />
      <rect x="6" y="12" width="10" height="1.5" fill={t.line} />
      <rect x="6" y="17" width="8" height="1.5" fill={t.line} />
      <rect x="6" y="22" width="10" height="1.5" fill={t.accent} />
      <rect x="32" y="18" width="40" height="5" rx="1" fill={t.ink} />
      <rect x="32" y="30" width="66" height="2" fill={t.line} />
      <rect x="32" y="36" width="58" height="2" fill={t.line} />
      <rect x="32" y="42" width="62" height="2" fill={t.line} />
    </g>
  );
  return (
    <svg viewBox="0 0 120 72" aria-hidden="true" className="block h-auto w-full rounded-[5px]">
      <defs>
        <clipPath id="theme-half">
          <rect x="60" width="60" height="72" />
        </clipPath>
      </defs>
      {half(id === "dark" ? PREVIEW.dark : PREVIEW.light)}
      {id === "system" && half(PREVIEW.dark, "url(#theme-half)")}
    </svg>
  );
}

function Row({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-border py-5 last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-10">
      <div className="max-w-sm">
        <h4 className="text-[14px] font-medium leading-5">{title}</h4>
        {description && <p className="mt-1 text-[13px] leading-5 text-muted">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const SECTIONS: { id: SettingsSection; label: string; description: string }[] = [
  { id: "general", label: "Appearance", description: "How Nexus looks on this device." },
  { id: "editor", label: "Editor", description: "Templates, daily notes and how properties show." },
  { id: "files", label: "Files and links", description: "Where attachments go and what the file explorer lists." },
  { id: "vault", label: "Import and export", description: "Bring notes in, take them all out. Everything stays plain markdown." },
  { id: "account", label: "Account", description: "Who is signed in on this device." },
  { id: "hotkeys", label: "Hotkeys", description: "Every shortcut in the workspace." },
];

const BUTTON = "h-9 rounded-md border border-control px-4 text-[13px] font-medium transition-colors hover:border-fg hover:bg-hover pointer-coarse:h-11";

export function SettingsDialog({ section = "general" }: { section?: SettingsSection }) {
  const w = useWorkspace();
  const mac = useSyncExternalStore(noopSubscribe, isMac, () => false);
  const file = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState<SettingsSection>(section);
  const close = () => w.actions.setSettingsOpen(false);
  const meta = SECTIONS.find((x) => x.id === current)!;

  const onTabKey = (e: KeyboardEvent, i: number) => {
    const n =
      e.key === "ArrowDown" || e.key === "ArrowRight"
        ? (i + 1) % SECTIONS.length
        : e.key === "ArrowUp" || e.key === "ArrowLeft"
          ? (i - 1 + SECTIONS.length) % SECTIONS.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? SECTIONS.length - 1
              : -1;
    if (n < 0) return;
    e.preventDefault();
    setCurrent(SECTIONS[n].id);
    document.getElementById(`settings-tab-${SECTIONS[n].id}`)?.focus();
  };

  return (
    <Modal label="Settings" onClose={close} className="max-w-[880px]" placement="top">
      {/* One view per area: the areas down the left, the chosen one on the right. */}
      <div className="float-panel flex max-h-[min(640px,calc(100dvh-12vh-1.5rem))] min-h-[min(440px,calc(100dvh-12vh-1.5rem))] flex-col overflow-hidden md:flex-row">
        <div className="flex shrink-0 flex-col border-border bg-frame max-md:border-b md:w-[212px] md:border-r">
          <div className="flex h-14 items-center justify-between pl-5 pr-2 md:pr-5">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Settings</h2>
            <IconButton label="Close settings" className="md:hidden" onClick={close}>
              <X />
            </IconButton>
          </div>
          <div
            role="tablist"
            aria-label="Settings areas"
            aria-orientation="vertical"
            className="flex gap-0.5 overflow-x-auto px-2 pb-2 [scrollbar-width:none] md:flex-col md:overflow-visible"
          >
            {SECTIONS.map((x, i) => (
              <button
                key={x.id}
                id={`settings-tab-${x.id}`}
                type="button"
                role="tab"
                aria-selected={current === x.id}
                aria-controls="settings-panel"
                tabIndex={current === x.id ? 0 : -1}
                data-autofocus={section === x.id ? true : undefined}
                onClick={() => setCurrent(x.id)}
                onKeyDown={(e) => onTabKey(e, i)}
                className="flex h-8 shrink-0 items-center whitespace-nowrap rounded-md px-3 text-left text-[13px] text-muted outline-offset-[-2px] transition-colors hover:bg-hover hover:text-fg aria-selected:bg-active aria-selected:font-medium aria-selected:text-fg aria-selected:shadow-[inset_1px_0_0_var(--accent-line)] pointer-coarse:h-11"
              >
                {x.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-start justify-between gap-4 px-6 pb-2 pt-6 md:px-8 md:pt-8">
            <div>
              <h3 className="display text-[24px] leading-[30px]">{meta.label}</h3>
              <p className="mt-1.5 text-[13px] leading-5 text-muted">{meta.description}</p>
            </div>
            <IconButton label="Close settings" className="-mr-2 -mt-1 max-md:hidden" onClick={close}>
              <X />
            </IconButton>
          </div>
          <div id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${current}`} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6 md:px-8">
            {current === "general" && (
              <fieldset className="border-b border-border py-5">
                <legend className="sr-only">Theme</legend>
                <h4 aria-hidden="true" className="text-[14px] font-medium leading-5">
                  Theme
                </h4>
                <p className="mt-1 text-[13px] leading-5 text-muted">Nexus follows your device until you pick one.</p>
                <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
                  {THEMES.map((t) => (
                    <label
                      key={t.id}
                      className="group relative cursor-pointer rounded-lg border border-border p-2 transition-colors hover:border-control has-checked:border-accent-line has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-[var(--focus)]"
                    >
                      <input
                        type="radio"
                        name="theme"
                        value={t.id}
                        checked={w.theme === t.id}
                        onChange={() => w.actions.setTheme(t.id)}
                        className="peer sr-only"
                      />
                      <ThemePreview id={t.id} />
                      <span className="mt-2.5 flex items-center gap-2 px-1 text-[13px] font-medium">
                        <span aria-hidden="true" className="grid size-3.5 place-items-center rounded-full border border-control group-has-checked:border-accent-line">
                          <span className="size-1.5 rounded-full bg-transparent group-has-checked:bg-accent-line" />
                        </span>
                        {t.label}
                      </span>
                      <span className="block px-1 pb-1 pt-0.5 text-[12px] leading-4 text-faint max-sm:sr-only">{t.hint}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {/* templates-properties */}
            {current === "editor" && <TemplateSettings Row={Row} />}
            {/* end templates-properties */}
            {/* attachments-ui */}
            {current === "files" && <AttachmentSettingsRows Row={Row} />}
            {/* end attachments-ui */}
            {current === "vault" && (
              <>
                <Row title="Import notes" description="Upload an Obsidian vault as a .zip, or one or more .md or .canvas files. Notes, canvases and attachments (images, PDFs, audio, video) come along; .obsidian settings are skipped. You confirm before any note with the same path is replaced.">
                  <button type="button" onClick={() => file.current?.click()} className={BUTTON}>
                    Choose files…
                  </button>
                  <input
                    ref={file}
                    type="file"
                    accept=".zip,.md,.canvas,application/zip,text/markdown"
                    multiple
                    hidden
                    onChange={(e) => {
                      void w.actions.importFiles([...(e.target.files ?? [])]);
                      e.target.value = "";
                    }}
                  />
                </Row>
                <Row title="Export vault" description="Download every note as a .zip of plain .md files that opens in Obsidian.">
                  <button type="button" onClick={w.actions.exportVault} className={BUTTON}>
                    Download .zip
                  </button>
                </Row>
              </>
            )}
            {current === "account" && (
              <Row title={w.user.name} description={`Signed in as ${w.user.email}. Signing out keeps your notes; they are on the server.`}>
                <button type="button" onClick={w.actions.logout} className={BUTTON}>
                  Sign out
                </button>
              </Row>
            )}
            {current === "hotkeys" && (
              <dl id="settings-hotkeys" className="py-3">
                {HOTKEYS.map(([label, keys, macKeys]) => (
                  <div key={label} className="flex min-h-10 items-center justify-between gap-3 border-b border-rule text-[13px] last:border-b-0">
                    <dt className="text-muted">{label}</dt>
                    <dd>
                      <Shortcut keys={mac && macKeys ? macKeys : keys} />
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
