"use client";

/**
 * Properties: a note's YAML frontmatter as a form at the top of the note, as in Obsidian.
 * Every change rewrites only the frontmatter lines it touches and goes through the normal
 * save path (the editor in editing view, the note text in reading view). YAML the minimal
 * parser cannot round-trip is shown read-only, with a way to edit it as source.
 */

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AlignLeft, Binary, Calendar, ChevronRight, Clock, List, Plus, SquareCheck, X } from "lucide-react";
import {
  PROP_TYPES,
  convertValue,
  diffText,
  frontmatterSource,
  keyProblem,
  readProperties,
  removeProperty,
  renameProperty,
  setProperty,
  type PropType,
  type PropValue,
  type Property,
} from "@/lib/markdown/frontmatter-edit";
import { shallowEqual, useWorkspaceActions, useWorkspaceSelector, type NoteMode } from "./store";
import { IconButton, Menu, useMenu } from "./ui";
import { clearAddProperty, setTemplatePrefs, useRequests, useTemplatePrefs } from "./templates-settings";

const TYPES: Record<PropType, { label: string; Icon: typeof AlignLeft }> = {
  text: { label: "Text", Icon: AlignLeft },
  list: { label: "List", Icon: List },
  number: { label: "Number", Icon: Binary },
  checkbox: { label: "Checkbox", Icon: SquareCheck },
  date: { label: "Date", Icon: Calendar },
  datetime: { label: "Date and time", Icon: Clock },
};

const LIST_KEYS = new Set(["tags", "aliases", "cssclasses"]);

/** Focus an element once it exists (checked each frame, for a few frames). */
function focusSoon(find: () => HTMLElement | null | undefined, tries = 10) {
  requestAnimationFrame(() => {
    const el = find();
    if (el?.isConnected) el.focus();
    else if (tries > 0) focusSoon(find, tries - 1);
  });
}

const rowSelector = (key: string) => `[data-prop-key="${CSS.escape(key)}"]`;

