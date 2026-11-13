"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { signIn, signUp } from "@/lib/auth-client";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errorId = useId();
  const isSignup = mode === "signup";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email"));
    const password = String(f.get("password"));
    const res = isSignup
      ? await signUp.email({ email, password, name: String(f.get("name") || email.split("@")[0]) })
      : await signIn.email({ email, password });
    setBusy(false);
    if (res.error) {
      setError(
        res.error.status === 401 || res.error.code === "INVALID_EMAIL_OR_PASSWORD"
          ? "That email and password don’t match. Check them and try again."
          : (res.error.message ?? "Something went wrong. Try again."),
      );
      // Move focus to the first field so the error and the fix are close together.
      e.currentTarget.querySelector<HTMLInputElement>("input")?.focus();
      return;
    }
    router.push("/vault");
    router.refresh();
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-frame px-4 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="inline-block rounded text-[17px] font-semibold tracking-[-0.01em]" translate="no">
          <span aria-hidden="true" className="text-accent-ink">
            [[
          </span>
          Nexus
          <span aria-hidden="true" className="text-accent-ink">
            ]]
          </span>
        </Link>
        <form onSubmit={onSubmit} noValidate={false} className="mt-6 rounded-xl border border-border bg-sheet p-6">
          <h1 className="text-[22px] font-semibold leading-7">{isSignup ? "Create your vault" : "Sign in to your vault"}</h1>
          <p className="mt-1 text-muted">
            {isSignup ? "Your notes stay plain markdown you can export any time." : "Open your notes on this device."}
          </p>
          <div className="mt-6 space-y-4">
            {isSignup && <Field name="name" label="Name" autoComplete="name" />}
            <Field name="email" label="Email" type="email" autoComplete="email" inputMode="email" spellCheck={false} required aria-describedby={error ? errorId : undefined} />
            <Field
              name="password"
              label="Password"
              type="password"
              autoComplete={isSignup ? "new-password" : "current-password"}
              minLength={8}
              required
              hint={isSignup ? "At least 8 characters" : undefined}
              aria-describedby={error ? errorId : undefined}
            />
          </div>
          {error && (
            <p id={errorId} role="alert" className="mt-4 text-[14px] text-negative">
              {error}
            </p>
          )}
          <button
            disabled={busy}
            className="mt-6 h-11 w-full rounded-lg bg-accent font-medium text-navy transition-[filter] hover:brightness-95 disabled:opacity-60"
          >
            {busy ? (isSignup ? "Creating…" : "Signing in…") : isSignup ? "Create vault" : "Sign in"}
          </button>
        </form>
        <p className="mt-4 text-center text-muted">
          {isSignup ? "Already have a vault? " : "New to Nexus? "}
          <Link href={isSignup ? "/login" : "/signup"} className="font-medium text-accent-ink underline-offset-2 hover:underline">
            {isSignup ? "Sign in" : "Create one"}
          </Link>
        </p>
      </div>
    </main>
  );
}

function Field({ label, hint, ...props }: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-[14px] font-medium">
        {label}
      </label>
      <input
        id={id}
        {...props}
        className="h-11 w-full rounded-lg border border-control bg-sheet px-3 text-[16px] outline-none focus-visible:border-transparent"
      />
      {hint && <p className="mt-1.5 text-[13px] text-faint">{hint}</p>}
    </div>
  );
}
