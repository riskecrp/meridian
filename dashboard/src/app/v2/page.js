"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../lib/useAuth";
import {
  getMyTasks, getMyCreatedTasks, getMyReminders, getMyTeamFactions, getStaffForCreate, getRoleTargetsForCreate, getQACountsForTasks,
  createMyTask, createMyReminder, snoozeMyReminder, editMyReminder, deleteMyReminder,
} from "../fm/dashboard/actions.js";
import Modal from "./Modal.js";
import { getMyAttention, completeMyReminderInstance } from "./actions.js";
import TaskList from "./TaskList.js";
import { targetOptions } from "./TargetPicker.js";
import { useRun } from "./hooks.js";

/* Task + event/reminder creation. Both go through the dashboard actions
   (fm/dashboard/actions.js → shared/tasks.js), the same path the legacy
   dashboard, the inbox "+ Task" and the bot use. */
function CreateAction({ auth, mode, setMode, staffList, roleTargets, onDone, onCancel }) {
  const [desc, setDesc] = useState("");
  const [targetType, setTargetType] = useState("Role");
  const [targetId, setTargetId] = useState("");
  const [enableDM, setEnableDM] = useState(false);
  const [eventType, setEventType] = useState("OOC Meeting");
  const [eventDate, setEventDate] = useState("");
  const [eventNote, setEventNote] = useState("");
  const { busy, err, setErr, run } = useRun();

  const roleOptions = targetOptions(roleTargets, { level: auth?.level || 0 }).map(o => ({ label: o.label, value: o.id }));
  const lbl = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--ink-3)", marginBottom: 4 };

  const submit = () => {
    if (!targetId) { setErr("Please select a target."); return; }
    if (mode === "task") {
      if (!desc.trim()) { setErr("Description required."); return; }
      run(() => createMyTask({ desc: desc.trim(), targetId, targetType, enableDM }), () => onDone(mode));
    } else {
      if (!eventDate) { setErr("Date required."); return; }
      const epochMs = new Date(eventDate).getTime();
      if (isNaN(epochMs)) { setErr("Invalid date."); return; }
      if (epochMs < Date.now()) { setErr("The event time must be in the future."); return; }
      run(() => createMyReminder({ message: `[${eventType}] ${eventNote || ""}`.trim(), epochMs, eventType, note: eventNote, targetType, targetId }), () => onDone(mode));
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
          <input type="checkbox" checked={enableDM} onChange={e => setEnableDM(e.target.checked)} /> Daily DM reminder to whoever claims it, until it is done
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
        <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 8 }}>Announced in the events channel now; the bot posts a 30-minute warning when that route is enabled, and the due ping at the time.</div>
      </>}
      {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
        <button className="btn" disabled={busy} onClick={submit}>{busy ? "Saving…" : mode === "task" ? "Create task" : "Schedule event"}</button>
        <button className="act" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

const EVENT_TYPES = ["OOC Meeting", "RP Op / Scene", "Internal Meeting", "Deadline / Reminder"];
// datetime-local wants "YYYY-MM-DDTHH:MM" in the viewer's local time.
const toLocalInput = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

/* Edit an Up-and-Coming event: fix a wrong time, type or details. Author or L2+. */
function EditEvent({ ev, onDone, onClose }) {
  const m = (ev.message || "").match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
  const [eventType, setEventType] = useState(m ? m[1] : "");
  const [note, setNote] = useState(m ? m[2] : ev.message || "");
  const [when, setWhen] = useState(toLocalInput(ev.epochMs));
  const { busy, err, setErr, run } = useRun();
  const lbl = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--ink-3)", marginBottom: 4 };
  const types = eventType && !EVENT_TYPES.includes(eventType) ? [eventType, ...EVENT_TYPES] : EVENT_TYPES;

  const save = () => {
    const epochMs = new Date(when).getTime();
    if (!when || isNaN(epochMs)) { setErr("Invalid date."); return; }
    if (epochMs <= Date.now()) { setErr("That time is in the past."); return; }
    if (!eventType && !note.trim()) { setErr("Details required."); return; }
    run(() => editMyReminder(ev.uuid, { epochMs, eventType, note }), onDone);
  };

  return (
    <Modal title="Edit event" onClose={onClose} onSave={save} saveDisabled={busy} saveLabel={busy ? "Saving…" : "Save"} error={err}>
      <div>
        <div style={lbl}>Event type</div>
        <select className="filter-inp" style={{ width: "100%" }} value={eventType} onChange={e => setEventType(e.target.value)}>
          {!eventType && <option value="">— None —</option>}
          {types.map(t => <option key={t}>{t}</option>)}
        </select>
      </div>
      <div>
        <div style={lbl}>Date & time (local)</div>
        <input type="datetime-local" className="filter-inp" style={{ width: "100%" }} value={when} onChange={e => setWhen(e.target.value)} />
      </div>
      <div>
        <div style={lbl}>Details</div>
        <input className="filter-inp" style={{ width: "100%" }} value={note} onChange={e => setNote(e.target.value)} placeholder="Meeting topic, agenda…" />
      </div>
      <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>Saving posts an “updated” notice where the event was announced, and re-arms the 30-minute warning.</div>
    </Modal>
  );
}

