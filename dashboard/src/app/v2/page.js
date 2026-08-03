"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../lib/useAuth";
import { getMyTasks, getMyCreatedTasks, getMyReminders, getMyTeamFactions, getStaffForCreate, getRoleTargetsForCreate, getQACountsForTasks } from "../fm/dashboard/actions.js";
import { getPendingQueue } from "../fm/leadership/actions.js";
import { createTask, createReminder } from "../fm/teams/actions.js";
import TaskList from "./TaskList.js";
import { targetOptions } from "./TargetPicker.js";
import { useRun } from "./hooks.js";

/* Port of /fm/teams CreateActionForm: task + event/reminder creation with shared target picker */
function CreateAction({ mode, setMode, staffList, roleTargets, onDone, onCancel }) {
  const [desc, setDesc] = useState("");
  const [targetType, setTargetType] = useState("Role");
  const [targetId, setTargetId] = useState("");
  const [enableDM, setEnableDM] = useState(false);
  const [eventType, setEventType] = useState("OOC Meeting");
  const [eventDate, setEventDate] = useState("");
  const [eventNote, setEventNote] = useState("");
  const [enable30m, setEnable30m] = useState(true);
  const { busy, err, setErr, run } = useRun();

  const roleOptions = targetOptions(roleTargets).map(o => ({ label: o.label, value: o.id }));
  const lbl = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--ink-3)", marginBottom: 4 };

  const submit = () => {
    if (!targetId) { setErr("Please select a target."); return; }
    if (mode === "task") {
      if (!desc.trim()) { setErr("Description required."); return; }
      run(() => createTask({ desc, targetId, targetType, enableDM }), () => onDone(mode));
    } else {
      if (!eventDate) { setErr("Date required."); return; }
      const epochMs = new Date(eventDate).getTime();
      if (isNaN(epochMs)) { setErr("Invalid date."); return; }
      run(() => createReminder({ message: `[${eventType}] ${eventNote || ""}`.trim(), epochMs, eventType, note: eventNote, targetType, targetId, enable30m }), () => onDone(mode));
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
              ? staffList.map(s => <option key={s.discord_id} value={s.discord_id}>{s.display_name} ({s.team_name})</option>)
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
        <label style={{ fontSize: 12, color: "var(--ink-1)", display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
          <input type="checkbox" checked={enable30m} onChange={e => setEnable30m(e.target.checked)} /> Send 30-minute warning ping before event
        </label>
      </>}
      {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
        <button className="btn" disabled={busy} onClick={submit}>{busy ? "Saving…" : mode === "task" ? "Create task" : "Schedule event"}</button>
        <button className="act" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

const tierBand = (t) => (t >= 7 ? "hi" : t >= 4 ? "mid" : "lo");
const fmtDay = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase().replace(" ", "\n");

export default function V2Home() {
  const auth = useAuth();
  const [tasks, setTasks] = useState({ assignedToMe: [], forMyTeam: [] });
  const [created, setCreated] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [facs, setFacs] = useState({ teamName: "", factions: [] });
  const [queue, setQueue] = useState({ rpChanges: [], deletions: [], promos: [] });
  const [staffList, setStaffList] = useState([]);
  const [roleTargets, setRoleTargets] = useState({ teams: [] });
  const [qaCounts, setQaCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [createMode, setCreateMode] = useState(null); // null | 'task' | 'event'

  const isLeader = (auth?.level || 0) >= 2 || auth?.isLeadStoryteller;

  const refreshTasks = () => {
    Promise.all([
      getMyTasks().catch(() => ({ assignedToMe: [], forMyTeam: [] })),
      getMyCreatedTasks().catch(() => []),
    ]).then(([t, c]) => {
      setTasks(t); setCreated(c || []);
      const uids = [...(t.assignedToMe || []), ...(t.forMyTeam || []), ...(c || [])].map(x => x.task_uid).filter(Boolean);
      if (uids.length) getQACountsForTasks(uids).then(setQaCounts).catch(() => {});
    });
  };

  useEffect(() => {
    if (auth?.loading || !auth?.id) return;
    Promise.all([
      getMyTasks().catch(() => ({ assignedToMe: [], forMyTeam: [] })),
      getMyCreatedTasks().catch(() => []),
      getMyReminders().catch(() => []),
      getMyTeamFactions().catch(() => ({ teamName: "", factions: [] })),
    ]).then(([t, c, r, f]) => {
      setTasks(t); setCreated(c || []); setReminders(r || []); setFacs(f); setLoading(false);
      const uids = [...(t.assignedToMe || []), ...(t.forMyTeam || []), ...(c || [])].map(x => x.task_uid).filter(Boolean);
      if (uids.length) getQACountsForTasks(uids).then(setQaCounts).catch(() => {});
    });
    getStaffForCreate().then(setStaffList).catch(() => {});
    getRoleTargetsForCreate().then(setRoleTargets).catch(() => {});
    if (isLeader) getPendingQueue().then(setQueue).catch(() => {});
  }, [auth?.id, auth?.loading]);

  if (auth?.loading || loading) return <div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>;
  if (!auth?.ok) return <div className="view" style={{ color: "var(--ink-3)" }}>Not authorized.</div>;

  const now = Date.now();
  const upcoming = [...reminders].filter(r => r.epochMs > now).sort((a, b) => a.epochMs - b.epochMs).slice(0, 4);
  const upcoming7 = reminders.filter(r => r.epochMs > now && r.epochMs - now < 7 * 86400000).length;
  const teamUnclaimed = tasks.forMyTeam.filter(t => !t.claimed_by || t.claimed_by === "None").length;
  const approvals = [
    ...queue.rpChanges.map(x => ({ k: `RP Change · ${x.faction_name}`, t: `${x.execution_type}: ${x.old_value} → ${x.new_value}` })),
    ...queue.promos.map(x => ({ k: `Staged Promo · ${x.faction_name}`, t: `T${x.current_tier} → staged` })),
    ...queue.deletions.map(x => ({ k: `Delete · ${x.content_type}`, t: (x.original_text || "").slice(0, 48) })),
  ].slice(0, 5);

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="view">
      <div className="page-head">
        <div>
          <p className="eyebrow">Faction Management</p>
          <h1>Welcome back, {auth.displayName || auth.name}</h1>
          <div className="sub">{today} · {facs.factions.length} factions in view{teamUnclaimed > 0 ? ` · ${teamUnclaimed} unclaimed on your team` : " · nothing unclaimed"}</div>
        </div>
        <div style={{ display: "flex", gap: 9 }}>
          <button className="btn ghost" onClick={() => setCreateMode(m => m === "event" ? null : "event")}>+ New event</button>
          <button className="btn" onClick={() => setCreateMode(m => m === "task" ? null : "task")}>+ New task</button>
        </div>
      </div>

      {createMode && (
        <CreateAction mode={createMode} setMode={setCreateMode} staffList={staffList} roleTargets={roleTargets}
          onDone={(mode) => {
            setCreateMode(null);
            if (mode === "task") refreshTasks();
            else getMyReminders().then(r => setReminders(r || [])).catch(() => {});
          }}
          onCancel={() => setCreateMode(null)} />
      )}

      <div className="metrics">
        <div className="metric"><div className="l">Assigned to me</div><div className="v">{tasks.assignedToMe.length}</div></div>
        <div className={`metric${teamUnclaimed > 0 ? " attn" : ""}`}><div className="l">Team unclaimed</div><div className="v">{teamUnclaimed}</div></div>
        <div className="metric"><div className="l">Upcoming · 7d</div><div className="v">{upcoming7}</div></div>
        <div className="metric"><div className="l">Factions</div><div className="v">{facs.factions.length}</div></div>
      </div>

      <div className="cols">
        <TaskList auth={auth} assigned={tasks.assignedToMe} created={created} team={tasks.forMyTeam}
          staffList={staffList} roleTargets={roleTargets} qaCounts={qaCounts} onRefresh={refreshTasks}
          viewAllHref="/v2/tasks" />

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <div className="hd"><div className="t">Upcoming</div><div className="meta">Up and Coming</div></div>
            {upcoming.length === 0 ? <div className="empty">No upcoming events.</div> : (
              <div className="mini">
                {upcoming.map(r => (
                  <div className="ev" key={r.uuid}>
                    <div className="when">{fmtDay(new Date(r.epochMs))}</div>
                    <div className="body"><div className="t">{r.message}</div><div className="s">{r.authorName ? `by ${r.authorName}` : ""}</div></div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {isLeader && (
            <div className="card">
              <div className="hd">
                <div className="t">
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="var(--lock)" strokeWidth="1.6"><rect x="3.5" y="7" width="9" height="6" rx="1" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></svg>
                  Approvals
                </div>
                <div className="meta">L2+ only</div>
              </div>
              {approvals.length === 0 ? <div className="empty">Nothing awaiting approval.</div> : (
                <div className="mini">
                  {approvals.map((a, i) => (
                    <div className="approval" key={i}><div style={{ flex: 1 }}><div className="k">{a.k}</div><div className="t">{a.t}</div></div></div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 26 }}>
        <div className="h2" style={{ margin: 0 }}>{facs.teamName || "Factions"}</div>
        <span style={{ fontFamily: "var(--v2-mono)", fontSize: 11, color: "var(--ink-3)" }}>30-day activity</span>
      </div>
      {facs.factions.length === 0 ? <div className="empty">No factions in your scope.</div> : (
        <div className="fac-grid">
          {[...facs.factions].sort((a, b) => (b.tier || 0) - (a.tier || 0)).map(f => (
            <Link className="fac" href={`/v2/factions/${encodeURIComponent(f.name)}`} key={f.id}>
              <div className="top"><div className="nm">{f.name}</div><span className={`tier ${tierBand(f.tier)}`}>T{f.tier}</span></div>
              <div className="mini-stats">
                <div className="ms"><div className="n">{f.scenes30d ?? 0}</div><div className="k">Scenes</div></div>
                <div className="ms"><div className="n">{f.forum_posts_30d ?? 0}</div><div className="k">Forum</div></div>
              </div>
              <div className="lead">↳ {f.leadName}{f.pending_promo ? " · promo staged" : ""}</div>
            </Link>
          ))}
        </div>
      )}

      <div className="disclaimer">Meridian v2 preview · live data · /fm is unchanged</div>
    </div>
  );
}
