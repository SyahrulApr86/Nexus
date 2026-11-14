"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Copy } from "lucide-react";
import { getActiveVault } from "@/components/workspace/api";
import { Bar } from "@/components/workspace/ui";
import {
  TokensError,
  claudeCodeSnippet,
  claudeDesktopSnippet,
  mcpEndpoint,
  tokensApi,
  type ApiTokenInfo,
  type CreatedToken,
  type TokenScope,
} from "./tokens-api";
import "./mcp.css";

/*
 * Settings section: personal API tokens for AI assistants (MCP clients). A token is bound to one
 * vault and is shown once, right after it is made, with ready-to-copy client setups; the list below
 * shows live tokens (never their secret) with Revoke, confirmed in place.
 */

const EXPIRY = [
  { value: "never", label: "Never", days: null },
  { value: "7", label: "In 7 days", days: 7 },
  { value: "30", label: "In 30 days", days: 30 },
  { value: "90", label: "In 90 days", days: 90 },
  { value: "365", label: "In 1 year", days: 365 },
] as const;
type ExpiryValue = (typeof EXPIRY)[number]["value"];

const SCOPES: { value: TokenScope; label: string; hint: string }[] = [
  { value: "read", label: "Read only", hint: "Search and read notes" },
  { value: "write", label: "Read and write", hint: "Also create, edit, append to and move notes. Never delete." },
];

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium" });
const formatDate = (iso: string) => dateFormat.format(new Date(iso));
const errorText = (e: unknown) => (e instanceof TokensError ? e.message : "That didn’t work. Try again.");
const TOKEN_PLACEHOLDER = "<your token>";

const noopSubscribe = () => () => {};
/** This page's origin, after hydration (the server render has none). */
function useOrigin() {
  return useSyncExternalStore(noopSubscribe, () => window.location.origin, () => "");
}

/** Copies text; falls back to selecting `select` so Ctrl+C works without clipboard access. */
function CopyButton({ text, label, select, onDone }: { text: string; label: string; select?: () => void; onDone: (msg: string) => void }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      aria-label={copied ? undefined : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          onDone("Copied to the clipboard.");
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 2000);
        } catch {
          select?.();
          onDone("Selected. Press Ctrl+C (or ⌘C) to copy.");
        }
      }}
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-control px-3 text-[13px] font-medium transition-colors hover:bg-sheet-hover pointer-coarse:h-11 [&_svg]:size-4 [&_svg]:stroke-[1.5]"
    >
      <Copy aria-hidden="true" />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** A labelled, read-only code block with its Copy button. */
