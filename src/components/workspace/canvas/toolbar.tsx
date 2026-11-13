"use client";

import { FilePlus2, Globe, Group, ListTree, Maximize, Minus, Plus, Redo2, StickyNote, Undo2 } from "lucide-react";
import { IconButton, Menu, useMenu } from "../ui";

/**
 * The canvas toolbar, floating at the bottom of the canvas: add cards, zoom, undo and redo, and the
 * outline. On phones the four "add" buttons fold into one Add menu so the bar fits 390px.
 */
export function CanvasToolbar(p: {
  /** The outline panel is open: on wider screens the bar centres in the space left of it. */
  shifted: boolean;
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  outline: boolean;
  onAddText: () => void;
  onAddNote: () => void;
  onAddLink: () => void;
  onAddGroup: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onFit: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onOutline: () => void;
}) {
  const add = useMenu();
  const sep = <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-rule" />;
  return (
    <div
      data-canvas-ui
      role="toolbar"
      aria-label="Canvas tools"
      className={`absolute bottom-3 left-1/2 z-20 ${p.shifted ? "md:left-[calc(50%-160px)]" : ""} flex max-w-[calc(100%-16px)] -translate-x-1/2 items-center gap-0.5 rounded-xl border border-border bg-sheet p-1 shadow-[var(--shadow-float)] pb-[max(4px,env(safe-area-inset-bottom))] md:pb-1`}
    >
      <div className="hidden items-center gap-0.5 md:flex">
        <IconButton label="Add text card" onClick={p.onAddText}>
          <StickyNote />
        </IconButton>
        <IconButton label="Add note card" onClick={p.onAddNote}>
          <FilePlus2 />
        </IconButton>
        <IconButton label="Add web link card" onClick={p.onAddLink}>
          <Globe />
        </IconButton>
        <IconButton label="Add group" onClick={p.onAddGroup}>
          <Group />
        </IconButton>
      </div>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={!!add.anchor}
        onClick={(e) => add.openBelow(e.currentTarget)}
        className="inline-flex h-11 shrink-0 items-center gap-1 rounded-md px-3 text-[14px] font-medium text-fg hover:bg-hover md:hidden"
      >
        <Plus aria-hidden="true" className="size-[18px] stroke-[1.5]" />
        Add
      </button>
      {sep}
      <IconButton label="Zoom out" shortcut="-" onClick={p.onZoomOut}>
        <Minus />
      </IconButton>
      <button
        type="button"
        onClick={p.onZoomReset}
        aria-label={`Zoom ${Math.round(p.zoom * 100)} percent, reset to 100 percent`}
        className="hidden h-8 min-w-12 shrink-0 rounded-md px-1 text-[12px] font-medium tabular-nums text-muted hover:bg-hover hover:text-fg sm:inline-block pointer-coarse:h-11"
      >
        {Math.round(p.zoom * 100)}%
      </button>
      <IconButton label="Zoom in" shortcut="+" onClick={p.onZoomIn}>
        <Plus />
      </IconButton>
      <IconButton label="Zoom to fit" shortcut="Shift+1" onClick={p.onFit}>
        <Maximize />
      </IconButton>
      {sep}
      <IconButton label="Undo" shortcut="Mod+Z" disabled={!p.canUndo} onClick={p.onUndo}>
        <Undo2 />
      </IconButton>
      <IconButton label="Redo" shortcut="Mod+Shift+Z" disabled={!p.canRedo} onClick={p.onRedo}>
        <Redo2 />
      </IconButton>
      {sep}
      <IconButton label={p.outline ? "Hide outline" : "Show outline"} aria-pressed={p.outline} onClick={p.onOutline}>
        <ListTree />
      </IconButton>
      {add.anchor && (
        <Menu
          anchor={add.anchor}
          label="Add to canvas"
          onClose={add.close}
          items={[
            { label: "Text card", onSelect: p.onAddText },
            { label: "Note card…", onSelect: p.onAddNote },
            { label: "Web link card…", onSelect: p.onAddLink },
            { label: "Group", onSelect: p.onAddGroup },
          ]}
        />
      )}
    </div>
  );
}
