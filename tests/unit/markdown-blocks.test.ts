import { afterEach, describe, expect, it, vi } from "vitest";
import { blockIdOf, blockTargetAt, extractBlock, extractBlockIds, newBlockId, stripBlockId } from "@/lib/markdown/blocks";
import { fragmentLine, headingKey, parseFragment, queueFragment, takeFragment } from "@/lib/markdown/fragment-nav";
import { renderMarkdown } from "@/lib/markdown/render";
import { extractWikiLinks } from "@/lib/markdown/parse";
import { attachmentTargets } from "@/lib/markdown/attachments";

const all = () => true;

const NOTE = [
  "---",
  "tags: [ocean]",
  "---",
  "# Overview",
  "",
  "Tide pools hold life. ^intro",
  "Second line of the same paragraph.",
  "",
  "## Species",
  "",
  "- Sea stars ^stars",
  "  - Ochre star",
  "- Anemones",
  "- [ ] Photograph a nudibranch ^nudi",
  "",
  "| Zone | Depth |",
  "|---|---|",
  "| High | 0 m |",
  "",
  "^zones",
  "",
  "```js",
  "const x = 1; ^notablock",
  "```",
  "",
  "> Quote line one",
  "> quote line two ^quote",
].join("\n");

describe("block ids", () => {
  it("reads and strips a trailing ^id", () => {
    expect(blockIdOf("text ^abc-1")).toBe("abc-1");
    expect(blockIdOf("^abc")).toBe("abc");
    expect(blockIdOf("a^abc")).toBeNull();
    expect(blockIdOf("see [^1]")).toBeNull();
    expect(stripBlockId("text ^abc  ")).toBe("text");
  });

  it("lists ids outside code with a preview", () => {
    const ids = extractBlockIds(NOTE);
    expect(ids.map((b) => b.id)).toEqual(["intro", "stars", "nudi", "zones", "quote"]);
    expect(ids.find((b) => b.id === "nudi")?.text).toBe("Photograph a nudibranch");
    expect(ids.find((b) => b.id === "zones")?.text).toBe("| High | 0 m |");
  });

  it("extracts the block an id names", () => {
    expect(extractBlock(NOTE, "^intro")).toBe("Tide pools hold life. ^intro\nSecond line of the same paragraph.");
    expect(extractBlock(NOTE, "stars")).toBe("- Sea stars ^stars\n  - Ochre star");
    expect(extractBlock(NOTE, "^nudi")).toBe("- [ ] Photograph a nudibranch ^nudi");
    expect(extractBlock(NOTE, "^zones")).toBe("| Zone | Depth |\n|---|---|\n| High | 0 m |");
    expect(extractBlock(NOTE, "^quote")).toBe("> Quote line one\n> quote line two ^quote");
    expect(extractBlock(NOTE, "^notablock")).toBeNull();
    expect(extractBlock(NOTE, "^missing")).toBeNull();
    expect(extractBlock(NOTE, "^bad id")).toBeNull();
  });

  it("an id on its own line after a code block names the whole block", () => {
    expect(extractBlock("Intro\n\n```\na\nb\n```\n\n^code", "^code")).toBe("```\na\nb\n```");
  });

  it("finds where Copy block link points", () => {
    const lines = NOTE.split("\n");
    const at = (text: string) => lines.indexOf(text);
    expect(blockTargetAt(NOTE, at("# Overview"))).toEqual({ kind: "heading", text: "Overview" });
    // A paragraph links by the id on its last line… here the first line already has one.
    expect(blockTargetAt(NOTE, at("Second line of the same paragraph."))).toEqual({ kind: "block", id: null, line: at("Second line of the same paragraph.") });
    expect(blockTargetAt(NOTE, at("- Sea stars ^stars"))).toEqual({ kind: "block", id: "stars", line: at("- Sea stars ^stars") });
    expect(blockTargetAt(NOTE, at("- Anemones"))).toEqual({ kind: "block", id: null, line: at("- Anemones") });
    expect(blockTargetAt(NOTE, at(""))).toEqual({ kind: "none" });
    expect(blockTargetAt(NOTE, 1)).toEqual({ kind: "none" }); // frontmatter
    expect(blockTargetAt(NOTE, at("const x = 1; ^notablock"))).toEqual({ kind: "none" });
    const para = "One\ntwo\nthree\n\nNext";
    expect(blockTargetAt(para, 0)).toEqual({ kind: "block", id: null, line: 2 });
  });

  it("makes new ids that are not taken", () => {
    let i = 0;
    const seq = [0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    const id = newBlockId("x ^aaaaaa", () => seq[i++ % seq.length]);
    expect(id).toMatch(/^[a-z0-9]{6}$/);
    expect(id).not.toBe("aaaaaa");
  });
});

describe("rendering block ids", () => {
  it("hides markers and tags the block that holds them", () => {
    const html = renderMarkdown(NOTE, all);
    expect(html).not.toMatch(/\^(intro|stars|nudi|zones|quote)/);
    expect(html).toContain('<p data-block="intro">Tide pools hold life.\nSecond line of the same paragraph.</p>');
    expect(html).toContain('<li data-block="stars">Sea stars');
    expect(html).toMatch(/<li class="task-list-item" data-task-offset="\d+" data-block="nudi">/);
    expect(html).toContain('<table data-block="zones">');
    expect(html).toContain("const x = 1; ^notablock"); // code keeps its text
    expect(html).not.toContain("");
  });

  it("drops marker characters typed by the user", () => {
    expect(renderMarkdown("a x b", all)).toBe("<p>a x b</p>");
  });

  it("labels heading and block links and keeps their fragment", () => {
    const html = renderMarkdown("[[Note#^abc]] [[#Heading]] [[Note#Part|alias]]", all);
    expect(html).toContain('<a href="wikilink:Note#%5Eabc">Note › ^abc</a>');
    expect(html).toContain('<a href="wikilink:#Heading">Heading</a>');
    expect(html).toContain('<a href="wikilink:Note#Part">alias</a>');
  });

  it("makes block embeds into embed placeholders", () => {
    expect(renderMarkdown("![[Note#^abc]]", all)).toContain('<div class="embed" data-embed="Note#^abc">');
  });

  it("treats heading and block links as links to the note (backlinks, renames)", () => {
    const [l] = extractWikiLinks("See [[Tide tables#^spring|spring]]");
    expect(l).toMatchObject({ target: "Tide tables", heading: "^spring", alias: "spring", embed: false });
  });
});

describe("fragments", () => {
  afterEach(() => vi.useRealTimers());

  it("parses heading and block fragments", () => {
    expect(parseFragment("Spring tides")).toEqual({ kind: "heading", text: "Spring tides" });
    expect(parseFragment("^abc")).toEqual({ kind: "block", id: "abc" });
    expect(parseFragment("^bad id")).toBeNull();
    expect(parseFragment("  ")).toBeNull();
    expect(headingKey("  **Spring**   Tides ")).toBe("spring tides");
  });

  it("finds the line of a heading or block", () => {
    const lines = NOTE.split("\n");
    expect(fragmentLine(NOTE, { kind: "heading", text: "species" })).toBe(lines.indexOf("## Species"));
    expect(fragmentLine(NOTE, { kind: "block", id: "nudi" })).toBe(lines.indexOf("- [ ] Photograph a nudibranch ^nudi"));
    // An id on its own line points at the block above it.
    expect(fragmentLine(NOTE, { kind: "block", id: "zones" })).toBe(lines.indexOf("| High | 0 m |"));
    expect(fragmentLine(NOTE, { kind: "block", id: "notablock" })).toBeNull();
    expect(fragmentLine(NOTE, { kind: "heading", text: "Nope" })).toBeNull();
  });

  it("hands a queued fragment to that note once, and lets it expire", () => {
    queueFragment("n1", { kind: "heading", text: "A" });
    expect(takeFragment("n2")).toBeNull();
    expect(takeFragment("n1")).toEqual({ kind: "heading", text: "A" });
    expect(takeFragment("n1")).toBeNull();
    vi.useFakeTimers();
    queueFragment("n1", { kind: "block", id: "x" });
    vi.advanceTimersByTime(10_000);
    expect(takeFragment("n1")).toBeNull();
  });
});

describe("attachment targets of a note", () => {
  it("collects wikilink and relative markdown targets, not code or remote URLs", () => {
    const md = "![[cover.png|300]] [[doc.pdf#page=2]] ![a](Assets/b%20c.png) [x](https://e.com/y.png) `![[code.png]]`\n```\n![[fenced.png]]\n```";
    expect(attachmentTargets(md)).toEqual(["cover.png", "doc.pdf", "Assets/b c.png"]);
  });
});
