"use client";
import { useEffect, useState, useMemo } from "react";
import { useAuth } from "../../../../lib/useAuth";
import { useDialog } from "../../../../lib/useDialog";
import { listCatalog, createCatalogEntry, updateCatalogEntry, deleteCatalogEntry, listFactionsForAdd, addCatalogVehicleToFaction } from "./actions";

const st = {
  btn: { background:'var(--accent)', color:'white', border:'none', padding:'8px 16px', borderRadius:8, fontSize:11, fontWeight:800, cursor:'pointer', textTransform:'uppercase', letterSpacing:'0.08em' },
  btnGhost: { background:'transparent', color:'var(--fg-3)', border:'1px solid var(--border)', padding:'6px 14px', borderRadius:8, fontSize:11, fontWeight:700, cursor:'pointer', textTransform:'uppercase' },
  input: { width:'100%', background:'var(--bg-2)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 14px', fontSize:13, color:'var(--fg-0)', outline:'none' },
  label: { fontSize:10, fontWeight:700, color:'var(--fg-4)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:4 },
};

const EMPTY = { vehicle_name:'', spawn_name:'', notes:'' };

export default function VehicleCatalogPage() {
  const auth = useAuth();
  const { showAlert, showConfirm } = useDialog();

  // L2 + Lead Storytellers get read-only access; L3 / Event Team can edit.
  const canView = auth.level >= 2 || auth.isEventTeam || auth.isLeadStoryteller;
  const canEdit = auth.level >= 3 || auth.isEventTeam;
  const [catalog, setCatalog] = useState([]);
  const [factions, setFactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [search, setSearch] = useState('');
  const [addingTo, setAddingTo] = useState(null);
  const [addFactionId, setAddFactionId] = useState('');
  const [addQty, setAddQty] = useState(1);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  const refresh = async () => {
    setLoading(true);
    // listFactionsForAdd is an L3/ET-only action used by the add-to-faction flow;
    // read-only viewers skip it so they don't trip the clearance check.
    const [c, f] = await Promise.all([listCatalog(), canEdit ? listFactionsForAdd() : Promise.resolve([])]);
    setCatalog(c); setFactions(f);
    setLoading(false);
  };

  useEffect(() => { if (!auth.loading) refresh(); }, [auth.loading]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(c => (c.vehicle_name || '').toLowerCase().includes(q) || (c.spawn_name || '').toLowerCase().includes(q));
  }, [catalog, search]);

  if (auth.loading || loading) return <div className="p-10 text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading...</div>;
  if (!canView) return <div className="p-10 text-sm" style={{color:'var(--red)'}}>Access denied.</div>;

  const openCreate = () => { setEditing(null); setForm(EMPTY); setShowForm(true); };
  const openEdit = (r) => {
    setEditing(r);
    setForm({ vehicle_name: r.vehicle_name, spawn_name: r.spawn_name || '', notes: r.notes || '' });
    setShowForm(true);
  };
  const submit = async () => {
    const fn = editing ? updateCatalogEntry : createCatalogEntry;
    const args = editing ? [editing.id, form] : [form];
    const res = await fn(...args);
    if (!res.ok) { await showAlert(res.error || 'Failed'); return; }
    setShowForm(false); setEditing(null); setForm(EMPTY); refresh();
  };
  const remove = async (r) => {
    if (await showConfirm(`Delete "${r.vehicle_name}" from the catalog?`)) {
      const res = await deleteCatalogEntry(r.id);
      if (!res.ok) { await showAlert(res.error || 'Failed'); return; }
      refresh();
    }
  };
  const openAdd = (r) => { setAddingTo(r); setAddFactionId(''); setAddQty(1); };
  const submitAdd = async () => {
    if (!addFactionId) { await showAlert('Pick a faction'); return; }
    setAddSubmitting(true);
    const res = await addCatalogVehicleToFaction(addingTo.id, parseInt(addFactionId), parseInt(addQty));
    setAddSubmitting(false);
    if (!res.ok) { await showAlert(res.error || 'Failed'); return; }
    await showAlert(`Added ${res.added}x "${res.vehicle}" to ${res.faction}. New total: ${res.newTotal}/${res.limits.max_total}.`);
    setAddingTo(null); refresh();
  };

  return (
    <div className="w-full max-w-5xl mx-auto p-6 lg:p-10 space-y-6">
      <div className="flex justify-between items-end pb-4" style={{borderBottom:'1px solid var(--border)'}}>
        <div>
          <h1 className="text-3xl font-black tracking-tighter italic uppercase">Vehicle Catalog</h1>
          <p className="text-sm mt-1" style={{color:'var(--fg-3)'}}>Master list of vehicles available for faction garages.</p>
        </div>
        {canEdit && <button style={st.btn} onClick={openCreate}>+ New Vehicle</button>}
      </div>

      <input style={st.input} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by vehicle name or spawn name..." />

      {showForm && !editing && (
        <div className="rounded-xl p-5 space-y-3" style={{background:'var(--bg-1)', border:'1px solid var(--accent)'}}>
          <div className="text-[10px] font-bold uppercase tracking-widest" style={{color:'var(--accent)'}}>New Vehicle</div>
          <div><div style={st.label}>Display Name *</div><input style={st.input} value={form.vehicle_name} onChange={e => setForm({...form, vehicle_name: e.target.value})} placeholder="Caracara" /></div>
          <div><div style={st.label}>Spawn Name</div><input style={st.input} value={form.spawn_name} onChange={e => setForm({...form, spawn_name: e.target.value})} placeholder="caracara" /></div>
          <div><div style={st.label}>Notes (optional)</div><textarea style={{...st.input, resize:'vertical'}} rows={2} value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} /></div>
          <div className="flex justify-end gap-2 pt-2">
            <button style={st.btnGhost} onClick={() => { setShowForm(false); setForm(EMPTY); }}>Cancel</button>
            <button style={st.btn} onClick={submit}>Create</button>
          </div>
        </div>
      )}

      <div className="rounded-lg overflow-hidden" style={{border:'1px solid var(--border)'}}>
        <div className="grid items-center text-[10px] font-bold uppercase tracking-widest px-3 py-2" style={{gridTemplateColumns:'1fr 1fr 60px auto', gap:'12px', background:'var(--bg-2)', color:'var(--fg-4)', borderBottom:'1px solid var(--border)'}}>
          <div>Name</div>
          <div>Spawn</div>
          <div className="text-right">Used</div>
          <div></div>
        </div>
        {filtered.length === 0 && <div className="px-3 py-6 text-sm italic text-center" style={{color:'var(--fg-4)'}}>No vehicles match.</div>}
        {filtered.map((r, i) => (
          <div key={r.id} className="grid items-center px-3 py-1.5 hover:bg-[var(--bg-2)] transition-colors" style={{gridTemplateColumns:'1fr 1fr 60px auto', gap:'12px', background: i % 2 === 0 ? 'var(--bg-1)' : 'transparent', borderBottom: i < filtered.length - 1 ? '1px solid var(--border)' : 'none'}}>
            <div className="text-sm font-bold truncate" title={r.vehicle_name}>{r.vehicle_name}</div>
            {r.spawn_name ? (
              <button
                onClick={() => { navigator.clipboard.writeText(r.spawn_name); setCopiedId(r.id); setTimeout(() => setCopiedId(null), 1500); }}
                title="Click to copy spawn name"
                style={{background:'transparent', border:'none', padding:0, cursor:'pointer', textAlign:'left', width:'100%', minWidth:0}}
              >
                <span className="text-xs font-mono truncate block" style={{color: copiedId === r.id ? 'var(--green)' : 'var(--fg-3)', transition:'color 0.15s'}}>
                  {copiedId === r.id ? '✓ copied' : r.spawn_name}
                </span>
              </button>
            ) : (
              <span className="text-xs font-mono" style={{color:'var(--fg-4)'}}>—</span>
            )}
            <div className="text-xs text-right font-mono" style={{color: r.use_count > 0 ? 'var(--fg-2)' : 'var(--fg-4)'}}>{r.use_count || 0}</div>
            {canEdit && (
            <div className="flex gap-1 justify-end">
              <button onClick={() => openAdd(r)} title="Add to faction" style={{background:'transparent', border:'1px solid var(--border)', color:'var(--accent)', padding:'4px 8px', borderRadius:6, fontSize:10, fontWeight:700, cursor:'pointer', textTransform:'uppercase', whiteSpace:'nowrap'}}>+ Faction</button>
              <button onClick={() => openEdit(r)} title="Edit" style={{background:'transparent', border:'1px solid var(--border)', color: editing?.id === r.id ? 'var(--accent)' : 'var(--fg-3)', padding:'4px 8px', borderRadius:6, fontSize:10, fontWeight:700, cursor:'pointer', textTransform:'uppercase'}}>Edit</button>
              <button onClick={() => remove(r)} title="Delete" style={{background:'transparent', border:'1px solid var(--border)', color:'var(--red)', padding:'4px 8px', borderRadius:6, fontSize:10, fontWeight:700, cursor:'pointer'}}>×</button>
            </div>
            )}
          </div>
        )).flatMap((rowEl, i) => {
          const r = filtered[i];
          if (editing?.id === r.id) {
            return [rowEl, (
              <div key={`edit-${r.id}`} className="px-3 py-4 space-y-3" style={{background:'var(--bg-2)', borderBottom:'1px solid var(--border)', borderLeft:'2px solid var(--accent)'}}>
                <div className="text-[10px] font-bold uppercase tracking-widest" style={{color:'var(--accent)'}}>Editing #{r.id}</div>
                <div><div style={st.label}>Display Name *</div><input style={st.input} value={form.vehicle_name} onChange={e => setForm({...form, vehicle_name: e.target.value})} /></div>
                <div><div style={st.label}>Spawn Name</div><input style={st.input} value={form.spawn_name} onChange={e => setForm({...form, spawn_name: e.target.value})} /></div>
                <div><div style={st.label}>Notes (optional)</div><textarea style={{...st.input, resize:'vertical'}} rows={2} value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} /></div>
                <div className="flex justify-end gap-2">
                  <button style={st.btnGhost} onClick={() => { setEditing(null); setShowForm(false); setForm(EMPTY); }}>Cancel</button>
                  <button style={st.btn} onClick={submit}>Save</button>
                </div>
              </div>
            )];
          }
          return [rowEl];
        })}
      </div>

      {/* Add-to-faction modal */}
      {addingTo && (
        <div style={{ position:'fixed', inset:0, zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
          <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', backdropFilter:'blur(8px)' }} onClick={() => !addSubmitting && setAddingTo(null)} />
          <div style={{ position:'relative', width:'100%', maxWidth:480, background:'var(--bg-1)', border:'1px solid var(--border)', borderRadius:16, overflow:'hidden' }}>
            <div className="p-5" style={{borderBottom:'1px solid var(--border)'}}>
              <div className="text-[10px] font-bold uppercase tracking-widest" style={{color:'var(--accent)'}}>Add to Faction Garage</div>
              <h3 className="text-base font-bold mt-1">{addingTo.vehicle_name}</h3>
              <div className="text-[11px] font-mono mt-1" style={{color:'var(--fg-4)'}}>{addingTo.spawn_name || '(no spawn name set)'}</div>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <div style={st.label}>Faction *</div>
                <select style={st.input} value={addFactionId} onChange={e => setAddFactionId(e.target.value)}>
                  <option value="">Select faction...</option>
                  {factions.map(f => <option key={f.id} value={f.id}>T{f.tier} · {f.name}</option>)}
                </select>
              </div>
              <div>
                <div style={st.label}>Quantity *</div>
                <input type="number" min="1" max="50" style={st.input} value={addQty} onChange={e => setAddQty(parseInt(e.target.value) || 1)} />
              </div>
              <div className="text-[11px]" style={{color:'var(--fg-4)'}}>Will be rejected if it would exceed the faction's tier limits (or override).</div>
            </div>
            <div className="p-4 flex justify-end gap-3" style={{borderTop:'1px solid var(--border)'}}>
              <button style={st.btnGhost} onClick={() => setAddingTo(null)} disabled={addSubmitting}>Cancel</button>
              <button style={st.btn} onClick={submitAdd} disabled={addSubmitting || !addFactionId}>{addSubmitting ? 'Adding...' : 'Add to Faction'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
