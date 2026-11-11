"use client";
// "Verify in game": the requesting lead (or L3) confirms an EXECUTED RP change
// really landed in game (pending_executions.verified_at / verified_by, set
// once). Rebuilt from v2/leadership/VerifyInGame.js with the kit. `exec` needs
// { id, requester_id, requested_by, verified_at, verified_by }; `run` is
// useAction().run. Renders a note when the viewer may not verify.
import { useState } from "react";
import { Button } from "../ui.js";
import { verifyRPChange } from "../../fm/operations/actions.js";
import { InlineForm } from "./shared.js";

export default function VerifyInGame({ exec, auth, busy, run, onDone }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const canVerify = !exec?.verified_at && ((auth?.level || 0) >= 3 || (exec?.requester_id && exec.requester_id === auth?.id));
  if (exec?.verified_at) return <span className="tiny tx-good">Verified in game by {exec.verified_by}</span>;
  if (!canVerify) return <span className="tiny muted">Waiting for {exec?.requested_by || "the requester"} to verify in game.</span>;
  return (
    <>
      <Button size="sm" variant="good" disabled={busy} onClick={() => setOpen(o => !o)} title="Confirm this change is live in game">Verify in game</Button>
      {open && (
        <InlineForm label="Verification note (optional) — what you checked in game" busy={busy} confirmLabel="Confirm verified"
          onCancel={() => setOpen(false)}
          onConfirm={async () => { const ok = await run(() => verifyRPChange(exec.id, note.trim()), { success: "Verified in game." }); if (ok !== false) { setOpen(false); setNote(""); onDone?.(); } }}>
          <textarea rows={2} autoFocus value={note} onChange={e => setNote(e.target.value)} />
        </InlineForm>
      )}
    </>
  );
}
