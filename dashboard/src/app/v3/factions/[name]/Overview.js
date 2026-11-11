"use client";
import { useEffect, useState } from "react";
import { getPromotionReadiness } from "../../../fm/factions/actions.js";
import { Card, Badge, Button, Empty } from "../../ui.js";
import { money } from "../shared.js";

/* Readiness card (L2+, Lead Storyteller reads): the faction's numbers against
   the targets for its tier (READINESS_TARGETS in fm/factions/actions.js). A
   guide for the review conversation, not a gate. Re-reads after hub writes. */
export function Readiness({ factionId, refreshKey }) {
  const [r, setR] = useState(null);
  useEffect(() => { if (factionId) getPromotionReadiness(factionId).then(x => setR(x || null)).catch(() => setR(null)); }, [factionId, refreshKey]);
  if (!r) return null;
  return (
    <Card title="Promotion readiness" right={<span className="muted small">{r.nextTier == null ? "top tier" : `next: Tier ${r.nextTier}`} · {r.met}/{r.checks.length} met</span>}>
      <div className="list">
        {r.checks.map(c => (
          <div className="li" key={c.id}>
            <span className={`mono w-800 ${c.ok ? "c-good" : "c-amber"}`}>{c.ok ? "✓" : "✕"}</span>
            <div className="body"><div className="d c-ink1">{c.label}</div></div>
            <div className="side"><span className="mono small"><b className={c.ok ? "c-ink" : "c-amber"}>{c.value}</b> <span className="faint">· target {c.op === "max" ? `≤ ${c.target}` : `≥ ${c.target}`}</span></span></div>
          </div>
        ))}
      </div>
      <div className={`hint pt-s${r.ready && !r.staged ? " c-good" : ""}`}>
        {r.archived ? "Archived — for the record only." : r.staged ? "A promotion is already staged — complete it from the Review tab." : r.ready ? "Every check is met — worth raising at this month's review." : "Targets are set per tier by leadership; a guide for the review, not a gate."}
      </div>
    </Card>
  );
}

export default function Overview({ hub }) {
  const { detail, level, canWrite, isLeader, fleetSum, tierDefaults, imports, setModal, setTab, contacts } = hub;
  const td = tierDefaults[detail.tier] || {};
  const permitted = imports.filter(i => i.permitted).length;
  const openContacts = contacts.filter(c => c.status !== "completed").length;
  const ext = (field) => detail[field]
    ? <a className="badge accent" href={detail[field]} target="_blank" rel="noreferrer">Open ↗</a>
    : <span className="faint small">not set</span>;
  return (
    <div className="grid two">
      <div className="stack">
        <Card title="Standing" right={<span className="muted small">Tier {detail.tier}</span>}>
          <div className="kv">
            <div><div className="k">Imports allowed</div><div className="v mono">{permitted}</div></div>
            <div><div className="k">Fleet</div><div className="v mono">{fleetSum ? <>{fleetSum.totalQuantity} / {fleetSum.limits.maxTotal}{fleetSum.limits.isOverridden && <> <Badge tone="lock">OVR</Badge></>}</> : (td.total ?? "—")} <span className="small faint">({fleetSum ? `${fleetSum.typeCount}/${fleetSum.limits.maxTypes}` : (td.types ?? "—")} types)</span></div></div>
            <div><div className="k">Garages</div><div className="v mono">{fleetSum ? `${fleetSum.garageCount} / ${fleetSum.limits.maxGarages}` : (td.garages ?? "—")}</div></div>
            <div><div className="k">Stipend</div><div className="v mono">{fleetSum ? money(fleetSum.stipend) : td.stipend != null ? money(td.stipend) : "—"}</div></div>
            <div><div className="k">Scenes · 30d</div><div className="v mono">{detail.scenes30d ?? "—"}</div></div>
            <div><div className="k">Scenes · all time</div><div className="v mono">{detail.allTime ?? "—"}</div></div>
            <div><div className="k">Forum · 30d</div><div className="v mono">{detail.forumPosts ?? 0}</div></div>
            <div><div className="k">Last promoted</div><div className="v">{detail.lastPromoted || "Never"}</div></div>
            <div><div className="k">Roster</div><div className="v mono">{detail.members.length}</div></div>
            <div><div className="k">Open IC contacts</div><div className="v mono">{openContacts}</div></div>
          </div>
        </Card>
        <Card title="Team" right={detail.teamName ? <Badge tone="accent">{detail.teamName}</Badge> : <span className="faint small">no team</span>}>
          <div className="kv">
            <div><div className="k">Lead</div><div className="v">{detail.leadName || "Unassigned"}</div></div>
            <div className="wide"><div className="k">Guides</div><div className="v">{detail.guidesText || "None"}</div></div>
          </div>
        </Card>
        {isLeader && <Readiness factionId={detail.id} refreshKey={detail} />}
      </div>
      <div className="stack">
        <Card title="Links">
          <div className="list">
            {[["discord", "Discord"], ["forum", "Forum"]].map(([field, label]) => (
              <div className="li" key={field}>
                <div className="body"><div className="t">{label}</div><div className="d">{detail[field] || "—"}</div></div>
                <div className="side">{ext(field)}{level >= 2 && canWrite && <Button size="sm" variant="quiet" onClick={() => setModal({ kind: "link", field })}>Edit</Button>}</div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Recent scenes" right={<Button size="sm" variant="quiet" onClick={() => setTab("activity")}>All activity →</Button>}>
          {detail.sceneLogs.length === 0 ? <Empty>No scenes logged yet.</Empty> : (
            <div className="list">
              {detail.sceneLogs.slice(0, 4).map(l => <div className="li" key={l.id}><div className="body"><div className="t small">{l.logged_by} <span className="faint mono tiny">{l.date}</span></div><div className="d">{String(l.notes || "").slice(0, 160)}{String(l.notes || "").length > 160 ? "…" : ""}</div></div></div>)}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
