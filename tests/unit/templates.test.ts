import { describe, expect, it } from "vitest";
import { applyTemplate, findByPath, formatDate, renderTemplate, templatesIn } from "@/lib/templates";

// Saturday 14 November 2026, 09:05:07 local time.
const NOW = new Date(2026, 10, 14, 9, 5, 7);

describe("formatDate", () => {
  it("formats moment-style tokens", () => {
    expect(formatDate(NOW, "YYYY-MM-DD HH:mm:ss")).toBe("2026-11-14 09:05:07");
    expect(formatDate(NOW, "dddd, MMMM Do YYYY")).toBe("Saturday, November 14th 2026");
    expect(formatDate(NOW, "ddd D MMM YY")).toBe("Sat 14 Nov 26");
    expect(formatDate(NOW, "h:mm A")).toBe("9:05 AM");
    expect(formatDate(new Date(2026, 0, 1, 15, 0), "hh a, M/D")).toBe("03 pm, 1/1");
  });

  it("keeps [bracketed] text literal", () => {
    expect(formatDate(NOW, "[Week of] YYYY")).toBe("Week of 2026");
  });
});

describe("renderTemplate", () => {
  const ctx = { title: "Standup", now: NOW };

  it("fills title, date and time with defaults", () => {
    expect(renderTemplate("# {{title}}\n{{date}} at {{time}}", ctx)).toBe("# Standup\n2026-11-14 at 09:05");
  });

  it("accepts formats, spacing and any case, and leaves unknown variables", () => {
    expect(renderTemplate("{{ date:dddd }} {{TIME:HH}} {{other}}", ctx)).toBe("Saturday 09 {{other}}");
  });

  it("uses the configured default formats", () => {
    expect(renderTemplate("{{date}} {{time}}", { ...ctx, dateFormat: "D MMM", timeFormat: "h A" })).toBe("14 Nov 9 AM");
  });
});

describe("finding templates", () => {
  const notes = [{ path: "Templates/Meeting" }, { path: "Templates/sub/Daily" }, { path: "Templates-old/x" }, { path: "Notes/a" }];

  it("lists notes inside the folder only", () => {
    expect(templatesIn(notes, "/Templates/").map((n) => n.path)).toEqual(["Templates/Meeting", "Templates/sub/Daily"]);
    expect(templatesIn(notes, "")).toEqual([]);
  });

  it("finds a note by path, with or without .md", () => {
    expect(findByPath(notes, "templates/sub/daily.md")?.path).toBe("Templates/sub/Daily");
    expect(findByPath(notes, "")).toBeUndefined();
  });
});

describe("applyTemplate", () => {
  it("replaces an empty note", () => {
    expect(applyTemplate("  \n", "---\na: 1\n---\nHi", 0)).toEqual({ text: "---\na: 1\n---\nHi", cursor: 15 });
  });

  it("inserts the body at the cursor and merges frontmatter", () => {
    const note = "---\nstatus: done\n---\nOne\nTwo";
    const tpl = "---\nstatus: draft\ntype: log\n---\n- item\n";
    const at = note.indexOf("Two");
    const r = applyTemplate(note, tpl, at);
    expect(r.text).toBe("---\nstatus: done\ntype: log\n---\nOne\n- item\nTwo");
    expect(r.text.slice(r.cursor)).toBe("Two");
  });

  it("moves a cursor inside the note's frontmatter to the body", () => {
    const r = applyTemplate("---\na: 1\n---\nBody", "X", 2);
    expect(r.text).toBe("---\na: 1\n---\nXBody");
    expect(r.cursor).toBe(14);
  });

  it("adds a frontmatter block in front of a note that has none", () => {
    const r = applyTemplate("Body", "---\na: 1\n---\nX", 4);
    expect(r.text).toBe("---\na: 1\n---\nBodyX");
    expect(r.cursor).toBe(r.text.length);
  });
});
