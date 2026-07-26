import { useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useLogin } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { AuthLayout, Button, Field } from "../components/ui.js";

export function LoginPage() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const login = useLogin();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as {
    expired?: boolean;
    reset?: boolean;
  };

  const error =
    login.error instanceof ApiError ? login.error.message : null;

  return (
    <AuthLayout title="Log in to your workspace">
      {search.expired && (
        <p
          role="status"
          className="mb-4 rounded-control border border-border bg-surface px-3 py-2 text-[14px] text-muted"
        >
          Your session expired. Please log in again.
        </p>
      )}
      {search.reset && (
        <p
          role="status"
          className="mb-4 rounded-control border border-border bg-surface px-3 py-2 text-[14px] text-muted"
        >
          Password updated. Log in with your new password.
        </p>
      )}
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate(
            { identifier, password },
            { onSuccess: () => navigate({ to: "/" }) },
          );
        }}
      >
        <Field
          label="Username or email"
          autoComplete="username"
          required
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          error={error}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" disabled={login.isPending}>
          {login.isPending ? "Logging in…" : "Log in"}
        </Button>
      </form>
      <div className="mt-4 flex justify-between text-[14px]">
        <Link to="/register" className="text-accent underline">
          Create an account
        </Link>
        <Link to="/forgot-password" className="text-accent underline">
          Forgot password?
        </Link>
      </div>
    </AuthLayout>
  );
}
