import { Icon } from "./Icon.js";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

/** Minimal accessible dropdown menu (button + role=menu, arrow keys, Escape). */
export function Menu({
  label,
  items,
  children,
}: {
  label: string;
  items: MenuItem[];
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const select = (i: number) => {
    setOpen(false);
    buttonRef.current?.focus();
    items[i]?.onSelect();
  };

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => {
          setActive(0);
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setActive(0);
            setOpen(true);
          }
        }}
        className="icon-button rounded-control px-1.5 py-0.5 text-[14px] text-muted hover:bg-card hover:text-ink"
      >
        {children ?? <Icon name="dots" size={15} />}
      </button>
      {open && (
        <ul
          id={menuId}
          role="menu"
          aria-label={label}
          className="absolute right-0 z-30 mt-1 w-48 rounded-card border border-border bg-card py-1 shadow-lg"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setOpen(false);
              buttonRef.current?.focus();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => (a + 1) % items.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a - 1 + items.length) % items.length);
            } else if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              select(active);
            }
          }}
        >
          {items.map((item, i) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                ref={(el) => {
                  if (open && i === active) el?.focus();
                }}
                tabIndex={i === active ? 0 : -1}
                onClick={() => select(i)}
                onMouseEnter={() => setActive(i)}
                className={`block w-full px-3 py-1.5 text-left text-[14px] hover:bg-surface ${
                  item.danger ? "text-danger" : "text-ink"
                }`}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
