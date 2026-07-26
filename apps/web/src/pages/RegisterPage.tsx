import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { validatePassword } from "@nexus/shared";
import { useRegister } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { AuthLayout, Button, Field } from "../components/ui.js";

export function RegisterPage() {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);
  const register = useRegister();
  const navigate = useNavigate();

  // FR-001: live, specific per-rule feedback
  const pwFailures = touched ? validatePassword(password) : [];
  const mismatch =
    confirmTouched && confirm.length > 0 && confirm !== password
      ? "Passwords do not match"
      : null;
  const serverError =
    register.error instanceof ApiError ? register.error.message : null;
  const duplicate =
    register.error instanceof ApiError && register.error.status === 409;
  // A 409 can be either identifier; route the message to the right field
  const usernameError =
    duplicate && /username/i.test(serverError ?? "") ? serverError : null;
  const emailError = usernameError ? null : serverError;

  return (
    <AuthLayout title="Create your account">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          setConfirmTouched(true);
          if (validatePassword(password).length > 0 || confirm !== password) {
            return;
          }
          register.mutate(
            { email, password, username: username.trim() },
            { onSuccess: () => navigate({ to: "/" }) },
          );
        }}
      >
        <Field
          label="Username"
          autoComplete="username"
          required
          minLength={3}
          maxLength={30}
          pattern="[A-Za-z0-9_\-]+"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          hint="You can sign in with this or your email. Letters, digits, _ and - only."
          error={usernameError}
        />
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={emailError}
        />
        {duplicate && !usernameError && (
          <p className="text-[14px]">
            <Link to="/login" className="text-accent underline">
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
        <Field
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            setConfirmTouched(true);
          }}
          error={mismatch}
        />
        <Button type="submit" disabled={register.isPending}>
          {register.isPending ? "Creating…" : "Create account"}
        </Button>
      </form>
      <p className="mt-4 text-[14px]">
        Already have an account?{" "}
        <Link to="/login" className="text-accent underline">
          Log in
        </Link>
      </p>
    </AuthLayout>
  );
}
