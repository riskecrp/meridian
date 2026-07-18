"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../../lib/useAuth";
import { getFactions } from "../../fm/factions/actions.js";

const tierBand = (t) => (t >= 7 ? "hi" : t >= 4 ? "mid" : "lo");

export default function V2Factions() {
  const auth = useAuth();
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

  return (
    <div className="view">
      <div className="page-head">
        <div>
          <p className="eyebrow">Faction Management</p>
          <h1>Factions</h1>
          <div className="sub">{facs.length} active · open one to manage everything about it in one place</div>
        </div>
      </div>

      <input className="filter-inp" value={q} onChange={e => setQ(e.target.value)}
        placeholder="Filter by faction, team, or lead…" style={{ marginBottom: 14, maxWidth: 420 }} />

      {shown.length === 0 ? <div className="empty">No factions match.</div> : (
        <div className="fac-grid" style={{ marginTop: 0 }}>
          {shown.map(f => (
            <Link className="fac" href={`/v2/factions/${encodeURIComponent(f.name)}`} key={f.id}>
              <div className="top"><div className="nm">{f.name}</div><span className={`tier ${tierBand(f.tier)}`}>T{f.tier}</span></div>
              <div className="mini-stats">
                <div className="ms"><div className="n">{f.scenes30d ?? 0}</div><div className="k">Scenes</div></div>
                <div className="ms"><div className="n">{f.forumPosts ?? 0}</div><div className="k">Forum</div></div>
              </div>
              <div className="lead">↳ {f.teamName || "No team"}{f.pendingPromo ? " · promo staged" : ""}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
