import { Link } from "@tanstack/react-router";
import { useCurrentUser } from "../api/auth.js";
import { Button } from "../components/ui.js";

/** Catch-all for unknown URLs. Sends people somewhere useful, not just away. */
export function NotFoundPage() {
  const { data: user } = useCurrentUser();

  return (
    <main className="flex min-h-full items-center justify-center bg-surface px-6">
      <div className="w-full max-w-md text-center">
        <p className="text-[13px] font-medium uppercase tracking-wide text-muted">
          404
        </p>
        <h1 className="mt-2 text-[32px] font-semibold leading-tight tracking-heading text-ink">
          This page doesn't exist
        </h1>
        <p className="mt-3 text-[16px] leading-relaxed text-muted">
          The link may be out of date, or the note it pointed to was moved or
          deleted. Deleted notes stay recoverable in your trash.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          {user ? (
            <>
              <Link to="/">
                <Button>Back to workspace</Button>
              </Link>
              <Link to="/trash">
                <Button variant="ghost">Open trash</Button>
              </Link>
            </>
          ) : (
            <>
              <Link to="/login">
                <Button>Log in</Button>
              </Link>
              <Link to="/welcome">
                <Button variant="ghost">See what Nexus does</Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
