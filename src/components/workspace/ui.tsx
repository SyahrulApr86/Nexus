"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from "react";
import { createPortal } from "react-dom";

/* ------------------------------------------------------------------ */
/* Icon button: 32px for a mouse, 44px for touch, themed tooltip       */
/* ------------------------------------------------------------------ */

export function IconButton({
  label,
  shortcut,
  className = "",
  children,
  ref: outerRef,
  ...props
}: { label: string; shortcut?: string; children: ReactNode } & ComponentProps<"button">) {
  const ref = useRef<HTMLButtonElement>(null);
  const tip = useTooltip(ref);
  return (
    <>
      <button
        ref={(el) => {
          ref.current = el;
          if (typeof outerRef === "function") outerRef(el);
          else if (outerRef) outerRef.current = el;
        }}
        type="button"
        aria-label={label}
        aria-keyshortcuts={shortcut ? keyShortcuts(shortcut) : undefined}
        className={`inline-flex size-8 shrink-0 items-center justify-center rounded-md text-faint transition-[color,background-color,scale] duration-150 ease-[var(--ease-out-quint)] hover:bg-hover hover:text-fg active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 pointer-coarse:size-11 [&_svg]:size-[18px] [&_svg]:stroke-[1.5] ${className}`}
        {...props}
        {...tip.handlers(props)}
      >
        <span aria-hidden="true" className="contents">
          {children}
        </span>
      </button>
      {tip.render(
        <>
          {label}
          {shortcut && <Shortcut keys={shortcut} />}
        </>,
      )}
    </>
  );
}

type TipHandlers = Pick<ComponentProps<"button">, "onPointerEnter" | "onPointerLeave" | "onFocus" | "onBlur" | "onPointerDown">;

/**
 * Hover (after 400ms, mouse and pen only) or keyboard focus shows a small label next to the control.
 * It stays while the pointer is over it and closes on Escape (WCAG 1.4.13). The control keeps its
 * own accessible name, so the tooltip is hidden from assistive tech.
 */
