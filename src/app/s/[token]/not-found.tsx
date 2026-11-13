import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Link not available",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** Same page for an unknown, revoked or expired link, so the answer never tells which. */
export default function ShareNotFound() {
  return (
    <div className="rounded-[14px] border border-border bg-sheet px-5 py-7 md:px-10 md:py-12">
      <h1 className="font-note text-2xl font-semibold text-balance">This link is not available</h1>
      <p className="mt-3 max-w-[60ch] font-ui text-[15px] leading-6 text-muted">
        It may have been revoked or may have expired, or the address may be incomplete. Ask the person who shared it for
        a new link.
      </p>
    </div>
  );
}
