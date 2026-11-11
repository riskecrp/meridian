"use client";
// Comms › Community feedback — player feedback about FM factions (the roleplay
// feedback form). The bot opens a thread per submission in #fm-feedback; this is
// the record of what came in and where each item stands, with the same steps
// the thread buttons offer. L2+, the same gate as the thread buttons.
import { useEffect, useState } from "react";
import Link from "next/link";
import { getFeedbackList, getFeedbackFailures } from "../../fm/feedback/actions.js";
import { FM_GUILD_ID } from "../../../lib/constants.js";
import { Card, Empty } from "../ui.js";
import { STATUS_META, STATUS_ORDER, StatusBadge, FeedbackActions } from "../feedback/FeedbackActions.js";

export function FeedbackList() {
  const [rows, setRows] = useState(null);
  const [counts, setCounts] = useState({});
  const [failures, setFailures] = useState([]);
  const [filter, setFilter] = useState("");
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const load = () => {
    setErr("");
    Promise.all([getFeedbackList(), getFeedbackFailures()])
      .then(([list, fails]) => { setRows(list?.rows || []); setCounts(list?.counts || {}); setFailures(fails || []); })
      .catch(e => { setErr(e?.message || "Could not load feedback."); setRows([]); });
  };
  useEffect(() => { load(); }, []);

  if (rows === null) return <div className="skeleton skel-lg" />;
  const needle = q.trim().toLowerCase();
  const shown = rows.filter(r => (!filter || r.status === filter) && (!needle || `${r.faction} ${r.character_name} ${r.discord_username}`.toLowerCase().includes(needle)));
  return (
    <div className="stack">
      {err && <div className="err">{err}</div>}
      {/* Only ever populated when a submission failed to reach Discord three times running. */}
      {failures.length > 0 && (
        <div className="failbox" role="alert">
          <b>{failures.length} submission{failures.length === 1 ? "" : "s"} could not be posted to Discord</b>
          {failures.map(f => <div key={f.sheet_row} className="ln">Sheet row {f.sheet_row} — {f.attempts} attempt{f.attempts === 1 ? "" : "s"}{f.skipped ? ", skipped" : ", retrying"} · {f.last_error}</div>)}
        </div>
      )}
      <div className="row spread">
        <div className="chips">
          <button type="button" className={`chip${!filter ? " on" : ""}`} onClick={() => setFilter("")}>All{rows.length ? ` (${rows.length})` : ""}</button>
          {STATUS_ORDER.map(key => <button key={key} type="button" className={`chip${filter === key ? " on" : ""}`} onClick={() => setFilter(filter === key ? "" : key)}>{STATUS_META[key].label}{counts[key] ? ` (${counts[key]})` : ""}</button>)}
        </div>
        <input className="inp search-inp" placeholder="Search faction, character, Discord…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search feedback" />
      </div>
      {shown.length === 0 ? <Empty title={`No feedback ${filter ? "with this status " : ""}yet`} /> : (
        <Card flush>
          <div className="tblwrap">
            <table className="tbl">
              <thead><tr><th>Faction</th><th>Character</th><th className="hide-sm">Discord</th><th className="hide-sm" title="When the player submitted the form">Received</th><th>Status</th><th className="hide-sm">Handled by</th><th></th></tr></thead>
              <tbody>
                {shown.map(r => (
                  <tr key={r.id}>
                    <td><Link href={`/v3/feedback/${r.id}`}><b>{r.faction}</b></Link></td>
                    <td>{r.character_name}</td>
                    <td className="hide-sm muted">{r.discord_username}</td>
                    <td className="hide-sm mono tiny faint" title={`Logged ${r.created_at}`}>{r.received}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td className="hide-sm muted">{r.concluded_by_name || r.claimed_by_name || <span className="faint">—</span>}</td>
                    <td>
                      <span className="actions-inline">
                        <Link href={`/v3/feedback/${r.id}`} className="btn ghost sm">View</Link>
                        {r.thread_id && <a className="btn quiet sm" href={`https://discord.com/channels/${FM_GUILD_ID}/${r.thread_id}`} target="_blank" rel="noopener noreferrer">Thread ↗</a>}
                        <FeedbackActions item={r} onDone={load} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <div className="faint tiny">Acknowledge = the submitter has been messaged. Open items are nudged in their thread every 48h; Snooze buys 7 days. Reopen brings a closed item back to where it was.</div>
    </div>
  );
}