const tierBand = (t) => (t >= 7 ? "hi" : t >= 4 ? "mid" : "lo");
const fmtDay = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase().replace(" ", "\n");
const ord = (n) => (n >= 11 && n <= 13) ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function V2HomePage() {
  return <Suspense fallback={<div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>}><V2Home /></Suspense>;
}

function V2Home() {
  const auth = useAuth();
  const router = useRouter();
  const sp = useSearchParams();
  const [tasks, setTasks] = useState({ assignedToMe: [], forMyTeam: [] });
  const [created, setCreated] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [facs, setFacs] = useState({ teamName: "", factions: [] });
  const [att, setAtt] = useState(null);
  const [staffList, setStaffList] = useState([]);
  const [roleTargets, setRoleTargets] = useState({ teams: [] });
  const [qaCounts, setQaCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [createMode, setCreateMode] = useState(null); // null | 'task' | 'event'
  const [workTab, setWorkTab] = useState("assigned");
  const [notice, setNotice] = useState("");           // errors from queue / reminder actions
  const [openRem, setOpenRem] = useState(null);
  const [editingEvent, setEditingEvent] = useState(null);

  const level = auth?.level || 0;
  const isL3 = level >= 3;
  const canWrite = level >= 1;

  // The global "+ New" menu lands here with ?create=task|event.
  useEffect(() => {
    const c = sp.get("create");
    if (c === "task" || c === "event") {
      setCreateMode(c);
      const rest = new URLSearchParams(sp.toString()); rest.delete("create");
      router.replace(rest.toString() ? `/v2?${rest}` : "/v2", { scroll: false });
    }
  }, [sp]);

  const refreshAttention = () => getMyAttention().then(setAtt).catch(() => {});
  const refreshReminders = () => getMyReminders().then(r => setReminders(r || [])).catch(() => {});

  const refreshTasks = () => {
    Promise.all([
      getMyTasks().catch(() => ({ assignedToMe: [], forMyTeam: [] })),
      getMyCreatedTasks().catch(() => []),
    ]).then(([t, c]) => {
      setTasks(t); setCreated(c || []);
      const uids = [...(t.assignedToMe || []), ...(t.forMyTeam || []), ...(c || [])].map(x => x.task_uid).filter(Boolean);
      if (uids.length) getQACountsForTasks(uids).then(setQaCounts).catch(() => {});
    });
    refreshAttention();
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
    if (auth.level >= 1) {
      getStaffForCreate().then(setStaffList).catch(() => {});
      getRoleTargetsForCreate().then(setRoleTargets).catch(() => {});
    }
    refreshAttention();
  }, [auth?.id, auth?.loading]);

  if (auth?.loading || loading) return <div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>;
  if (!auth?.ok) return <div className="view" style={{ color: "var(--ink-3)" }}>Not authorized.</div>;

  const now = Date.now();
  const upcoming = [...reminders].filter(r => r.epochMs > now).sort((a, b) => a.epochMs - b.epochMs).slice(0, 4);
  const upcoming7 = reminders.filter(r => r.epochMs > now && r.epochMs - now < 7 * 86400000).length;
  const teamUnclaimed = tasks.forMyTeam.filter(t => !t.claimed_by || t.claimed_by === "None").length;
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const thisMonth = new Date();

  // Every mutation on this page reports its outcome: a refusal is shown, never swallowed.
  const act = async (fn, after) => {
    setNotice("");
    let r;
    try { r = await fn(); } catch (e) { setNotice(e?.message || "Action failed."); return; }
    if (r && r.ok === false) { setNotice(r.error || "Action failed."); return; }
    after?.();
  };
  const doneInstance = (id) => act(() => completeMyReminderInstance(id), refreshAttention);
  const snooze = (uuid) => act(() => snoozeMyReminder(uuid), refreshReminders);
  const remove = (uuid) => { if (window.confirm("Delete this reminder?")) act(() => deleteMyReminder(uuid), refreshReminders); };

  const items = [];
  if (att) {
    const c = att.counts;
    if (c.inboxUnread > 0) items.push({ chip: "INBOX", color: "var(--accent)", text: `${c.inboxUnread} unread ping${c.inboxUnread !== 1 ? "s" : ""}`, href: "/v2/inbox" });
    if (c.teamUnclaimed > 0) items.push({ chip: "TASKS", color: "var(--amber)", text: `${c.teamUnclaimed} unclaimed task${c.teamUnclaimed !== 1 ? "s" : ""} on your team`, onClick: () => setWorkTab("team") });
    if (c.approvals > 0) items.push({ chip: "APPROVALS", color: "var(--lock)", text: `${c.approvals} item${c.approvals !== 1 ? "s" : ""} awaiting approval`, href: "/v2/leadership?tab=approvals" });
    (att.reminderInstances || []).forEach(ri => {
      const current = ri.year === thisMonth.getUTCFullYear() && ri.month === thisMonth.getUTCMonth() + 1;
      const when = current ? `due by the ${ri.due_day}${ord(ri.due_day)}` : `${MONTHS[(ri.month || 1) - 1]} ${ri.year} · still open`;
      items.push({
        chip: current ? "DUE" : "OVERDUE", color: "var(--rose)", text: `${ri.title} — ${when}`,
        action: canWrite ? { label: "Done ✓", fn: () => doneInstance(ri.id) } : null,
      });
    });
    if (c.reviewsDue > 0) items.push({
      chip: "REVIEWS", color: "var(--amber)", text: `${c.reviewsDue} faction${c.reviewsDue !== 1 ? "s" : ""} not reviewed this month`,
      href: "/v2/leadership?tab=reviews",
      subLinks: (att.reviewsDue || []).map(f => ({ label: f.name, href: `/v2/factions/${encodeURIComponent(f.name)}?tab=review` })),
      moreCount: Math.max(0, c.reviewsDue - (att.reviewsDue || []).length),
    });
    if (c.icActive > 0) items.push({ chip: "IC", color: "var(--sky)", text: `${c.icActive} active IC contact${c.icActive !== 1 ? "s" : ""}`, href: isL3 ? "/v2/leadership?tab=contacts" : "/v2/factions" });
  }

  return (
    <div className="view">
      <div className="page-head">
        <div>
          <p className="eyebrow">Faction Management</p>
          <h1>Welcome back, {auth.displayName || auth.name}</h1>
          <div className="sub">{today} · {facs.factions.length} factions in view{teamUnclaimed > 0 ? ` · ${teamUnclaimed} unclaimed on your team` : " · nothing unclaimed"}</div>
        </div>
        {canWrite && !createMode && (
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn ghost" onClick={() => setCreateMode("task")}>+ Task</button>
            <button className="btn ghost" onClick={() => setCreateMode("event")}>+ Event</button>
          </div>
        )}
      </div>

      {createMode && canWrite && (
        <CreateAction auth={auth} mode={createMode} setMode={setCreateMode} staffList={staffList} roleTargets={roleTargets}
          onDone={(mode) => {
            setCreateMode(null);
            if (mode === "task") refreshTasks();
            else refreshReminders();
          }}
          onCancel={() => setCreateMode(null)} />
      )}
      {createMode && !canWrite && <div className="restricted">Your access here is read-only; tasks and events are created by FM staff.</div>}

      {notice && <div className="err" style={{ marginBottom: 12 }} role="alert">{notice}</div>}

      {att && items.length > 0 && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="hd"><div className="t">Needs attention</div><div className="meta">{items.length}</div></div>
          {items.map((it, i) => {
            const inner = (
              <>
                <span className="chip" style={{ background: `color-mix(in srgb, ${it.color} 14%, transparent)`, color: it.color, flexShrink: 0 }}>{it.chip}</span>
                <span style={{ fontSize: 13, color: "var(--ink-0)", fontWeight: 500 }}>{it.text}</span>
                <span style={{ flex: 1 }} />
                {it.action && <button className="act good" style={{ flexShrink: 0 }} onClick={e => { e.preventDefault(); it.action.fn(); }}>{it.action.label}</button>}
                {(it.href || it.onClick) && !it.action && <span style={{ color: "var(--ink-3)", fontSize: 12, flexShrink: 0 }}>→</span>}
              </>
            );
            const rowStyle = { display: "flex", alignItems: "center", gap: 10, padding: "9px 2px", borderBottom: "1px solid var(--line)", textDecoration: "none", cursor: (it.href || it.onClick) ? "pointer" : "default", flexWrap: "wrap" };
            return (
              <div key={i}>
                {it.href
                  ? <Link href={it.href} style={rowStyle}>{inner}</Link>
                  : <div style={rowStyle} onClick={it.onClick}>{inner}</div>}
                {it.subLinks?.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5, padding: "6px 2px 9px 6px", borderBottom: "1px solid var(--line)" }}>
                    <span style={{ fontFamily: "var(--v2-mono)", fontSize: 9.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--ink-3)", marginRight: 3 }}>Jump to a review:</span>
                    {it.subLinks.map(s => <Link key={s.label} href={s.href} className="chip role" style={{ textDecoration: "none" }} title={`Open ${s.label}'s Review tab`}>{s.label} →</Link>)}
                    {it.moreCount > 0 && <Link href={it.href} style={{ fontSize: 11, color: "var(--accent)" }}>+{it.moreCount} more →</Link>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {att && items.length === 0 && (
        <div style={{ fontSize: 12.5, color: "var(--good)", marginBottom: 18 }}>✓ All clear — nothing needs you right now.</div>
      )}

      <div className="metrics">
        <div className="metric" onClick={() => setWorkTab("assigned")} style={{ cursor: "pointer" }} title="Show assigned tasks"><div className="l">Assigned to me</div><div className="v">{tasks.assignedToMe.length}</div></div>
        <div className={`metric${teamUnclaimed > 0 ? " attn" : ""}`} onClick={() => setWorkTab("team")} style={{ cursor: "pointer" }} title="Show team tasks"><div className="l">Team unclaimed</div><div className="v">{teamUnclaimed}</div></div>
        <div className="metric"><div className="l">Upcoming · 7d</div><div className="v">{upcoming7}</div></div>
        <Link className="metric" href="/v2/factions" style={{ textDecoration: "none" }}><div className="l">Factions</div><div className="v">{facs.factions.length}</div></Link>
      </div>

      <div className="cols">
        <TaskList key={workTab} initialTab={workTab} auth={auth} assigned={tasks.assignedToMe} created={created} team={tasks.forMyTeam}
          staffList={staffList} roleTargets={roleTargets} qaCounts={qaCounts} onRefresh={refreshTasks}
          viewAllHref="/v2/tasks" />

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <div className="hd"><div className="t">Upcoming</div><div className="meta">Up and Coming</div></div>
            {upcoming.length === 0 ? <div className="empty">No upcoming events.</div> : (
              <div className="mini">
                {upcoming.map(r => {
                  const mine = r.author_id === auth.id;
                  const canManage = canWrite && (mine || level >= 2);
                  const isOpen = openRem === r.uuid;
                  return (
                    <div className="ev" key={r.uuid} style={{ cursor: canManage ? "pointer" : "default" }} onClick={() => canManage && setOpenRem(isOpen ? null : r.uuid)}>
                      <div className="when">{fmtDay(new Date(r.epochMs))}</div>
                      <div className="body" style={{ flex: 1 }}>
                        <div className="t">{r.message}</div>
                        <div className="s">{new Date(r.epochMs).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}{r.authorName ? ` · by ${r.authorName}` : ""}</div>
                        {isOpen && canManage && (
                          <div style={{ display: "flex", gap: 5, marginTop: 6 }} onClick={e => e.stopPropagation()}>
                            <button className="act" onClick={() => setEditingEvent(r)}>Edit</button>
                            <button className="act" onClick={() => snooze(r.uuid)}>Snooze 1h</button>
                            <button className="act" style={{ color: "var(--rose)" }} onClick={() => remove(r.uuid)}>Delete</button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
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

      {editingEvent && (
        <EditEvent ev={editingEvent} onClose={() => setEditingEvent(null)}
          onDone={() => { setEditingEvent(null); setOpenRem(null); refreshReminders(); }} />
      )}

      <div className="disclaimer">Meridian v2 · live data</div>
    </div>
  );
}
