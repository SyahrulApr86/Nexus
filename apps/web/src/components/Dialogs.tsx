import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "./ui.js";

function useDialogElement(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return { ref, onClose };
}

function DialogShell({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { ref } = useDialogElement(open, onClose);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      aria-label={title}
      className="m-auto w-[420px] max-w-[92vw] rounded-card border border-border bg-card p-0 text-ink shadow-xl backdrop:bg-black/40"
    >
      <h2 className="border-b border-border px-5 py-3.5 text-[16px] font-semibold tracking-heading">
        {title}
      </h2>
      {children}
    </dialog>
  );
}

/** Accessible replacement for window.prompt (FR-007 create/rename flows). */
export function PromptDialog({
  open,
  title,
  label,
  initialValue = "",
  submitLabel = "Save",
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  label: string;
  initialValue?: string;
  submitLabel?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      // Focus after the dialog opens
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [open, initialValue]);

  return (
    <DialogShell open={open} title={title} onClose={onClose}>
      <form
        method="dialog"
        className="flex flex-col gap-4 px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          const v = value.trim();
          if (!v) return;
          onSubmit(v);
          onClose();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={inputId} className="text-[14px] font-medium">
            {label}
          </label>
          <input
            ref={inputRef}
            id={inputId}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
            className="rounded-control border border-border bg-bg px-3.5 py-2.5 text-[16px] text-ink"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!value.trim()}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}

/** Accessible replacement for window.confirm (US3-S3, FR-031, FR-012). */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  danger = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <DialogShell open={open} title={title} onClose={onClose}>
      <div className="flex flex-col gap-4 px-5 py-4">
        <p className="text-[14px] leading-relaxed text-muted">{message}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} autoFocus>
            Cancel
          </Button>
          <Button
            type="button"
            variant={danger ? "danger" : "primary"}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}
