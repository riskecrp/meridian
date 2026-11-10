"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "../../../../lib/useAuth";
import {
  getTaskDetail, claimMyTask, unclaimMyTask, completeMyTask, editMyTask, reassignMyTask,
  requestTaskInfo, answerTaskQuestion, getStaffForCreate, getRoleTargetsForCreate,
} from "../../../fm/dashboard/actions.js";
import { TargetSelect, parseTarget } from "../../TargetPicker.js";
import { useRun } from "../../hooks.js";

// The task page every Discord ping links to (urls.task): description, target,
// claimer, status, creator, the Q&A thread (ask + answer) and the lifecycle
// buttons — each shown only when shared/tasks.js would allow it for this actor
// (`can` comes from the server), and every refusal is shown in place.
const fmt = (s) => (s ? new Date(s).toLocaleString() : "");

export default function TaskDetailPage() {
  const auth = useAuth();
  const params = useParams();
  const uid = typeof params?.uid === "string" ? params.uid : "";
  const [data, setData] = useState(null);     // { ok, task, questions, can, me } | { ok:false, error }
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);     // { kind, text, target }
  const [answers, setAnswers] = useState({});
  const [staffList, setStaffList] = useState([]);
  const [roleTargets, setRoleTargets] = useState({ teams: [] });
  const { busy, err, setErr, run: runAction } = useRun();

  const refresh = async () => {
    if (!uid) return;
    try { setData(await getTaskDetail(uid)); }
    catch (e) { setData({ ok: false, error: e?.message || "Could not load this task." }); }
    setLoading(false);
  };
  useEffect(() => {
    if (auth?.loading || !auth?.id) return;
    refresh();
  }, [auth?.id, auth?.loading, uid]);

  useEffect(() => {
    if (!data?.can?.reassign || staffList.length) return;
    getStaffForCreate().then(setStaffList).catch(() => {});
    getRoleTargetsForCreate().then(setRoleTargets).catch(() => {});
  }, [data?.can?.reassign]);

  if (auth?.loading || loading) return <div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>;
  if (!auth?.ok) return <div className="view" style={{ color: "var(--ink-3)" }}>Not authorized.</div>;
  if (!data?.ok) return (
    <div className="view">
      <p className="eyebrow"><Link href="/v2/tasks" style={{ color: "var(--ink-3)" }}>Tasks</Link> · {uid}</p>
      <div className="restricted">{data?.error || "Task not found."}</div>
    </div>
  );

  const { task, questions, can } = data;
  const open = task.status === "open";
  const claimed = !!task.claimed_by && task.claimed_by !== "None";
  const leadershipScoped = task.targetLabel === "FM Leadership" || task.targetLabel === "Game Affairs";
  const unanswered = questions.filter(q => !q.answer);
  const answered = questions.filter(q => q.answer);
  const promoFaction = task.created_by_id === "promotion-bot" ? task.description.split(" — ")[0].trim() : "";

  const run = (fn) => runAction(fn, () => { setForm(null); refresh(); });
  const openForm = (kind, seed = "") => { setForm({ kind, text: seed, target: "" }); setErr(""); };
  const submitForm = () => {
    const { kind, text, target } = form;
    if (kind === "complete") return run(() => completeMyTask(uid, text.trim() || undefined));
    if (kind === "unclaim") return run(() => unclaimMyTask(uid, text.trim() || undefined));
    if (kind === "edit") { if (!text.trim()) { setErr("Description is required."); return; } return run(() => editMyTask(uid, text.trim())); }
    if (kind === "ask") { if (!text.trim()) { setErr("Question is required."); return; } return run(() => requestTaskInfo(uid, text.trim())); }
    if (kind === "reassign") {
      if (!target) { setErr("Pick a target."); return; }
      const { targetType, targetId } = parseTarget(target);
      return run(() => reassignMyTask(uid, targetId, targetType, text.trim() || undefined));
    }
  };
  const submitAnswer = (qid) => {
    const text = (answers[qid] || "").trim();
    if (!text) { setErr("Answer cannot be empty."); return; }
    runAction(() => answerTaskQuestion(qid, text), () => { setAnswers(a => { const n = { ...a }; delete n[qid]; return n; }); refresh(); });
  };
  const lbl = { fontFamily: "var(--v2-mono)", fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-3)" };

  return (
    <div className="view" style={{ maxWidth: 860 }}>
      <div className="page-head">
        <div>
          <p className="eyebrow"><Link href="/v2" style={{ color: "var(--ink-3)" }}>Home</Link> · <Link href="/v2/tasks" style={{ color: "var(--ink-3)" }}>Tasks</Link> · Task</p>
          <h1 style={{ overflowWrap: "anywhere" }}>{task.description.length > 90 ? task.description.slice(0, 90) + "…" : task.description}</h1>
          <div className="sub" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span className={`chip ${open ? (claimed ? "role" : "q-chip") : "lock"}`} style={!open ? {} : claimed ? { color: "var(--good)" } : {}}>
              {!open ? task.status.toUpperCase() : claimed ? `CLAIMED · ${task.claimerName}` : "UNCLAIMED"}
            </span>
            {leadershipScoped ? <span className="chip lock">🔒 {task.targetLabel}</span> : <span className="chip role">{task.targetLabel}</span>}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="hd"><div className="t">Task</div><div className="meta">{task.task_uid}</div></div>
        <p className="task-detail full" style={{ background: "transparent", padding: "10px 0", fontSize: 13.5 }}>{task.description}</p>
        <div className="kv" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          <div><div className="k">Created by</div><div className="v">{task.created_by_name || "System"}</div></div>
          <div><div className="k">Target</div><div className="v">{task.target_type}: {task.targetLabel}</div></div>
          <div><div className="k">Claimed by</div><div className="v" style={{ color: claimed ? "var(--good)" : "var(--amber)" }}>{claimed ? task.claimerName : "Unclaimed"}</div></div>
          <div><div className="k">Created</div><div className="v" style={{ fontSize: 12.5 }}>{fmt(task.created_at)}</div></div>
          {!open && <div><div className="k">{task.status === "completed" ? "Completed" : "Closed"}</div><div className="v" style={{ fontSize: 12.5 }}>{task.completed_by_name || "—"}{task.completed_at ? ` · ${fmt(task.completed_at)}` : ""}</div></div>}
          {task.completion_note && <div style={{ gridColumn: "1 / -1" }}><div className="k">Completion note</div><div className="v" style={{ fontWeight: 400, whiteSpace: "pre-wrap" }}>{task.completion_note}</div></div>}
        </div>
        {promoFaction && (
          <div style={{ marginTop: 6 }}>
            <Link href={`/v2/factions/${encodeURIComponent(promoFaction)}?tab=review`} className="btn">Open {promoFaction} review →</Link>
          </div>
        )}

        {!form && (
          <div className="actbar" style={{ marginTop: 12 }}>
            {can.claim && <button className="act primary" disabled={busy} onClick={() => run(() => claimMyTask(uid))}>Claim</button>}
            {can.edit && <button className="act" onClick={() => openForm("edit", task.description)}>Edit</button>}
            {can.reassign && <button className="act warn" onClick={() => openForm("reassign")}>Reassign</button>}
            {can.ask && <button className="act" onClick={() => openForm("ask")}>Ask the creator</button>}
            {can.unclaim && <button className="act" onClick={() => openForm("unclaim")}>Unclaim</button>}
            {can.complete && <button className="act good" onClick={() => openForm("complete")}>Complete</button>}
            {!Object.values(can).some(Boolean) && <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{open ? "Read-only for your access level." : "This task is closed."}</span>}
          </div>
        )}
        {err && !form && <div className="err" style={{ marginTop: 8 }} role="alert">{err}</div>}

        {form && (
          <div className="inline-form">
            <div className="lbl">
              {form.kind === "complete" ? "Completion note (optional)" : form.kind === "unclaim" ? "Reason (optional)" : form.kind === "ask" ? "Your question for the creator" : form.kind === "edit" ? "Edit description" : "Reassign to"}
            </div>
            {form.kind === "reassign" && (
              <TargetSelect className="" value={form.target} onChange={v => setForm({ ...form, target: v })}
                roleTargets={roleTargets} staffList={staffList} level={auth.level} gateLeadership includeGameAffairs />
            )}
            <textarea rows={form.kind === "reassign" ? 2 : 3} value={form.text}
              placeholder={form.kind === "ask" ? "What do you need to know?" : form.kind === "reassign" ? "Note for the new assignee (optional)" : ""}
              onChange={e => setForm({ ...form, text: e.target.value })} />
            {err && <div className="err">{err}</div>}
            <div className="row-btns">
              <button className="act primary" disabled={busy} onClick={submitForm}>{busy ? "Working…" : "Confirm"}</button>
              <button className="act" disabled={busy} onClick={() => { setForm(null); setErr(""); }}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="hd"><div className="t">Questions</div><div className="meta">{unanswered.length} open · {answered.length} answered</div></div>
        {questions.length === 0 && <div className="empty">No questions on this task yet.{can.ask ? " Use “Ask the creator” above." : ""}</div>}
        {unanswered.map(q => (
          <div key={q.id} className="note" style={{ borderLeft: "2px solid var(--amber)", paddingLeft: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <b style={{ color: "var(--amber)" }}>❓ {q.asked_by_name}</b>
              <span style={lbl}>{fmt(q.asked_at)}</span>
            </div>
            <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{q.question}</div>
            {can.answer ? (
              <div className="inline-form" style={{ marginTop: 8 }}>
                <div className="lbl">Your answer</div>
                <textarea rows={3} value={answers[q.id] || ""} onChange={e => setAnswers({ ...answers, [q.id]: e.target.value })} placeholder="Answer…" />
                <div className="row-btns"><button className="act primary" disabled={busy || !(answers[q.id] || "").trim()} onClick={() => submitAnswer(q.id)}>{busy ? "Sending…" : "Send answer"}</button></div>
              </div>
            ) : <div className="by">Waiting for the task creator to respond.</div>}
          </div>
        ))}
        {answered.map(q => (
          <div key={q.id} className="note">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <b>❓ {q.asked_by_name}</b>
              <span style={lbl}>{fmt(q.asked_at)}</span>
            </div>
            <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{q.question}</div>
            <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 7, background: "var(--panel-2)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <b style={{ color: "var(--accent)" }}>💬 {q.answered_by_name}</b>
                <span style={lbl}>{fmt(q.answered_at)}</span>
              </div>
              <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{q.answer}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
