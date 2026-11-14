/*
 * <nexus-query>: the live results of a ```query block, in the reading view and in Live Preview.
 *
 * The renderer (src/lib/markdown/render.ts, via src/lib/query/markup.ts) wraps each ```query code
 * block in this element; Live Preview (./live-preview.ts) creates one as a block widget. The element
 * reads its source from the code block inside it (or the `source` property), runs it through
 * POST /api/query, and draws a list, a table or tasks with the reading view's own markup, so the
 * note's styles apply. Until it is defined (on a public share page it never is) the code block
 * simply shows.
 *
 * Links are ordinary `wikilink:` anchors: the reading view opens them like any other link. In Live
 * Preview the widget passes `openLink`, since the editor ignores clicks inside widgets. Task boxes
 * toggle the task in its own note (client.ts) and never reach the reading view's own task handler,
 * which would edit the note on screen instead.
 */
import type { QueryResult } from "@/lib/query/types";
import { QUERY_REFRESH_EVENT, cachedQuery, runQuery, toggleQueryTask, type QueryOutcome } from "./client";
import { cellLink, describeResult, folderOf, formatCell, taskLabel } from "./format";

export const QUERY_TAG = "nexus-query";
/** How often a block on screen checks for changes made elsewhere (another tab, device or the MCP server). */
const POLL_MS = 30_000;
const NUMBER = /^\s*-?\d+(?:\.\d+)?\s*$/;

type OpenLink = (target: string, newTab: boolean) => void;

export interface QueryElement extends HTMLElement {
  source: string;
  openLink: OpenLink | null;
  /** Live Preview: put the caret in the block so its source shows. */
  onEdit: (() => void) | null;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function noteLink(path: string, label: string, className?: string) {
  const a = el("a", className, label);
  a.href = `wikilink:${encodeURIComponent(path)}`;
  return a;
}

function folderTag(path: string) {
  const folder = folderOf(path);
  return folder ? el("span", "query-folder", folder) : null;
}

function drawResult(r: QueryResult, readOnly: boolean): HTMLElement {
  if (r.kind === "list") {
    const ul = el("ul", "query-list");
    for (const row of r.rows) {
      const li = el("li");
      li.append(noteLink(row.path, row.name));
      const f = folderTag(row.path);
      if (f) li.append(" ", f);
      ul.append(li);
    }
    return ul;
  }
  if (r.kind === "table") {
    const wrap = el("div", "query-table");
    // A scrolling region is a tab stop, so keyboard users can scroll a wide table too.
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "Query results");
    const table = el("table");
    // A column of numbers (frontmatter keeps them as text) lines up on the right, header included.
    const numeric = r.columns.map(
      (_, i) =>
        r.rows.some((row) => row.cells[i] !== null && row.cells[i] !== "") &&
        r.rows.every((row) => {
          const c = row.cells[i];
          return c === null || c === "" || typeof c === "number" || (typeof c === "string" && NUMBER.test(c));
        }),
    );
    const head = el("tr");
    ["Note", ...r.columns].forEach((label, i) => {
      const th = el("th", i > 0 && numeric[i - 1] ? "query-num" : undefined, label);
      th.scope = "col";
      head.append(th);
    });
    table.append(el("thead"));
    table.tHead!.append(head);
    const body = el("tbody");
    for (const row of r.rows) {
      const tr = el("tr");
      const first = el("td");
      first.append(noteLink(row.path, row.name));
      tr.append(first);
      row.cells.forEach((c, i) => {
        const td = el("td", numeric[i] ? "query-num" : undefined);
        const link = cellLink(c);
        if (link) td.append(noteLink(link.target, link.label));
        else td.textContent = formatCell(c);
        tr.append(td);
      });
      body.append(tr);
    }
    table.append(body);
    wrap.append(table);
    return wrap;
  }
  const box = el("div", "query-tasks");
  for (const g of r.groups) {
    const head = el("p", "query-group");
    head.append(noteLink(g.note.path, g.note.name));
    const f = folderTag(g.note.path);
    if (f) head.append(" ", f);
    const ul = el("ul", "contains-task-list");
    for (const t of g.tasks) {
      const li = el("li", t.completed ? "task-list-item query-task-done" : "task-list-item");
      const label = el("label");
      const input = el("input");
      input.type = "checkbox";
      input.checked = t.completed;
      input.disabled = readOnly;
      input.dataset.note = g.note.id;
      input.dataset.offset = String(t.offset);
      input.dataset.text = t.text;
      label.append(input, el("span", undefined, taskLabel(t.text) || "Untitled task"));
      li.append(label);
      ul.append(li);
    }
    box.append(head, ul);
  }
  return box;
}

/** The query's source with the line of the error marked. */
function drawSource(source: string, line: number | null): HTMLElement {
  const pre = el("pre", "query-source");
  const code = el("code");
  source.split("\n").forEach((text, i, all) => {
    const nl = i < all.length - 1 ? "\n" : "";
    if (line === i + 1) code.append(el("span", "query-error-line", text || " "), nl);
    else code.append(text + nl);
  });
  pre.append(code);
  return pre;
}

