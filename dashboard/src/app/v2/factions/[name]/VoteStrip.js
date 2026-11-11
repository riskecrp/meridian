"use client";
import { useEffect, useState } from "react";
import { getVoteStatus } from "../../../fm/leadership/actions.js";

// Review tab strip (leaders): which active L3s have voted on this faction this
// month, who only left a note, and who is still missing. Reads getVoteStatus.
export default function VoteStrip({ factionId, refreshKey }) {
  const [row, setRow] = useState(null);
  const [month, setMonth] = useState("");
  useEffect(() => {
    if (!factionId) return;
    getVoteStatus().then(r => {
      if (!r?.ok) return;
      setMonth(r.month);
      setRow((r.factions || []).find(f => f.factionId === factionId) || { votes: [], missing: r.voters || [] });
    }).catch(() => {});
  }, [factionId, refreshKey]);
  if (!row) return null;
  const voted = row.votes.filter(v => v.status);
  const noteOnly = row.votes.filter(v => !v.status);
  const total = voted.length + noteOnly.length + row.missing.length;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", margin: "8px 0 2px", padding: "7px 10px", borderRadius: 8, background: "var(--panel-2)", border: "1px solid var(--line)" }}>
      <span style={{ fontFamily: "var(--v2-mono)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--ink-3)" }}>Votes · {month}</span>
      {voted.map(v => <span key={v.authorId} className="chip" style={{ background: "var(--good-bg)", color: "var(--good)" }}>✓ {v.authorName} · {v.status.replace("Confirmed ", "")}</span>)}
      {noteOnly.map(v => <span key={v.authorId} className="chip role">{v.authorName} · note, no vote</span>)}
      {row.missing.map(m => <span key={m.id} className="chip" style={{ background: "var(--amber-bg)", color: "var(--amber)" }}>— {m.name}</span>)}
      <span style={{ flex: 1 }} />
      <span style={{ fontFamily: "var(--v2-mono)", fontSize: 10.5, color: total && voted.length === total ? "var(--good)" : "var(--ink-3)" }}>{voted.length} of {total} voted</span>
    </div>
  );
}
