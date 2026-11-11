"use client";
import { useState } from "react";
import { verifyRPChange } from "../../fm/operations/actions.js";

/* Days-old badge for queue rows. 7+ days is the "stale" threshold the weekly
   digest uses, so it is highlighted the same way here. */
export function AgeBadge({ days, overdue, since }) {
  const stale = days >= 7;
  const label = days === 0 ? "today" : days === 1 ? "1 day" : `${days} days`;
  const color = overdue || stale ? "var(--rose)" : days >= 3 ? "var(--amber)" : "var(--ink-3)";
  const bg = overdue || stale ? "var(--rose-bg)" : days >= 3 ? "var(--amber-bg)" : "var(--panel-2)";
  return <span className="chip" title={since ? `Since ${String(since).slice(0, 10)}` : undefined} style={{ background: bg, color, border: `1px solid ${overdue || stale ? "transparent" : "var(--line)"}` }}>{overdue ? `⚠ ${label}` : label}</span>;
}

/*
 * "Verify in game": the requesting lead (or L3) confirms an EXECUTED RP change
 * really landed in game. A flag, not a status — pending_executions.verified_at /
 * verified_by are set once. `exec` needs { id, requester_id, verified_at }.
 * Renders nothing when the viewer may not verify or the row is already verified.
 */
export default function VerifyInGame({ exec, auth, busy, run, onDone, compact = false }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const canVerify = !exec?.verified_at && (auth?.level >= 3 || (exec?.requester_id && exec.requester_id === auth?.id));
  if (exec?.verified_at) return <span style={{ fontSize: 11, color: "var(--good)", fontStyle: "italic" }}>Verified in game by {exec.verified_by}</span>;
  if (!canVerify) return <span style={{ fontSize: 11, color: "var(--sky)", fontStyle: "italic" }}>Waiting for {exec?.requested_by || "the requester"} to verify in game.</span>;
  return (
    <>
      <button className="act good" disabled={busy} onClick={() => setOpen(o => !o)} title="Confirm this change is live in game">Verify in game</button>
      {open && (
        <div className="inline-form" style={{ flexBasis: "100%", margin: compact ? "0 0 8px" : "0 2px 12px" }}>
          <div className="lbl">Verification note (optional) — what you checked in game</div>
          <textarea rows={2} autoFocus value={note} onChange={e => setNote(e.target.value)} />
          <div className="row-btns">
            <button className="act primary" disabled={busy} onClick={async () => { const done = await run(() => verifyRPChange(exec.id, note.trim())); if (done !== false) { setOpen(false); setNote(""); onDone?.(); } }}>Confirm verified</button>
            <button className="act" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}
