"use client";

import { useId, useMemo, useState } from "react";
import { CornerDownLeft, FileText, Plus, SquareTerminal } from "lucide-react";
import type { TreeNote } from "./api";
import { Modal, Shortcut } from "./ui";

export type Command = { id: string; label: string; shortcut?: string; run: () => void };

/** Subsequence fuzzy match; lower score = better, null = no match. */
function fuzzy(query: string, text: string): number | null {
  const q = query.toLowerCase().trim();
  const t = text.toLowerCase();
  if (!q) return 0;
  const direct = t.indexOf(q);
  if (direct !== -1) return direct;
  let ti = 0;
  let gaps = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    gaps += found - ti;
    ti = found + 1;
  }
  return 100 + gaps;
}

type Item =
  | { kind: "note"; id: string; note: TreeNote; score: number }
  | { kind: "create"; id: string; name: string }
  | { kind: "cmd"; id: string; cmd: Command; score: number };

export function Palette({
  mode,
  notes,
  commands,
  onOpen,
  onCreate,
  onClose,
}: {
  mode: "notes" | "commands";
  notes: TreeNote[];
  commands: Command[];
  onOpen: (id: string, newTab: boolean) => void;
  onCreate: (name: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const listId = useId();

  const items: Item[] = useMemo(() => {
    if (mode === "commands") {
      return commands
        .map((cmd) => ({ kind: "cmd" as const, id: `c-${cmd.id}`, cmd, score: fuzzy(q, cmd.label) }))
        .filter((x): x is Extract<Item, { kind: "cmd" }> => x.score !== null)
        .sort((a, b) => a.score - b.score);
    }
    const scored = notes
      .map((note) => ({
        kind: "note" as const,
        id: `n-${note.id}`,
        note,
        score: Math.min(fuzzy(q, note.name) ?? 1e9, (fuzzy(q, note.path) ?? 1e9) + 50),
      }))
      .filter((x) => x.score < 1e9)
      .sort((a, b) => a.score - b.score || +new Date(b.note.updatedAt) - +new Date(a.note.updatedAt))
      .slice(0, 50);
    const t = q.trim();
    const exact = notes.some((n) => n.name.toLowerCase() === t.toLowerCase() || n.path.toLowerCase() === t.toLowerCase());
    return t && !exact ? [...scored, { kind: "create" as const, id: "create", name: t }] : scored;
  }, [mode, q, notes, commands]);

  const choose = (item: Item | undefined, newTab = false) => {
    if (!item) return;
    onClose();
    if (item.kind === "note") onOpen(item.note.id, newTab);
    else if (item.kind === "create") onCreate(item.name);
    else item.cmd.run();
  };

  const active = items[Math.min(sel, items.length - 1)];

  return (
    <Modal label={mode === "notes" ? "Quick switcher" : "Command palette"} onClose={onClose} className="max-w-xl" placement="top">
      <div className="overflow-hidden rounded-lg border border-mist bg-sheet shadow-[var(--shadow-float)]">
        <input
          data-autofocus
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={active?.id}
          aria-autocomplete="list"
          aria-label={mode === "notes" ? "Find or create a note" : "Search commands"}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(active, e.ctrlKey || e.metaKey);
            }
          }}
          placeholder={mode === "notes" ? "Find or create a note…" : "Type a command…"}
          autoComplete="off"
          spellCheck={false}
          className="h-12 w-full border-b border-rule bg-transparent px-4 text-[16px] outline-none placeholder:text-faint"
        />
        <ul id={listId} role="listbox" aria-label="Results" className="max-h-[min(50vh,420px)] overflow-y-auto p-1.5">
          {items.map((item, i) => (
            <li
              key={item.id}
              id={item.id}
              role="option"
              aria-selected={item === active}
              onPointerMove={() => setSel(i)}
              onClick={(e) => choose(item, e.ctrlKey || e.metaKey)}
              className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 ${item === active ? "bg-active outline-2 outline-offset-[-2px] outline-[var(--focus)]" : ""}`}
            >
              {item.kind === "note" && (
                <>
                  <FileText aria-hidden="true" className="size-4 shrink-0 stroke-[1.5] text-faint" />
                  <span className="truncate">{item.note.name}</span>
                  {item.note.path !== item.note.name && (
                    <span className="ml-auto max-w-[45%] truncate text-[12px] text-faint">{item.note.path.slice(0, item.note.path.lastIndexOf("/"))}</span>
                  )}
                </>
              )}
              {item.kind === "create" && (
                <>
                  <Plus aria-hidden="true" className="size-4 shrink-0 stroke-[1.5] text-accent-ink" />
                  <span className="truncate">
                    Create “<span className="font-medium">{item.name}</span>”
                  </span>
                  <CornerDownLeft aria-hidden="true" className="ml-auto size-3.5 stroke-[1.5] text-faint" />
                </>
              )}
              {item.kind === "cmd" && (
                <>
                  <SquareTerminal aria-hidden="true" className="size-4 shrink-0 stroke-[1.5] text-faint" />
                  <span className="truncate">{item.cmd.label}</span>
                  {item.cmd.shortcut && (
                    <span className="ml-auto">
                      <Shortcut keys={item.cmd.shortcut} />
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
        {items.length === 0 && (
          <p role="status" className="px-4 pb-3 pt-1.5 text-muted">
            {mode === "commands"
              ? "No matching commands"
              : notes.length === 0
                ? "No notes yet. Type a name, then press Enter to create your first note."
                : "No matching notes"}
          </p>
        )}
        <div className="flex items-center gap-4 border-t border-rule px-4 py-2 text-[12px] text-faint">
          <span className="inline-flex items-center gap-1.5">
            <Shortcut keys="↑" /> <Shortcut keys="↓" /> to move
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Shortcut keys="↵" /> to open
          </span>
          {mode === "notes" && (
            <span className="hidden items-center gap-1.5 sm:inline-flex">
              <Shortcut keys="Mod+↵" /> to open in a new tab
            </span>
          )}
          <span className="ml-auto inline-flex items-center gap-1.5">
            <Shortcut keys="Esc" /> to close
          </span>
        </div>
      </div>
    </Modal>
  );
}
