"use client";
// /v3/settings — the admin area with a left rail (desktop) / chips (phone) built
// from visibleAdminGroups (v2/adminNav.js), a search over section names and a
// job-health badge from /api/health. The fifteen views are the existing
// self-contained client components from v2/admin/views and
// fm/operations/discord, embedded inside a .card.v2x (class bridges in v3.css).
// ?tab= accepts the v2 admin ids and ADMIN_TAB_ALIASES (pings/channels/dbaccess → discord).
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/useAuth.js";
import { visibleAdminGroups, ADMIN_TAB_ALIASES } from "../../v2/adminNav.js";
import DiscordAccessView from "../../fm/operations/discord/DiscordAccessView.js";
import { Audit, Archive, ServerLogs, Conversations } from "../../v2/admin/views/records.js";
import { Inventory, Imports, Properties } from "../../v2/admin/views/catalogs.js";
import { Links, RecurringReminders } from "../../v2/admin/views/config.js";
import { StaffTeams, FMHours } from "../../v2/admin/views/people.js";
import { Handover } from "../../v2/admin/views/handover.js";
import { Fleet } from "../../v2/admin/views/fleet.js";
import { Analytics } from "../../v2/admin/views/analytics.js";
import { PageHeader, Card, Badge, Restricted, useQueryParam, setQueryParam } from "../ui.js";

// One line under each section title.
const DESC = {
  staff: "Teams, roster, clearance, COI, promote/retire, individual dashboard access.",
  hours: "Character links, monthly hours import and the FM activity report.",
  inventory: "Items the team hands out, and what each faction has received.",
  imports: "The global import catalog; per-faction permissions live on the faction page.",
  properties: "Every property across factions — assign, confiscate, edit.",
  fleet: "Approved vehicles, garage spawnpoints and tier limits per faction.",
  links: "The bot-managed Important Links post, edited in place.",
  reminders: "Monthly reminders that ping a target on a set day.",
  discord: "Pings, the Discord servers Meridian talks to, and who can log in.",
  audit: "Who did what, and whether the background jobs are running.",
  analytics: "Server totals and staff activity.",
  archive: "Archived factions, with restore.",
  memberlog: "Member events, deleted and edited messages, keyword alerts.",
  convos: "Team activity stats and AI summaries from the synced channels.",
  handover: "Run Meridian yourself, export the data, or move the live server.",
};
// Sections this page renders that adminNav may not list (L3-only either way).
const L3_ONLY_FALLBACK = { fleet: { group: "catalogs", groupLabel: "Catalogs", label: "Fleet" }, analytics: { group: "records", groupLabel: "Records", label: "Analytics" } };
// Documents and the Vehicle Catalog live in the Library now.
const MOVED = { docs: "docs", vehicles: "vehicles" };

function HealthBadge({ onOpen }) {
  const [h, setH] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/health", { cache: "no-store" }).then(r => r.json()).then(d => { if (alive) setH(d || {}); }).catch(() => { if (alive) setH({ error: true }); });
    return () => { alive = false; };
  }, []);
  if (!h) return <Badge>checking jobs…</Badge>;
  if (h.error) return <Badge tone="warn" title="/api/health did not answer">job health unknown</Badge>;
  const bad = (h.jobs || []).filter(j => j.status && j.status !== "ok");
  const text = h.ok ? "Background jobs healthy" : bad.length ? `${bad.length} job${bad.length === 1 ? "" : "s"} late or failing` : "Background jobs need attention";
  const title = bad.length ? bad.map(j => `${j.label || j.job}: ${j.status}`).join("\n") : (h.checkedAt ? `Checked ${h.checkedAt}` : undefined);
  const badge = <Badge tone={h.ok ? "good" : "bad"} title={title}>{h.ok ? "●" : "▲"} {text}</Badge>;
  return onOpen ? <button type="button" className="linkbtn" onClick={onOpen} title={title}>{badge}</button> : badge;
}

