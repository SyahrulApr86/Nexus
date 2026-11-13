import { describe, expect, it } from "vitest";
import { needsLineScan, parseQuery } from "@/lib/search";

describe("parseQuery: bare #tag (contract R6)", () => {
  it("reads a bare #tag exactly like tag:tag", () => {
    expect(parseQuery("#work")).toEqual(parseQuery("tag:work"));
    expect(parseQuery("#Work/Meetings")).toEqual({ type: "tag", value: "work/meetings" });
    expect(parseQuery("roadmap #work")).toEqual(parseQuery("roadmap tag:work"));
    expect(parseQuery("-#draft")).toEqual(parseQuery("-tag:draft"));
    expect(parseQuery("#a OR #b")).toEqual(parseQuery("tag:a OR tag:b"));
  });

  it("leaves text that is not tag-shaped alone", () => {
    expect(parseQuery("#2024")).toEqual({ type: "text", words: ["2024"] });
    expect(parseQuery('"#work"')).toEqual({ type: "text", words: ["work"] });
    expect(parseQuery("#")).toBeNull();
  });

  it("reads #tag as a plain word inside another operator, where operators do not nest", () => {
    expect(parseQuery("line:(#work plan)")).toEqual({
      type: "line",
      child: { type: "and", children: [{ type: "text", words: ["work"] }, { type: "text", words: ["plan"] }] },
    });
  });
});

describe("parseQuery: negated line terms", () => {
  it("reads line:-x as line:(-x), not as line:x", () => {
    const expected = { type: "line", child: { type: "not", child: { type: "text", words: ["draft"] } } };
    expect(parseQuery("line:-draft")).toEqual(expected);
    expect(parseQuery("line:(-draft)")).toEqual(expected);
    expect(parseQuery('line:-"rough draft"')).toEqual({
      type: "line",
      child: { type: "not", child: { type: "text", words: ["rough", "draft"] } },
    });
    expect(parseQuery("line:-(a OR b)")).toEqual({
      type: "line",
      child: {
        type: "not",
        child: { type: "or", children: [{ type: "text", words: ["a"] }, { type: "text", words: ["b"] }] },
      },
    });
  });

  it("keeps a dash in file:, path: and tag: values", () => {
    expect(parseQuery("file:-draft")).toEqual({ type: "file", value: "-draft" });
    expect(parseQuery("line:-")).toBeNull();
  });
});

describe("needsLineScan", () => {
  const scan = (q: string) => needsLineScan(parseQuery(q)!);
  it("is true only for line: terms with no word the index can require", () => {
    expect(scan("line:-draft")).toBe(true);
    expect(scan("line:(-a -b)")).toBe(true);
    expect(scan("roadmap line:-draft")).toBe(true);
    expect(scan("-line:(a OR -b)")).toBe(true);
    expect(scan("line:(mix -flour)")).toBe(false);
    expect(scan('line:"brown fox"')).toBe(false);
    expect(scan("-draft tag:x")).toBe(false);
  });
});
