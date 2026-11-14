import { describe, expect, it } from "vitest";
import { MCP_LIMITS, noteUri, pathFromUriPart, sliceContent, truncationMarker } from "@/lib/mcp/format";
import {
  AppendToNoteInput,
  CreateNoteInput,
  ListNotesInput,
  ReadNoteInput,
  SearchNotesInput,
  UpdateNoteInput,
} from "@/lib/mcp/schemas";

describe("sliceContent", () => {
  it("returns the whole short note with no next offset", () => {
    expect(sliceContent("hello")).toEqual({ text: "hello", offset: 0, total: 5, nextOffset: null });
  });

  it("pages a long note and reads on from nextOffset", () => {
    const text = "a".repeat(25);
    const one = sliceContent(text, 0, 10);
    expect(one).toMatchObject({ text: "a".repeat(10), nextOffset: 10, total: 25 });
    const three = sliceContent(text, 20, 10);
    expect(three).toMatchObject({ text: "a".repeat(5), offset: 20, nextOffset: null });
  });

  it("clamps an offset past the end", () => {
    expect(sliceContent("abc", 99)).toMatchObject({ text: "", offset: 3, nextOffset: null });
  });

  it("never splits a surrogate pair", () => {
    const s = "ab😀cd"; // the emoji is two UTF-16 units at 2..3
    const part = sliceContent(s, 0, 3);
    expect(part.text).toBe("ab");
    expect(part.nextOffset).toBe(2);
    expect(sliceContent(s, 2, 3).text).toBe("😀c");
  });

  it("tells the model how to continue", () => {
    expect(truncationMarker(sliceContent("x".repeat(30), 0, 10))).toContain("offset=10");
    expect(truncationMarker(sliceContent("short"))).toBe("");
  });
});

describe("note URIs", () => {
  it("round-trips paths with spaces and reserved characters", () => {
    for (const p of ["Projects/Nexus/MCP server", "a#b/c?d", "100%/done", "Ünïcode/ノート"]) {
      const uri = noteUri(p);
      expect(uri.startsWith("nexus://note/")).toBe(true);
      expect(pathFromUriPart(uri.slice("nexus://note/".length))).toBe(p);
    }
  });

  it("refuses a malformed escape", () => {
    expect(pathFromUriPart("%E0%A4%A")).toBeNull();
  });
});

describe("tool input schemas", () => {
  it("search: bounded query and limit", () => {
    expect(SearchNotesInput.parse({ query: "tag:#a" })).toEqual({ query: "tag:#a" });
    expect(() => SearchNotesInput.parse({ query: "x".repeat(201) })).toThrow();
    expect(() => SearchNotesInput.parse({ query: "x", limit: MCP_LIMITS.maxSearchResults + 1 })).toThrow();
    expect(() => SearchNotesInput.parse({ query: "x", vaultId: "other" })).toThrow();
  });

  it("read: exactly one of path or id; bounded paging", () => {
    expect(() => ReadNoteInput.parse({})).toThrow();
    expect(() => ReadNoteInput.parse({ path: "a", id: "8f9a1c52-6d0b-4a8e-9a43-2a0c1b7e5f10" })).toThrow();
    expect(() => ReadNoteInput.parse({ id: "not-a-uuid" })).toThrow();
    expect(() => ReadNoteInput.parse({ path: "a", limit: MCP_LIMITS.maxReadChars + 1 })).toThrow();
    expect(() => ReadNoteInput.parse({ path: "a", offset: -1 })).toThrow();
    expect(ReadNoteInput.parse({ path: "a", offset: 10 })).toEqual({ path: "a", offset: 10 });
  });

  it("list: bounded page size", () => {
    expect(() => ListNotesInput.parse({ limit: MCP_LIMITS.maxListPage + 1 })).toThrow();
  });

  it("writes: NUL is refused, updates need a baseUpdatedAt", () => {
    expect(() => CreateNoteInput.parse({ path: "a\u0000b" })).toThrow();
    expect(() => CreateNoteInput.parse({ path: "a", content: "x\u0000" })).toThrow();
    expect(() => UpdateNoteInput.parse({ path: "a", content: "x" })).toThrow();
    expect(() => UpdateNoteInput.parse({ path: "a", content: "x", baseUpdatedAt: "yesterday" })).toThrow();
    expect(UpdateNoteInput.parse({ path: "a", content: "x", baseUpdatedAt: "2026-11-14T10:00:00.000Z" }).content).toBe("x");
    expect(() => AppendToNoteInput.parse({ path: "a", content: "" })).toThrow();
  });
});
