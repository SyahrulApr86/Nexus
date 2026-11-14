"use client";

/**
 * The calendar in the right sidebar: a month of days, today ringed, a dot under each day that
 * has a daily note, the open daily note's day filled. A day opens its note, or creates it.
 * One day button is in the tab order (roving tabindex); arrows move by day and week, Home and
 * End to the week's ends, Page Up and Page Down by month (with Shift, by year).
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatDate } from "@/lib/templates";
import { useWorkspaceActions, useWorkspaceSelector } from "../store";
import { IconButton } from "../ui";
import { addDays, addMonths, dailyDate, dailyIndex, dayKey, monthGrid, sameDay, startOfDay, weekBounds, weekStartDay } from "./daily-dates";
import { dailyConfig, useDailyPrefs } from "./daily-prefs";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const noopSubscribe = () => () => {};
const useLocale = () => useSyncExternalStore(noopSubscribe, () => navigator.language, () => "en-US");

/** Today, rolling over at midnight while the page stays open. */
function useToday() {
  const [today, setToday] = useState(() => startOfDay(new Date()));
  useEffect(() => {
    const next = addDays(today, 1).getTime() - Date.now();
    const t = setTimeout(() => setToday(startOfDay(new Date())), Math.max(1000, next + 500));
    return () => clearTimeout(t);
  }, [today]);
  return today;
}

export function CalendarView() {
  const actions = useWorkspaceActions();
  const prefs = useDailyPrefs();
  const notes = useWorkspaceSelector((w) => w.tree.notes);
  const openPath = useWorkspaceSelector((w) => {
    const fv = w.focusView;
    return fv.type === "note" ? (w.activeNote?.id === fv.id ? w.activeNote.path : w.tree.notes.find((n) => n.id === fv.id)?.path) : undefined;
  });
  const locale = useLocale();
  const today = useToday();

  const { folder, format } = dailyConfig(prefs);
  const index = useMemo(() => dailyIndex(notes, { folder, format }), [notes, folder, format]);
  const openDay = useMemo(() => (openPath ? dailyDate(openPath, { folder, format }) : null), [openPath, folder, format]);
  const firstDay = weekStartDay(prefs.weekStart, locale);

  // The day with the tab stop; its month is the month on show. It follows the open daily note.
  const [cursor, setCursor] = useState<Date>(() => openDay ?? today);
  const openKey = openDay ? dayKey(openDay) : null;
  const [followed, setFollowed] = useState(openKey);
  if (openKey !== followed) {
    setFollowed(openKey);
    if (openDay) setCursor(openDay);
  }

  const grid = useRef<HTMLTableElement>(null);
  const focusCursor = useRef(false);
  useEffect(() => {
    if (!focusCursor.current) return;
    focusCursor.current = false;
    grid.current?.querySelector<HTMLElement>(`[data-day="${dayKey(cursor)}"]`)?.focus();
  }, [cursor]);

  const weeks = useMemo(() => monthGrid(cursor, firstDay), [cursor, firstDay]);
  const month = cursor.getMonth();
  const inMonth = useMemo(() => {
    let n = 0;
    for (const k of index.keys()) if (k.startsWith(formatDate(cursor, "YYYY-MM-"))) n++;
    return n;
  }, [index, cursor]);
  const onToday = cursor.getFullYear() === today.getFullYear() && month === today.getMonth();

  const onKeyDown = (e: KeyboardEvent, day: Date) => {
    const [start, end] = weekBounds(day, firstDay);
    const next =
      e.key === "ArrowLeft"
        ? addDays(day, -1)
        : e.key === "ArrowRight"
          ? addDays(day, 1)
          : e.key === "ArrowUp"
            ? addDays(day, -7)
            : e.key === "ArrowDown"
              ? addDays(day, 7)
              : e.key === "Home"
                ? start
                : e.key === "End"
                  ? end
                  : e.key === "PageUp"
                    ? addMonths(day, e.shiftKey ? -12 : -1)
                    : e.key === "PageDown"
                      ? addMonths(day, e.shiftKey ? 12 : 1)
                      : null;
    if (!next || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    focusCursor.current = true;
    setCursor(next);
  };

  const monthLabel = formatDate(cursor, "MMMM YYYY");
  const labelId = "calendar-month";

  return (
    <div className="px-2 pt-1">
      <div className="flex h-9 items-center gap-1 pointer-coarse:h-11">
        <h3 id={labelId} aria-live="polite" className="flex-1 text-[14px] font-semibold tracking-[-0.01em] text-fg">
          {monthLabel}
        </h3>
        <button
          type="button"
          disabled={onToday && sameDay(cursor, today)}
          onClick={() => setCursor(today)}
          className="h-8 rounded-md px-2 text-[13px] font-medium text-muted transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40 pointer-coarse:h-11"
        >
          Today
        </button>
        <IconButton label="Previous month" onClick={() => setCursor(addMonths(cursor, -1))}>
          <ChevronLeft />
        </IconButton>
        <IconButton label="Next month" onClick={() => setCursor(addMonths(cursor, 1))}>
          <ChevronRight />
        </IconButton>
      </div>
      <table ref={grid} role="grid" aria-labelledby={labelId} className="mt-2 w-full table-fixed border-collapse">
        <thead>
          <tr>
            {weeks[0].map((d) => (
              <th key={d.getDay()} scope="col" abbr={WEEKDAYS[d.getDay()]} className="h-7 text-center text-[12px] font-medium text-faint">
                {WEEKDAYS[d.getDay()].slice(0, 2)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={dayKey(week[0])}>
              {week.map((d) => {
                const key = dayKey(d);
                const note = index.get(key);
                const isToday = sameDay(d, today);
                const selected = !!openDay && sameDay(d, openDay);
                const outside = d.getMonth() !== month;
                const label = `${formatDate(d, "dddd D MMMM YYYY")}${note ? ", daily note" : ""}`;
                return (
                  <td key={key} aria-selected={selected} className="p-px">
                    <button
                      type="button"
                      data-day={key}
                      tabIndex={sameDay(d, cursor) ? 0 : -1}
                      aria-label={label}
                      aria-current={isToday ? "date" : undefined}
                      title={note ? `Open ${note.name}` : `Create the note for ${formatDate(d, "D MMMM")}`}
                      onClick={() => {
                        setCursor(d);
                        void actions.dailyNote(d);
                      }}
                      onKeyDown={(e) => onKeyDown(e, d)}
                      className={`tabular relative flex h-9 w-full flex-col items-center justify-center rounded-md text-[13px] leading-none outline-offset-[-2px] transition-colors hover:bg-hover pointer-coarse:h-11 ${
                        outside ? "text-faint" : "text-fg"
                      } ${selected ? "bg-active font-semibold" : ""} ${isToday ? "font-semibold text-accent-ink shadow-[inset_0_0_0_1px_var(--accent-line)]" : ""}`}
                    >
                      <span aria-hidden="true">{d.getDate()}</span>
                      <span aria-hidden="true" className={`mt-1 size-1 rounded-full ${note ? "bg-muted" : "bg-transparent"}`} />
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 px-1 text-[12px] leading-4 text-faint">
        <span className="tabular">{inMonth === 0 ? "No" : inMonth}</span> daily {inMonth === 1 ? "note" : "notes"} in {formatDate(cursor, "MMMM")}.{" "}
        <button
          type="button"
          onClick={() => actions.setSettingsOpen("editor")}
          className="rounded text-accent-ink underline-offset-2 hover:underline"
        >
          Daily note settings
        </button>
      </p>
    </div>
  );
}
