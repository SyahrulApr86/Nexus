"use client";

import { File, FileAudio, FileImage, FileText, FileVideo } from "lucide-react";
import type { AttachmentKind } from "@/lib/markdown/attachments";
import type { MenuItem } from "../ui";
import type { AttachmentsValue } from "./context";
import { baseName } from "./model";

const ICONS = { image: FileImage, pdf: FileText, audio: FileAudio, video: FileVideo, file: File } as const;

/** The type icon in an attachment's explorer row; it takes the 20px a note row indents its name by. */
export function AttachmentIcon({ kind }: { kind: AttachmentKind }) {
  const Icon = ICONS[kind];
  return (
    <span aria-hidden="true" className="grid w-5 shrink-0 place-items-center">
      <Icon className="size-3.5 stroke-[1.5] text-faint" />
    </span>
  );
}

/** The context menu of an attachment row. There is no rename: the API cannot rename a file. */
export function attachmentMenu(att: AttachmentsValue, path: string): { label: string; items: MenuItem[] } {
  return {
    label: `Attachment ${baseName(path)}`,
    items: [
      { label: "Open in new tab", onSelect: () => att.open(path, "tab") },
      { label: "Open to the right", onSelect: () => att.open(path, "split") },
      "separator",
      { label: "Copy embed link", onSelect: () => att.copyEmbed(path) },
      "separator",
      { label: "Delete", danger: true, onSelect: () => void att.remove(path) },
    ],
  };
}