export default function SettingsPage() {
  const auth = useAuth();
  const router = useRouter();
  const tabParam = useQueryParam("tab", "");
  const sopParam = useQueryParam("sop", "");
  const [q, setQ] = useState("");
  const level = auth?.level || 0;
  const canEditCatalogs = level >= 3;   // catalog edits are leadership-only; Event Team reads (policy 4)

  const visible = useMemo(() => visibleAdminGroups({ level, isET: auth?.isEventTeam, isLST: auth?.isLeadStoryteller, id: auth?.id }), [level, auth?.isEventTeam, auth?.isLeadStoryteller, auth?.id]);
  const moved = MOVED[tabParam];
  useEffect(() => {
    if (moved) router.replace(`/v3/library?tab=${moved}${sopParam ? `&sop=${encodeURIComponent(sopParam)}` : ""}`);
  }, [moved, sopParam, router]);

  if (auth?.loading || moved) return <><PageHeader eyebrow="Settings" title="Settings" /><div className="skeleton skel-lg" /></>;
  if (!auth?.ok || !visible.length) return <><PageHeader eyebrow="Settings" title="Settings" /><Restricted>Team Lead (L2) access required.</Restricted></>;

  // Resolve ?tab= (v2 ids + aliases) to a section the actor may see.
  const wanted = ADMIN_TAB_ALIASES[tabParam] || tabParam;
  let group = visible.find(g => g.items.some(i => i[0] === wanted));
  let viewId = wanted, viewLabel, unknown = false;
  if (group) viewLabel = group.items.find(i => i[0] === viewId)[1];
  else if (L3_ONLY_FALLBACK[wanted] && level >= 3) { const fb = L3_ONLY_FALLBACK[wanted]; group = visible.find(g => g.id === fb.group) || { id: fb.group, label: fb.groupLabel, items: [] }; viewLabel = fb.label; }
  else {
    unknown = !!tabParam;
    group = visible.find(g => g.items.some(i => i[0] === "audit")) || visible[0];
    viewId = (group.items.find(i => i[0] === "audit") || group.items[0])[0];
    viewLabel = group.items.find(i => i[0] === viewId)[1];
  }
  const canSeeAudit = visible.some(g => g.items.some(i => i[0] === "audit"));
  const go = (id) => setQueryParam("tab", id);

  const needle = q.trim().toLowerCase();
  const railGroups = visible.map(g => ({ ...g, items: g.items.filter(([id, label]) => !needle || label.toLowerCase().includes(needle) || id.includes(needle) || g.label.toLowerCase().includes(needle)) })).filter(g => g.items.length);
  const flat = railGroups.flatMap(g => g.items);

  const view =
    viewId === "audit" ? <Audit auth={auth} />
    : viewId === "archive" ? <Archive />
    : viewId === "inventory" ? <Inventory auth={auth} />
    : viewId === "imports" ? <Imports canEdit={canEditCatalogs} />
    : viewId === "properties" ? <Properties canEdit={canEditCatalogs} />
    : viewId === "fleet" ? <Fleet />
    : viewId === "analytics" ? <Analytics />
    : viewId === "links" ? <Links />
    : viewId === "memberlog" ? <ServerLogs />
    : viewId === "convos" ? <Conversations />
    : viewId === "reminders" ? <RecurringReminders auth={auth} />
    : viewId === "discord" ? <DiscordAccessView />
    : viewId === "staff" ? <StaffTeams />
    : viewId === "hours" ? <FMHours />
    : viewId === "handover" ? <Handover />
    : null;

  return (
    <>
      <PageHeader eyebrow="Settings" title="Settings" sub="People, catalogs, configuration, records and handover."
        actions={<>
          <HealthBadge onOpen={canSeeAudit ? () => go("audit") : null} />
          <input className="inp settings-search" placeholder="Search settings…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search settings" />
        </>} />
      {unknown && <div className="info">There is no “{tabParam}” section here — showing {viewLabel}.</div>}
      <div className="chips settings-chips" aria-label="Sections (phone)">
        {flat.map(([id, label]) => <button key={id} type="button" className={`chip${viewId === id ? " on" : ""}`} onClick={() => go(id)}>{label}</button>)}
        {!flat.length && <span className="faint tiny">No section matches “{q}”.</span>}
      </div>
      <div className="settings">
        <nav className="rail" aria-label="Sections">
          {railGroups.map(g => (
            <div key={g.id}>
              <div className="rh">{g.label}</div>
              {g.items.map(([id, label]) => <button key={id} type="button" className={`ri${viewId === id ? " on" : ""}`} aria-current={viewId === id ? "page" : undefined} onClick={() => go(id)}>{label}</button>)}
            </div>
          ))}
          {!railGroups.length && <div className="faint tiny">No section matches “{q}”.</div>}
        </nav>
        <Card title={viewLabel} right={<span className="faint tiny">{group.label}</span>}>
          {DESC[viewId] && <div className="muted small">{DESC[viewId]}</div>}
          <div className="section v2x" key={viewId}>{view}</div>
        </Card>
      </div>
    </>
  );
}