function Snippet({ id, title, hint, code, onStatus }: { id: string; title: string; hint: string; code: string; onStatus: (m: string) => void }) {
  const pre = useRef<HTMLPreElement>(null);
  const selectAll = () => {
    const el = pre.current;
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };
  return (
    <div className="mt-3">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h5 id={`${id}-title`} className="text-[13px] font-medium text-fg">
            {title}
          </h5>
          <p id={`${id}-hint`} className="text-[12px] leading-4 text-muted">
            {hint}
          </p>
        </div>
        <CopyButton text={code} label={`Copy the ${title} setup`} select={selectAll} onDone={onStatus} />
      </div>
      <pre
        ref={pre}
        tabIndex={0}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-hint`}
        className="mcp-snippet mt-2"
        translate="no"
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function McpTokensSection() {
  const id = useId();
  const origin = useOrigin();
  const [tokens, setTokens] = useState<ApiTokenInfo[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [vaults, setVaults] = useState<{ id: string; name: string; isDefault: boolean }[]>([]);
  const [name, setName] = useState("");
  const [vaultId, setVaultId] = useState("");
  const [scope, setScope] = useState<TokenScope>("read");
  const [expiry, setExpiry] = useState<ExpiryValue>("90");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedToken | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  const tokenInput = useRef<HTMLInputElement>(null);
  const listId = `${id}-list`;

  const load = useCallback(async () => {
    try {
      setTokens(await tokensApi.list());
      setListError(null);
    } catch (e) {
      setListError(errorText(e));
    }
  }, []);

  useEffect(() => {
    let live = true;
    tokensApi.list().then(
      (t) => live && setTokens(t),
      (e: unknown) => live && setListError(errorText(e)),
    );
    tokensApi.vaults().then(
      (v) => {
        if (!live) return;
        setVaults(v);
        const active = getActiveVault();
        setVaultId((cur) => cur || (v.find((x) => x.id === active) ?? v.find((x) => x.isDefault) ?? v[0])?.id || "");
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);

  const create = async () => {
    if (creating) return;
    if (!name.trim()) {
      setFormError("Give the token a name, such as the app that will use it.");
      nameInput.current?.focus();
      return;
    }
    setCreating(true);
    setFormError(null);
    try {
      const days = EXPIRY.find((x) => x.value === expiry)?.days ?? null;
      const t = await tokensApi.create({ name: name.trim(), scope, vaultId, expiresInDays: days });
      setCreated(t);
      setName("");
      const vaultName = vaults.find((v) => v.id === t.vaultId)?.name ?? "";
      const { token: _secret, ...info } = t;
      void _secret;
      setTokens((list) => [{ ...info, vaultName }, ...(list ?? [])]);
      setStatus("Token created. Copy it now: it is shown only once.");
      requestAnimationFrame(() => {
        tokenInput.current?.focus();
        tokenInput.current?.select();
      });
    } catch (e) {
      setFormError(errorText(e));
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (t: ApiTokenInfo) => {
    if (revoking) return;
    setRevoking(t.id);
    try {
      await tokensApi.revoke(t.id);
      setTokens((list) => (list ?? []).filter((x) => x.id !== t.id));
      if (created?.id === t.id) setCreated(null);
      setConfirming(null);
      setStatus(`Token “${t.name}” revoked. Clients using it can no longer connect.`);
      requestAnimationFrame(() => document.getElementById(listId)?.focus());
    } catch (e) {
      setStatus(errorText(e));
    } finally {
      setRevoking(null);
    }
  };

  const shownToken = created?.token ?? TOKEN_PLACEHOLDER;

  return (
    <section aria-labelledby={`${id}-heading`} className="mcp-section border-b border-rule py-5">
      <h3 id={`${id}-heading`} className="font-medium">
        AI assistants (MCP)
      </h3>
      <p className="mt-1 max-w-prose text-[13px] leading-5 text-muted">
        Let Claude and other MCP clients search, read and write the notes of one vault. A token works like a password for
        that vault: keep it private, and revoke it when you stop using it. Notes can never be deleted through MCP.
      </p>

      {/* Create */}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
        className="mt-4 grid gap-3 sm:grid-cols-2"
      >
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-name`} className="mb-1.5 block text-[13px] font-medium text-muted">
            Token name
          </label>
          <input
            ref={nameInput}
            id={`${id}-name`}
            value={name}
            maxLength={80}
            autoComplete="off"
            spellCheck={false}
            placeholder="Claude Code on my laptop"
            aria-invalid={formError && !name.trim() ? true : undefined}
            aria-describedby={formError ? `${id}-form-err` : undefined}
            onChange={(e) => setName(e.target.value)}
            className="h-10 w-full rounded-lg border border-control bg-sheet px-3 text-[16px] text-fg placeholder:text-faint md:text-[14px]"
          />
        </div>
        <div>
          <label htmlFor={`${id}-vault`} className="mb-1.5 block text-[13px] font-medium text-muted">
            Vault
          </label>
          <select
            id={`${id}-vault`}
            value={vaultId}
            onChange={(e) => setVaultId(e.target.value)}
            className="h-10 w-full rounded-lg border border-control bg-sheet px-2.5 text-[16px] text-fg md:text-[14px]"
          >
            {vaults.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-expiry`} className="mb-1.5 block text-[13px] font-medium text-muted">
            Expires
          </label>
          <select
            id={`${id}-expiry`}
            value={expiry}
            onChange={(e) => setExpiry(e.target.value as ExpiryValue)}
            className="h-10 w-full rounded-lg border border-control bg-sheet px-2.5 text-[16px] text-fg md:text-[14px]"
          >
            {EXPIRY.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 text-[13px] font-medium text-muted">Access</legend>
          <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
            {SCOPES.map((s) => (
              <label key={s.value} className="flex min-h-10 cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-sheet-hover sm:flex-1">
                <input
                  type="radio"
                  name={`${id}-scope`}
                  value={s.value}
                  checked={scope === s.value}
                  onChange={() => setScope(s.value)}
                  className="mt-1 size-4 accent-[var(--accent)]"
                />
                <span>
                  <span className="block text-[14px]">{s.label}</span>
                  <span className="block text-[12px] leading-4 text-muted">{s.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button
            type="submit"
            aria-disabled={creating || !vaultId || undefined}
            className="h-10 shrink-0 rounded-lg bg-accent px-4 text-[14px] font-medium text-navy transition-[filter] hover:brightness-95"
          >
            {creating ? "Creating token…" : "Create token"}
          </button>
          {formError && (
            <p id={`${id}-form-err`} className="text-[13px] text-negative wrap-break-word">
              {formError}
            </p>
          )}
        </div>
      </form>

      {/* The new token, shown once */}
      {created && (
        <div className="mt-4 rounded-lg border border-border p-3">
          <label htmlFor={`${id}-token`} className="block text-[13px] font-medium text-fg">
            New token for “<span translate="no">{created.name}</span>”
          </label>
          <p id={`${id}-token-hint`} className="mt-0.5 text-[12px] leading-4 text-muted">
            Copy it now. It is shown only once; if you lose it, revoke it and create another.
          </p>
          <div className="mt-2 flex gap-2">
            <input
              ref={tokenInput}
              id={`${id}-token`}
              readOnly
              value={created.token}
              aria-describedby={`${id}-token-hint`}
              onFocus={(e) => e.currentTarget.select()}
              spellCheck={false}
              autoComplete="off"
              className="h-10 min-w-0 flex-1 rounded-lg border border-control bg-sheet px-3 text-[13px] text-fg mcp-code"
            />
            <CopyButton
              text={created.token}
              label="Copy the token"
              select={() => {
                tokenInput.current?.focus();
                tokenInput.current?.select();
              }}
              onDone={setStatus}
            />
          </div>
        </div>
      )}

      {/* Client setup */}
      <h4 className="mt-5 text-[13px] font-medium text-muted">Connect a client</h4>
      <p className="mt-0.5 text-[12px] leading-4 text-muted">
        Endpoint <code className="mcp-inline-code" translate="no">{origin ? mcpEndpoint(origin) : "/api/mcp"}</code>
        {created ? ", with your new token filled in." : `. Replace ${TOKEN_PLACEHOLDER} with a token.`}
      </p>
      <Snippet
        id={`${id}-cc`}
        title="Claude Code"
        hint="Run in a terminal."
        code={claudeCodeSnippet(origin, shownToken)}
        onStatus={setStatus}
      />
      <Snippet
        id={`${id}-cd`}
        title="Claude Desktop"
        hint="Add to claude_desktop_config.json. Uses the open-source mcp-remote bridge (needs Node.js)."
        code={claudeDesktopSnippet(origin, shownToken)}
        onStatus={setStatus}
      />

      {/* Live tokens */}
      <h4 className="mt-5 text-[13px] font-medium text-muted">Active tokens</h4>
      <div id={listId} tabIndex={-1} className="mt-1 outline-none">
        {listError && !tokens ? (
          <p className="py-2 text-[13px] text-negative">
            {listError}{" "}
            <button type="button" onClick={() => void load()} className="font-medium text-accent-ink underline underline-offset-4">
              Try again
            </button>
          </p>
        ) : !tokens ? (
          <div aria-busy="true" className="py-1">
            <Bar w="70%" h={12} className="my-3" />
            <Bar w="55%" h={12} className="my-3" />
          </div>
        ) : tokens.length === 0 ? (
          <p className="py-2 text-[13px] text-muted">No tokens yet. No AI assistant can reach your notes.</p>
        ) : (
          <ul className="divide-y divide-[var(--rule)]">
            {tokens.map((t) => (
              <li key={t.id} className="py-2.5">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-1 text-[13px] leading-5">
                    <p className="font-medium text-fg [overflow-wrap:anywhere]">
                      <span translate="no">{t.name}</span>
                      <span className="font-normal text-muted"> · {t.scope === "write" ? "Read and write" : "Read only"}</span>
                    </p>
                    <p className="text-muted [overflow-wrap:anywhere]">
                      <code className="mcp-inline-code" translate="no">
                        {t.prefix}…
                      </code>{" "}
                      · <span translate="no">{t.vaultName}</span>
                    </p>
                    <p className="text-muted">
                      Created <time dateTime={t.createdAt}>{formatDate(t.createdAt)}</time>
                      {" · "}
                      {t.lastUsedAt ? (
                        <>
                          Last used <time dateTime={t.lastUsedAt}>{formatDate(t.lastUsedAt)}</time>
                        </>
                      ) : (
                        "Never used"
                      )}
                      {" · "}
                      {t.expiresAt ? (
                        <>
                          Expires <time dateTime={t.expiresAt}>{formatDate(t.expiresAt)}</time>
                        </>
                      ) : (
                        "Never expires"
                      )}
                    </p>
                  </div>
                  {confirming !== t.id && (
                    <button
                      id={`${id}-revoke-${t.id}`}
                      type="button"
                      aria-label={`Revoke token “${t.name}”`}
                      onClick={() => {
                        setConfirming(t.id);
                        requestAnimationFrame(() => document.getElementById(`${id}-confirm-${t.id}`)?.focus());
                      }}
                      className="h-8 shrink-0 rounded-lg border border-control px-3 text-[13px] font-medium text-negative transition-colors hover:bg-sheet-hover pointer-coarse:h-11"
                    >
                      Revoke
                    </button>
                  )}
                </div>
                {confirming === t.id && (
                  <div role="group" aria-labelledby={`${id}-confirm-text-${t.id}`} className="mt-2 rounded-lg border border-border p-3">
                    <p id={`${id}-confirm-text-${t.id}`} className="text-[13px] leading-5 text-fg">
                      Revoke “<span translate="no">{t.name}</span>”? Clients using it stop working at once. This cannot be undone.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        id={`${id}-confirm-${t.id}`}
                        type="button"
                        aria-disabled={revoking === t.id || undefined}
                        onClick={() => void revoke(t)}
                        className="h-9 rounded-lg bg-negative px-3 text-[13px] font-medium text-[var(--on-negative)] transition-colors hover:bg-negative-hover pointer-coarse:h-11"
                      >
                        {revoking === t.id ? "Revoking…" : "Revoke token"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirming(null);
                          requestAnimationFrame(() => document.getElementById(`${id}-revoke-${t.id}`)?.focus());
                        }}
                        className="h-9 rounded-lg border border-control px-3 text-[13px] font-medium transition-colors hover:bg-sheet-hover pointer-coarse:h-11"
                      >
                        Keep it
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p role="status" className="mt-2 min-h-5 text-[13px] text-muted">
        {status}
      </p>
    </section>
  );
}
