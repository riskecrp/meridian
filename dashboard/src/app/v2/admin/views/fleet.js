"use client";
// Admin › Fleet (L3): every active faction's approved vehicles, garage
// spawnpoints and effective limits, with editing. Port of /fm/operations/fleet
// onto the v2 shell; the per-faction view in the hub Assets tab stays.
import { useEffect, useState } from "react";
import { getFleetOverview, getFleetTierDefaults, getVehicleCatalog, addFleetVehicle, editFleetVehicle, deleteFleetVehicle, addFleetGarage, editFleetGarage, deleteFleetGarage, setFleetOverride, clearFleetOverride } from "../../../fm/operations/actions.js";
import Modal from "../../Modal.js";
import { useCopy } from "../../hooks.js";

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const fmtCoord = (v) => num(v).toFixed(2);
const lbl = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--ink-3)", marginBottom: 4 };

// Run an action; `{ok:false}` or a throw becomes an alert instead of a silent close.
async function act(fn) {
  try {
    const r = await fn();
    if (r && r.ok === false) { window.alert(r.error || "Action failed."); return false; }
    return true;
  } catch (e) { window.alert(e?.message || "Action failed."); return false; }
}

export function Fleet() {
  const [rows, setRows] = useState([]);
  const [tiers, setTiers] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [exp, setExp] = useState(null);
  const [vehicleForm, setVehicleForm] = useState(null);   // { factionId, factionName, id?, vehicle_name, quantity, notes }
  const [garageForm, setGarageForm] = useState(null);     // { factionId, factionName, id?, name, coords, x, y, z, notes }
  const [overrideForm, setOverrideForm] = useState(null); // { factionId, factionName, maxTypes, maxTotal, maxGarages, reason }
  const [formErr, setFormErr] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [copied, copy] = useCopy();

  const load = async () => {
    setError("");
    try {
      const [d, t] = await Promise.all([getFleetOverview(), getFleetTierDefaults()]);
      setRows(d || []); setTiers(t || {});
    } catch (e) { setError(e?.message || "Could not load the fleet overview."); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);
  const refresh = async () => { try { setRows((await getFleetOverview()) || []); } catch (e) { setError(e?.message || "Reload failed."); } };

  if (loading) return <div className="empty">Loading…</div>;
  if (error) return <div className="empty" style={{ color: "var(--rose)" }}>{error}</div>;
  const shown = rows.filter(f => !q || f.name.toLowerCase().includes(q.toLowerCase()));

  const openVehicle = (f, v) => { setFormErr(""); setSuggestions([]); setVehicleForm(v ? { factionId: f.id, factionName: f.name, id: v.id, vehicle_name: v.vehicle_name, quantity: v.quantity, notes: v.notes || "" } : { factionId: f.id, factionName: f.name, id: null, vehicle_name: "", quantity: 1, notes: "" }); };
  const openGarage = (f, g) => { setFormErr(""); setGarageForm(g ? { factionId: f.id, factionName: f.name, id: g.id, name: g.name, coords: `${g.x}, ${g.y}, ${g.z}`, x: num(g.x), y: num(g.y), z: num(g.z), notes: g.notes || "" } : { factionId: f.id, factionName: f.name, id: null, name: "", coords: "", x: null, y: null, z: null, notes: "" }); };
  const openOverride = (f) => { setFormErr(""); setOverrideForm({ factionId: f.id, factionName: f.name, maxTypes: f.limits.maxTypes, maxTotal: f.limits.maxTotal, maxGarages: f.limits.maxGarages, reason: f.limits.isOverridden ? (f.limits.overrideReason || "") : "" }); };

  const saveVehicle = async () => {
    const e = vehicleForm;
    const name = (e.vehicle_name || "").trim();
    const qty = parseInt(e.quantity, 10);
    if (!name) { setFormErr("Vehicle name required."); return; }
    if (!Number.isInteger(qty) || qty < 1) { setFormErr("Quantity must be a whole number of at least 1."); return; }
    setFormErr("");
    let r;
    try { r = e.id ? await editFleetVehicle(e.id, qty, e.notes) : await addFleetVehicle(e.factionId, name, qty, e.notes); }
    catch (err) { setFormErr(err?.message || "Failed."); return; }
    if (!r?.ok) { setFormErr(r?.error || "Failed."); return; }
    setVehicleForm(null); refresh();
  };
  const saveGarage = async () => {
    const e = garageForm;
    if (!e.name.trim()) { setFormErr("Garage name required."); return; }
    if (![e.x, e.y, e.z].every(n => Number.isFinite(n))) { setFormErr("Paste three numeric coordinates (x, y, z)."); return; }
    setFormErr("");
    let r;
    try { r = e.id ? await editFleetGarage(e.id, e.name.trim(), e.x, e.y, e.z, e.notes) : await addFleetGarage(e.factionId, e.name.trim(), e.x, e.y, e.z, e.notes); }
    catch (err) { setFormErr(err?.message || "Failed."); return; }
    if (!r?.ok) { setFormErr(r?.error || "Failed."); return; }
    setGarageForm(null); refresh();
  };
  const saveOverride = async () => {
    const o = overrideForm;
    const ints = [o.maxTypes, o.maxTotal, o.maxGarages].map(v => parseInt(v, 10));
    if (ints.some(n => !Number.isInteger(n) || n < 0)) { setFormErr("Limits must be whole numbers of 0 or more."); return; }
    if (!o.reason.trim()) { setFormErr("A reason is required for an override."); return; }
    setFormErr("");
    let r;
    try { r = await setFleetOverride(o.factionId, ints[0], ints[1], ints[2], o.reason.trim()); }
    catch (err) { setFormErr(err?.message || "Failed."); return; }
    if (!r?.ok) { setFormErr(r?.error || "Failed."); return; }
    setOverrideForm(null); refresh();
  };

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
        <input className="filter-inp" placeholder="Search factions…" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 300 }} />
        <span style={{ fontSize: 11, color: "var(--ink-3)" }}>FM-assigned vehicles only · donated vehicles are not tracked · {rows.length} active faction{rows.length === 1 ? "" : "s"}</span>
      </div>

      <div className="card">
        <div className="hd"><div className="t">Tier defaults</div><div className="meta">types · total · garages · stipend</div></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(96px,1fr))", gap: 6, paddingTop: 6 }}>
          {Object.entries(tiers).map(([tier, d]) => (
            <div key={tier} style={{ padding: "8px 6px", borderRadius: 8, background: "var(--panel-2)", textAlign: "center", fontFamily: "var(--v2-mono)", fontSize: 11 }}>
              <div style={{ fontWeight: 700, color: "var(--accent)" }}>T{tier}</div>
              <div style={{ color: "var(--ink-2)" }}>{d.types} · {d.total} · {d.garages}</div>
              <div style={{ color: "var(--ink-3)", fontSize: 10 }}>${num(d.stipend).toLocaleString()}</div>
            </div>
          ))}
        </div>
      </div>

      {shown.length === 0 && <div className="empty">No active factions match.</div>}
      <div className="card">
        {shown.map(f => {
          const open = exp === f.id;
          const over = f.limits.isOverridden;
          return (
            <div key={f.id} style={{ borderBottom: "1px solid var(--line)" }}>
              <div className={`row${open ? " exp" : ""}`} onClick={() => setExp(open ? null : f.id)}>
                <span className="tier lo">T{f.tier}</span>
                <span className="desc" style={{ fontWeight: 600 }}>{f.name}</span>
                {over && <span className="chip" style={{ background: "var(--amber-bg)", color: "var(--amber)" }}>OVERRIDDEN</span>}
                <span style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--v2-mono)", whiteSpace: "nowrap" }}>
                  {f.typeCount}/{f.limits.maxTypes} types · {f.totalQuantity}/{f.limits.maxTotal} vehicles · {f.garages.length}/{f.limits.maxGarages} garages
                </span>
                <span className="caret">▼</span>
              </div>
              {open && (
                <div className="task-detail">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                    <div style={{ fontSize: 12, color: "var(--ink-1)" }}>
                      <b>Active limits:</b> {f.limits.maxTypes} types · {f.limits.maxTotal} total · {f.limits.maxGarages} garages
                      {over && <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>Override reason: {f.limits.overrideReason || "—"}{f.limits.overriddenBy ? ` (${f.limits.overriddenBy})` : ""}</div>}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="act warn" onClick={() => openOverride(f)}>{over ? "Edit override" : "Override"}</button>
                      {over && <button className="act" style={{ color: "var(--rose)" }} onClick={async () => { if (window.confirm(`Revert ${f.name} to tier defaults?`)) { if (await act(() => clearFleetOverride(f.id))) refresh(); } }}>Clear override</button>}
                    </div>
                  </div>

                  <div className="imp-grp" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>Approved vehicles ({f.typeCount} types, {f.totalQuantity} total)</span>
                    <button className="act" onClick={() => openVehicle(f, null)}>+ Vehicle</button>
                  </div>
                  {f.vehicles.length === 0 && <div style={{ fontSize: 12, fontStyle: "italic", color: "var(--ink-3)", padding: "4px 0 8px" }}>No vehicles assigned.</div>}
                  {f.vehicles.map(v => (
                    <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 8, background: "var(--panel)", marginBottom: 4, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: "var(--v2-mono)", fontWeight: 700, minWidth: 30 }}>{v.quantity}x</span>
                      <span style={{ fontSize: 13, flex: 1, minWidth: 120 }}>{v.vehicle_name}</span>
                      {v.spawn_name && <button className="chip role" title="Copy spawn name" style={{ cursor: "pointer" }} onClick={() => copy(v.spawn_name, `v${v.id}`)}>{copied === `v${v.id}` ? "✓ copied" : v.spawn_name}</button>}
                      {v.notes && <span style={{ fontSize: 11, color: "var(--ink-3)", fontStyle: "italic" }}>— {v.notes}</span>}
                      <span style={{ display: "flex", gap: 4 }}>
                        <button className="act" style={{ padding: "2px 7px" }} onClick={() => openVehicle(f, v)}>Edit</button>
                        <button className="act" style={{ padding: "2px 7px", color: "var(--rose)" }} onClick={async () => { if (window.confirm(`Remove ${v.quantity}x ${v.vehicle_name} from ${f.name}?`)) { if (await act(() => deleteFleetVehicle(v.id))) refresh(); } }}>Del</button>
                      </span>
                    </div>
                  ))}

                  <div className="imp-grp" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>Garage spawnpoints ({f.garages.length}/{f.limits.maxGarages})</span>
                    <button className="act" disabled={f.garages.length >= f.limits.maxGarages} title={f.garages.length >= f.limits.maxGarages ? "At the garage limit — override first" : ""} onClick={() => openGarage(f, null)}>+ Garage</button>
                  </div>
                  {f.garages.length === 0 && <div style={{ fontSize: 12, fontStyle: "italic", color: "var(--ink-3)", padding: "4px 0 8px" }}>No garages configured.</div>}
                  {f.garages.map(g => (
                    <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 8, background: "var(--panel)", marginBottom: 4, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{g.name}</span>
                      <span style={{ fontFamily: "var(--v2-mono)", fontSize: 11, color: "var(--ink-3)", flex: 1 }}>{fmtCoord(g.x)}, {fmtCoord(g.y)}, {fmtCoord(g.z)}</span>
                      {g.notes && <span style={{ fontSize: 11, color: "var(--ink-3)", fontStyle: "italic" }}>— {g.notes}</span>}
                      <span style={{ display: "flex", gap: 4 }}>
                        <button className="act good" style={{ padding: "2px 7px" }} onClick={() => copy(`/tppos ${g.x} ${g.y} ${g.z}`, `g${g.id}`)}>{copied === `g${g.id}` ? "✓ copied" : "Copy /tp"}</button>
                        <button className="act" style={{ padding: "2px 7px" }} onClick={() => openGarage(f, g)}>Edit</button>
                        <button className="act" style={{ padding: "2px 7px", color: "var(--rose)" }} onClick={async () => { if (window.confirm(`Remove garage "${g.name}"?`)) { if (await act(() => deleteFleetGarage(g.id))) refresh(); } }}>Del</button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {vehicleForm && (
        <Modal title={`${vehicleForm.id ? "Edit" : "Add"} vehicle — ${vehicleForm.factionName}`} onClose={() => setVehicleForm(null)} onSave={saveVehicle} error={formErr}>
          <div style={{ position: "relative" }}>
            <div style={lbl}>Vehicle name</div>
            <input className="filter-inp" style={{ width: "100%" }} value={vehicleForm.vehicle_name} disabled={!!vehicleForm.id} placeholder="Start typing — picks from the Vehicle Catalog" onChange={e => {
              const v = e.target.value; setVehicleForm(f => ({ ...f, vehicle_name: v }));
              clearTimeout(window.__fleetSuggT);
              if (v.trim().length >= 1) window.__fleetSuggT = setTimeout(async () => setSuggestions(await getVehicleCatalog(v).catch(() => [])), 200);
              else setSuggestions([]);
            }} />
            {suggestions.length > 0 && !vehicleForm.id && vehicleForm.vehicle_name && (
              <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, borderRadius: 8, maxHeight: 180, overflowY: "auto", zIndex: 50, background: "var(--panel)", border: "1px solid var(--line-2)" }}>
                {suggestions.map(s => <div key={s} style={{ padding: "7px 10px", cursor: "pointer", fontSize: 12.5 }} onClick={() => { setVehicleForm(f => ({ ...f, vehicle_name: s })); setSuggestions([]); }}>{s}</div>)}
              </div>
            )}
          </div>
          <div><div style={lbl}>Quantity</div><input type="number" min="1" className="filter-inp" style={{ width: "100%" }} value={vehicleForm.quantity} onChange={e => setVehicleForm(f => ({ ...f, quantity: e.target.value }))} /></div>
          <div><div style={lbl}>Notes (optional)</div><input className="filter-inp" style={{ width: "100%" }} value={vehicleForm.notes} onChange={e => setVehicleForm(f => ({ ...f, notes: e.target.value }))} /></div>
        </Modal>
      )}

      {garageForm && (
        <Modal title={`${garageForm.id ? "Edit" : "Add"} garage — ${garageForm.factionName}`} onClose={() => setGarageForm(null)} onSave={saveGarage} error={formErr}>
          <div><div style={lbl}>Garage name</div><input className="filter-inp" style={{ width: "100%" }} value={garageForm.name} placeholder="e.g. Main HQ" onChange={e => setGarageForm(f => ({ ...f, name: e.target.value }))} /></div>
          <div>
            <div style={lbl}>Coordinates (paste the full line, commas optional)</div>
            <input className="filter-inp" style={{ width: "100%" }} value={garageForm.coords} placeholder="931.7645, -1803.273, 30.676416" onChange={e => {
              const raw = e.target.value;
              const parts = raw.replace(/,/g, " ").trim().split(/\s+/).map(Number).filter(n => Number.isFinite(n));
              setGarageForm(f => ({ ...f, coords: raw, x: parts.length >= 3 ? parts[0] : null, y: parts.length >= 3 ? parts[1] : null, z: parts.length >= 3 ? parts[2] : null }));
            }} />
            <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 4, fontFamily: "var(--v2-mono)" }}>Parsed: {[garageForm.x, garageForm.y, garageForm.z].every(n => Number.isFinite(n)) ? `X=${garageForm.x} Y=${garageForm.y} Z=${garageForm.z}` : "— need three numbers"}</div>
          </div>
          <div><div style={lbl}>Notes (optional)</div><input className="filter-inp" style={{ width: "100%" }} value={garageForm.notes} onChange={e => setGarageForm(f => ({ ...f, notes: e.target.value }))} /></div>
        </Modal>
      )}

      {overrideForm && (
        <Modal title={`Override fleet limits — ${overrideForm.factionName}`} onClose={() => setOverrideForm(null)} onSave={saveOverride} saveLabel="Save override" error={formErr}>
          <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>Replaces the tier defaults for this faction only. Every override is audited with its reason.</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <div><div style={lbl}>Max types</div><input type="number" min="0" className="filter-inp" style={{ width: "100%" }} value={overrideForm.maxTypes} onChange={e => setOverrideForm(f => ({ ...f, maxTypes: e.target.value }))} /></div>
            <div><div style={lbl}>Max total</div><input type="number" min="0" className="filter-inp" style={{ width: "100%" }} value={overrideForm.maxTotal} onChange={e => setOverrideForm(f => ({ ...f, maxTotal: e.target.value }))} /></div>
            <div><div style={lbl}>Max garages</div><input type="number" min="0" className="filter-inp" style={{ width: "100%" }} value={overrideForm.maxGarages} onChange={e => setOverrideForm(f => ({ ...f, maxGarages: e.target.value }))} /></div>
          </div>
          <div><div style={lbl}>Reason (required)</div><textarea className="filter-inp" rows={3} style={{ width: "100%" }} value={overrideForm.reason} placeholder="Why is this override being applied?" onChange={e => setOverrideForm(f => ({ ...f, reason: e.target.value }))} /></div>
        </Modal>
      )}
    </>
  );
}
