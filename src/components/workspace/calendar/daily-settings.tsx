"use client";

/** Settings rows for daily notes: where they go, how they are named, their template, and the calendar's week. */

import { useId, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { findByPath, formatDate, normalizeFolder, templatesIn } from "@/lib/templates";
import { shallowEqual, useWorkspaceSelector } from "../store";
import { setTemplatePrefs, useTemplatePrefs } from "../templates-settings";
import { FIELD, Field } from "../templates-settings-rows";
import { dailyIndex, dailyPath, dateParser, sameDay, weekStartDay, type WeekStart } from "./daily-dates";
import { dailyConfig, setDailyPrefs, useDailyPrefs } from "./daily-prefs";

type RowComponent = (props: { title: string; description?: string; children: ReactNode }) => ReactNode;

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const noopSubscribe = () => () => {};

export function DailySettings({ Row }: { Row: RowComponent }) {
  const prefs = useDailyPrefs();
  const templatePrefs = useTemplatePrefs();
  const { folders, notes } = useWorkspaceSelector((s) => ({ folders: s.tree.folders, notes: s.tree.notes }), shallowEqual);
  const locale = useSyncExternalStore(noopSubscribe, () => navigator.language, () => "en-US");
  const foldersId = useId();
  const templatesId = useId();
  const weekId = useId();

  const config = dailyConfig(prefs);
  const today = useMemo(() => new Date(), []);
  const found = useMemo(() => dailyIndex(notes, config).size, [notes, config.folder, config.format]); // eslint-disable-line react-hooks/exhaustive-deps
  // A format the calendar cannot read back (no day, month or year in it) would hide every note from it.
  const readable = useMemo(() => {
    const d = dateParser(config.format)(formatDate(today, config.format));
    return !!d && sameDay(d, today);
  }, [config.format, today]);
  const folder = normalizeFolder(prefs.folder);
  const templates = useMemo(() => templatesIn(notes, templatePrefs.folder), [notes, templatePrefs.folder]);
  const tpl = templatePrefs.dailyTemplate.trim();
  const tplKnown = !tpl || !!findByPath(notes, tpl);

  return (
    <Row
      title="Daily notes"
      description="Open today’s note from the rail, the command palette or the calendar in the right sidebar. A day without a note gets one when you open it."
    >
      <div className="flex flex-col gap-3">
        <Field
          label="Folder"
          value={prefs.folder}
          onChange={(v) => setDailyPrefs({ folder: v })}
          placeholder="Vault root"
          list={foldersId}
          hint={`${found} ${found === 1 ? "daily note" : "daily notes"}${folder ? ` in “${folder}”` : " at the vault root"}`}
        />
        <datalist id={foldersId}>
          {folders.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <Field
          label="Name format"
          value={prefs.format}
          onChange={(v) => setDailyPrefs({ format: v })}
          placeholder="YYYY-MM-DD"
          problem={readable ? null : "Use a year, a month and a day (YYYY, MM, DD) so the calendar can find these notes."}
          hint={`Today’s note: ${dailyPath(today, config)}`}
        />
        <Field
          label="Template"
          value={templatePrefs.dailyTemplate}
          onChange={(v) => setTemplatePrefs({ dailyTemplate: v })}
          placeholder={templates[0]?.path ?? "Templates/Daily"}
          list={templatesId}
          problem={tplKnown ? null : `There is no note at “${tpl}”.`}
          hint={tplKnown ? "Leave it empty to start with a blank page." : undefined}
        />
        <datalist id={templatesId}>
          {templates.map((t) => (
            <option key={t.id} value={t.path} />
          ))}
        </datalist>
        <div className="flex flex-col gap-1">
          <label htmlFor={weekId} className="text-[12px] font-medium text-muted">
            Week starts on
          </label>
          <select
            id={weekId}
            value={prefs.weekStart}
            onChange={(e) => setDailyPrefs({ weekStart: e.target.value as WeekStart })}
            className={`${FIELD} appearance-auto`}
          >
            <option value="locale">Your language’s default ({DAY_NAMES[weekStartDay("locale", locale)]})</option>
            <option value="monday">Monday</option>
            <option value="sunday">Sunday</option>
            <option value="saturday">Saturday</option>
          </select>
        </div>
      </div>
    </Row>
  );
}
