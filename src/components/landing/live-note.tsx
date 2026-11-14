"use client";

import { useId, useState } from "react";
import { VaultAtlas } from "./atlas";
import { Icon } from "./icons";
import { MiniMarkdown, parse } from "./mini-markdown";

export const EXAMPLES = [
  {
    name: "Weekly sync",
    folder: "Meetings",
    text: `## Weekly sync
Launch moves to [[Q4 roadmap|the Q4 plan]].
- [x] Draft the ==release notes==
- [ ] Ask [[Mira Chen]] about the beta
#planning #team`,
  },
  {
    name: "Reading list",
    folder: "Personal",
    text: `## Reading list
- [x] *How to Take Smart Notes*
- [ ] [[Zettelkasten]] in practice
Quote: ==notes are thinking tools==
#books/2026`,
  },
  {
    name: "Lisbon trip",
    folder: "Personal",
    text: `## Lisbon, 3 days
Flights are in [[Bookings]].
- [ ] Tram 28 before **9 am**
- [ ] Dinner near [[Alfama]]
#travel`,
  },
] as const;

const TREE = [
  { dir: "Daily notes", files: ["2026-11-13"] },
  { dir: "Meetings", files: ["Design review", "Weekly sync"] },
  { dir: "Personal", files: ["Lisbon trip", "Reading list"] },
  { dir: "Projects", files: ["Project kickoff", "Q4 roadmap"] },
] as const;

const MENTIONS = [
  { note: "Q4 roadmap", line: "Agenda lives in Weekly sync." },
  { note: "2026-11-13", line: "Notes from Weekly sync, see tasks." },
] as const;

function lineAt(text: string, pos: number) {
  return text.slice(0, pos).split("\n").length - 1;
}

function words(text: string) {
  return text
    .replace(/[#*=\[\]|`>-]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * The landing page's one live thing, set inside a crop of the workspace: type markdown on the left and
 * read the note on the right as Nexus shows it, with the caret's line kept as source the way Live
 * Preview does. The tabs load other example notes. Without script the textarea still holds the first
 * example and the preview is the server's render of it.
 */
export function LiveNote() {
  const [text, setText] = useState<string>(EXAMPLES[0].text);
  const [open, setOpen] = useState(0);
  const [caret, setCaret] = useState(-1);
  const id = useId();
  const { links, tags } = parse(text);
  const note = EXAMPLES[open];

  const track = (el: HTMLTextAreaElement) => setCaret(lineAt(el.value, el.selectionStart));

  return (
    <figure data-ui className="aw" aria-labelledby={`${id}-cap`}>
      <figcaption id={`${id}-cap`} className="sr-only">
        The Nexus workspace with an example note you can edit
      </figcaption>
      <div className="aw-top">
        <div className="aw-brand" aria-hidden="true">
          <span className="aw-brand-b">[[</span>N<span className="aw-brand-b">]]</span>
        </div>
        <div className="aw-tabs" role="group" aria-label="Example notes">
          {EXAMPLES.map((ex, i) => (
            <button
              key={ex.name}
              type="button"
              className="aw-tab"
              aria-pressed={open === i}
              onClick={() => {
                setOpen(i);
                setText(ex.text);
                setCaret(-1);
              }}
            >
              <Icon name="file" size={14} />
              {ex.name}
            </button>
          ))}
        </div>
        <div className="aw-presence" aria-hidden="true">
          <span className="aw-avatar aw-avatar-you">Y</span>
          <span className="aw-avatar aw-avatar-mira">M</span>
        </div>
      </div>

      <div className="aw-body">
        <div className="aw-rail" aria-hidden="true">
          <span className="aw-rail-on">
            <Icon name="files" />
          </span>
          <span>
            <Icon name="search" />
          </span>
          <span>
            <Icon name="graph" />
          </span>
          <span>
            <Icon name="canvas" />
          </span>
          <span className="aw-rail-end">
            <Icon name="settings" />
          </span>
        </div>

        <div className="aw-side" aria-hidden="true">
          <p className="aw-vault">
            Work vault <Icon name="chevron" size={12} className="aw-vault-chev" />
          </p>
          <p className="aw-find">
            <Icon name="search" size={14} />
            Search
            <kbd>Ctrl K</kbd>
          </p>
          <ul className="aw-tree">
            {TREE.map((d) => (
              <li key={d.dir}>
                <span className="aw-dir">
                  <Icon name="folder" size={14} />
                  {d.dir}
                </span>
                <ul>
                  {d.files.map((f) => (
                    <li key={f} className={f === note.name ? "aw-file aw-file-on" : "aw-file"}>
                      {f}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <p className="aw-side-k">Tags</p>
          <p className="aw-tags">
            <span>#planning</span> <b>12</b>
            <br />
            <span>#team</span> <b>8</b>
            <br />
            <span>#research</span> <b>5</b>
          </p>
        </div>

        <div className="aw-editor">
          <p className="aw-crumbs" aria-hidden="true">
            {note.folder} <Icon name="chevron" size={12} /> <span>{note.name}</span>
          </p>
          <div className="aw-split">
            <div className="aw-src">
              <label htmlFor={`${id}-src`} className="aw-pane-k">
                Type markdown here
              </label>
              <textarea
                id={`${id}-src`}
                className="aw-textarea"
                value={text}
                spellCheck={false}
                rows={7}
                maxLength={600}
                onChange={(e) => {
                  setText(e.target.value);
                  track(e.target);
                }}
                onSelect={(e) => track(e.currentTarget)}
                onFocus={(e) => track(e.currentTarget)}
                onBlur={() => setCaret(-1)}
              />
            </div>
            <div className="aw-out">
              <p className="aw-pane-k" id={`${id}-out`}>
                Live preview
              </p>
              <div className="aw-note" role="group" aria-labelledby={`${id}-out`}>
                <MiniMarkdown text={text} caretLine={caret} />
              </div>
            </div>
          </div>
        </div>

        <div className="aw-pane" aria-hidden="true">
          <p className="aw-pane-h">
            Linked mentions <b>{MENTIONS.length}</b>
          </p>
          <ul className="aw-mentions">
            {MENTIONS.map((m) => (
              <li key={m.note}>
                <span className="aw-m-note">{m.note}</span>
                <span className="aw-m-line">{m.line}</span>
              </li>
            ))}
          </ul>
          <p className="aw-pane-h">Local graph</p>
          <VaultAtlas width={240} height={170} count={16} seed={9} labels={false} decorative className="aw-graph" />
        </div>
      </div>

      <div className="aw-status">
        <span className="aw-status-live">
          <span className="aw-dot" aria-hidden="true" />
          Saved
        </span>
        <span>{words(text)} words</span>
        <span>
          {links.length} {links.length === 1 ? "link" : "links"} out
        </span>
        <span className="aw-status-tags">
          {tags.length ? tags.map((t) => <span key={t} className="mm-tag">{t}</span>) : "No tags yet"}
        </span>
      </div>
    </figure>
  );
}
