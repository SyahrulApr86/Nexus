import "./share.css";
import Link from "next/link";
import { sharePolicy } from "@/lib/shares";

/** Frame of the public share pages: no app chrome, only the product name and what this page is. */
export default function ShareLayout({ children }: LayoutProps<"/s">) {
  return (
    <>
      {/* Narrows the app-wide header CSP for these pages (a browser enforces both). */}
      <meta httpEquiv="Content-Security-Policy" content={sharePolicy()} />
      <div
        className="flex min-h-dvh flex-col bg-frame text-fg"
        style={{
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
        }}
      >
        <header className="mx-auto flex h-14 w-full max-w-[48rem] items-center justify-between gap-4 px-4 font-ui text-sm md:px-6">
          <Link
            href="/"
            className="-mx-2 inline-flex h-11 items-center px-2 font-semibold text-fg underline-offset-4 hover:underline"
          >
            Nexus
          </Link>
          <span className="text-muted">Read-only shared note</span>
        </header>
        <main className="mx-auto w-full max-w-[48rem] flex-1 px-4 pb-8 md:px-6">{children}</main>
      </div>
    </>
  );
}