function useTooltip(anchor: React.RefObject<HTMLElement | null>) {
  const [pos, setPos] = useState<{ left: number; top: number; host: Element } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const tipRef = useRef<HTMLSpanElement>(null);

  const show = () => {
    const el = anchor.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: r.left + r.width / 2, top: r.bottom + 6, host: el.closest("dialog[open]") ?? document.body });
  };
  const hide = (delay = 0) => {
    clearTimeout(timer.current);
    if (delay) timer.current = setTimeout(() => setPos(null), delay);
    else setPos(null);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  // Keep the tip inside the viewport; flip above the control when there is no room below.
  useLayoutEffect(() => {
    const t = tipRef.current;
    const el = anchor.current;
    if (!t || !el || !pos) return;
    const r = el.getBoundingClientRect();
    const w = t.offsetWidth;
    const h = t.offsetHeight;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
    const top = r.bottom + 6 + h > window.innerHeight - 8 ? r.top - 6 - h : r.bottom + 6;
    t.style.left = `${left}px`;
    t.style.top = `${top}px`;
  }, [pos, anchor]);

  useEffect(() => {
    if (!pos) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Dismiss the tip; the Escape still reaches dialogs and menus underneath.
      clearTimeout(timer.current);
      setPos(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pos]);

  return {
    handlers: (own: TipHandlers): TipHandlers => ({
      onPointerEnter: (e) => {
        own.onPointerEnter?.(e);
        if (e.pointerType === "touch" || !matchMedia("(hover: hover)").matches) return;
        clearTimeout(timer.current);
        timer.current = setTimeout(show, 400);
      },
      onPointerLeave: (e) => {
        own.onPointerLeave?.(e);
        if (!e.currentTarget.matches(":focus-visible")) hide(120);
      },
      onPointerDown: (e) => {
        own.onPointerDown?.(e);
        hide();
      },
      onFocus: (e) => {
        own.onFocus?.(e);
        if (e.currentTarget.matches(":focus-visible")) show();
      },
      onBlur: (e) => {
        own.onBlur?.(e);
        hide();
      },
    }),
    render: (content: ReactNode) =>
      pos &&
      createPortal(
        <span
          ref={tipRef}
          aria-hidden="true"
          onPointerEnter={() => clearTimeout(timer.current)}
          onPointerLeave={() => hide(120)}
          className="fixed z-[60] inline-flex items-center gap-2 whitespace-nowrap rounded-md bg-[var(--toast-bg)] px-2 py-1 text-[12px] leading-4 text-[var(--toast-fg)] shadow-[var(--shadow-float)] [&_.kbd]:h-[18px] [&_.kbd]:min-w-[18px]"
          style={{ left: pos.left, top: pos.top }}
        >
          {content}
        </span>,
        pos.host,
      ),
  };
}

/* ------------------------------------------------------------------ */
/* Keyboard shortcut as keycaps                                        */
/* ------------------------------------------------------------------ */

export function isMac() {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

const noopSubscribe = () => () => {};

const SPOKEN: Record<string, string> = {
  "↑": "Up arrow",
  "↓": "Down arrow",
  "←": "Left arrow",
  "→": "Right arrow",
  "↵": "Enter",
  "⌘": "Command",
  "⌥": "Option",
  "⌃": "Control",
  Esc: "Escape",
};

/** Key names for aria-keyshortcuts, e.g. "Mod+Alt+←" becomes "Control+Alt+ArrowLeft Meta+Alt+ArrowLeft". */
export function keyShortcuts(keys: string) {
  const ARIA: Record<string, string> = { Ctrl: "Control", "←": "ArrowLeft", "→": "ArrowRight", "↑": "ArrowUp", "↓": "ArrowDown", "↵": "Enter", Esc: "Escape" };
  const parts = keys.split("+").map((k) => ARIA[k] ?? k);
  if (!parts.includes("Mod")) return parts.join("+");
  return ["Control", "Meta"].map((m) => parts.map((k) => (k === "Mod" ? m : k)).join("+")).join(" ");
}

export function Shortcut({ keys }: { keys: string }) {
  // Platform is client-only; the server snapshot renders the Ctrl form.
  const mac = useSyncExternalStore(noopSubscribe, isMac, () => false);
  const parts = keys
    .split("+")
    .map((k) => (k === "Mod" ? (mac ? "⌘" : "Ctrl") : k === "Alt" && mac ? "⌥" : k === "Ctrl" && mac ? "⌃" : k));
  const spoken = parts.map((p) => SPOKEN[p] ?? p).join("+");
  return (
    <span className="inline-flex items-center gap-1">
      {parts.map((p, i) => (
        <kbd key={i} className="kbd" aria-hidden="true">
          {p}
        </kbd>
      ))}
      <span className="sr-only">{spoken}</span>
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
              className={`mx-1 flex w-[calc(100%-0.5rem)] items-center gap-3 rounded-md px-2 py-1.5 text-left outline-offset-[-2px] hover:bg-sheet-hover focus-visible:bg-active aria-disabled:opacity-50 ${
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
  describedBy,
  onClose,
  children,
  className = "",
  placement = "center",
}: {
  label: string;
  /** Id of the text that explains the dialog, such as a confirm's consequence. */
  describedBy?: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  placement?: "center" | "top";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Layout effect: the cleanup closes the dialog while it is still in the document, so the browser
  // returns focus to whatever had it before showModal(). The opener is the fallback when that
  // element is gone (a deleted note's row, a closed tab).
  useLayoutEffect(() => {
    const d = ref.current;
    const opener = document.activeElement;
    if (d && !d.open) d.showModal();
    // React's autoFocus runs before showModal(), which then moves focus itself; [data-autofocus] wins.
    d?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => {
      d?.close();
      const now = document.activeElement;
      if (!now || now === document.body || d?.contains(now)) {
        const target =
          opener instanceof HTMLElement && opener !== document.body && opener.isConnected
            ? opener
            : document.getElementById("workbench");
        target?.focus({ preventScroll: true });
      }
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      aria-describedby={describedBy}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className={`m-0 w-full bg-transparent p-3 ${
        placement === "top" ? "mt-[12vh] max-h-[calc(100dvh-12vh)]" : "my-auto max-h-dvh"
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
          className="pointer-events-auto flex max-w-[min(32rem,100%)] animate-[rise_200ms_var(--ease-out-quint)] items-center gap-3 rounded-lg bg-[var(--toast-bg)] px-4 py-2.5 text-[14px] text-[var(--toast-fg)] shadow-[var(--shadow-float)]"
        >
          <span className="min-w-0 wrap-anywhere">{t.message}</span>
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