export function Properties({ id, gi, mode }: { id: string; gi: number; mode: NoteMode }) {
  const actions = useWorkspaceActions();
  const prefs = useTemplatePrefs();
  const stored = useWorkspaceSelector((s) => frontmatterSource(s.notes[id]?.content ?? ""));
  const { handle, liveContent } = useWorkspaceSelector((s) => ({ handle: s.editorFor(gi), liveContent: s.liveContent }), shallowEqual);
  // Edits show at once; the note text published to the workspace catches up within a few hundred ms.
  const [optimistic, setOptimistic] = useState<{ base: string; text: string } | null>(null);
  const source = optimistic && optimistic.base === stored ? optimistic.text : stored;
  const types = prefs.propertyTypes;
  const { exists, editable, properties } = useMemo(() => readProperties(source, types), [source, types]);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const headId = useId();
  const bodyId = useId();
  const collapsed = prefs.propertiesCollapsed;

  // "Add file property" from the command palette.
  const req = useRequests().addProperty;
  const [seenReq, setSeenReq] = useState<number | null>(null);
  if (req && req.id === id && req.seq !== seenReq) {
    setSeenReq(req.seq);
    setAdding(true);
  }
  useEffect(() => {
    if (!req || req.id !== id) return;
    clearAddProperty();
    setTemplatePrefs({ propertiesCollapsed: false });
  }, [req, id]);

  if (!exists && !adding) return null;

  const keys = properties.map((p) => p.key);

  /** Rewrite the note text; returns false when nothing changed. */
  const commit = (edit: (md: string) => string, said: string) => {
    const cur = liveContent(id);
    const next = edit(cur);
    if (next === cur) return false;
    const h = handle.current;
    if (mode === "edit" && h) h.apply(diffText(cur, next));
    else actions.onChange(id, next);
    setOptimistic({ base: stored, text: frontmatterSource(next) });
    setMessage(said);
    return true;
  };

  const setValue = (p: Property, value: PropValue, type = p.type, said = `${p.key} updated`) =>
    commit((md) => setProperty(md, p.key, value, type), said);

  const changeType = (p: Property, type: PropType) => {
    setTemplatePrefs((x) => ({ propertyTypes: { ...x.propertyTypes, [p.key]: type } }));
    setValue(p, convertValue(p.value, type), type, `${p.key} is now a ${TYPES[type].label.toLowerCase()} property`);
  };

  const remove = (p: Property) => {
    const i = keys.indexOf(p.key);
    if (!commit((md) => removeProperty(md, p.key), `${p.key} removed`)) return;
    const next = keys[i + 1] ?? keys[i - 1];
    focusSoon(() =>
      next
        ? root.current?.querySelector<HTMLElement>(`${rowSelector(next)} [data-role="key"]`)
        : root.current?.querySelector<HTMLElement>("[data-role='add']"),
    );
  };

  const rename = (p: Property, to: string) => commit((md) => renameProperty(md, p.key, to), `${p.key} renamed to ${to}`);

  const add = (key: string) => {
    const k = key.trim();
    const type = types[k] ?? (LIST_KEYS.has(k.toLowerCase()) ? "list" : "text");
    commit((md) => setProperty(md, k, type === "list" ? [] : null, type), `${k} added`);
    setAdding(false);
    focusSoon(() => root.current?.querySelector<HTMLElement>(`${rowSelector(k)} [data-role="value"]`));
  };

  const editAsSource = () => {
    setTemplatePrefs({ showProperties: "source" });
    actions.focusGroup(gi);
    actions.setMode("edit");
    actions.notify("Frontmatter now shows as YAML in the editor.", { label: "Settings", run: () => actions.setSettingsOpen("general") });
  };

  const readOnly = properties.some((p) => !p.editable);

  return (
    <div ref={root} role="group" aria-labelledby={headId} className="props">
      <button
        id={headId}
        type="button"
        aria-expanded={!collapsed}
        aria-controls={bodyId}
        onClick={() => setTemplatePrefs((x) => ({ propertiesCollapsed: !x.propertiesCollapsed }))}
        className="props-head"
      >
        <ChevronRight aria-hidden="true" className="props-chevron" />
        Properties
        {collapsed && properties.length > 0 && <span className="props-count">{properties.length}</span>}
      </button>
      <div id={bodyId} hidden={collapsed}>
        {properties.length > 0 && (
          <ul className="props-list" aria-label="Properties">
            {properties.map((p) => (
              <PropertyRow
                key={p.key}
                p={p}
                keys={keys}
                onRename={(to) => rename(p, to)}
                onValue={(v) => setValue(p, v)}
                onType={(t) => changeType(p, t)}
                onRemove={() => remove(p)}
                onOpenTag={actions.openTag}
              />
            ))}
          </ul>
        )}
        {adding && (
          <NewPropertyRow
            keys={keys}
            onAdd={add}
            onCancel={() => {
              setAdding(false);
              focusSoon(() => root.current?.querySelector<HTMLElement>("[data-role='add']"));
            }}
          />
        )}
        {(!editable || readOnly) && (
          <p className="props-note">
            {editable ? "Some values use YAML this form can’t change safely." : "This frontmatter uses YAML this form can’t change safely."}{" "}
            <button type="button" className="props-link" onClick={editAsSource}>
              Edit as source
            </button>
          </p>
        )}
        {editable && !adding && (
          <button type="button" data-role="add" className="props-add" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            Add property
          </button>
        )}
      </div>
      <p role="status" className="sr-only">
        {message}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

function Row({ propKey, children }: { propKey?: string; children: ReactNode }) {
  return (
    <li className="props-row" data-prop-key={propKey}>
      {children}
    </li>
  );
}

function TypeButton({ p, onType }: { p: Property; onType: (t: PropType) => void }) {
  const menu = useMenu();
  const { label, Icon } = TYPES[p.type];
  return (
    <>
      <IconButton
        label={`${label} property. Change type`}
        aria-haspopup="menu"
        aria-expanded={!!menu.anchor}
        disabled={!p.editable}
        className="props-type"
        onClick={(e) => menu.openBelow(e.currentTarget)}
      >
        <Icon />
      </IconButton>
      {menu.anchor && (
        <Menu
          anchor={menu.anchor}
          label={`Type of ${p.key}`}
          items={PROP_TYPES.map((t) => ({ label: TYPES[t].label, checked: t === p.type, onSelect: () => t !== p.type && onType(t) }))}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** The key as an editable name: Enter or leaving the field renames, Escape puts it back. */
function KeyInput({ value, keys, onCommit, autoFocus }: { value: string; keys: string[]; onCommit: (k: string) => boolean | void; autoFocus?: boolean }) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setDraft(value);
  }
  const errId = useId();
  const others = keys.filter((k) => k !== value);
  const tryCommit = (keepOnError: boolean) => {
    const k = draft.trim();
    if (k === value) return setError(null);
    const problem = keyProblem(k, others);
    if (problem) {
      if (keepOnError) setError(problem);
      else {
        setDraft(value);
        setError(null);
      }
      return;
    }
    setError(null);
    onCommit(k);
  };
  return (
    <span className="props-key-wrap">
      <input
        data-role="key"
        autoFocus={autoFocus}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (error) setError(null);
        }}
        onBlur={() => tryCommit(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            tryCommit(true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setDraft(value);
            setError(null);
          }
        }}
        aria-label="Property name"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        spellCheck={false}
        autoComplete="off"
        className="props-key"
      />
      {error && (
        <span id={errId} className="props-error">
          {error}
        </span>
      )}
    </span>
  );
}

function PropertyRow({
  p,
  keys,
  onRename,
  onValue,
  onType,
  onRemove,
  onOpenTag,
}: {
  p: Property;
  keys: string[];
  onRename: (to: string) => void;
  onValue: (v: PropValue) => void;
  onType: (t: PropType) => void;
  onRemove: () => void;
  onOpenTag: (tag: string) => void;
}) {
  if (!p.editable) {
    return (
      <Row propKey={p.key}>
        <span className="props-key-cell">
          <span className="props-type-static" aria-hidden="true">
            <AlignLeft />
          </span>
          <span className="props-key props-key-static">{p.key}</span>
        </span>
        <span className="props-value-cell">
          <code className="props-raw" aria-label={`${p.key}, read-only YAML`}>
            {p.raw.slice(p.raw.indexOf(":") + 1).trim() || p.raw}
          </code>
        </span>
      </Row>
    );
  }
  return (
    <Row propKey={p.key}>
      <span className="props-key-cell">
        <TypeButton p={p} onType={onType} />
        <KeyInput value={p.key} keys={keys} onCommit={onRename} />
      </span>
      <span className="props-value-cell">
        <ValueInput p={p} onValue={onValue} onOpenTag={onOpenTag} />
      </span>
      <IconButton label={`Remove ${p.key}`} className="props-remove" onClick={onRemove}>
        <X />
      </IconButton>
    </Row>
  );
}

function NewPropertyRow({ keys, onAdd, onCancel }: { keys: string[]; onAdd: (k: string) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const errId = useId();
  const input = useRef<HTMLInputElement>(null);
  // Opened from the command palette, the closing dialog hands focus back to the editor after
  // autoFocus ran; take it again on the next frame.
  useEffect(() => focusSoon(() => input.current), []);
  const done = (keepOnError: boolean) => {
    if (!draft.trim()) return onCancel();
    const problem = keyProblem(draft, keys);
    if (problem) {
      if (keepOnError) setError(problem);
      else onCancel();
      return;
    }
    onAdd(draft);
  };
  return (
    <div className="props-row props-new">
      <span className="props-key-cell">
        <span className="props-type-static" aria-hidden="true">
          <Plus />
        </span>
        <span className="props-key-wrap">
          <input
            ref={input}
            // A new row exists to be typed into.
            autoFocus
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError(null);
            }}
            onBlur={() => done(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                done(true);
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onCancel();
              }
            }}
            placeholder="Property name"
            aria-label="New property name"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errId : undefined}
            spellCheck={false}
            autoComplete="off"
            className="props-key props-key-new"
          />
          {error && (
            <span id={errId} className="props-error">
              {error}
            </span>
          )}
        </span>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Values                                                              */
/* ------------------------------------------------------------------ */

/** A text field that writes on Enter or when focus leaves, and puts the value back on Escape. */
function TextField({
  value,
  label,
  onCommit,
  inputMode,
  type = "text",
}: {
  value: string;
  label: string;
  onCommit: (v: string) => void;
  inputMode?: "decimal";
  type?: "text" | "number";
}) {
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setDraft(value);
  }
  const commit = () => draft !== value && onCommit(draft);
  return (
    <input
      data-role="value"
      type={type}
      step={type === "number" ? "any" : undefined}
      inputMode={inputMode}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape" && draft !== value) {
          e.preventDefault();
          e.stopPropagation();
          setDraft(value);
        }
      }}
      aria-label={label}
      placeholder="Empty"
      autoComplete="off"
      className="props-input"
    />
  );
}

