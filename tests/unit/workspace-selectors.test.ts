import { describe, expect, it } from "vitest";
import { sameItems, sameNoteMeta, shallowEqual } from "@/components/workspace/store";

describe("selector equality helpers", () => {
  it("shallowEqual compares own keys by identity", () => {
    const tree = { notes: [] };
    expect(shallowEqual({ a: 1, tree }, { a: 1, tree })).toBe(true);
    expect(shallowEqual({ a: 1, tree }, { a: 1, tree: { notes: [] } })).toBe(false);
    expect(shallowEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(shallowEqual({ a: NaN }, { a: NaN })).toBe(true);
    expect(shallowEqual<unknown>(null, {})).toBe(false);
  });

  it("sameItems compares arrays item by item", () => {
    expect(sameItems(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameItems(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameItems(["a"], ["a", "b"])).toBe(false);
  });

  it("sameNoteMeta ignores the note text", () => {
    const a = { id: "1", name: "A", path: "x/A", content: "one" };
    const b: typeof a = { ...a, content: "two" };
    expect(sameNoteMeta(a, b)).toBe(true);
    expect(sameNoteMeta(a, { ...a, name: "B" })).toBe(false);
    expect(sameNoteMeta(a, undefined)).toBe(false);
    expect(sameNoteMeta(undefined, undefined)).toBe(true);
  });
});
