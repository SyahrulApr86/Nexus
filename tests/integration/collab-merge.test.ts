import { describe, expect, it } from "vitest";
import { diff, mergeIncoming, type Splice } from "../../collab/src/merge";
import { noteIdFromUrl } from "../../collab/src/server";
import { parseCookies, signCookieValue, verifySignedCookie } from "../../collab/src/auth";

function apply(text: string, splices: Splice[]) {
  for (const s of splices) text = text.slice(0, s.index) + s.insert + text.slice(s.index + s.remove);
  return text;
}

describe("mergeIncoming", () => {
  it("takes the database text when nothing is unsaved", () => {
    expect(apply("abc", mergeIncoming("abc", "abc", "abXc"))).toBe("abXc");
  });

  it("keeps a local edit after the incoming one", () => {
    expect(apply("one two three!", mergeIncoming("one two three", "one two three!", "ONE two three"))).toBe("ONE two three!");
  });

  it("keeps a local edit before the incoming one", () => {
    expect(apply(">one two three", mergeIncoming("one two three", ">one two three", "one two THREE"))).toBe(">one two THREE");
  });

  it("lets the database write win where both changed the same text", () => {
    expect(apply("one 2 three", mergeIncoming("one two three", "one 2 three", "one TWO three"))).toBe("one TWO three");
  });

  it("does nothing when the database holds the base or the live text", () => {
    expect(mergeIncoming("a", "ab", "a")).toEqual([]);
    expect(mergeIncoming("a", "ab", "ab")).toEqual([]);
  });

  it("never splits a surrogate pair", () => {
    const [s] = diff("a😀b", "a😃b");
    expect(apply("a😀b", [s])).toBe("a😃b");
    expect(s.insert).toBe("😃");
  });
});

describe("collab handshake helpers", () => {
  it("reads the note id from both URL forms", () => {
    const id = "0b7f3c1e-5d2a-4c39-9a51-6f1e2d3c4b5a";
    expect(noteIdFromUrl(`/collab?note=${id}`)).toBe(id);
    expect(noteIdFromUrl(`/collab/${id}`)).toBe(id);
    expect(noteIdFromUrl(`/collab/${id}?foo=1`)).toBe(id);
    expect(noteIdFromUrl("/collab?note=nope")).toBe("");
    expect(noteIdFromUrl("/elsewhere")).toBeNull();
  });

  it("verifies Better Auth's signed cookie format", () => {
    const signed = signCookieValue("tok123", "s3cret");
    expect(verifySignedCookie(signed, "s3cret")).toBe("tok123");
    expect(verifySignedCookie(signed, "other")).toBeNull();
    expect(verifySignedCookie("tok123", "s3cret")).toBeNull();
    expect(parseCookies(`a=1; better-auth.session_token=${signed}; b=2`).get("better-auth.session_token")).toBe(signed);
  });
});
