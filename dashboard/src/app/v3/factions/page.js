"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/useAuth.js";
import { getFactions, getFactionDetail, restoreFaction } from "../../fm/factions/actions.js";
import { getArchivedFactions } from "../../fm/operations/actions.js";
import { getPendingQueue } from "../../fm/leadership/actions.js";
import { PageHeader, Card, Badge, Button, Empty, Restricted, useAction, fmtDate } from "../ui.js";
import { TierPill, hubHref } from "./shared.js";
import NewFactionModal from "./NewFactionModal.js";

const SORTS = [
  ["tier", "Tier"], ["name", "Name"], ["members", "Members"], ["scenes", "Scenes · 30d"], ["promoted", "Last promoted"], ["requests", "Open requests"],
];

/* Member counts are not on the list action yet (handoff: getFactions should
   return memberCount/openRequests). Until then the hub's detail read fills them
   in a few at a time after the list has rendered, so the page is never blocked. */
async function fillCounts(rows, setCounts) {
  const out = {};
  for (let i = 0; i < rows.length; i += 5) {
    await Promise.all(rows.slice(i, i + 5).map(async f => {
      const d = await getFactionDetail(f.id).catch(() => null);
      out[f.id] = d ? d.members.length : null;
    }));
    setCounts(c => ({ ...c, ...out }));
  }
}

