"use client";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../lib/useAuth";
import { useDialog } from "../../../../lib/useDialog";
import { getFleetOverview, getFleetTierDefaults, getVehicleCatalog, addFleetVehicle, editFleetVehicle, deleteFleetVehicle, addFleetGarage, editFleetGarage, deleteFleetGarage, setFleetOverride, clearFleetOverride } from "../actions";
import { st } from "../_shared/styles";
import OperationsShell from "../_shared/Shell";

export default function FleetPage() {
  const auth = useAuth();
  const { showConfirm, showAlert } = useDialog();

  const [fleetData, setFleetData] = useState([]);
  const [fleetTierDefaults, setFleetTierDefaults] = useState({});
  const [fleetExpanded, setFleetExpanded] = useState(null);
  const [fleetEditingVehicle, setFleetEditingVehicle] = useState(null);
  const [fleetEditingGarage, setFleetEditingGarage] = useState(null);
  const [fleetEditingOverride, setFleetEditingOverride] = useState(null);
  const [fleetCatalogSuggestions, setFleetCatalogSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (auth.loading || auth.level < 3) return;
    refresh();
  }, [auth.loading, auth.level]);

  const refresh = async () => {
    setLoading(true);
    const [d, t] = await Promise.all([getFleetOverview(), getFleetTierDefaults()]);
    setFleetData(d); setFleetTierDefaults(t); setLoading(false);
  };
  const refreshFleet = async () => { setFleetData(await getFleetOverview()); };

  if (auth.loading) return <div className="p-10 text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading...</div>;
  if (auth.level < 3) return <div className="p-10" style={{color:'var(--red)'}}>Access denied.</div>;
  if (loading) return <div className="p-10 text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading...</div>;

  return (
    <OperationsShell title="Fleet" docs={[{"title": "Operations — Inventory, Imports & Fleet", "label": "Fleet Guide", "minLevel": 3}]} authLevel={auth?.level || 3}>
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <div className="text-sm font-bold">Faction Fleet Tracking</div>
            <div className="text-[11px]" style={{ color: 'var(--fg-4)' }}>FM Assigned vehicles only. Donated vehicles are not tracked here.</div>
          </div>
          <div className="text-[10px]" style={{ color: 'var(--fg-4)' }}>{fleetData.length} active factions</div>
        </div>

        <div className="rounded-xl p-4" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
          <div className="text-[10px] font-bold uppercase mb-2" style={{ color: 'var(--fg-4)' }}>Tier Defaults Reference</div>
          <div className="grid grid-cols-9 gap-2 text-[11px]">
            {Object.entries(fleetTierDefaults).map(([tier, d]) => (
              <div key={tier} className="text-center rounded p-2" style={{ background: 'var(--bg-2)' }}>
                <div className="font-bold" style={{ color: 'var(--accent)' }}>T{tier}</div>
                <div style={{ color: 'var(--fg-3)' }}>{d.types} types</div>
                <div style={{ color: 'var(--fg-3)' }}>{d.total} total</div>
                <div style={{ color: 'var(--fg-3)' }}>{d.garages} garages</div>
                <div style={{ color: 'var(--fg-4)', fontSize: 9 }}>${d.stipend.toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {fleetData.map(f => {
            const isExp = fleetExpanded === f.id;
            return (
              <div key={f.id} className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-1)', border: isExp ? '1px solid var(--accent)' : '1px solid var(--border)' }}>
                <div className="flex items-center justify-between px-5 py-3 cursor-pointer" onClick={() => setFleetExpanded(isExp ? null : f.id)}>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: 'var(--bg-3)', color: 'var(--fg-4)' }}>T{f.tier}</span>
                    <span className="font-bold">{f.name}</span>
                    {f.limits.isOverridden && <span className="text-[9px] font-bold px-2 py-0.5 rounded" style={{ background: 'var(--amber-bg)', color: 'var(--amber)' }}>OVERRIDDEN</span>}
                  </div>
                  <div className="flex items-center gap-4 text-[11px]">
                    <span style={{ color: 'var(--fg-4)' }}>{f.typeCount}/{f.limits.maxTypes} types · {f.totalQuantity}/{f.limits.maxTotal} vehicles · {f.garages.length}/{f.limits.maxGarages} garages</span>
                    <span style={{ color: 'var(--fg-4)', transform: isExp ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▼</span>
                  </div>
                </div>

                {isExp && (
                  <div className="px-5 pb-4 pt-2 space-y-4" style={{ borderTop: '1px solid var(--border)' }}>
                    <div className="rounded p-3" style={{ background: 'var(--bg-2)' }}>
                      <div className="flex justify-between items-center mb-1">
                        <div className="text-[10px] font-bold uppercase" style={{ color: 'var(--fg-4)' }}>Active Limits</div>
                        {!f.limits.isOverridden ? (
                          <button style={{ fontSize: 10, color: 'var(--amber)', background: 'none', border: '1px solid var(--amber)', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontWeight: 700 }} onClick={() => setFleetEditingOverride({ factionId: f.id, factionName: f.name, maxTypes: f.limits.maxTypes, maxTotal: f.limits.maxTotal, maxGarages: f.limits.maxGarages, reason: '' })}>Override</button>
                        ) : (
                          <div className="flex gap-2">
                            <button style={{ fontSize: 10, color: 'var(--amber)', background: 'none', border: '1px solid var(--amber)', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontWeight: 700 }} onClick={() => setFleetEditingOverride({ factionId: f.id, factionName: f.name, maxTypes: f.limits.maxTypes, maxTotal: f.limits.maxTotal, maxGarages: f.limits.maxGarages, reason: f.limits.overrideReason || '' })}>Edit Override</button>
                            <button style={{ fontSize: 10, color: 'var(--red)', background: 'none', border: '1px solid var(--red)', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontWeight: 700 }} onClick={async () => { if (await showConfirm('Revert to tier defaults?')) { await clearFleetOverride(f.id); refreshFleet(); } }}>Clear Override</button>
                          </div>
                        )}
                      </div>
                      <div className="text-[11px]" style={{ color: 'var(--fg-3)' }}>
                        Max types: <strong>{f.limits.maxTypes}</strong> · Max total: <strong>{f.limits.maxTotal}</strong> · Max garages: <strong>{f.limits.maxGarages}</strong>
                        {f.limits.isOverridden && f.limits.overrideReason && <div className="mt-1 text-[10px]" style={{ color: 'var(--fg-4)' }}>Override reason: {f.limits.overrideReason} ({f.limits.overriddenBy})</div>}
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <div className="text-[10px] font-bold uppercase" style={{ color: 'var(--fg-4)' }}>Approved Vehicles ({f.typeCount} types, {f.totalQuantity} total)</div>
                        <button style={{ fontSize: 10, color: 'var(--accent)', background: 'none', border: '1px solid var(--accent)', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontWeight: 700 }} onClick={() => setFleetEditingVehicle({ factionId: f.id, id: null, vehicle_name: '', quantity: 1, notes: '' })}>+ Add Vehicle</button>
                      </div>
                      {f.vehicles.length === 0 && <div className="text-[11px] italic" style={{ color: 'var(--fg-4)' }}>No vehicles assigned</div>}
                      <div className="space-y-1">
                        {f.vehicles.map(v => (
                          <div key={v.id} className="flex justify-between items-center rounded p-2 group" style={{ background: 'var(--bg-2)' }}>
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="font-bold text-[12px] min-w-[30px]">{v.quantity}x</span>
                              <span className="text-[13px]">{v.vehicle_name}</span>
                              {v.spawn_name && (
                                <span
                                  className="font-mono text-[10px] px-1.5 py-0.5 rounded cursor-pointer select-all"
                                  style={{ background: 'var(--bg-3)', color: 'var(--fg-3)', border: '1px solid var(--border)' }}
                                  title="Click to copy spawn name"
                                  onClick={() => navigator.clipboard.writeText(v.spawn_name)}
                                >{v.spawn_name}</span>
                              )}
                              {v.notes && <span className="text-[10px] italic" style={{ color: 'var(--fg-4)' }}>— {v.notes}</span>}
                            </div>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                              <button style={{ fontSize: 10, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }} onClick={() => setFleetEditingVehicle({ factionId: f.id, id: v.id, vehicle_name: v.vehicle_name, quantity: v.quantity, notes: v.notes || '' })}>Edit</button>
                              <button style={{ fontSize: 10, color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }} onClick={async () => { if (await showConfirm(`Remove ${v.quantity}x ${v.vehicle_name}?`)) { await deleteFleetVehicle(v.id); refreshFleet(); } }}>Del</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <div className="text-[10px] font-bold uppercase" style={{ color: 'var(--fg-4)' }}>Garage Spawnpoints ({f.garages.length}/{f.limits.maxGarages})</div>
                        <button style={{ fontSize: 10, color: 'var(--accent)', background: 'none', border: '1px solid var(--accent)', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontWeight: 700 }} onClick={() => setFleetEditingGarage({ factionId: f.id, id: null, name: '', x: 0, y: 0, z: 0, notes: '' })} disabled={f.garages.length >= f.limits.maxGarages}>+ Add Garage</button>
                      </div>
                      {f.garages.length === 0 && <div className="text-[11px] italic" style={{ color: 'var(--fg-4)' }}>No garages configured</div>}
                      <div className="space-y-1">
                        {f.garages.map(g => (
                          <div key={g.id} className="flex justify-between items-center rounded p-2 group" style={{ background: 'var(--bg-2)' }}>
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="font-bold text-[12px]">{g.name}</span>
                              <span className="font-mono text-[10px]" style={{ color: 'var(--fg-4)' }}>{g.x.toFixed(2)}, {g.y.toFixed(2)}, {g.z.toFixed(2)}</span>
                              {g.notes && <span className="text-[10px] italic" style={{ color: 'var(--fg-4)' }}>— {g.notes}</span>}
                            </div>
                            <div className="flex gap-1 items-center">
                              <button style={{ fontSize: 10, color: 'var(--green)', background: 'none', border: '1px solid var(--green)', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontWeight: 700 }} onClick={() => { navigator.clipboard.writeText(`/tppos ${g.x} ${g.y} ${g.z}`); }}>Copy /tp</button>
                              <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                                <button style={{ fontSize: 10, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }} onClick={() => setFleetEditingGarage({ factionId: f.id, id: g.id, name: g.name, x: g.x, y: g.y, z: g.z, notes: g.notes || '' })}>Edit</button>
                                <button style={{ fontSize: 10, color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }} onClick={async () => { if (await showConfirm(`Remove garage "${g.name}"?`)) { await deleteFleetGarage(g.id); refreshFleet(); } }}>Del</button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Vehicle edit modal */}
        {fleetEditingVehicle && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={() => setFleetEditingVehicle(null)}>
            <div className="w-full max-w-md rounded-xl p-5" style={{ background: 'var(--bg-0)', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
              <h3 className="font-bold mb-4">{fleetEditingVehicle.id ? 'Edit' : 'Add'} Vehicle</h3>
              <div className="space-y-3">
                <div className="relative">
                  <div style={st.label}>Vehicle Name</div>
                  <input style={st.input} value={fleetEditingVehicle.vehicle_name} onChange={async e => {
                    const v = e.target.value; setFleetEditingVehicle({ ...fleetEditingVehicle, vehicle_name: v });
                    if (v.length >= 1) { const s = await getVehicleCatalog(v); setFleetCatalogSuggestions(s); } else { setFleetCatalogSuggestions([]); }
                  }} placeholder="Start typing..." disabled={!!fleetEditingVehicle.id} />
                  {fleetCatalogSuggestions.length > 0 && fleetEditingVehicle.vehicle_name && !fleetEditingVehicle.id && (
                    <div className="absolute top-full left-0 right-0 mt-1 rounded max-h-[200px] overflow-y-auto z-10" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                      {fleetCatalogSuggestions.map(s => (
                        <div key={s} className="px-3 py-2 cursor-pointer text-sm hover:bg-[var(--bg-3)]" onClick={() => { setFleetEditingVehicle({ ...fleetEditingVehicle, vehicle_name: s }); setFleetCatalogSuggestions([]); }}>{s}</div>
                      ))}
                    </div>
                  )}
                </div>
                <div><div style={st.label}>Quantity</div><input type="number" style={st.input} value={fleetEditingVehicle.quantity} onChange={e => setFleetEditingVehicle({ ...fleetEditingVehicle, quantity: parseInt(e.target.value) || 1 })} min="1" /></div>
                <div><div style={st.label}>Notes (optional)</div><input style={st.input} value={fleetEditingVehicle.notes} onChange={e => setFleetEditingVehicle({ ...fleetEditingVehicle, notes: e.target.value })} placeholder="Optional note" /></div>
              </div>
              <div className="flex justify-between mt-5">
                <button style={st.btnGhost} onClick={() => setFleetEditingVehicle(null)}>Cancel</button>
                <button style={st.btn} onClick={async () => {
                  const e = fleetEditingVehicle;
                  if (!e.vehicle_name.trim()) { showAlert('Vehicle name required'); return; }
                  const res = e.id ? await editFleetVehicle(e.id, e.quantity, e.notes) : await addFleetVehicle(e.factionId, e.vehicle_name.trim(), e.quantity, e.notes);
                  if (!res.ok) { showAlert(res.error || 'Error'); return; }
                  setFleetEditingVehicle(null); refreshFleet();
                }}>Save</button>
              </div>
            </div>
          </div>
        )}

        {/* Garage edit modal */}
        {fleetEditingGarage && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={() => setFleetEditingGarage(null)}>
            <div className="w-full max-w-md rounded-xl p-5" style={{ background: 'var(--bg-0)', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
              <h3 className="font-bold mb-4">{fleetEditingGarage.id ? 'Edit' : 'Add'} Garage</h3>
              <div className="space-y-3">
                <div><div style={st.label}>Garage Name</div><input style={st.input} value={fleetEditingGarage.name} onChange={e => setFleetEditingGarage({ ...fleetEditingGarage, name: e.target.value })} placeholder="e.g. Main HQ" /></div>
                <div>
                  <div style={st.label}>Coordinates (paste full line, commas optional)</div>
                  <input style={st.input} placeholder="931.7645, -1803.273, 30.676416" defaultValue={fleetEditingGarage.id ? `${fleetEditingGarage.x}, ${fleetEditingGarage.y}, ${fleetEditingGarage.z}` : ''} onChange={e => {
                    const parts = e.target.value.replace(/,/g, ' ').trim().split(/\s+/).map(parseFloat).filter(n => !isNaN(n));
                    if (parts.length >= 3) setFleetEditingGarage({ ...fleetEditingGarage, x: parts[0], y: parts[1], z: parts[2] });
                  }} />
                  <div className="text-[10px] mt-1" style={{ color: 'var(--fg-4)' }}>Parsed: X={fleetEditingGarage.x?.toFixed(4) || '0'} | Y={fleetEditingGarage.y?.toFixed(4) || '0'} | Z={fleetEditingGarage.z?.toFixed(4) || '0'}</div>
                </div>
                <div><div style={st.label}>Notes (optional)</div><input style={st.input} value={fleetEditingGarage.notes} onChange={e => setFleetEditingGarage({ ...fleetEditingGarage, notes: e.target.value })} /></div>
              </div>
              <div className="flex justify-between mt-5">
                <button style={st.btnGhost} onClick={() => setFleetEditingGarage(null)}>Cancel</button>
                <button style={st.btn} onClick={async () => {
                  const e = fleetEditingGarage;
                  if (!e.name.trim()) { showAlert('Name required'); return; }
                  const res = e.id ? await editFleetGarage(e.id, e.name.trim(), e.x, e.y, e.z, e.notes) : await addFleetGarage(e.factionId, e.name.trim(), e.x, e.y, e.z, e.notes);
                  if (!res.ok) { showAlert(res.error || 'Error'); return; }
                  setFleetEditingGarage(null); refreshFleet();
                }}>Save</button>
              </div>
            </div>
          </div>
        )}

        {/* Override modal */}
        {fleetEditingOverride && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={() => setFleetEditingOverride(null)}>
            <div className="w-full max-w-md rounded-xl p-5" style={{ background: 'var(--bg-0)', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
              <h3 className="font-bold mb-1">Override Fleet Limits</h3>
              <div className="text-[11px] mb-4" style={{ color: 'var(--fg-4)' }}>Overriding {fleetEditingOverride.factionName}. All changes audited.</div>
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <div><div style={st.label}>Max Types</div><input type="number" style={st.input} value={fleetEditingOverride.maxTypes} onChange={e => setFleetEditingOverride({ ...fleetEditingOverride, maxTypes: parseInt(e.target.value) || 0 })} min="0" /></div>
                  <div><div style={st.label}>Max Total</div><input type="number" style={st.input} value={fleetEditingOverride.maxTotal} onChange={e => setFleetEditingOverride({ ...fleetEditingOverride, maxTotal: parseInt(e.target.value) || 0 })} min="0" /></div>
                  <div><div style={st.label}>Max Garages</div><input type="number" style={st.input} value={fleetEditingOverride.maxGarages} onChange={e => setFleetEditingOverride({ ...fleetEditingOverride, maxGarages: parseInt(e.target.value) || 0 })} min="0" /></div>
                </div>
                <div><div style={st.label}>Reason (required)</div><textarea rows="3" style={{ ...st.input, fontFamily: 'inherit' }} value={fleetEditingOverride.reason} onChange={e => setFleetEditingOverride({ ...fleetEditingOverride, reason: e.target.value })} placeholder="Why is this override being applied?" /></div>
              </div>
              <div className="flex justify-between mt-5">
                <button style={st.btnGhost} onClick={() => setFleetEditingOverride(null)}>Cancel</button>
                <button style={st.btn} onClick={async () => {
                  const o = fleetEditingOverride;
                  if (!o.reason.trim()) { showAlert('Reason required for override'); return; }
                  const res = await setFleetOverride(o.factionId, o.maxTypes, o.maxTotal, o.maxGarages, o.reason.trim());
                  if (!res.ok) { showAlert(res.error || 'Error'); return; }
                  setFleetEditingOverride(null); refreshFleet();
                }}>Save Override</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </OperationsShell>
  );
}
