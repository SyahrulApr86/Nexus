import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { DEFAULT_FOCUS_PREFS, parseFocusPrefs, readFocusPrefs } from "@/components/workspace/focus/focus-prefs";
import { centersCaret } from "@/components/workspace/focus/typewriter";

describe("focus preferences", () => {
  it("are off unless saved as true", () => {
    expect(parseFocusPrefs(null)).toEqual(DEFAULT_FOCUS_PREFS);
    expect(parseFocusPrefs("not json")).toEqual(DEFAULT_FOCUS_PREFS);
    expect(parseFocusPrefs(JSON.stringify({ focus: "yes", typewriter: 1 }))).toEqual({ focus: false, typewriter: false });
    expect(parseFocusPrefs(JSON.stringify({ focus: true, typewriter: true }))).toEqual({ focus: true, typewriter: true });
  });

  it("read as the defaults on the server", () => {
    expect(readFocusPrefs()).toEqual(DEFAULT_FOCUS_PREFS);
  });
});

describe("typewriter mode", () => {
  const state = EditorState.create({ doc: "one\ntwo\nthree" });

  it("centres the caret after typing, deleting and keyboard moves", () => {
    expect(centersCaret(state.update({ changes: { from: 0, insert: "x" }, userEvent: "input.type" }))).toBe(true);
    expect(centersCaret(state.update({ changes: { from: 0, to: 1 }, userEvent: "delete.backward" }))).toBe(true);
    expect(centersCaret(state.update({ selection: EditorSelection.cursor(5), userEvent: "select" }))).toBe(true);
    expect(centersCaret(state.update({ changes: { from: 0, insert: "x" }, userEvent: "undo" }))).toBe(true);
  });

  it("leaves pointer clicks and programmatic changes where they are", () => {
    expect(centersCaret(state.update({ selection: EditorSelection.cursor(5), userEvent: "select.pointer" }))).toBe(false);
    expect(centersCaret(state.update({ changes: { from: 0, insert: "remote" } }))).toBe(false);
    expect(centersCaret(state.update({ userEvent: "input" }))).toBe(false);
  });
});
