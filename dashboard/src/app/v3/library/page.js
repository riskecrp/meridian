"use client";
// /v3/library — the reference half of the old /v2/story Library: Knowledge
// Base, Documents, Peds, Vehicle Catalog and Arsenal. Read for every staff
// member, Event Team and Lead Storytellers; writes follow the server gates
// (KB/weapons L2, management commands/vehicles L3, spawn commands L3 or ET).
// The workflow half (scene logs, scene library, change log, NPCs) lives at
// /v3/storytelling; links with those tab ids are forwarded there.
import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/useAuth.js";
import { PageHeader, Tabs, Restricted, useQueryParam } from "../ui.js";
import { LIBRARY_TABS, STORY_IDS, SPAWN_ALIASES, resolveTab, carryQuery, canEnter, setQuery } from "./shared.js";
import KnowledgeBase from "./KnowledgeBase.js";
import Documents from "./Documents.js";
import Peds from "./Peds.js";
import Vehicles from "./Vehicles.js";
import Arsenal from "./Arsenal.js";

export default function LibraryPage() {
  const auth = useAuth();
  const router = useRouter();
  const tabParam = useQueryParam("tab", "");
  const sop = useQueryParam("sop", "");
  const initialQ = useQueryParam("q", "");
  const sub = useQueryParam("sub", "");

  const level = auth?.level || 0;
  const isET = !!auth?.isEventTeam;
  const canMgmtRead = level >= 3 || isET;   // management KB commands, spawn commands (server: requireActor(3, ET))

  const { raw, id } = resolveTab(tabParam);
  const known = LIBRARY_TABS.some(t => t.id === id);
  const forward = STORY_IDS.includes(id);
  // A workflow section asked for here → the Storytelling page owns it.
  useEffect(() => { if (forward) router.replace(`/v3/storytelling${carryQuery(id)}`); }, [forward, id]);

  const tab = known ? id : (sop ? "docs" : "kb");
  const notice = useMemo(() => (raw && !known && !forward ? `There is no Library section called "${raw}" — showing the Knowledge Base.` : ""), [raw, known, forward]);
  const arsenalSub = (SPAWN_ALIASES.includes(raw) || sub === "spawn") && canMgmtRead ? "spawn" : "loadouts";

  if (auth?.loading) return <><PageHeader eyebrow="Library" title="Library" /><div className="skeleton block" /></>;
  if (!canEnter(auth)) return <><PageHeader eyebrow="Library" title="Library" /><Restricted>The Library is for FM staff, the Event Team and Lead Storytellers.</Restricted></>;
  if (forward) return <><PageHeader eyebrow="Library" title="Library" /><div className="skeleton block" /></>;

  const label = LIBRARY_TABS.find(t => t.id === tab)?.label || "Library";
  return (
    <>
      <PageHeader eyebrow="Library" title={label} sub="Reference for the whole team. Scene logs, ideas, the change log and the NPC map are under Storytelling." />
      <Tabs tabs={LIBRARY_TABS} active={tab} onChange={(t) => setQuery({ tab: t, q: "", sop: "", sub: "" })} />
      {notice && <div className="info" style={{ marginBottom: 12 }}>{notice}</div>}
      {tab === "kb" && <KnowledgeBase auth={auth} initialQ={initialQ} />}
      {tab === "docs" && <Documents auth={auth} initialQ={initialQ} sop={sop} />}
      {tab === "peds" && <Peds auth={auth} initialQ={initialQ} />}
      {tab === "vehicles" && <Vehicles auth={auth} initialQ={initialQ} />}
      {tab === "arsenal" && <Arsenal auth={auth} initialSub={arsenalSub} initialQ={initialQ} />}
    </>
  );
}
