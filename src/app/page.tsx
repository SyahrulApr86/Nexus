import type { Metadata } from "next";
import { Landing } from "@/components/landing/landing";

const TITLE = "Nexus: notes that link to each other, in plain markdown";
const DESCRIPTION =
  "Linked markdown notes in any browser: [[links]] and backlinks, a graph, search with operators and live preview. Your vault stays plain .md files, and you can run it on your own server.";

export const metadata: Metadata = {
  // Absolute URLs for the Open Graph image; the public origin comes from the deploy's env.
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000"),
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: { type: "website", siteName: "Nexus", url: "/", title: TITLE, description: DESCRIPTION, locale: "en" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default function Home() {
  return <Landing />;
}
