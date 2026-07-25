import { useEffect, useId, useRef, useState } from "react";
import { useCurrentUser, useUpdatePreferences } from "../api/auth.js";
import { Button } from "./ui.js";
import type { Theme } from "../theme.js";

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "Match system" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** FR-021/022 theme + FR-003 idle timeout, both persisted server-side. */
export function SettingsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { data: user } = useCurrentUser();
  const updatePrefs = useUpdatePreferences();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const themeId = useId();
  const timeoutId = useId();
  const [timeout, setTimeoutValue] = useState(30);
  // Preference writes are serialized: two overlapping saves could otherwise
  // land out of order and leave the older value as the winner.
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  const committed = useRef<number | null>(null);

  useEffect(() => {
    if (user && committed.current === null) {
      setTimeoutValue(user.idleTimeoutMinutes);
      committed.current = user.idleTimeoutMinutes;
    }
  }, [user]);

  useEffect(() => {
    // Reopening the dialog re-syncs from the server value
    if (!open) committed.current = null;
  }, [open]);

  const commitTimeout = (value: number) => {
    const clamped = Math.min(120, Math.max(5, value));
    setTimeoutValue(clamped);
    if (clamped === committed.current) return;
    committed.current = clamped;
    saveChain.current = saveChain.current
      .then(() => updatePrefs.mutateAsync({ idleTimeoutMinutes: clamped }))
      .catch(() => {
        // Surface the server's value again if the write failed
        committed.current = null;
      });
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onCancel={onClose}
      aria-label="Settings"
      className="m-auto w-[440px] max-w-[92vw] rounded-card border border-border bg-card p-0 text-ink shadow-xl backdrop:bg-black/40"
    >
      <h2 className="border-b border-border px-5 py-3.5 text-[16px] font-semibold tracking-heading">
        Settings
      </h2>
      <div className="flex flex-col gap-5 px-5 py-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={themeId} className="text-[14px] font-medium">
            Theme
          </label>
          <select
            id={themeId}
            value={user?.theme ?? "system"}
            onChange={(e) =>
              updatePrefs.mutate({ theme: e.target.value as Theme })
            }
            className="rounded-control border border-border bg-bg px-3 py-2 text-[14px] text-ink"
          >
            {THEMES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={timeoutId} className="text-[14px] font-medium">
            Sign out after inactivity
          </label>
          <div className="flex items-center gap-3">
            <input
              id={timeoutId}
              type="number"
              min={5}
              max={120}
              step={5}
              value={timeout}
              onChange={(e) => setTimeoutValue(Number(e.target.value))}
              onBlur={() => commitTimeout(timeout)}
              className="w-24 rounded-control border border-border bg-bg px-3 py-2 text-[14px] text-ink"
            />
            <span className="text-[14px] text-muted">minutes (5–120)</span>
          </div>
          <p className="text-[13px] text-muted">
            Your session ends this long after your last action on any device.
          </p>
        </div>
      </div>
      <div className="flex justify-end border-t border-border px-5 py-3">
        <Button variant="ghost" onClick={onClose}>
          Done
        </Button>
      </div>
    </dialog>
  );
}
