"use client";
import { useState } from "react";
import Link from "next/link";
import {
  claimMyTask, completeMyTask, unclaimMyTask,
  reassignMyTask, requestTaskInfo, editMyTask,
} from "../fm/dashboard/actions.js";
import { TargetSelect, parseTarget } from "./TargetPicker.js";
import { useRun } from "./hooks.js";

// Interactive task list, reused in two modes:
//  - compact (Home): Assigned / Created / Team tabs, capped, "View all →" link.
//  - full (/v2/tasks): adds an All-server tab (L3) + search, uncapped.
// Expandable rows + the full action set (claim, complete, unclaim, reassign,
// request info, edit) via the guarded server actions. The buttons mirror the
// gates in shared/tasks.js; the server remains the authority and any refusal
// is shown in the row. Event Team / Lead Storyteller (no clearance) see the
// list read-only.
export default function TaskList({ auth, assigned, created, team, allServer, history, staffList, roleTargets, qaCounts, onRefresh, full = false, viewAllHref, initialTab = "assigned" }) {
  const [tab, setTab] = useState(initialTab);
  const [openUid, setOpenUid] = useState(null);
  const [form, setForm] = useState(null); // { uid, kind, text, target }
  const { busy, err, setErr, run: runAction } = useRun();
  const [q, setQ] = useState("");
  const level = auth?.level || 0;
  const canWrite = level >= 1;

  const TABS = [
    { id: "assigned", label: "Assigned", list: assigned },
    { id: "created", label: "Created by me", list: created },
    { id: "team", label: "Team", list: team },
    ...(allServer ? [{ id: "all", label: "All server", list: allServer }] : []),
    ...(history ? [{ id: "history", label: "Completed", list: history }] : []),
  ];
  const active = TABS.find(t => t.id === tab) || TABS[0];
  let list = active.list || [];
  if (full && q.trim()) {
    const needle = q.trim().toLowerCase();
    list = list.filter(t => `${t.description} ${t.targetLabel || ""} ${t.claimerName || ""} ${t.teamContext || ""}`.toLowerCase().includes(needle));
  }
  const cap = full ? list.length : 12;

  const resetForm = () => { setForm(null); setErr(""); };
  const openForm = (uid, kind, seed = "") => { setForm({ uid, kind, text: seed, target: "" }); setErr(""); };

  const run = (fn) => runAction(fn, () => { resetForm(); onRefresh(); });

  const submitForm = () => {
    const { uid, kind, text, target } = form;
    if (kind === "complete") return run(() => completeMyTask(uid, text.trim() || undefined));
    if (kind === "unclaim") return run(() => unclaimMyTask(uid, text.trim() || undefined));
    if (kind === "info") { if (!text.trim()) { setErr("Question is required."); return; } return run(() => requestTaskInfo(uid, text.trim())); }
    if (kind === "edit") { if (!text.trim()) { setErr("Description is required."); return; } return run(() => editMyTask(uid, text.trim())); }
    if (kind === "reassign") {
      if (!target) { setErr("Pick a target."); return; }
      const { targetType, targetId } = parseTarget(target);
      return run(() => reassignMyTask(uid, targetId, targetType, text.trim() || undefined));
    }
  };

  return (
    <div className="card">
      <div className="hd">
        <div className="t">{full ? "Tasks" : "My Work"}</div>
        <div className="tabs">
          {TABS.map(t => (
            <button key={t.id} className={`tab${tab === t.id ? " on" : ""}`}
              onClick={() => { setTab(t.id); setOpenUid(null); resetForm(); }}>
              {t.label} ({(t.list || []).length})
            </button>
          ))}
          {viewAllHref && <Link href={viewAllHref} className="tab" style={{ color: "var(--accent)" }}>View all →</Link>}
        </div>
      </div>

      {full && (
        <div style={{ padding: "10px 17px", borderBottom: "1px solid var(--line)" }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter by text, target, claimer…" aria-label="Filter tasks"
            style={{ width: "100%", background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 11px", fontSize: 13, color: "var(--ink-0)", outline: "none" }} />
        </div>
      )}

      {err && !form && <div className="err" style={{ padding: "8px 2px" }}>{err}</div>}

      {list.length === 0 ? (
        <div className="empty">
          {q.trim() ? "No tasks match your filter." : tab === "created" ? "You haven't created any open tasks." : tab === "team" ? "No team tasks." : tab === "all" ? "No tasks on the server." : tab === "history" ? "No completed tasks yet." : "Nothing assigned to you."}
        </div>
      ) : list.slice(0, cap).map(t => {
        const claimed = t.claimed_by && t.claimed_by !== "None";
        const claimedByMe = t.claimed_by === auth.id;
        const leadershipScoped = t.targetLabel === "FM Leadership" || t.targetLabel === "Game Affairs";
        const isCreator = !!t.created_by_id && t.created_by_id === auth.id;
        const isOpen = openUid === t.task_uid;
        const open = (t.status || "open") === "open";
        const canEdit = canWrite && open && (isCreator || level >= 2);
        const canReassign = canWrite && open && level >= 2;
        const canReqInfo = canWrite && t.created_by_id && !isCreator;
        const canUnclaim = canWrite && open && claimed && (claimedByMe || level >= 3);
        const canClaim = canWrite && open && !claimed;
        const canComplete = canWrite && open;
        const qa = qaCounts?.[t.task_uid];
        const detailHref = `/v2/tasks/${encodeURIComponent(t.task_uid)}`;

        return (
          <div key={t.task_uid}>
            <div className={`row${isOpen ? " exp" : ""}`} onClick={() => { setOpenUid(isOpen ? null : t.task_uid); resetForm(); }}>
              <span className={`stat-dot ${!open ? "over" : claimed ? "claimed" : "open"}`} />
              <span className="desc">{t.description}</span>
              {qa?.open > 0 && <Link href={detailHref} className="chip q-chip" onClick={e => e.stopPropagation()} title="Open the Q&A thread">{qa.open} Q</Link>}
              {leadershipScoped && <span className="chip lock">🔒 {t.targetLabel}</span>}
              {!leadershipScoped && <span className="chip role">{t.targetLabel || "—"}</span>}
              <span className="chip due">{!open ? t.status : claimed ? t.claimerName : "unclaimed"}</span>
              <span className="caret">▼</span>
            </div>

            {isOpen && (
              <div className="task-detail">
                <p className="full">{t.description}</p>
                <div className="facts">
                  <span>By <b>{t.created_by_name || "System"}</b></span>
                  <span>For <b>{t.targetLabel || "—"}</b></span>
                  {t.teamContext && <span>Team <b>{t.teamContext}</b></span>}
                  <span><b style={{ color: claimed ? "var(--good)" : "var(--amber)" }}>{claimed ? `Claimed · ${t.claimerName}` : "Unclaimed"}</b></span>
                  {qa?.total > 0 && <span><b>{qa.open > 0 ? `${qa.open} open Q` : `${qa.total} answered`}</b></span>}
                  <Link href={detailHref} style={{ color: "var(--accent)" }} onClick={e => e.stopPropagation()}>Open task →</Link>
                </div>

                {!form && (
                  <div className="actbar">
                    {canClaim && <button className="act primary" disabled={busy} onClick={e => { e.stopPropagation(); run(() => claimMyTask(t.task_uid)); }}>Claim</button>}
                    {canEdit && <button className="act" onClick={e => { e.stopPropagation(); openForm(t.task_uid, "edit", t.description); }}>Edit</button>}
                    {canReassign && <button className="act warn" onClick={e => { e.stopPropagation(); openForm(t.task_uid, "reassign"); }}>Reassign</button>}
                    {canReqInfo && <button className="act" onClick={e => { e.stopPropagation(); openForm(t.task_uid, "info"); }}>Request info</button>}
                    {canUnclaim && <button className="act" onClick={e => { e.stopPropagation(); openForm(t.task_uid, "unclaim"); }}>Unclaim</button>}
                    {canComplete && <button className="act good" onClick={e => { e.stopPropagation(); openForm(t.task_uid, "complete"); }}>Complete</button>}
                    {!canWrite && <span style={{ fontSize: 11, color: "var(--ink-3)" }}>Read-only.</span>}
                  </div>
                )}

                {form?.uid === t.task_uid && (
                  <div className="inline-form" onClick={e => e.stopPropagation()}>
                    <div className="lbl">
                      {form.kind === "complete" ? "Completion note (optional)"
                        : form.kind === "unclaim" ? "Reason (optional)"
                        : form.kind === "info" ? "Your question"
                        : form.kind === "edit" ? "Edit description"
                        : "Reassign to"}
                    </div>
                    {form.kind === "reassign" && (
                      <TargetSelect className="" value={form.target} onChange={v => setForm({ ...form, target: v })}
                        roleTargets={roleTargets} staffList={staffList} level={level}
                        gateLeadership includeGameAffairs />
                    )}
                    <textarea rows={form.kind === "reassign" ? 2 : 3} value={form.text}
                      placeholder={form.kind === "info" ? "What do you need to know?" : form.kind === "reassign" ? "Note for the new assignee (optional)" : ""}
                      onChange={e => setForm({ ...form, text: e.target.value })} />
                    {err && <div className="err">{err}</div>}
                    <div className="row-btns">
                      <button className="act primary" disabled={busy} onClick={submitForm}>{busy ? "Working…" : "Confirm"}</button>
                      <button className="act" disabled={busy} onClick={resetForm}>Cancel</button>
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
