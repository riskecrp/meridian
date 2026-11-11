"use client";
// The RP-change Execute flow (preview → confirm → commit), rebuilt from
// v2/leadership/ExecuteFlow.js with the v3 kit. getRPExecuteTarget runs the
// same executionPreview the commit runs, so the label and the write agree.
//
//   const exec = useExecuteFlow({ run, busy });
//   <Button onClick={() => exec.begin(rc)}>Execute</Button> … {exec.modals}
//
// `rc` is a pending_executions row ({ id, faction_name, execution_type, turf }).
// `run(fn)` is useAction().run — it toasts refusals and resolves true/false.
import { useState } from "react";
import { Modal, Field, useToast } from "../ui.js";
import { executeRPChange, getRPExecutionPreview } from "../../fm/operations/actions.js";
import { getRPExecuteTarget } from "../../v2/actions.js";

export function useExecuteFlow({ run, busy }) {
  const toast = useToast();
  const [npcExec, setNpcExec] = useState(null);
  const [execConfirm, setExecConfirm] = useState(null);

  const begin = async (rc) => {
    let t;
    try { t = await getRPExecuteTarget(rc.id); } catch (e) { toast(e?.message || "Could not load the execution preview.", "bad"); return; }
    const type = String(t?.type || rc.execution_type || "Other").toUpperCase();
    if (type === "NPC") { setNpcExec({ id: rc.id, factionName: rc.faction_name || rc.faction, npcName: "", npcPos: "", npcId: "", preview: t, picked: null, turf: t?.turf || rc.turf }); return; }
    if (!t?.ok) { toast(t?.error || "This request cannot be executed.", "bad"); return; }
    setExecConfirm({ id: rc.id, factionName: rc.faction_name || rc.faction, type, preview: t, shipmentPower: "" });
  };

  const modals = (
    <>
      {npcExec && (() => {
        const shown = npcExec.picked || npcExec.preview;
        const cands = npcExec.preview?.candidates || [];
        const needsPick = cands.length > 1 && !npcExec.npcId;
        const target = shown?.ok ? shown.target : null;
        return (
          <Modal title={`Execute NPC swap — ${npcExec.factionName}`} saveLabel="Execute" onClose={() => setNpcExec(null)}
            onSave={async () => {
              const data = { npcName: npcExec.npcName.trim(), npcPos: npcExec.npcPos.trim() };
              if (npcExec.npcId) data.npcId = Number(npcExec.npcId);
              const id = npcExec.id;
              const ok = await run(() => executeRPChange(id, data));
              if (ok !== false) setNpcExec(null);
            }}
            saveDisabled={busy || !shown?.ok || needsPick || !npcExec.npcName.trim() || !npcExec.npcPos.trim()}>
            {cands.length > 1 && (
              <Field label={`Which NPC? — ${cands.length} match “${npcExec.preview?.oldValue}” on ${npcExec.turf}`}>
                <select value={npcExec.npcId} onChange={async e => {
                  const npcId = e.target.value;
                  let picked = null;
                  if (npcId) { try { picked = await getRPExecutionPreview(npcExec.id, { npcId: Number(npcId) }); } catch (err) { picked = { ok: false, error: err?.message || "Could not check that NPC." }; } }
                  setNpcExec(x => x ? { ...x, npcId, picked } : x);
                }}>
                  <option value="">Select the NPC to rewrite…</option>
                  {cands.map(c => <option key={c.id} value={String(c.id)}>{c.name} ({c.npc_type}) — {c.turf}{c.position ? ` · ${c.position}` : ""}</option>)}
                </select>
              </Field>
            )}
            {target
              ? <div className="restricted">This rewrites the live NPC: <b>{target.name}</b> ({target.npc_type}) on <b>{target.turf}</b>{target.position ? <> — currently at {target.position}</> : null} → type <b>{npcExec.preview?.newValue}</b>.</div>
              : needsPick
                ? <div className="restricted">Pick the NPC above — the request matches more than one, and nothing is rewritten until you choose.</div>
                : <div className="err">⚠ {shown?.error || `No NPC in the registry matches turf “${npcExec.turf}” with the old type — executing would change nothing.`}</div>}
            <Field label="Final NPC name"><input value={npcExec.npcName} onChange={e => setNpcExec({ ...npcExec, npcName: e.target.value })} /></Field>
            <Field label="TP position"><input value={npcExec.npcPos} onChange={e => setNpcExec({ ...npcExec, npcPos: e.target.value })} /></Field>
          </Modal>
        );
      })()}
      {execConfirm && (
        <Modal title={`Execute ${execConfirm.type === "OTHER" ? "" : execConfirm.type + " "}change — ${execConfirm.factionName}`} saveLabel="Execute" onClose={() => setExecConfirm(null)}
          onSave={async () => {
            const data = {};
            if (execConfirm.type === "TURF" && execConfirm.shipmentPower.trim()) data.shipmentPower = execConfirm.shipmentPower.trim();
            const id = execConfirm.id;
            const ok = await run(() => executeRPChange(id, data));
            if (ok !== false) setExecConfirm(null);
          }}
          saveDisabled={busy}>
          <div className="small">{execConfirm.preview.oldValue} → <b>{execConfirm.preview.newValue}</b></div>
          <div className="restricted">{execConfirm.preview.summary}</div>
          {execConfirm.type === "TURF" && execConfirm.preview.mode === "turf" && (
            <Field label="Shipment power (optional — blank keeps the current value)"><input value={execConfirm.shipmentPower} onChange={e => setExecConfirm({ ...execConfirm, shipmentPower: e.target.value })} /></Field>
          )}
          {execConfirm.type === "OTHER" && <div className="faint tiny">Type “Other” — no world records are rewritten; the request is marked executed and logged.</div>}
        </Modal>
      )}
    </>
  );

  return { begin, modals };
}
