"use client";
import { useEffect, useState } from "react";
import { getTeamPerformance, getGuideActivity } from "../../fm/leadership/actions.js";
import { Card, Badge, Empty, Tabs } from "../ui.js";

/*
 * Team and guide activity (L2+). L3 sees every team and every staffer; a team
 * lead sees their own team (the server scopes both reads). Same numbers as the
 * v2 Performance tab: per team scenes 30d / all time / forum posts / scenes per
 * faction / open tasks / tasks done 30d; per guide scenes 30d / 31–60d / all,
 * intel notes 30d and tasks completed 30d, ranked by scenes 30d.
 */
export default function Performance() {
  const [view, setView] = useState("teams");
  const [perf, setPerf] = useState(null);
  const [guides, setGuides] = useState(null);
  useEffect(() => {
    Promise.all([getTeamPerformance().catch(() => []), getGuideActivity().catch(() => [])]).then(([p, g]) => { setPerf(p || []); setGuides(g || []); });
  }, []);
  if (!perf || !guides) return <div className="stack"><div className="skeleton" style={{ height: 36 }} /><div className="skeleton" style={{ height: 160 }} /><div className="skeleton" style={{ height: 160 }} /></div>;

  const ranked = [...guides].sort((a, b) => b.scenes30 - a.scenes30);
  const scenesTone = (n) => n >= 10 ? "good" : n >= 5 ? "warn" : "bad";
  return (
    <>
      <Tabs tabs={[{ id: "teams", label: "Teams", count: perf.length }, { id: "guides", label: "Guides", count: guides.length }]} active={view} onChange={setView} />
      {view === "teams" && (perf.length === 0 ? <Empty title="No team data">You are not on a team, or the team has no factions yet.</Empty> : (
        <div className="grid cards">
          {perf.map(t => (
            <Card key={t.teamId} title={t.teamName} right={<span className="muted tiny">Lead {t.leadName} · {t.guideCount} guide{t.guideCount === 1 ? "" : "s"} · {t.factionCount} faction{t.factionCount === 1 ? "" : "s"}</span>}>
              <div className="perf-grid">
                {[["Scenes 30d", t.scenes30, ""], ["All time", t.scenesAll, ""], ["Forum 30d", t.forumPosts30, t.forumPosts30 === 0 ? "bad" : ""], ["Per faction", t.scenesPerFaction, ""], ["Open tasks", t.openTasks, t.openTasks > 0 ? "attn" : ""], ["Done 30d", t.completedTasks, "good"]].map(([l, v, tone]) => (
                  <div key={l} className={`stat${tone ? ` ${tone}` : ""}`}><div className="l">{l}</div><div className="v">{v}</div></div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      ))}
      {view === "guides" && (guides.length === 0 ? <Empty title="No guide data" /> : (
        <Card flush>
          <div className="tblwrap">
            <table className="tbl">
              <thead><tr><th className="num">#</th><th>Staff</th><th className="hide-sm">Team</th><th className="hide-sm">Rank</th><th className="num">30d</th><th className="num hide-sm">31–60d</th><th className="num hide-sm">All</th><th className="num">Notes</th><th className="num">Tasks</th></tr></thead>
              <tbody>
                {ranked.map((g, i) => (
                  <tr key={g.id}>
                    <td className="num faint">{i + 1}</td>
                    <td><b>{g.name}</b></td>
                    <td className="hide-sm muted">{g.team || "—"}</td>
                    <td className="hide-sm">{g.rank ? <Badge>{g.rank}</Badge> : <span className="faint">—</span>}</td>
                    <td className="num"><Badge tone={scenesTone(g.scenes30)}>{g.scenes30}</Badge></td>
                    <td className="num hide-sm faint">{g.scenes60}</td>
                    <td className="num hide-sm faint">{g.scenesAll}</td>
                    <td className="num">{g.notes30}</td>
                    <td className="num">{g.tasksCompleted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="tiny faint" style={{ padding: "8px 16px 12px" }}>Scenes count the author and listed assistants. 30-day scenes: 10+ green, 5–9 amber, under 5 red.</div>
        </Card>
      ))}
    </>
  );
}
