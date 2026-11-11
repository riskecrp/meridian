"use client";
// /v3/comms — Announcement · IC communication · Send history · Community
// feedback. A Team Lead (L2+) area (policy 6): the server scopes announcement
// targets to the actor's team and mirrors every send to the FM log.
// ?tab= accepts the v2 ids (announce · ic · history; /v2/feedback arrives as
// ?tab=feedback through uiRoutes). ?faction=<id> preselects that faction.
import { useEffect, useState } from "react";
import { useAuth } from "../../../lib/useAuth.js";
import { getAnnouncementTargets } from "../../fm/communications/actions.js";
import { PageHeader, Tabs, Restricted, useQueryParam, setQueryParam } from "../ui.js";
import { Announce, IC } from "./Send.js";
import { History } from "./History.js";
import { FeedbackList } from "./FeedbackList.js";

const TABS = [
  { id: "announce", label: "Announcement" },
  { id: "ic", label: "IC communication" },
  { id: "history", label: "Send history" },
  { id: "feedback", label: "Community feedback" },
];
const ALIASES = { announcement: "announce", announcements: "announce", "ic-communication": "ic", "send-history": "history", sends: "history", feedbacks: "feedback" };
const SUB = {
  announce: "A Message from Faction Management — to the command or faction-wide channels of the factions you oversee.",
  ic: "An in-character image memo from Meridian, filed in the FM IC log.",
  history: "Every send with its delivery report; retry the factions that failed.",
  feedback: "Player feedback from the roleplay form — worked in #fm-feedback, tracked here.",
};

export default function CommsPage() {
  const auth = useAuth();
  const tabParam = useQueryParam("tab", "announce");
  const factionParam = useQueryParam("faction", "");
  const [targets, setTargets] = useState(null);
  const [err, setErr] = useState("");
  const level = auth?.level || 0;
  const canUse = !!auth?.ok && level >= 2;
  const isL3 = level >= 3;

  useEffect(() => {
    if (auth?.loading || !canUse) return;
    let alive = true;
    getAnnouncementTargets().then(t => { if (alive) setTargets(t || []); })
      .catch(e => { if (alive) { setErr(e?.message || "Could not load the factions you can message."); setTargets([]); } });
    return () => { alive = false; };
  }, [auth?.loading, canUse]);

  const known = TABS.some(t => t.id === tabParam) ? tabParam : ALIASES[tabParam] || null;
  const tab = known || "announce";
  const presetFaction = Number(factionParam) || null;

  if (auth?.loading) return <><PageHeader eyebrow="Comms" title="Communications" /><div className="skeleton skel-lg" /></>;
  if (!canUse) return <><PageHeader eyebrow="Comms" title="Communications" /><Restricted>Team Lead access (L2) required. Announcements, IC communications and community feedback are handled by team leads and leadership.</Restricted></>;

  return (
    <>
      <PageHeader eyebrow="Comms" title={TABS.find(t => t.id === tab).label} sub={SUB[tab]} />
      <Tabs tabs={TABS} active={tab} onChange={id => setQueryParam("tab", id)} />
      {!known && tabParam && <div className="info">There is no “{tabParam}” section here — showing Announcement.</div>}
      {err && tab !== "feedback" && <div className="err">{err}</div>}
      {tab === "feedback" ? <FeedbackList />
        : targets === null ? <div className="skeleton skel-lg" />
        : tab === "announce" ? <Announce targets={targets} isL3={isL3} presetFaction={presetFaction} />
        : tab === "ic" ? <IC targets={targets} isL3={isL3} presetFaction={presetFaction} />
        : <History auth={auth} targets={targets} presetFaction={presetFaction} />}
    </>
  );
}
