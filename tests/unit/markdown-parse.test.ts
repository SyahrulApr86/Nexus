import { describe, expect, it } from "vitest";
import {
  basename,
  dirname,
  extractHeadings,
  extractTags,
  extractWikiLinks,
  isUnsafePath,
  linkKey,
  maskCode,
  normalizePath,
  parseFrontmatter,
  splitFrontmatter,
} from "@/lib/markdown/parse";

describe("extractWikiLinks", () => {
  it("parses target, alias, heading and embed", () => {
    const md = "See [[Note|Alias]], [[Other#Heading]], ![[Embed]] and [[Folder/Deep Note#Part|Label]].";
    expect(extractWikiLinks(md)).toEqual([
      { raw: "[[Note|Alias]]", target: "Note", alias: "Alias", embed: false, from: 4, to: 18 },
      { raw: "[[Other#Heading]]", target: "Other", heading: "Heading", embed: false, from: 20, to: 37 },
      { raw: "![[Embed]]", target: "Embed", embed: true, from: 39, to: 49 },
      {
        raw: "[[Folder/Deep Note#Part|Label]]",
        target: "Folder/Deep Note",
        heading: "Part",
        alias: "Label",
        embed: false,
        from: 54,
        to: 85,
      },
    ]);
  });

  it("reports offsets into the original text", () => {
    const md = "`[[code]]` text [[One]]\n```\n[[fenced]]\n```\n![[Two|t]]";
    for (const l of extractWikiLinks(md)) expect(md.slice(l.from, l.to)).toBe(l.raw);
  });

  it("trims whitespace around the parts", () => {
    expect(extractWikiLinks("[[  Note  #  Part  |  Alias  ]]")).toMatchObject([
      { target: "Note", heading: "Part", alias: "Alias" },
    ]);
  });

  it("keeps a heading-only link with an empty target", () => {
    expect(extractWikiLinks("[[#Local heading]]")).toMatchObject([{ target: "", heading: "Local heading" }]);
  });

  it("ignores links inside inline code and fenced code", () => {
    const md = [
      "Inline `[[Inline]]` and `x [[Spaced]] y`",
      "```",
      "[[Backticks]]",
      "```",
      "~~~js",
      "[[Tildes]]",
      "~~~",
      "After the fences: [[Real]]",
    ].join("\n");
    expect(extractWikiLinks(md).map((l) => l.target)).toEqual(["Real"]);
  });

  it("does not match across lines or nested brackets", () => {
    expect(extractWikiLinks("[[Split\nLine]] [[a [b] c]] [[]]")).toEqual([]);
  });
});

describe("extractTags", () => {
  it("finds inline and nested tags, lowercased and deduplicated", () => {
    expect(extractTags("#Project and #project, #project/alpha (#paren) #a-b_c")).toEqual([
      "project",
      "project/alpha",
      "paren",
      "a-b_c",
    ]);
  });

  it("supports Unicode letters", () => {
    expect(extractTags("#café #日本語 #über/größe")).toEqual(["café", "日本語", "über/größe"]);
  });

  it("does not treat headings, pure numbers or mid-word hashes as tags", () => {
    expect(extractTags("# Heading\n## Sub heading\nIssue #123 and #2024\nfoo#bar http://x.test/#anchor")).toEqual([]);
  });

  it("accepts tags that mix digits and letters", () => {
    expect(extractTags("#2024a #y2024")).toEqual(["2024a", "y2024"]);
  });

  it("ignores tags inside inline code and fenced code", () => {
    expect(extractTags("`#inline`\n```\n#fenced\n```\n~~~\n#tilde\n~~~\n#real")).toEqual(["real"]);
  });

  it("reads frontmatter tags as an inline list", () => {
    expect(extractTags("---\ntags: [One, \"two\", '#three']\n---\nbody #four")).toEqual([
      "one",
      "two",
      "three",
      "four",
    ]);
  });

  it("reads frontmatter tags as a block list", () => {
    expect(extractTags("---\ntags:\n  - alpha\n  - Nested/Beta\n---\n")).toEqual(["alpha", "nested/beta"]);
  });

  it("reads frontmatter tags as a comma or space separated string", () => {
    expect(extractTags("---\ntags: foo, bar baz\n---\n")).toEqual(["foo", "bar", "baz"]);
  });

  it("reads the singular tag key", () => {
    expect(extractTags("---\ntag: solo\n---\n")).toEqual(["solo"]);
  });

  it("does not scan the frontmatter block for inline tags", () => {
    expect(extractTags("---\ntitle: Issue #notatag\n---\n#body")).toEqual(["body"]);
  });
});

