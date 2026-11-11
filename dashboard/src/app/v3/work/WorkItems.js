"use client";
// The non-task work rows: scheduled events (reminders table), recurring
// reminder instances, RP-change requests, IC contacts (with the RP request
// form and thread view) and the team summary card from v2/teams.
import { useState } from "react";
import Link from "next/link";
import { Card, Button, Badge, Age, Empty, useAction, fmtDateTime } from "../ui.js";
import { snoozeMyReminder, deleteMyReminder } from "../../fm/dashboard/actions.js";
import { completeMyReminderInstance } from "../../v2/actions.js";
import { markRPDone, resubmitRPChange } from "../../fm/operations/actions.js";
import { assignIcContact, setIcContactStatus, stageRoleplay, completeIcContact, getThreadMessages } from "../../fm/teams/actions.js";
import RpChangeForm from "../../fm/teams/RpChangeForm.js";
import { FM_GUILD_ID } from "../../../lib/constants.js";
import { InlineForm, rpStatusMeta, factionHref, dayStamp, timeOnly, tierTone } from "./shared.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ord = (n) => (n >= 11 && n <= 13) ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";

/** A scheduled event (one-off reminder). Author or L2+ may snooze/delete. */
export function EventRow({ auth, r, onChanged }) {
  const { run, busy } = useAction();
  const canManage = (auth?.level || 0) >= 1 && (r.author_id === auth?.id || (auth?.level || 0) >= 2);
  const when = dayStamp(r.epochMs);
  const past = r.epochMs < Date.now();
  return (
    <div className="li">
      <div className="ev-when"><span>{when.m}</span><b>{when.d}</b></div>
      <div className="body">
        <div className="t">{r.message}</div>
        <div className="d">{timeOnly(r.epochMs)}{r.authorName ? ` · by ${r.authorName}` : ""}{r.status === "WARNED" ? " · warned" : ""}{past ? " · due" : ""}</div>
      </div>
      {canManage && (
        <div className="side">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => snoozeMyReminder(r.uuid), { success: "Snoozed one hour.", onDone: onChanged })}>Snooze 1h</Button>
          <Button size="sm" variant="danger ghost" disabled={busy} onClick={() => { if (window.confirm("Delete this event?")) run(() => deleteMyReminder(r.uuid), { success: "Event deleted.", onDone: onChanged }); }}>Delete</Button>
        </div>
      )}
    </div>
  );
}

/** An open recurring-reminder instance (monthly due item). */
export function ReminderInstanceRow({ auth, ri, onChanged }) {
  const { run, busy } = useAction();
  const now = new Date();
  const current = ri.year === now.getUTCFullYear() && ri.month === now.getUTCMonth() + 1;
  const when = current ? `due by the ${ri.due_day}${ord(ri.due_day)}` : `${MONTHS[(ri.month || 1) - 1]} ${ri.year} · still open`;
  return (
    <div className={`li${current ? "" : " hot"}`}>
      <div className="body">
        <div className="t">{ri.title}</div>
        <div className="d">{when}{ri.body ? ` — ${ri.body}` : ""}</div>
      </div>
      <div className="side">
        <Badge tone={current ? "warn" : "bad"}>{current ? "DUE" : "OVERDUE"}</Badge>
        {(auth?.level || 0) >= 1 && <Button size="sm" variant="good" disabled={busy} onClick={() => run(() => completeMyReminderInstance(ri.id), { success: "Marked done.", onDone: onChanged })}>Done ✓</Button>}
      </div>
    </div>
  );
}