function ValueInput({ p, onValue, onOpenTag }: { p: Property; onValue: (v: PropValue) => void; onOpenTag: (tag: string) => void }) {
  const v = p.value;
  switch (p.type) {
    case "list":
      return <ListField items={Array.isArray(v) ? v : []} label={p.key} tags={p.key.toLowerCase() === "tags"} onChange={onValue} onOpenTag={onOpenTag} />;
    case "checkbox":
      return (
        <input
          data-role="value"
          type="checkbox"
          checked={v === true}
          onChange={(e) => onValue(e.target.checked)}
          aria-label={p.key}
          className="props-check"
        />
      );
    case "number":
      return (
        <TextField
          type="number"
          inputMode="decimal"
          value={typeof v === "number" ? String(v) : ""}
          label={p.key}
          onCommit={(s) => {
            const n = Number(s);
            if (!s.trim()) onValue(null);
            else if (Number.isFinite(n)) onValue(n);
          }}
        />
      );
    case "date":
    case "datetime":
      return (
        <input
          data-role="value"
          type={p.type === "date" ? "date" : "datetime-local"}
          value={typeof v === "string" ? v : ""}
          onChange={(e) => onValue(e.target.value || null)}
          aria-label={p.key}
          className="props-input props-date"
        />
      );
    default:
      return <TextField value={v === null ? "" : String(v)} label={p.key} onCommit={(s) => onValue(s === "" ? null : s)} />;
  }
}