describe("extractHeadings", () => {
  it("returns ATX headings with level, text and line, outside code", () => {
    const md = ["# One", "## Two ##", "###NoSpace", "####### Seven", "```", "# In code", "```", "###### Six", "#tag"].join(
      "\n",
    );
    expect(extractHeadings(md)).toEqual([
      { level: 1, text: "One", line: 0 },
      { level: 2, text: "Two", line: 1 },
      { level: 6, text: "Six", line: 7 },
    ]);
  });
});

describe("normalizePath", () => {
  it("trims segments and collapses slashes", () => {
    expect(normalizePath("  Projects // Nexus / Roadmap ")).toBe("Projects/Nexus/Roadmap");
  });

  it("drops . and .. segments so a path cannot climb out of the vault", () => {
    expect(normalizePath("../x")).toBe("x");
    expect(normalizePath("a/../../b")).toBe("a/b");
    expect(normalizePath("../../etc/passwd")).toBe("etc/passwd");
    expect(normalizePath("./a/./b")).toBe("a/b");
    expect(normalizePath("..")).toBe("");
  });

  it("strips a leading slash", () => {
    expect(normalizePath("/abs/path")).toBe("abs/path");
  });

  it("converts backslashes to slashes", () => {
    expect(normalizePath("a\\b\\..\\c")).toBe("a/b/c");
  });

  it("removes characters that are illegal in file names", () => {
    expect(normalizePath('a<b>:c"d|e?f*g\u0000h\u001fi')).toBe("abcdefghi");
  });

  it("strips one .md suffix, case-insensitively", () => {
    expect(normalizePath("Note.md")).toBe("Note");
    expect(normalizePath("Note.MD")).toBe("Note");
    expect(normalizePath("Archive.md.md")).toBe("Archive.md");
  });

  it("returns an empty string when nothing usable is left", () => {
    expect(normalizePath("")).toBe("");
    expect(normalizePath("  /  ")).toBe("");
    expect(normalizePath("<>|?*")).toBe("");
  });
});

describe("linkKey", () => {
  it("lowercases, trims and drops a .md suffix, keeping folders", () => {
    expect(linkKey("Folder/Note.md")).toBe("folder/note");
    expect(linkKey("  Mixed Case  ")).toBe("mixed case");
    expect(linkKey("Note.MD")).toBe("note");
  });
});

describe("basename and dirname", () => {
  it("split a vault path", () => {
    expect(basename("a/b/c")).toBe("c");
    expect(basename("c")).toBe("c");
    expect(dirname("a/b/c")).toBe("a/b");
    expect(dirname("c")).toBe("");
  });
});

describe("maskCode", () => {
  it("blanks code but keeps length and line breaks", () => {
    const md = "a `b` c\n```\nx\n```\nd";
    const masked = maskCode(md);
    expect(masked).toBe("a     c\n   \n \n   \nd");
    expect(masked).toHaveLength(md.length);
  });
});

describe("splitFrontmatter", () => {
  it("splits a leading YAML block", () => {
    expect(splitFrontmatter("---\ntitle: X\n---\nbody")).toEqual({ yaml: "title: X", body: "body", offset: 17 });
  });

  it("handles CRLF line endings", () => {
    expect(splitFrontmatter("---\r\ntitle: X\r\n---\r\nbody")).toEqual({ yaml: "title: X", body: "body", offset: 20 });
  });

  it("accepts a block at the end of the file", () => {
    expect(splitFrontmatter("---\ntitle: X\n---")).toEqual({ yaml: "title: X", body: "", offset: 16 });
  });

  it("only treats a block at the very start as frontmatter", () => {
    const md = "Intro\n---\ntitle: X\n---\n";
    expect(splitFrontmatter(md)).toEqual({ yaml: null, body: md, offset: 0 });
  });
});

