"use client";
// Everything waiting on leadership (v2/leadership/Queue.js + the Approvals
// tab's "awaiting RP" rows), grouped by kind, each row with the same one-click
// action the owning page has: approve/deny/delete RP change, execute (preview
// first), verify in game, mark feedback sent, resolve deletion, answer a task
// question, claim a leadership task, complete/cancel a staged promotion, and
// "confirm RP done" for the requester. L2 sees their team's items; L3 all.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, Button, Badge, Age, Empty, Modal, Field, useAction } from "../ui.js";
import { getLeadershipQueue, approveRPChange, denyRPChange, deleteRPChange, markRPDone, resolveDeletion } from "../../fm/operations/actions.js";
import { markFeedbackSent, getPendingQueue } from "../../fm/leadership/actions.js";
import { answerTaskQuestion, claimTask } from "../../fm/teams/actions.js";
import { completePromotion, cancelPromotion } from "../../fm/factions/actions.js";
import { useExecuteFlow } from "./ExecuteFlow.js";
import VerifyInGame from "./VerifyInGame.js";
import { InlineForm, Skeleton, toV3, factionHref } from "./shared.js";

const KINDS = [
  ["approval", "Approvals", "RP changes awaiting approval", "warn"],
  ["awaiting", "Awaiting RP", "Approved — the requester confirms when the scene has run", "info"],
  ["execute", "Ready to execute", "RP done — the world change is waiting", "accent"],
  ["verify", "Verify in game", "Executed changes nobody has confirmed in game yet", "info"],
  ["feedback", "Feedback to send", "Confirmed reviews whose 15th message has not gone out", "good"],
  ["deletion", "Deletion requests", "Content a staffer asked leadership to delete", "bad"],
  ["question", "Unanswered questions", "Questions asked on open tasks", "warn"],
  ["task", "Unclaimed leadership tasks", "Open tasks addressed to FM Leadership / Game Affairs", ""],
  ["promotion", "Staged promotions", "Promotions staged after a review — complete after the RP", "good"],
];
const CHIP = { approval: "RP", awaiting: "RP", execute: "EXEC", verify: "VERIFY", feedback: "FEEDBACK", deletion: "DELETE", question: "Q", task: "TASK", promotion: "PROMO" };
const BY = { question: "asked by", task: "from", deletion: "from", feedback: "reviewed by" };

