import Link from "next/link";

// Interim landing page. The real one is being designed (Round 1 typography directions A–J).
export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col justify-center bg-frame px-6 py-16">
      <div className="mx-auto w-full max-w-2xl">
        <p className="text-[17px] font-semibold tracking-[-0.01em]" translate="no">
          <span aria-hidden="true" className="text-accent-ink">
            [[
          </span>
          Nexus
          <span aria-hidden="true" className="text-accent-ink">
            ]]
          </span>
        </p>
        <h1 className="mt-6 text-[40px] font-semibold leading-[1.1] tracking-[-0.02em] text-balance sm:text-[52px]">
          Notes that link to each other, in plain markdown.
        </h1>
        <p className="mt-5 max-w-xl text-[18px] leading-7 text-muted">
          Open your vault in any browser, on any device. Type [[ to connect one note to another, and every link shows
          up as a backlink on the other side. Your notes stay .md files you can export whenever you want.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link href="/vault" className="inline-flex h-11 items-center rounded-lg bg-accent px-5 font-medium text-navy transition-[filter] hover:brightness-95">
            Open your vault
          </Link>
          <Link href="/signup" className="font-medium text-accent-ink underline-offset-2 hover:underline">
            Create an account
          </Link>
        </div>
      </div>
    </main>
  );
}
