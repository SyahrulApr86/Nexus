import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { Landing } from "@/components/landing/landing";
import { publicOrigin } from "@/lib/public-origin";

const TITLE = "Nexus: notes that link to each other, in plain markdown";
const DESCRIPTION =
  "Linked markdown notes in any browser: [[links]] and backlinks, a graph, search with operators and live preview. Your vault stays plain .md files, and you can run it on your own server.";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  return {
    metadataBase: publicOrigin(),
    title: { absolute: TITLE },
    description: DESCRIPTION,
    alternates: { canonical: "/" },
    robots: { index: true, follow: true },
    openGraph: { type: "website", siteName: "Nexus", url: "/", title: TITLE, description: DESCRIPTION, locale: "en" },
    twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  };
}

/** Renders nothing; tells Next.js that resolving this route at request time is intentional. */
async function RequestTime() {
  await connection();
  return null;
}

export default function Home() {
  return (
    <>
      <Landing />
      <Suspense>
        <RequestTime />
      </Suspense>
    </>
  );
}
