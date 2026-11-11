"use client";
import { useState } from "react";
import { deleteFactionProperty } from "../../../fm/factions/actions.js";
import { addFleetVehicle, deleteFleetVehicle, addFleetGarage, deleteFleetGarage, setFleetOverride, clearFleetOverride } from "../../../fm/operations/actions.js";
import { Card, Badge, Button, Empty, Modal, Field, useAction, useToast } from "../../ui.js";
import { money } from "../shared.js";

function CapBar({ label, used, max }) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return <div className="cap"><span className="lbl">{label}</span><span className="bar"><span className={`fill${used >= max && max > 0 ? " full" : ""}`} style={{ width: `${pct}%` }} /></span><span className="num"><b>{used}</b> / {max}</span></div>;
}

/* Fleet: L3 manages vehicles, garages and cap overrides (getFleetOverview);
   everyone else reads the counts against the effective limits (getFactionFleetSummary). */
function FleetCard({ hub }) {
  const { detail, fleet, fleetSum, tierDefaults, isL3, archived, reload } = hub;
  const td = tierDefaults[detail.tier] || {};
  const { run, busy } = useAction();
  const toast = useToast();
  const [form, setForm] = useState(null);
  const manage = isL3 && !archived && fleet;
  const sum = fleet ? { types: fleet.typeCount, total: fleet.totalQuantity, garages: fleet.garages.length, limits: fleet.limits, stipend: fleet.defaults.stipend }
    : { types: fleetSum?.typeCount ?? 0, total: fleetSum?.totalQuantity ?? 0, garages: fleetSum?.garageCount ?? 0, limits: fleetSum?.limits || { maxTypes: td.types ?? 0, maxTotal: td.total ?? 0, maxGarages: td.garages ?? 0, isOverridden: false }, stipend: fleetSum?.stipend ?? td.stipend };
  const done = (msg) => ({ success: msg, onDone: async () => { setForm(null); await reload(); } });
  return (
    <Card title="Fleet" right={<span className="muted small">Tier {detail.tier} allowance{sum.limits.isOverridden && <> · <Badge tone="lock">override</Badge></>}</span>}>
      <CapBar label="Vehicle types" used={sum.types} max={sum.limits.maxTypes} />
      <CapBar label="Total vehicles" used={sum.total} max={sum.limits.maxTotal} />
      <CapBar label="Garages" used={sum.garages} max={sum.limits.maxGarages} />
      <div className="cap"><span className="lbl">Stipend</span><span className="num" style={{ textAlign: "left", flex: 1 }}><b>{money(sum.stipend)}</b>/mo</span></div>
      {fleet ? <>
        <div className="grp">Vehicles</div>
        {fleet.vehicles.length === 0 ? <Empty>No vehicles.</Empty> : <div className="list">{fleet.vehicles.map(v => <div className="li" key={v.id}><div className="body"><div className="t"><span className="mono">{v.quantity}×</span> {v.vehicle_name}</div>{v.notes && <div className="d">{v.notes}</div>}</div>{manage && <div className="side"><Button size="sm" variant="danger ghost" disabled={busy} onClick={() => { if (window.confirm(`Remove ${v.vehicle_name} from the fleet?`)) run(() => deleteFleetVehicle(v.id), done("Vehicle removed.")); }}>Remove</Button></div>}</div>)}</div>}
        <div className="grp">Garages</div>
        {fleet.garages.length === 0 ? <Empty>No garages.</Empty> : <div className="list">{fleet.garages.map(g => <div className="li" key={g.id}><div className="body"><div className="t">{g.name}</div><div className="d mono tiny">({g.x}, {g.y}, {g.z})</div></div>{manage && <div className="side"><Button size="sm" variant="danger ghost" disabled={busy} onClick={() => { if (window.confirm(`Remove garage ${g.name}?`)) run(() => deleteFleetGarage(g.id), done("Garage removed.")); }}>Remove</Button></div>}</div>)}</div>}
        {manage && <div className="actions-inline" style={{ paddingTop: 10 }}>
          <Button size="sm" onClick={() => setForm({ kind: "veh", vname: "", qty: "1" })}>+ Vehicle</Button>
          <Button size="sm" variant="ghost" onClick={() => setForm({ kind: "gar", gname: "", x: "", y: "", z: "" })}>+ Garage</Button>
          {fleet.limits.isOverridden
            ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => clearFleetOverride(detail.id), done("Override cleared — tier defaults apply."))}>Clear override</Button>
            : <Button size="sm" variant="ghost" onClick={() => setForm({ kind: "ovr", mt: fleet.limits.maxTypes, mtot: fleet.limits.maxTotal, mg: fleet.limits.maxGarages, reason: "" })}>Override caps</Button>}
        </div>}
      </> : <div className="hint" style={{ paddingTop: 8 }}>Fleet inventory is managed by leadership (L3).</div>}

      {form?.kind === "veh" && <Modal title="Add vehicle" onClose={() => setForm(null)} saveDisabled={busy || !form.vname.trim()}
        onSave={() => { const vname = form.vname.trim(), qty = parseInt(form.qty) || 1; run(() => addFleetVehicle(detail.id, vname, qty, ""), { success: "Vehicle added.", onDone: async (r) => { if (r?.merged) toast(`"${vname}" was already in this fleet — the ${qty} were added to the existing entry.`); setForm(null); await reload(); } }); }}>
        <Field label="Vehicle name"><input autoFocus value={form.vname} onChange={e => setForm({ ...form, vname: e.target.value })} /></Field>
        <Field label="Quantity"><input value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} /></Field>
      </Modal>}
      {form?.kind === "gar" && <Modal title="Add garage" onClose={() => setForm(null)} saveDisabled={busy || !form.gname.trim()}
        onSave={() => run(() => addFleetGarage(detail.id, form.gname.trim(), form.x, form.y, form.z, ""), done("Garage added."))}>
        <Field label="Garage name"><input autoFocus value={form.gname} onChange={e => setForm({ ...form, gname: e.target.value })} /></Field>
        <div className="form-grid">{["x", "y", "z"].map(a => <Field key={a} label={a.toUpperCase()}><input value={form[a]} onChange={e => setForm({ ...form, [a]: e.target.value })} /></Field>)}</div>
      </Modal>}
      {form?.kind === "ovr" && <Modal title="Override fleet caps" onClose={() => setForm(null)} saveDisabled={busy || !String(form.reason).trim()}
        onSave={() => run(() => setFleetOverride(detail.id, parseInt(form.mt), parseInt(form.mtot), parseInt(form.mg), form.reason), done("Caps overridden."))}>
        <div className="form-grid">
          <Field label="Types"><input value={form.mt} onChange={e => setForm({ ...form, mt: e.target.value })} /></Field>
          <Field label="Total"><input value={form.mtot} onChange={e => setForm({ ...form, mtot: e.target.value })} /></Field>
          <Field label="Garages"><input value={form.mg} onChange={e => setForm({ ...form, mg: e.target.value })} /></Field>
        </div>
        <Field label="Reason" help="Required — written to the faction's history."><input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} /></Field>
      </Modal>}
    </Card>
  );
}

