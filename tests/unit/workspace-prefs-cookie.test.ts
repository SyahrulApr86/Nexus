import { afterEach, describe, expect, it, vi } from "vitest";
import { PREFS_COOKIE, parsePrefsCookie, writePrefsCookie } from "@/components/workspace/prefs-cookie";

const full = { leftOpen: false, leftView: "search", rightOpen: true, rightView: "outline", sort: "modified-desc" } as const;

describe("parsePrefsCookie", () => {
  it("reads every known key, raw or URI-encoded", () => {
    expect(parsePrefsCookie(JSON.stringify(full))).toEqual(full);
    expect(parsePrefsCookie(encodeURIComponent(JSON.stringify(full)))).toEqual(full);
  });

  it("returns nothing for a missing, broken or oversized cookie", () => {
    expect(parsePrefsCookie(undefined)).toEqual({});
    expect(parsePrefsCookie("")).toEqual({});
    expect(parsePrefsCookie("{not json")).toEqual({});
    expect(parsePrefsCookie("[1,2]")).toEqual({});
    expect(parsePrefsCookie("null")).toEqual({});
    expect(parsePrefsCookie(JSON.stringify({ leftOpen: false, pad: "x".repeat(1100) }))).toEqual({});
  });

  it("drops unknown keys and invalid values", () => {
    expect(
      parsePrefsCookie(
        JSON.stringify({ leftOpen: "no", rightOpen: false, leftView: "graph", rightView: "tags", sort: "random", theme: "dark", __proto__x: 1 }),
      ),
    ).toEqual({ rightOpen: false, rightView: "tags" });
  });
});

describe("writePrefsCookie", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("writes a small Lax cookie for the whole site, Secure on https", () => {
    const doc = { cookie: "" };
    vi.stubGlobal("document", doc);
    vi.stubGlobal("window", { location: { protocol: "https:" } });
    writePrefsCookie(full);
    const [pair, ...attrs] = doc.cookie.split("; ");
    expect(pair.startsWith(`${PREFS_COOKIE}=`)).toBe(true);
    expect(parsePrefsCookie(pair.slice(PREFS_COOKIE.length + 1))).toEqual(full);
    expect(attrs).toEqual(expect.arrayContaining(["Path=/", "SameSite=Lax", "Secure"]));
    expect(doc.cookie.length).toBeLessThan(1024);
  });

  it("leaves out Secure on plain http", () => {
    const doc = { cookie: "" };
    vi.stubGlobal("document", doc);
    vi.stubGlobal("window", { location: { protocol: "http:" } });
    writePrefsCookie(full);
    expect(doc.cookie).not.toContain("Secure");
  });
});
