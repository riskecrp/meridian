"use client";
import { acknowledgeFeedback, completeFeedback, cancelFeedback, snoozeFeedback, reopenFeedback } from "../../fm/feedback/actions";
import { useRun } from "../hooks.js";

// Shared by the /v2/feedback list and detail pages: status labels and the
// action buttons (the same steps as the thread buttons in #fm-feedback).
export const STATUS_META = {
  new:       { label: "Pending Acknowledgement", color: "var(--accent)", dot: "●" },
  claimed:   { label: "Pending Review",          color: "var(--amber)",  dot: "●" },
  completed: { label: "Completed",               color: "var(--good)",   dot: "●" },
  cancelled: { label: "Cancelled",               color: "var(--ink-3)",  dot: "○" },
};
const FILTERS = ["new", "claimed", "completed", "cancelled"];

/** The action buttons for one item, used by the list and the detail page. */
export function FeedbackActions({ item, onDone, compact = false }) {
  const { busy, err, run } = useRun();
  const ended = item.status === "completed" || item.status === "cancelled";
  const go = (fn, confirmText) => () => { if (confirmText && !window.confirm(confirmText)) return; run(fn, onDone); };
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", alignItems: "center" }} onClick={e => e.stopPropagation()}>
      {item.status === "new" && <button className="act primary" disabled={busy} onClick={go(() => acknowledgeFeedback(item.id))} title="The submitter has been contacted">Acknowledge</button>}
      {!ended && <button className="act good" disabled={busy} onClick={go(() => completeFeedback(item.id), "Mark this feedback completed?")}>Complete</button>}
      {!ended && <button className="act" disabled={busy} onClick={go(() => snoozeFeedback(item.id))} title="Push the next reminder out 7 days">Snooze</button>}
      {!ended && <button className="act warn" disabled={busy} onClick={go(() => cancelFeedback(item.id), "Cancel this feedback item?")}>Cancel</button>}
      {ended && <button className="act" disabled={busy} onClick={go(() => reopenFeedback(item.id))}>Reopen</button>}
      {err && <span className="err" style={{ fontSize: compact ? 10.5 : 12 }}>{err}</span>}
    </span>
  );
}

