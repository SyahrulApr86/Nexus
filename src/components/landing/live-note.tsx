"use client";

import { useId, useState } from "react";
import { MiniMarkdown, parse } from "./mini-markdown";

export const EXAMPLES = [
  {
    name: "Meeting note",
    file: "Weekly sync.md",
    text: `## Weekly sync
Launch moves to [[Q4 roadmap|the Q4 plan]].
- [x] Draft the ==release notes==
- [ ] Ask [[Mira Chen]] about the beta
#planning #team`,
  },
  {
    name: "Reading list",
    file: "Reading list.md",
    text: `## Reading list
- [x] *How to Take Smart Notes*
- [ ] [[Zettelkasten]] in practice
Quote: ==notes are thinking tools==
#books/2026`,
  },
  {
    name: "Trip plan",
    file: "Lisbon trip.md",
    text: `## Lisbon, 3 days
Flights are in [[Bookings]].
- [ ] Tram 28 before **9 am**
- [ ] Dinner near [[Alfama]]
#travel`,
  },
] as const;

function lineAt(text: string, pos: number) {
  return text.slice(0, pos).split("\n").length - 1;
}

/**
 * The landing page's one live thing: type markdown and read it back as Nexus shows it, with the
 * caret's line kept as source the way Live Preview does. Without script the textarea still holds
 * the first example and the preview is the server's render of it.
 */
export function LiveNote() {
  const [text, setText] = useState<string>(EXAMPLES[0].text);
  const [file, setFile] = useState<string>(EXAMPLES[0].file);
  const [caret, setCaret] = useState(-1);
  const id = useId();
  const { links, tags } = parse(text);

  const track = (el: HTMLTextAreaElement) => setCaret(lineAt(el.value, el.selectionStart));

  return (
    <div className="ln">
      <div data-ui className="ln-ui">
        <div className="ln-tab">
          <span className="ln-file">{file}</span>
          <span className="ln-mode">Live preview</span>
        </div>
        <div className="ln-panes">
          <div className="ln-pane">
            <label htmlFor={`${id}-src`} className="ln-label">
              Markdown, as you type it
            </label>
            <textarea
              id={`${id}-src`}
              className="ln-src"
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
          <div className="ln-pane ln-pane-out">
            <p className="ln-label" id={`${id}-out-label`}>
              The note, as Nexus shows it
            </p>
            <div className="ln-out" role="group" aria-labelledby={`${id}-out-label`}>
              <MiniMarkdown text={text} caretLine={caret} />
            </div>
          </div>
        </div>
        <div className="ln-meta" aria-live="polite">
          <p>
            <span className="ln-meta-k">Links out</span>{" "}
            {links.length ? links.map((l) => <span key={l} className="mm-link ln-chip">{l}</span>) : <span>none yet</span>}
          </p>
          <p>
            <span className="ln-meta-k">Tags</span>{" "}
            {tags.length ? tags.map((t) => <span key={t} className="mm-tag">{t}</span>) : <span>none yet</span>}
          </p>
        </div>
      </div>
      <div className="ln-examples">
        <p>Try another note:</p>
        {EXAMPLES.map((ex) => (
          <button
            key={ex.name}
            type="button"
            className="ln-example"
            aria-pressed={file === ex.file}
            onClick={() => {
              setText(ex.text);
              setFile(ex.file);
              setCaret(-1);
            }}
          >
            {ex.name}
          </button>
        ))}
      </div>
    </div>
  );
}
