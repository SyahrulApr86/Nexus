import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

/** Simple subsequence fuzzy match with a crude score (lower = better). */
function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return t.length;
  let qi = 0;
  let gaps = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
    else if (qi > 0) gaps++;
  }
  if (qi < q.length) return null;
  return gaps + (t.startsWith(q) ? 0 : 10);
}

/**
 * FR-020: Ctrl/Cmd+P command palette. Fuzzy filter, arrow-key navigation,
 * Enter executes, Escape closes with no residual overlay (US8-S4).
 */
export function CommandPalette({
  open,
  commands,
  onClose,
}: {
  open: boolean;
  commands: Command[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setQuery("");
      setActive(0);
      dialog.showModal();
      setTimeout(() => inputRef.current?.focus(), 0);
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const filtered = useMemo(() => {
    return commands
      .map((c) => ({ c, score: fuzzyScore(query, c.label) }))
      .filter((x): x is { c: Command; score: number } => x.score !== null)
      .sort((a, b) => a.score - b.score)
      .slice(0, 12)
      .map((x) => x.c);
  }, [commands, query]);

  useEffect(() => setActive(0), [filtered.length, query]);

  const execute = useCallback(
    (cmd: Command | undefined) => {
      if (!cmd) return;
      onClose();
      cmd.run();
    },
    [onClose],
  );

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onCancel={onClose}
      aria-label="Command palette"
      className="m-auto mt-[15vh] w-[520px] max-w-[92vw] rounded-card border border-border bg-card p-0 text-ink shadow-xl backdrop:bg-black/40"
    >
      <label htmlFor="palette-input" className="sr-only">
        Type a command
      </label>
      <input
        ref={inputRef}
        id="palette-input"
        role="combobox"
        aria-expanded={filtered.length > 0}
        aria-controls={listId}
        aria-activedescendant={
          filtered[active] ? `${listId}-${active}` : undefined
        }
        autoComplete="off"
        placeholder="Type a command…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, filtered.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            execute(filtered[active]);
          }
        }}
        className="w-full border-b border-border bg-transparent px-4 py-3 text-[16px] text-ink outline-none placeholder:text-muted"
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="Commands"
        className="max-h-72 overflow-auto py-1"
      >
        {filtered.map((cmd, i) => (
          <li
            key={cmd.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            onClick={() => execute(cmd)}
            onMouseEnter={() => setActive(i)}
            className={`flex cursor-pointer items-center justify-between px-4 py-2 text-[14px] ${
              i === active ? "bg-surface" : ""
            }`}
          >
            <span className="truncate text-ink">{cmd.label}</span>
            {cmd.hint && (
              <span className="ml-3 shrink-0 text-[12px] text-muted">
                {cmd.hint}
              </span>
            )}
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="px-4 py-3 text-[14px] text-muted">No matching commands</li>
        )}
      </ul>
    </dialog>
  );
}
