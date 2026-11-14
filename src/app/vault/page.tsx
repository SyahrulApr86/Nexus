import { Suspense, ViewTransition } from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { Workspace } from "@/components/workspace/workspace";
import { PREFS_COOKIE, parsePrefsCookie } from "@/components/workspace/prefs-cookie";

export const metadata: Metadata = { title: "Vault" };

export default function VaultPage() {
  return (
    <Suspense fallback={<WorkspaceSkeleton />}>
      <ViewTransition enter="reveal" default="none">
        <Gate />
      </ViewTransition>
    </Suspense>
  );
}

async function Gate() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // The saved sidebar layout, so the server-rendered workspace already matches it.
  const initialPrefs = parsePrefsCookie((await cookies()).get(PREFS_COOKIE)?.value);
  return <Workspace user={{ name: user.name, email: user.email }} initialPrefs={initialPrefs} />;
}

// The skeleton is part of the prerendered shell, so it cannot read the cookie on the server.
// This runs before it paints and hides the sidebars the workspace will not show.
const skeletonScript = `(function(){try{var m=document.cookie.match(/(?:^|; )${PREFS_COOKIE}=([^;]*)/),e=document.getElementById('workspace-skeleton');if(!m||!e||m[1].length>1024)return;var p=JSON.parse(decodeURIComponent(m[1]));if(p.leftOpen===false)e.setAttribute('data-left','closed');if(p.rightOpen===false)e.setAttribute('data-right','closed')}catch(_){}})()`;

/** The workspace frame at its final size, values replaced by flat bars: no layout shift when it loads. */
function WorkspaceSkeleton() {
  return (
    <div
      id="workspace-skeleton"
      // The script below may set data-left / data-right before hydration.
      suppressHydrationWarning
      className="group/skeleton flex h-dvh flex-col bg-frame"
      aria-busy="true"
      style={{ paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}
    >
      <p role="status" className="sr-only">
        Opening your vault…
      </p>
      {/* Phone top bar, as in the workspace */}
      <div aria-hidden="true" className="h-12 shrink-0 border-b border-border bg-frame md:hidden" style={{ paddingTop: "env(safe-area-inset-top)" }} />
      <div aria-hidden="true" className="flex min-h-0 flex-1">
        {/* Rail: 52px, the mark at the top */}
        <div className="hidden w-[52px] md:flex md:justify-center md:pt-[13px]">
          <span className="block size-[22px] rounded-[3px] bg-active" />
        </div>
        {/* Sidebar: vault row 48px, find field 40px, tabs 36px, toolbar 40px, then 28px rows */}
        <div className="hidden w-[264px] md:block group-data-[left=closed]/skeleton:md:hidden">
          <div className="flex h-12 items-center gap-2.5 px-3.5">
            <span className="block size-6 rounded-[4px] bg-active" />
            <span className="block h-3 w-24 rounded bg-active" />
          </div>
          <div className="px-3 pb-2">
            <span className="block h-8 rounded-md border border-border bg-sheet" />
          </div>
          <div className="mx-3 h-9 border-b border-border" />
          <div className="h-10" />
          <div className="px-2">
            {[70, 52, 84, 60, 46].map((w, i) => (
              <div key={i} className="flex h-7 items-center px-2">
                <span className="block h-2.5 rounded bg-active" style={{ width: `${w}%` }} />
              </div>
            ))}
          </div>
        </div>
        {/* The inset sheet: tab strip 40px, view header 44px, the note's title and lines */}
        <div className="flex min-w-0 flex-1 flex-col bg-sheet md:my-2 md:mr-2 md:rounded-lg md:border md:border-border">
          <div className="flex flex-1">
            <div className="min-w-0 flex-1">
              <div className="hidden h-10 border-b border-border md:block" />
              <div className="hidden h-11 md:block" />
              <div className="mx-auto max-w-[46rem] space-y-4 px-5 pt-6 md:px-12 md:pt-12">
                <span className="block h-9 w-2/5 rounded bg-active md:h-[46px]" />
                <span className="block h-3.5 w-full rounded bg-active" />
                <span className="block h-3.5 w-11/12 rounded bg-active" />
                <span className="block h-3.5 w-3/4 rounded bg-active" />
              </div>
            </div>
            <div className="hidden w-[288px] border-l border-border lg:block group-data-[right=closed]/skeleton:lg:hidden" />
          </div>
          <div className="hidden h-7 border-t border-border md:block" />
        </div>
      </div>
      {/* Phone bottom bar */}
      <div aria-hidden="true" className="h-12 shrink-0 border-t border-border bg-frame md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)", boxSizing: "content-box" }} />
      <script dangerouslySetInnerHTML={{ __html: skeletonScript }} />
    </div>
  );
}