/** An RP-change request (pending_executions row). The requester closes the loop; denied requests can be resubmitted. */
export function RpRequestRow({ auth, r, onChanged }) {
  const { run, busy } = useAction();
  const [form, setForm] = useState(null); // 'done' | 'resubmit'
  const [note, setNote] = useState("");
  const meta = rpStatusMeta(r.status);
  const mine = r.requester_id === auth?.id;
  const isL3 = (auth?.level || 0) >= 3;
  const close = () => { setForm(null); setNote(""); };
  return (
    <div className="lirow">
      <div className="li">
        <div className="body">
          <div className="row small"><Badge tone={meta.tone}>RP · {meta.label}</Badge><Age since={r.created_at} warnDays={3} staleDays={7} /></div>
          <div className="t">{r.execution_type}: {r.old_value} → {r.new_value}</div>
          <div className="d"><Link href={factionHref(r.faction_name)}>{r.faction_name}</Link>{r.turf && r.turf !== "N/A" ? ` · ${r.turf}` : ""} · requested by {r.requested_by}{r.date ? ` · ${String(r.date).slice(0, 10)}` : ""}{r.rp_note ? ` · note: ${r.rp_note}` : ""}{r.deny_reason ? ` · denied: ${r.deny_reason}` : ""}</div>
        </div>
        <div className="side">
          {r.status === "APPROVED" && (mine || isL3) && <Button size="sm" variant="good" disabled={busy} onClick={() => setForm(form === "done" ? null : "done")}>Confirm RP done</Button>}
          {r.status === "DENIED" && (mine || isL3) && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setForm(form === "resubmit" ? null : "resubmit")}>Resubmit</Button>}
          {isL3 && (r.status === "PENDING" || r.status === "RP_DONE") && <Link className="btn ghost sm" href="/v3?panel=queue">Queue →</Link>}
        </div>
      </div>
      {form === "done" && (
        <InlineForm label="Confirmation note (optional) — how the scene went" busy={busy} confirmLabel="Confirm RP done" onCancel={close}
          onConfirm={() => run(() => markRPDone(r.id, note.trim()), { success: "RP marked done — leadership can execute it.", onDone: () => { close(); onChanged?.(); } })}>
          <textarea rows={2} autoFocus value={note} onChange={e => setNote(e.target.value)} />
        </InlineForm>
      )}
      {form === "resubmit" && (
        <InlineForm label="What changed since the denial (optional)" busy={busy} confirmLabel="Resubmit for approval" onCancel={close}
          onConfirm={() => run(() => resubmitRPChange(r.id, note.trim()), { success: "Resubmitted for approval.", onDone: () => { close(); onChanged?.(); } })}>
          <textarea rows={2} autoFocus value={note} onChange={e => setNote(e.target.value)} />
        </InlineForm>
      )}
    </div>
  );
}

// ── IC contacts (team-scoped writes; the server refuses outside your team) ──
const IC_STATUS = {
  pending_discussion: { label: "Pending Discussion", tone: "warn" },
  pending_roleplay: { label: "Pending Roleplay", tone: "info" },
  completed: { label: "Completed", tone: "good" },
};

function IcThread({ threadId }) {
  const [msgs, setMsgs] = useState(null);
  const [open, setOpen] = useState(false);
  const toggle = () => { if (!open && msgs === null) getThreadMessages(threadId).then(m => setMsgs(m || [])).catch(() => setMsgs([])); setOpen(o => !o); };
  return (
    <div className="mt8">
      <Button size="sm" variant="quiet" onClick={toggle}>{open ? "Hide thread" : "View thread messages"}</Button>
      {open && (
        <div className="thread">
          {msgs === null ? <div className="skeleton" />
            : msgs.length === 0 ? <div className="faint small">No messages in thread.</div>
              : msgs.map(m => (
                <div key={m.id} className={`tmsg${m.authorBot ? " bot" : ""}`}>
                  <div className="row small"><b>{m.author}</b><span className="mono tiny faint">{fmtDateTime(m.timestamp)}</span></div>
                  <p>{m.content}</p>
                </div>
              ))}
        </div>
      )}
    </div>
  );
}

