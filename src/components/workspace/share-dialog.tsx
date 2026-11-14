"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Copy } from "lucide-react";
import { api, ApiError, type ShareLink } from "./api";
import { Bar, Modal } from "./ui";

/*
 * Share dialog: a read-only public link to one note (/s/<token>). The URL exists only in the
 * answer that creates it (the server keeps a hash), so it is shown once with a Copy button; the
 * list below shows the note's live links by date, each with Revoke.
 */

type ShareTarget = { id: string; name: string };
let target: ShareTarget | null = null;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const setTarget = (t: ShareTarget | null) => {
  target = t;
  listeners.forEach((fn) => fn());
};

/** Opens the share dialog for a note (from the note's more menu or the command palette). */
export const openShare = (note: ShareTarget) => setTarget({ id: note.id, name: note.name });

export function ShareHost() {
  const t = useSyncExternalStore(subscribe, () => target, () => null);
  if (!t) return null;
  return <ShareDialog key={t.id} note={t} onClose={() => setTarget(null)} />;
}

const EXPIRY = [
  { value: "never", label: "Never", days: null },
  { value: "1", label: "In 1 day", days: 1 },
  { value: "7", label: "In 7 days", days: 7 },
  { value: "30", label: "In 30 days", days: 30 },
] as const;

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });
const formatDate = (iso: string) => dateFormat.format(new Date(iso));
const errorText = (e: unknown) =>
  e instanceof ApiError ? (e.status >= 500 ? "Nexus couldn’t finish that. Try again in a moment." : e.message) : "That didn’t work. Try again.";

