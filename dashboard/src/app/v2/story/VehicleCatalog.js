"use client";
// Library › Vehicle Catalog. Moved here verbatim from admin/views/catalogs.js
// (2026-08-05) — it's reference material every staff member looks up, so it
// belongs with the rest of the Library. Reading is L1; the edit controls and
// "+ Faction" are still L3/Event Team, server-side as well as here.
import React, { useEffect, useState } from "react";
import { listCatalog, createCatalogEntry, updateCatalogEntry, deleteCatalogEntry, listFactionsForAdd, addCatalogVehicleToFaction } from "../../fm/operations/vehicles/actions.js";

const V_EMPTY = { vehicle_name: "", spawn_name: "", notes: "" };

export default function Vehicles({ canEdit }) {
  const [rows, setRows] = useState([]);
  const [factions, setFactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(V_EMPTY);
  const [copied, setCopied] = useState(null);
  const [addTo, setAddTo] = useState(null);
  const [addFaction, setAddFaction] = useState("");
  const [addQty, setAddQty] = useState(1);
  const [busy, setBusy] = useState(false);
  // listFactionsForAdd is L3/ET-only — read-only viewers skip it so they don't trip the clearance check
  const load = () => Promise.all([listCatalog(), canEdit ? listFactionsForAdd() : Promise.resolve([])]).then(([c, f]) => { setRows(c || []); setFactions(f || []); setLoading(false); });
  useEffect(() => { load(); }, []);
  if (loading) return <div className="empty">Loading…</div>;
  const shown = rows.filter(r => !q || (r.vehicle_name || "").toLowerCase().includes(q.toLowerCase()) || (r.spawn_name || "").toLowerCase().includes(q.toLowerCase()));
  const submit = async () => {
    const res = editing ? await updateCatalogEntry(editing.id, form) : await createCatalogEntry(form);
    if (!res.ok) { window.alert(res.error || "Failed"); return; }
    setShowNew(false); setEditing(null); setForm(V_EMPTY); load();
  };
  const remove = async (r) => {
    if (!window.confirm(`Delete "${r.vehicle_name}" from the catalog?`)) return;
    const res = await deleteCatalogEntry(r.id);
    if (!res.ok) { window.alert(res.error || "Failed"); return; }
    load();
  };
  const submitAdd = async () => {
    if (!addFaction) { window.alert("Pick a faction"); return; }
    setBusy(true);
    const res = await addCatalogVehicleToFaction(addTo.id, parseInt(addFaction), parseInt(addQty));
    setBusy(false);
    if (!res.ok) { window.alert(res.error || "Failed"); return; }
    window.alert(`Added ${res.added}x "${res.vehicle}" to ${res.faction}. New total: ${res.newTotal}/${res.limits.max_total}.`);
    setAddTo(null); load();
  };
  const fields = (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <input className="filter-inp" placeholder="Display name * (e.g. Caracara)" value={form.vehicle_name} onChange={e => setForm({ ...form, vehicle_name: e.target.value })} />
      <input className="filter-inp" placeholder="Spawn name (e.g. caracara)" value={form.spawn_name} onChange={e => setForm({ ...form, spawn_name: e.target.value })} style={{ fontFamily: "var(--v2-mono)" }} />
      <textarea className="filter-inp" rows={2} placeholder="Notes (optional)" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
    </div>
  );
  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
        <input className="filter-inp" placeholder="Search by vehicle or spawn name…" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 340 }} />
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--v2-mono)" }}>{shown.length} of {rows.length}</span>
        {canEdit && <button className="btn" onClick={() => { setEditing(null); setForm(V_EMPTY); setShowNew(true); }}>New vehicle +</button>}
      </div>
      {showNew && !editing && (
        <div className="card" style={{ border: "1px solid var(--line-2)", borderRadius: 10, padding: 14, marginBottom: 14 }}>
          <div style={{ fontWeight: 700, color: "var(--ink-0)", marginBottom: 10 }}>New vehicle</div>
          {fields}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
            <button className="act" onClick={() => { setShowNew(false); setForm(V_EMPTY); }}>Cancel</button>
            <button className="act primary" disabled={!form.vehicle_name.trim()} onClick={submit}>Create</button>
          </div>
        </div>
      )}
      <div className="card"><div style={{ overflowX: "auto" }}>
        <table className="dtable" style={{ minWidth: 560 }}>
          <thead><tr><th>Name</th><th>Spawn</th><th style={{ textAlign: "right" }}>Used</th>{canEdit && <th></th>}</tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={canEdit ? 4 : 3} style={{ color: "var(--ink-3)", fontStyle: "italic", textAlign: "center" }}>No vehicles match.</td></tr>}
            {shown.map(r => (
              <React.Fragment key={r.id}>
                <tr>
                  <td style={{ fontWeight: 700 }} title={r.notes || r.vehicle_name}>{r.vehicle_name}</td>
                  <td>
                    {r.spawn_name ? (
                      <button className="act" style={{ padding: "1px 6px", fontFamily: "var(--v2-mono)", fontSize: 11, color: copied === r.id ? "var(--good)" : "var(--ink-2)" }} title="Click to copy spawn name"
                        onClick={() => { navigator.clipboard.writeText(r.spawn_name); setCopied(r.id); setTimeout(() => setCopied(null), 1500); }}>
                        {copied === r.id ? "✓ copied" : r.spawn_name}
                      </button>
                    ) : <span style={{ color: "var(--ink-3)" }}>—</span>}
                  </td>
                  <td style={{ textAlign: "right", fontFamily: "var(--v2-mono)", color: r.use_count > 0 ? "var(--ink-1)" : "var(--ink-3)" }}>{r.use_count || 0}</td>
                  {canEdit && (
                    <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                      <button className="act" style={{ padding: "2px 7px", color: "var(--accent)" }} title="Add to faction garage" onClick={() => { setAddTo(r); setAddFaction(""); setAddQty(1); }}>+ Faction</button>{" "}
                      <button className="act" style={{ padding: "2px 7px" }} onClick={() => { setShowNew(false); setEditing(r); setForm({ vehicle_name: r.vehicle_name, spawn_name: r.spawn_name || "", notes: r.notes || "" }); }}>Edit</button>{" "}
                      <button className="act" style={{ padding: "2px 7px", color: "var(--rose)" }} onClick={() => remove(r)}>×</button>
                    </td>
                  )}
                </tr>
                {editing?.id === r.id && (
                  <tr><td colSpan={4} style={{ background: "var(--panel-2)", borderLeft: "2px solid var(--accent)", padding: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", marginBottom: 8 }}>Editing #{r.id}</div>
                    {fields}
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                      <button className="act" onClick={() => { setEditing(null); setForm(V_EMPTY); }}>Cancel</button>
                      <button className="act primary" disabled={!form.vehicle_name.trim()} onClick={submit}>Save</button>
                    </div>
                  </td></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div></div>
      {addTo && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={() => !busy && setAddTo(null)} />
          <div style={{ position: "relative", width: "100%", maxWidth: 460, background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 12, padding: 18 }}>
            <div style={{ fontWeight: 700, color: "var(--ink-0)" }}>Add to faction garage</div>
            <div style={{ margin: "2px 0 14px" }}><span style={{ fontWeight: 700 }}>{addTo.vehicle_name}</span> <span style={{ fontFamily: "var(--v2-mono)", fontSize: 11, color: "var(--ink-3)" }}>{addTo.spawn_name || "(no spawn name set)"}</span></div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <select className="filter-inp" value={addFaction} onChange={e => setAddFaction(e.target.value)}>
                <option value="">Select faction…</option>
                {factions.map(f => <option key={f.id} value={f.id}>T{f.tier} · {f.name}</option>)}
              </select>
              <input className="filter-inp" type="number" min="1" max="50" value={addQty} onChange={e => setAddQty(parseInt(e.target.value) || 1)} />
              <div style={{ fontSize: 11, color: "var(--ink-3)" }}>Will be rejected if it would exceed the faction's tier limits (or override).</div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button className="act" disabled={busy} onClick={() => setAddTo(null)}>Cancel</button>
              <button className="act primary" disabled={busy || !addFaction} onClick={submitAdd}>{busy ? "Adding…" : "Add to faction"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
