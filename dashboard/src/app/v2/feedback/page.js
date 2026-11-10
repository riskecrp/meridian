"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../../lib/useAuth";
import { getFeedbackList, getFeedbackFailures } from "../../fm/feedback/actions";
import { FM_GUILD_ID } from "../../../lib/constants";
import { STATUS_META, FeedbackActions } from "./FeedbackActions.js";

const FILTERS = ["new", "claimed", "completed", "cancelled"];

/* /v2/feedback — player feedback about FM factions (the roleplay feedback
   form). The bot opens a thread per submission in #fm-feedback; this is the
   record of what came in and where each item stands, with the same steps the
   thread buttons offer: acknowledge, complete, cancel, snooze, reopen. L2+,
   the same gate as the thread buttons (team leads, leadership, Game Affairs). */

export default function V2Feedback() {
  const auth = useAuth();
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [failures, setFailures] = useState([]);
  const [filter, setFilter] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = () => {
    Promise.all([getFeedbackList(), getFeedbackFailures()])
      .then(([list, fails]) => { setRows(list.rows); setCounts(list.counts); setFailures(fails); setLoading(false); })
      .catch(e => { setErr(e?.message || "Could not load feedback."); setLoading(false); });
  };
  useEffect(() => {
    if (auth?.loading || !auth?.id) return;
    if ((auth.level || 0) < 2) { setLoading(false); return; }
    load();
  }, [auth?.id, auth?.loading, auth?.level]);

  if (auth?.loading || loading) return <div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>;
  if (!auth?.ok) return <div className="view" style={{ color: "var(--ink-3)" }}>Not authorized.</div>;
  if ((auth.level || 0) < 2) return <div className="view"><div className="page-head"><div><p className="eyebrow">Leadership</p><h1>Faction Feedback</h1></div></div><div className="empty">Faction feedback is worked by team leads and leadership (L2+).</div></div>;

  const needle = q.trim().toLowerCase();
  const shown = rows.filter(r => (!filter || r.status === filter) && (!needle || `${r.faction} ${r.character_name} ${r.discord_username}`.toLowerCase().includes(needle)));

  return (
    <div className="view">
      <div className="page-head">
        <div>
          <p className="eyebrow">Leadership</p>
          <h1>Faction Feedback</h1>
          <div className="sub">Player feedback from the roleplay form — worked in #fm-feedback, tracked here</div>
        </div>
      </div>

      {err && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}

      {/* Only ever populated when a submission failed to reach Discord three
          times running. Loud on purpose: this is the one way an item can go
          missing, and someone is usually asking about it. */}
      {failures.length > 0 && (
        <div className="alert warn" style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 700 }}>{failures.length} submission{failures.length === 1 ? "" : "s"} could not be posted to Discord</div>
          {failures.map(f => (
            <div key={f.sheet_row} style={{ fontSize: 11.5, marginTop: 4 }}>
              Sheet row {f.sheet_row} — {f.attempts} attempt{f.attempts === 1 ? "" : "s"}{f.skipped ? ", skipped" : ", retrying"} · {f.last_error}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <button className={`pill${!filter ? " on" : ""}`} onClick={() => setFilter("")}>All{rows.length ? ` (${rows.length})` : ""}</button>
        {FILTERS.map(key => (
          <button key={key} className={`pill${filter === key ? " on" : ""}`} onClick={() => setFilter(filter === key ? "" : key)}>
            {STATUS_META[key].label}{counts[key] ? ` (${counts[key]})` : ""}
          </button>
        ))}
        <input className="filter-inp" style={{ marginLeft: "auto", maxWidth: 300 }} placeholder="Search faction, character, Discord…" value={q} onChange={e => setQ(e.target.value)} />
      </div>

      {shown.length === 0 ? <div className="empty">No feedback {filter ? "with this status " : ""}yet.</div> : (
        <div style={{ overflowX: "auto" }}>
          <table className="dtable" style={{ minWidth: 820 }}>
            <thead>
              <tr><th>Faction</th><th>Character</th><th>Discord</th><th title="When the player submitted the form">Received</th><th>Status</th><th>Handled by</th><th></th></tr>
            </thead>
            <tbody>
              {shown.map(r => {
                const meta = STATUS_META[r.status] || STATUS_META.new;
                return (
                  <tr key={r.id}>
                    <td><b>{r.faction}</b></td>
                    <td>{r.character_name}</td>
                    <td style={{ color: "var(--ink-2)" }}>{r.discord_username}</td>
                    <td style={{ fontFamily: "var(--v2-mono)", fontSize: 11, color: "var(--ink-3)", whiteSpace: "nowrap" }} title={`Logged ${r.created_at}`}>{r.received}</td>
                    <td style={{ color: meta.color, whiteSpace: "nowrap" }}>{meta.dot} {meta.label}</td>
                    <td style={{ color: "var(--ink-2)" }}>{r.concluded_by_name || r.claimed_by_name || <span style={{ color: "var(--ink-3)" }}>—</span>}</td>
                    <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                      <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                        <Link href={`/v2/feedback/${r.id}`} className="act">View</Link>
                        {r.thread_id && <a className="act" href={`https://discord.com/channels/${FM_GUILD_ID}/${r.thread_id}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>Thread ↗</a>}
                        <FeedbackActions item={r} onDone={load} compact />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="disclaimer">Acknowledge = the submitter has been messaged. Open items are nudged in their thread every 48h; Snooze buys 7 days. Reopen brings a closed item back to where it was.</div>
    </div>
  );
}
