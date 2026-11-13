"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { flushSync } from "react-dom";
import { signIn, signUp } from "@/lib/auth-client";

type FieldErrors = { email?: string; password?: string };

// The same shape better-auth accepts on the server, checked here so the message is ours, not the browser's.
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

const UNREACHABLE = "Nexus can’t be reached. Check your connection and try again.";
/**
 * One message for every sign-up failure the server does not explain safely, including an email that
 * already has an account: naming that case would tell anyone which emails are registered.
 */
export const SIGNUP_FAILED = "That vault can’t be created. If you already have one, sign in instead.";
export const SIGNUP_DISABLED = "Creating vaults is turned off on this server. Sign in, or ask its owner for an account.";
export const TOO_MANY = "Too many attempts. Wait a minute, then try again.";
export const BAD_CREDENTIALS = "That email and password don’t match. Check them and try again.";
/** Sign-up failures are shown no sooner than this, so a fast "already exists" looks like any other failure. */
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
    // Stay busy until the vault replaces this page.
    router.push("/vault");
    router.refresh();
  }

  const describe = (field: keyof FieldErrors) => [fieldErrors[field] ? `${errorId}-${field}` : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-frame px-4 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="group inline-block rounded text-[17px] font-semibold tracking-[-0.01em]" translate="no">
          <span aria-hidden="true" className="text-accent-ink">
            [[
          </span>
          <span className="decoration-1 underline-offset-4 group-hover:underline">Nexus</span>
          <span aria-hidden="true" className="text-accent-ink">
            ]]
          </span>
        </Link>
        <form onSubmit={onSubmit} noValidate className="mt-6 rounded-xl border border-border bg-sheet p-6">
          <h1 className="text-[22px] font-semibold leading-7">{isSignup ? "Create your vault" : "Sign in to your vault"}</h1>
          <p className="mt-1 text-muted">
            {isSignup ? "Your notes stay plain markdown you can export any time." : "Open your notes on this device."}
          </p>
          <div className="mt-6 space-y-4">
            {isSignup && <Field name="name" label="Name" autoComplete="name" />}
            <Field
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
            <p id={errorId} role="alert" className="mt-4 text-[14px] text-negative">
              {error}
            </p>
          )}
          <button
            aria-disabled={busy || undefined}
            className="mt-6 h-11 w-full rounded-lg bg-accent font-medium text-navy transition-[filter] hover:brightness-95 aria-disabled:opacity-60"
          >
            {busy ? (isSignup ? "Creating…" : "Signing in…") : isSignup ? "Create vault" : "Sign in"}
          </button>
        </form>
        <p className="mt-4 text-center text-muted">
          {isSignup ? "Already have a vault? " : "New to Nexus? "}
          <Link
            href={isSignup ? "/login" : "/signup"}
            className="font-medium text-accent-ink underline decoration-1 underline-offset-2 hover:decoration-2"
          >
            {isSignup ? "Sign in" : "Create one"}
          </Link>
        </p>
      </div>
    </main>
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
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const hintId = `${id}-hint`;
  // The error replaces the hint it restates, and is read first.
  const showHint = hint && !error;
  const desc = [describedBy, showHint ? hintId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-[14px] font-medium">
        {label}
      </label>
      <input
        id={id}
        {...props}
        aria-invalid={invalid || undefined}
        aria-describedby={desc}
        className="h-11 w-full rounded-lg border border-control bg-sheet px-3 text-[16px] aria-invalid:border-negative"
      />
      {error && (
        <p id={errorId} className="mt-1.5 text-[13px] text-negative">
          {error}
        </p>
      )}
      {showHint && (
        <p id={hintId} className="mt-1.5 text-[13px] text-faint">
          {hint}
        </p>
      )}
    </div>
  );
}
