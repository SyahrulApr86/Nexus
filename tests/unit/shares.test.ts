import { describe, expect, it } from "vitest";
import { ShareOptions, clientIp, renderSharedNote, sharePolicy } from "@/lib/shares";

describe("renderSharedNote", () => {
  const html = renderSharedNote(
    [
      "# Plan",
      "",
      "![[Secret roadmap]]",
      "",
      "See [[Budget 2027|the budget]], [[Missing note]] and ![[diagram.png]] #project ==key==.",
      "",
      "[site](https://example.com) ![chart](https://tracker.example/p.png) ![local](/icon.png)",
      "",
      "- [ ] open task",
      "- [x] done task",
    ].join("\n"),
  );

  it("turns [[wikilinks]] into plain text, with no hint whether the target exists", () => {
    expect(html).not.toContain("wikilink:");
    expect(html).not.toContain("ghost");
    expect(html).toContain('<span class="share-link">the budget</span>');
    expect(html).toContain('<span class="share-link">Missing note</span>');
  });

  it("turns note embeds into their name only", () => {
    expect(html).toContain('<p class="share-embed">↳ Secret roadmap</p>');
    expect(html).not.toContain("data-embed");
    expect(html).not.toContain("Loading");
  });

  it("shows attachment embeds as their file name (no attachment URL yet)", () => {
    expect(html).toContain('<span class="share-link">↳ diagram.png</span>');
  });

  it("keeps tags as chips without a link", () => {
    expect(html).toContain('<span class="share-tag">#project</span>');
    expect(html).not.toContain("tag:");
  });

  it("marks external links and turns remote images into links", () => {
    expect(html).toContain('<a rel="nofollow noopener noreferrer" href="https://example.com">site</a>');
    expect(html).not.toContain('src="https://tracker.example');
    expect(html).toContain(
      '<a href="https://tracker.example/p.png" rel="nofollow noopener noreferrer">chart (external image)</a>',
    );
    expect(html).toContain('src="/icon.png"');
  });

  it("keeps task boxes read-only", () => {
    expect(html.match(/<input type="checkbox"[^>]*>/g)?.every((t) => t.includes("disabled"))).toBe(true);
  });

  it("stays sanitised: raw HTML and script URLs never come through", () => {
    const evil = renderSharedNote(
      '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1)) [[a"><script>|b]]',
    );
    expect(evil).not.toMatch(/<script|onerror|javascript:/i);
  });
});

describe("clientIp", () => {
  const h = (xff?: string) => new Headers(xff ? { "x-forwarded-for": xff } : {});

  it("takes the entry the nearest proxy wrote, so a client cannot pick its own key", () => {
    expect(clientIp(h("1.1.1.1, 203.0.113.9"), [])).toBe("203.0.113.9");
  });

  it("skips trusted proxies from the right", () => {
    expect(clientIp(h("1.1.1.1, 203.0.113.9, 10.0.0.2"), ["10.0.0.2"])).toBe("203.0.113.9");
  });

  it("falls back to one shared key without the header", () => {
    expect(clientIp(h(), [])).toBe("unknown");
  });
});

describe("share options and policy", () => {
  it("accepts an expiry of 1 to 365 days or none", () => {
    expect(ShareOptions.parse({})).toEqual({});
    expect(ShareOptions.parse({ expiresInDays: null })).toEqual({
      expiresInDays: null,
    });
    expect(ShareOptions.parse({ expiresInDays: 7 })).toEqual({
      expiresInDays: 7,
    });
    for (const bad of [{ expiresInDays: 0 }, { expiresInDays: 366 }, { expiresInDays: 1.5 }, { token: "x" }])
      expect(ShareOptions.safeParse(bad).success).toBe(false);
  });

  it("loads images from this origin only and allows no framing targets, forms or plugins", () => {
    const p = sharePolicy(false);
    expect(p).toContain("default-src 'none'");
    expect(p).toContain("img-src 'self' data:");
    expect(p).toContain("form-action 'none'");
    expect(p).toContain("object-src 'none'");
    expect(p).not.toContain("unsafe-eval");
    expect(p).not.toMatch(/https:/);
  });
});
