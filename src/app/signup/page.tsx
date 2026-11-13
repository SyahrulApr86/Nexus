import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { signupAllowed } from "@/lib/auth";

export const metadata: Metadata = { title: "Create your vault" };

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <Gate />
    </Suspense>
  );
}

/** Sign-up is closed unless NEXUS_ALLOW_SIGNUP=true; read per request, so a restart flips it. */
async function Gate() {
  await connection();
  if (!signupAllowed()) redirect("/login");
  return <AuthForm mode="signup" />;
}
