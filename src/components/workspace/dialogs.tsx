"use client";

import { useCallback, useId, useRef, useState } from "react";
import { Modal } from "./ui";

type PromptOpts = {
  title: string;
  label: string;
  value?: string;
  confirm?: string;
  /** Label while `submit` runs, e.g. "Creating…". */
  pending?: string;
  hint?: string;
  /**
   * Does the work while the dialog stays open. A rejection shows its message under the field and
   * keeps what the user typed; the promise from prompt() resolves only after it succeeds.
   */
  submit?: (value: string) => Promise<void>;
};
type ConfirmOpts = { title: string; body: string; confirm: string; danger?: boolean };

type Req =
  | ({ kind: "prompt"; resolve: (v: string | null) => void } & PromptOpts)
  | ({ kind: "confirm"; resolve: (v: boolean) => void } & ConfirmOpts);

export type DialogApi = {
  prompt: (o: PromptOpts) => Promise<string | null>;
  confirm: (o: ConfirmOpts) => Promise<boolean>;
};

/** Promise-based prompt and confirm, rendered as native modal dialogs. */
export function useDialogs() {
  const [req, setReq] = useState<Req | null>(null);
  const prompt = useCallback(
    (o: PromptOpts) => new Promise<string | null>((resolve) => setReq({ kind: "prompt", resolve, ...o })),
    [],
  );
  const confirm = useCallback(
    (o: ConfirmOpts) => new Promise<boolean>((resolve) => setReq({ kind: "confirm", resolve, ...o })),
    [],
  );
  const node = req ? <DialogView key={req.title} req={req} close={() => setReq(null)} /> : null;
  return { api: { prompt, confirm } satisfies DialogApi, node };
}

function DialogView({ req, close }: { req: Req; close: () => void }) {
  const [value, setValue] = useState(req.kind === "prompt" ? (req.value ?? "") : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const bodyId = `${id}-body`;

  const cancel = () => {
    if (busy) return;
    if (req.kind === "prompt") req.resolve(null);
    else req.resolve(false);
    close();
  };
  const refocus = () => {
    const el = input.current;
    if (!el) return;
    el.focus();
    el.select();
  };
  const ok = async () => {
    if (busy) return;
    if (req.kind === "confirm") {
      req.resolve(true);
      return close();
    }
    const v = value.trim();
    if (!v) {
      setError("Enter a name.");
      return refocus();
    }
    if (req.submit) {
      setBusy(true);
      setError(null);
      try {
        await req.submit(v);
      } catch (e) {
        setBusy(false);
        setError(e instanceof Error && e.message ? e.message : "That didn’t work. Try again.");
        // Wait for the re-enabled input before moving focus back into it.
        requestAnimationFrame(refocus);
        return;
      }
    }
    req.resolve(v);
    close();
  };

  const describedBy = [error ? errId : null, req.kind === "prompt" && req.hint ? hintId : null].filter(Boolean).join(" ") || undefined;

  return (
    <Modal label={req.title} describedBy={req.kind === "confirm" ? bodyId : undefined} onClose={cancel} className="max-w-md" placement="top">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void ok();
        }}
        className="rounded-lg border border-mist bg-sheet p-5 shadow-[var(--shadow-float)]"
      >
        <h2 className="text-[16px] font-medium leading-6 text-balance wrap-break-word">{req.title}</h2>
        {req.kind === "confirm" ? (
          <p id={bodyId} className="mt-2 text-muted">
            {req.body}
          </p>
        ) : (
          <div className="mt-4">
            <label htmlFor={id} className="mb-2 block text-[13px] font-medium text-muted">
              {req.label}
            </label>
            <input
              ref={input}
              id={id}
              data-autofocus
              value={value}
              readOnly={busy}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(null);
              }}
              onFocus={(e) => {
                // Select the name, not the folder path, like a file manager does.
                const v = e.currentTarget.value;
                e.currentTarget.setSelectionRange(v.lastIndexOf("/") + 1, v.length);
              }}
              autoComplete="off"
              spellCheck={false}
              className="h-10 w-full rounded-lg border border-control bg-sheet px-3 text-[16px] aria-invalid:border-negative md:text-[14px]"
            />
            {error && (
              <p id={errId} className="mt-2 text-[13px] text-negative wrap-break-word">
                {error}
              </p>
            )}
            {req.hint && (
              <p id={hintId} className="mt-2 text-[13px] text-faint wrap-break-word">
                {req.hint}
              </p>
            )}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            className="h-9 rounded-lg border border-control px-4 text-[14px] font-medium transition-colors hover:bg-sheet-hover disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            data-autofocus={req.kind === "confirm" ? true : undefined}
            aria-disabled={busy || undefined}
            className={`h-9 rounded-lg px-4 text-[14px] font-medium transition-colors ${
              req.kind === "confirm" && req.danger
                ? "bg-negative text-[var(--on-negative)] hover:bg-negative-hover"
                : "bg-accent text-navy hover:brightness-95"
            }`}
          >
            {req.kind === "confirm" ? req.confirm : busy ? (req.pending ?? "Saving…") : (req.confirm ?? "Save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
