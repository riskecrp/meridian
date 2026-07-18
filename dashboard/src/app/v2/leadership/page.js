"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../../lib/useAuth";
import { getTeamPerformance, getGuideActivity, getMeetingNotes, saveMeetingNote, deleteMeetingNote, getNoteTargets, getAttendeesForTarget, getReviewData, getPendingQueue } from "../../fm/leadership/actions.js";
import { approveRPChange, denyRPChange, markRPDone, executeRPChange, deleteRPChange, resolveDeletion } from "../../fm/operations/actions.js";
import { completePromotion, cancelPromotion } from "../../fm/factions/actions.js";

function Modal({ title, onClose, onSave, saveDisabled, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={onClose} />
      <div style={{ position: "relative", width: "100%", maxWidth: 520, background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 12, padding: 18 }}>
        <div style={{ fontWeight: 700, color: "var(--ink-0)", marginBottom: 14 }}>{title}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button className="act" onClick={onClose}>Cancel</button>
          {onSave && <button className="act primary" disabled={saveDisabled} onClick={onSave}>Save</button>}
        </div>
      </div>
    </div>
  );
}

export default function V2Leadership() {
  const auth = useAuth();
  const can = (auth?.level || 0) >= 2 || auth?.isLeadStoryteller;
  const [tab, setTab] = useState("approvals");
  if (auth?.loading) return <div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>;
  if (!auth?.ok || !can) return <div className="view" style={{ color: "var(--ink-3)" }}>Team Lead or Leadership access required.</div>;
  const TABS = [["approvals", "Approvals"], ["performance", "Performance"], ["notes", "Meeting Notes"], ["reviews", "Reviews"]];
  return (
    <div className="view">
      <div className="page-head"><div><p className="eyebrow">Leadership</p><h1>Oversight</h1><div className="sub">Cross-faction approvals, performance and the monthly review roll-up.</div></div></div>
      <div className="hub-tabs">{TABS.map(([v, l]) => <button key={v} className={`hub-tab${tab === v ? " on" : ""}`} onClick={() => setTab(v)}>{l}</button>)}</div>
      {tab === "approvals" && <Approvals auth={auth} />}
      {tab === "performance" && <Performance />}
      {tab === "notes" && <MeetingNotes auth={auth} />}
      {tab === "reviews" && <Reviews />}
      <div className="disclaimer">IC-contact triage (L3 roll-up) — porting next; per-faction IC contacts live in the faction hub.</div>
    </div>
  );
}

