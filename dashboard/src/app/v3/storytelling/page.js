"use client";
// /v3/storytelling — the workflow half of the old /v2/story Library: Scene
// Logs, Scene Library (ideas → approval → faction), Change Log and the NPC
// Ecosystem. Event Team and Lead Storytellers land here with their write
// rights (policy 3/4); every other section of the site is read-only for them.
// Reference material (KB, documents, peds, vehicles, arsenal) is at
// /v3/library; links with those tab ids are forwarded there.
import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/useAuth.js";
import { PageHeader, Tabs, Restricted, useQueryParam } from "../ui.js";
import { STORY_TABS, LIBRARY_IDS, resolveTab, carryQuery, canEnter, setQuery } from "../library/shared.js";
import SceneLogs from "./SceneLogs.js";
import SceneLibrary from "./SceneLibrary.js";
import ChangeLog from "./ChangeLog.js";
import Npcs from "./Npcs.js";

export default function StorytellingPage() {
  const auth = useAuth();
  const router = useRouter();
  const tabParam = useQueryParam("tab", "");
  const initialQ = useQueryParam("q", "");
  const openNew = useQueryParam("new", "") === "1";
  const prefillFaction = useQueryParam("faction", "");

  const level = auth?.level || 0;
  const isET = !!auth?.isEventTeam, isLST = !!auth?.isLeadStoryteller;
  const canNPC = level >= 2 || isET || isLST;          // getNPCs / getTurfs: requireActor(2, READ)

  const { raw, id } = resolveTab(tabParam);
  const known = STORY_TABS.find(t => t.id === id);
  const forward = LIBRARY_IDS.includes(id);
  useEffect(() => { if (forward) router.replace(`/v3/library${carryQuery(raw)}`); }, [forward, raw]);

  const tabs = STORY_TABS.filter(t => t.id !== "npcs" || canNPC);
  const allowed = known && tabs.some(t => t.id === id);
  const tab = allowed ? id : "scenelogs";
  const notice = useMemo(() => {
    if (!raw || forward) return "";
    if (!known) return `There is no Storytelling section called "${raw}" — showing Scene Logs.`;
    if (!allowed) return `${known.label} needs L2+ clearance (or an Event Team / Lead Storyteller role) — showing Scene Logs.`;
    return "";
  }, [raw, known, allowed, forward]);

  // "+ New → Scene log" lands here with ?new=1[&faction=]; the form opens and the flag leaves the URL.
  useEffect(() => { if (openNew && !auth?.loading) router.replace(`/v3/storytelling?tab=${tab}`, { scroll: false }); }, [openNew, auth?.loading]);

  if (auth?.loading) return <><PageHeader eyebrow="Storytelling" title="Storytelling" /><div className="skeleton block" /></>;
  if (!canEnter(auth)) return <><PageHeader eyebrow="Storytelling" title="Storytelling" /><Restricted>Storytelling is for FM staff, the Event Team and Lead Storytellers.</Restricted></>;
  if (forward) return <><PageHeader eyebrow="Storytelling" title="Storytelling" /><div className="skeleton block" /></>;

  const label = tabs.find(t => t.id === tab)?.label || "Storytelling";
  return (
    <>
      <PageHeader eyebrow="Storytelling" title={label} sub="Log what happened, grow the idea pool, record world changes. Reference material is in the Library." />
      <Tabs tabs={tabs} active={tab} onChange={(t) => setQuery({ tab: t, q: "", new: "", faction: "" })} />
      {notice && <div className="info mb">{notice}</div>}
      {tab === "scenelogs" && <SceneLogs auth={auth} openNew={openNew} prefillFaction={prefillFaction} />}
      {tab === "scenes" && <SceneLibrary auth={auth} initialQ={initialQ} />}
      {tab === "changelog" && <ChangeLog auth={auth} initialQ={initialQ} />}
      {tab === "npcs" && (canNPC ? <Npcs auth={auth} initialQ={initialQ} /> : <Restricted>The NPC Ecosystem needs L2+ clearance.</Restricted>)}
    </>
  );
}
