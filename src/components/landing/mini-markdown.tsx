import { Fragment, type ReactNode } from "react";

/**
 * A small, faithful copy of how the Nexus editor shows a note in Live Preview, for the landing page's
 * live example only: headings, [[links]] (with |alias), #tags, **bold**, *italic*, ==highlights==,
 * `code`, tasks, bullets and quotes. It builds React elements, never HTML strings, so nothing typed
 * into the example can inject markup. The line that holds the caret keeps its markdown visible,
 * like the real editor.
 */

const INLINE = /(\[\[[^\]\n]+\]\])|(==[^=\n]+==)|(\*\*[^*\n]+\*\*)|(`[^`\n]+`)|(\*[^*\n]+\*)|((?:^|(?<=\s))#[A-Za-z][\w/-]*)/g;

export type Parsed = { links: string[]; tags: string[] };

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const t = m[0];
    const k = `${key}-${i++}`;
    if (m[1]) {
      const inner = t.slice(2, -2);
      const [target, alias] = inner.split("|");
      out.push(
        <span key={k} className="mm-link" title={alias ? target : undefined}>
          {(alias ?? target).trim()}
        </span>,
      );
    } else if (m[2]) {
      out.push(
        <mark key={k} className="mm-hl">
          {t.slice(2, -2)}
        </mark>,
      );
    } else if (m[3]) {
      out.push(<strong key={k}>{t.slice(2, -2)}</strong>);
    } else if (m[4]) {
      out.push(
        <code key={k} className="mm-code">
          {t.slice(1, -1)}
        </code>,
      );
    } else if (m[5]) {
      out.push(<em key={k}>{t.slice(1, -1)}</em>);
    } else if (m[6]) {
      out.push(
        <span key={k} className="mm-tag">
          {t}
        </span>,
      );
    }
    last = at + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** The source line as typed, with its markdown tokens dimmed (the caret line in Live Preview). */
function sourceLine(line: string, key: string): ReactNode {
  const parts: ReactNode[] = [];
  const re = /(\[\[|\]\]|==|\*\*|`|^#{1,3} |^- \[[ x]\] |^- |^> )/g;
  let last = 0;
  let i = 0;
  for (const m of line.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(line.slice(last, at));
    parts.push(
      <span key={`${key}-t${i++}`} className="mm-syntax">
        {m[0]}
      </span>,
    );
    last = at + m[0].length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return (
    <p key={key} className="mm-line mm-source">
      {parts.length ? parts : " "}
    </p>
  );
}

export function parse(text: string): Parsed {
  const links = new Set<string>();
  const tags = new Set<string>();
  for (const m of text.matchAll(/\[\[([^\]|\n]+)(?:\|[^\]\n]*)?\]\]/g)) links.add(m[1].trim());
  for (const m of text.matchAll(/(?:^|\s)#([A-Za-z][\w/-]*)/g)) tags.add(`#${m[1]}`);
  return { links: [...links], tags: [...tags] };
}

/** Renders `text`; `caretLine` (0-based) stays as source, or -1 for a fully rendered note. */
export function MiniMarkdown({ text, caretLine }: { text: string; caretLine: number }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  lines.forEach((line, n) => {
    const key = `l${n}`;
    if (n === caretLine) {
      blocks.push(sourceLine(line, key));
      return;
    }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,3}) (.*)$/))) {
      // Set as a heading but kept out of the page outline: the example is a picture of a note.
      blocks.push(
        <p key={key} className={`mm-line mm-h${m[1].length}`}>
          {inline(m[2], key)}
        </p>,
      );
    } else if ((m = line.match(/^- \[([ x])\] (.*)$/))) {
      const done = m[1] === "x";
      blocks.push(
        <p key={key} className={done ? "mm-line mm-task mm-done" : "mm-line mm-task"}>
          <span className="mm-box" role="img" aria-label={done ? "Done" : "Not done"} />
          <span>{inline(m[2], key)}</span>
        </p>,
      );
    } else if ((m = line.match(/^- (.*)$/))) {
      blocks.push(
        <p key={key} className="mm-line mm-bullet">
          <span className="mm-dot" aria-hidden="true" />
          <span>{inline(m[1], key)}</span>
        </p>,
      );
    } else if ((m = line.match(/^> (.*)$/))) {
      blocks.push(
        <p key={key} className="mm-line mm-quote">
          {inline(m[1], key)}
        </p>,
      );
    } else if (line.trim() === "") {
      blocks.push(<p key={key} className="mm-line mm-blank" aria-hidden="true" />);
    } else {
      blocks.push(
        <p key={key} className="mm-line">
          {inline(line, key)}
        </p>,
      );
    }
  });
  return <Fragment>{blocks}</Fragment>;
}
