import Link from "next/link";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/session";

type Props = { className: string; children: React.ReactNode };

/**
 * "Open your vault": signed-in visitors go straight to /vault, everyone else to /login.
 * Rendered inside <Suspense> with <VaultLinkFallback> (the /login link) so the page shell stays
 * prerendered; only this link waits for the request. No session cookie means no auth lookup at all.
 */
export async function VaultLink({ className, children }: Props) {
  const jar = await cookies();
  const hasSessionCookie = jar.getAll().some((c) => c.name.endsWith("better-auth.session_token"));
  let signedIn = false;
  if (hasSessionCookie) {
    try {
      signedIn = Boolean(await getSessionUser());
    } catch {
      signedIn = false; // auth or database unreachable: /login explains what to do next
    }
  }
  return (
    <Link href={signedIn ? "/vault" : "/login"} className={className}>
      {children}
    </Link>
  );
}

export function VaultLinkFallback({ className, children }: Props) {
  return (
    <Link href="/login" className={className}>
      {children}
    </Link>
  );
}
