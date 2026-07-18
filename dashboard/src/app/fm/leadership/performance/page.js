"use client";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../lib/useAuth";
import { getTeamPerformance, getGuideActivity } from "../actions";
import LeadershipShell from "../_shared/Shell";

const subtab = (active) => ({
  padding: "6px 16px", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em",
  cursor: "pointer", borderRadius: 8, border: "1px solid var(--border)",
  background: active ? "var(--leadership)" : "var(--bg-2)",
  color: active ? "#fff" : "var(--fg-3)",
});

export default function PerformancePage() {
  const auth = useAuth();
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("teams");
  const [performance, setPerformance] = useState([]);
  const [guides, setGuides] = useState([]);
  const canAccess = !auth.loading && auth.level >= 2;

  useEffect(() => {
    if (auth.loading || !canAccess) return;
    (async () => {
      setLoading(true);
      const [p, g] = await Promise.all([getTeamPerformance(), getGuideActivity()]);
      setPerformance(p); setGuides(g); setLoading(false);
    })();
  }, [auth.loading, canAccess]);

  // Honour ?view=guides (used by the old /leadership/guides redirect).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const v = new URLSearchParams(window.location.search).get("view");
    if (v === "guides" || v === "teams") setView(v);
  }, []);

  if (auth.loading) return <div className="p-10 text-sm animate-pulse" style={{ color: "var(--accent)" }}>Loading...</div>;
  if (!canAccess) return <div className="p-10 text-sm" style={{ color: "var(--red)" }}>Access denied.</div>;

  return (
    <LeadershipShell title="Performance" docs={[{ title: "Leadership Tools", label: "Team Performance Guide", minLevel: 2 }, { title: "Leadership Tools", label: "Guide Activity Guide", minLevel: 2 }]} level={auth.level}>
      {loading && <div className="text-sm animate-pulse" style={{ color: "var(--accent)" }}>Loading...</div>}
      {!loading && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <button style={subtab(view === "teams")} onClick={() => setView("teams")}>Teams</button>
            <button style={subtab(view === "guides")} onClick={() => setView("guides")}>Guides</button>
          </div>

          {/* ── TEAMS ── */}
          {view === "teams" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {performance.map((t) => (
                <div key={t.teamId} className="sec-card">
                  <div className="sec-card-hdr">
                    <div>
                      <span style={{ fontFamily: "var(--font-display)", fontSize: 14, color: "var(--fg-0)", letterSpacing: 0 }}>{t.teamName}</span>
                      <span style={{ marginLeft: 10, fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--fg-4)" }}>Lead: {t.leadName} · {t.guideCount}G · {t.factionCount}F</span>
                    </div>
                  </div>
                  <div style={{ padding: "12px 14px", display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 0 }}>
                    {[
                      { val: t.scenes30, lbl: "Scenes 30d", col: "var(--accent)" },
                      { val: t.scenesAll, lbl: "All Time", col: "var(--fg-3)" },
                      { val: t.forumPosts30, lbl: "Forum 30d", col: "var(--amber)" },
                      { val: t.scenesPerFaction, lbl: "Per Faction", col: "var(--fg-1)" },
                      { val: t.openTasks, lbl: "Open Tasks", col: "var(--amber)" },
                      { val: t.completedTasks, lbl: "Done 30d", col: "var(--green)" },
                    ].map(({ val, lbl, col }) => (
                      <div key={lbl} style={{ textAlign: "center", padding: "8px 4px", borderRight: "1px solid var(--border)" }}>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 300, color: col, lineHeight: 1, marginBottom: 4 }}>{val}</div>
                        <div style={{ fontSize: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--fg-4)", fontFamily: "var(--font-mono)" }}>{lbl}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {performance.length === 0 && <div className="empty-state">No team data available.</div>}
            </div>
          )}

          {/* ── GUIDES ── */}
          {view === "guides" && (
            <div className="sec-card">
              <table className="dtable">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Staff</th>
                    <th>Team</th>
                    <th>Rank</th>
                    <th style={{ textAlign: "right" }}>30d</th>
                    <th style={{ textAlign: "right" }}>31-60d</th>
                    <th style={{ textAlign: "right" }}>All Time</th>
                    <th style={{ textAlign: "right" }}>Notes</th>
                    <th style={{ textAlign: "right" }}>Tasks</th>
                  </tr>
                </thead>
                <tbody>
                  {[...guides].sort((a, b) => b.scenes30 - a.scenes30).map((g, i) => (
                    <tr key={g.id}>
                      <td style={{ color: "var(--fg-4)", fontFamily: "var(--font-mono)", width: 32 }}>{i + 1}</td>
                      <td style={{ fontWeight: 700 }}>{g.name}</td>
                      <td style={{ color: "var(--fg-3)" }}>{g.team}</td>
                      <td><span className="badge badge-dim">{g.rank}</span></td>
                      <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 700, color: g.scenes30 >= 10 ? "var(--green)" : g.scenes30 >= 5 ? "var(--amber)" : "var(--red)" }}>{g.scenes30}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--fg-4)" }}>{g.scenes60}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--fg-4)" }}>{g.scenesAll}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{g.notes30}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{g.tasksCompleted}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {guides.length === 0 && <div className="empty-state">No guide data available.</div>}
            </div>
          )}
        </>
      )}
    </LeadershipShell>
  );
}
