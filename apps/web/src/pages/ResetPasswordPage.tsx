import { useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { validatePassword } from "@nexus/shared";
import { api, ApiError } from "../api/client.js";
import { AuthLayout, Button, Field } from "../components/ui.js";

export function ResetPasswordPage() {
  const search = useSearch({ strict: false }) as { token?: string };
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState(false);
  const navigate = useNavigate();

  const reset = useMutation({
    mutationFn: () =>
      api<{ message: string }>("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token: search.token ?? "", password }),
      }),
    onSuccess: () => navigate({ to: "/login", search: { reset: true } }),
  });

  const pwFailures = touched ? validatePassword(password) : [];
  const serverError =
    reset.error instanceof ApiError ? reset.error.message : null;

  if (!search.token) {
    return (
      <AuthLayout title="Reset your password">
        <p className="text-[16px] text-ink">
          This reset link is invalid or has expired.{" "}
          <Link to="/forgot-password" className="text-accent underline">
            Request a new one
          </Link>
          .
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (validatePassword(password).length > 0) {
            setTouched(true);
            return;
          }
          reset.mutate();
        }}
      >
        <Field
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setTouched(true);
          }}
          hint="At least 8 characters with uppercase, lowercase, digit, and special character."
          error={
            pwFailures.length > 0 ? pwFailures.join("\n") : serverError
          }
        />
        {serverError && (
          <p className="text-[14px]">
            <Link to="/forgot-password" className="text-accent underline">
              Request a new link
            </Link>
          </p>
        )}
        <Button type="submit" disabled={reset.isPending}>
          {reset.isPending ? "Updating…" : "Update password"}
        </Button>
      </form>
    </AuthLayout>
  );
}
