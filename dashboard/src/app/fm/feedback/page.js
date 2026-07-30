"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../../lib/useAuth";
import { getFeedbackList, getFeedbackFailures } from "./actions";
import { ui } from "../../../lib/ui.js";

// Player feedback about FM factions, taken from the roleplay feedback form. The
// bot opens a thread per submission in #fm-feedback and the outcome is worked
// there; this page is the record of what came in and where each item ended up.
//
// Read-only by design — see actions.js.

const GUILD_ID = "1457188814916423855";

const STATUS_META = {
  new:       { label: "Pending Acknowledgement", color: "var(--accent)", dot: "●" },
  claimed:   { label: "Pending Review",          color: "var(--amber)",  dot: "●" },
  completed: { label: "Completed",               color: "var(--green)",  dot: "●" },
  cancelled: { label: "Cancelled",               color: "var(--fg-4)",   dot: "○" },
};
const FILTERS = ["new", "claimed", "completed", "cancelled"];

const st = {
  ...ui,
  chip: { background:'transparent', color:'var(--fg-3)', border:'1px solid var(--border)', padding:'6px 14px', borderRadius:999, fontSize:10, fontWeight:700, cursor:'pointer', textTransform:'uppercase', letterSpacing:'0.1em' },
  chipOn: { borderColor:'var(--accent)', color:'var(--accent)' },
  link: { color:'var(--accent)', fontSize:11, fontWeight:700, textDecoration:'none', whiteSpace:'nowrap' },
};

export default function FeedbackPage() {
  const auth = useAuth();
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [failures, setFailures] = useState([]);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (auth.loading || auth.level < 2) return;
    (async () => {
      const [list, fails] = await Promise.all([getFeedbackList(), getFeedbackFailures()]);
      setRows(list.rows); setCounts(list.counts); setFailures(fails);
      setLoading(false);
    })();
  }, [auth.loading, auth.level]);

  if (auth.loading) return <div className="p-10 text-sm animate-pulse" style={{ color:'var(--accent)' }}>Loading...</div>;
  if (auth.level < 2) return <div className="p-10" style={{ color:'var(--red)' }}>Access denied.</div>;

  const shown = rows.filter(r => {
    if (filter && r.status !== filter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return `${r.faction} ${r.character_name} ${r.discord_username}`.toLowerCase().includes(q);
  });

  return (
    <div className="page-shell">
      <div className="page-hdr" style={{ background:'linear-gradient(180deg,rgba(231,76,60,0.04) 0%,transparent 100%)' }}>
        <div className="accent-bar" style={{ background:'linear-gradient(90deg,var(--red) 0%,transparent 60%)' }} />
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
          <div>
            <div className="page-hdr-tag" style={{ color:'var(--red)' }}>Overview / Faction Feedback</div>
            <h1>Faction Feedback</h1>
            <div className="page-hdr-sub">Player feedback from the roleplay form — worked in #fm-feedback, tracked here</div>
          </div>
        </div>
      </div>

      <div className="page-body scr" style={{ display:'flex', flexDirection:'column', gap:14 }}>
        {/* Only ever populated when a submission failed to reach Discord three
            times running. Loud on purpose: this is the one way an item can go
            missing, and someone is usually asking about it. */}
        {failures.length > 0 && (
          <div style={{ padding:'10px 14px', borderRadius:10, background:'var(--amber-bg)', border:'1px solid var(--amber)' }}>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--amber)' }}>
              {failures.length} submission{failures.length === 1 ? '' : 's'} could not be posted to Discord
            </div>
            {failures.map(f => (
              <div key={f.sheet_row} style={{ fontSize:11, color:'var(--fg-3)', marginTop:4 }}>
                Sheet row {f.sheet_row} — {f.attempts} attempt{f.attempts === 1 ? '' : 's'}
                {f.skipped ? ', skipped' : ', retrying'} · {f.last_error}
              </div>
            ))}
          </div>
        )}

        <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
          <button style={{ ...st.chip, ...(filter ? {} : st.chipOn) }} onClick={() => setFilter("")}>
            All{rows.length ? ` (${rows.length})` : ''}
          </button>
          {FILTERS.map(key => (
            <button key={key} style={{ ...st.chip, ...(filter === key ? st.chipOn : {}) }}
              onClick={() => setFilter(filter === key ? "" : key)}>
              {STATUS_META[key].label}{counts[key] ? ` (${counts[key]})` : ''}
            </button>
          ))}
          <input style={{ ...st.input, marginLeft:'auto', maxWidth:280 }} placeholder="Search faction, character, Discord..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <div className="sec-card">
          <table className="dtable">
            <thead>
              <tr>
                <th>Faction</th>
                <th>Character</th>
                <th>Discord</th>
                <th>Received</th>
                <th>Status</th>
                <th>Handled by</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 5 }, (_, r) => (
                <tr key={`sk${r}`}>
                  {Array.from({ length: 7 }, (_, c) => (
                    <td key={c}><span className="sk-bar" style={{ height:9, borderRadius:3, width:`${[80,60,70,55,75,50,40][c]}%` }} /></td>
                  ))}
                </tr>
              ))}
              {!loading && shown.map(r => {
                const meta = STATUS_META[r.status] || STATUS_META.new;
                return (
                  <tr key={r.id}>
                    <td style={{ fontWeight:700 }}>{r.faction}</td>
                    <td>{r.character_name}</td>
                    <td style={{ fontSize:12, color:'var(--fg-3)' }}>{r.discord_username}</td>
                    <td style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--fg-4)', whiteSpace:'nowrap' }}>{r.created_at}</td>
                    <td style={{ color:meta.color, fontSize:12, whiteSpace:'nowrap' }}>{meta.dot} {meta.label}</td>
                    <td style={{ fontSize:12, color:'var(--fg-3)' }}>
                      {r.concluded_by_name || r.claimed_by_name || <span style={{ color:'var(--fg-4)' }}>—</span>}
                    </td>
                    <td style={{ textAlign:'right', whiteSpace:'nowrap' }}>
                      <Link href={`/fm/feedback/${r.id}`} style={st.link}>View</Link>
                      {r.thread_id && (
                        <a href={`https://discord.com/channels/${GUILD_ID}/${r.thread_id}`} target="_blank" rel="noopener noreferrer"
                          style={{ ...st.link, marginLeft:12 }}>Thread ↗</a>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && !shown.length && (
                <tr><td colSpan={7} style={{ textAlign:'center', color:'var(--fg-4)', padding:24 }}>
                  No feedback {filter ? 'with this status ' : ''}yet.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
