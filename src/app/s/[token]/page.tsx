import { Suspense, cache } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { HttpError, rateLimit } from "@/lib/session";
import { SHARE_LIMITS, clientIp, renderSharedNote, resolveShare } from "@/lib/shares";

/**
 * Public, read-only view of one shared note. No session: the token in the URL is the only key.
 * An unknown, revoked or expired token gets the same not-found page (not-found.tsx). Never indexed,
 * never sends the token on as a Referer; the frame and the stricter CSP are in ../layout.tsx.
 */

type Lookup = { kind: "ok"; name: string; html: string; updatedAt: Date } | { kind: "missing" } | { kind: "limited" };

/** One lookup per request, shared by the metadata and the page. */
const lookup = cache(async (token: string): Promise<Lookup> => {
  // Request time only: the rate limit and the expiry check read the clock.
  await connection();
  const h = await headers();
  try {
    rateLimit(`share-view:${clientIp(h)}`, SHARE_LIMITS.viewsPerMinute, 60_000);
  } catch (e) {
    if (e instanceof HttpError && e.status === 429) return { kind: "limited" };
    throw e;
  }
  const shared = await resolveShare(token);
  if (!shared) return { kind: "missing" };
  return {
    kind: "ok",
    name: shared.name,
    html: renderSharedNote(shared.content),
    updatedAt: shared.updatedAt,
  };
});

const robots: Metadata["robots"] = {
  index: false,
  follow: false,
  nocache: true,
  googleBot: { index: false, follow: false },
};

export async function generateMetadata({ params }: PageProps<"/s/[token]">): Promise<Metadata> {
  const found = await lookup((await params).token);
  return {
    title: found.kind === "ok" ? found.name : "Shared note",
    robots,
    referrer: "no-referrer",
  };
}

export default function SharePage({ params }: PageProps<"/s/[token]">) {
  return (
    <Suspense fallback={<NoteSkeleton />}>
      <SharedNote params={params} />
    </Suspense>
  );
}

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "long" });

async function SharedNote({ params }: { params: PageProps<"/s/[token]">["params"] }) {
  const found = await lookup((await params).token);
  if (found.kind === "missing") notFound();
  if (found.kind === "limited")
    return (
      <div className="sh-note">
        <h1 className="sh-title">Too many requests</h1>
        <p className="sh-lead">This link was opened too often from your network. Wait a minute, then reload the page.</p>
      </div>
    );
  return (
    <article className="sh-note">
      <h1 className="sh-title">{found.name}</h1>
      <p className="sh-meta">
        Updated <time dateTime={found.updatedAt.toISOString()}>{dateFormat.format(found.updatedAt)}</time>
      </p>
      {/* Sanitised by the app's markdown renderer (rehype-sanitize), then links and images made safe in renderSharedNote. */}
      <div className="reading sh-body" dangerouslySetInnerHTML={{ __html: found.html }} />
    </article>
  );
}

/** The note column at its final width, text replaced by flat bars: no layout shift when the note arrives. */
function NoteSkeleton() {
  return (
    <div className="sh-note" aria-busy="true">
      <p role="status" className="sr-only">
        Opening the shared note…
      </p>
      <div aria-hidden="true" className="sh-skel">
        <span style={{ width: "55%", height: 40 }} />
        <span style={{ width: "22%" }} />
        <span style={{ width: "100%" }} />
        <span style={{ width: "92%" }} />
        <span style={{ width: "74%" }} />
      </div>
    </div>
  );
}
