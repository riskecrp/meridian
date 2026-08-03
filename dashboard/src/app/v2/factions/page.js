"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/useAuth";
import { getFactions } from "../../fm/factions/actions.js";

const tierBand = (t) => (t >= 7 ? "hi" : t >= 4 ? "mid" : "lo");

export default function V2Factions() {
  const auth = useAuth();
  const router = useRouter();
  const [facs, setFacs] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (auth?.loading || !auth?.id) return;
    getFactions().then(f => { setFacs(f || []); setLoading(false); }).catch(() => setLoading(false));
  }, [auth?.id, auth?.loading]);

  if (auth?.loading || loading) return <div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>;
  if (!auth?.ok) return <div className="view" style={{ color: "var(--ink-3)" }}>Not authorized.</div>;

  const needle = q.trim().toLowerCase();
  const shown = [...facs]
    .filter(f => !needle || `${f.name} ${f.teamName} ${f.leadName}`.toLowerCase().includes(needle))
    .sort((a, b) => (b.tier || 0) - (a.tier || 0) || a.name.localeCompare(b.name));

  const linkStyle = { fontFamily: "var(--v2-mono)", fontSize: 10.5, color: "var(--accent)", padding: "1px 6px", borderRadius: 5 };
  const dim = { color: "var(--ink-3)", opacity: 0.5, fontFamily: "var(--v2-mono)", fontSize: 10.5, padding: "1px 6px" };

  return (
    <div className="view">
      <div className="page-head">
        <div>
          <p className="eyebrow">Faction Management</p>
          <h1>Factions</h1>
          <div className="sub">{facs.length} active · open one to manage everything about it</div>
        </div>
      </div>

      <input className="filter-inp" value={q} onChange={e => setQ(e.target.value)}
        placeholder="Filter by faction, team, or lead…" style={{ marginBottom: 14, maxWidth: 420 }} />

      {shown.length === 0 ? <div className="empty">No factions match.</div> : (
        <div style={{ overflowX: "auto" }}>
          <table className="dtable" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th>Faction</th><th>Tier</th><th>Team</th><th style={{ textAlign: "right" }}>Scenes 30d</th><th style={{ textAlign: "right" }}>Forum 30d</th><th>Links</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(f => (
                <tr key={f.id} style={{ cursor: "pointer" }}
                  onClick={() => router.push(`/v2/factions/${encodeURIComponent(f.name)}`)}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--panel-2)"}
                  onMouseLeave={e => e.currentTarget.style.background = ""}>
                  <td><b>{f.name}</b>{f.pendingPromo ? <span className="chip lock" style={{ marginLeft: 8 }}>promo</span> : null}</td>
                  <td><span className={`tier ${tierBand(f.tier)}`}>T{f.tier}</span></td>
                  <td style={{ color: "var(--ink-2)" }}>{f.teamName || "—"}</td>
                  <td style={{ textAlign: "right", fontFamily: "var(--v2-mono)" }}>{f.scenes30d ?? 0}</td>
                  <td style={{ textAlign: "right", fontFamily: "var(--v2-mono)" }}>{f.forumPosts ?? 0}</td>
                  <td onClick={e => e.stopPropagation()} style={{ whiteSpace: "nowrap" }}>
                    {f.discord ? <a href={f.discord} target="_blank" rel="noreferrer" style={linkStyle}>Discord ↗</a> : <span style={dim}>Discord</span>}
                    {f.forum ? <a href={f.forum} target="_blank" rel="noreferrer" style={linkStyle}>Forum ↗</a> : <span style={dim}>Forum</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
