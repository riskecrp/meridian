"use client";
// /v3/work/[uid] — the task page every Discord ping links to: description,
// target, claimer, status, creator, the Q&A thread (ask + answer) and the
// lifecycle buttons, each shown only when the server's `can` allows it.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "../../../../lib/useAuth.js";
import { PageHeader, Card, Empty, Restricted, useAction, fmtDateTime } from "../../ui.js";
import { getTaskDetail, answerTaskQuestion } from "../../../fm/dashboard/actions.js";
import { TaskActions } from "../TaskRow.js";
import { Skeleton, usePickerData, TaskStatusBadge, TargetBadge, isClaimed, factionHref, InlineForm } from "../shared.js";

export default function TaskDetailPage() {
  const auth = useAuth();
  const params = useParams();
  const uid = typeof params?.uid === "string" ? decodeURIComponent(params.uid) : "";
  const [data, setData] = useState(null);
  const [answers, setAnswers] = useState({});
  const { run, busy } = useAction();
  const { staffList, roleTargets } = usePickerData(!!data?.can?.reassign);

  const refresh = async () => {
    if (!uid) return;
    try { setData(await getTaskDetail(uid)); }
    catch (e) { setData({ ok: false, error: e?.message || "Could not load this task." }); }
  };
  useEffect(() => { if (auth?.ok && !auth?.loading) refresh(); }, [auth?.ok, auth?.loading, auth?.id, uid]); // eslint-disable-line react-hooks/exhaustive-deps

  const crumbs = <><Link href="/v3">Home</Link> · <Link href="/v3/work">Work</Link> · Task</>;
  if (auth?.loading || (auth?.ok && data === null)) return <><PageHeader eyebrow={crumbs} title="Loading…" /><Skeleton rows={4} /></>;
  if (!auth?.ok) return <><PageHeader eyebrow={crumbs} title={uid} /><Restricted>You are not signed in.</Restricted></>;
  if (!data?.ok) return <><PageHeader eyebrow={crumbs} title={uid} /><Restricted>{data?.error || "Task not found."}</Restricted></>;

  const { task, questions, can } = data;
  const open = task.status === "open";
  const claimed = isClaimed(task);
  const unanswered = questions.filter(q => !q.answer);
  const answered = questions.filter(q => q.answer);
  const promoFaction = task.created_by_id === "promotion-bot" ? task.description.split(" — ")[0].trim() : "";
  const submitAnswer = (qid) => {
    const text = (answers[qid] || "").trim();
    if (!text) return;
    run(() => answerTaskQuestion(qid, text), { success: "Answer sent.", onDone: () => { setAnswers(a => { const n = { ...a }; delete n[qid]; return n; }); refresh(); } });
  };

  return (
    <div className="narrow">
      <PageHeader eyebrow={crumbs} title={task.description.length > 90 ? task.description.slice(0, 90) + "…" : task.description}
        sub={<span className="row"><TaskStatusBadge task={task} /><TargetBadge task={task} /><span className="mono tiny faint">{task.task_uid}</span></span>} />
      <div className="stack">
        <Card title="Task">
          <p className="prose">{task.description}</p>
          <div className="kv">
            <div><div className="lbl">Created by</div><div>{task.created_by_name || "System"}</div></div>
            <div><div className="lbl">Target</div><div>{task.target_type}: {task.targetLabel}</div></div>
            <div><div className="lbl">Claimed by</div><div className={claimed ? "tx-good" : "tx-warn"}>{claimed ? task.claimerName : "Unclaimed"}</div></div>
            <div><div className="lbl">Created</div><div className="small">{fmtDateTime(task.created_at)}</div></div>
            {!open && <div><div className="lbl">{task.status === "completed" ? "Completed" : "Closed"}</div><div className="small">{task.completed_by_name || "—"}{task.completed_at ? ` · ${fmtDateTime(task.completed_at)}` : ""}</div></div>}
            {task.completion_note && <div className="span"><div className="lbl">Completion note</div><div className="msg">{task.completion_note}</div></div>}
          </div>
          {promoFaction && <div className="mt8"><Link href={factionHref(promoFaction, "review")} className="btn">Open {promoFaction} review →</Link></div>}
          <div className="section">
            <TaskActions auth={auth} task={task} can={can} staffList={staffList} roleTargets={roleTargets} onDone={refresh} />
          </div>
        </Card>

        <Card title="Questions" right={<span className="mono tiny faint">{unanswered.length} open · {answered.length} answered</span>}>
          {questions.length === 0 && <Empty>No questions on this task yet.{can.ask ? " Use “Ask the creator” above." : ""}</Empty>}
          <div className="stack">
            {unanswered.map(q => (
              <div key={q.id} className="qa">
                <div className="row spread"><b className="tx-warn">❓ {q.asked_by_name}</b><span className="mono tiny faint">{fmtDateTime(q.asked_at)}</span></div>
                <div className="msg">{q.question}</div>
                {can.answer ? (
                  <InlineForm label="Your answer — the asker is told in Discord" busy={busy} confirmLabel="Send answer" confirmDisabled={!(answers[q.id] || "").trim()} onConfirm={() => submitAnswer(q.id)} onCancel={() => setAnswers(a => ({ ...a, [q.id]: "" }))}>
                    <textarea rows={3} value={answers[q.id] || ""} onChange={e => setAnswers({ ...answers, [q.id]: e.target.value })} placeholder="Answer…" />
                  </InlineForm>
                ) : <div className="faint tiny mt8">Waiting for the task creator to respond.</div>}
              </div>
            ))}
            {answered.map(q => (
              <div key={q.id} className="qa answered">
                <div className="row spread"><b>❓ {q.asked_by_name}</b><span className="mono tiny faint">{fmtDateTime(q.asked_at)}</span></div>
                <div className="msg">{q.question}</div>
                <div className="ans">
                  <div className="row spread"><b className="tx-accent">💬 {q.answered_by_name}</b><span className="mono tiny faint">{fmtDateTime(q.answered_at)}</span></div>
                  <div className="msg">{q.answer}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