export default function FactionsPage() {
  const auth = useAuth();
  const router = useRouter();
  const level = auth?.level || 0;
  const isL3 = level >= 3;
  const isLeader = level >= 2 || auth?.isLeadStoryteller;
  const { run, busy } = useAction();

  const [facs, setFacs] = useState(null);
  const [archived, setArchived] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [counts, setCounts] = useState({});
  const [openReq, setOpenReq] = useState(null);     // factionId -> count (L2+)
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("tier");
  const [adding, setAdding] = useState(false);

  const load = async () => {
    const list = await getFactions().catch(() => []);
    setFacs(list || []);
    fillCounts(list || [], setCounts);
    if (isLeader) getPendingQueue().then(qd => {
      const m = {};
      (qd?.rpChanges || []).forEach(r => { m[r.faction_id] = (m[r.faction_id] || 0) + 1; });
      setOpenReq(m);
    }).catch(() => setOpenReq({}));
  };
  const loadArchived = async () => { setArchived(null); setArchived((await getArchivedFactions().catch(() => [])) || []); };

  useEffect(() => { if (!auth?.loading && auth?.ok) load(); }, [auth?.id, auth?.loading, auth?.ok]);
  useEffect(() => { if (showArchived && isL3 && archived === null) loadArchived(); }, [showArchived, isL3]);

  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => {
    const src = showArchived ? (archived || []).map(f => ({
      id: f.id, name: f.name, tier: f.tier, leadName: f.leadName, teamName: f.teamName, lastPromoted: f.last_promoted || "N/A",
      scenes30d: 0, allTime: f.sceneCount, forumPosts: f.forum_posts_30d || 0, discord: f.discord_url, forum: f.forum_url, memberCount: f.memberCount, archivedAt: f.archived_at, isArchived: true,
    })) : (facs || []).map(f => ({ ...f, memberCount: counts[f.id], openRequests: openReq ? (openReq[f.id] || 0) : null }));
    const rows = src.filter(f => !needle || `${f.name} ${f.teamName || ""} ${f.leadName || ""}`.toLowerCase().includes(needle));
    const cmp = {
      tier: (a, b) => (b.tier || 0) - (a.tier || 0) || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name),
      members: (a, b) => (b.memberCount ?? -1) - (a.memberCount ?? -1) || a.name.localeCompare(b.name),
      scenes: (a, b) => (b.scenes30d || 0) - (a.scenes30d || 0) || a.name.localeCompare(b.name),
      promoted: (a, b) => String(b.lastPromoted === "N/A" ? "" : b.lastPromoted || "").localeCompare(String(a.lastPromoted === "N/A" ? "" : a.lastPromoted || "")) || a.name.localeCompare(b.name),
      requests: (a, b) => (b.openRequests || 0) - (a.openRequests || 0) || a.name.localeCompare(b.name),
    }[sort] || ((a, b) => 0);
    return rows.sort(cmp);
  }, [facs, archived, showArchived, counts, openReq, needle, sort]);

  if (auth?.loading || (auth?.ok && facs === null)) return <><PageHeader eyebrow="Faction Management" title="Factions" /><div className="stack"><div className="skeleton" style={{ height: 36 }} /><div className="skeleton" style={{ height: 220 }} /></div></>;
  if (!auth?.ok) return <><PageHeader eyebrow="Faction Management" title="Factions" /><Restricted>Sign in to see the factions.</Restricted></>;

  const loadingList = showArchived && archived === null;
  const promoted = (v) => (!v || v === "N/A" ? "Never" : fmtDate(v));
  const restore = (f) => { if (window.confirm(`Restore ${f.name} to the active list?`)) run(() => restoreFaction(f.id), { success: `${f.name} restored.`, onDone: async () => { await loadArchived(); await load(); } }); };
  const open = (f) => router.push(hubHref(f.name));

  return (
    <>
      <PageHeader eyebrow="Faction Management" title="Factions"
        sub={showArchived ? `${archived?.length ?? "…"} archived — restorable by leadership` : `${facs.length} active · open one to manage everything about it`}
        actions={isL3 && <Button onClick={() => setAdding(true)}>+ New faction</Button>} />

      <div className="filter-row">
        <input className="inp" value={q} onChange={e => setQ(e.target.value)} placeholder="Search by faction, team or lead…" aria-label="Search factions" />
        <select className="inp" value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort">{SORTS.map(([id, l]) => <option key={id} value={id}>Sort · {l}</option>)}</select>
        {isL3 && <div className="chips"><button className={`chip${!showArchived ? " on" : ""}`} onClick={() => setShowArchived(false)}>Active</button><button className={`chip${showArchived ? " on" : ""}`} onClick={() => setShowArchived(true)}>Archived</button></div>}
      </div>

      {loadingList ? <div className="skeleton" style={{ height: 160 }} />
        : shown.length === 0 ? <Empty title={showArchived ? "No archived factions." : "No factions match."}>{needle ? "Try a shorter search." : showArchived ? "Archived factions can be restored from here." : isL3 ? "Create the first one with “New faction”." : null}</Empty>
        : <>
          {/* Phone: cards */}
          <div className="fac-cards only-sm">
            {shown.map(f => (
              <Link key={f.id} href={hubHref(f.name)} className="fac-card">
                <div className="t">{f.name} <TierPill tier={f.tier} />{f.promo && <Badge tone="lock">promo</Badge>}{f.isArchived && <Badge tone="warn">archived</Badge>}</div>
                <div className="m">
                  <span>{f.teamName || "No team"} · {f.leadName || "Unassigned"}</span>
                  <span>{f.memberCount == null ? "… members" : `${f.memberCount} members`}</span>
                  <span>promoted {promoted(f.lastPromoted)}</span>
                  {f.openRequests > 0 && <span className="badge warn">{f.openRequests} open request{f.openRequests !== 1 ? "s" : ""}</span>}
                  {f.isArchived && isL3 && <Button size="sm" variant="ghost" disabled={busy} onClick={(e) => { e.preventDefault(); restore(f); }}>Restore</Button>}
                </div>
              </Link>
            ))}
          </div>
          {/* Desktop: table */}
          <Card flush className="not-sm">
            <div className="tblwrap">
              <table className="tbl">
                <thead><tr>
                  <th>Faction</th><th>Tier</th><th>Lead</th><th className="hide-sm">Team</th><th className="num">Members</th><th className="hide-sm">Last promoted</th>
                  {!showArchived && isLeader && <th className="num">Open req.</th>}
                  {!showArchived && <th className="num hide-sm">Scenes 30d</th>}
                  {!showArchived && <th className="num hide-sm">Forum 30d</th>}
                  <th className="hide-sm">Links</th>
                  {showArchived && <th></th>}
                </tr></thead>
                <tbody>
                  {shown.map(f => (
                    <tr key={f.id} className="link" onClick={() => open(f)}>
                      <td><b>{f.name}</b>{f.promo && <> <Badge tone="lock">promo</Badge></>}{f.isArchived && <> <Badge tone="warn" title={f.archivedAt ? `Archived ${fmtDate(f.archivedAt)}` : ""}>archived</Badge></>}</td>
                      <td><TierPill tier={f.tier} /></td>
                      <td className="muted">{f.leadName || "Unassigned"}</td>
                      <td className="muted hide-sm">{f.teamName || "—"}</td>
                      <td className="num">{f.memberCount == null ? <span className="skeleton" style={{ display: "inline-block", width: 22, height: 12 }} /> : f.memberCount}</td>
                      <td className="muted hide-sm">{promoted(f.lastPromoted)}</td>
                      {!showArchived && isLeader && <td className="num">{f.openRequests == null ? "…" : f.openRequests > 0 ? <Badge tone="warn">{f.openRequests}</Badge> : <span className="faint">0</span>}</td>}
                      {!showArchived && <td className="num hide-sm">{f.scenes30d ?? 0}</td>}
                      {!showArchived && <td className="num hide-sm">{f.forumPosts ?? 0}</td>}
                      <td className="hide-sm" onClick={e => e.stopPropagation()}>
                        <span className="actions-inline">
                          {f.discord ? <a className="badge accent" href={f.discord} target="_blank" rel="noreferrer">Discord ↗</a> : <span className="badge" style={{ opacity: .5 }}>Discord</span>}
                          {f.forum ? <a className="badge accent" href={f.forum} target="_blank" rel="noreferrer">Forum ↗</a> : <span className="badge" style={{ opacity: .5 }}>Forum</span>}
                        </span>
                      </td>
                      {showArchived && <td onClick={e => e.stopPropagation()}>{isL3 && <Button size="sm" variant="ghost" disabled={busy} onClick={() => restore(f)}>Restore</Button>}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>}

      {adding && <NewFactionModal onClose={() => setAdding(false)} onCreated={(name) => { setAdding(false); router.push(hubHref(name)); }} />}
    </>
  );
}