export function IcContactCard({ auth, contact, staffList, onChanged }) {
  const [assigning, setAssigning] = useState(false);
  const [assignId, setAssignId] = useState("");
  const [staging, setStaging] = useState(false);
  const { run, busy } = useAction();
  const meta = IC_STATUS[contact.status] || IC_STATUS.pending_discussion;
  const done = contact.status === "completed";
  const level = auth?.level || 0;
  const canWrite = level >= 1;
  const canStage = level >= 2 && !done;
  const setStatus = (v) => {
    if (v === contact.status) return;
    if (v === "completed" && !window.confirm("Complete and archive this contact?")) return;
    run(() => (v === "completed" ? completeIcContact(contact.id) : setIcContactStatus(contact.id, v)), { success: "Contact updated.", onDone: onChanged });
  };
  return (
    <Card className="ic">
      <div className="row spread">
        <div className="row">
          <Badge tone="info">IC</Badge>
          <Link href={factionHref(contact.faction_name)}><b>{contact.faction_name}</b></Link>
          <span className="muted">· {contact.sender_name}</span>
          {contact.rp_change_id && <Badge tone="accent">RP request #{contact.rp_change_id}</Badge>}
        </div>
        <div className="row">
          <span className="mono tiny faint">{String(contact.submitted_at || "").slice(0, 10)}</span>
          {contact.thread_id && <a className="btn quiet sm" href={`https://discord.com/channels/${FM_GUILD_ID}/${contact.thread_id}`} target="_blank" rel="noreferrer">Thread ↗</a>}
          {canWrite
            ? <select className="inp sel-sm" disabled={busy} value={contact.status} onChange={e => setStatus(e.target.value)} aria-label="Contact status">
                {Object.entries(IC_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            : <Badge tone={meta.tone}>{meta.label}</Badge>}
        </div>
      </div>
      <p className="msg mt8">{contact.message}</p>
      <div className="tiny faint">{contact.assigned_name ? <><span className="tx-accent">{contact.assigned_name}</span> assigned</> : "Unassigned"}</div>
      {assigning && (
        <InlineForm label="Assign to" busy={busy} confirmDisabled={!assignId} onCancel={() => { setAssigning(false); setAssignId(""); }}
          onConfirm={() => run(() => assignIcContact(contact.id, assignId), { success: "Assigned.", onDone: () => { setAssigning(false); setAssignId(""); onChanged?.(); } })}>
          <select value={assignId} onChange={e => setAssignId(e.target.value)}>
            <option value="">Select member…</option>
            {(staffList || []).map(s => <option key={s.discord_id} value={s.discord_id}>{s.display_name}{s.team_name ? ` (${s.team_name})` : ""}</option>)}
          </select>
        </InlineForm>
      )}
      {staging && (
        <div className="fm-vars mt8">
          <RpChangeForm contact={contact} busy={busy}
            onSubmit={(rpData) => run(() => stageRoleplay(contact.id, rpData), { success: "RP change requested — pending leadership approval.", onDone: () => { setStaging(false); onChanged?.(); } })}
            onCancel={() => setStaging(false)} />
        </div>
      )}
      {!assigning && !staging && !done && canWrite && (
        <div className="actions-inline mt8">
          <Button size="sm" variant="ghost" onClick={() => setAssigning(true)}>Assign</Button>
          {canStage && <Button size="sm" variant="ghost" onClick={() => setStaging(true)}>Request RP change</Button>}
        </div>
      )}
      {contact.thread_id && <IcThread threadId={contact.thread_id} />}
    </Card>
  );
}

/** One team's roster + factions (v2 Teams card). */
export function TeamSummary({ team, selected, onOpen }) {
  return (
    <Card title={team.name} right={<span className="row"><Badge tone="good">{team.total30d} scenes · 30d</Badge><Badge>{team.totalAll} all time</Badge>{onOpen && <Button size="sm" variant={selected ? "" : "ghost"} onClick={() => onOpen(team.id)}>{selected ? "Open" : "Open board"}</Button>}</span>}>
      <div className="small"><span className="tx-accent"><b>{team.leads.map(l => l.name).join(", ") || "No lead"}</b></span>{team.guides.length > 0 && <span className="muted"> · {team.guides.map(g => g.name).join(", ")}</span>}</div>
      {team.factions.length === 0 ? <div className="faint small mt8">No factions assigned</div> : (
        <div className="tblwrap mt8">
          <table className="tbl">
            <thead><tr><th>Faction</th><th>Tier</th><th className="num">30d</th><th className="num hide-sm">Total</th></tr></thead>
            <tbody>
              {team.factions.map(f => (
                <tr key={f.id}>
                  <td><Link href={factionHref(f.name)}><b>{f.name}</b></Link></td>
                  <td><Badge tone={tierTone(f.tier)}>T{f.tier}</Badge></td>
                  <td className="num">{f.scenes30d}</td>
                  <td className="num hide-sm muted">{f.allTime}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export { Empty };
