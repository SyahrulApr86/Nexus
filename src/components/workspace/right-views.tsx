"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { api, type Mention, type TagCount, type NoteRef } from "./api";
import { useWorkspace } from "./store";
import { Bar } from "./ui";
import { extractHeadings, extractWikiLinks } from "@/lib/markdown/parse";

function Section({
  title,
  count,
  defaultOpen = true,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mb-4">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex h-8 w-full items-center gap-1 rounded-md px-1 text-[13px] font-medium text-muted transition-colors hover:bg-hover hover:text-fg"
        >
          <ChevronRight aria-hidden="true" className={`size-4 stroke-[1.5] text-faint transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
          <span className="flex-1 text-left">{title}</span>
          {count !== undefined && <span className="tabular px-1 text-[12px] font-normal text-faint">{count}</span>}
        </button>
      </h3>
      {open && <div className="mt-1">{children}</div>}
    </section>
  );
}

/**
 * A backlink's context line, readable: list and heading markers dropped,
 * [[links]] shown as their text, the link to this note in blue.
 */
function Context({ line, target }: { line: string; target: string }) {
  const clean = line
    .replace(/^\s*(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s*|#{1,6}\s+)/, "")
    .replace(/==([^=\n]+)==/g, "$1");
  const parts: React.ReactNode[] = [];
  let pos = 0;
  for (const m of clean.matchAll(/!?\[\[([^\[\]\n]+?)\]\]/g)) {
    parts.push(clean.slice(pos, m.index));
    const [targetPart, alias] = m[1].split("|");
    const name = targetPart.split("#")[0].trim();
    const text = alias ?? name;
    const isTarget = name.toLowerCase() === target.toLowerCase() || name.toLowerCase().endsWith(`/${target.toLowerCase()}`);
    parts.push(
      <span key={m.index} className={isTarget ? "font-medium text-accent-ink" : "text-muted"}>
        {text}
      </span>,
    );
    pos = m.index! + m[0].length;
  }
  parts.push(clean.slice(pos));
  return <span className="mt-0.5 line-clamp-2 block text-[13px] leading-5 text-faint">{parts}</span>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-1 text-[13px] text-faint">{children}</p>;
}

function NoNote() {
  return <Empty>Open a note to see its links and outline.</Empty>;
}

/* ---------------- Backlinks: linked and unlinked mentions ---------------- */

export function BacklinksView() {
  const w = useWorkspace();
  const note = w.activeNote;
  const [mentions, setMentions] = useState<Mention[] | null>(null);
  const [linking, setLinking] = useState<string | null>(null);

  useEffect(() => {
    if (!note) return;
    let live = true;
    setMentions(null); // eslint-disable-line react-hooks/set-state-in-effect -- reset while the next note loads
    api
      .mentions(note.id)
      .then((m) => live && setMentions(m))
      .catch(() => live && setMentions([]));
    return () => {
      live = false;
    };
  }, [note?.id, note?.name, w.version]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!note) return <NoNote />;

  const link = async (m: Mention) => {
    setLinking(m.id);
    try {
      await w.actions.flush(m.id);
      await api.linkMention(note.id, m.id);
      await w.actions.loadNote(note.id);
      w.actions.bump();
      w.actions.notify(`Linked “${note.name}” in ${m.name}`);
    } catch (e) {
      w.actions.notify(e instanceof Error ? e.message : "Couldn’t link that mention");
    } finally {
      setLinking(null);
    }
  };

  return (
    <div>
      <Section title="Linked mentions" count={note.backlinks.length}>
        {note.backlinks.length === 0 ? (
          <Empty>No notes link here yet. Type [[{note.name}]] in another note.</Empty>
        ) : (
          <ul className="space-y-0.5">
            {note.backlinks.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={(e) => w.actions.open(b.id, e.ctrlKey || e.metaKey ? "tab" : "current")}
                  className="block w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover"
                >
                  <span className="block truncate">{b.name}</span>
                  {b.context && <Context line={b.context} target={note.name} />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Unlinked mentions" count={mentions?.length} defaultOpen={false}>
        {mentions === null ? (
          <div className="space-y-2 px-2 py-1">
            <Bar w="60%" h={10} />
            <Bar w="80%" h={10} />
          </div>
        ) : mentions.length === 0 ? (
          <Empty>No other note mentions “{note.name}” without linking it.</Empty>
        ) : (
          <ul className="space-y-1">
            {mentions.map((m) => (
              <li key={m.id} className="rounded-md px-2 py-1.5 hover:bg-hover">
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => w.actions.open(m.id)} className="min-w-0 flex-1 truncate text-left hover:underline">
                    {m.name}
                  </button>
                  <button
                    type="button"
                    disabled={linking === m.id}
                    onClick={() => link(m)}
                    className="h-7 shrink-0 rounded-md border border-control px-2 text-[12px] font-medium transition-colors hover:bg-sheet disabled:opacity-50"
                  >
                    {linking === m.id ? "Linking…" : "Link"}
                  </button>
                </div>
                <Context line={m.context} target={note.name} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

/* ---------------- Outgoing links ---------------- */

export function OutgoingView() {
  const w = useWorkspace();
  const content = useDeferredValue(w.activeNote?.content ?? "");
  const links = useMemo(() => {
    const seen = new Set<string>();
    return extractWikiLinks(content).filter((l) => {
      const k = l.target.toLowerCase();
      if (!l.target || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [content]);
  if (!w.activeNote) return <NoNote />;
  const resolved = links.filter((l) => w.exists(l.target));
  const unresolved = links.filter((l) => !w.exists(l.target));
  return (
    <div>
      <Section title="Links" count={resolved.length}>
        {resolved.length === 0 ? (
          <Empty>This note doesn’t link to other notes yet.</Empty>
        ) : (
          <ul className="space-y-0.5">
            {resolved.map((l) => (
              <li key={l.target}>
                <button
                  type="button"
                  onClick={(e) => w.actions.openLink(l.target, e.ctrlKey || e.metaKey)}
                  className="block w-full truncate rounded-md px-2 py-1.5 text-left text-accent-ink transition-colors hover:bg-hover"
                >
                  {l.target}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {unresolved.length > 0 && (
        <Section title="Not created yet" count={unresolved.length}>
          <ul className="space-y-0.5">
            {unresolved.map((l) => (
              <li key={l.target}>
                <button
                  type="button"
                  onClick={() => w.actions.openLink(l.target)}
                  title={`Create “${l.target}”`}
                  className="block w-full truncate rounded-md px-2 py-1.5 text-left text-faint transition-colors hover:bg-hover hover:text-fg"
                >
                  {l.target}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

/* ---------------- Tags (vault-wide) ---------------- */

export function TagsView() {
  const w = useWorkspace();
  const [tags, setTags] = useState<TagCount[] | null>(null);
  const [notes, setNotes] = useState<NoteRef[] | null>(null);
  const selected = w.selectedTag;

  useEffect(() => {
    let live = true;
    api
      .tags()
      .then((t) => live && setTags(t))
      .catch(() => live && setTags([]));
    return () => {
      live = false;
    };
  }, [w.version]);

  useEffect(() => {
    if (!selected) return;
    let live = true;
    setNotes(null); // eslint-disable-line react-hooks/set-state-in-effect -- reset while loading
    api
      .byTag(selected)
      .then((n) => live && setNotes(n))
      .catch(() => live && setNotes([]));
    return () => {
      live = false;
    };
  }, [selected, w.version]);

  if (selected)
    return (
      <div>
        <button type="button" onClick={() => w.actions.setSelectedTag(null)} className="mb-2 rounded-md px-2 py-1 text-[13px] text-accent-ink hover:underline">
          All tags
        </button>
        <h3 className="px-2 pb-2 font-medium">
          <span className="rounded bg-mark-soft px-1.5 py-0.5 text-[13px] text-mark-ink">#{selected}</span>
        </h3>
        {notes === null ? (
          <div className="space-y-2 px-2">
            <Bar w="70%" h={10} />
            <Bar w="50%" h={10} />
          </div>
        ) : notes.length === 0 ? (
          <Empty>No notes have this tag anymore.</Empty>
        ) : (
          <ul className="space-y-0.5">
            {notes.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={(e) => w.actions.open(n.id, e.ctrlKey || e.metaKey ? "tab" : "current")}
                  className="block w-full truncate rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover"
                >
                  {n.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );

  if (tags === null)
    return (
      <div className="space-y-3 px-2 py-1">
        {[50, 70, 40].map((x, i) => (
          <Bar key={i} w={`${x}%`} h={10} />
        ))}
      </div>
    );
  if (!tags.length) return <Empty>No tags yet. Write #tag in a note to add one.</Empty>;
  return (
    <ul className="space-y-0.5">
      {tags.map((t) => (
        <li key={t.tag}>
          <button
            type="button"
            onClick={() => w.actions.setSelectedTag(t.tag)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover"
          >
            <span className="min-w-0 flex-1 truncate text-mark-ink">#{t.tag}</span>
            <span className="tabular text-[12px] text-faint">{t.count}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ---------------- Outline ---------------- */

export function OutlineView() {
  const w = useWorkspace();
  const content = useDeferredValue(w.activeNote?.content ?? "");
  const headings = useMemo(() => extractHeadings(content), [content]);
  if (!w.activeNote) return <NoNote />;
  if (!headings.length) return <Empty>No headings. Start a line with # to add one.</Empty>;
  const min = Math.min(...headings.map((h) => h.level));
  return (
    <nav aria-label="Outline">
      <ul className="space-y-0.5">
        {headings.map((h, i) => (
          <li key={`${h.line}-${i}`}>
            <button
              type="button"
              onClick={() => {
                if (w.focusView.type === "note" && w.focusView.mode === "read") w.actions.setMode("edit");
                w.actions.setDrawer(null);
                setTimeout(() => w.editor.current?.scrollToLine(h.line), 40);
              }}
              className="block w-full truncate rounded-md py-1.5 pr-2 text-left transition-colors hover:bg-hover"
              style={{ paddingLeft: 8 + (h.level - min) * 14 }}
            >
              {h.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
