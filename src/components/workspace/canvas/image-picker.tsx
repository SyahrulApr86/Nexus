"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Check, ImageIcon, Search } from "lucide-react";
import { CANVAS_IMAGE } from "@/lib/canvas";
import { attachmentsApi, type AttachmentInfo } from "../api";
import { useAttachments } from "../attachments/context";
import { Modal, Shortcut } from "../ui";

const isImage = (a: { path: string; mime: string }) => CANVAS_IMAGE.test(a.path) && (!a.mime || a.mime.startsWith("image/"));
const fileUrl = (path: string) => `/api/attachments/file?path=${encodeURIComponent(path)}`;

/**
 * Pick an image from the vault's attachments: a group's background. A combobox over the images,
 * filtered by name or folder as you type, with a small preview of each. The attachments panel
 * already holds the list; outside it the list is fetched once.
 */
export function ImagePicker({
  title,
  current,
  onPick,
  onClose,
}: {
  title: string;
  current?: string;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const shared = useAttachments();
  const [own, setOwn] = useState<AttachmentInfo[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const listId = useId();
  const optionId = useId();
  const hasShared = !!shared && shared.status === "ready";

  useEffect(() => {
    if (hasShared) return;
    let live = true;
    attachmentsApi
      .all()
      .then((items) => live && setOwn(items))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [hasShared]);

  const all = hasShared ? shared.items : own;
  const images = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (all ?? [])
      .filter(isImage)
      .filter((a) => !t || a.path.toLowerCase().includes(t))
      .sort((a, b) => a.path.localeCompare(b.path))
      .slice(0, 200);
  }, [all, q]);

  const active = images[Math.min(sel, images.length - 1)];
  const choose = (path: string | undefined) => {
    if (!path) return;
    onClose();
    onPick(path);
  };
  const loading = all === null && !failed;

  return (
    <Modal label={title} onClose={onClose} className="max-w-[560px]" placement="top">
      <div className="float-panel overflow-hidden">
        <div className="flex h-14 items-center gap-3 border-b border-border px-4">
          <Search aria-hidden="true" className="size-[18px] shrink-0 stroke-[1.5] text-faint" />
          <input
            data-autofocus
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={active ? `${optionId}-${images.indexOf(active)}` : undefined}
            aria-autocomplete="list"
            aria-label="Find an image"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(s + 1, images.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(s - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(active?.path);
              }
            }}
            placeholder="Find an image…"
            autoComplete="off"
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent text-[17px] tracking-[-0.01em] text-fg outline-none placeholder:text-faint"
          />
          <span className="shrink-0 text-[12px] font-medium text-faint">Images</span>
        </div>
        <ul id={listId} role="listbox" aria-label="Images in this vault" className="max-h-[min(52vh,440px)] overflow-y-auto p-1.5">
          {images.map((a, i) => {
            const on = a === active;
            const slash = a.path.lastIndexOf("/");
            return (
              <li
                key={a.path}
                id={`${optionId}-${i}`}
                role="option"
                aria-selected={on}
                onPointerMove={() => setSel(i)}
                onClick={() => choose(a.path)}
                className={`flex h-14 cursor-pointer items-center gap-3 rounded-md px-2 text-[14px] ${on ? "bg-active text-fg shadow-[inset_1px_0_0_var(--accent-line)]" : "text-muted"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- same-origin attachment preview */}
                <img src={fileUrl(a.path)} alt="" loading="lazy" decoding="async" className="size-10 shrink-0 rounded-[2px] border border-rule bg-hover object-cover" />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate ${on ? "font-medium" : "text-fg"}`} translate="no">
                    {a.path.slice(slash + 1)}
                  </span>
                  {slash > 0 && (
                    <span className="block truncate text-[12px] text-faint" translate="no">
                      {a.path.slice(0, slash)}
                    </span>
                  )}
                </span>
                {a.path === current && (
                  <span className="inline-flex shrink-0 items-center gap-1 text-[12px] text-faint">
                    <Check aria-hidden="true" className="size-3.5 stroke-[1.5]" />
                    Current
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {!images.length && (
          <p role="status" className="flex items-start gap-2 px-4 pb-5 pt-2 text-[14px] text-muted">
            <ImageIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 stroke-[1.5] text-faint" />
            {loading
              ? "Loading images…"
              : failed
                ? "Couldn’t load this vault’s images. Check your connection and try again."
                : q.trim()
                  ? "No matching images"
                  : "No images in this vault yet. Add one under Attachments in the sidebar, then pick it here."}
          </p>
        )}
        <div className="flex h-10 items-center gap-5 border-t border-border bg-frame px-4 text-[12px] text-faint">
          <span className="inline-flex items-center gap-1.5">
            <Shortcut keys="↑" /> <Shortcut keys="↓" /> to move
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Shortcut keys="↵" /> to pick
          </span>
          <span className="ml-auto inline-flex items-center gap-1.5">
            <Shortcut keys="Esc" /> to close
          </span>
        </div>
      </div>
    </Modal>
  );
}
