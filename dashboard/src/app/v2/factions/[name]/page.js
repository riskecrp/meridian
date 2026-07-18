"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "../../../../lib/useAuth";
import { getFactions, getFactionDetail, getFactionContacts } from "../../../fm/factions/actions.js";
import { getReviewHistory, getFactionLeadershipSummary } from "../../../fm/leadership/actions.js";

const tierBand = (t) => (t >= 7 ? "hi" : t >= 4 ? "mid" : "lo");
const IC_STATUS = {
  pending_discussion: { c: "disc", l: "Pending Discussion" },
  pending_roleplay: { c: "rp", l: "Pending Roleplay" },
  completed: { c: "done", l: "Completed" },
};

export default function FactionHub() {
  const auth = useAuth();
  const params = useParams();
  const name = params?.name ? decodeURIComponent(params.name) : "";
  const isLeader = (auth?.level || 0) >= 2 || auth?.isLeadStoryteller;

  const [summary, setSummary] = useState(null);
  const [detail, setDetail] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [leadNotes, setLeadNotes] = useState({ notes: [], pending: [] });
  const [tab, setTab] = useState("overview");
  const [actSub, setActSub] = useState("scenes");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (auth?.loading || !auth?.id || !name) return;
    (async () => {
      const facs = await getFactions().catch(() => []);
      const s = (facs || []).find(f => f.name === name);
      setSummary(s || null);
      const d = await getFactionDetail(name).catch(() => null);
      if (!d) { setNotFound(true); setLoading(false); return; }
      setDetail(d);
      getFactionContacts(d.id).then(c => setContacts(c || [])).catch(() => {});
      if (isLeader) {
        getReviewHistory(d.id).then(r => setReviews(r || [])).catch(() => {});
        getFactionLeadershipSummary(d.id).then(l => setLeadNotes(l || { notes: [], pending: [] })).catch(() => {});
      }
      setLoading(false);
    })();
  }, [auth?.id, auth?.loading, name]);

  if (auth?.loading || loading) return <div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>;
  if (!auth?.ok) return <div className="view" style={{ color: "var(--ink-3)" }}>Not authorized.</div>;
  if (notFound) return <div className="view"><Link className="hub-back" href="/v2/factions">← Factions</Link><div className="empty">Faction “{name}” not found.</div></div>;

  const activeIC = contacts.filter(c => c.status !== "completed").length;
  const TABS = [
    { id: "overview", label: "Overview" },
    { id: "members", label: "Members" },
    { id: "assets", label: "Assets" },
    { id: "activity", label: "Activity" },
    { id: "contacts", label: `IC Contacts${activeIC ? ` · ${activeIC}` : ""}` },
    ...(isLeader ? [{ id: "leadership", label: "Leadership", lock: true }] : []),
  ];

  return (
    <div className="view">
      <Link className="hub-back" href="/v2/factions">← Factions</Link>
      <div className="page-head" style={{ marginBottom: 4 }}>
        <div className="hub-title">
          <h1>{detail.name}</h1>
          <span className={`tier ${tierBand(detail.tier)}`} style={{ fontSize: 11, padding: "3px 8px" }}>Tier {detail.tier}</span>
          {summary?.teamName && <span className="chip role">{summary.teamName}</span>}
          {detail.pendingPromo && <span className="chip lock">🔒 Promo staged</span>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {detail.forum && <a className="btn ghost" href={detail.forum} target="_blank" rel="noreferrer">Forum ↗</a>}
          <a className="btn ghost" href={`https://meridiandatabase.net/faction/${encodeURIComponent(detail.name)}`} target="_blank" rel="noreferrer">Portal ↗</a>
        </div>
      </div>

      <div className="hub-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`hub-tab${tab === t.id ? " on" : ""}`} onClick={() => setTab(t.id)}>
            {t.lock && <span className="lk">🔒</span>}{t.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === "overview" && (
        <div className="hub-body">
          <div className="stack">
            <div className="card">
              <div className="hd"><div className="t">At a glance</div></div>
              <div className="kv">
                <div><div className="k">Tier</div><div className="v">{detail.tier}</div></div>
                <div><div className="k">Scenes · 30d</div><div className="v">{summary?.scenes30d ?? "—"}</div></div>
                <div><div className="k">Forum · 30d</div><div className="v">{summary?.forumPosts ?? "—"}</div></div>
                <div><div className="k">Team</div><div className="v">{summary?.teamName || "—"}</div></div>
                <div><div className="k">Lead</div><div className="v">{summary?.leadName || "—"}</div></div>
                <div><div className="k">Last promoted</div><div className="v">{detail.lastPromoted || "N/A"}</div></div>
              </div>
            </div>
            <div className="card">
              <div className="hd"><div className="t">Guides</div></div>
              <div style={{ padding: "12px 16px", fontSize: 12.5, color: "var(--ink-1)" }}>{summary?.guidesText || "None"}</div>
            </div>
          </div>
          <div className="stack">
            <div className="card">
              <div className="hd"><div className="t">Recent scenes</div><div className="meta">{detail.sceneLogs.length}</div></div>
              {detail.sceneLogs.length === 0 ? <div className="empty">No scenes logged.</div> : (
                <div className="mini">
                  {detail.sceneLogs.slice(0, 4).map(s => (
                    <div className="ev" key={s.id}><div className="when">{(s.date || "").slice(0, 6)}</div><div className="body"><div className="t">{s.logged_by}</div><div className="s">{s.rewards && s.rewards !== "None" ? s.rewards : "no rewards"}</div></div></div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Members */}
      {tab === "members" && (
        <div className="card">
          <div className="hd"><div className="t">Dossier</div><div className="meta">{detail.members.length} known</div></div>
          {detail.members.length === 0 ? <div className="empty">No members recorded.</div> : (
            <table className="dtable">
              <thead><tr><th>Character</th><th>Phone</th><th>Residence</th><th>Role</th></tr></thead>
              <tbody>
                {detail.members.map(m => (
                  <tr key={m.id}>
                    <td><b>{m.character_name}</b></td>
                    <td>{m.phone && m.phone !== "N/A" ? m.phone : "—"}</td>
                    <td>{m.residence && m.residence !== "N/A" ? m.residence : "—"}</td>
                    <td>{m.isLeader ? <span className="chip lock">Leader</span> : <span className="chip role">Member</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Assets */}
      {tab === "assets" && (
        <div className="stack">
          <div className="card">
            <div className="hd"><div className="t">Properties</div><div className="meta">{detail.properties.length}</div></div>
            {detail.properties.length === 0 ? <div className="empty">No properties.</div> : (
              <table className="dtable">
                <thead><tr><th>Address</th><th>Type</th><th></th></tr></thead>
                <tbody>
                  {detail.properties.map(p => (
                    <tr key={p.id}><td><b>{p.address}</b></td><td>{p.property_type || "Property"}</td><td>{p.isHQ ? <span className="chip lock">HQ</span> : ""}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="card">
            <div className="hd"><div className="t">Authorized imports</div><div className="meta">{detail.authorizedItems.length}</div></div>
            {detail.authorizedItems.length === 0 ? <div className="empty">None authorized.</div> : (
              <div className="imp-chips">{detail.authorizedItems.map((n, i) => <span className="ic-chip" key={i}>{n}</span>)}</div>
            )}
          </div>
        </div>
      )}

      {/* Activity */}
      {tab === "activity" && (
        <div className="card">
          <div className="sub-tabs">
            <button className={`tab${actSub === "scenes" ? " on" : ""}`} onClick={() => setActSub("scenes")}>Scenes ({detail.sceneLogs.length})</button>
            <button className={`tab${actSub === "intel" ? " on" : ""}`} onClick={() => setActSub("intel")}>Intel ({detail.notes.length})</button>
            <button className={`tab${actSub === "ooc" ? " on" : ""}`} onClick={() => setActSub("ooc")}>OOC ({detail.oocNotes.length})</button>
          </div>
          <div style={{ borderTop: "1px solid var(--line)", marginTop: 10 }}>
            {actSub === "scenes" && (detail.sceneLogs.length === 0 ? <div className="empty">No scenes.</div> :
              <table className="dtable"><thead><tr><th>Date</th><th>By</th><th>Rewards</th><th>Notes</th></tr></thead><tbody>
                {detail.sceneLogs.map(s => <tr key={s.id}><td>{s.date}</td><td><b>{s.logged_by}</b></td><td>{s.rewards}</td><td style={{ color: "var(--ink-2)" }}>{(s.notes || "").slice(0, 80)}</td></tr>)}
              </tbody></table>)}
            {actSub === "intel" && (detail.notes.length === 0 ? <div className="empty">No intel notes.</div> :
              detail.notes.map(n => <div className="note" key={n.id}>{n.text}<div className="by">— {n.author} · {n.date}</div></div>))}
            {actSub === "ooc" && (detail.oocNotes.length === 0 ? <div className="empty">No OOC notes.</div> :
              detail.oocNotes.map(n => <div className="note" key={n.id}>{n.text}<div className="by">— {n.author} · {n.date}</div></div>))}
          </div>
        </div>
      )}

      {/* IC Contacts */}
      {tab === "contacts" && (
        <div className="card">
          <div className="hd"><div className="t">IC Contacts</div><div className="meta">{activeIC} active · lives here now</div></div>
          {contacts.length === 0 ? <div className="empty">No IC contacts.</div> : contacts.map(c => {
            const st = IC_STATUS[c.status] || IC_STATUS.pending_discussion;
            return (
              <div className="contact" key={c.id}>
                <div className="ch">
                  <span className="from">{c.sender_name || "Unknown"}</span>
                  <span className={`status-pill ${st.c}`}>{st.l}</span>
                  {c.assigned_name && <span className="chip role">{c.assigned_name}</span>}
                </div>
                <div className="msg">{c.message}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Leadership lane (L2+) */}
      {tab === "leadership" && isLeader && (
        <div className="hub-body">
          <div className="stack">
            <div className="card">
              <div className="hd"><div className="t">Review history</div><div className="meta">{reviews.length}</div></div>
              {reviews.length === 0 ? <div className="empty">No reviews on record.</div> : (
                <table className="dtable"><thead><tr><th>Month</th><th>Rating</th><th>Summary</th></tr></thead><tbody>
                  {reviews.map((r, i) => <tr key={i}><td><b>{r.review_month}</b></td><td>{r.rating || r.overall_rating || r.status || "—"}</td><td style={{ color: "var(--ink-2)" }}>{(r.summary || r.notes || r.feedback || "").slice(0, 90) || "—"}</td></tr>)}
                </tbody></table>
              )}
            </div>
          </div>
          <div className="stack">
            <div className="card">
              <div className="hd"><div className="t"><span className="lk" style={{ color: "var(--lock)" }}>🔒</span> Leadership notes</div></div>
              <div className="restricted">Confidential to Leadership · this month</div>
              {(leadNotes.notes || []).length === 0 ? <div className="empty">No notes yet this month.</div> :
                (leadNotes.notes || []).map((n, i) => <div className="note" key={i}>{n.note}{n.status ? ` · ${n.status}` : ""}<div className="by">— {n.author_name || n.author_id}</div></div>)}
              {(leadNotes.pending || []).length > 0 && (
                <div style={{ padding: "10px 16px", fontFamily: "var(--v2-mono)", fontSize: 11, color: "var(--ink-3)", borderTop: "1px solid var(--line)" }}>
                  Awaiting: {(leadNotes.pending || []).map(p => p.display_name).join(", ")}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="disclaimer">Faction hub · IC contacts, reviews &amp; the leadership lane all live inside the faction (move #1)</div>
    </div>
  );
}
