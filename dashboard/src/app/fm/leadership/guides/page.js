"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Guide Activity was merged into the Performance page (Guides tab).
// Kept as a redirect so existing links/bookmarks still resolve.
export default function GuidesRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/fm/leadership/performance?view=guides"); }, [router]);
  return <div className="p-10 text-sm animate-pulse" style={{ color: "var(--accent)" }}>Redirecting…</div>;
}
