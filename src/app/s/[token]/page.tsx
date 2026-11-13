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
      <Sheet>
        <h1 className="font-note text-2xl font-semibold text-balance">Too many requests</h1>
        <p className="mt-3 font-ui text-[15px] leading-6 text-muted">
          This link was opened too often from your network. Wait a minute, then reload the page.
        </p>
      </Sheet>
    );
  return (
    <>
      <Sheet>
        <article>
          <h1 className="font-note text-[24px] leading-8 font-semibold tracking-[-0.01em] text-balance [overflow-wrap:anywhere] md:text-[28px] md:leading-9">
            {found.name}
          </h1>
          <p className="mt-2 mb-8 font-ui text-[13px] leading-5 text-muted">
            Updated <time dateTime={found.updatedAt.toISOString()}>{dateFormat.format(found.updatedAt)}</time>
          </p>
          {/* Sanitised by the app's markdown renderer (rehype-sanitize), then links and images made safe in renderSharedNote. */}
          <div className="reading" dangerouslySetInnerHTML={{ __html: found.html }} />
        </article>
      </Sheet>
      <p className="mx-auto mt-4 max-w-[700px] px-3 text-center font-ui text-[13px] leading-5 text-muted md:px-0">
        Anyone with this link can read this note. Links to other notes show as plain text.
      </p>
    </>
  );
}

/** The note sheet: the app's reading view, centred on the 700px measure. */
function Sheet({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[14px] border border-border bg-sheet px-5 py-7 md:px-10 md:py-12">
      <div className="mx-auto max-w-[700px]">{children}</div>
    </div>
  );
}

/** The sheet at its final width, text replaced by flat bars: no layout shift when the note arrives. */
function NoteSkeleton() {
  return (
    <div className="rounded-[14px] border border-border bg-sheet px-5 py-7 md:px-10 md:py-12" aria-busy="true">
      <p role="status" className="sr-only">
        Opening the shared note…
      </p>
      <div aria-hidden="true" className="space-y-4">
        <span className="block h-7 w-2/5 rounded bg-active" />
        <span className="block h-3 w-1/4 rounded bg-active" />
        <span className="block h-3.5 w-full rounded bg-active" />
        <span className="block h-3.5 w-11/12 rounded bg-active" />
        <span className="block h-3.5 w-3/4 rounded bg-active" />
      </div>
    </div>
  );
}
