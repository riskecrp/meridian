"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../../lib/useAuth";
import {
  getTeams, getTeamTasks, getTeamReminders, getTeamIcContactsAll, getStaffList, getRoleTargets,
  createTask, createReminder, claimTask, completeTask, unclaimTask, editTask, reassignTask, requestTaskInfo,
  snoozeReminder, deleteReminder, assignIcContact, setIcContactStatus, stageRoleplay, completeIcContact, getThreadMessages,
} from "../../fm/teams/actions.js";
import RpChangeForm from "../../fm/teams/RpChangeForm";
import { FM_GUILD_ID } from "../../../lib/constants";
import { targetOptions } from "../TargetPicker.js";
import { useRun } from "../hooks.js";

/* /v2/teams — the Teams workspace: every team's roster and factions, and for
   one team at a time its task board, scheduled events, IC contacts and the
   RP-change request form. Built on fm/teams/actions.js (shared task lifecycle,
   scoped IC-contact writes); the server decides what each click may do and
   every failure is shown. */

const tierBand = (t) => (t >= 7 ? "hi" : t >= 4 ? "mid" : "lo");
const lbl = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--ink-3)", marginBottom: 4 };
const fmtWhen = (v) => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? d.toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : (v || ""); };

/* ── Create task / event (same form as Home, aimed at the team by default) ── */
function CreateAction({ team, staffList, roleTargets, onDone, onCancel }) {
  const [mode, setMode] = useState("task");
  const [desc, setDesc] = useState("");
  const [targetType, setTargetType] = useState("Role");
  const [targetId, setTargetId] = useState(team?.id || "");
  const [enableDM, setEnableDM] = useState(false);
  const [eventType, setEventType] = useState("OOC Meeting");
  const [eventDate, setEventDate] = useState("");
  const [eventNote, setEventNote] = useState("");
  const { busy, err, setErr, run } = useRun();
  const roleOptions = targetOptions(roleTargets).map(o => ({ label: o.label, value: o.id }));

  const submit = () => {
    if (!targetId) { setErr("Please select a target."); return; }
    if (mode === "task") {
      if (!desc.trim()) { setErr("Description required."); return; }
      run(() => createTask({ desc, targetId, targetType, enableDM }), () => onDone(mode));
    } else {
      if (!eventDate) { setErr("Date required."); return; }
      const epochMs = new Date(eventDate).getTime();
      if (isNaN(epochMs)) { setErr("Invalid date."); return; }
      run(() => createReminder({ message: `[${eventType}] ${eventNote || ""}`.trim(), epochMs, eventType, note: eventNote, targetType, targetId }), () => onDone(mode));
    }
  };

  return (
    <div className="card" style={{ border: "1px solid var(--accent)", borderRadius: 10, padding: 14, marginBottom: 18 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <button className={`pill${mode === "task" ? " on" : ""}`} onClick={() => setMode("task")}>Task</button>
        <button className={`pill${mode === "event" ? " on" : ""}`} onClick={() => setMode("event")}>Event / Reminder</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10, marginBottom: 10 }}>
        <div>
          <div style={lbl}>Ping type</div>
          <select className="filter-inp" style={{ width: "100%" }} value={targetType} onChange={e => { setTargetType(e.target.value); setTargetId(""); }}>
            <option value="Role">Team / Role</option>
            <option value="User">Individual Member</option>
          </select>
        </div>
        <div>
          <div style={lbl}>{targetType === "User" ? "Select member" : "Select team / role"}</div>
          <select className="filter-inp" style={{ width: "100%" }} value={targetId} onChange={e => setTargetId(e.target.value)}>
            <option value="">{targetType === "User" ? "Select staff member…" : "Select team or role…"}</option>
            {targetType === "User"
              ? staffList.map(s => <option key={s.discord_id} value={s.discord_id}>{s.display_name}{s.team_name ? ` (${s.team_name})` : ""}</option>)
              : roleOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>
      {mode === "task" ? <>
        <div style={lbl}>Task description</div>
        <textarea className="filter-inp" style={{ width: "100%", minHeight: 76 }} placeholder="Describe the task…" value={desc} onChange={e => setDesc(e.target.value)} />
        <label style={{ fontSize: 12, color: "var(--ink-1)", display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
          <input type="checkbox" checked={enableDM} onChange={e => setEnableDM(e.target.checked)} /> Enable daily DM reminders for assigned member
        </label>
      </> : <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10, marginBottom: 10 }}>
          <div>
            <div style={lbl}>Event type</div>
            <select className="filter-inp" style={{ width: "100%" }} value={eventType} onChange={e => setEventType(e.target.value)}>
              <option>OOC Meeting</option>
              <option>RP Op / Scene</option>
              <option>Internal Meeting</option>
              <option>Deadline / Reminder</option>
            </select>
          </div>
          <div>
            <div style={lbl}>Date & time (local)</div>
            <input type="datetime-local" className="filter-inp" style={{ width: "100%" }} value={eventDate} onChange={e => setEventDate(e.target.value)} />
          </div>
        </div>
        <div style={lbl}>Details (optional)</div>
        <input className="filter-inp" style={{ width: "100%" }} placeholder="Meeting topic, agenda…" value={eventNote} onChange={e => setEventNote(e.target.value)} />
        <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 6 }}>The 30-minute warning ping is a global switch (Admin › Pings › reminder.warning).</div>
      </>}
      {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
        <button className="btn" disabled={busy} onClick={submit}>{busy ? "Saving…" : mode === "task" ? "Create task" : "Schedule event"}</button>
        <button className="act" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/* ── Team task board ── */
function TaskBoard({ auth, tasks, staffList, roleTargets, onRefresh }) {
  const [openUid, setOpenUid] = useState(null);
  const [form, setForm] = useState(null); // { uid, kind, text, target, dm }
  const { busy, err, setErr, run: runAction } = useRun();
  const reset = () => { setForm(null); setErr(""); };
  const openForm = (uid, kind, seed = "") => { setForm({ uid, kind, text: seed, target: "", dm: false }); setErr(""); };
  const run = (fn) => runAction(fn, () => { reset(); onRefresh(); });
  const isL2 = auth.level < 3;
  const staffForReassign = isL2 ? staffList.filter(s => Number(s.clearance || 0) < 3) : staffList;
  const roleOpts = targetOptions(roleTargets, { level: auth.level, gateLeadership: true });

  const submit = () => {
    const { uid, kind, text, target, dm } = form;
    if (kind === "claim") return run(() => claimTask(uid, { enableDM: dm }));
    if (kind === "complete") return run(() => completeTask(uid, text.trim() || undefined));
    if (kind === "unclaim") return run(() => unclaimTask(uid, text.trim() || undefined));
    if (kind === "info") { if (!text.trim()) { setErr("Question is required."); return; } return run(() => requestTaskInfo(uid, text.trim())); }
    if (kind === "edit") { if (!text.trim()) { setErr("Description is required."); return; } return run(() => editTask(uid, text.trim())); }
    if (kind === "reassign") {
      if (!target) { setErr("Pick a target."); return; }
      const [targetType, ...rest] = target.split(":");
      return run(() => reassignTask(uid, rest.join(":"), targetType, text.trim() || undefined));
    }
  };

  if (!tasks.length) return <div className="empty">No open tasks for this team.</div>;
  return (
    <div>
      {tasks.map(t => {
        const claimed = t.claimed_by && t.claimed_by !== "None";
        const claimedByMe = t.claimed_by === auth.id;
        const leadershipScoped = t.targetLabel === "FM Leadership" || t.targetLabel === "Game Affairs";
        const canEdit = t.created_by_id === auth.id || auth.level >= 2;
        const canReqInfo = t.created_by_id && t.created_by_id !== auth.id;
        const canUnclaim = claimed && (claimedByMe || auth.level >= 3);
        const isOpen = openUid === t.task_uid;
        return (
          <div key={t.task_uid}>
            <div className={`row${isOpen ? " exp" : ""}`} onClick={() => { setOpenUid(isOpen ? null : t.task_uid); reset(); }}>
              <span className={`stat-dot ${claimed ? "claimed" : "open"}`} />
              <span className="desc">{t.description}</span>
              {leadershipScoped ? <span className="chip lock">🔒 {t.targetLabel}</span> : <span className="chip role">{t.targetLabel || "—"}</span>}
              <span className="chip due">{claimed ? t.claimerName : "unclaimed"}</span>
              <span className="caret">▼</span>
            </div>
            {isOpen && (
              <div className="task-detail">
                <p className="full">{t.description}</p>
                <div className="facts">
                  <span>By <b>{t.created_by_name || "System"}</b></span>
                  <span>For <b>{t.targetLabel || "—"}</b></span>
                  <span>Created <b>{fmtWhen(t.created_at)}</b></span>
                  <span><b style={{ color: claimed ? "var(--emerald)" : "var(--amber)" }}>{claimed ? `Claimed · ${t.claimerName}` : "Unclaimed"}</b></span>
                  {t.next_reminder && <span><b>🔔 daily DM</b></span>}
                </div>
                {!form && (
                  <div className="actbar">
                    {!claimed && <button className="act primary" disabled={busy} onClick={() => openForm(t.task_uid, "claim")}>Claim</button>}
                    {canEdit && <button className="act" onClick={() => openForm(t.task_uid, "edit", t.description)}>Edit</button>}
                    {auth.level >= 2 && <button className="act warn" onClick={() => openForm(t.task_uid, "reassign")}>Reassign</button>}
                    {canReqInfo && <button className="act" onClick={() => openForm(t.task_uid, "info")}>Request info</button>}
                    {canUnclaim && <button className="act" onClick={() => openForm(t.task_uid, "unclaim")}>Unclaim</button>}
                    <button className="act good" onClick={() => openForm(t.task_uid, "complete")}>Complete</button>
                  </div>
                )}
                {form?.uid === t.task_uid && (
                  <div className="inline-form" onClick={e => e.stopPropagation()}>
                    <div className="lbl">
                      {form.kind === "claim" ? `Claim this task as ${auth.displayName || auth.name}`
                        : form.kind === "complete" ? "Completion note (optional)"
                        : form.kind === "unclaim" ? "Reason (optional)"
                        : form.kind === "info" ? "Your question"
                        : form.kind === "edit" ? "Edit description"
                        : "Reassign to"}
                    </div>
                    {form.kind === "claim" && (
                      <label style={{ fontSize: 12, color: "var(--ink-1)", display: "flex", gap: 8, alignItems: "center" }}>
                        <input type="checkbox" checked={form.dm} onChange={e => setForm({ ...form, dm: e.target.checked })} /> Remind me by DM every 24h until it is done
                      </label>
                    )}
                    {form.kind === "reassign" && (
                      <select className="filter-inp" value={form.target} onChange={e => setForm({ ...form, target: e.target.value })}>
                        <option value="">Select target…</option>
                        <optgroup label="Roles & Teams">{roleOpts.map(o => <option key={`${o.type}:${o.id}`} value={`${o.type}:${o.id}`}>{o.label}</option>)}</optgroup>
                        <optgroup label="Staff">{staffForReassign.map(s => <option key={s.discord_id} value={`User:${s.discord_id}`}>{s.display_name}{s.team_name ? ` (${s.team_name})` : ""}</option>)}</optgroup>
                      </select>
                    )}
                    {form.kind !== "claim" && (
                      <textarea rows={form.kind === "reassign" ? 2 : 3} value={form.text}
                        placeholder={form.kind === "info" ? "What do you need to know?" : form.kind === "reassign" ? "Note for the new assignee (optional)" : ""}
                        onChange={e => setForm({ ...form, text: e.target.value })} />
                    )}
                    {err && <div className="err">{err}</div>}
                    <div className="row-btns">
                      <button className="act primary" disabled={busy} onClick={submit}>{busy ? "Working…" : "Confirm"}</button>
                      <button className="act" disabled={busy} onClick={reset}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Scheduled events ── */
function EventList({ auth, reminders, onRefresh }) {
  const { busy, err, run } = useRun();
  if (!reminders.length) return <div className="empty">No scheduled events for this team.</div>;
  return (
    <div>
      {err && <div className="err" style={{ marginBottom: 8 }}>{err}</div>}
      {reminders.map(r => {
        const mine = r.author_id === auth.id || auth.level >= 2;
        return (
          <div key={r.uuid} className="row" style={{ cursor: "default" }}>
            <span className="stat-dot open" />
            <span className="desc">{r.message}</span>
            <span className="chip role">{r.authorName}</span>
            <span className="chip due">{new Date(r.epochMs).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</span>
            {mine && <button className="act" disabled={busy} onClick={() => run(() => snoozeReminder(r.uuid), onRefresh)}>Snooze +1h</button>}
            {mine && <button className="act warn" disabled={busy} onClick={() => { if (window.confirm("Delete this event?")) run(() => deleteReminder(r.uuid), onRefresh); }}>Delete</button>}
          </div>
        );
      })}
    </div>
  );
}

/* ── IC contacts (team-scoped; the server refuses writes outside your team) ── */
const IC_STATUS = {
  pending_discussion: { label: "Pending Discussion", color: "var(--amber)", bg: "var(--amber-bg)" },
  pending_roleplay: { label: "Pending Roleplay", color: "var(--sky)", bg: "var(--sky-bg)" },
  completed: { label: "Completed", color: "var(--good)", bg: "var(--good-bg)" },
};

function IcThread({ threadId }) {
  const [msgs, setMsgs] = useState(null);
  const [open, setOpen] = useState(false);
  const toggle = () => { if (!open && msgs === null) getThreadMessages(threadId).then(setMsgs).catch(() => setMsgs([])); setOpen(o => !o); };
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
                    <span style={{ fontSize: 10, fontFamily: "var(--v2-mono)", color: "var(--ink-3)" }}>{fmtWhen(m.timestamp)}</span>
                  </div>
                  <p style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", margin: 0, color: "var(--ink-1)" }}>{m.content}</p>
                </div>
              ))}
        </div>
      )}
    </div>
  );
}

function IcContactCard({ auth, contact, staffList, onRefresh }) {
  const [assigning, setAssigning] = useState(false);
  const [assignId, setAssignId] = useState("");
  const [stagingRP, setStagingRP] = useState(false);
  const { busy, err, setErr, run } = useRun();
  const meta = IC_STATUS[contact.status] || IC_STATUS.pending_discussion;
  const done = contact.status === "completed";
  const canStage = auth.level >= 2 && !done;
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", paddingBottom: 8, borderBottom: "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700 }}>{contact.faction_name}</span>
          <span style={{ color: "var(--ink-3)" }}>·</span>
          <span style={{ fontSize: 12.5, color: "var(--ink-1)" }}>{contact.sender_name}</span>
          {contact.rp_change_id && <span className="chip role">RP request #{contact.rp_change_id}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 10, fontFamily: "var(--v2-mono)", color: "var(--ink-3)" }}>{new Date(contact.submitted_at).toLocaleDateString()}</span>
          {contact.thread_id && <a href={`https://discord.com/channels/${FM_GUILD_ID}/${contact.thread_id}`} target="_blank" rel="noreferrer" style={{ fontSize: 10, fontWeight: 700, color: "var(--accent)" }}>Thread ↗</a>}
          <select disabled={busy} value={contact.status}
            onChange={e => { const v = e.target.value; if (v === "completed" && !window.confirm("Complete and archive this contact?")) return; run(() => (v === "completed" ? completeIcContact(contact.id) : setIcContactStatus(contact.id, v)), onRefresh); }}
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
        {err && <div className="err" style={{ marginBottom: 8 }}>{err}</div>}
        {assigning && (
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
            <select className="filter-inp" style={{ flex: 1, minWidth: 220 }} value={assignId} onChange={e => setAssignId(e.target.value)}>
              <option value="">Select member…</option>
              {staffList.map(s => <option key={s.discord_id} value={s.discord_id}>{s.display_name}{s.team_name ? ` (${s.team_name})` : ""}</option>)}
            </select>
            <button className="act primary" disabled={!assignId || busy} onClick={() => run(() => assignIcContact(contact.id, assignId), () => { setAssigning(false); setAssignId(""); onRefresh(); })}>Confirm</button>
            <button className="act" onClick={() => { setAssigning(false); setErr(""); }}>Cancel</button>
          </div>
        )}
        {stagingRP && (
          <div style={{ marginBottom: 10 }}>
            <RpChangeForm contact={contact} busy={busy} onSubmit={(rpData) => run(() => stageRoleplay(contact.id, rpData), () => { setStagingRP(false); onRefresh(); })} onCancel={() => { setStagingRP(false); setErr(""); }} />
          </div>
        )}
        {!assigning && !stagingRP && !done && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <button className="act" onClick={() => setAssigning(true)}>Assign</button>
            {canStage && <button className="act" style={{ color: "var(--sky)" }} onClick={() => setStagingRP(true)}>Request RP change</button>}
          </div>
        )}
        {contact.thread_id && <IcThread threadId={contact.thread_id} />}
      </div>
    </div>
  );
}

/* ── Workspace for one team ── */
function Workspace({ auth, team, staffList, roleTargets }) {
  const [tab, setTab] = useState("tasks");
  const [tasks, setTasks] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [showAll, setShowAll] = useState(false);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = () => {
    setErr("");
    Promise.all([getTeamTasks(team.id), getTeamReminders(team.id), getTeamIcContactsAll(team.id)])
      .then(([t, r, c]) => { setTasks(t || []); setReminders(r || []); setContacts(c || []); setLoading(false); })
      .catch(e => { setErr(e?.message || "Could not load the workspace."); setLoading(false); });
  };
  useEffect(() => { setLoading(true); setCreating(false); load(); }, [team.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeContacts = contacts.filter(c => c.status !== "completed");
  const shownContacts = showAll ? contacts : activeContacts;
  const TABS = [
    { id: "tasks", label: `Tasks (${tasks.length})` },
    { id: "events", label: `Events (${reminders.length})` },
    { id: "contacts", label: `IC contacts (${activeContacts.length})` },
  ];

  return (
    <div className="card">
      <div className="hd">
        <div className="t">{team.name} · workspace</div>
        <div className="tabs">
          {TABS.map(t => <button key={t.id} className={`tab${tab === t.id ? " on" : ""}`} onClick={() => setTab(t.id)}>{t.label}</button>)}
          <button className="tab" style={{ color: "var(--iris)" }} onClick={() => setCreating(c => !c)}>{creating ? "Hide form" : "+ Create"}</button>
        </div>
      </div>
      {creating && <CreateAction team={team} staffList={staffList} roleTargets={roleTargets} onDone={() => { setCreating(false); load(); }} onCancel={() => setCreating(false)} />}
      {err && <div className="err" style={{ marginBottom: 8 }}>{err}</div>}
      {loading ? <div className="empty">Loading…</div> : <>
        {tab === "tasks" && <TaskBoard auth={auth} tasks={tasks} staffList={staffList} roleTargets={roleTargets} onRefresh={load} />}
        {tab === "events" && <EventList auth={auth} reminders={reminders} onRefresh={load} />}
        {tab === "contacts" && <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, margin: "10px 0 14px" }}>
            <div style={{ display: "flex", gap: 6 }}>
              <button className={`pill${!showAll ? " on" : ""}`} onClick={() => setShowAll(false)}>Active</button>
              <button className={`pill${showAll ? " on" : ""}`} onClick={() => setShowAll(true)}>All</button>
            </div>
            <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{shownContacts.length} contact{shownContacts.length !== 1 ? "s" : ""} · factions led by this team</span>
          </div>
          {shownContacts.length === 0 ? <div className="empty">{showAll ? "No IC contacts." : "No active IC contacts."}</div>
            : shownContacts.map(c => <IcContactCard key={c.id} auth={auth} contact={c} staffList={staffList} onRefresh={load} />)}
        </>}
      </>}
    </div>
  );
}

export default function V2TeamsPage() {
  return <Suspense fallback={<div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>}><V2Teams /></Suspense>;
}

function V2Teams() {
  const auth = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [teams, setTeams] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [roleTargets, setRoleTargets] = useState({ teams: [] });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const wanted = params.get("team");

  useEffect(() => {
    if (auth?.loading || !auth?.id) return;
    if ((auth.level || 0) < 1) { setLoading(false); return; }
    Promise.all([getTeams(), getStaffList(), getRoleTargets()])
      .then(([t, s, r]) => { setTeams(t || []); setStaffList(s || []); setRoleTargets(r || { teams: [] }); setLoading(false); })
      .catch(e => { setErr(e?.message || "Could not load teams."); setLoading(false); });
  }, [auth?.id, auth?.loading, auth?.level]);

  if (auth?.loading || loading) return <div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>;
  if (!auth?.ok) return <div className="view" style={{ color: "var(--ink-3)" }}>Not authorized.</div>;
  if ((auth.level || 0) < 1) return <div className="view"><div className="page-head"><div><p className="eyebrow">Faction Management</p><h1>Teams</h1></div></div><div className="empty">The Teams workspace is for FM staff (L1+).</div></div>;

  const selected = teams.find(t => t.id === wanted) || teams.find(t => t.id === auth.teamId) || null;
  const select = (id) => router.replace(`/v2/teams${id ? `?team=${encodeURIComponent(id)}` : ""}`);

  return (
    <div className="view">
      <div className="page-head">
        <div>
          <p className="eyebrow">Faction Management</p>
          <h1>Teams</h1>
          <div className="sub">{teams.length} team{teams.length !== 1 ? "s" : ""} · rosters, factions, and each team's task board, events and IC contacts</div>
        </div>
      </div>
      {err && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}

      {teams.length === 0 ? <div className="empty">No teams yet — staff are assigned to teams on Admin › Staff &amp; Teams.</div> : (
        <div className="cols" style={{ marginBottom: 8 }}>
          {teams.map(team => {
            const on = selected?.id === team.id;
            return (
              <div key={team.id} className="card" style={{ border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`, borderRadius: 10, padding: 14, marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 15, color: "var(--ink-0)" }}>{team.name}</div>
                    <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 2 }}>
                      <span style={{ color: "var(--accent)", fontWeight: 600 }}>{team.leads.map(l => l.name).join(", ") || "No lead"}</span>
                      {team.guides.length > 0 && <> · {team.guides.map(g => g.name).join(", ")}</>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                    <div className="metric"><div className="v">{team.total30d}</div><div className="l">scenes 30d</div></div>
                    <div className="metric"><div className="v" style={{ color: "var(--ink-3)" }}>{team.totalAll}</div><div className="l">all time</div></div>
                    <button className={`act${on ? " primary" : ""}`} onClick={() => select(team.id)}>{on ? "Open" : "Open workspace"}</button>
                  </div>
                </div>
                <table className="dtable" style={{ marginTop: 10 }}>
                  <thead><tr><th>Faction</th><th>Tier</th><th style={{ textAlign: "right" }}>30d</th><th style={{ textAlign: "right" }}>Total</th></tr></thead>
                  <tbody>
                    {team.factions.map(f => (
                      <tr key={f.id} style={{ cursor: "pointer" }} onClick={() => router.push(`/v2/factions/${encodeURIComponent(f.name)}`)}>
                        <td><b>{f.name}</b></td>
                        <td><span className={`tier ${tierBand(f.tier)}`}>T{f.tier}</span></td>
                        <td style={{ textAlign: "right", fontFamily: "var(--v2-mono)" }}>{f.scenes30d}</td>
                        <td style={{ textAlign: "right", fontFamily: "var(--v2-mono)", color: "var(--ink-3)" }}>{f.allTime}</td>
                      </tr>
                    ))}
                    {team.factions.length === 0 && <tr><td colSpan={4} style={{ color: "var(--ink-3)", fontStyle: "italic" }}>No factions assigned</td></tr>}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}

      {selected
        ? <Workspace key={selected.id} auth={auth} team={selected} staffList={staffList} roleTargets={roleTargets} />
        : teams.length > 0 && <div className="disclaimer">Open a team's workspace to see its tasks, events and IC contacts.</div>}
    </div>
  );
}
