import { useEffect, useRef } from "react";
import type { FolderDto } from "@nexus/shared";

interface FlatFolder {
  id: string | null;
  name: string;
  depth: number;
}

function flatten(
  tree: FolderDto[],
  depth = 0,
  excludeId?: string,
): FlatFolder[] {
  const out: FlatFolder[] = [];
  for (const f of tree) {
    if (f.id === excludeId) continue; // can't move into itself/descendants
    out.push({ id: f.id, name: f.name, depth });
    out.push(...flatten(f.children, depth + 1, excludeId));
  }
  return out;
}

/** Keyboard-first destination picker — the accessible alternative to drag (SC-006). */
export function MoveDialog({
  open,
  title,
  tree,
  excludeFolderId,
  onMove,
  onClose,
}: {
  open: boolean;
  title: string;
  tree: FolderDto[];
  excludeFolderId?: string;
  onMove: (folderId: string | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const destinations: FlatFolder[] = [
    { id: null, name: "Vault root", depth: 0 },
    ...flatten(tree, 1, excludeFolderId),
  ];

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={title}
      className="m-auto w-96 max-w-[90vw] rounded-card border border-border bg-card p-0 text-ink backdrop:bg-black/40"
    >
      <div className="border-b border-border px-4 py-3 text-[16px] font-semibold">
        {title}
      </div>
      <ul className="max-h-80 overflow-auto py-1">
        {destinations.map((d) => (
          <li key={d.id ?? "root"}>
            <button
              type="button"
              onClick={() => {
                onMove(d.id);
                onClose();
              }}
              className="block w-full px-4 py-1.5 text-left text-[14px] hover:bg-surface"
              style={{ paddingLeft: `${16 + d.depth * 16}px` }}
            >
              {d.name}
            </button>
          </li>
        ))}
      </ul>
      <div className="border-t border-border px-4 py-2 text-right">
        <button
          type="button"
          onClick={onClose}
          className="rounded-control border border-border px-3 py-1.5 text-[14px] hover:bg-surface"
        >
          Cancel
        </button>
      </div>
    </dialog>
  );
}
