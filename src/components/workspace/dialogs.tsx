"use client";

import { useCallback, useId, useState } from "react";
import { Modal } from "./ui";

type PromptOpts = { title: string; label: string; value?: string; confirm?: string; hint?: string };
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
  const id = useId();

  const cancel = () => {
    if (req.kind === "prompt") req.resolve(null);
    else req.resolve(false);
    close();
  };
  const ok = () => {
    if (req.kind === "prompt") {
      const v = value.trim();
      if (!v) return;
      req.resolve(v);
    } else req.resolve(true);
    close();
  };

  return (
    <Modal label={req.title} onClose={cancel} className="max-w-md" placement="top">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ok();
        }}
        className="rounded-xl border border-border bg-sheet p-5 shadow-[var(--shadow-float)]"
      >
        <h2 className="text-[16px] font-medium leading-6">{req.title}</h2>
        {req.kind === "confirm" ? (
          <p className="mt-2 text-muted">{req.body}</p>
        ) : (
          <div className="mt-4">
            <label htmlFor={id} className="mb-2 block text-[13px] font-medium text-muted">
              {req.label}
            </label>
            <input
              id={id}
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onFocus={(e) => {
                // Select the name, not the folder path, like a file manager does.
                const v = e.currentTarget.value;
                e.currentTarget.setSelectionRange(v.lastIndexOf("/") + 1, v.length);
              }}
              autoComplete="off"
              spellCheck={false}
              className="h-10 w-full rounded-lg border border-control bg-sheet px-3 text-[16px] outline-none focus-visible:border-transparent md:text-[14px]"
            />
            {req.hint && <p className="mt-2 text-[13px] text-faint">{req.hint}</p>}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={cancel}
            className="h-9 rounded-lg border border-control px-4 text-[14px] font-medium transition-colors hover:bg-sheet-hover"
          >
            Cancel
          </button>
          <button
            type="submit"
            autoFocus={req.kind === "confirm"}
            className={`h-9 rounded-lg px-4 text-[14px] font-medium transition-colors ${
              req.kind === "confirm" && req.danger
                ? "bg-negative text-[var(--on-negative)] hover:opacity-90"
                : "bg-accent text-navy hover:brightness-95"
            }`}
          >
            {req.kind === "confirm" ? req.confirm : (req.confirm ?? "Save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