/* ── Approvals ── */
function Approvals({ auth }) {
  const isL3 = auth.level >= 3;
  const [q, setQ] = useState({ rpChanges: [], deletions: [], promos: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [npcExec, setNpcExec] = useState(null); // {id, npcName, npcPos}
  const load = () => getPendingQueue().then(x => { setQ(x || { rpChanges: [], deletions: [], promos: [] }); setLoading(false); }).catch(() => setLoading(false));
  useEffect(() => { load(); }, []);
  const run = async (fn) => { setBusy(true); try { await fn(); } finally { setBusy(false); load(); } };
  const total = q.rpChanges.length + q.deletions.length + q.promos.length;
  if (loading) return <div className="empty">Loading…</div>;
  if (total === 0) return <div className="empty">Nothing awaiting approval.</div>;

  const statusMeta = (s) => s === "RP_DONE" ? { c: "var(--accent)", l: "READY TO EXECUTE" } : s === "APPROVED" ? { c: "var(--sky)", l: "AWAITING RP" } : { c: "var(--amber)", l: "PENDING APPROVAL" };

  return (
    <>
      {q.rpChanges.length > 0 && <div className="card"><div className="hd"><div className="t">RP changes</div><div className="meta">{q.rpChanges.length}</div></div>
        {q.rpChanges.map(rc => { const m = statusMeta(rc.status); return (
          <div key={rc.id} className="clog" style={{ alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 3 }}>
                <span className="chip" style={{ background: "var(--amber-bg)", color: "var(--amber)" }}>RP · {rc.faction_name}</span>
                <span style={{ fontFamily: "var(--v2-mono)", fontSize: 9, fontWeight: 800, color: m.c }}>{m.l}</span>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--ink-1)" }}>{rc.execution_type}: <b>{rc.old_value}</b> → <b>{rc.new_value}</b></div>
              <div style={{ fontFamily: "var(--v2-mono)", fontSize: 10.5, color: "var(--ink-3)" }}>{rc.requested_by} · {rc.date}</div>
            </div>
            {isL3 && <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {rc.status === "PENDING" && <>
                <button className="act" style={{ color: "var(--rose)" }} disabled={busy} onClick={async () => { const reason = window.prompt("Reason for denial (required):"); if (reason?.trim()) run(() => denyRPChange(rc.id, reason.trim())); }}>Deny</button>
                <button className="act good" disabled={busy} onClick={() => run(() => approveRPChange(rc.id))}>Approve</button>
              </>}
              {rc.status === "APPROVED" && <span style={{ fontSize: 11, color: "var(--sky)", fontStyle: "italic" }}>Waiting for Team Lead to confirm RP.</span>}
              {rc.status === "RP_DONE" && <button className="act good" disabled={busy} onClick={() => { if (rc.execution_type === "NPC") setNpcExec({ id: rc.id, npcName: "", npcPos: "" }); else if (window.confirm("Execute this change?")) run(() => executeRPChange(rc.id, {})); }}>Execute</button>}
              <button className="act" disabled={busy} onClick={() => { if (window.confirm(`Delete this RP change for ${rc.faction_name}?`)) run(() => deleteRPChange(rc.id)); }}>Delete</button>
            </div>}
          </div>
        ); })}
      </div>}

      {q.deletions.length > 0 && <div className="card"><div className="hd"><div className="t">Deletion requests</div><div className="meta">{q.deletions.length}</div></div>
        {q.deletions.map(d => (
          <div key={d.id} className="clog" style={{ alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <span className="chip" style={{ background: "var(--rose-bg)", color: "var(--rose)" }}>DELETE · {d.content_type}</span>
              <div style={{ fontSize: 12.5, color: "var(--ink-1)", marginTop: 3 }}>{(d.original_text || "").slice(0, 120)}</div>
              <div style={{ fontFamily: "var(--v2-mono)", fontSize: 10.5, color: "var(--ink-3)" }}>{d.requested_by} · {d.created_at?.slice(0, 10)}</div>
            </div>
            {isL3 && <div style={{ display: "flex", gap: 5 }}>
              <button className="act" disabled={busy} onClick={() => run(() => resolveDeletion(d.id, false))}>Reject</button>
              <button className="act" style={{ color: "var(--rose)" }} disabled={busy} onClick={() => { if (window.confirm("Permanently delete this content?")) run(() => resolveDeletion(d.id, true)); }}>Approve delete</button>
            </div>}
          </div>
        ))}
      </div>}

      {q.promos.length > 0 && <div className="card"><div className="hd"><div className="t">Staged promotions</div><div className="meta">{q.promos.length}</div></div>
        {q.promos.map(p => { let tgt = p.target_tier; try { tgt = JSON.parse(p.target_tier).tier; } catch {} return (
          <div key={p.faction_id} className="clog">
            <span className="chip" style={{ background: "var(--good-bg)", color: "var(--good)" }}>PROMO · {p.faction_name}</span>
            <span style={{ fontFamily: "var(--v2-mono)", color: "var(--ink-1)" }}>T{p.current_tier} → T{tgt}</span>
            <span style={{ flex: 1 }} />
            {isL3 && <>
              <button className="act" style={{ color: "var(--rose)" }} disabled={busy} onClick={() => { if (window.confirm(`Cancel promo for ${p.faction_name}?`)) run(() => cancelPromotion(p.faction_id, p.faction_name)); }}>Cancel</button>
              <button className="act good" disabled={busy} onClick={() => { if (window.confirm(`Complete promo for ${p.faction_name}?`)) run(() => completePromotion(p.faction_id, p.faction_name)); }}>Complete</button>
            </>}
          </div>
        ); })}
      </div>}

      {npcExec && <Modal title="Execute NPC swap" onClose={() => setNpcExec(null)} onSave={() => run(() => executeRPChange(npcExec.id, { npcName: npcExec.npcName, npcPos: npcExec.npcPos }))} saveDisabled={!npcExec.npcName.trim()}>
        <input className="filter-inp" placeholder="Final NPC name" value={npcExec.npcName} onChange={e => setNpcExec({ ...npcExec, npcName: e.target.value })} />
        <input className="filter-inp" placeholder="TP position" value={npcExec.npcPos} onChange={e => setNpcExec({ ...npcExec, npcPos: e.target.value })} />
      </Modal>}
    </>
  );
}

/* ── Performance ── */
function Performance() {
  const [view, setView] = useState("teams");
  const [perf, setPerf] = useState([]);
  const [guides, setGuides] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { Promise.all([getTeamPerformance().catch(() => []), getGuideActivity().catch(() => [])]).then(([p, g]) => { setPerf(p || []); setGuides(g || []); setLoading(false); }); }, []);
  if (loading) return <div className="empty">Loading…</div>;
  return (
    <>
      <div className="sub-tabs" style={{ marginBottom: 14 }}>
        <button className={`tab${view === "teams" ? " on" : ""}`} onClick={() => setView("teams")}>Teams</button>
        <button className={`tab${view === "guides" ? " on" : ""}`} onClick={() => setView("guides")}>Guides</button>
      </div>
      {view === "teams" ? (perf.length === 0 ? <div className="empty">No team data.</div> : perf.map(t => (
        <div className="card" key={t.teamId}>
          <div className="hd"><div className="t">{t.teamName}</div><div className="meta">Lead {t.leadName} · {t.guideCount}G · {t.factionCount}F</div></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 0, paddingTop: 8 }}>
            {[["Scenes 30d", t.scenes30, "var(--accent)"], ["All time", t.scenesAll, "var(--ink-2)"], ["Forum 30d", t.forumPosts30, "var(--amber)"], ["Per faction", t.scenesPerFaction, "var(--ink-1)"], ["Open tasks", t.openTasks, "var(--amber)"], ["Done 30d", t.completedTasks, "var(--good)"]].map(([l, v, c]) => (
              <div key={l} style={{ textAlign: "center", padding: "6px 4px" }}>
                <div style={{ fontFamily: "var(--v2-mono)", fontSize: 22, fontWeight: 600, color: c, lineHeight: 1 }}>{v}</div>
                <div style={{ fontSize: 8.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ink-3)", fontFamily: "var(--v2-mono)", marginTop: 4 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      ))) : (
        <div className="card"><div style={{ overflowX: "auto" }}>
          <table className="dtable" style={{ minWidth: 640 }}>
            <thead><tr><th>#</th><th>Staff</th><th>Team</th><th>Rank</th><th style={{ textAlign: "right" }}>30d</th><th style={{ textAlign: "right" }}>31-60d</th><th style={{ textAlign: "right" }}>All</th><th style={{ textAlign: "right" }}>Notes</th><th style={{ textAlign: "right" }}>Tasks</th></tr></thead>
            <tbody>
              {[...guides].sort((a, b) => b.scenes30 - a.scenes30).map((g, i) => (
                <tr key={g.id}>
                  <td style={{ color: "var(--ink-3)", fontFamily: "var(--v2-mono)" }}>{i + 1}</td>
                  <td><b>{g.name}</b></td><td style={{ color: "var(--ink-2)" }}>{g.team}</td><td><span className="chip role">{g.rank}</span></td>
                  <td style={{ textAlign: "right", fontFamily: "var(--v2-mono)", fontWeight: 700, color: g.scenes30 >= 10 ? "var(--good)" : g.scenes30 >= 5 ? "var(--amber)" : "var(--rose)" }}>{g.scenes30}</td>
                  <td style={{ textAlign: "right", fontFamily: "var(--v2-mono)", color: "var(--ink-3)" }}>{g.scenes60}</td>
                  <td style={{ textAlign: "right", fontFamily: "var(--v2-mono)", color: "var(--ink-3)" }}>{g.scenesAll}</td>
                  <td style={{ textAlign: "right", fontFamily: "var(--v2-mono)" }}>{g.notes30}</td>
                  <td style={{ textAlign: "right", fontFamily: "var(--v2-mono)" }}>{g.tasksCompleted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>{guides.length === 0 && <div className="empty">No guide data.</div>}</div>
      )}
    </>
  );
}

/* ── Meeting Notes ── */
function MeetingNotes({ auth }) {
  const [notes, setNotes] = useState([]);
  const [targets, setTargets] = useState({ factions: [], teams: [], groups: [] });
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null); // {id?, targetType, targetKey, content, attendeeIds:Set}
  const [attendees, setAttendees] = useState([]);
  const load = () => getMeetingNotes().then(n => { setNotes(n || []); setLoading(false); });
  useEffect(() => { load(); getNoteTargets().then(setTargets).catch(() => {}); }, []);
  useEffect(() => {
    if (!form?.targetType || !form?.targetKey) { setAttendees([]); return; }
    getAttendeesForTarget(form.targetType, form.targetKey).then(a => setAttendees(a || [])).catch(() => setAttendees([]));
  }, [form?.targetType, form?.targetKey]);
  const save = async () => {
    const r = await saveMeetingNote({ id: form.id, targetType: form.targetType, targetKey: form.targetKey, content: form.content, attendeeIds: [...(form.attendeeIds || [])] });
    if (r.ok) { setForm(null); load(); } else window.alert(r.error || "Failed");
  };
  const targetOptions = () => {
    const o = [];
    (targets.factions || []).forEach(f => o.push({ v: `faction:${f.id}`, l: `Faction · ${f.name}` }));
    (targets.teams || []).forEach(t => o.push({ v: `team:${t.team_id}`, l: `Team · ${t.team_name}` }));
    (targets.groups || []).forEach(g => o.push({ v: `group:${g.key}`, l: `Group · ${g.label}` }));
    return o;
  };
  if (loading) return <div className="empty">Loading…</div>;
  return (
    <>
      <div style={{ marginBottom: 14 }}><button className="btn" onClick={() => setForm({ targetType: "", targetKey: "", content: "", attendeeIds: new Set() })}>+ Meeting note</button></div>
      <div className="card">
        {notes.length === 0 ? <div className="empty">No meeting notes.</div> : notes.map(n => (
          <div className="note" key={n.id}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
              <span className="chip role">{n.display_name}</span>
              <span style={{ fontWeight: 600, color: "var(--ink-0)", fontSize: 12.5 }}>{n.author}</span>
              <span style={{ fontFamily: "var(--v2-mono)", fontSize: 10.5, color: "var(--ink-3)" }}>{n.date}</span>
              <span style={{ flex: 1 }} />
              {(n.author_id === auth.id || auth.level >= 3) && <>
                <button className="act" style={{ padding: "2px 8px" }} onClick={() => setForm({ id: n.id, targetType: n.target_type, targetKey: n.target_type === "faction" ? String(n.faction_id) : n.target_key, content: n.content, attendeeIds: new Set() })}>Edit</button>
                <button className="act" style={{ padding: "2px 8px", color: "var(--rose)" }} onClick={async () => { if (window.confirm("Delete note?")) { await deleteMeetingNote(n.id); load(); } }}>Del</button>
              </>}
            </div>
            <div style={{ whiteSpace: "pre-wrap", color: "var(--ink-1)" }}>{n.content}</div>
          </div>
        ))}
      </div>
      {form && <Modal title={`${form.id ? "Edit" : "New"} meeting note`} onClose={() => setForm(null)} onSave={save} saveDisabled={!form.targetType || !form.content.trim()}>
        <select className="filter-inp" value={form.targetType && form.targetKey ? `${form.targetType}:${form.targetKey}` : ""} onChange={e => { const [tt, ...r] = e.target.value.split(":"); setForm({ ...form, targetType: tt, targetKey: r.join(":") }); }}>
          <option value="">Select target…</option>
          {targetOptions().map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
        <textarea className="filter-inp" rows={6} placeholder="Meeting notes…" value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} />
        {attendees.length > 0 && <>
          <div className="lbl" style={{ fontFamily: "var(--v2-mono)", fontSize: 9, textTransform: "uppercase", color: "var(--ink-3)" }}>Attendees</div>
          <div style={{ maxHeight: 150, overflowY: "auto", display: "flex", flexWrap: "wrap", gap: 5 }}>
            {attendees.map(a => { const on = form.attendeeIds?.has(a.discord_id); return (
              <button key={a.discord_id} className={`pill${on ? " on" : ""}`} onClick={() => { const s = new Set(form.attendeeIds); on ? s.delete(a.discord_id) : s.add(a.discord_id); setForm({ ...form, attendeeIds: s }); }}>{a.display_name}</button>
            ); })}
          </div>
        </>}
      </Modal>}
    </>
  );
}

/* ── Reviews roll-up ── */
function Reviews() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  useEffect(() => { getReviewData().then(r => { setRows(r || []); setLoading(false); }).catch(() => setLoading(false)); }, []);
  if (loading) return <div className="empty">Loading…</div>;
  const shown = rows.filter(f => !q || [f.name, f.teamName, f.leadName].some(x => (x || "").toLowerCase().includes(q.toLowerCase())));
  const reviewed = rows.filter(f => f.currentReview).length;
  const recColor = (r) => r === "Promote" ? "var(--good)" : (r === "Demote" || r === "Remove") ? "var(--rose)" : "var(--amber)";
  return (
    <>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <input className="filter-inp" style={{ maxWidth: 320 }} placeholder="Filter factions…" value={q} onChange={e => setQ(e.target.value)} />
        <span style={{ fontFamily: "var(--v2-mono)", fontSize: 11.5, color: "var(--ink-3)" }}>{reviewed} / {rows.length} reviewed this month</span>
      </div>
      <div className="card"><div style={{ overflowX: "auto" }}>
        <table className="dtable" style={{ minWidth: 680 }}>
          <thead><tr><th>Faction</th><th>Team</th><th>Tier</th><th style={{ textAlign: "right" }}>Scenes 30d</th><th>This month</th><th></th></tr></thead>
          <tbody>
            {shown.map(f => (
              <tr key={f.id}>
                <td><b>{f.name}</b></td>
                <td style={{ color: "var(--ink-2)" }}>{f.teamName || "—"}</td>
                <td><span className={`tier ${f.tier >= 7 ? "hi" : f.tier >= 4 ? "mid" : "lo"}`}>T{f.tier}</span></td>
                <td style={{ textAlign: "right", fontFamily: "var(--v2-mono)" }}>{f.scenes30}</td>
                <td>{f.currentReview
                  ? <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><span className="chip" style={{ background: `color-mix(in srgb, ${recColor(f.currentReview.recommendation)} 15%, transparent)`, color: recColor(f.currentReview.recommendation) }}>{f.currentReview.recommendation || "—"}</span><span style={{ fontSize: 11, color: "var(--ink-3)" }}>{f.currentReview.status}</span></span>
                  : <span style={{ fontSize: 11.5, color: "var(--amber)" }}>Not reviewed</span>}</td>
                <td><Link className="act" href={`/v2/factions/${encodeURIComponent(f.name)}`}>Open →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div></div>
    </>
  );
}
