import { emptyCanvas, serializeCanvas } from "@/lib/canvas";
import type { WorkspaceActions } from "../store";

/**
 * "Create new canvas": an empty JSON Canvas file named "Untitled.canvas" in `folder` (the server
 * picks "Untitled 1.canvas" and so on when the name is taken), opened in the current tab.
 */
export function newCanvas(actions: Pick<WorkspaceActions, "createAndOpen">, folder = "") {
  const path = folder ? `${folder}/Untitled.canvas` : "Untitled.canvas";
  return actions.createAndOpen(path, serializeCanvas(emptyCanvas()), "current", "editor");
}

/** The path a file card stores for a note: notes as "path.md", canvases with their own extension. */
export function fileFor(path: string) {
  return /\.canvas$/i.test(path) ? path : `${path}.md`;
}