/* Treasury: what the existing actions expose — the monthly stipend for the
   tier and the rewards handed out on logged scenes (each cash reward is also a
   treasury_logs row). A per-faction ledger read is requested in the handoff. */
function TreasuryCard({ hub }) {
  const { detail, fleetSum, tierDefaults } = hub;
  const td = tierDefaults[detail.tier] || {};
  const stipend = fleetSum ? fleetSum.stipend : td.stipend;
  const rewarded = detail.sceneLogs.filter(l => l.rewards && l.rewards !== "None");
  return (
    <Card title="Treasury" right={<span className="muted small">stipend + scene rewards</span>}>
      <div className="kv">
        <div><div className="k">Monthly stipend</div><div className="v mono">{stipend != null ? money(stipend) : "—"}</div></div>
        <div><div className="k">Rewarded scenes</div><div className="v mono">{rewarded.length} <span className="faint small" style={{ fontFamily: "var(--sans)", fontWeight: 400 }}>of last {detail.sceneLogs.length}</span></div></div>
      </div>
      <div className="grp">Recent rewards</div>
      {rewarded.length === 0 ? <Empty>No rewards on the recent scenes.</Empty> : <div className="list">{rewarded.slice(0, 8).map(l => <div className="li" key={l.id}><div className="body"><div className="t small">{l.rewards}</div><div className="d">{l.date} · {l.logged_by}</div></div></div>)}</div>}
    </Card>
  );
}

export default function Assets({ hub }) {
  const { detail, level, canWrite, setModal, reload } = hub;
  const { run, busy } = useAction();
  const manage = level >= 2 && canWrite;
  return (
    <div className="stack">
      <Card flush title="Properties" right={manage
        ? <span className="actions-inline"><Button size="sm" variant="ghost" onClick={() => setModal({ kind: "rp" })}>Request change</Button><Button size="sm" onClick={() => setModal({ kind: "prop" })}>+ Add property</Button></span>
        : <span className="faint small">team leads manage</span>}>
        {detail.properties.length === 0 ? <div style={{ padding: "0 16px 16px" }}><Empty title="No properties on file.">{manage ? "Add one, or request a change through the RP queue." : null}</Empty></div> : (
          <div className="tblwrap">
            <table className="tbl">
              <thead><tr><th>Address</th><th>Type</th><th></th>{manage && <th></th>}</tr></thead>
              <tbody>
                {detail.properties.map(p => (
                  <tr key={p.id}>
                    <td><b>{p.address}</b></td>
                    <td className="muted">{p.property_type || "Property"}</td>
                    <td>{p.isHQ && <Badge tone="lock">HQ</Badge>}</td>
                    {manage && <td><span className="actions-inline"><Button size="sm" variant="ghost" onClick={() => setModal({ kind: "prop", prop: p })}>Edit</Button><Button size="sm" variant="danger ghost" disabled={busy} onClick={() => { if (window.confirm(`Remove ${p.address} from ${detail.name}?`)) run(() => deleteFactionProperty(p.id), { success: "Property removed.", onDone: reload }); }}>Remove</Button></span></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="grid two">
        <FleetCard hub={hub} />
        <TreasuryCard hub={hub} />
      </div>
    </div>
  );
}
