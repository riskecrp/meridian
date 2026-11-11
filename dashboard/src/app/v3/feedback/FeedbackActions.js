"use client";
// Shared by Comms › Community feedback and /v3/feedback/[id]: status labels and
// the action buttons (the same steps as the thread buttons in #fm-feedback:
// acknowledge, complete, cancel, snooze, reopen). fm/feedback/actions.js gates at L2.
import { acknowledgeFeedback, completeFeedback, cancelFeedback, snoozeFeedback, reopenFeedback } from "../../fm/feedback/actions.js";
import { Badge, Button, useAction } from "../ui.js";

export const STATUS_META = {
  new:       { label: "Pending Acknowledgement", tone: "accent" },
  claimed:   { label: "Pending Review",          tone: "warn" },
  completed: { label: "Completed",               tone: "good" },
  cancelled: { label: "Cancelled",               tone: undefined },
};
export const STATUS_ORDER = ["new", "claimed", "completed", "cancelled"];
export const ENDED = (s) => s === "completed" || s === "cancelled";

export function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.new;
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

/** The action buttons for one item, used by the list and the detail page. */
export function FeedbackActions({ item, onDone }) {
  const { run, busy } = useAction();
  const ended = ENDED(item.status);
  const go = (fn, success, confirmText) => (e) => {
    e?.stopPropagation?.();
    if (confirmText && !window.confirm(confirmText)) return;
    run(fn, { success, onDone });
  };
  return (
    <span className="actions-inline">
      {item.status === "new" && <Button size="sm" disabled={busy} onClick={go(() => acknowledgeFeedback(item.id), "Acknowledged.")} title="The submitter has been contacted">Acknowledge</Button>}
      {!ended && <Button size="sm" variant="good" disabled={busy} onClick={go(() => completeFeedback(item.id), "Marked completed.", "Mark this feedback completed?")}>Complete</Button>}
      {!ended && <Button size="sm" variant="ghost" disabled={busy} onClick={go(() => snoozeFeedback(item.id), "Snoozed for 7 days.")} title="Push the next reminder out 7 days">Snooze</Button>}
      {!ended && <Button size="sm" variant="danger ghost" disabled={busy} onClick={go(() => cancelFeedback(item.id), "Cancelled.", "Cancel this feedback item?")}>Cancel</Button>}
      {ended && <Button size="sm" variant="ghost" disabled={busy} onClick={go(() => reopenFeedback(item.id), "Reopened.")}>Reopen</Button>}
    </span>
  );
}
