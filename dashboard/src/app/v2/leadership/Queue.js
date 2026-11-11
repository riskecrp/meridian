"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getLeadershipQueue, approveRPChange, denyRPChange, resolveDeletion } from "../../fm/operations/actions.js";
import { markFeedbackSent } from "../../fm/leadership/actions.js";
import { answerTaskQuestion, claimTask } from "../../fm/teams/actions.js";
import { completePromotion, cancelPromotion } from "../../fm/factions/actions.js";
import { useRun } from "../hooks.js";
import { useExecuteFlow } from "./ExecuteFlow.js";
import VerifyInGame, { AgeBadge } from "./VerifyInGame.js";

/* Everything waiting on leadership, grouped by kind. Each row offers the same
   one-click action the owning page has (same server action, same modal), plus
   a link into the record. L2 sees their team's items; L3 sees all. */
const KINDS = [
  ["approval", "Approvals", "RP changes awaiting approval", "var(--amber)", "var(--amber-bg)"],
  ["execute", "Ready to execute", "RP done — the world change is waiting", "var(--accent)", "var(--accent-bg)"],
  ["verify", "Verify in game", "Executed changes nobody has confirmed in game yet", "var(--sky)", "var(--sky-bg)"],
  ["feedback", "Feedback to send", "Confirmed reviews whose 15th message has not gone out", "var(--good)", "var(--good-bg)"],
  ["deletion", "Deletion requests", "Content a staffer asked leadership to delete", "var(--rose)", "var(--rose-bg)"],
  ["question", "Unanswered questions", "Questions asked on open tasks", "var(--amber)", "var(--amber-bg)"],
  ["task", "Unclaimed leadership tasks", "Open tasks addressed to FM Leadership / Game Affairs", "var(--ink-2)", "var(--panel-2)"],
  ["promotion", "Staged promotions", "Promotions staged after a review — complete after the RP", "var(--good)", "var(--good-bg)"],
];
const KIND_CHIP = { approval: "RP", execute: "EXEC", verify: "VERIFY", feedback: "FEEDBACK", deletion: "DELETE", question: "Q", task: "TASK", promotion: "PROMO" };

