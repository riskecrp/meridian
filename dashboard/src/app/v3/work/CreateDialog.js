"use client";
// Task + event/reminder creation (the v2 Home/Teams CreateAction and the
// "+ New" PlusMenu, as one modal and one quick-action row). Both writes go
// through fm/dashboard/actions.js → shared/tasks.js, the path the bot and the
// Discord buttons use.
import { useState } from "react";
import Link from "next/link";
import { Modal, Field, useAction } from "../ui.js";
import { createMyTask, createMyReminder } from "../../fm/dashboard/actions.js";
import { targetOptions } from "../../v2/TargetPicker.js";
import { usePickerData } from "./shared.js";

const EVENT_TYPES = ["OOC Meeting", "RP Op / Scene", "Internal Meeting", "Deadline / Reminder"];

/**
 * mode: 'task' | 'event'. defaultTarget: { targetType, targetId } to preselect
 * (the team board aims at the team). onDone(mode) after a successful create.
 */
export function CreateDialog({ auth, mode: initialMode = "task", defaultTarget, onClose, onDone }) {
  const [mode, setMode] = useState(initialMode);
  const [desc, setDesc] = useState("");
  const [targetType, setTargetType] = useState(defaultTarget?.targetType || "Role");
  const [targetId, setTargetId] = useState(defaultTarget?.targetId || "");
  const [enableDM, setEnableDM] = useState(false);
  const [eventType, setEventType] = useState(EVENT_TYPES[0]);
  const [eventDate, setEventDate] = useState("");
  const [eventNote, setEventNote] = useState("");
  const [err, setErr] = useState("");
  const { run, busy } = useAction();
  const { staffList, roleTargets } = usePickerData(true);
  const roleOptions = targetOptions(roleTargets, { level: auth?.level || 0 });

  const submit = () => {
    setErr("");
    if (!targetId) return setErr("Please select a target.");
    if (mode === "task") {
      if (!desc.trim()) return setErr("Description required.");
      return run(() => createMyTask({ desc: desc.trim(), targetId, targetType, enableDM }), { success: "Task created.", onDone: () => onDone?.("task") });
    }
    if (!eventDate) return setErr("Date required.");
    const epochMs = new Date(eventDate).getTime();
    if (Number.isNaN(epochMs)) return setErr("Invalid date.");
    if (epochMs < Date.now()) return setErr("The event time must be in the future.");
    return run(() => createMyReminder({ message: `[${eventType}] ${eventNote || ""}`.trim(), epochMs, eventType, note: eventNote, targetType, targetId }), { success: "Event scheduled.", onDone: () => onDone?.("event") });
  };

  return (
    <Modal title={mode === "task" ? "New task" : "New event / reminder"} onClose={onClose} onSave={submit} saveLabel={busy ? "Saving…" : mode === "task" ? "Create task" : "Schedule event"} saveDisabled={busy} error={err}>
      <div className="chips">
        <button className={`chip${mode === "task" ? " on" : ""}`} onClick={() => setMode("task")}>Task</button>
        <button className={`chip${mode === "event" ? " on" : ""}`} onClick={() => setMode("event")}>Event / Reminder</button>
      </div>
      <div className="form-grid">
        <Field label="Ping type">
          <select value={targetType} onChange={e => { setTargetType(e.target.value); setTargetId(""); }}>
            <option value="Role">Team / Role</option>
            <option value="User">Individual member</option>
          </select>
        </Field>
        <Field label={targetType === "User" ? "Member" : "Team / role"}>
          <select value={targetId} onChange={e => setTargetId(e.target.value)}>
            <option value="">{targetType === "User" ? "Select staff member…" : "Select team or role…"}</option>
            {targetType === "User"
              ? staffList.map(s => <option key={s.discord_id} value={s.discord_id}>{s.display_name}{s.team_name ? ` (${s.team_name})` : ""}</option>)
              : roleOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </Field>
      </div>
      {mode === "task" ? (
        <>
          <Field label="Task description"><textarea placeholder="Describe the task…" value={desc} onChange={e => setDesc(e.target.value)} autoFocus /></Field>
          <label className="check"><input type="checkbox" checked={enableDM} onChange={e => setEnableDM(e.target.checked)} /> Daily DM reminder to whoever claims it, until it is done</label>
        </>
      ) : (
        <>
          <div className="form-grid">
            <Field label="Event type"><select value={eventType} onChange={e => setEventType(e.target.value)}>{EVENT_TYPES.map(t => <option key={t}>{t}</option>)}</select></Field>
            <Field label="Date & time (local)"><input type="datetime-local" value={eventDate} onChange={e => setEventDate(e.target.value)} /></Field>
          </div>
          <Field label="Details (optional)" help="Announced in the events channel now; the bot posts a 30-minute warning when that route is enabled, and the due ping at the time.">
            <input placeholder="Meeting topic, agenda…" value={eventNote} onChange={e => setEventNote(e.target.value)} />
          </Field>
        </>
      )}
    </Modal>
  );
}

/**
 * The "Create" quick-action row (v2's PlusMenu verbs): Task, Event/Reminder,
 * Scene log, Meeting note. Items a read-only actor cannot submit are not shown.
 */
export function CreateRow({ auth, onCreated, defaultTarget }) {
  const [dialog, setDialog] = useState(null); // 'task' | 'event'
  const level = auth?.level || 0;
  const items = [];
  if (level >= 1) {
    items.push({ key: "task", t: "Task", d: "Assign to a person or team", onClick: () => setDialog("task") });
    items.push({ key: "event", t: "Event / Reminder", d: "Scheduled, announced in Discord", onClick: () => setDialog("event") });
  }
  if (level >= 1 || auth?.isEventTeam) items.push({ key: "scene", t: "Scene log", d: "Record outcome + rewards", href: "/v3/storytelling?tab=scenelogs&new=1" });
  if (level >= 1) items.push({ key: "note", t: "Meeting note", d: "Your factions & team", href: "/v3/reviews?tab=notes" });
  if (!items.length) return null;
  return (
    <>
      <div className="quick" aria-label="Create">
        {items.map(it => it.href
          ? <Link key={it.key} href={it.href}><span className="t">+ {it.t}</span><span className="d">{it.d}</span></Link>
          : <button key={it.key} onClick={it.onClick}><span className="t">+ {it.t}</span><span className="d">{it.d}</span></button>)}
      </div>
      {dialog && <CreateDialog auth={auth} mode={dialog} defaultTarget={defaultTarget} onClose={() => setDialog(null)} onDone={(m) => { setDialog(null); onCreated?.(m); }} />}
    </>
  );
}
