"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "../../../../lib/useAuth.js";
import { PORTAL_URL } from "../../../../lib/constants.js";
import { getFactionDetail, getFactionContacts, getFactionImports, getFactionPortalMessages, restoreFaction } from "../../../fm/factions/actions.js";
import { getReviewHistory, getReviewDataFor, getFactionLeadershipSummary } from "../../../fm/leadership/actions.js";
import { getFleetOverview, getFleetTierDefaults } from "../../../fm/operations/actions.js";
import { getFactionFleetSummary } from "../../../v2/actions.js";
import { Badge, Button, Tabs, Empty, Restricted, useAction, useQueryParam, setQueryParam } from "../../ui.js";
import { TierPill, hubHref } from "../shared.js";
import { MemberModal, PropertyModal, LinkModal, RPChangeModal } from "./Modals.js";
import Overview from "./Overview.js";
import Roster from "./Roster.js";
import Activity from "./Activity.js";
import Assets from "./Assets.js";
import Imports from "./Imports.js";
import Comms from "./Comms.js";
import Review from "./Review.js";
import Timeline from "./Timeline.js";
import Admin from "./Admin.js";

// Tab ids are the v2 ids (uiRoutes.js passes ?tab= through), so translated links
// land on the same section. Review and Admin are for leaders (L2+, LST reads).
const TAB_IDS = ["overview", "roster", "activity", "assets", "imports", "comms", "review", "timeline", "admin"];
const LEADER_TABS = new Set(["review", "admin"]);

function Skeleton() {
  return <div className="stack"><div className="skeleton sk-line" /><div className="skeleton sk-box" /><div className="skeleton sk-tall" /></div>;
}

