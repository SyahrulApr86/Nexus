"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from "react";
import { createPortal } from "react-dom";

/* ------------------------------------------------------------------ */
/* Icon button: 28px in the frame, 44px on touch                       */
/* ------------------------------------------------------------------ */

export function IconButton({
  label,
  shortcut,
  className = "",
  children,
  ...props
}: { label: string; shortcut?: string; children: ReactNode } & ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={`inline-flex size-8 shrink-0 items-center justify-center rounded-md text-faint transition-colors duration-150 hover:bg-hover hover:text-fg active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-[18px] [&_svg]:stroke-[1.5] ${className}`}
      {...props}
    >
      <span aria-hidden="true" className="contents">
        {children}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Keyboard shortcut as keycaps                                        */
/* ------------------------------------------------------------------ */

export function isMac() {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

const noopSubscribe = () => () => {};

export function Shortcut({ keys }: { keys: string }) {
  // Platform is client-only; the server snapshot renders the Ctrl form.
  const mac = useSyncExternalStore(noopSubscribe, isMac, () => false);
  const parts = keys.split("+").map((k) => (k === "Mod" ? (mac ? "⌘" : "Ctrl") : k === "Alt" && mac ? "⌥" : k));
  return (
    <span className="inline-flex items-center gap-1" aria-label={parts.join(" ")}>
      {parts.map((p, i) => (
        <kbd key={i} className="kbd" aria-hidden="true">
          {p}
        </kbd>
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Skeleton bar: flat, no shimmer, at the size of what it replaces     */
/* ------------------------------------------------------------------ */

export function Bar({ w, h = 12, className = "" }: { w: number | string; h?: number; className?: string }) {
  return <span aria-hidden="true" className={`block rounded bg-active ${className}`} style={{ width: w, height: h }} />;
}

/* ------------------------------------------------------------------ */
/* Menu: ARIA menu in a portal, arrow keys, Escape, focus return       */
/* ------------------------------------------------------------------ */

export type MenuItem =
  | { label: string; onSelect: () => void; shortcut?: string; danger?: boolean; disabled?: boolean; checked?: boolean }
  | "separator";

export type MenuAnchor = { x: number; y: number } | DOMRect;

export function Menu({
  anchor,
  items,
  onClose,
  label,
}: {
  anchor: MenuAnchor;
  items: MenuItem[];
  onClose: () => void;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<Element | null>(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });

  useLayoutEffect(() => {
    returnFocus.current = document.activeElement;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const ax = "left" in anchor ? anchor.left : anchor.x;
    const ay = "bottom" in anchor ? anchor.bottom + 4 : anchor.y;
    setPos({
      left: Math.max(8, Math.min(ax, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(ay, window.innerHeight - r.height - 8)),
    });
    el.querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])')?.focus();
    return () => {
      if (returnFocus.current instanceof HTMLElement) returnFocus.current.focus();
    };
  }, [anchor]);

  const move = (dir: 1 | -1 | "first" | "last") => {
    const els = [...(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? [])];
    if (!els.length) return;
    const i = els.indexOf(document.activeElement as HTMLElement);
    const next =
      dir === "first" ? 0 : dir === "last" ? els.length - 1 : (i + (dir as number) + els.length) % els.length;
    els[next].focus();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        ref={ref}
        role="menu"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={(e) => {
          const keys: Record<string, () => void> = {
            ArrowDown: () => move(1),
            ArrowUp: () => move(-1),
            Home: () => move("first"),
            End: () => move("last"),
            Escape: onClose,
            Tab: onClose,
          };
          const fn = keys[e.key];
          if (fn) {
            e.preventDefault();
            fn();
          }
        }}
        className="absolute min-w-52 rounded-lg border border-border bg-sheet py-1 text-[14px] shadow-[var(--shadow-float)]"
        style={pos}
      >
        {items.map((it, i) =>
          it === "separator" ? (
            <div key={i} role="separator" className="my-1 h-px bg-rule" />
          ) : (
            <button
              key={it.label}
              type="button"
              role={it.checked === undefined ? "menuitem" : "menuitemradio"}
              aria-checked={it.checked}
              aria-disabled={it.disabled || undefined}
              onClick={() => {
                if (it.disabled) return;
                onClose();
                it.onSelect();
              }}
              className={`flex w-full items-center gap-3 px-3 py-1.5 text-left outline-none focus-visible:bg-active focus-visible:outline-none hover:bg-sheet-hover aria-disabled:opacity-50 ${
                it.danger ? "text-negative" : "text-fg"
              }`}
            >
              {it.checked !== undefined && (
                <span aria-hidden="true" className={`size-1.5 rounded-full ${it.checked ? "bg-accent" : "bg-transparent"}`} />
              )}
              <span className="flex-1 truncate">{it.label}</span>
              {it.shortcut && <Shortcut keys={it.shortcut} />}
            </button>
          ),
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Small hook: `open(anchor)` from a click or a context-menu event. */
export function useMenu() {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  return {
    anchor,
    openAt: (e: { clientX: number; clientY: number; preventDefault: () => void }) => {
      e.preventDefault();
      setAnchor({ x: e.clientX, y: e.clientY });
    },
    openBelow: (el: Element) => setAnchor(el.getBoundingClientRect()),
    close: () => setAnchor(null),
  };
}

/* ------------------------------------------------------------------ */
/* Modal shell on the native <dialog> (focus trap, Escape, top layer)  */
/* ------------------------------------------------------------------ */

export function Modal({
  label,
  onClose,
  children,
  className = "",
  placement = "center",
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  placement?: "center" | "top";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className={`m-0 w-full bg-transparent p-3 ${
        placement === "top" ? "mt-[12vh]" : "my-auto"
      } mx-auto ${className}`}
    >
      {children}
    </dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Toasts: one polite live region                                      */
/* ------------------------------------------------------------------ */

export type Toast = { id: number; message: string; action?: { label: string; run: () => void } };

export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4 md:bottom-10"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex max-w-[min(32rem,100%)] items-center gap-3 rounded-lg bg-[var(--toast-bg)] px-4 py-2.5 text-[14px] text-[var(--toast-fg)] shadow-[var(--shadow-float)]"
        >
          <span>{t.message}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
              className="font-medium text-[var(--toast-link)] underline-offset-2 hover:underline"
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
