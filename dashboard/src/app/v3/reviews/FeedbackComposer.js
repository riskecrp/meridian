"use client";
import { useState } from "react";
import { getFeedbackDraft, sendFeedbackToFaction, markFeedbackSent } from "../../fm/leadership/actions.js";
import { Button, Field, useAction, fmtDate } from "../ui.js";

/*
 * Write and deliver a month's feedback message to a faction from the cycle
 * board. Same server actions as the hub's "Feedback to the faction" step:
 * "Draft from this month's review" fills the textarea from the recorded review,
 * leadership notes, scene count and promotion state (getFeedbackDraft) and
 * lists where each line came from; Send posts to the faction's comms channel;
 * Mark sent records a delivery made outside the dashboard.
 *
 * `faction` is a getReviewData row ({ id, name, currentReview, feedbackSent }).
 */
export default function FeedbackComposer({ faction, reviewMonth, readOnly = false, onDone, onClose }) {
  const [msg, setMsg] = useState("");
  const [sources, setSources] = useState(null);
  const [drafting, setDrafting] = useState(false);
  const { run, busy } = useAction();
  const hasReview = !!faction.currentReview;
  const sent = !!faction.feedbackSent?.sent;

  const draft = async () => {
    if (msg.trim() && !window.confirm("Replace what you have typed with the draft built from this month's review?")) return;
    setDrafting(true);
    const ok = await run(() => getFeedbackDraft(faction.id, reviewMonth), {
      onDone: (r) => { setMsg(r?.draft || ""); setSources(Array.isArray(r?.sources) ? r.sources : []); },
    });
    setDrafting(false);
    if (!ok) setSources(null);
  };

  return (
    <div className="inline-form">
      <div className="row spread">
        <span className="lbl">Feedback to {faction.name} — {reviewMonth}{sent ? ` · delivered by ${faction.feedbackSent.by}${faction.feedbackSent.at ? ` on ${fmtDate(faction.feedbackSent.at)}` : ""}` : ""}</span>
        {!readOnly && <Button variant="ghost" size="sm" disabled={busy || drafting} onClick={draft}>{drafting ? "Drafting…" : "✦ Draft from this month's review"}</Button>}
      </div>
      {!hasReview && <div className="err">No team-lead review for {reviewMonth} yet — the feedback is recorded against it, so submit the review first.</div>}
      {readOnly
        ? <div className="muted small">Previous months are read-only. The message, if one was sent, is on the faction's Comms tab.</div>
        : <Field><textarea rows={7} placeholder="Message sent to the faction's Command channel…" value={msg} onChange={e => setMsg(e.target.value)} /></Field>}
      {sources && (
        <div className="small muted">
          <div className="lbl" style={{ marginBottom: 3 }}>Built from</div>
          {sources.length === 0 ? <div>Nothing recorded for {reviewMonth} yet.</div> : (
            <ul className="src-list">
              {sources.map((s, i) => <li key={i}>{typeof s === "string" ? s : (s.label || s.detail || s.text || s.kind || "")}{s.kind && s.label ? <span className="mono tiny faint" style={{ marginLeft: 6 }}>{s.kind}</span> : null}</li>)}
            </ul>
          )}
        </div>
      )}
      <div className="actions-inline">
        {!readOnly && <Button disabled={busy || !msg.trim() || !hasReview} onClick={() => { if (window.confirm(`Send this feedback to ${faction.name}'s Command channel?`)) run(() => sendFeedbackToFaction(faction.id, msg), { success: `Feedback sent to ${faction.name}.`, onDone: () => { setMsg(""); onDone?.(); } }); }}>Send to faction</Button>}
        {!readOnly && <Button variant="ghost" disabled={busy || !hasReview || sent} title="Delivered outside the dashboard" onClick={() => run(() => markFeedbackSent(faction.id), { success: "Marked as sent.", onDone })}>Mark sent manually</Button>}
        <Button variant="quiet" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}
