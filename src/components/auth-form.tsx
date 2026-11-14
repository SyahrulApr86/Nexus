"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { signIn, signUp } from "@/lib/auth-client";
import { VaultBars } from "@/components/landing/atlas";
import { BacklinksFragment, CanvasFragment, GraphFragment, SearchFragment } from "@/components/landing/fragments";
import "@/components/landing/tokens.css";
import "@/components/landing/atlas.css";
import "@/components/landing/fragments.css";
import "@/components/landing/auth.css";

type FieldErrors = { email?: string; password?: string };

// The same shape better-auth accepts on the server, checked here so the message is ours, not the browser's.
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

const UNREACHABLE = "Nexus can’t be reached. Check your connection and try again.";
/**
 * One message for every sign-up failure the server does not explain safely. An email that already
 * has an account is not a failure: the server answers it exactly like a new one (src/lib/auth.ts).
 */
export const SIGNUP_FAILED = "That vault can’t be created. If you already have one, sign in instead.";
export const SIGNUP_DISABLED = "Creating vaults is turned off on this server. Sign in, or ask its owner for an account.";
export const TOO_MANY = "Too many attempts. Wait a minute, then try again.";
export const BAD_CREDENTIALS = "That email and password don’t match. Check them and try again.";
/**
 * Shown on the sign-in page after any accepted sign-up. Sign-up never creates a session and answers a
 * registered email like a new one, so this copy must hold for both cases without saying which happened.
 */
export const SIGNUP_DONE = "If this email is new, your vault is ready. Sign in to open it. If you already had a vault, use its password.";
/** Where an accepted sign-up lands; the query only switches on SIGNUP_DONE and carries nothing else. */
export const SIGNUP_DONE_URL = "/login?created=1";
/** Sign-up failures are shown no sooner than this, so a fast failure looks like any other. */
const SIGNUP_MIN_MS = 800;

type AuthError = { code?: string; status?: number };
type Outcome = { email?: string; password?: string; form?: string };

/** Fixed copy for a Better Auth error; the server's own message is never shown. */
export function describeAuthError(err: AuthError, isSignup: boolean): Outcome {
  const code = err.code ?? "";
  if (code === "INVALID_EMAIL") return { email: "Enter an email address like name@example.com." };
  if (code === "PASSWORD_TOO_SHORT") return { password: "Use at least 8 characters." };
  if (code === "PASSWORD_TOO_LONG") return { password: "Use at most 128 characters." };
  if (!err.status) return { form: UNREACHABLE };
  if (err.status === 429) return { form: TOO_MANY };
  if (isSignup) return { form: code === "EMAIL_PASSWORD_SIGN_UP_DISABLED" ? SIGNUP_DISABLED : SIGNUP_FAILED };
  if (err.status === 401 || code === "INVALID_EMAIL_OR_PASSWORD") return { form: BAD_CREDENTIALS };
  return { form: "Something went wrong. Try again." };
}

const noSubscribe = () => () => {};
const readCreated = () => new URLSearchParams(window.location.search).get("created") === "1";
const serverCreated = () => false;