function ShareDialog({ note, onClose }: { note: ShareTarget; onClose: () => void }) {
  const id = useId();
  const [expiry, setExpiry] = useState<(typeof EXPIRY)[number]["value"]>("never");
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; url: string } | null>(null);
  const [copied, setCopied] = useState<"copied" | "manual" | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const urlInput = useRef<HTMLInputElement>(null);
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;
  const listId = `${id}-list`;

  const load = useCallback(async () => {
    try {
      setLinks(await api.shares(note.id));
      setListError(null);
    } catch (e) {
      setListError(errorText(e));
    }
  }, [note.id]);

  useEffect(() => {
    let live = true;
    api.shares(note.id).then(
      (l) => live && setLinks(l),
      (e: unknown) => live && setListError(errorText(e)),
    );
    return () => {
      live = false;
    };
  }, [note.id]);

  const create = async () => {
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    setCopied(null);
    try {
      const days = EXPIRY.find((x) => x.value === expiry)?.days ?? null;
      const link = await api.createShare(note.id, days);
      setCreated({ id: link.id, url: link.url });
      setLinks((l) => [{ id: link.id, noteId: link.noteId, createdAt: link.createdAt, expiresAt: link.expiresAt }, ...(l ?? [])]);
      setStatus("Link created. Copy it now: it is shown only once.");
      // The new URL is what the user came for: put focus on it, selected, ready to copy.
      requestAnimationFrame(() => {
        urlInput.current?.focus();
        urlInput.current?.select();
      });
    } catch (e) {
      setCreateError(errorText(e));
    } finally {
      setCreating(false);
    }
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied("copied");
      setStatus("Link copied.");
    } catch {
      // No clipboard access (an insecure origin, a denied permission): select it for Ctrl+C.
      urlInput.current?.focus();
      urlInput.current?.select();
      setCopied("manual");
      setStatus("The link is selected. Press Ctrl+C (or ⌘C) to copy it.");
    }
  };

  const revoke = async (link: ShareLink) => {
    if (revoking) return;
    setRevoking(link.id);
    try {
      await api.revokeShare(link.id);
      setLinks((l) => (l ?? []).filter((x) => x.id !== link.id));
      if (created?.id === link.id) setCreated(null);
      setStatus("Link revoked. It no longer opens the note.");
      // The row and its button are gone: keep focus inside the dialog, on the list or its heading.
      requestAnimationFrame(() => document.getElementById(listId)?.focus());
    } catch (e) {
      setStatus(errorText(e));
    } finally {
      setRevoking(null);
    }
  };

  return (
    <Modal label={`Share “${note.name}”`} describedBy={descId} onClose={onClose} className="max-w-lg" placement="top">
      <div className="float-panel p-6">
        <h2 id={titleId} className="text-[16px] font-medium leading-6 text-balance [overflow-wrap:anywhere]">
          Share “<span translate="no">{note.name}</span>”
        </h2>
        <p id={descId} className="mt-1 text-[13px] leading-5 text-muted">
          Anyone with the link can read this note, without signing in. Notes it links to stay private.
        </p>

        {/* Create */}
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
          className="mt-4 flex flex-wrap items-end gap-2"
        >
          <div className="min-w-40 flex-1">
            <label htmlFor={`${id}-expiry`} className="mb-2 block text-[13px] font-medium text-muted">
              Link expires
            </label>
            <select
              id={`${id}-expiry`}
              value={expiry}
              data-autofocus
              onChange={(e) => setExpiry(e.target.value as typeof expiry)}
              className="h-10 w-full rounded-lg border border-control bg-sheet px-2.5 text-[16px] text-fg md:text-[14px]"
            >
              {EXPIRY.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            aria-disabled={creating || undefined}
            aria-describedby={createError ? `${id}-create-err` : undefined}
            className="h-10 shrink-0 rounded-lg bg-accent px-4 text-[14px] font-medium text-navy transition-[filter] hover:brightness-95"
          >
            {creating ? "Creating link…" : "Create link"}
          </button>
        </form>
        {createError && (
          <p id={`${id}-create-err`} className="mt-2 text-[13px] text-negative wrap-break-word">
            {createError}
          </p>
        )}

        {/* The new URL, shown once */}
        {created && (
          <div className="mt-4 rounded-lg border border-border p-3">
            <label htmlFor={`${id}-url`} className="block text-[13px] font-medium text-fg">
              New link
            </label>
            <p id={`${id}-url-hint`} className="mt-0.5 text-[12px] leading-4 text-muted">
              Copy it now. For your privacy it is shown only once; you can always create another.
            </p>
            <div className="mt-2 flex gap-2">
              <input
                ref={urlInput}
                id={`${id}-url`}
                readOnly
                value={created.url}
                aria-describedby={`${id}-url-hint`}
                onFocus={(e) => e.currentTarget.select()}
                spellCheck={false}
                className="h-10 min-w-0 flex-1 rounded-lg border border-control bg-sheet px-3 font-mono text-[13px] text-fg"
              />
              <button
                type="button"
                onClick={() => void copy()}
                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-control px-3 text-[14px] font-medium transition-colors hover:bg-hover [&_svg]:size-4 [&_svg]:stroke-[1.5]"
              >
                <Copy aria-hidden="true" />
                {copied === "copied" ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}

        {/* Active links */}
        <h3 className="mt-5 text-[13px] font-medium text-muted">Active links</h3>
        <div id={listId} tabIndex={-1} className="mt-1 outline-none">
          {listError && !links ? (
            <p className="py-2 text-[13px] text-negative">
              {listError}{" "}
              <button type="button" onClick={() => void load()} className="font-medium text-accent-ink underline underline-offset-4">
                Try again
              </button>
            </p>
          ) : !links ? (
            <div aria-busy="true" className="py-1">
              <Bar w="70%" h={12} className="my-3" />
              <Bar w="55%" h={12} className="my-3" />
            </div>
          ) : links.length === 0 ? (
            <p className="py-2 text-[13px] text-faint">No active links. This note is private.</p>
          ) : (
            <ul className="divide-y divide-[var(--rule)]">
              {links.map((l) => (
                <li key={l.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1 text-[13px] leading-5">
                    <p className="text-fg">
                      Created <time dateTime={l.createdAt}>{formatDate(l.createdAt)}</time>
                      {l.id === created?.id && <span className="text-muted"> · new</span>}
                    </p>
                    <p className="text-faint">
                      {l.expiresAt ? (
                        <>
                          Expires <time dateTime={l.expiresAt}>{formatDate(l.expiresAt)}</time>
                        </>
                      ) : (
                        "Never expires"
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Revoke link created ${formatDate(l.createdAt)}`}
                    aria-disabled={revoking === l.id || undefined}
                    onClick={() => void revoke(l)}
                    className="h-8 shrink-0 rounded-lg border border-control px-3 text-[13px] font-medium text-negative transition-colors hover:bg-hover pointer-coarse:h-11"
                  >
                    {revoking === l.id ? "Revoking…" : "Revoke"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p role="status" className="mt-2 min-h-5 text-[13px] text-muted">
          {status}
        </p>

        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg border border-control px-4 text-[14px] font-medium transition-colors hover:bg-hover"
          >
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
