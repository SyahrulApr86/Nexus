import { describe, expect, it } from "vitest";
import {
  convertValue,
  diffText,
  frontmatterRange,
  keyProblem,
  mergeFrontmatter,
  propertyLines,
  readProperties,
  removeProperty,
  renameProperty,
  setProperty,
  yamlScalar,
} from "@/lib/markdown/frontmatter-edit";
import { splitFrontmatter } from "@/lib/markdown/parse";

const NOTE = `---
# Project note
title: "Launch plan"
status: draft # still moving
priority: 2
done: false
due: 2026-12-01
start: 2026-11-14T09:30
tags:
  - work
  - planning
aliases: [Launch, "Plan, v2"]
---
# Body

Text with #tag.
`;

describe("readProperties", () => {
  it("infers types in source order", () => {
    const { exists, editable, properties } = readProperties(NOTE);
    expect(exists).toBe(true);
    expect(editable).toBe(true);
    expect(properties.map((p) => [p.key, p.type, p.value])).toEqual([
      ["title", "text", "Launch plan"],
      ["status", "text", "draft"],
      ["priority", "number", 2],
      ["done", "checkbox", false],
      ["due", "date", "2026-12-01"],
      ["start", "datetime", "2026-11-14T09:30"],
      ["tags", "list", ["work", "planning"]],
      ["aliases", "list", ["Launch", "Plan, v2"]],
    ]);
  });

  it("reports a note without frontmatter", () => {
    expect(readProperties("# Just text")).toEqual({ exists: false, editable: true, properties: [] });
  });

  it("reads a scalar tags value as a one-item list", () => {
    expect(readProperties("---\ntags: solo\n---\n").properties[0]).toMatchObject({ type: "list", value: ["solo"] });
  });

  it("applies a preferred type when the value fits", () => {
    const p = readProperties("---\ncount:\nflag: true\n---\n", { count: "number", flag: "text" }).properties;
    expect(p[0]).toMatchObject({ type: "number", value: null });
    expect(p[1]).toMatchObject({ type: "checkbox", value: true }); // "true" is not text: inferred type wins
  });

  it("marks values outside the subset read-only and keeps the rest editable", () => {
    const md = "---\nok: yes please\nnested:\n  a: 1\nbody: |\n  multi\n  line\n---\n";
    const p = readProperties(md).properties;
    expect(p.map((x) => [x.key, x.editable])).toEqual([
      ["ok", true],
      ["nested", false],
      ["body", false],
    ]);
    expect(p[1].raw).toBe("nested:\n  a: 1");
  });

  it("marks the whole block read-only for unknown top-level YAML or duplicate keys", () => {
    expect(readProperties("---\n? complex\n---\n").editable).toBe(false);
    expect(readProperties("---\na: 1\na: 2\n---\n").editable).toBe(false);
  });

  it("understands CRLF", () => {
    const p = readProperties("---\r\ntitle: Hi\r\ntags:\r\n  - a\r\n---\r\nBody").properties;
    expect(p.map((x) => x.value)).toEqual(["Hi", ["a"]]);
  });
});

describe("setProperty", () => {
  it("rewrites only the edited entry, keeping comments and other lines byte for byte", () => {
    const next = setProperty(NOTE, "status", "in review", "text");
    expect(next).toBe(NOTE.replace("status: draft # still moving", "status: in review # still moving"));
  });

  it("keeps a comment after a one-line value, whatever the new value", () => {
    expect(setProperty("---\na: 'x # y' # why\n---\n", "a", "z", "text")).toBe("---\na: z # why\n---\n");
    expect(setProperty('---\na: "q\\"" # why\n---\n', "a", null, "text")).toBe("---\na: # why\n---\n");
    expect(setProperty("---\na: [b, c] # why\n---\n", "a", ["b"], "list")).toBe("---\na: # why\n  - b\n---\n");
    expect(setProperty("---\na: x#y\n---\n", "a", "z", "text")).toBe("---\na: z\n---\n");
    const back = readProperties(setProperty("---\na: 1 # n\n---\n", "a", 2, "number")).properties[0];
    expect(back).toMatchObject({ value: 2, type: "number", editable: true });
    expect(readProperties("---\na: # why\n  - b\n---\n").properties[0]).toMatchObject({ type: "list", value: ["b"], editable: true });
    expect(readProperties("---\na: # why\n---\n").properties[0]).toMatchObject({ value: null, editable: true });
  });

  it("round-trips untouched notes exactly", () => {
    for (const p of readProperties(NOTE).properties) {
      expect(setProperty(NOTE, p.key, p.value, p.type)).toContain("# Project note");
    }
    expect(setProperty(NOTE, "priority", 2, "number")).toBe(NOTE);
  });

  it("writes lists as block lists and keeps the list indent", () => {
    const md = "---\ntags:\n- a\n---\n";
    expect(setProperty(md, "tags", ["a", "b c"], "list")).toBe("---\ntags:\n- a\n- b c\n---\n");
    expect(setProperty("---\nx: 1\n---\n", "tags", [], "list")).toBe("---\nx: 1\ntags: []\n---\n");
  });

  it("quotes text that would read back as another type", () => {
    const md = setProperty("", "code", "007", "text");
    expect(md).toBe('---\ncode: "007"\n---\n');
    expect(readProperties(md).properties[0]).toMatchObject({ type: "text", value: "007" });
    expect(setProperty("", "t", "a: b # c", "text")).toBe('---\nt: "a: b # c"\n---\n');
    expect(setProperty("", "t", 'say "hi"', "text")).toBe('---\nt: say "hi"\n---\n');
  });

  it("adds frontmatter to a note that has none, keeping its line endings", () => {
    expect(setProperty("Body\r\nmore", "done", true, "checkbox")).toBe("---\r\ndone: true\r\n---\r\nBody\r\nmore");
    expect(setProperty("---\n---\nBody", "a", 1, "number")).toBe("---\na: 1\n---\nBody");
  });

  it("keeps CRLF inside an existing block", () => {
    const md = "---\r\na: 1\r\n---\r\nBody";
    expect(setProperty(md, "b", "x", "text")).toBe("---\r\na: 1\r\nb: x\r\n---\r\nBody");
  });

  it("writes empty values as a bare key", () => {
    expect(setProperty("---\na: 1\n---\n", "a", null, "number")).toBe("---\na:\n---\n");
  });

  it("never rewrites read-only YAML", () => {
    const md = "---\nbody: |\n  text\n---\n";
    expect(setProperty(md, "body", "x", "text")).toBe(md);
    expect(setProperty("---\n? x\n---\n", "a", 1, "number")).toBe("---\n? x\n---\n");
  });

  it("produces text the reading-view parser still splits the same way", () => {
    const md = setProperty(NOTE, "title", "New: title", "text");
    expect(splitFrontmatter(md).body).toBe(splitFrontmatter(NOTE).body);
  });
});

