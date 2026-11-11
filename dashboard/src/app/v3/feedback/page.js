"use client";
// /v3/feedback → the Community feedback tab of Comms (uiRoutes maps /v2/feedback
// there too). Kept as a route so old links and bookmarks land somewhere.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "../ui.js";

export default function FeedbackRedirect() {
  const router = useRouter();
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    p.set("tab", "feedback");
    router.replace(`/v3/comms?${p.toString()}`);
  }, [router]);
  return <><PageHeader eyebrow="Comms" title="Community feedback" /><div className="skeleton skel-lg" /></>;
}
