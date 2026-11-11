"use client";
// /v3/reviews — everything that lived under v2 Leadership except the Queue
// (which moved to Home). Tabs: cycle (default) · performance · notes · contacts.
// The v2 ids are accepted as aliases so translated links land: reviews → cycle,
// approvals/queue → a notice pointing at the Home queue panel.
import Link from "next/link";
import { useAuth } from "../../../lib/useAuth.js";
import { PageHeader, Tabs, Restricted, useQueryParam, setQueryParam } from "../ui.js";
import Cycle from "./Cycle.js";
import Performance from "./Performance.js";
import MeetingNotes from "./MeetingNotes.js";
import IcContacts from "./IcContacts.js";

const ALIASES = { reviews: "cycle", approvals: "approvals", queue: "approvals", performance: "performance", notes: "notes", contacts: "contacts", cycle: "cycle" };

export default function ReviewsPage() {
  const auth = useAuth();
  const tabParam = useQueryParam("tab", "cycle");
  const level = auth?.level || 0;
  const isLST = !!auth?.isLeadStoryteller;

  if (auth?.loading) return <><PageHeader eyebrow="Reviews" title="Review cycle" /><div className="stack"><div className="skeleton" style={{ height: 36 }} /><div className="skeleton" style={{ height: 180 }} /></div></>;
  if (!auth?.ok || !(level >= 2 || isLST)) return <><PageHeader eyebrow="Reviews" title="Review cycle" /><Restricted>Team Lead or Leadership access required.</Restricted></>;

  // Lead Storytellers read the cycle board and meeting notes; performance and
  // IC contacts stay behind their server gates (L2 / L3).
  const TABS = [
    { id: "cycle", label: "Cycle" },
    ...(level >= 2 ? [{ id: "performance", label: "Performance" }] : []),
    { id: "notes", label: "Meeting notes" },
    ...(level >= 3 ? [{ id: "contacts", label: "IC contacts" }] : []),
  ];
  const resolved = ALIASES[tabParam];
  const known = resolved && (resolved === "approvals" || TABS.some(t => t.id === resolved));
  const tab = known ? resolved : "cycle";
  const unknown = !!tabParam && !known;
  const active = tab === "approvals" ? "cycle" : tab;

  const SUB = {
    cycle: "The month's review cycle, step by step: recommend, vote, confirm, feedback, promotions.",
    performance: "Team and guide activity over the last 30 days.",
    notes: "Meeting notes for factions, teams and staff groups.",
    contacts: "Incoming IC contacts across every faction.",
  };

  return (
    <>
      <PageHeader eyebrow="Reviews" title={active === "cycle" ? "Review cycle" : TABS.find(t => t.id === active)?.label || "Reviews"} sub={SUB[active]} />
      <Tabs tabs={TABS} active={active} onChange={(id) => setQueryParam("tab", id === "cycle" ? "" : id)} />
      {unknown && <div className="info" style={{ marginBottom: 12 }}>There is no “{tabParam}” section here — showing the review cycle.</div>}
      {tab === "approvals" && (
        <div className="info" style={{ marginBottom: 12 }}>
          Approvals, executions and verifications now live in the queue on Home. <Link href="/v3?panel=queue" style={{ textDecoration: "underline" }}>Open the queue →</Link>
        </div>
      )}
      {active === "cycle" && <Cycle auth={auth} />}
      {active === "performance" && (level >= 2 ? <Performance /> : <Restricted />)}
      {active === "notes" && <MeetingNotes auth={auth} />}
      {active === "contacts" && (level >= 3 ? <IcContacts auth={auth} /> : <Restricted>Leadership (L3) access required.</Restricted>)}
    </>
  );
}
