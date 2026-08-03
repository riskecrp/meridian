"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../../lib/useAuth";
import QuillEditor from "../../../lib/QuillEditor";
import { getTeamPerformance, getGuideActivity, getMeetingNotes, saveMeetingNote, deleteMeetingNote, getNoteTargets, getAttendeesForTarget, getReviewData, getPendingQueue } from "../../fm/leadership/actions.js";
import { approveRPChange, denyRPChange, markRPDone, executeRPChange, deleteRPChange, resolveDeletion } from "../../fm/operations/actions.js";
import { completePromotion, cancelPromotion } from "../../fm/factions/actions.js";
import { getAllIcContacts, getThreadMessages, assignIcContact, setIcContactStatus, stageRoleplay, completeIcContact, getStaffList } from "../../fm/teams/actions.js";
import RpChangeForm from "../../fm/teams/RpChangeForm";
import Modal from "../Modal.js";
import { FM_GUILD_ID } from "../../../lib/constants";
import { getReviewCycleMap } from "../actions.js";

export default function V2LeadershipPage() {
  return <Suspense fallback={<div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>}><V2Leadership /></Suspense>;
}

function V2Leadership() {
  const auth = useAuth();
  // Section comes from the Leadership nav dropdown via ?tab= (no in-page tab row).
  const sp = useSearchParams();
  const router = useRouter();
  const openNew = sp.get("new") === "1";
  useEffect(() => { if (openNew) router.replace(`/v2/leadership?tab=${sp.get("tab") || "notes"}`, { scroll: false }); }, [openNew]);
  const can = (auth?.level || 0) >= 2 || auth?.isLeadStoryteller;
  if (auth?.loading) return <div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>;
  if (!auth?.ok || !can) return <div className="view" style={{ color: "var(--ink-3)" }}>Team Lead or Leadership access required.</div>;
  const TABS = [["approvals", "Approvals"], ["performance", "Performance"], ["notes", "Meeting Notes"], ["reviews", "Reviews"], ...((auth?.level || 0) >= 3 ? [["contacts", "IC Contacts"]] : [])];
  const tabParam = sp.get("tab");
  const tab = TABS.some(([v]) => v === tabParam) ? tabParam : "approvals";
  const sectionLabel = TABS.find(([v]) => v === tab)?.[1] || "";
  return (
    <div className="view">
      <div className="page-head"><div><p className="eyebrow">Leadership</p><h1>{sectionLabel}</h1><div className="sub">Switch sections from the Leadership menu in the top bar.</div></div></div>
      {tab === "approvals" && <Approvals auth={auth} />}
      {tab === "performance" && <Performance />}
      {tab === "notes" && <MeetingNotes auth={auth} openNew={openNew} />}
      {tab === "reviews" && <Reviews />}
      {tab === "contacts" && <IcContacts />}
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
const stripHtml = (h) => (h || "").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ");

function MeetingNotes({ auth, openNew = false }) {
  const [notes, setNotes] = useState([]);
  const [targets, setTargets] = useState({ factions: [], teams: [], groups: [] });
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null); // {id?, targetType, targetKey, content, attendeeIds:Set}
  const [attendees, setAttendees] = useState([]);
  const load = () => getMeetingNotes().then(n => { setNotes(n || []); setLoading(false); });
  useEffect(() => { load(); getNoteTargets().then(setTargets).catch(() => {}); }, []);
  // "+ New → Meeting note" lands here with ?new=1 and the form already open.
  useEffect(() => { if (openNew) setForm({ targetType: "", targetKey: "", content: "", attendeeIds: new Set() }); }, [openNew]);
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
                <button className="act" style={{ padding: "2px 8px" }} onClick={() => setForm({ id: n.id, targetType: n.target_type, targetKey: n.target_type === "faction" ? String(n.faction_id) : n.target_key, content: n.content, attendeeIds: new Set(n.attendeeIds || []) })}>Edit</button>
                <button className="act" style={{ padding: "2px 8px", color: "var(--rose)" }} onClick={async () => { if (window.confirm("Delete note?")) { await deleteMeetingNote(n.id); load(); } }}>Del</button>
              </>}
            </div>
            {/* Old notes are plain text; anything written with Quill is HTML — render each accordingly. */}
            {/<[a-z][^>]*>/i.test(n.content || "")
              ? <div className="quill-content" style={{ color: "var(--ink-1)", overflowWrap: "anywhere", lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: n.content }} />
              : <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "var(--ink-1)" }}>{n.content}</div>}
          </div>
        ))}
      </div>
      {form && <Modal maxWidth={720} title={`${form.id ? "Edit" : "New"} meeting note`} onClose={() => setForm(null)} onSave={save} saveDisabled={!form.targetType || !stripHtml(form.content).trim()}>
        <select className="filter-inp" value={form.targetType && form.targetKey ? `${form.targetType}:${form.targetKey}` : ""} onChange={e => { const [tt, ...r] = e.target.value.split(":"); setForm({ ...form, targetType: tt, targetKey: r.join(":") }); }}>
          <option value="">Select target…</option>
          {targetOptions().map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
        <QuillEditor value={form.content} onChange={v => setForm({ ...form, content: v })} placeholder="Meeting notes…" />
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

/* ── Reviews: the monthly cycle board. One row per faction, one dot per step
      (Reviewed → Confirmed → Feedback sent → Staged), one click to the exact
      step in that faction's hub. ── */
function CycleDot({ on, label, hint }) {
  return <span title={`${label}${hint ? ` — ${hint}` : ""}`} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
    <span style={{ width: 8, height: 8, borderRadius: "50%", background: on ? "var(--good)" : "var(--panel-2)", border: `1px solid ${on ? "var(--good)" : "var(--line-2)"}`, display: "inline-block" }} />
    <span style={{ fontSize: 9, fontFamily: "var(--v2-mono)", color: on ? "var(--good)" : "var(--ink-3)" }}>{label}</span>
  </span>;
}

function Reviews() {
  const [rows, setRows] = useState([]);
  const [cycle, setCycle] = useState({ feedback: {}, staged: [] });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [flt, setFlt] = useState("all"); // all | todo | confirm | feedback
  useEffect(() => {
    Promise.all([getReviewData().catch(() => []), getReviewCycleMap().catch(() => ({ feedback: {}, staged: [] }))])
      .then(([r, c]) => { setRows(r || []); setCycle(c || { feedback: {}, staged: [] }); setLoading(false); });
  }, []);
  if (loading) return <div className="empty">Loading…</div>;

  const state = (f) => ({
    reviewed: !!f.currentReview,
    confirmed: !!f.currentReview?.status?.startsWith("Confirmed"),
    feedback: !!cycle.feedback[f.name],
    staged: cycle.staged.includes(f.name),
  });
  const shown = rows
    .filter(f => !q || [f.name, f.teamName, f.leadName].some(x => (x || "").toLowerCase().includes(q.toLowerCase())))
    .filter(f => {
      const s = state(f);
      if (flt === "todo") return !s.reviewed;
      if (flt === "confirm") return s.reviewed && !s.confirmed;
      if (flt === "feedback") return !s.feedback;
      return true;
    });
  const reviewed = rows.filter(f => f.currentReview).length;
  const fbSent = rows.filter(f => cycle.feedback[f.name]).length;
  const recColor = (r) => r === "Promote" ? "var(--good)" : (r === "Demote" || r === "Remove") ? "var(--rose)" : "var(--amber)";
  return (
    <>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <input className="filter-inp" style={{ maxWidth: 280 }} placeholder="Filter factions…" value={q} onChange={e => setQ(e.target.value)} />
        <div style={{ display: "flex", gap: 5 }}>
          {[["all", "All"], ["todo", "Needs review"], ["confirm", "Needs confirm"], ["feedback", "Needs feedback"]].map(([v, l]) => (
            <button key={v} className={`pill${flt === v ? " on" : ""}`} onClick={() => setFlt(v)}>{l}</button>
          ))}
        </div>
        <span style={{ marginLeft: "auto", fontFamily: "var(--v2-mono)", fontSize: 11.5, color: "var(--ink-3)" }}>{reviewed}/{rows.length} reviewed · {fbSent}/{rows.length} feedback sent · due the 15th</span>
      </div>
      <div className="card"><div style={{ overflowX: "auto" }}>
        <table className="dtable" style={{ minWidth: 760 }}>
          <thead><tr><th>Faction</th><th>Team</th><th>Tier</th><th style={{ textAlign: "right" }}>Scenes 30d</th><th>Recommendation</th><th>Cycle</th><th></th></tr></thead>
          <tbody>
            {shown.map(f => {
              const s = state(f);
              return (
                <tr key={f.id}>
                  <td><b>{f.name}</b></td>
                  <td style={{ color: "var(--ink-2)" }}>{f.teamName || "—"}</td>
                  <td><span className={`tier ${f.tier >= 7 ? "hi" : f.tier >= 4 ? "mid" : "lo"}`}>T{f.tier}</span></td>
                  <td style={{ textAlign: "right", fontFamily: "var(--v2-mono)" }}>{f.scenes30}</td>
                  <td>{f.currentReview
                    ? <span className="chip" style={{ background: `color-mix(in srgb, ${recColor(f.currentReview.recommendation)} 15%, transparent)`, color: recColor(f.currentReview.recommendation) }}>{f.currentReview.recommendation || "—"}</span>
                    : <span style={{ fontSize: 11.5, color: "var(--amber)" }}>Not reviewed</span>}</td>
                  <td>
                    <span style={{ display: "inline-flex", gap: 9, alignItems: "center" }}>
                      <CycleDot on={s.reviewed} label="REC" hint={f.currentReview ? "review submitted" : "no review yet"} />
                      <CycleDot on={s.confirmed} label="CONF" hint={f.currentReview?.status || ""} />
                      <CycleDot on={s.feedback} label="SENT" hint={cycle.feedback[f.name] ? `by ${cycle.feedback[f.name].by}` : "feedback not delivered"} />
                      {s.staged && <span className="chip lock" style={{ fontSize: 9 }}>STAGED</span>}
                    </span>
                  </td>
                  <td><Link className="act" href={`/v2/factions/${encodeURIComponent(f.name)}?tab=review`}>Open →</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>{shown.length === 0 && <div className="empty">Nothing matches this filter.</div>}</div>
    </>
  );
}

/* ── IC Contacts triage (L3): cross-faction roll-up of incoming IC contacts ── */
const IC_STATUS = {
  pending_discussion: { label: "Pending Discussion", color: "var(--amber)", bg: "var(--amber-bg)" },
  pending_roleplay: { label: "Pending Roleplay", color: "var(--sky)", bg: "var(--sky-bg)" },
  completed: { label: "Completed", color: "var(--good)", bg: "var(--good-bg)" },
};

function IcThread({ threadId }) {
  const [msgs, setMsgs] = useState(null);
  const [open, setOpen] = useState(false);
  const toggle = () => {
    if (!open && msgs === null) getThreadMessages(threadId).then(setMsgs);
    setOpen(o => !o);
  };
  return (
    <div style={{ marginTop: 10 }}>
      <button className="act" style={{ color: "var(--sky)" }} onClick={toggle}>{open ? "Hide thread" : "View thread messages"}</button>
      {open && (
        <div style={{ marginTop: 8, borderRadius: 8, border: "1px solid var(--line)", overflow: "hidden" }}>
          {msgs === null ? <div style={{ padding: "10px 12px", fontSize: 12, fontStyle: "italic", color: "var(--ink-3)" }}>Loading…</div>
            : msgs.length === 0 ? <div style={{ padding: "10px 12px", fontSize: 12, fontStyle: "italic", color: "var(--ink-3)" }}>No messages in thread.</div>
              : msgs.map((m, i) => (
                <div key={m.id} style={{ padding: "8px 12px", borderBottom: i < msgs.length - 1 ? "1px solid var(--line)" : "none", background: m.authorBot ? "var(--accent-bg)" : "transparent" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: m.authorBot ? "var(--accent)" : "var(--ink-0)" }}>{m.author}</span>
                    <span style={{ fontSize: 10, fontFamily: "var(--v2-mono)", color: "var(--ink-3)" }}>{new Date(m.timestamp).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</span>
                  </div>
                  <p style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", margin: 0, color: "var(--ink-1)" }}>{m.content}</p>
                </div>
              ))}
        </div>
      )}
    </div>
  );
}

function IcContactCard({ contact, staffList, onRefresh }) {
  const [assigning, setAssigning] = useState(false);
  const [assignId, setAssignId] = useState("");
  const [stagingRP, setStagingRP] = useState(false);
  const [busy, setBusy] = useState(false);
  const meta = IC_STATUS[contact.status] || IC_STATUS.pending_discussion;
  const doAssign = async () => {
    if (!assignId) return;
    setBusy(true);
    const member = staffList.find(s => s.discord_id === assignId);
    await assignIcContact(contact.id, assignId, member?.display_name || assignId);
    setAssigning(false); setAssignId(""); setBusy(false); onRefresh();
  };
  const doStatusChange = async (newStatus) => {
    setBusy(true);
    if (newStatus === "completed") await completeIcContact(contact.id);
    else await setIcContactStatus(contact.id, newStatus);
    setBusy(false); onRefresh();
  };
  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", paddingBottom: 8, borderBottom: "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700 }}>{contact.faction_name}</span>
          <span style={{ color: "var(--ink-3)" }}>·</span>
          <span style={{ fontSize: 12.5, color: "var(--ink-1)" }}>{contact.sender_name}</span>
          {contact.team_name && <span className="chip" style={{ background: "var(--accent-bg)", color: "var(--accent)" }}>{contact.team_name}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 10, fontFamily: "var(--v2-mono)", color: "var(--ink-3)" }}>{new Date(contact.submitted_at).toLocaleDateString()}</span>
          {contact.thread_id && <a href={`https://discord.com/channels/${FM_GUILD_ID}/${contact.thread_id}`} target="_blank" rel="noreferrer" style={{ fontSize: 10, fontWeight: 700, color: "var(--accent)" }}>Thread ↗</a>}
          <select disabled={busy} value={contact.status} onChange={e => doStatusChange(e.target.value)}
            style={{ fontSize: 9.5, fontWeight: 700, padding: "3px 6px", borderRadius: 6, background: meta.bg, color: meta.color, border: "1px solid var(--line)", cursor: "pointer", outline: "none", fontFamily: "var(--v2-mono)", textTransform: "uppercase" }}>
            <option value="pending_discussion">Pending Discussion</option>
            <option value="pending_roleplay">Pending Roleplay</option>
            <option value="completed">Completed</option>
          </select>
        </div>
      </div>
      <div style={{ paddingTop: 10 }}>
        <p style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap", margin: "0 0 10px", color: "var(--ink-1)" }}>{contact.message}</p>
        <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginBottom: 10 }}>
          {contact.assigned_name ? <><span style={{ color: "var(--accent)" }}>{contact.assigned_name}</span> assigned</> : "Unassigned"}
        </div>
        {assigning && (
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
            <select className="filter-inp" style={{ flex: 1, minWidth: 220 }} value={assignId} onChange={e => setAssignId(e.target.value)}>
              <option value="">Select member…</option>
              {staffList.map(s => <option key={s.discord_id} value={s.discord_id}>{s.display_name} {s.team_name ? `(${s.team_name})` : ""}</option>)}
            </select>
            <button className="act primary" disabled={!assignId || busy} onClick={doAssign}>Confirm</button>
            <button className="act" onClick={() => setAssigning(false)}>Cancel</button>
          </div>
        )}
        {stagingRP && (
          <div style={{ marginBottom: 10 }}>
            <RpChangeForm contact={contact} busy={busy} onSubmit={async (rpData) => { setBusy(true); await stageRoleplay(contact.id, rpData); setStagingRP(false); setBusy(false); onRefresh(); }} onCancel={() => setStagingRP(false)} />
          </div>
        )}
        {!assigning && !stagingRP && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <button className="act" onClick={() => setAssigning(true)}>Assign</button>
            <button className="act" style={{ color: "var(--sky)" }} onClick={() => setStagingRP(true)}>Request RP change</button>
          </div>
        )}
        {contact.thread_id && <IcThread threadId={contact.thread_id} />}
      </div>
    </div>
  );
}

function IcContacts() {
  const [contacts, setContacts] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("active");
  const load = async () => {
    const [c, s] = await Promise.all([getAllIcContacts(), getStaffList()]);
    setContacts(c || []); setStaffList(s || []); setLoading(false);
  };
  useEffect(() => { load(); }, []);
  if (loading) return <div className="empty">Loading…</div>;
  const filtered = contacts.filter(c => filter === "all" ? true : c.status !== "completed");
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {["active", "all"].map(f => <button key={f} className={`pill${filter === f ? " on" : ""}`} onClick={() => setFilter(f)}>{f === "active" ? "Active" : "All"}</button>)}
        </div>
        <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{filtered.length} contact{filtered.length !== 1 ? "s" : ""}</span>
      </div>
      {filtered.length === 0 ? <div className="empty">No IC contacts.</div> : filtered.map(c => <IcContactCard key={c.id} contact={c} staffList={staffList} onRefresh={load} />)}
    </>
  );
}
