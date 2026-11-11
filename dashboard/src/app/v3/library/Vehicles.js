"use client";
// Library › Vehicle Catalog. Reading is for every staff member (and ET/LST);
// create / edit / delete and "+ Faction" (push into a garage within the tier
// limits) are L3, on the server as well as here. "In use" = factions holding
// it · vehicles in circulation, computed live from the garages.
import { useEffect, useMemo, useState } from "react";
import { listCatalog, createCatalogEntry, updateCatalogEntry, deleteCatalogEntry, listFactionsForAdd, addCatalogVehicleToFaction } from "../../fm/operations/vehicles/actions.js";
import { Card, Button, Field, Empty, Modal, useAction, useToast } from "../ui.js";
import { useCopy, CopyButton, confirmIt } from "./shared.js";

const BLANK = { vehicle_name: "", spawn_name: "", notes: "" };

export default function Vehicles({ auth, initialQ = "" }) {
  const canEdit = (auth.level || 0) >= 3;
  const [rows, setRows] = useState(null);
  const [factions, setFactions] = useState([]);
  const [loadErr, setLoadErr] = useState("");
  const [q, setQ] = useState(initialQ);
  const [form, setForm] = useState(null);     // { id?, ...BLANK }
  const [addTo, setAddTo] = useState(null);   // { row, faction, qty }
  const [copied, copy] = useCopy();
  const { run, busy } = useAction();
  const toast = useToast();

  // listFactionsForAdd is L3-only — read-only viewers skip it so they don't trip the clearance check.
  const load = async () => {
    try { const [c, f] = await Promise.all([listCatalog(), canEdit ? listFactionsForAdd() : Promise.resolve([])]); setRows(c || []); setFactions(f || []); setLoadErr(""); }
    catch (e) { setRows([]); setLoadErr(e?.message || "Could not load the catalog."); }
  };
  useEffect(() => { load(); }, [canEdit]);
  useEffect(() => { if (initialQ) setQ(initialQ); }, [initialQ]);

  const shown = useMemo(() => (rows || []).filter(r => !q || (r.vehicle_name || "").toLowerCase().includes(q.toLowerCase()) || (r.spawn_name || "").toLowerCase().includes(q.toLowerCase())), [rows, q]);

  const save = () => run(() => form.id ? updateCatalogEntry(form.id, form) : createCatalogEntry(form), {
    onDone: (r) => {
      const extra = form.id && (r?.renamedRows || r?.respawnedRows) ? ` ${r.renamedRows || 0} garage row(s) renamed, ${r.respawnedRows || 0} re-spawned.` : "";
      toast(`${form.id ? "Vehicle saved." : "Vehicle added to the catalog."}${extra}`, "good"); setForm(null); load();
    },
  });
  const remove = (r) => { if (!confirmIt(`Delete “${r.vehicle_name}” from the catalog?`)) return; run(() => deleteCatalogEntry(r.id), { success: "Vehicle removed from the catalog.", onDone: load }); };
  const submitAdd = () => run(() => addCatalogVehicleToFaction(addTo.row.id, parseInt(addTo.faction), parseInt(addTo.qty) || 1), {
    onDone: (r) => { toast(`Added ${r.added}x ${r.vehicle} to ${r.faction}. Garage now ${r.newTotal}/${r.limits?.max_total ?? "?"}.`, "good"); setAddTo(null); load(); },
  });

  if (rows === null) return <div className="stack"><div className="skeleton row" /><div className="skeleton block" /></div>;

  return (
    <div className="stack">
      <div className="row">
        <input className="inp grow" placeholder="Search by vehicle or spawn name…" value={q} onChange={e => setQ(e.target.value)} />
        <span className="tiny faint mono">{shown.length} of {rows.length}</span>
        {canEdit && <Button onClick={() => setForm({ ...BLANK })}>New vehicle +</Button>}
      </div>
      {loadErr && <div className="err">{loadErr}</div>}
      {shown.length === 0 ? <Empty title="No vehicles match">{canEdit ? "Add one with “New vehicle +”." : "Try another name."}</Empty> : (
        <Card flush>
          <div className="tblwrap">
            <table className="tbl">
              <thead><tr><th>Name</th><th>Spawn</th><th className="num" title="Factions with it in a garage · vehicles in circulation">In use</th><th className="hide-sm">Notes</th>{canEdit && <th></th>}</tr></thead>
              <tbody>
                {shown.map(r => (
                  <tr key={r.id}>
                    <td><b>{r.vehicle_name}</b></td>
                    <td>{r.spawn_name ? <CopyButton text={r.spawn_name} id={r.id} copied={copied} copy={copy} label={r.spawn_name} title="Copy spawn name" /> : <span className="faint">—</span>}</td>
                    <td className={`num${(r.in_circulation || 0) > 0 ? "" : " faint"}`}>{r.factions_using || 0} · {r.in_circulation || 0}</td>
                    <td className="hide-sm muted small">{r.notes || ""}</td>
                    {canEdit && (
                      <td className="num">
                        <span className="actions-inline right">
                          <Button variant="ghost" size="sm" title="Add to a faction garage" onClick={() => setAddTo({ row: r, faction: "", qty: 1 })}>+ Faction</Button>
                          <Button variant="ghost" size="sm" onClick={() => setForm({ id: r.id, vehicle_name: r.vehicle_name, spawn_name: r.spawn_name || "", notes: r.notes || "" })}>Edit</Button>
                          <Button variant="danger ghost" size="sm" disabled={busy} onClick={() => remove(r)}>×</Button>
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {form && (
        <Modal title={form.id ? `Edit ${form.vehicle_name || "vehicle"}` : "New vehicle"} onClose={() => setForm(null)} onSave={save} saveLabel={form.id ? "Save" : "Create"} saveDisabled={busy || !form.vehicle_name.trim()}>
          <Field label="Display name" help="e.g. Caracara"><input value={form.vehicle_name} onChange={e => setForm({ ...form, vehicle_name: e.target.value })} /></Field>
          <Field label="Spawn name" help="e.g. caracara — garage rows that still carry the old catalog spawn follow a change."><input className="mono" value={form.spawn_name} onChange={e => setForm({ ...form, spawn_name: e.target.value })} /></Field>
          <Field label="Notes (optional)"><textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
        </Modal>
      )}
      {addTo && (
        <Modal title="Add to faction garage" onClose={() => setAddTo(null)} onSave={submitAdd} saveLabel={busy ? "Adding…" : "Add to faction"} saveDisabled={busy || !addTo.faction}>
          <div><b>{addTo.row.vehicle_name}</b> <span className="mono tiny faint">{addTo.row.spawn_name || "(no spawn name set)"}</span></div>
          <Field label="Faction">
            <select value={addTo.faction} onChange={e => setAddTo({ ...addTo, faction: e.target.value })}>
              <option value="">Select faction…</option>
              {factions.map(f => <option key={f.id} value={f.id}>T{f.tier} · {f.name}</option>)}
            </select>
          </Field>
          <Field label="Quantity" help="Rejected if it would exceed the faction's tier limits (or override)."><input type="number" min="1" max="50" value={addTo.qty} onChange={e => setAddTo({ ...addTo, qty: parseInt(e.target.value) || 1 })} /></Field>
        </Modal>
      )}
    </div>
  );
}