export default function Queue({ auth, onCount }) {
  const isL3 = auth.level >= 3;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [flt, setFlt] = useState("all"); // all | stale | <kind>
  const [answer, setAnswer] = useState(null); // { id, text }
  const { busy, err, setErr, run } = useRun();
  const load = () => getLeadershipQueue().then(d => { setData(d || { items: [], counts: { total: 0 } }); onCount?.(d?.counts?.total || 0); setLoading(false); }).catch(e => { setErr(e?.message || "Could not load the queue."); setLoading(false); });
  useEffect(() => { load(); }, []);
  const act = (fn) => run(fn, load);          // every mutation reloads the queue on success
  const exec = useExecuteFlow({ run: act, busy, setErr });

  if (loading) return <div className="empty">Loading…</div>;
  const items = data?.items || [];
  const counts = data?.counts || {};
  const shown = items.filter(it => flt === "all" ? true : flt === "stale" ? it.ageDays >= 7 : it.kind === flt);
  const groups = KINDS.map(k => [k, shown.filter(it => it.kind === k[0])]).filter(([, rows]) => rows.length > 0);

  return (
    <>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          <button className={`pill${flt === "all" ? " on" : ""}`} onClick={() => setFlt("all")}>All <span className="ct">{counts.total || 0}</span></button>
          <button className={`pill${flt === "stale" ? " on amber" : ""}`} onClick={() => setFlt("stale")} title="Waiting seven days or more">7+ days <span className="ct">{counts.stale || 0}</span></button>
          {KINDS.filter(([k]) => counts[k] > 0).map(([k, label]) => (
            <button key={k} className={`pill${flt === k ? " on" : ""}`} onClick={() => setFlt(flt === k ? "all" : k)}>{label} <span className="ct">{counts[k]}</span></button>
          ))}
        </div>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontFamily: "var(--v2-mono)", fontSize: 11, color: "var(--ink-3)" }}>{isL3 ? "everything waiting on leadership" : "your team's items"}</span>
          <button className="act" disabled={busy} onClick={load}>Refresh</button>
        </span>
      </div>
      {err && <div className="err" style={{ marginBottom: 10 }}>{err}</div>}
      {items.length === 0 && <div className="empty">Nothing is waiting on you. 🎉</div>}
      {items.length > 0 && shown.length === 0 && <div className="empty">Nothing matches this filter.</div>}

      {groups.map(([[kind, label, hint, color, bg], rows]) => (
        <div className="card" key={kind}>
          <div className="hd"><div className="t"><span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block" }} />{label}</div><div className="meta" title={hint}>{rows.length}{rows.some(r => r.ageDays >= 7) ? ` · ${rows.filter(r => r.ageDays >= 7).length} stale` : ""}</div></div>
          {rows.map(it => (
            <div key={`${kind}-${it.id}`} style={{ borderBottom: "1px solid var(--line)" }}>
              <div className="clog" style={{ alignItems: "flex-start", borderBottom: "none" }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 3 }}>
                    <span className="chip" style={{ background: bg, color }}>{KIND_CHIP[kind]}{it.faction ? ` · ${it.faction}` : ""}</span>
                    <AgeBadge days={it.ageDays} overdue={!!it.overdue} since={it.since} />
                    {kind === "verify" && it.overdue && <span style={{ fontFamily: "var(--v2-mono)", fontSize: 9, fontWeight: 800, color: "var(--rose)" }}>48H+ UNVERIFIED</span>}
                    {kind === "task" && it.targetLabel && <span className="chip role">{it.targetLabel}</span>}
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--ink-1)", overflowWrap: "anywhere" }}>
                    {kind === "question" ? <>“{it.title}” <span style={{ color: "var(--ink-3)" }}>— on {it.taskDescription}</span></> : it.title}
                  </div>
                  {kind === "execute" && it.note && <div style={{ fontSize: 11.5, color: "var(--ink-3)", fontStyle: "italic" }}>RP note: {it.note}</div>}
                  <div style={{ fontFamily: "var(--v2-mono)", fontSize: 10.5, color: "var(--ink-3)" }}>
                    {it.actor ? `${kind === "question" ? "asked by" : kind === "task" || kind === "deletion" ? "from" : kind === "feedback" ? "reviewed by" : "requested by"} ${it.actor}` : "—"}{it.since ? ` · ${String(it.since).slice(0, 10)}` : ""}{kind === "question" && it.creator ? ` · task by ${it.creator}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                  {kind === "approval" && isL3 && <>
                    <button className="act" style={{ color: "var(--rose)" }} disabled={busy} onClick={() => { const reason = window.prompt("Reason for denial (required):"); if (reason?.trim()) act(() => denyRPChange(it.id, reason.trim())); }}>Deny</button>
                    <button className="act good" disabled={busy} onClick={() => act(() => approveRPChange(it.id))}>Approve</button>
                  </>}
                  {kind === "execute" && isL3 && <button className="act good" disabled={busy} onClick={() => exec.begin({ id: it.id, faction_name: it.faction, execution_type: it.executionType })}>Execute</button>}
                  {kind === "verify" && <VerifyInGame exec={{ id: it.id, requester_id: it.requesterId, requested_by: it.actor, verified_at: null }} auth={auth} busy={busy} run={act} compact />}
                  {kind === "feedback" && <button className="act" disabled={busy} onClick={() => { if (window.confirm(`Mark the ${it.reviewMonth} feedback for ${it.faction} as sent (delivered outside the dashboard)?`)) act(() => markFeedbackSent(it.factionId)); }}>Mark feedback sent</button>}
                  {kind === "deletion" && isL3 && <>
                    <button className="act" disabled={busy} onClick={() => act(() => resolveDeletion(it.id, false))}>Reject</button>
                    <button className="act" style={{ color: "var(--rose)" }} disabled={busy} onClick={() => { if (window.confirm("Permanently delete this content?")) act(() => resolveDeletion(it.id, true)); }}>Approve delete</button>
                  </>}
                  {kind === "question" && <button className="act good" disabled={busy} onClick={() => setAnswer(answer?.id === it.id ? null : { id: it.id, text: "" })}>Answer</button>}
                  {kind === "task" && <button className="act good" disabled={busy} onClick={() => act(() => claimTask(it.id))}>Claim</button>}
                  {kind === "promotion" && isL3 && <>
                    <button className="act" style={{ color: "var(--rose)" }} disabled={busy} onClick={() => { if (window.confirm(`Cancel promo for ${it.faction}?`)) act(() => cancelPromotion(it.factionId)); }}>Cancel</button>
                    <button className="act good" disabled={busy} onClick={() => { if (window.confirm(`Complete promo for ${it.faction}? Do this after the RP has run.`)) act(() => completePromotion(it.factionId)); }}>Complete</button>
                  </>}
                  <Link className="act" href={it.href}>Open →</Link>
                </div>
              </div>
              {kind === "question" && answer?.id === it.id && (
                <div className="inline-form" style={{ margin: "0 2px 12px" }}>
                  <div className="lbl">Your answer — {it.actor} is told in Discord</div>
                  <textarea rows={2} autoFocus value={answer.text} onChange={e => setAnswer({ ...answer, text: e.target.value })} />
                  <div className="row-btns">
                    <button className="act primary" disabled={busy || !answer.text.trim()} onClick={() => act(() => answerTaskQuestion(it.id, answer.text.trim())).then(ok => ok && setAnswer(null))}>Send answer</button>
                    <button className="act" onClick={() => setAnswer(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
      {exec.modals}
    </>
  );
}