function validate(email: string, password: string, isSignup: boolean): FieldErrors {
  const errors: FieldErrors = {};
  if (!email) errors.email = "Enter your email.";
  else if (!EMAIL.test(email)) errors.email = "Enter an email address like name@example.com.";
  if (!password) errors.password = "Enter your password.";
  else if (isSignup && password.length < 8) errors.password = "Use at least 8 characters.";
  return errors;
}

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const errorId = useId();
  const isSignup = mode === "signup";
  const noticeId = `${errorId}-notice`;
  const created = useSyncExternalStore(noSubscribe, readCreated, serverCreated) && !isSignup;
  const emailRef = useRef<HTMLInputElement>(null);

  // Arriving from sign-up: start on the email field, which also reads the notice (aria-describedby).
  useEffect(() => {
    if (created) emailRef.current?.focus();
  }, [created]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    // Keep the form: React clears e.currentTarget once the handler awaits.
    const form = e.currentTarget;
    const focusField = (name: string) => form.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.focus();
    const f = new FormData(form);
    const email = String(f.get("email") ?? "").trim();
    const password = String(f.get("password") ?? "");

    const local = validate(email, password, isSignup);
    if (local.email || local.password) {
      // Commit the messages first, so the field already carries them when focus lands.
      flushSync(() => {
        setError(null);
        setFieldErrors(local);
      });
      focusField(local.email ? "email" : "password");
      return;
    }

    setBusy(true);
    setError(null);
    setFieldErrors({});
    const started = performance.now();
    let res;
    try {
      res = isSignup
        ? await signUp.email({ email, password, name: String(f.get("name") || email.split("@")[0]) })
        : await signIn.email({ email, password });
    } catch {
      flushSync(() => {
        setBusy(false);
        setError(UNREACHABLE);
      });
      focusField("email");
      return;
    }
    if (res.error) {
      const out = describeAuthError(res.error, isSignup);
      const next: FieldErrors = { email: out.email, password: out.password };
      const formError = out.form ?? null;
      if (isSignup) {
        const wait = SIGNUP_MIN_MS - (performance.now() - started);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
      flushSync(() => {
        setBusy(false);
        setFieldErrors(next);
        setError(formError);
      });
      // Put focus next to the problem: the field it names, or the email field for a form-level error.
      focusField(next.password && !next.email ? "password" : "email");
      return;
    }
    // Stay busy until the next page replaces this one. Sign-up returns no session (token null), and the
    // same answer for a new and a registered email, so it always continues on the sign-in page.
    if (isSignup && !res.data?.token) {
      router.push(SIGNUP_DONE_URL);
      return;
    }
    router.push("/vault");
    router.refresh();
  }

  const describe = (field: keyof FieldErrors) =>
    [fieldErrors[field] ? `${errorId}-${field}` : null, error ? errorId : null, field === "email" && created ? noticeId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div className="lp-dark au">
      <header className="au-top">
        <Link href="/" className="au-wordmark" translate="no" aria-label="Nexus home">
          <span aria-hidden="true">[[</span>
          Nexus
          <span aria-hidden="true">]]</span>
        </Link>
        <Link href="/#self-host" className="au-top-link">
          Run your own server
        </Link>
      </header>
      <main className="au-main">
        <div className="au-intro">
          <h1 id={`${errorId}-title`} className="au-title">
            {isSignup ? "Create your vault" : "Sign in to your vault"}
          </h1>
          <p className="au-lead">
            {isSignup ? "Your notes stay plain markdown you can export any time." : "Open your notes on this device."}
          </p>
          <div className="au-glimpse" aria-label="Inside a vault" role="group">
            <BacklinksFragment />
            <SearchFragment />
            <CanvasFragment />
            <GraphFragment />
          </div>
        </div>
        <div className="au-panel">
          <form onSubmit={onSubmit} noValidate className="au-form" aria-labelledby={`${errorId}-title`}>
            {created && (
              <p id={noticeId} role="status" className="au-notice">
                {SIGNUP_DONE}
              </p>
            )}
            <div className="au-fields">
              {isSignup && <Field name="name" label="Name" autoComplete="name" />}
              <Field
                ref={emailRef}
                name="email"
                label="Email"
                type="email"
                autoComplete="email"
                inputMode="email"
                spellCheck={false}
                required
                error={fieldErrors.email}
                errorId={`${errorId}-email`}
                invalid={!!fieldErrors.email || !!error}
                aria-describedby={describe("email")}
              />
              <Field
                name="password"
                label="Password"
                type="password"
                autoComplete={isSignup ? "new-password" : "current-password"}
                minLength={isSignup ? 8 : undefined}
                required
                hint={isSignup ? "At least 8 characters" : undefined}
                error={fieldErrors.password}
                errorId={`${errorId}-password`}
                invalid={!!fieldErrors.password || !!error}
                aria-describedby={describe("password")}
              />
            </div>
            {error && (
              <p id={errorId} role="alert" className="au-error">
                {error}
              </p>
            )}
            <button aria-disabled={busy || undefined} className="lp-btn lp-btn-primary au-submit">
              {busy ? (isSignup ? "Creating…" : "Signing in…") : isSignup ? "Create vault" : "Sign in"}
            </button>
          </form>
          <p className="au-switch">
            {isSignup ? "Already have a vault? " : "New to Nexus? "}
            <Link href={isSignup ? "/login" : "/signup"} className="au-link">
              {isSignup ? "Sign in" : "Create one"}
            </Link>
          </p>
        </div>
      </main>
      <VaultBars className="au-bars" count={180} seed={11} />
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  errorId,
  invalid,
  "aria-describedby": describedBy,
  ...props
}: {
  label: string;
  hint?: string;
  error?: string;
  errorId?: string;
  invalid?: boolean;
} & React.ComponentProps<"input">) {
  const id = useId();
  const hintId = `${id}-hint`;
  // The error replaces the hint it restates, and is read first.
  const showHint = hint && !error;
  const desc = [describedBy, showHint ? hintId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="au-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        {...props}
        aria-invalid={invalid || undefined}
        aria-describedby={desc}
        className="au-input"
      />
      {error && (
        <p id={errorId} className="au-field-error">
          {error}
        </p>
      )}
      {showHint && (
        <p id={hintId} className="au-hint">
          {hint}
        </p>
      )}
    </div>
  );
}
