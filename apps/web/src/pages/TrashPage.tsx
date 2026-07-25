import { useEffect, useRef, useState } from "react";
import type { TrashedItemDto } from "@nexus/shared";
import {
  usePermanentDelete,
  useRestore,
  useTrash,
  useTrashedVersions,
  useVersionContent,
} from "../api/trash.js";
import { ConfirmDialog } from "../components/Dialogs.js";
import { MarkdownPreview } from "../components/MarkdownPreview.js";
import { useToast } from "../components/Toast.js";
import { Button } from "../components/ui.js";

/** FR-028..032: trash management with read-only version preview. */
export function TrashPage() {
  const { data: items, isLoading } = useTrash();
  const restore = useRestore();
  const purge = usePermanentDelete();
  const toast = useToast();
  const [purgeTarget, setPurgeTarget] = useState<TrashedItemDto | null>(null);
  const [versionsFor, setVersionsFor] = useState<TrashedItemDto | null>(null);

  const doRestore = (item: TrashedItemDto) =>
    restore.mutate(
      { type: item.type, id: item.id },
      {
        onSuccess: ({ restoredToRoot }) => {
          toast(
            restoredToRoot
              ? `"${item.title}" restored to the vault root — its original folder no longer exists.`
              : `"${item.title}" restored to its original location.`,
          );
        },
      },
    );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-[24px] font-semibold tracking-heading">Trash</h1>
        <p className="text-[14px] text-muted">
          Deleted notes and folders. Restore them with full version history, or
          delete them permanently.
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        {isLoading ? (
          <p className="text-muted">Loading…</p>
        ) : !items || items.length === 0 ? (
          <p className="text-muted">Trash is empty.</p>
        ) : (
          <ul className="flex max-w-2xl flex-col gap-2">
            {items.map((item) => (
              <li
                key={`${item.type}-${item.id}`}
                className="flex items-center gap-3 rounded-card border border-border bg-card px-4 py-3"
              >
                <span aria-hidden="true">
                  {item.type === "folder" ? "📁" : "📄"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-ink">
                    {item.title}
                  </p>
                  <p className="text-[12px] text-muted">
                    Deleted {new Date(item.trashedAt).toLocaleString()}
                  </p>
                </div>
                {item.type === "note" && (
                  <Button
                    variant="ghost"
                    className="!px-3 !py-1.5 text-[13px]"
                    onClick={() => setVersionsFor(item)}
                  >
                    Versions
                  </Button>
                )}
                <Button
                  variant="ghost"
                  className="!px-3 !py-1.5 text-[13px]"
                  onClick={() => doRestore(item)}
                >
                  Restore
                </Button>
                <Button
                  variant="danger"
                  className="!px-3 !py-1.5 text-[13px]"
                  onClick={() => setPurgeTarget(item)}
                >
                  Delete forever
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={purgeTarget !== null}
        title="Delete permanently"
        message={`Permanently delete "${purgeTarget?.title ?? ""}"${
          purgeTarget?.type === "folder" ? " and everything inside it" : ""
        }? All version history will be irreversibly removed. This cannot be undone.`}
        confirmLabel="Delete forever"
        danger
        onConfirm={() => {
          if (!purgeTarget) return;
          purge.mutate(
            { type: purgeTarget.type, id: purgeTarget.id },
            { onSuccess: () => toast("Permanently deleted") },
          );
        }}
        onClose={() => setPurgeTarget(null)}
      />

      <VersionsDialog
        item={versionsFor}
        onClose={() => setVersionsFor(null)}
      />
    </div>
  );
}

/** FR-032: read-only preview of any prior version while trashed. */
function VersionsDialog({
  item,
  onClose,
}: {
  item: TrashedItemDto | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const { data: versions } = useTrashedVersions(item?.id ?? null);
  const { data: preview } = useVersionContent(item?.id ?? null, selected);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (item && !dialog.open) dialog.showModal();
    if (!item && dialog.open) dialog.close();
    if (!item) setSelected(null);
  }, [item]);

  useEffect(() => {
    if (versions?.length && !selected) setSelected(versions[0]!.id);
  }, [versions, selected]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={`Version history for ${item?.title ?? ""}`}
      className="m-auto h-[70vh] w-[720px] max-w-[95vw] rounded-card border border-border bg-card p-0 text-ink shadow-xl backdrop:bg-black/40"
    >
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h2 className="text-[16px] font-semibold">
          Version history — {item?.title}
        </h2>
        <Button variant="ghost" className="!px-3 !py-1" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="flex h-[calc(70vh-57px)]">
        <ul
          aria-label="Versions"
          className="w-52 shrink-0 overflow-auto border-r border-border py-2"
        >
          {versions?.map((v, i) => (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => setSelected(v.id)}
                aria-current={selected === v.id}
                className={`block w-full px-4 py-2 text-left text-[13px] hover:bg-surface ${
                  selected === v.id ? "bg-surface font-medium" : ""
                }`}
              >
                {i === 0 ? "Latest" : `Version ${versions.length - i}`}
                <span className="block text-[11px] text-muted">
                  {new Date(v.createdAt).toLocaleString()}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="min-w-0 flex-1 overflow-auto" data-testid="version-preview">
          {preview ? (
            <MarkdownPreview content={preview.content} />
          ) : (
            <p className="p-6 text-muted">Select a version to preview.</p>
          )}
        </div>
      </div>
    </dialog>
  );
}
