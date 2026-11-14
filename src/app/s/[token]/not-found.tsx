import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Link not available",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** Same page for an unknown, revoked or expired link, so the answer never tells which. */
export default function ShareNotFound() {
  return (
    <div className="sh-note">
      <h1 className="sh-title">This link is not available</h1>
      <p className="sh-lead">
        It may have been revoked or may have expired, or the address may be incomplete. Ask the person who shared it for
        a new link.
      </p>
    </div>
  );
}