describe("parseFrontmatter", () => {
  it("parses scalars, inline lists and block lists", () => {
    const yaml = [
      "- item before any key",
      'title: "Hello"',
      "aliases: [A, 'B']",
      "tags:",
      "  - x",
      "  - y",
      "count: 3 # trailing comment",
      "url: http://x.test/#frag",
      "empty:",
      "not a key line",
    ].join("\n");
    expect(parseFrontmatter(yaml)).toEqual({
      title: "Hello",
      aliases: ["A", "B"],
      tags: ["x", "y"],
      count: "3",
      url: "http://x.test/#frag",
      empty: [],
    });
  });

  it("returns an empty object without frontmatter", () => {
    expect(parseFrontmatter(null)).toEqual({});
    expect(parseFrontmatter(splitFrontmatter("no frontmatter").yaml)).toEqual({});
  });

  it("round-trips with splitFrontmatter", () => {
    const { yaml } = splitFrontmatter("---\ntags: [a, b]\ndraft: true\n---\n# Body");
    expect(parseFrontmatter(yaml)).toEqual({ tags: ["a", "b"], draft: "true" });
  });
});

describe("frontmatter parsing stays linear (ReDoS regression)", () => {
  /** The old comment strip, /\s+#.*$/, was quadratic on a long whitespace run without "#". */
  const legacyStrip = (raw: string) => raw.replace(/\s+#.*$/, "");

  it("cuts comments exactly where the old regex did", () => {
    const lines = [
      "count: 3 # trailing comment",
      "a  b   #c # d",
      "url: http://x.test/#frag",
      "x:\t#tab comment",
      "  - item # note",
      "#only",
      "no comment here",
      "trailing spaces   ",
      "k: v #",
    ];
    for (const line of lines) {
      const parsed = parseFrontmatter(line);
      const legacy = parseFrontmatter(legacyStrip(line) === line ? line : legacyStrip(line));
      expect(parsed).toEqual(legacy);
    }
  });

  it("parses a 1 MB whitespace line without backtracking", () => {
    const line = `k:${" ".repeat(1_000_000)}x`;
    const t = performance.now();
    parseFrontmatter(line);
    expect(performance.now() - t).toBeLessThan(50);
  });

  it("indexes a note with 1 MB of hostile frontmatter quickly", () => {
    const md = `---\ntags: [a]${" ".repeat(1_000_000)}\n${"\t".repeat(200_000)}x\n---\nbody #b`;
    const t = performance.now();
    extractTags(md);
    expect(performance.now() - t).toBeLessThan(200);
  });

  it("ignores oversized frontmatter blocks and lines", () => {
    expect(parseFrontmatter(`tags: [a]\n${"x: y\n".repeat(20_000)}`)).toEqual({});
    expect(parseFrontmatter(`tags: [a]\ntitle: ${"t".repeat(5_000)}`)).toEqual({ tags: ["a"] });
  });
});

describe("normalizePath never yields a dot segment (zip-slip regression)", () => {
  it("drops segments that become . or .. once .md is stripped", () => {
    expect(normalizePath("...md")).toBe("");
    expect(normalizePath("..md")).toBe("");
    expect(normalizePath("a/...md")).toBe("a");
    expect(normalizePath("a/ .. .md")).toBe("a");
    expect(normalizePath("a/..<>.md")).toBe("a");
  });

  it("keeps ordinary names", () => {
    expect(normalizePath("a/b.c.md")).toBe("a/b.c");
    expect(normalizePath("a/...x.md")).toBe("a/...x");
  });

  it("isUnsafePath flags empty, dot and absolute segments", () => {
    for (const p of ["", "..", "a/..", "./a", "/a", "a//b", "a\\b", "a/."]) expect(isUnsafePath(p)).toBe(true);
    for (const p of ["a", "a/b", "a/...x", ".hidden/x"]) expect(isUnsafePath(p)).toBe(false);
  });
});
