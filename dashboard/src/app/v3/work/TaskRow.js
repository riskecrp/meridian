"use client";
// One task as a list row (Home, Work) with the full action set, and the
// action bar/forms the task page reuses. Buttons mirror the gates in
// shared/tasks.js; the server stays the authority and every refusal is a toast.
import { useState } from "react";
import Link from "next/link";
import { Button, useAction, fmtDateTime } from "../ui.js";
import {
  completeMyTask, unclaimMyTask, reassignMyTask, requestTaskInfo, editMyTask,
} from "../../fm/dashboard/actions.js";
import { claimTask } from "../../fm/teams/actions.js";
import { InlineForm, TargetPicker, parseTarget, TaskStatusBadge, TargetBadge, isClaimed, taskHref } from "./shared.js";

/** What this viewer may do, mirroring getTaskDetail's `can` for list rows (the server re-checks). */
export function canFor(auth, t) {
  const level = auth?.level || 0, writes = level >= 1;
  const open = (t.status || "open") === "open", claimed = isClaimed(t);
  const isCreator = !!t.created_by_id && t.created_by_id === auth?.id;
  return {
    claim: writes && open && !claimed,
    unclaim: writes && open && claimed && (t.claimed_by === auth?.id || level >= 3),
    complete: writes && open,
    edit: writes && open && (isCreator || level >= 2),
    reassign: writes && open && level >= 2,
    ask: writes && !!t.created_by_id && !isCreator,
  };
}

const FORM_LABEL = {
  claim: "Claim this task",
  complete: "Completion note (optional)",
  unclaim: "Reason (optional)",
  ask: "Your question for the creator",
  edit: "Edit description",
  reassign: "Reassign to",
};

/**
 * Buttons + inline form for one task. `can` from the server (task page) or
 * canFor() (lists). onDone runs after a successful write.
 */
export function TaskActions({ auth, task, can, staffList, roleTargets, onDone }) {
  const [form, setForm] = useState(null); // { kind, text, target, dm }
  const [err, setErr] = useState("");
  const { run, busy } = useAction();
  const uid = task.task_uid;
  const open = (task.status || "open") === "open";
  const done = () => { setForm(null); setErr(""); onDone?.(); };
  const go = (fn, success) => run(fn, { success, onDone: done });
  const openForm = (kind, seed = "") => { setForm({ kind, text: seed, target: "", dm: false }); setErr(""); };

  const submit = () => {
    const { kind, text, target, dm } = form;
    const note = text.trim() || undefined;
    if (kind === "claim") return go(() => claimTask(uid, { enableDM: dm }), "Task claimed.");
    if (kind === "complete") return go(() => completeMyTask(uid, note), "Task completed.");
    if (kind === "unclaim") return go(() => unclaimMyTask(uid, note), "Task unclaimed.");
    if (kind === "ask") { if (!text.trim()) return setErr("Question is required."); return go(() => requestTaskInfo(uid, text.trim()), "Question sent to the creator."); }
    if (kind === "edit") { if (!text.trim()) return setErr("Description is required."); return go(() => editMyTask(uid, text.trim()), "Task updated."); }
    if (kind === "reassign") {
      if (!target) return setErr("Pick a target.");
      const { targetType, targetId } = parseTarget(target);
      return go(() => reassignMyTask(uid, targetId, targetType, note), "Task reassigned.");
    }
  };

  const any = Object.values(can || {}).some(Boolean);
  return (
    <div onClick={e => e.stopPropagation()}>
      {!form && (
        <div className="actions-inline">
          {can.claim && <Button size="sm" disabled={busy} onClick={() => openForm("claim")}>Claim</Button>}
          {can.edit && <Button size="sm" variant="ghost" onClick={() => openForm("edit", task.description)}>Edit</Button>}
          {can.reassign && <Button size="sm" variant="ghost" onClick={() => openForm("reassign")}>Reassign</Button>}
          {can.ask && <Button size="sm" variant="ghost" onClick={() => openForm("ask")}>Ask the creator</Button>}
          {can.unclaim && <Button size="sm" variant="ghost" onClick={() => openForm("unclaim")}>Unclaim</Button>}
          {can.complete && <Button size="sm" variant="good" onClick={() => openForm("complete")}>Complete</Button>}
          {!any && <span className="faint tiny">{open ? "Read-only for your access level." : "This task is closed."}</span>}
        </div>
      )}
      {form && (
        <InlineForm label={FORM_LABEL[form.kind]} error={err} busy={busy} onConfirm={submit} onCancel={() => { setForm(null); setErr(""); }}
          confirmLabel={form.kind === "claim" ? `Claim as ${auth?.displayName || auth?.name}` : "Confirm"}>
          {form.kind === "claim" && (
            <label className="check"><input type="checkbox" checked={form.dm} onChange={e => setForm({ ...form, dm: e.target.checked })} /> Remind me by DM every 24h until it is done</label>
          )}
          {form.kind === "reassign" && (
            <TargetPicker value={form.target} onChange={v => setForm({ ...form, target: v })} roleTargets={roleTargets} staffList={staffList}
              level={auth?.level || 0} gateLeadership includeGameAffairs />
          )}
          {form.kind !== "claim" && (
            <textarea rows={form.kind === "reassign" ? 2 : 3} value={form.text} autoFocus
              placeholder={form.kind === "ask" ? "What do you need to know?" : form.kind === "reassign" ? "Note for the new assignee (optional)" : ""}
              onChange={e => setForm({ ...form, text: e.target.value })} />
          )}
        </InlineForm>
      )}
    </div>
  );
}

/**
 * Expandable task row. Click toggles the detail (facts + actions); the title
 * links to the task page.
 */
export default function TaskRow({ auth, task: t, qa, staffList, roleTargets, onRefresh, showTeam }) {
  const [open, setOpen] = useState(false);
  const can = canFor(auth, t);
  const href = taskHref(t.task_uid);
  return (
    <div className={`lirow${open ? " open" : ""}`}>
      <div className="li link" onClick={() => setOpen(o => !o)} role="button" aria-expanded={open}>
        <div className="body">
          <div className="t">{t.description}</div>
          <div className="d row">
            <span>by {t.created_by_name || "System"}</span>
            {showTeam && t.teamContext && <span>· {t.teamContext}</span>}
            {t.next_reminder && <span title="Daily DM reminder is on">· 🔔</span>}
          </div>
        </div>
        <div className="side">
          {qa?.open > 0 && <Link href={href} className="badge warn" onClick={e => e.stopPropagation()} title="Open the Q&A thread">{qa.open} Q</Link>}
          <TargetBadge task={t} />
          <TaskStatusBadge task={t} />
        </div>
      </div>
      {open && (
        <div className="lix">
          <p className="prose small">{t.description}</p>
          <div className="row small muted">
            <span>Created {fmtDateTime(t.created_at)}</span>
            {t.teamContext && <span>· Team {t.teamContext}</span>}
            {qa?.total > 0 && <span>· {qa.open > 0 ? `${qa.open} open question${qa.open > 1 ? "s" : ""}` : `${qa.total} answered`}</span>}
            {t.completed_at && <span>· {t.status} {fmtDateTime(t.completed_at)}{t.completed_by_name ? ` by ${t.completed_by_name}` : ""}</span>}
            <Link href={href} className="mono tiny" onClick={e => e.stopPropagation()}>Open task →</Link>
          </div>
          <TaskActions auth={auth} task={t} can={can} staffList={staffList} roleTargets={roleTargets} onDone={onRefresh} />
        </div>
      )}
    </div>
  );
}

