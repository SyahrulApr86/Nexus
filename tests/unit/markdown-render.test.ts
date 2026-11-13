import { describe, expect, it, vi } from "vitest";
import { renderMarkdown } from "@/lib/markdown/render";

const existing = new Set(["note", "folder/deep"]);
const exists = (target: string) => existing.has(target.toLowerCase());
const render = (md: string) => renderMarkdown(md, exists);

type StartTag = { name: string; attrs: [name: string, value: string][] };

/**
 * Splits rendered HTML into text, end tags and start tags, and returns the start
 * tags. rehype-stringify escapes "<" in text and writes every attribute value in
 * double quotes with "&" and '"' escaped, so a ">" or "<" inside a value does not
 * end or start a tag. Anything outside that shape (comments, unquoted values)
 * throws, so the inertness check fails closed instead of skipping it.
 */
function startTags(html: string): StartTag[] {
  const token = /[^<]+|<\/[a-z][a-z0-9-]*>|<([a-z][a-z0-9-]*)((?:\s+[^\s"'>/=]+(?:="[^"]*")?)*)\s*\/?>/giy;
  const tags: StartTag[] = [];
  while (token.lastIndex < html.length) {
    const at = token.lastIndex;
    const m = token.exec(html);
    if (!m) throw new Error(`Unexpected markup at ${at}: ${html.slice(at, at + 40)}`);
    if (m[1]) {
      const attrs = [...m[2].matchAll(/\s+([^\s"'>/=]+)(?:="([^"]*)")?/g)];
      tags.push({ name: m[1].toLowerCase(), attrs: attrs.map((a) => [a[1].toLowerCase(), a[2] ?? ""]) });
    }
  }
  return tags;
}

/** Every href value in the output. */
const hrefs = (html: string) => startTags(html).flatMap((t) => t.attrs.filter(([n]) => n === "href").map(([, v]) => v));

const NAMED_REFS: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", colon: ":", tab: "\t", newline: "\n" };

/** Decodes character references once, the way a browser reads an attribute value. */
function decodeRefs(value: string) {
  return value.replace(/&(?:#x([0-9a-f]+);?|#(\d+);?|([a-z]+);)/gi, (ref, hex?: string, dec?: string, name?: string) => {
    if (name) return NAMED_REFS[name.toLowerCase()] ?? ref;
    const code = hex ? parseInt(hex, 16) : Number(dec);
    return code <= 0x10ffff ? String.fromCodePoint(code) : "\uFFFD";
  });
}

/** The URL scheme a browser would act on: references decoded, tabs and newlines dropped, leading controls trimmed. */
function scheme(value: string) {
  const url = decodeRefs(value)
    .replace(/[\t\n\r]/g, "")
    .replace(/^[\u0000-\u0020]+/, "");
  return /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1].toLowerCase() ?? "";
}

const ACTIVE_ELEMENTS = /^(script|iframe|frame|frameset|object|embed|applet|style|link|meta|base|form|svg|math|template)$/;
const URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction", "xlink:href", "poster", "background", "data", "cite"]);

/** Asserts the HTML cannot run script: no active elements, no handlers or inline styles, no script URLs. */
function expectInert(html: string) {
  for (const { name, attrs } of startTags(html)) {
    expect(name).not.toMatch(ACTIVE_ELEMENTS);
    for (const [attr, value] of attrs) {
      expect(attr).not.toMatch(/^on/);
      expect(attr).not.toBe("style");
      if (URL_ATTRIBUTES.has(attr)) expect(["javascript", "vbscript", "data"]).not.toContain(scheme(value));
    }
  }
}

describe("renderMarkdown: Obsidian syntax", () => {
  it("turns a wikilink into a wikilink: link", () => {
    expect(render("See [[Note]] here")).toBe('<p>See <a href="wikilink:Note">Note</a> here</p>');
  });

  it("uses the alias as the label", () => {
    expect(render("[[Note|the alias]]")).toBe('<p><a href="wikilink:Note">the alias</a></p>');
  });

  it("encodes headings and folders into the href", () => {
    expect(render("[[Note#Some Heading]]")).toBe(
      '<p><a href="wikilink:Note#Some%20Heading">Note › Some Heading</a></p>',
    );
    expect(render("[[Folder/Deep]]")).toBe('<p><a href="wikilink:Folder%2FDeep">Folder/Deep</a></p>');
    expect(render("[[#Local]]")).toBe('<p><a href="wikilink:#Local">Local</a></p>');
  });

  it("renders an embed as a placeholder the reader fills in", () => {
    expect(render("![[Note]]")).toBe(
      '<div class="embed" data-embed="Note"><a href="wikilink:Note" class="embed-title">Note</a><div class="embed-body embed-note">Loading…</div></div>',
    );
  });

  it("gives links to missing notes the ghost class", () => {
    expect(render("[[Missing Note]] [[Note]] [[Missing|alias]]")).toBe(
      '<p><a href="wikilink:Missing%20Note" class="ghost">Missing Note</a> ' +
        '<a href="wikilink:Note">Note</a> ' +
        '<a href="wikilink:Missing" class="ghost">alias</a></p>',
    );
  });

  it("asks exists() about the trimmed target as written", () => {
    const spy = vi.fn(() => true);
    renderMarkdown("[[ Some Note #Part | label ]]", spy);
    expect(spy).toHaveBeenCalledWith("Some Note");
  });

  it("turns tags into tag: links, but not headings or numbers", () => {
    expect(render("text #tag and #nested/tag and #123")).toBe(
      '<p>text <a href="tag:tag">#tag</a> and <a href="tag:nested%2Ftag">#nested/tag</a> and #123</p>',
    );
    expect(render("# Title")).toBe("<h1>Title</h1>");
  });

  it("turns ==highlight== into <mark>", () => {
    expect(render("this is ==important== and ==this== too")).toBe(
      "<p>this is <mark>important</mark> and <mark>this</mark> too</p>",
    );
  });

  it("leaves Obsidian syntax inside code alone", () => {
    expect(render("`[[Note]]` `#tag` `==x==`")).toBe(
      "<p><code>[[Note]]</code> <code>#tag</code> <code>==x==</code></p>",
    );
    expect(render("```\n[[Note]] #tag ==x==\n```")).toBe("<pre><code>[[Note]] #tag ==x==\n</code></pre>");
  });

  it("renders frontmatter as an escaped block, not as markdown", () => {
    const html = render("---\ntitle: <b>Plan</b> & \"more\"\ntags: [a]\n---\n# Body");
    expect(html).toBe(
      '<div class="frontmatter">title: &lt;b&gt;Plan&lt;/b&gt; &amp; &quot;more&quot;\ntags: [a]</div><h1>Body</h1>',
    );
  });

  it("renders GFM task lists and tables", () => {
    expect(render("- [ ] todo\n- [x] done")).toContain('<input type="checkbox" checked disabled> done');
    expect(render("| a |\n|---|\n| 1 |")).toContain("<td>1</td>");
  });
});

describe("renderMarkdown: XSS", () => {
  const payloads: [string, string][] = [
    ["script element", "<script>alert(1)</script>"],
    ["img onerror", '<img src=x onerror="alert(1)">'],
    ["event handler on a block", '<div onclick="alert(1)">hi</div>'],
    ["details ontoggle", "<details open ontoggle=alert(1)>x</details>"],
    ["raw link with javascript:", '<a href="javascript:alert(1)">x</a>'],
    ["iframe", '<iframe src="https://example.test"></iframe>'],
    ["svg script", "<svg><script>alert(1)</script></svg>"],
    ["math xlink", '<math><mi xlink:href="javascript:alert(1)">x</mi></math>'],
    ["inline style", '<p style="background:url(javascript:alert(1))">x</p>'],
    ["form", '<form action="https://example.test"><input name=a></form>'],
    ["meta refresh and base", '<meta http-equiv=refresh content=0><base href="https://example.test">'],
    ["markdown link", "[click](javascript:alert(1))"],
    ["markdown link, mixed case", "[click](JaVaScRiPt:alert(1))"],
    ["markdown link, entity encoded", "[click](&#106;avascript:alert(1))"],
    ["markdown link, tab entity", "[click](java&#x09;script:alert(1))"],
    ["markdown link, angle brackets", "[click](<javascript:alert(1)>)"],
    ["reference link", "[click][r]\n\n[r]: javascript:alert(1)"],
    ["data: link", "[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)"],
    ["vbscript: link", "[click](vbscript:msgbox(1))"],
    ["markdown image", "![x](javascript:alert(1))"],
    ["link title breakout", '[x](https://example.test "a\\" onmouseover=\\"alert(1)")'],
    ["autolink", "<javascript:alert(1)>"],
    ["wikilink-shaped markdown link", "[[Note|](javascript:alert(1))]]"],
    ["wikilink target", "[[javascript:alert(1)]]"],
    ["wikilink target with alias", "[[javascript:alert(1)|click me]]"],
    ["embed target", "![[javascript:alert(1)]]"],
    ["wikilink attribute breakout", '[[x" onmouseover="alert(1)]]'],
    ["wikilink heading breakout", '[[Note#"><img src=x onerror=alert(1)>]]'],
    ["html in wikilink target", "[[<script>alert(1)</script>]]"],
    ["html in wikilink alias", "[[Note|<img src=x onerror=alert(1)>]]"],
    ["html in highlight", "==<script>alert(1)</script>=="],
    ["img in highlight", "==<img src=x onerror=alert(1)>=="],
    // The renderer swaps these private-use markers for <mark> after sanitising.
    ["highlight markers typed into an attribute", '[x](https://example.test "\uE000") \uE001 <b>'],
    ["html in frontmatter", "---\ntitle: <img src=x onerror=alert(1)>\n---\nbody"],
  ];

  it("has an inertness check that catches active HTML", () => {
    expect(() => expectInert('<p><img src="x" onerror="alert(1)"></p>')).toThrow();
    expect(() => expectInert('<a href=" javascript:alert(1)">x</a>')).toThrow();
    expect(() => expectInert('<a href="java&#x09;script:alert(1)">x</a>')).toThrow();
    expect(() => expectInert('<a href="&#106;avascript&colon;alert(1)">x</a>')).toThrow();
    expect(() => expectInert('<a title="a > b" onclick="alert(1)">x</a>')).toThrow();
    expect(() => expectInert("<img src=x onerror=alert(1)>")).toThrow();
    expect(() => expectInert("<!-- x --><script>alert(1)</script>")).toThrow();
    expect(() => expectInert('<p style="color:red">x</p>')).toThrow();
  });

  it("has an inertness check that accepts plain markup", () => {
    expect(() => expectInert('<p>text with onclick="x" and javascript: is fine</p>')).not.toThrow();
    expect(() => expectInert('<a href="https://example.test/?q=javascript:x" title="a <b> c">ok</a>')).not.toThrow();
    expect(() => expectInert('<a href="&#x26;#106;avascript:alert(1)">relative</a>')).not.toThrow();
  });

  it.each(payloads)("neutralises %s", (_name, md) => {
    expectInert(render(md));
  });

  it("drops raw HTML instead of passing it through", () => {
    expect(render("<script>alert(1)</script>")).toBe("");
    expect(render('<img src=x onerror="alert(1)">')).toBe("");
    expect(render('<div onclick="alert(1)">hi</div>')).toBe("");
    expect(render("<b>bold</b> text")).toBe("<p>bold text</p>");
  });

  it("removes javascript: hrefs from markdown links but keeps the text", () => {
    expect(render("[click](javascript:alert(1))")).toBe("<p><a>click</a></p>");
    expect(render("[click](JaVaScRiPt:alert(1))")).toBe("<p><a>click</a></p>");
  });

  it("keeps a wikilink to a javascript: target inside the wikilink: scheme", () => {
    const html = render("[[javascript:alert(1)|click me]]");
    expect(hrefs(html)).toEqual(["wikilink:javascript%3Aalert(1)"]);
    expect(html).toBe('<p><a href="wikilink:javascript%3Aalert(1)" class="ghost">click me</a></p>');
  });

  it("percent-encodes quotes so a wikilink cannot add attributes", () => {
    expect(hrefs(render('[[x" onmouseover="alert(1)]]'))).toEqual(["wikilink:x%22%20onmouseover%3D%22alert(1)"]);
  });

  it("escapes HTML in the frontmatter block", () => {
    expect(render("---\ntitle: <img src=x onerror=alert(1)>\n---\n")).toBe(
      '<div class="frontmatter">title: &lt;img src=x onerror=alert(1)&gt;</div>',
    );
  });

  it("keeps safe links", () => {
    expect(hrefs(render("[a](https://example.test) [b](/relative) [c](mailto:x@example.test) <https://example.test/x>"))).toEqual([
      "https://example.test",
      "/relative",
      "mailto:x@example.test",
      "https://example.test/x",
    ]);
  });
});

describe("renderMarkdown: links without text", () => {
  it("shows the URL instead of an empty, nameless link", () => {
    expect(render("Empty [](https://e.com) link.")).toContain('<a href="https://e.com">https://e.com</a>');
  });

  it("keeps link text that is there, including balanced brackets", () => {
    expect(render("A [link [with] brackets](https://example.com/b) here.")).toContain(
      '<a href="https://example.com/b">link [with] brackets</a>',
    );
  });
});
