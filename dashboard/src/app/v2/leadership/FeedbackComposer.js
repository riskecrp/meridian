"use client";
import { useState } from "react";
import * as Lead from "../../fm/leadership/actions.js";
import { useRun } from "../hooks.js";

const { sendFeedbackToFaction, markFeedbackSent } = Lead;
// getFeedbackDraft(factionId, reviewMonth) → { ok, draft, sources } is added by
// the review-hub work; when the export is not deployed yet the button says so
// instead of throwing.
const getFeedbackDraft = Lead.getFeedbackDraft;

/*
 * Write and deliver this month's feedback message to a faction from the
 * Leadership › Reviews board, without opening the faction hub. Same server
 * actions as the hub's "Feedback to the faction" step; "Draft from this
 * month's review" fills the textarea from the recorded review, votes and
 * scene count and lists where each line came from.
 */
export default function FeedbackComposer({ faction, reviewMonth, onDone, onClose }) {
  const [msg, setMsg] = useState("");
  const [sources, setSources] = useState(null);
  const [drafting, setDrafting] = useState(false);
  const { busy, err, setErr, run } = useRun();
  const hasReview = !!faction.currentReview;
  const sent = !!faction.feedbackSent?.sent;

  const draft = async () => {
    setErr("");
    if (typeof getFeedbackDraft !== "function") { setErr("Drafting from the review is not available on this build yet."); return; }
    if (msg.trim() && !window.confirm("Replace what you have typed with the draft built from this month's review?")) return;
    setDrafting(true);
    let r;
    try { r = await getFeedbackDraft(faction.id, reviewMonth); } catch (e) { r = { ok: false, error: e?.message || "Draft failed." }; }
    setDrafting(false);
    if (!r || r.ok === false) { setErr(r?.error || "Draft failed."); return; }
    setMsg(r.draft || "");
    setSources(Array.isArray(r.sources) ? r.sources : []);
  };

  return (
    <div className="inline-form" style={{ margin: "4px 0 10px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div className="lbl" style={{ flex: 1 }}>Feedback to {faction.name} — {reviewMonth}{sent ? ` · already delivered by ${faction.feedbackSent.by}` : ""}</div>
        <button className="act" disabled={busy || drafting} onClick={draft}>{drafting ? "Drafting…" : "✦ Draft from this month's review"}</button>
      </div>
      {!hasReview && <div style={{ fontSize: 11.5, color: "var(--amber)" }}>No team-lead review for {reviewMonth} yet — the feedback is recorded against it, so submit the review first.</div>}
      <textarea rows={6} placeholder="Message sent to the faction's Command channel…" value={msg} onChange={e => setMsg(e.target.value)} />
      {sources && (
        <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
          <div style={{ fontFamily: "var(--v2-mono)", fontSize: 9, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 3 }}>Built from</div>
          {sources.length === 0 ? <div>Nothing recorded for {reviewMonth} yet.</div> : (
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {sources.map((s, i) => <li key={i}>{typeof s === "string" ? s : [s.kind || s.label, s.detail || s.value || s.text].filter(Boolean).join(": ")}</li>)}
            </ul>
          )}
        </div>
      )}
      {err && <div className="err">{err}</div>}
      <div className="row-btns">
        <button className="act primary" disabled={busy || !msg.trim() || !hasReview} onClick={() => { if (window.confirm(`Send this feedback to ${faction.name}'s Command channel?`)) run(() => sendFeedbackToFaction(faction.id, msg), () => { setMsg(""); onDone?.(); }); }}>Send to faction</button>
        <button className="act" disabled={busy || !hasReview || sent} onClick={() => run(() => markFeedbackSent(faction.id), onDone)}>Mark sent manually</button>
        <button className="act" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
