import { describe, expect, it } from "vitest";
import {
  extractTags,
  extractWikilinks,
  isInCodeRegion,
} from "../src/markdown.js";

describe("extractWikilinks (FR-009)", () => {
  it("extracts a simple wikilink with its offset", () => {
    const links = extractWikilinks("see [[Note Two]] for more");
    expect(links).toEqual([{ title: "Note Two", offset: 4 }]);
  });

  it("extracts multiple wikilinks", () => {
    const links = extractWikilinks("[[A]] and [[B]] and [[C]]");
    expect(links.map((l) => l.title)).toEqual(["A", "B", "C"]);
  });

  it("returns empty array when no wikilinks present", () => {
    expect(extractWikilinks("plain text, no links")).toEqual([]);
  });

  it("ignores unclosed brackets", () => {
    expect(extractWikilinks("broken [[link without close")).toEqual([]);
  });

  it("ignores empty wikilinks [[]]", () => {
    expect(extractWikilinks("empty [[]] link")).toEqual([]);
  });

  it("trims surrounding whitespace inside brackets", () => {
    expect(extractWikilinks("[[  Padded Title ]]")).toEqual([
      { title: "Padded Title", offset: 0 },
    ]);
  });

  it("does NOT extract wikilinks inside fenced code blocks (US4-S6)", () => {
    const md = "before\n```\n[[InCode]]\n```\nafter [[Real]]";
    expect(extractWikilinks(md).map((l) => l.title)).toEqual(["Real"]);
  });

  it("does NOT extract wikilinks inside inline code spans (US4-S6)", () => {
    const md = "text `[[InlineCode]]` and [[Real]]";
    expect(extractWikilinks(md).map((l) => l.title)).toEqual(["Real"]);
  });

  it("handles ~~~ fenced blocks", () => {
    const md = "~~~\n[[Hidden]]\n~~~\n[[Visible]]";
    expect(extractWikilinks(md).map((l) => l.title)).toEqual(["Visible"]);
  });

  it("handles unicode titles (CJK, emoji)", () => {
    const md = "[[日本語ノート]] [[émoji 🎉 note]]";
    expect(extractWikilinks(md).map((l) => l.title)).toEqual([
      "日本語ノート",
      "émoji 🎉 note",
    ]);
  });

  it("does not treat [[a]]] greedily", () => {
    expect(extractWikilinks("[[a]]]").map((l) => l.title)).toEqual(["a"]);
  });
});

describe("extractTags (FR-017)", () => {
  it("extracts a simple tag", () => {
    expect(extractTags("work on #project-alpha today")).toEqual([
      { name: "project-alpha", offset: 8 },
    ]);
  });

  it("extracts multiple distinct tags", () => {
    expect(extractTags("#one #two #one").map((t) => t.name)).toEqual([
      "one",
      "two",
      "one",
    ]);
  });

  it("does NOT treat ATX headings as tags", () => {
    expect(extractTags("# Heading\n## Sub\ntext #real")).toEqual([
      { name: "real", offset: 22 },
    ]);
  });

  it("does NOT match mid-word hashes (a#b)", () => {
    expect(extractTags("foo#bar")).toEqual([]);
  });

  it("does NOT extract tags inside code blocks or inline code", () => {
    const md = "```\n#incode\n```\n`#inline` #real";
    expect(extractTags(md)).toEqual([{ name: "real", offset: 26 }]);
  });

  it("supports underscore, digits, unicode letters", () => {
    expect(extractTags("#tag_1 #日本語").map((t) => t.name)).toEqual([
      "tag_1",
      "日本語",
    ]);
  });
});

describe("isInCodeRegion (US4-S6 autocomplete guard)", () => {
  const md = "text `inline` more\n```\nfenced\n```\ntail";

  it("true inside inline code", () => {
    expect(isInCodeRegion(md, md.indexOf("inline"))).toBe(true);
  });

  it("true inside fenced block", () => {
    expect(isInCodeRegion(md, md.indexOf("fenced"))).toBe(true);
  });

  it("false in plain text", () => {
    expect(isInCodeRegion(md, md.indexOf("tail"))).toBe(false);
    expect(isInCodeRegion(md, 0)).toBe(false);
  });
});
