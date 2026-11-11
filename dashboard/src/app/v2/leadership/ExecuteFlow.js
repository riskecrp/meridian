"use client";
import { useState } from "react";
import Modal from "../Modal.js";
import { executeRPChange, getRPExecutionPreview } from "../../fm/operations/actions.js";
import { getRPExecuteTarget } from "../actions.js";

/*
 * The RP-change Execute flow (preview → confirm → commit), shared by the
 * Approvals tab and the Queue tab so both show exactly what the execute will
 * rewrite before committing. getRPExecuteTarget is shared/rpChanges.js
 * executionPreview — the same lookup executeRPChange runs — so the label and
 * the commit agree.
 *
 *   const exec = useExecuteFlow({ run, busy, setErr });
 *   <button onClick={() => exec.begin(rc)}>Execute</button> … {exec.modals}
 *
 * `rc` is a pending_executions row ({ id, faction_name, execution_type, turf }).
 */
export function useExecuteFlow({ run, busy, setErr }) {
  const [npcExec, setNpcExec] = useState(null); // {id, factionName, npcName, npcPos, npcId, preview, picked, turf}
  const [execConfirm, setExecConfirm] = useState(null); // {id, factionName, type, preview, shipmentPower} — HQ / TURF / PROPERTY / Other

  const begin = async (rc) => {
    setErr("");
    let t;
    try { t = await getRPExecuteTarget(rc.id); } catch (e) { setErr(e?.message || "Could not load the execution preview."); return; }
    const type = String(t?.type || rc.execution_type || "Other").toUpperCase();
    if (type === "NPC") { setNpcExec({ id: rc.id, factionName: rc.faction_name, npcName: "", npcPos: "", npcId: "", preview: t, picked: null, turf: t?.turf || rc.turf }); return; }
    if (!t?.ok) { setErr(t?.error || "This request cannot be executed."); return; }
    setExecConfirm({ id: rc.id, factionName: rc.faction_name, type, preview: t, shipmentPower: "" });
  };

  const modals = (
    <>
      {npcExec && (() => {
        // `preview` is the server's answer for the request as filed; `picked` is the
        // re-check for the NPC chosen when several match (ambiguous turf + type).
        const shown = npcExec.picked || npcExec.preview;
        const cands = npcExec.preview?.candidates || [];
        const needsPick = cands.length > 1 && !npcExec.npcId;
        const target = shown?.ok ? shown.target : null;
        return (
          <Modal title={`Execute NPC swap — ${npcExec.factionName}`} saveLabel="Execute" onClose={() => setNpcExec(null)}
            onSave={async () => {
              const data = { npcName: npcExec.npcName.trim(), npcPos: npcExec.npcPos.trim() };
              if (npcExec.npcId) data.npcId = Number(npcExec.npcId);
              const exec = npcExec;
              await run(() => executeRPChange(exec.id, data));
              setNpcExec(null);
            }}
            saveDisabled={busy || !shown?.ok || needsPick || !npcExec.npcName.trim() || !npcExec.npcPos.trim()}>
            {cands.length > 1 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--ink-3)", marginBottom: 4 }}>Which NPC? — {cands.length} match “{npcExec.preview?.oldValue}” on {npcExec.turf}</div>
                <select className="filter-inp" style={{ width: "100%" }} value={npcExec.npcId} onChange={async e => {
                  const npcId = e.target.value;
                  let picked = null;
                  if (npcId) { try { picked = await getRPExecutionPreview(npcExec.id, { npcId: Number(npcId) }); } catch (err) { picked = { ok: false, error: err?.message || "Could not check that NPC." }; } }
                  setNpcExec(x => x ? { ...x, npcId, picked } : x);
                }}>
                  <option value="">Select the NPC to rewrite…</option>
                  {cands.map(c => <option key={c.id} value={String(c.id)}>{c.name} ({c.npc_type}) — {c.turf}{c.position ? ` · ${c.position}` : ""}</option>)}
                </select>
              </div>
            )}
            {target
              ? <div style={{ padding: "8px 12px", borderRadius: 8, background: "var(--amber-bg)", fontSize: 12.5, color: "var(--amber)" }}>
                  This rewrites the live NPC: <b>{target.name}</b> ({target.npc_type}) on <b>{target.turf}</b>{target.position ? <> — currently at {target.position}</> : null} → type <b>{npcExec.preview?.newValue}</b>.
                </div>
              : needsPick
                ? <div style={{ padding: "8px 12px", borderRadius: 8, background: "var(--amber-bg)", fontSize: 12.5, color: "var(--amber)" }}>Pick the NPC above — the request matches more than one, and nothing is rewritten until you choose.</div>
                : <div style={{ padding: "8px 12px", borderRadius: 8, background: "var(--rose-bg)", fontSize: 12.5, color: "var(--rose)" }}>
                    ⚠ {shown?.error || `No NPC in the registry matches turf “${npcExec.turf}” with the old type — executing would change nothing.`}
                  </div>}
            <input className="filter-inp" placeholder="Final NPC name" value={npcExec.npcName} onChange={e => setNpcExec({ ...npcExec, npcName: e.target.value })} />
            <input className="filter-inp" placeholder="TP position" value={npcExec.npcPos} onChange={e => setNpcExec({ ...npcExec, npcPos: e.target.value })} />
          </Modal>
        );
      })()}
      {execConfirm && (
        <Modal title={`Execute ${execConfirm.type === "OTHER" ? "" : execConfirm.type + " "}change — ${execConfirm.factionName}`} saveLabel="Execute" onClose={() => setExecConfirm(null)}
          onSave={async () => {
            const data = {};
            if (execConfirm.type === "TURF" && execConfirm.shipmentPower.trim()) data.shipmentPower = execConfirm.shipmentPower.trim();
            const exec = execConfirm;
            await run(() => executeRPChange(exec.id, data));
            setExecConfirm(null);
          }}
          saveDisabled={busy}>
          <div style={{ fontSize: 12.5, color: "var(--ink-1)" }}>{execConfirm.preview.oldValue} → <b>{execConfirm.preview.newValue}</b></div>
          <div style={{ padding: "8px 12px", borderRadius: 8, background: "var(--amber-bg)", fontSize: 12.5, color: "var(--amber)" }}>{execConfirm.preview.summary}</div>
          {execConfirm.type === "TURF" && execConfirm.preview.mode === "turf" && (
            <input className="filter-inp" placeholder="Shipment power (optional — blank keeps the current value)" value={execConfirm.shipmentPower} onChange={e => setExecConfirm({ ...execConfirm, shipmentPower: e.target.value })} />
          )}
          {execConfirm.type === "OTHER" && <div style={{ fontSize: 11, color: "var(--ink-3)" }}>Type “Other” — no world records are rewritten; the request is marked executed and logged.</div>}
        </Modal>
      )}
    </>
  );

  return { begin, modals };
}
