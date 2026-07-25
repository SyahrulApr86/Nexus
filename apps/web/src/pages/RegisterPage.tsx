import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { validatePassword } from "@nexus/shared";
import { useRegister } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { AuthLayout, Button, Field } from "../components/ui.js";

export function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState(false);
  const register = useRegister();
  const navigate = useNavigate();

  // FR-001: live, specific per-rule feedback
  const pwFailures = touched ? validatePassword(password) : [];
  const serverError =
    register.error instanceof ApiError ? register.error.message : null;
  const duplicate =
    register.error instanceof ApiError && register.error.status === 409;

  return (
    <AuthLayout title="Create your account">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (validatePassword(password).length > 0) {
            setTouched(true);
            return;
          }
          register.mutate(
            { email, password },
            { onSuccess: () => navigate({ to: "/" }) },
          );
        }}
      >
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={serverError}
        />
        {duplicate && (
          <p className="text-[14px]">
            <Link to="/login" className="text-accent hover:underline">
              Go to login
            </Link>
          </p>
        )}
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setTouched(true);
          }}
          hint="At least 8 characters with uppercase, lowercase, digit, and special character."
          error={pwFailures.length > 0 ? pwFailures.join("\n") : null}
        />
        <Button type="submit" disabled={register.isPending}>
          {register.isPending ? "Creating…" : "Create account"}
        </Button>
      </form>
      <p className="mt-4 text-[14px]">
        Already have an account?{" "}
        <Link to="/login" className="text-accent hover:underline">
          Log in
        </Link>
      </p>
    </AuthLayout>
  );
}
