"use client";

import { memo, useDeferredValue, useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { api, type Mention, type TagCount, type NoteRef } from "./api";
import { useWorkspace } from "./store";
import { Bar } from "./ui";
import { extractHeadings, extractWikiLinks } from "@/lib/markdown/parse";

const nf = new Intl.NumberFormat("en");
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

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
          className="flex h-11 w-full items-center gap-1 rounded-md px-1 text-[13px] font-medium text-muted transition-colors hover:bg-hover hover:text-fg lg:h-8"
        >
          <ChevronRight aria-hidden="true" className={`size-4 stroke-[1.5] text-faint transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
          <span className="flex-1 text-left">{title}</span>
          {count !== undefined && <span className="tabular px-1 text-[12px] font-normal text-faint">{nf.format(count)}</span>}
        </button>
      </h3>
      {open && <div className="mt-1 pl-4">{children}</div>}
    </section>
  );
}

/**
 * A backlink's context line, readable: list and heading markers dropped,
 * [[links]] shown as their text, the link to this note in blue.
 */
const Context = memo(function Context({ line, target }: { line: string; target: string }) {
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
});

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-1 text-[13px] text-faint">{children}</p>;
}

function NoNote() {
  return <Empty>Open a note to see its links and outline.</Empty>;
}

/** Shown in place of a note panel while the focused note is still loading (or failed to). */
function NoteMissing() {
  const w = useWorkspace();
  const v = w.focusView;
  if (v.type !== "note") return <NoNote />;
  if (w.noteErrors[v.id]) return <Empty>Couldn’t load this note.</Empty>;
  return (
    <div role="status" className="space-y-2 px-2 py-1">
      <span className="sr-only">Loading note</span>
      <Bar w="60%" h={10} />
      <Bar w="80%" h={10} />
    </div>
  );
}

/* ---------------- Backlinks: linked and unlinked mentions ---------------- */

export function BacklinksView() {
  const w = useWorkspace();
  const note = w.activeNote;
  // Results are stored with the note they belong to, so an autosave refresh keeps showing
  // the previous list instead of blanking it; only a different note shows the skeleton.
  const [res, setRes] = useState<{ key: string; items: Mention[] } | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const noteId = note?.id;
  const key = note ? `${note.id}:${note.name}` : "";
  const mentions = res?.key === key ? res.items : null;

  useEffect(() => {
    if (!noteId) return;
    let live = true;
    api
      .mentions(noteId)
      .then((m) => live && setRes((r) => (r?.key === key && same(r.items, m) ? r : { key, items: m })))
      .catch(() => live && setRes((r) => (r?.key === key ? r : { key, items: [] })));
    return () => {
      live = false;
    };
  }, [key, noteId, w.version]);

  if (!note) return <NoteMissing />;

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
          <Empty>
            No notes link here yet. Type <code translate="no">[[{note.name}]]</code> in another note.
          </Empty>
        ) : (
          <ul className="space-y-0.5">
            {note.backlinks.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={(e) => w.actions.open(b.id, e.ctrlKey || e.metaKey ? "tab" : "current")}
                  className="block w-full rounded-md px-2 py-3 text-left transition-colors hover:bg-hover lg:py-1.5"
                >
                  <span className="block truncate" translate="no">
                    {b.name}
                  </span>
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
          <Empty>
            No other note mentions “<span translate="no">{note.name}</span>” without linking it.
          </Empty>
        ) : (
          <ul className="space-y-1">
            {mentions.map((m) => (
              <li key={m.id} className="rounded-md px-2 py-3 hover:bg-hover lg:py-1.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => w.actions.open(m.id)}
                    className="min-w-0 flex-1 truncate text-left hover:underline"
                    translate="no"
                  >
                    {m.name}
                  </button>
                  <button
                    type="button"
                    disabled={linking === m.id}
                    onClick={() => link(m)}
                    className="h-11 shrink-0 rounded-md border border-control px-3 text-[12px] font-medium transition-colors hover:bg-sheet disabled:opacity-50 lg:h-7 lg:px-2"
                  >
                    {linking === m.id ? "Linking…" : "Link"}
                    <span className="sr-only"> mention in {m.name}</span>
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
  if (!w.activeNote) return <NoteMissing />;
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
                  className="block w-full truncate rounded-md px-2 py-3 text-left text-accent-ink transition-colors hover:bg-hover lg:py-1.5"
                  translate="no"
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
                  className="block w-full truncate rounded-md px-2 py-3 text-left text-faint transition-colors hover:bg-hover hover:text-fg lg:py-1.5"
                  translate="no"
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
  const [byTag, setByTag] = useState<{ tag: string; items: NoteRef[] } | null>(null);
  const selected = w.selectedTag;
  const notes = selected && byTag?.tag === selected ? byTag.items : null;

  useEffect(() => {
    let live = true;
    api
      .tags()
      .then((t) => live && setTags((prev) => (same(prev, t) ? prev : t)))
      .catch(() => live && setTags((prev) => prev ?? []));
    return () => {
      live = false;
    };
  }, [w.version]);

  useEffect(() => {
    if (!selected) return;
    let live = true;
    api
      .byTag(selected)
      .then((n) => live && setByTag((r) => (r?.tag === selected && same(r.items, n) ? r : { tag: selected, items: n })))
      .catch(() => live && setByTag((r) => (r?.tag === selected ? r : { tag: selected, items: [] })));
    return () => {
      live = false;
    };
  }, [selected, w.version]);

  if (selected)
    return (
      <div>
        <button type="button" onClick={() => w.actions.setSelectedTag(null)} className="mb-2 rounded-md px-2 py-3 text-[13px] text-accent-ink hover:underline lg:py-1">
          All tags
        </button>
        <h3 className="px-2 pb-2 font-medium">
          <span className="rounded bg-mark-soft px-1.5 py-0.5 text-[13px] text-mark-ink" translate="no">
            #{selected}
          </span>
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
                  className="block w-full truncate rounded-md px-2 py-3 text-left transition-colors hover:bg-hover lg:py-1.5"
                  translate="no"
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
            className="flex w-full items-center gap-2 rounded-md px-2 py-3 text-left transition-colors hover:bg-hover lg:py-1.5"
          >
            <span className="min-w-0 flex-1 truncate text-mark-ink" translate="no">
              #{t.tag}
            </span>
            <span className="tabular text-[12px] text-faint">{nf.format(t.count)}</span>
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
  if (!w.activeNote) return <NoteMissing />;
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
              className="block w-full truncate rounded-md py-3 pr-2 text-left transition-colors hover:bg-hover lg:py-1.5"
              style={{ paddingLeft: 8 + (h.level - min) * 16 }}
            >
              {h.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