/** Chips with a field to add more. Enter or a comma adds; Backspace in the empty field removes the last chip. */
function ListField({
  items,
  label,
  tags,
  onChange,
  onOpenTag,
}: {
  items: string[];
  label: string;
  tags: boolean;
  onChange: (items: string[]) => void;
  onOpenTag: (tag: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const clean = (s: string) => (tags ? s.trim().replace(/^#+/, "") : s.trim());
  const addDraft = () => {
    const parts = draft.split(",").map(clean).filter(Boolean);
    setDraft("");
    const fresh = parts.filter((x, i) => !items.includes(x) && parts.indexOf(x) === i);
    if (fresh.length) onChange([...items, ...fresh]);
  };
  const removeAt = (i: number) => {
    onChange(items.filter((_, k) => k !== i));
    input.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addDraft();
    } else if (e.key === "Backspace" && !draft && items.length) {
      e.preventDefault();
      removeAt(items.length - 1);
    }
  };
  return (
    <div className="props-chips">
      {items.length > 0 && (
        <ul className="props-chip-list" aria-label={`${label} values`}>
          {items.map((it, i) => (
            <li key={`${it}-${i}`} className={tags ? "props-chip props-chip-tag" : "props-chip"}>
              {tags ? (
                <button type="button" className="props-chip-text" onClick={() => onOpenTag(it)} aria-label={`Show notes tagged ${it}`}>
                  {it}
                </button>
              ) : (
                <span className="props-chip-text">{it}</span>
              )}
              <button type="button" className="props-chip-x" aria-label={`Remove ${it}`} onClick={() => removeAt(i)}>
                <X aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={input}
        data-role="value"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={addDraft}
        aria-label={`Add to ${label}`}
        placeholder={items.length ? "" : "Empty"}
        autoComplete="off"
        spellCheck={false}
        className="props-chip-input"
      />
    </div>
  );
}
