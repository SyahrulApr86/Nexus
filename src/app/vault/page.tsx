import { Suspense, ViewTransition } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { Workspace } from "@/components/workspace/workspace";

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
  return <Workspace user={{ name: user.name, email: user.email }} />;
}

/** The workspace frame at its final size, values replaced by flat bars: no layout shift when it loads. */
function WorkspaceSkeleton() {
  return (
    <div className="flex h-dvh bg-frame" aria-busy="true" aria-label="Opening your vault">
      <div className="hidden w-11 md:block" />
      <div className="hidden w-[260px] space-y-3 px-4 pt-14 md:block">
        {[70, 52, 84, 60, 46].map((w, i) => (
          <span key={i} className="block h-2.5 rounded bg-active" style={{ width: `${w}%` }} />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col md:pt-10">
        <div className="flex-1 bg-sheet md:mb-7 md:mr-2 md:rounded-[14px] md:border md:border-border">
          <div className="mx-auto max-w-[42rem] space-y-4 px-6 pt-16 md:px-10">
            <span className="block h-7 w-2/5 rounded bg-active" />
            <span className="block h-3.5 w-full rounded bg-active" />
            <span className="block h-3.5 w-11/12 rounded bg-active" />
            <span className="block h-3.5 w-3/4 rounded bg-active" />
          </div>
        </div>
      </div>
      <div className="hidden w-[280px] lg:block" />
    </div>
  );
}
