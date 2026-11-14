"use client";

/*
 * Connects ```query blocks to the workspace. Mount once inside <WorkspaceProvider> (workspace.tsx):
 *
 *   {/* query *\/}<QueryBridge />{/* end query *\/}
 *
 * - Refresh: when the workspace saves, creates, renames or deletes notes (its version signals),
 *   every block on screen re-checks its results, sooner than its own 30 s poll.
 * - Tasks: a task in a note the workspace has loaded is toggled through the workspace (the same
 *   path as a click in the reading view), so pending saves stay in step; when an editor shows that
 *   note (a TASK query listing the note's own tasks in Live Preview), the change goes into the
 *   editor, which holds its own copy of the text: otherwise the box would stay unticked there and
 *   the next keystroke would save the old line back. Other notes are toggled on the server with
 *   the version read (client.ts).
 *
 * Without the bridge, blocks still work: they refresh on focus, on their poll, and after their own
 * toggles, and toggle every task on the server.
 */
import { useEffect } from "react";
import { toggleTaskAt } from "@/lib/markdown/tasks";
import { diffText } from "@/lib/markdown/frontmatter-edit";
import { currentView, useWorkspaceActions, useWorkspaceSelector } from "../store";
import { StaleTaskError, refreshQueries, serverToggle, setTaskToggle, taskTextAt } from "./client";

export function QueryBridge() {
  const actions = useWorkspaceActions();
  const version = useWorkspaceSelector((w) => w.version);
  const linksVersion = useWorkspaceSelector((w) => w.linksVersion);
  const tagsVersion = useWorkspaceSelector((w) => w.tagsVersion);
  const tree = useWorkspaceSelector((w) => w.tree);
  const liveContent = useWorkspaceSelector((w) => w.liveContent);
  const notes = useWorkspaceSelector((w) => w.notes);
  const layout = useWorkspaceSelector((w) => w.layout);
  const editorFor = useWorkspaceSelector((w) => w.editorFor);

  // Saves land a moment after the signal; wait for them before asking.
  useEffect(() => {
    const t = setTimeout(refreshQueries, 1500);
    return () => clearTimeout(t);
  }, [version, linksVersion, tagsVersion, tree]);

  useEffect(
    () =>
      setTaskToggle(async (noteId, offset, text) => {
        if (!notes[noteId]) return serverToggle(noteId, offset, text);
        const content = liveContent(noteId);
        if (taskTextAt(content, offset) !== text) throw new StaleTaskError();
        const next = toggleTaskAt(content, offset);
        if (next === content) throw new StaleTaskError();
        const editor = layout.groups
          .map((g, gi) => {
            const tab = g.tabs[g.active];
            const v = tab && currentView(tab);
            return v?.type === "note" && v.id === noteId && v.mode === "edit" ? editorFor(gi).current : null;
          })
          .find((h) => h);
        // The editor reports the change back through onChange, like a keystroke.
        if (editor) editor.apply(diffText(content, next));
        else actions.onChange(noteId, next);
        await actions.flush(noteId);
      }),
    [actions, notes, liveContent, layout, editorFor],
  );

  return null;
}