export default function Queue({ auth, onCount }) {
  const isL3 = (auth?.level || 0) >= 3;
  const [data, setData] = useState(null);
  const [awaiting, setAwaiting] = useState([]);
  const [loading, setLoading] = useState(true);
  const [flt, setFlt] = useState("all");
  const [answer, setAnswer] = useState(null); // { id, text }
  const [rpDone, setRpDone] = useState(null); // { id, note }
  const [deny, setDeny] = useState(null);     // { id, reason }
  const { run, busy } = useAction();

  const load = () => Promise.all([
    getLeadershipQueue().catch(() => ({ items: [], counts: { total: 0 } })),
    getPendingQueue().catch(() => null),
  ]).then(([q, pq]) => {
    const d = q || { items: [], counts: { total: 0 } };
    setData(d);
    setAwaiting((pq?.rpChanges || []).filter(r => r.status === "APPROVED"));
    onCount?.(d.counts?.total || 0);
    setLoading(false);
  });
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const act = (fn, success) => run(fn, { success, onDone: load });
  const exec = useExecuteFlow({ run: act, busy });

  if (loading) return <Skeleton rows={4} />;
  const items = data?.items || [];
  const counts = data?.counts || {};
  const shown = items.filter(it => flt === "all" ? true : flt === "stale" ? it.ageDays >= 7 : it.kind === flt);
  const showAwaiting = awaiting.length > 0 && (flt === "all" || flt === "awaiting");
  const groups = KINDS.map(k => [k, k[0] === "awaiting" ? (showAwaiting ? awaiting.map(r => ({ kind: "awaiting", id: r.id, title: `${r.execution_type}: ${r.old_value} → ${r.new_value}`, faction: r.faction_name, factionId: r.faction_id, since: r.created_at, actor: r.requested_by, requesterId: r.requester_id, ageDays: Math.max(0, Math.floor((Date.now() - new Date(String(r.created_at || "").replace(" ", "T")).getTime()) / 86400000)) || 0, href: "/v3?panel=queue", raw: r })) : []) : shown.filter(it => it.kind === k[0])]).filter(([, rows]) => rows.length > 0);
  const total = (counts.total || 0) + awaiting.length;

  return (
    <>
      <div className="filters">
        <div className="chips">
          <button className={`chip${flt === "all" ? " on" : ""}`} onClick={() => setFlt("all")}>All <span className="ct">{total}</span></button>
          <button className={`chip${flt === "stale" ? " on" : ""}`} onClick={() => setFlt("stale")} title="Waiting seven days or more">7+ days <span className="ct">{counts.stale || 0}</span></button>
          {KINDS.filter(([k]) => k === "awaiting" ? awaiting.length > 0 : counts[k] > 0).map(([k, label]) => (
            <button key={k} className={`chip${flt === k ? " on" : ""}`} onClick={() => setFlt(flt === k ? "all" : k)}>{label} <span className="ct">{k === "awaiting" ? awaiting.length : counts[k]}</span></button>
          ))}
        </div>
        <span className="mono tiny faint grow">{isL3 ? "everything waiting on leadership" : "your team's items"}</span>
        <Button size="sm" variant="ghost" disabled={busy} onClick={load}>Refresh</Button>
      </div>
      {total === 0 && <Empty title="Nothing is waiting on you">The queue is clear.</Empty>}
      {total > 0 && groups.length === 0 && <Empty>Nothing matches this filter.</Empty>}

      <div className="stack">
        {groups.map(([[kind, label, hint, tone], rows]) => (
          <Card key={kind} title={<span title={hint}>{label}</span>} right={<span className="mono tiny faint">{rows.length}{rows.some(r => r.ageDays >= 7) ? ` · ${rows.filter(r => r.ageDays >= 7).length} stale` : ""}</span>}>
            <div className="list">
              {rows.map(it => (
                <div key={`${kind}-${it.id}`} className="lirow">
                  <div className="li">
                    <div className="body">
                      <div className="row small">
                        <Badge tone={tone}>{CHIP[kind]}{it.faction ? ` · ${it.faction}` : ""}</Badge>
                        <Age since={it.since} warnDays={3} staleDays={7} />
                        {kind === "verify" && it.overdue && <Badge tone="bad">48h+ unverified</Badge>}
                        {kind === "task" && it.targetLabel && <Badge tone="lock">{it.targetLabel}</Badge>}
                      </div>
                      <div className="t">{kind === "question" ? <>“{it.title}” <span className="muted">— on {it.taskDescription}</span></> : it.title}</div>
                      {kind === "execute" && it.note && <div className="d">RP note: {it.note}</div>}
                      <div className="mono tiny faint">
                        {it.actor ? `${BY[kind] || "requested by"} ${it.actor}` : "—"}{it.since ? ` · ${String(it.since).slice(0, 10)}` : ""}{kind === "question" && it.creator ? ` · task by ${it.creator}` : ""}
                      </div>
                    </div>
                    <div className="side">
                      {kind === "approval" && isL3 && <>
                        <Button size="sm" variant="danger ghost" disabled={busy} onClick={() => setDeny({ id: it.id, reason: "" })}>Deny</Button>
                        <Button size="sm" variant="good" disabled={busy} onClick={() => act(() => approveRPChange(it.id), "RP change approved.")}>Approve</Button>
                      </>}
                      {kind === "awaiting" && (isL3 || it.requesterId === auth?.id) && <Button size="sm" variant="good" disabled={busy} onClick={() => setRpDone(rpDone?.id === it.id ? null : { id: it.id, note: "" })}>Confirm RP done</Button>}
                      {kind === "awaiting" && !(isL3 || it.requesterId === auth?.id) && <span className="tiny muted">Waiting for {it.actor} to confirm the RP.</span>}
                      {kind === "execute" && isL3 && <Button size="sm" variant="good" disabled={busy} onClick={() => exec.begin({ id: it.id, faction_name: it.faction, execution_type: it.executionType })}>Execute</Button>}
                      {(kind === "approval" || kind === "awaiting" || kind === "execute") && isL3 && <Button size="sm" variant="quiet" disabled={busy} onClick={() => { if (window.confirm(`Delete this RP change for ${it.faction}?`)) act(() => deleteRPChange(it.id), "RP change deleted."); }}>Delete</Button>}
                      {kind === "verify" && <VerifyInGame exec={{ id: it.id, requester_id: it.requesterId, requested_by: it.actor, verified_at: null }} auth={auth} busy={busy} run={run} onDone={load} />}
                      {kind === "feedback" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (window.confirm(`Mark the ${it.reviewMonth} feedback for ${it.faction} as sent (delivered outside the dashboard)?`)) act(() => markFeedbackSent(it.factionId), "Feedback marked as sent."); }}>Mark feedback sent</Button>}
                      {kind === "deletion" && isL3 && <>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => resolveDeletion(it.id, false), "Deletion request rejected.")}>Reject</Button>
                        <Button size="sm" variant="danger ghost" disabled={busy} onClick={() => { if (window.confirm("Permanently delete this content?")) act(() => resolveDeletion(it.id, true), "Content deleted."); }}>Approve delete</Button>
                      </>}
                      {kind === "question" && <Button size="sm" variant="good" disabled={busy} onClick={() => setAnswer(answer?.id === it.id ? null : { id: it.id, text: "" })}>Answer</Button>}
                      {kind === "task" && <Button size="sm" variant="good" disabled={busy} onClick={() => act(() => claimTask(it.id), "Task claimed.")}>Claim</Button>}
                      {kind === "promotion" && isL3 && <>
                        <Button size="sm" variant="danger ghost" disabled={busy} onClick={() => { if (window.confirm(`Cancel the staged promotion for ${it.faction}?`)) act(() => cancelPromotion(it.factionId), "Promotion cancelled."); }}>Cancel</Button>
                        <Button size="sm" variant="good" disabled={busy} onClick={() => { if (window.confirm(`Complete the promotion for ${it.faction}? Do this after the RP has run.`)) act(() => completePromotion(it.factionId), "Promotion completed."); }}>Complete</Button>
                      </>}
                      {kind === "feedback" || kind === "promotion"
                        ? <Link className="btn ghost sm" href={factionHref(it.faction, "review")}>Open →</Link>
                        : kind !== "awaiting" && <Link className="btn ghost sm" href={toV3(it.href)}>Open →</Link>}
                    </div>
                  </div>
                  {kind === "question" && answer?.id === it.id && (
                    <InlineForm label={`Your answer — ${it.actor} is told in Discord`} busy={busy} confirmLabel="Send answer" confirmDisabled={!answer.text.trim()} onCancel={() => setAnswer(null)}
                      onConfirm={() => act(() => answerTaskQuestion(it.id, answer.text.trim()), "Answer sent.").then(ok => ok && setAnswer(null))}>
                      <textarea rows={2} autoFocus value={answer.text} onChange={e => setAnswer({ ...answer, text: e.target.value })} />
                    </InlineForm>
                  )}
                  {kind === "awaiting" && rpDone?.id === it.id && (
                    <InlineForm label="Confirmation note (optional) — how the scene went" busy={busy} confirmLabel="Confirm RP done" onCancel={() => setRpDone(null)}
                      onConfirm={() => act(() => markRPDone(it.id, rpDone.note.trim()), "RP marked done — ready to execute.").then(ok => ok && setRpDone(null))}>
                      <textarea rows={2} autoFocus value={rpDone.note} onChange={e => setRpDone({ ...rpDone, note: e.target.value })} />
                    </InlineForm>
                  )}
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
      {deny && (
        <Modal title="Deny this RP change" onClose={() => setDeny(null)} saveLabel="Deny" saveDisabled={busy || !deny.reason.trim()}
          onSave={() => act(() => denyRPChange(deny.id, deny.reason.trim()), "RP change denied.").then(ok => ok && setDeny(null))}>
          <Field label="Reason for denial (required) — the requester is told"><textarea rows={3} autoFocus value={deny.reason} onChange={e => setDeny({ ...deny, reason: e.target.value })} /></Field>
        </Modal>
      )}
      {exec.modals}
    </>
  );
}
