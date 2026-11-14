import { describe, expect, it } from "vitest";
import {
  addMonths,
  adjacentDaily,
  dailyDate,
  dailyIndex,
  dailyPath,
  dateParser,
  dayKey,
  monthGrid,
  weekBounds,
  weekStartDay,
} from "@/components/workspace/calendar/daily-dates";
import { DEFAULT_DAILY_PREFS, dailyConfig, parseDailyPrefs } from "@/components/workspace/calendar/daily-prefs";

// Saturday 14 November 2026.
const DAY = new Date(2026, 10, 14);
const ISO = { folder: "Daily", format: "YYYY-MM-DD" };

describe("dailyPath", () => {
  it("puts the formatted day in the folder", () => {
    expect(dailyPath(DAY, ISO)).toBe("Daily/2026-11-14");
    expect(dailyPath(DAY, { folder: "/Journal/", format: "dddd D MMMM YYYY" })).toBe("Journal/Saturday 14 November 2026");
  });

  it("uses the vault root for an empty folder and the default for an empty format", () => {
    expect(dailyPath(DAY, { folder: "", format: "" })).toBe("2026-11-14");
  });

  it("lets slashes in the format make subfolders", () => {
    expect(dailyPath(DAY, { folder: "Daily", format: "YYYY/MM/YYYY-MM-DD" })).toBe("Daily/2026/11/2026-11-14");
  });
});

describe("dateParser", () => {
  it("reads a name back in its format", () => {
    expect(dayKey(dateParser("YYYY-MM-DD")("2026-11-14")!)).toBe("2026-11-14");
    expect(dayKey(dateParser("D MMMM YYYY")("3 February 2026")!)).toBe("2026-02-03");
    expect(dayKey(dateParser("dddd, MMMM Do YYYY")("Saturday, November 14th 2026")!)).toBe("2026-11-14");
    expect(dayKey(dateParser("[Day] DD.MM.YY")("Day 14.11.26")!)).toBe("2026-11-14");
    expect(dayKey(dateParser("YYYY/MM/YYYY-MM-DD")("2026/11/2026-11-14")!)).toBe("2026-11-14");
  });

  it("rejects days that do not exist and names that only look alike", () => {
    const iso = dateParser("YYYY-MM-DD");
    expect(iso("2026-02-30")).toBeNull();
    expect(iso("2026-13-01")).toBeNull();
    expect(iso("2026-11-14 notes")).toBeNull();
    expect(iso("Meeting notes")).toBeNull();
    // The weekday has to agree with the date.
    expect(dateParser("dddd YYYY-MM-DD")("Monday 2026-11-14")).toBeNull();
  });
});

describe("daily notes in a tree", () => {
  const notes = [
    { id: "a", path: "Daily/2026-11-10" },
    { id: "b", path: "Daily/2026-11-14" },
    { id: "c", path: "daily/2026-11-20" },
    { id: "d", path: "Daily/Inbox" },
    { id: "e", path: "Archive/2026-11-12" },
    { id: "f", path: "Daily/2026-10-31" },
  ];

  it("finds a note's day only inside the folder, ignoring case", () => {
    expect(dayKey(dailyDate("Daily/2026-11-10", ISO)!)).toBe("2026-11-10");
    expect(dailyDate("Archive/2026-11-12", ISO)).toBeNull();
    expect(dailyDate("Daily/Inbox", ISO)).toBeNull();
  });

  it("indexes daily notes by day", () => {
    expect([...dailyIndex(notes, ISO).keys()].sort()).toEqual(["2026-10-31", "2026-11-10", "2026-11-14", "2026-11-20"]);
  });

  it("finds the nearest daily note either side, skipping gaps", () => {
    expect(adjacentDaily(notes, ISO, DAY, -1)?.note.id).toBe("a");
    expect(adjacentDaily(notes, ISO, DAY, 1)?.note.id).toBe("c");
    expect(adjacentDaily(notes, ISO, new Date(2026, 10, 10), -1)?.note.id).toBe("f");
    expect(adjacentDaily(notes, ISO, new Date(2026, 10, 20), 1)).toBeNull();
    expect(adjacentDaily(notes, ISO, new Date(2026, 9, 31), -1)).toBeNull();
  });
});

describe("month grid", () => {
  it("covers six weeks from the week's first day", () => {
    const monday = monthGrid(DAY, 1);
    expect(monday).toHaveLength(6);
    expect(monday.every((w) => w.length === 7)).toBe(true);
    // 1 November 2026 is a Sunday: a Monday week starts on 26 October.
    expect(dayKey(monday[0][0])).toBe("2026-10-26");
    expect(dayKey(monthGrid(DAY, 0)[0][0])).toBe("2026-11-01");
    expect(dayKey(monthGrid(DAY, 6)[0][0])).toBe("2026-10-31");
  });

  it("gives the bounds of a day's week", () => {
    expect(weekBounds(DAY, 1).map(dayKey)).toEqual(["2026-11-09", "2026-11-15"]);
    expect(weekBounds(DAY, 0).map(dayKey)).toEqual(["2026-11-08", "2026-11-14"]);
  });

  it("moves by month without spilling over the end of a short month", () => {
    expect(dayKey(addMonths(new Date(2026, 0, 31), 1))).toBe("2026-02-28");
    expect(dayKey(addMonths(new Date(2026, 2, 31), -1))).toBe("2026-02-28");
    expect(dayKey(addMonths(DAY, -12))).toBe("2025-11-14");
  });

  it("starts the week from the setting, or from the locale", () => {
    expect(weekStartDay("sunday")).toBe(0);
    expect(weekStartDay("monday")).toBe(1);
    expect(weekStartDay("saturday")).toBe(6);
    expect(weekStartDay("locale", "en-US")).toBe(0);
    expect(weekStartDay("locale", "en-GB")).toBe(1);
    expect(weekStartDay("locale", "not a locale!")).toBe(1);
  });
});

describe("daily note preferences", () => {
  it("falls back to the defaults for missing, broken or wrong values", () => {
    expect(parseDailyPrefs(null)).toEqual(DEFAULT_DAILY_PREFS);
    expect(parseDailyPrefs("{oops")).toEqual(DEFAULT_DAILY_PREFS);
    expect(parseDailyPrefs(JSON.stringify({ folder: 3, format: "D MMM", weekStart: "friday" }))).toEqual({
      folder: "Daily",
      format: "D MMM",
      weekStart: "locale",
    });
    expect(parseDailyPrefs(JSON.stringify({ folder: "", weekStart: "sunday" }))).toEqual({ folder: "", format: "YYYY-MM-DD", weekStart: "sunday" });
  });

  it("reads an empty name format as the default", () => {
    expect(dailyConfig({ folder: "Journal", format: "  ", weekStart: "locale" })).toEqual({ folder: "Journal", format: "YYYY-MM-DD" });
  });
});
