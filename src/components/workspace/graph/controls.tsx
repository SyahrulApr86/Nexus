"use client";

import { useId, useRef, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { IconButton } from "../ui";
import {
  DEFAULT_SETTINGS,
  GROUP_COLORS,
  GROUP_COLOR_NAMES,
  MAX_GROUPS,
  RANGES,
  type GraphSettings,
  type GroupColor,
  type LabelMode,
} from "./model";

/*
 * The graph's settings panel: filters, groups, display and forces, after Obsidian's. It floats
 * over the top right of the graph (full width on a phone) and is not modal: the graph stays live
 * behind it, so every change shows at once. Escape closes it and returns focus to its button.
 */

type Patch = (p: Partial<GraphSettings>) => void;

const CHECK = "size-4 shrink-0 accent-[var(--accent)]";
const SELECT =
  "h-8 min-w-0 rounded-md border border-control bg-sheet px-2 text-[16px] text-fg md:text-[13px] pointer-coarse:h-11";
const TEXT_BUTTON = "rounded-sm text-[13px] font-medium text-accent-ink hover:underline disabled:pointer-events-none disabled:opacity-50";

export function GraphControls({
  id,
  settings: s,
  patch,
  facets,
  onClose,
}: {
  id: string;
  settings: GraphSettings;
  patch: Patch;
  facets: { tags: string[]; folders: string[] };
  onClose: () => void;
}) {
  const uid = useId();
  const groupsRef = useRef<HTMLUListElement>(null);
  const addGroup = () => {
    const used = new Set(s.groups.map((g) => g.color));
    const color = GROUP_COLORS.find((c) => !used.has(c)) ?? GROUP_COLORS[s.groups.length % GROUP_COLORS.length];
    patch({ groups: [...s.groups, { id: `g${Date.now().toString(36)}`, query: "", color }] });
    // Focus the new group's query once it is drawn.
    requestAnimationFrame(() => groupsRef.current?.querySelector<HTMLInputElement>("li:last-child input")?.focus());
  };
  const setGroup = (gid: string, p: Partial<GraphSettings["groups"][number]>) =>
    patch({ groups: s.groups.map((g) => (g.id === gid ? { ...g, ...p } : g)) });

  return (
    <section
      id={id}
      aria-labelledby={`${uid}-title`}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      className="graph-panel float-panel absolute inset-x-2 top-2 z-10 flex max-h-[calc(100%-16px)] flex-col overflow-hidden sm:left-auto sm:w-[320px]"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border pl-4 pr-1.5">
        <h2 id={`${uid}-title`} className="text-[13px] font-semibold">
          Graph settings
        </h2>
        <button
          type="button"
          className={`${TEXT_BUTTON} ml-auto px-1`}
          onClick={() => patch({ ...DEFAULT_SETTINGS, scope: s.scope, search: s.search })}
        >
          Reset
        </button>
        <IconButton label="Close graph settings" onClick={onClose}>
          <X />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain pb-2">
        <Section title="Filters">
          {s.scope === "local" && (
            <Slider
              label="Depth"
              value={s.depth}
              min={1}
              max={3}
              step={1}
              format={(v) => (v === 1 ? "1 link away" : `${v} links away`)}
              onChange={(v) => patch({ depth: v === 3 ? 3 : v === 2 ? 2 : 1 })}
            />
          )}
          <Picker kind="tag" label="Tags" all={facets.tags} chosen={s.tags} onChange={(tags) => patch({ tags })} />
          <Picker kind="folder" label="Folders" all={facets.folders} chosen={s.folders} onChange={(folders) => patch({ folders })} />
          <div className="space-y-1">
            <Check label="Existing notes only" hint="Hide links to notes that are not created yet." checked={s.existingOnly} onChange={(v) => patch({ existingOnly: v })} />
            <Check label="Show attachments" hint="Images, PDFs and other files a note embeds." checked={s.showAttachments} onChange={(v) => patch({ showAttachments: v })} />
            <Check label="Show orphans" hint="Notes with no links in or out." checked={s.showOrphans} onChange={(v) => patch({ showOrphans: v })} />
          </div>
        </Section>
        <Section title="Groups">
          <p id={`${uid}-gh`} className="text-[12px] leading-4 text-faint">
            Colour the notes a query matches: words, <span translate="no">#tag</span> or <span translate="no">path:Folder</span>. The first
            matching group wins.
          </p>
          {s.groups.length > 0 && (
            <ul ref={groupsRef} className="space-y-2">
              {s.groups.map((g, i) => (
                <li key={g.id} className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ background: `var(--canvas-${g.color})` }} />
                  <label className="sr-only" htmlFor={`${uid}-gc-${g.id}`}>
                    Colour of group {i + 1}
                  </label>
                  <select
                    id={`${uid}-gc-${g.id}`}
                    value={g.color}
                    onChange={(e) => setGroup(g.id, { color: Number(e.target.value) as GroupColor })}
                    className={`${SELECT} w-[88px] shrink-0`}
                  >
                    {GROUP_COLORS.map((c) => (
                      <option key={c} value={c}>
                        {GROUP_COLOR_NAMES[c]}
                      </option>
                    ))}
                  </select>
                  <label className="sr-only" htmlFor={`${uid}-gq-${g.id}`}>
                    Query of group {i + 1}
                  </label>
                  <input
                    id={`${uid}-gq-${g.id}`}
                    value={g.query}
                    aria-describedby={`${uid}-gh`}
                    onChange={(e) => setGroup(g.id, { query: e.target.value })}
                    placeholder="#tag or path:Folder"
                    autoComplete="off"
                    spellCheck={false}
                    className="h-8 min-w-0 flex-1 rounded-md border border-control bg-sheet px-2 text-[16px] placeholder:text-faint md:text-[13px] pointer-coarse:h-11"
                  />
                  <IconButton label={`Remove group ${i + 1}`} onClick={() => patch({ groups: s.groups.filter((x) => x.id !== g.id) })}>
                    <X />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={addGroup} disabled={s.groups.length >= MAX_GROUPS} className={`${TEXT_BUTTON} inline-flex items-center gap-1`}>
            <Plus aria-hidden="true" className="size-4 stroke-[1.5]" />
            New group
          </button>
        </Section>
        <Section title="Display">
          <Check label="Size nodes by links" checked={s.sizeByLinks} onChange={(v) => patch({ sizeByLinks: v })} />
          <Slider label="Link thickness" value={s.linkWidth} {...RANGES.linkWidth} format={(v) => `${v} px`} onChange={(v) => patch({ linkWidth: v })} />
          <Choice<LabelMode>
            label="Labels"
            value={s.labels}
            options={[
              ["always", "Always"],
              ["zoom", "Zoomed in"],
              ["hover", "On hover"],
            ]}
            onChange={(labels) => patch({ labels })}
          />
        </Section>
        <Section title="Forces">
          <Slider label="Centre force" value={s.centre} {...RANGES.centre} format={(v) => v.toFixed(2)} onChange={(v) => patch({ centre: v })} />
          <Slider label="Repel force" value={s.repel} {...RANGES.repel} format={(v) => String(v)} onChange={(v) => patch({ repel: v })} />
          <Slider label="Link distance" value={s.linkDistance} {...RANGES.linkDistance} format={(v) => `${v} px`} onChange={(v) => patch({ linkDistance: v })} />
        </Section>
      </div>
    </section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details open className="graph-section group border-b border-rule last:border-b-0">
      <summary className="flex h-10 cursor-pointer list-none items-center justify-between px-4 text-[13px] font-medium text-fg outline-offset-[-2px] hover:bg-hover pointer-coarse:h-11 [&::-webkit-details-marker]:hidden">
        {title}
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 fill-none stroke-current stroke-[1.5] text-faint transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </summary>
      <div className="space-y-4 px-4 pb-4 pt-1">{children}</div>
    </details>
  );
}

function Check({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-8 cursor-pointer items-start gap-2.5 py-1 text-[13px] pointer-coarse:min-h-11">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className={`${CHECK} mt-0.5`} />
      <span className="leading-5">
        {label}
        {hint && <span className="block text-[12px] leading-4 text-faint">{hint}</span>}
      </span>
    </label>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const id = useId();
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[13px]">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id} className="text-[12px] text-muted tabular">
          {format(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={format(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="graph-range mt-1.5 w-full"
      />
    </div>
  );
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  const name = useId();
  return (
    <fieldset>
      <legend className="text-[13px]">{label}</legend>
      <div className="mt-1.5 grid grid-flow-col auto-cols-fr rounded-md border border-control p-0.5">
        {options.map(([v, text]) => (
          <label
            key={v}
            className="grid h-7 cursor-pointer place-items-center rounded-[4px] px-2 text-[12px] font-medium text-muted transition-colors hover:text-fg has-checked:bg-active has-checked:text-fg has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-[var(--focus)] pointer-coarse:h-10"
          >
            <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} className="sr-only" />
            {text}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Choose tags or folders: a select adds one, each chosen one is a chip with its own remove button. */
function Picker({
  kind,
  label,
  all,
  chosen,
  onChange,
}: {
  kind: "tag" | "folder";
  label: string;
  all: string[];
  chosen: string[];
  onChange: (v: string[]) => void;
}) {
  const id = useId();
  const left = all.filter((x) => !chosen.includes(x));
  const chipsRef = useRef<HTMLUListElement>(null);
  return (
    <div>
      <label htmlFor={id} className="text-[13px]">
        {label}
      </label>
      {chosen.length > 0 && (
        <ul ref={chipsRef} aria-label={`Chosen ${label.toLowerCase()}`} className="mt-1.5 flex flex-wrap gap-1.5">
          {chosen.map((x, i) => (
            <li
              key={x}
              className={`inline-flex h-6 max-w-full items-center gap-0.5 rounded-[2px] pl-1.5 text-[12px] font-medium ${
                kind === "tag" ? "bg-mark-soft text-mark-ink" : "border border-border bg-hover text-fg"
              }`}
            >
              <span className="truncate" translate="no">
                {kind === "tag" ? `#${x}` : x}
              </span>
              <button
                type="button"
                aria-label={`Remove ${kind} ${x}`}
                onClick={() => {
                  onChange(chosen.filter((c) => c !== x));
                  // Keep focus in the list: the next chip's button, the previous one, or the select.
                  requestAnimationFrame(() => {
                    const btns = chipsRef.current?.querySelectorAll<HTMLButtonElement>("button");
                    const next = btns?.[Math.min(i, (btns?.length ?? 1) - 1)];
                    (next ?? document.getElementById(id))?.focus();
                  });
                }}
                className="grid size-6 place-items-center rounded-[2px] opacity-80 hover:opacity-100"
              >
                <X aria-hidden="true" className="size-3.5 stroke-[1.5]" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <select
        id={id}
        value=""
        disabled={!left.length}
        onChange={(e) => e.target.value && onChange([...chosen, e.target.value])}
        className={`${SELECT} mt-1.5 w-full disabled:opacity-60`}
      >
        <option value="">{all.length === 0 ? `No ${label.toLowerCase()} in this vault` : chosen.length ? `Add another ${kind}…` : `All ${label.toLowerCase()}`}</option>
        {left.map((x) => (
          <option key={x} value={x}>
            {kind === "tag" ? `#${x}` : x}
          </option>
        ))}
      </select>
    </div>
  );
}