export function defineQueryElement() {
  if (typeof window === "undefined" || typeof customElements === "undefined" || customElements.get(QUERY_TAG)) return;

  class NexusQuery extends HTMLElement implements QueryElement {
    source = "";
    openLink: OpenLink | null = null;
    onEdit: (() => void) | null = null;
    private ready = false;
    private shown = "";
    private busy = false;
    private timer: ReturnType<typeof setInterval> | null = null;
    private head!: HTMLElement;
    private caption!: HTMLElement;
    private body!: HTMLElement;
    private status!: HTMLElement;

    connectedCallback() {
      if (!this.ready) this.setup();
      window.addEventListener(QUERY_REFRESH_EVENT, this.refresh);
      window.addEventListener("focus", this.refresh);
      document.addEventListener("visibilitychange", this.onVisible);
      this.timer = setInterval(() => document.visibilityState === "visible" && this.refresh(), POLL_MS);
      this.refresh();
    }

    disconnectedCallback() {
      window.removeEventListener(QUERY_REFRESH_EVENT, this.refresh);
      window.removeEventListener("focus", this.refresh);
      document.removeEventListener("visibilitychange", this.onVisible);
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    }

    private setup() {
      this.ready = true;
      if (!this.source) this.source = this.querySelector("pre > code")?.textContent?.replace(/\n$/, "") ?? "";
      this.classList.add("query-block");
      this.head = el("div", "query-head");
      this.caption = el("p", "query-caption", "Running query…");
      this.head.append(this.caption);
      if (this.onEdit) {
        const edit = el("button", "query-edit", "Edit query");
        edit.type = "button";
        edit.addEventListener("click", (e) => {
          e.preventDefault();
          this.onEdit?.();
        });
        this.head.append(edit);
      }
      this.body = el("div", "query-body");
      this.status = el("p", "query-status");
      this.status.setAttribute("role", "status");
      this.replaceChildren(this.head, this.body, this.status);
      this.setAttribute("aria-busy", "true");
      this.addEventListener("click", this.onClick);
      this.addEventListener("auxclick", this.onAuxClick);
      const cached = cachedQuery(this.source);
      if (cached) this.draw(cached);
    }

    private onVisible = () => {
      if (document.visibilityState === "visible") this.refresh();
    };

    refresh = () => {
      if (!this.isConnected) return;
      void runQuery(this.source).then((o) => {
        if (this.isConnected) this.draw(o);
      });
    };

    private draw(o: QueryOutcome) {
      this.removeAttribute("aria-busy");
      const key = JSON.stringify(o.ok ? o.result : o);
      if (key === this.shown) return;
      this.shown = key;
      // Keep keyboard focus on the same task across a redraw.
      const active = document.activeElement;
      const boxes = () => [...this.querySelectorAll<HTMLInputElement>("input[data-note]")];
      const focused =
        active instanceof HTMLInputElement && this.contains(active) ? `${active.dataset.note}\u0000${active.dataset.text}` : null;
      const focusedAt = focused ? boxes().indexOf(active as HTMLInputElement) : -1;
      if (o.ok) {
        this.classList.remove("query-failed");
        this.caption.textContent = describeResult(o.result);
        const readOnly = !!this.closest(".embed-body");
        this.body.replaceChildren(drawResult(o.result, readOnly));
      } else {
        this.classList.add("query-failed");
        this.caption.textContent = "This query couldn’t run";
        const where = o.line ? `Line ${o.line}, column ${o.column}: ` : "";
        const msg = el("p", "query-error", `${where}${o.message}.`.replace(/\.\.$/, "."));
        this.body.replaceChildren(msg, ...(o.line ? [drawSource(this.source, o.line)] : []));
      }
      if (focused) {
        // The same task, or (when a filter dropped it) the task now in its place, or the caption.
        const now = boxes();
        const again = now.find((i) => `${i.dataset.note}\u0000${i.dataset.text}` === focused) ?? now[Math.min(focusedAt, now.length - 1)];
        if (again) again.focus({ preventScroll: true });
        else {
          this.caption.tabIndex = -1;
          this.caption.focus({ preventScroll: true });
        }
      }
    }

    private onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      const box = t.closest<HTMLInputElement>("input[data-note]");
      if (box) {
        // This task lives in another note (or elsewhere in this one): never the reading view's toggle.
        e.stopPropagation();
        void this.toggle(box);
        return;
      }
      const a = t.closest<HTMLAnchorElement>('a[href^="wikilink:"]');
      if (a && this.openLink) {
        e.preventDefault();
        e.stopPropagation();
        this.openLink(decodeURIComponent(a.getAttribute("href")!.slice(9)), e.ctrlKey || e.metaKey);
      }
    };

    private onAuxClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="wikilink:"]');
      if (e.button !== 1 || !a || !this.openLink) return;
      e.preventDefault();
      e.stopPropagation();
      this.openLink(decodeURIComponent(a.getAttribute("href")!.slice(9)), true);
    };

    private sayTimer: ReturnType<typeof setTimeout> | null = null;
    /** A short message under the results, read out by screen readers; confirmations clear themselves. */
    private say(text: string, error: boolean) {
      if (this.sayTimer) clearTimeout(this.sayTimer);
      this.status.classList.toggle("query-status-error", error);
      this.status.textContent = text;
      if (!error) this.sayTimer = setTimeout(() => (this.status.textContent = ""), 4000);
    }

    private async toggle(box: HTMLInputElement) {
      if (this.busy || box.disabled) {
        box.checked = !box.checked;
        return;
      }
      this.busy = true;
      box.setAttribute("aria-busy", "true");
      const done = box.checked;
      try {
        await toggleQueryTask(box.dataset.note!, Number(box.dataset.offset), box.dataset.text ?? "");
        this.say(`Marked “${taskLabel(box.dataset.text ?? "")}” ${done ? "done" : "not done"}`, false);
      } catch (err) {
        box.checked = !box.checked;
        this.say(`Couldn’t update the task. ${err instanceof Error ? err.message : ""}`.trim(), true);
        this.refresh();
      } finally {
        box.removeAttribute("aria-busy");
        this.busy = false;
      }
    }
  }

  customElements.define(QUERY_TAG, NexusQuery);
}