describe("renameProperty and removeProperty", () => {
  it("renames a key and keeps its value lines", () => {
    expect(renameProperty(NOTE, "tags", "topics")).toBe(NOTE.replace("tags:\n", "topics:\n"));
  });

  it("refuses taken or invalid names", () => {
    expect(renameProperty(NOTE, "tags", "status")).toBe(NOTE);
    expect(renameProperty(NOTE, "tags", "a: b")).toBe(NOTE);
  });

  it("removes a property with all its lines", () => {
    expect(removeProperty(NOTE, "tags")).toBe(NOTE.replace("tags:\n  - work\n  - planning\n", ""));
  });

  it("drops the block when the last property goes", () => {
    expect(removeProperty("---\na: 1\n---\nBody", "a")).toBe("Body");
    expect(removeProperty("---\n# keep me\na: 1\n---\nBody", "a")).toBe("---\n# keep me\n---\nBody");
  });
});

describe("mergeFrontmatter", () => {
  it("adds template keys and keeps existing ones", () => {
    const note = "---\nstatus: done\n---\nBody";
    const tpl = "---\nstatus: draft\ntype: meeting\ntags:\n  - meeting\n---\n";
    expect(mergeFrontmatter(note, tpl)).toBe("---\nstatus: done\ntype: meeting\ntags:\n  - meeting\n---\nBody");
  });

  it("creates the block when the note has none", () => {
    expect(mergeFrontmatter("Body", "---\na: 1\n---\n")).toBe("---\na: 1\n---\nBody");
  });
});

describe("helpers", () => {
  it("validates keys", () => {
    expect(keyProblem("")).toMatch(/Enter/);
    expect(keyProblem("a:b")).toMatch(/can’t contain/);
    expect(keyProblem("- x")).toMatch(/Start/);
    expect(keyProblem("status", ["status"])).toMatch(/already exists/);
    expect(keyProblem("date created")).toBeNull();
  });

  it("converts values between types", () => {
    expect(convertValue("a", "list")).toEqual(["a"]);
    expect(convertValue(["a", "b"], "text")).toBe("a, b");
    expect(convertValue("12", "number")).toBe(12);
    expect(convertValue("x", "number")).toBeNull();
    expect(convertValue("2026-01-02", "datetime")).toBe("2026-01-02T00:00");
    expect(convertValue("2026-01-02T10:00", "date")).toBe("2026-01-02");
  });

  it("quotes scalars only when needed", () => {
    expect(yamlScalar("plain words")).toBe("plain words");
    expect(yamlScalar("true")).toBe('"true"');
    expect(yamlScalar("true", false)).toBe("true");
    expect(yamlScalar("#hash")).toBe('"#hash"');
    expect(yamlScalar("line\nbreak")).toBe('"line\\nbreak"');
    expect(propertyLines("n", "number", 1.5)).toEqual(["n: 1.5"]);
  });

  it("finds the block range and the smallest edit", () => {
    expect(frontmatterRange("---\na: 1\n---\nBody")).toEqual({ from: 0, to: 13 });
    expect(frontmatterRange("---\na: 1\n----\nBody")).toBeNull();
    expect(diffText("abcdef", "abXYef")).toEqual({ from: 2, to: 4, insert: "XY" });
    expect(diffText("aaa", "aaaa")).toEqual({ from: 3, to: 3, insert: "a" });
  });
});
