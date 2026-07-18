"use client";
import { useState } from "react";
import Link from "next/link";
import {
  claimMyTask, completeMyTask, unclaimMyTask,
  reassignMyTask, requestTaskInfo, editMyTask,
} from "../fm/dashboard/actions.js";

// Interactive task list, reused in two modes:
//  - compact (Home): Assigned / Created / Team tabs, capped, "View all →" link.
//  - full (/v2/tasks): adds an All-server tab (L3) + search, uncapped.
// Expandable rows + the full action set (claim, complete, unclaim, reassign,
// request info, edit) via the existing guarded server actions.
export default function TaskList({ auth, assigned, created, team, allServer, staffList, roleTargets, qaCounts, onRefresh, full = false, viewAllHref }) {
  const [tab, setTab] = useState("assigned");
  const [openUid, setOpenUid] = useState(null);
  const [form, setForm] = useState(null); // { uid, kind, text, target }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");

  const TABS = [
    { id: "assigned", label: "Assigned", list: assigned },
    { id: "created", label: "Created by me", list: created },
    { id: "team", label: "Team", list: team },
    ...(allServer ? [{ id: "all", label: "All server", list: allServer }] : []),
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

  const run = async (fn) => {
    setBusy(true); setErr("");
    try { const r = await fn(); if (r && r.ok === false) { setErr(r.error || "Action failed."); setBusy(false); return; } }
    catch (e) { setErr("Action failed."); setBusy(false); return; }
    setBusy(false); resetForm(); onRefresh();
  };

  const targetOptions = () => {
    const rt = roleTargets || {};
    const opts = [];
    if (auth.level >= 3 && rt.leadershipId) opts.push({ v: `Role:${rt.leadershipId}`, l: "FM Leadership" });
    if (auth.level >= 3) opts.push({ v: "Role:1457189093594239147", l: "Game Affairs" });
    if (rt.leadId) opts.push({ v: `Role:${rt.leadId}`, l: "Team Leads" });
    if (rt.allFmId) opts.push({ v: `Role:${rt.allFmId}`, l: "All FM" });
    (rt.teams || []).forEach(t => opts.push({ v: `Role:${t.team_id}`, l: `Team ${t.team_name}` }));
    return opts;
  };

  const submitForm = () => {
    const { uid, kind, text, target } = form;
    if (kind === "complete") return run(() => completeMyTask(uid, text.trim() || undefined));
    if (kind === "unclaim") return run(() => unclaimMyTask(uid, text.trim() || undefined));
    if (kind === "info") { if (!text.trim()) { setErr("Question is required."); return; } return run(() => requestTaskInfo(uid, text.trim())); }
    if (kind === "edit") { if (!text.trim()) { setErr("Description is required."); return; } return run(() => editMyTask(uid, text.trim())); }
    if (kind === "reassign") {
      if (!target) { setErr("Pick a target."); return; }
      const [type, ...rest] = target.split(":");
      return run(() => reassignMyTask(uid, rest.join(":"), type, text.trim() || undefined));
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
          {viewAllHref && <Link href={viewAllHref} className="tab" style={{ color: "var(--iris)" }}>View all →</Link>}
        </div>
      </div>

      {full && (
        <div style={{ padding: "10px 17px", borderBottom: "1px solid var(--line)" }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter by text, target, claimer…"
            style={{ width: "100%", background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 11px", fontSize: 13, color: "var(--ink-0)", outline: "none" }} />
        </div>
      )}

      {list.length === 0 ? (
        <div className="empty">
          {q.trim() ? "No tasks match your filter." : tab === "created" ? "You haven't created any open tasks." : tab === "team" ? "No team tasks." : tab === "all" ? "No tasks on the server." : "Nothing assigned to you."}
        </div>
      ) : list.slice(0, cap).map(t => {
        const claimed = t.claimed_by && t.claimed_by !== "None";
        const claimedByMe = t.claimed_by === auth.id;
        const leadershipScoped = t.targetLabel === "FM Leadership" || t.targetLabel === "Game Affairs";
        const canEdit = t.created_by_id === auth.id || auth.level >= 2;
        const canReassign = auth.level >= 2;
        const canReqInfo = t.created_by_id && t.created_by_id !== auth.id;
        const canUnclaim = claimed && (claimedByMe || auth.level >= 3);
        const qa = qaCounts?.[t.task_uid];
        const isOpen = openUid === t.task_uid;

        return (
          <div key={t.task_uid}>
            <div className={`row${isOpen ? " exp" : ""}`} onClick={() => { setOpenUid(isOpen ? null : t.task_uid); resetForm(); }}>
              <span className={`stat-dot ${claimed ? "claimed" : "open"}`} />
              <span className="desc">{t.description}</span>
              {qa?.open > 0 && <span className="chip q-chip">{qa.open} Q</span>}
              {leadershipScoped && <span className="chip lock">🔒 {t.targetLabel}</span>}
              {!leadershipScoped && <span className="chip role">{t.targetLabel || "—"}</span>}
              <span className="chip due">{claimed ? t.claimerName : "unclaimed"}</span>
              <span className="caret">▼</span>
            </div>

            {isOpen && (
              <div className="task-detail">
                <p className="full">{t.description}</p>
                <div className="facts">
                  <span>By <b>{t.created_by_name || "System"}</b></span>
                  <span>For <b>{t.targetLabel || "—"}</b></span>
                  <span><b style={{ color: claimed ? "var(--emerald)" : "var(--amber)" }}>{claimed ? `Claimed · ${t.claimerName}` : "Unclaimed"}</b></span>
                  {qa?.total > 0 && <span><b>{qa.open > 0 ? `${qa.open} open Q` : `${qa.total} answered`}</b></span>}
                </div>

                {!form && (
                  <div className="actbar">
                    {!claimed && <button className="act primary" disabled={busy} onClick={() => run(() => claimMyTask(t.task_uid))}>Claim</button>}
                    {canEdit && <button className="act" onClick={() => openForm(t.task_uid, "edit", t.description)}>Edit</button>}
                    {canReassign && <button className="act warn" onClick={() => openForm(t.task_uid, "reassign")}>Reassign</button>}
                    {canReqInfo && <button className="act" onClick={() => openForm(t.task_uid, "info")}>Request info</button>}
                    {canUnclaim && <button className="act" onClick={() => openForm(t.task_uid, "unclaim")}>Unclaim</button>}
                    <button className="act good" onClick={() => openForm(t.task_uid, "complete")}>Complete</button>
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
                      <select value={form.target} onChange={e => setForm({ ...form, target: e.target.value })}>
                        <option value="">Select target…</option>
                        <optgroup label="Roles & Teams">
                          {targetOptions().map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                        </optgroup>
                        <optgroup label="Staff">
                          {(staffList || []).map(s => <option key={s.discord_id} value={`User:${s.discord_id}`}>{s.display_name}</option>)}
                        </optgroup>
                      </select>
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
