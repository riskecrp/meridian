"use client";
// Admin › Analytics (L3): server totals + staff activity, defined against the
// current tables (see v2/admin/actions.js getAdminAnalytics for each number).
// Pending RP changes and deletion requests live under Leadership › Approvals.
import { useEffect, useState } from "react";
import Link from "next/link";
import { getAdminAnalytics } from "../actions.js";

function Tile({ label, value, sub, tone }) {
  return (
    <div className={`metric${tone === "attn" ? " attn" : ""}`}>
      <div className="l">{label}</div>
      <div className="v">{value ?? 0}</div>
      {sub && <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

export function Analytics() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { getAdminAnalytics().then(setData).catch(e => setError(e?.message || "Could not load analytics.")); }, []);
  if (error) return <div className="empty" style={{ color: "var(--rose)" }}>{error}</div>;
  if (!data) return <div className="empty">Loading…</div>;
  const { factions, properties, tasks, queues, scenes, staff, activity } = data;
  const sorted = [...(activity || [])].sort((a, b) => b.scene_count - a.scene_count || a.name.localeCompare(b.name));
  return (
    <>
      <div className="card">
        <div className="hd"><div className="t">Factions</div><div className="meta">archived = 0</div></div>
        <div className="metrics" style={{ border: 0, margin: 0, paddingTop: 8 }}>
          <Tile label="Active factions" value={factions.active} sub={factions.byTier.map(t => `T${t.tier}: ${t.c}`).join(" · ")} />
          <Tile label="Archived" value={factions.archived} />
          <Tile label="Pending promotion" value={factions.pendingPromo} tone={factions.pendingPromo ? "attn" : ""} sub="pending_promo set" />
          <Tile label="No scene in 30 days" value={scenes.factionsWithoutScene30d} tone={scenes.factionsWithoutScene30d ? "attn" : ""} sub="active factions" />
        </div>
      </div>
      <div className="card">
        <div className="hd"><div className="t">Properties</div><div className="meta">properties table</div></div>
        <div className="metrics" style={{ border: 0, margin: 0, paddingTop: 8 }}>
          <Tile label="Total" value={properties.total} />
          <Tile label="Assigned to active factions" value={properties.assigned} />
          <Tile label="Confiscated" value={properties.confiscated} />
          <Tile label="Unassigned" value={properties.unassigned} sub="not confiscated, no faction" />
        </div>
      </div>
      <div className="card">
        <div className="hd"><div className="t">Work</div><div className="meta">tasks.status · queues</div></div>
        <div className="metrics" style={{ border: 0, margin: 0, paddingTop: 8 }}>
          <Tile label="Open tasks" value={tasks.open} sub={`${tasks.unclaimed} unclaimed`} />
          <Tile label="Completed (30d)" value={tasks.completed30d} />
          <Tile label="RP changes in flight" value={queues.rpPending} tone={queues.rpAwaitingLeadership ? "attn" : ""} sub={`${queues.rpAwaitingLeadership} waiting on leadership`} />
          <Tile label="Deletion requests" value={queues.deletionsPending} tone={queues.deletionsPending ? "attn" : ""} />
          <Tile label={`Reviews open (${data.month})`} value={queues.reviewsOpenThisMonth} />
          <Tile label="Scenes (30d)" value={scenes.last30d} />
          <Tile label="Active staff" value={staff.active} />
        </div>
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 8 }}>
          Approve RP changes and deletion requests under <Link href="/v2/leadership?tab=approvals" style={{ color: "var(--accent)" }}>Leadership › Approvals</Link>.
        </div>
      </div>
      <div className="card">
        <div className="hd"><div className="t">Staff activity — 30 days</div><div className="meta">scene logs by author</div></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 6, paddingTop: 6 }}>
          {sorted.map(s => (
            <div key={s.discord_id || s.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderRadius: 8, background: "var(--panel-2)", borderLeft: `2px solid ${s.scene_count === 0 ? "var(--rose)" : "var(--line)"}` }}>
              <span style={{ fontSize: 12, color: "var(--ink-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginRight: 8 }}>{s.name}</span>
              <span style={{ fontFamily: "var(--v2-mono)", fontSize: 15, color: s.scene_count === 0 ? "var(--rose)" : "var(--ink-0)" }}>{s.scene_count}</span>
            </div>
          ))}
          {sorted.length === 0 && <div className="empty">No scene logs in the last 30 days.</div>}
        </div>
      </div>
    </>
  );
}
