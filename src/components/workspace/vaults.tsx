"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Check, ChevronsUpDown, Pencil, Plus, Trash2 } from "lucide-react";
import { api, ApiError, forgetVaultLayout, getActiveVault, goToVault, type VaultSummary } from "./api";
import { useWorkspaceActions, useWorkspaceSelector } from "./store";
import { Bar, IconButton, Menu, Modal, nf, useMenu, type MenuItem } from "./ui";

/*
 * Vaults: the switcher at the foot of the left sidebar (as in Obsidian), the "Vaults" dialog that
 * lists them with note counts and manages them, and the type-the-name delete confirmation.
 * Switching opens the other vault in a fresh page (store.tsx switchVault), so no tab, cached note
 * or timer of the previous vault can leak into the next one.
 */

/* ------------------------------------------------------------------ */
/* Requests from anywhere (palette, menus) to open a vault dialog      */
/* ------------------------------------------------------------------ */

type VaultRequest = "manage" | "create" | null;
let request: VaultRequest = null;
const listeners = new Set<() => void>();
const setRequest = (r: VaultRequest) => {
  request = r;
  listeners.forEach((fn) => fn());
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Opens the "Vaults" dialog: every vault with its note count, switch, create, rename, delete. */
export const openVaults = () => setRequest("manage");
/** Asks for a name and creates a vault, then opens it. */
export const openCreateVault = () => setRequest("create");

/* ------------------------------------------------------------------ */
/* Shared list of the user's vaults                                    */
/* ------------------------------------------------------------------ */

let cache: VaultSummary[] | null = null;
const listListeners = new Set<() => void>();
let inflight: Promise<VaultSummary[]> | null = null;

/** Fetches the list again; every component showing it re-renders. */
function reloadVaults() {
  inflight ??= api
    .vaults()
    .then((v) => {
      cache = v;
      listListeners.forEach((fn) => fn());
      return v;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function useVaultList() {
  const list = useSyncExternalStore(
    (fn) => {
      listListeners.add(fn);
      return () => listListeners.delete(fn);
    },
    () => cache,
    () => null,
  );
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(
    () =>
      reloadVaults().then(
        () => setError(null),
        (e: unknown) => setError(e instanceof ApiError ? e.message : "Couldn’t load your vaults. Try again."),
      ),
    [],
  );
  return { list, error, reload };
}

/** The vault on screen: the one named by ?v=, else the default one. */
function currentOf(list: VaultSummary[] | null) {
  const id = getActiveVault();
  return list?.find((v) => (id ? v.id === id : v.isDefault)) ?? null;
}

const notesLabel = (n: number) => `${nf.format(n)} ${n === 1 ? "note" : "notes"}`;
const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : "That didn’t work. Try again.");

/* ------------------------------------------------------------------ */
/* Switcher: the vault button at the foot of the left sidebar          */
/* ------------------------------------------------------------------ */

export function VaultSwitcher() {
  const actions = useWorkspaceActions();
  // The workspace knows the active vault's name first (GET /api/vault); the list adds the others.
  const storeName = useWorkspaceSelector((w) => w.vaultName);
  const { list, reload } = useVaultList();
  const m = useMenu();
  const current = currentOf(list);
  const name = current?.name ?? storeName;

  useEffect(() => {
    void reload();
  }, [reload]);

  const items: MenuItem[] = [
    ...(list ?? []).map((v) => ({
      label: v.name,
      checked: v.id === current?.id,
      onSelect: () => {
        if (v.id !== current?.id) void actions.switchVault(v.id, current?.id ?? null);
      },
    })),
    ...(list?.length ? ["separator" as const] : []),
    { label: "Manage vaults…", onSelect: openVaults },
    { label: "Create vault…", onSelect: openCreateVault },
    "separator",
    { label: "Settings", shortcut: "Mod+,", onSelect: () => actions.setSettingsOpen("general") },
    { label: "Import notes…", onSelect: () => actions.setSettingsOpen("general") },
    { label: "Export vault as .zip", onSelect: actions.exportVault },
    "separator",
    { label: "Sign out", onSelect: actions.logout },
  ];

  return (
    <div className="shrink-0 border-t border-rule px-2 pb-2 pt-2">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={!!m.anchor}
        aria-label={name ? `Vault: ${name}. Switch or manage vaults` : "Switch or manage vaults"}
        onClick={(e) => {
          void reload();
          m.openBelow(e.currentTarget);
        }}
        className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-hover pointer-coarse:h-11"
      >
        <span className="min-w-0 flex-1">
          {name ? (
            <span className="block truncate font-medium" translate="no">
              {name}
            </span>
          ) : (
            <Bar w="55%" h={12} />
          )}
        </span>
        <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 stroke-[1.5] text-faint" />
      </button>
      {m.anchor && <Menu anchor={m.anchor} label="Vaults" onClose={m.close} items={items} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Host: renders whichever vault dialog was asked for                  */
/* ------------------------------------------------------------------ */

export function VaultsHost() {
  const req = useSyncExternalStore(subscribe, () => request, () => null);
  const dialog = useWorkspaceSelector((w) => w.dialog);
  const actions = useWorkspaceActions();

  /** Prompts for a name, creates the vault and opens it. Errors (taken name, limit) stay in the prompt. */
  const create = useCallback(async () => {
    let created: VaultSummary | null = null;
    const name = await dialog.prompt({
      title: "Create vault",
      label: "Vault name",
      confirm: "Create vault",
      pending: "Creating…",
      hint: "A vault is a separate set of notes and folders. You can switch between vaults at any time.",
      submit: async (value) => {
        created = await api.createVault(value);
      },
    });
    if (!name || !created) return;
    const from = currentOf(cache)?.id ?? null;
    void reloadVaults().catch(() => {});
    void actions.switchVault((created as VaultSummary).id, from);
  }, [dialog, actions]);

  useEffect(() => {
    if (req !== "create") return;
    setRequest(null);
    void create();
  }, [req, create]);

  if (req !== "manage") return null;
  return <VaultsDialog onClose={() => setRequest(null)} onCreate={create} />;
}

/* ------------------------------------------------------------------ */
/* "Vaults" dialog                                                     */
/* ------------------------------------------------------------------ */

function VaultsDialog({ onClose, onCreate }: { onClose: () => void; onCreate: () => Promise<void> }) {
  const { list, error, reload } = useVaultList();
  const dialog = useWorkspaceSelector((w) => w.dialog);
  const actions = useWorkspaceActions();
  const [deleting, setDeleting] = useState<VaultSummary | null>(null);
  const [status, setStatus] = useState("");
  const titleId = useId();
  const current = currentOf(list);

  useEffect(() => {
    void reload();
  }, [reload]);

  const rename = async (v: VaultSummary) => {
    const name = await dialog.prompt({
      title: `Rename “${v.name}”`,
      label: "Vault name",
      value: v.name,
      confirm: "Rename",
      pending: "Renaming…",
      submit: async (value) => {
        await api.renameVault(v.id, value);
      },
    });
    if (!name) return;
    await reload();
    setStatus(`Renamed to ${name}.`);
  };

  return (
    <>
      <Modal label="Vaults" onClose={onClose} className="max-w-lg" placement="top">
        <div className="rounded-xl border border-border bg-sheet p-5 shadow-[var(--shadow-float)]">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 id={titleId} className="text-[16px] font-medium leading-6">
                Vaults
              </h2>
              <p className="mt-1 text-[13px] leading-5 text-muted">
                Each vault has its own notes, folders and links. Pick one to open it.
              </p>
            </div>
          </div>

          <div className="mt-4 max-h-[min(50vh,420px)] overflow-y-auto overscroll-contain">
            {error && !list ? (
              <div className="rounded-lg border border-border px-3 py-4 text-[14px]">
                <p className="text-negative">{error}</p>
                <button type="button" onClick={() => void reload()} className="mt-2 font-medium text-accent-ink underline underline-offset-4">
                  Try again
                </button>
              </div>
            ) : !list ? (
              <div aria-busy="true" className="space-y-1">
                <p role="status" className="sr-only">
                  Loading your vaults…
                </p>
                {[60, 45, 70].map((w, i) => (
                  <div key={i} className="flex h-12 items-center px-3">
                    <Bar w={`${w}%`} h={12} />
                  </div>
                ))}
              </div>
            ) : (
              <ul aria-labelledby={titleId} className="space-y-0.5">
                {list.map((v) => {
                  const isCurrent = v.id === current?.id;
                  const only = list.length < 2;
                  return (
                    <li key={v.id} className="group flex items-center gap-1 rounded-lg hover:bg-sheet-hover">
                      <button
                        type="button"
                        aria-current={isCurrent ? "true" : undefined}
                        onClick={() => {
                          if (isCurrent) return onClose();
                          void actions.switchVault(v.id, current?.id ?? null);
                        }}
                        className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-1.5 text-left outline-offset-[-2px]"
                      >
                        <span className="grid size-4 shrink-0 place-items-center">
                          {isCurrent && <Check aria-hidden="true" className="size-4 stroke-[2] text-accent-ink" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate text-[14px] ${isCurrent ? "font-medium text-fg" : "text-fg"}`} translate="no">
                            {v.name}
                          </span>
                          <span className="block text-[12px] leading-4 text-faint tabular">
                            {notesLabel(v.notes)}
                            {isCurrent ? " · Open now" : ""}
                          </span>
                        </span>
                      </button>
                      <IconButton label={`Rename ${v.name}`} onClick={() => void rename(v)}>
                        <Pencil />
                      </IconButton>
                      <IconButton
                        label={only ? `Delete ${v.name} (your only vault can’t be deleted)` : `Delete ${v.name}`}
                        aria-disabled={only || undefined}
                        onClick={() => {
                          if (only) {
                            setStatus("Your only vault can’t be deleted. Create another vault first.");
                            return;
                          }
                          setDeleting(v);
                        }}
                        className="mr-1 aria-disabled:opacity-40 hover:text-negative aria-disabled:hover:text-faint"
                      >
                        <Trash2 />
                      </IconButton>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <p role="status" className="mt-2 min-h-5 text-[13px] text-muted">
            {status}
          </p>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => void onCreate()}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-[14px] font-medium text-navy transition-[filter] hover:brightness-95 [&_svg]:size-4 [&_svg]:stroke-[1.75]"
            >
              <Plus aria-hidden="true" />
              Create vault
            </button>
            <button
              type="button"
              data-autofocus
              onClick={onClose}
              className="h-9 rounded-lg border border-control px-4 text-[14px] font-medium transition-colors hover:bg-sheet-hover"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>
      {deleting && (
        <DeleteVaultDialog
          vault={deleting}
          isCurrent={deleting.id === current?.id}
          fallback={list?.find((v) => v.id !== deleting.id && v.isDefault) ?? list?.find((v) => v.id !== deleting.id) ?? null}
          onClose={() => setDeleting(null)}
          onDeleted={async () => {
            const name = deleting.name;
            setDeleting(null);
            await reload();
            setStatus(`Deleted ${name}.`);
          }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Delete: type the vault's name to confirm                            */
/* ------------------------------------------------------------------ */

function DeleteVaultDialog({
  vault,
  isCurrent,
  fallback,
  onClose,
  onDeleted,
}: {
  vault: VaultSummary;
  isCurrent: boolean;
  /** The vault to open when the deleted one is on screen. */
  fallback: VaultSummary | null;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const bodyId = `${id}-body`;
  const errId = `${id}-err`;

  const submit = async () => {
    if (busy) return;
    if (typed !== vault.name) {
      setError(typed.trim() ? "That doesn’t match the vault’s name. Type it exactly, including capitals." : "Type the vault’s name to confirm.");
      input.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.deleteVault(vault.id, typed);
    } catch (e) {
      setBusy(false);
      setError(errorText(e));
      requestAnimationFrame(() => input.current?.focus());
      return;
    }
    if (isCurrent && fallback) {
      // The open vault is gone: what is on screen belongs to nothing now, so leave it.
      goToVault(fallback.id, vault.id);
      forgetVaultLayout(vault.id);
      return;
    }
    forgetVaultLayout(vault.id);
    await onDeleted();
  };

  return (
    <Modal label={`Delete “${vault.name}”?`} describedBy={bodyId} onClose={() => !busy && onClose()} className="max-w-md" placement="top">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="rounded-xl border border-border bg-sheet p-5 shadow-[var(--shadow-float)]"
      >
        <h2 className="text-[16px] font-medium leading-6 text-balance wrap-break-word">Delete “{vault.name}”?</h2>
        <p id={bodyId} className="mt-2 text-[14px] leading-5 text-muted">
          This permanently deletes the vault and everything in it: {notesLabel(vault.notes)}, their folders, version history,
          bookmarks and public links. This can’t be undone.
          {isCurrent && fallback ? ` You’ll be taken to “${fallback.name}”.` : ""}
        </p>
        <label htmlFor={id} className="mt-4 mb-2 block text-[13px] font-medium text-muted">
          Type <span className="font-semibold text-fg" translate="no">{vault.name}</span> to confirm
        </label>
        <input
          ref={input}
          id={id}
          data-autofocus
          value={typed}
          readOnly={busy}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
          onChange={(e) => {
            setTyped(e.target.value);
            if (error) setError(null);
          }}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="h-10 w-full rounded-lg border border-control bg-sheet px-3 text-[16px] aria-invalid:border-negative md:text-[14px]"
        />
        {error && (
          <p id={errId} className="mt-2 text-[13px] text-negative wrap-break-word">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-9 rounded-lg border border-control px-4 text-[14px] font-medium transition-colors hover:bg-sheet-hover disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            aria-disabled={busy || undefined}
            className="h-9 rounded-lg bg-negative px-4 text-[14px] font-medium text-[var(--on-negative)] transition-colors hover:bg-negative-hover"
          >
            {busy ? "Deleting…" : "Delete vault"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