export default function FactionHubPage() {
  const auth = useAuth();
  const router = useRouter();
  const params = useParams();
  const name = params?.name ? decodeURIComponent(String(params.name)) : "";
  const level = auth?.level || 0;
  const isL3 = level >= 3;
  const isLST = !!auth?.isLeadStoryteller;
  const isET = !!auth?.isEventTeam;
  const isLeader = level >= 2 || isLST;
  const { run, busy } = useAction();

  const [detail, setDetail] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [imports, setImports] = useState([]);
  const [portal, setPortal] = useState([]);
  const [fleet, setFleet] = useState(null);
  const [fleetSum, setFleetSum] = useState(null);
  const [tierDefaults, setTierDefaults] = useState({});
  const [reviews, setReviews] = useState([]);
  const [reviewInfo, setReviewInfo] = useState(null);
  const [leadSummary, setLeadSummary] = useState({ notes: [], pending: [] });
  const [modal, setModal] = useState(null);

  // Aliases other pages link with (Home: members, scenes; v2: activity ids).
  const TAB_ALIASES = { members: "roster", scenes: "activity", history: "timeline", properties: "assets", fleet: "assets" };
  const rawTab = useQueryParam("tab", "overview");
  const tabParam = TAB_ALIASES[rawTab] || rawTab;
  const tabKnown = TAB_IDS.includes(tabParam);
  const tabAllowed = tabKnown && (isLeader || !LEADER_TABS.has(tabParam));
  const tab = tabAllowed ? tabParam : "overview";
  const setTab = (id) => setQueryParam("tab", id === "overview" ? "" : id);

  const reloadContacts = async () => setContacts((await getFactionContacts(detail.id).catch(() => [])) || []);
  const reloadPortal = async () => setPortal((await getFactionPortalMessages(detail.id).catch(() => [])) || []);
  const load = async () => {
    const d = await getFactionDetail(name).catch(() => null);
    if (!d) { setNotFound(true); return; }
    setDetail(d); setNotFound(false);
    getFactionContacts(d.id).then(c => setContacts(c || [])).catch(() => {});
    getFactionImports(d.id).then(i => setImports(i || [])).catch(() => {});
    getFactionPortalMessages(d.id).then(p => setPortal(p || [])).catch(() => {});
    getFleetTierDefaults().then(t => setTierDefaults(t || {})).catch(() => {});
    getFactionFleetSummary(d.id).then(setFleetSum).catch(() => {});
    if (isL3) getFleetOverview().then(all => setFleet((all || []).find(f => f.id === d.id) || null)).catch(() => {});
    if (isLeader) {
      getReviewHistory(d.id).then(r => setReviews(r || [])).catch(() => {});
      getReviewDataFor(d.id).then(info => setReviewInfo(info || null)).catch(() => {});
      getFactionLeadershipSummary(d.id).then(x => setLeadSummary(x || { notes: [], pending: [] })).catch(() => {});
    }
  };
  useEffect(() => { if (!auth?.loading && auth?.ok && name) load(); }, [auth?.id, auth?.loading, auth?.ok, name]);

  if (auth?.loading || (auth?.ok && !detail && !notFound)) return <Skeleton />;
  if (!auth?.ok) return <Restricted>Sign in to see this faction.</Restricted>;
  if (notFound) return <><Link className="btn quiet sm" href="/v3/factions">← Factions</Link><div className="mt-m"><Empty title={`Faction “${name}” not found.`}>It may have been renamed — the list has the current names.</Empty></div></>;

  // The server decides what this viewer may change (team scope for L1/L2,
  // archived, Event Team / Lead Storyteller read-only): every write control
  // keys off `canWrite` so a button never leads to a refused action.
  const canWrite = !!detail.writable;
  const archived = !!detail.archived;
  const promo = detail.promo || null;
  const newImports = promo ? (promo.imports || []).filter(n => !(detail.authorizedItems || []).includes(n)) : [];
  const openIC = contacts.filter(c => c.status !== "completed").length;
  const unread = contacts.filter(c => !c.is_read).length;

  const hub = { auth, level, isL3, isLST, isET, isLeader, detail, canWrite, archived, reload: load, reloadContacts, reloadPortal, contacts, imports, portal, fleet, fleetSum, tierDefaults, reviews, reviewInfo, leadSummary, setModal, setTab };

  const TABS = [
    { id: "overview", label: "Overview" },
    { id: "roster", label: "Roster", count: detail.members.length },
    { id: "activity", label: "Activity" },
    { id: "assets", label: "Assets" },
    { id: "imports", label: "Imports" },
    { id: "comms", label: "Comms", count: unread || openIC },
    ...(isLeader ? [{ id: "review", label: "Review" }] : []),
    { id: "timeline", label: "Timeline" },
    ...(isLeader ? [{ id: "admin", label: "Admin" }] : []),
  ];

  const canLogScene = !archived && (level >= 1 || isET);
  const quick = [
    canLogScene && <Link key="scene" href={`/v3/storytelling?tab=scenelogs&new=1&faction=${detail.id}`}><span className="t">Log scene</span><span className="d">Opens the scene form for {detail.name}</span></Link>,
    level >= 2 && canWrite && <button key="rp" onClick={() => setModal({ kind: "rp" })}><span className="t">Request RP change</span><span className="d">NPC · HQ · turf · property → leadership approval</span></button>,
    level >= 2 && !archived && <Link key="ann" href={`/v3/comms?faction=${detail.id}`}><span className="t">Announce</span><span className="d">Message the faction's Discord</span></Link>,
    canWrite && <button key="member" onClick={() => setModal({ kind: "member" })}><span className="t">Add member</span><span className="d">A character on the roster</span></button>,
    level >= 2 && canWrite && <button key="prop" onClick={() => setModal({ kind: "prop" })}><span className="t">Add property</span><span className="d">{isL3 ? "Applied directly" : "Queued for approval"}</span></button>,
  ].filter(Boolean);

  return (
    <>
      <div className="row spread mb-s">
        <Link className="btn quiet sm" href="/v3/factions">← Factions</Link>
        <a className="btn ghost sm" href={`${PORTAL_URL}/faction/${encodeURIComponent(detail.name)}`} target="_blank" rel="noreferrer">Public portal ↗</a>
      </div>
      <div className="ph">
        <div>
          <p className="eyebrow">Faction</p>
          <div className="fac-title">
            <h1>{detail.name}</h1>
            <TierPill tier={detail.tier} long />
            {detail.teamName && <Badge tone="accent">{detail.teamName}</Badge>}
            {archived && <Badge tone="warn">ARCHIVED</Badge>}
            {promo && <Badge tone="good">promo staged</Badge>}
          </div>
          <div className="sub">Lead {detail.leadName || "unassigned"} · {detail.members.length} on the roster · {detail.scenes30d ?? 0} scenes in 30 days{detail.lastPromoted ? ` · promoted ${detail.lastPromoted}` : " · never promoted"}</div>
        </div>
      </div>

      <div className="stack mb-m">
        {archived && (
          <div className="callout warn">
            <span>This faction is archived{detail.archivedAt ? ` (since ${String(detail.archivedAt).slice(0, 10)})` : ""} — read-only. Nothing here can be changed until it is restored.</span>
            {isL3 && <Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (window.confirm(`Restore ${detail.name} to the active list?`)) run(() => restoreFaction(detail.id), { success: `${detail.name} restored.`, onDone: load }); }}>Restore faction</Button>}
          </div>
        )}
        {!archived && !canWrite && level >= 1 && !isLeader && <div className="callout quiet"><span>Read-only: {detail.teamName ? `${detail.teamName} manages this faction` : "this faction is outside your team"}.</span></div>}
        {!archived && !canWrite && (isET || isLST) && level < 1 && <div className="callout quiet"><span>Read-only view{isET ? " — Event Team edits scenes and the scene library under Storytelling" : ""}.</span></div>}
        {promo && isLeader && (
          <div className="callout good">
            <span>Promotion staged → Tier {promo.tier} · complete it after the RP
              <span className="sub-l">New imports being granted ({newImports.length}): {newImports.length === 0 ? "none — tier change only" : newImports.join(", ")}</span>
            </span>
            {tab !== "review" && <Button size="sm" variant="good" onClick={() => setTab("review")}>Open Review →</Button>}
          </div>
        )}
        {tabParam && !tabKnown && <div className="info">Unknown section “{tabParam}” — showing the overview.</div>}
        {tabKnown && !tabAllowed && <div className="info">The {tabParam} section is for team leads and leadership — showing the overview.</div>}
        {quick.length > 0 && <div className="quick">{quick}</div>}
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === "overview" && <Overview hub={hub} />}
      {tab === "roster" && <Roster hub={hub} />}
      {tab === "activity" && <Activity hub={hub} />}
      {tab === "assets" && <Assets hub={hub} />}
      {tab === "imports" && <Imports hub={hub} />}
      {tab === "comms" && <Comms hub={hub} />}
      {tab === "review" && isLeader && <Review hub={hub} />}
      {tab === "timeline" && <Timeline factionId={detail.id} />}
      {tab === "admin" && isLeader && <Admin hub={hub} onRenamed={(nm) => router.replace(hubHref(nm, tab))} onArchived={() => router.push("/v3/factions")} />}

      {modal?.kind === "member" && <MemberModal detail={detail} member={modal.member} onClose={() => setModal(null)} onDone={load} />}
      {modal?.kind === "prop" && <PropertyModal detail={detail} prop={modal.prop} onClose={() => setModal(null)} onDone={load} />}
      {modal?.kind === "link" && <LinkModal detail={detail} field={modal.field} onClose={() => setModal(null)} onDone={load} />}
      {modal?.kind === "rp" && <RPChangeModal detail={detail} contactId={modal.contactId || null} onClose={() => setModal(null)} onDone={async () => { await load(); }} />}
    </>
  );
}
