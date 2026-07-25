import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { api } from "../api/client.js";
import { AuthLayout, Button, Field } from "../components/ui.js";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const request = useMutation({
    mutationFn: () =>
      api<{ message: string }>("/auth/request-password-reset", {
        method: "POST",
        body: JSON.stringify({ email }),
      }),
  });

  return (
    <AuthLayout title="Reset your password">
      {request.isSuccess ? (
        <p role="status" className="text-[16px] text-ink">
          {request.data.message}
        </p>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            request.mutate();
          }}
        >
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            hint="We'll send a reset link valid for 60 minutes."
          />
          <Button type="submit" disabled={request.isPending}>
            {request.isPending ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
      <p className="mt-4 text-[14px]">
        <Link to="/login" className="text-accent underline">
          Back to login
        </Link>
      </p>
    </AuthLayout>
  );
}
