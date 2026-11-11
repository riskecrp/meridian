"use client";
import { useEffect, useState } from "react";
import { getPromotionReadiness } from "../../../fm/factions/actions.js";

// Overview card (L2+): the faction's numbers against the readiness targets for
// its tier (READINESS_TARGETS in fm/factions/actions.js). A guide for the
// review conversation, not a gate. `refreshKey` re-reads after hub writes.
export default function Readiness({ factionId, refreshKey }) {
  const [r, setR] = useState(null);
  useEffect(() => { if (factionId) getPromotionReadiness(factionId).then(x => setR(x || null)).catch(() => setR(null)); }, [factionId, refreshKey]);
  if (!r) return null;
  return (
    <div className="card">
      <div className="hd"><div className="t">Promotion readiness</div><div className="meta">{r.nextTier == null ? "top tier" : `next: Tier ${r.nextTier}`} · {r.met}/{r.checks.length} met</div></div>
      {r.checks.map(c => (
        <div className="clog" key={c.id}>
          <span style={{ fontFamily: "var(--v2-mono)", fontSize: 12, fontWeight: 800, width: 14, color: c.ok ? "var(--good)" : "var(--amber)" }}>{c.ok ? "✓" : "✕"}</span>
          <span style={{ color: "var(--ink-1)" }}>{c.label}</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontFamily: "var(--v2-mono)", fontSize: 11.5, whiteSpace: "nowrap" }}><b style={{ color: c.ok ? "var(--ink-0)" : "var(--amber)" }}>{c.value}</b> <span style={{ color: "var(--ink-3)" }}>· target {c.op === "max" ? `≤ ${c.target}` : `≥ ${c.target}`}</span></span>
        </div>
      ))}
      <div style={{ paddingTop: 8, fontSize: 11, color: r.ready && !r.staged ? "var(--good)" : "var(--ink-3)" }}>
        {r.archived ? "Archived — for the record only." : r.staged ? "A promotion is already staged — complete it from the Review tab." : r.ready ? "Every check is met — worth raising at this month's review." : "Targets are set per tier by leadership; a guide for the review, not a gate."}
      </div>
    </div>
  );
}
