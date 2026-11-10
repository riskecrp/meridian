"use client";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../lib/useAuth";
import { useDialog } from "../../../../lib/useDialog";
import { getGlobalImports, addImportItem, editImportItem, deleteImportItem } from "../actions";
import { st } from "../_shared/styles";
import OperationsShell from "../_shared/Shell";

export default function ImportsPage() {
  const auth = useAuth();
  const { showConfirm, showForm, showAlert } = useDialog();

  // L2, Event Team and Lead Storytellers get read-only access; L3 can edit
  // (policy 4: Event Team is read-only outside scene material).
  const canView = auth.level >= 2 || auth.isEventTeam || auth.isLeadStoryteller;
  const canEdit = auth.level >= 3;

  const [imports, setImports] = useState({ factions: [], items: [] });
  const [loading, setLoading] = useState(true);
  const [importSearch, setImportSearch] = useState("");
  const [viewItem, setViewItem] = useState(null);

  useEffect(() => {
    if (auth.loading || !canView) return;
    refresh();
  }, [auth.loading, auth.level]);

  const refresh = async () => {
    setLoading(true);
    try { setImports((await getGlobalImports()) || { factions: [], items: [] }); }
    catch (e) { await showAlert(e?.message || 'Could not load the import catalog.'); }
    setLoading(false);
  };
  // `{ok:false}` and thrown auth errors both end in an alert, never a silent refresh.
  const act = async (fn) => {
    let r; try { r = await fn(); } catch (e) { await showAlert(e?.message || 'Failed'); return false; }
    if (r && r.ok === false) { await showAlert(r.error || 'Failed'); return false; }
    return true;
  };
  const validItem = async (res) => {
    if (!res?.name?.trim()) { await showAlert('Name is required.'); return null; }
    const tier = parseInt(res.tier, 10);
    if (!Number.isInteger(tier) || tier < 1 || tier > 9) { await showAlert('Tier must be a number from 1 to 9.'); return null; }
    return { ...res, name: res.name.trim(), category: (res.category || 'General').trim() || 'General', tier: String(tier) };
  };
  // Deleting an item revokes every faction's permission for it (faction_imports
  // cascades). Say so, name them, and send the confirmation flag the action expects.
  const removeItem = async (item) => {
    const who = item.authorizedFactions || [];
    const msg = who.length
      ? `Delete "${item.name}"? This also REVOKES it from ${who.length} faction${who.length === 1 ? '' : 's'}: ${who.join(', ')}. The revocations are recorded in each faction's history.`
      : `Delete "${item.name}"? No faction currently has it.`;
    if (!(await showConfirm(msg))) return;
    if (await act(() => deleteImportItem(item.id, { confirmRevoke: true }))) refresh();
  };

  const filteredImports = imports.items.filter(i => !importSearch || i.name.toLowerCase().includes(importSearch.toLowerCase()) || i.category.toLowerCase().includes(importSearch.toLowerCase()));
  const importsByTier = filteredImports.reduce((a, i) => { const t = i.tier || '1'; if (!a[t]) a[t] = []; a[t].push(i); return a; }, {});

  if (auth.loading) return <div className="p-10 text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading...</div>;
  if (!canView) return <div className="p-10" style={{color:'var(--red)'}}>Access denied.</div>;
  if (loading) return <div className="p-10 text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading...</div>;

  return (
    <OperationsShell title="Imports" docs={[{"title": "Faction Administration", "label": "Imports & Fleet Guide", "minLevel": 3}]} authLevel={auth?.level || 3}>
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <input style={{ ...st.input, maxWidth: 300 }} placeholder="Search..." value={importSearch} onChange={e => setImportSearch(e.target.value)} />
          {canEdit && <button style={st.btn} onClick={async () => {
            const res = await showForm("Add Import Item", [
              { name: 'name', label: 'Name', type: 'text' },
              { name: 'category', label: 'Category', type: 'text', default: 'General' },
              { name: 'tier', label: 'Tier', type: 'text', default: '1' },
              { name: 'price', label: 'Price', type: 'text', placeholder: 'e.g. $5,000' },
              { name: 'importTime', label: 'Import Time', type: 'text', placeholder: 'e.g. 48 hours' },
              { name: 'shipmentPower', label: 'Shipment Power', type: 'text', placeholder: 'e.g. 500' }
            ]);
            if (!res) return;
            const item = await validItem(res);
            if (item && await act(() => addImportItem(item))) refresh();
          }}>Add Item +</button>}
        </div>
        {Object.keys(importsByTier).sort((a, b) => parseInt(a) - parseInt(b)).map(tier => (
          <div key={tier}>
            <div className="text-[12px] font-black uppercase tracking-widest mb-3 pb-2" style={{ color: 'var(--accent)', borderBottom: '1px solid var(--border)' }}>Tier {tier}</div>
            <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
              <table className="w-full text-left">
                <thead>
                  <tr style={{ background: 'var(--bg-2)' }}>
                    <th className="py-3 px-4 text-[11px] font-bold uppercase" style={{ color: 'var(--fg-4)' }}>Item</th>
                    <th className="py-3 px-4 text-[11px] font-bold uppercase" style={{ color: 'var(--fg-4)' }}>Class</th>
                    <th className="py-3 px-4 text-[11px] font-bold uppercase" style={{ color: 'var(--fg-4)' }}>Price</th>
                    <th className="py-3 px-4 text-[11px] font-bold uppercase" style={{ color: 'var(--fg-4)' }}>Time</th>
                    <th className="py-3 px-4 text-[11px] font-bold uppercase" style={{ color: 'var(--fg-4)' }}>Power</th>
                    <th className="py-3 px-4 text-center text-[11px] font-bold uppercase" style={{ color: 'var(--fg-4)' }}>Factions</th>
                    <th className="py-3 px-4 text-right text-[11px] font-bold uppercase" style={{ color: 'var(--fg-4)' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {importsByTier[tier].sort((a, b) => a.category.localeCompare(b.category)).map(item => (
                    <tr key={item.id} className="group" style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="py-3 px-4 font-bold">{item.name}</td>
                      <td className="py-3 px-4"><span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: 'var(--bg-3)', color: 'var(--fg-3)' }}>{item.category}</span></td>
                      <td className="py-3 px-4 text-sm font-mono" style={{ color: 'var(--green)' }}>{item.price || '—'}</td>
                      <td className="py-3 px-4 text-sm font-mono" style={{ color: 'var(--fg-3)' }}>{item.importTime || '—'}</td>
                      <td className="py-3 px-4 text-sm font-mono" style={{ color: 'var(--accent)' }}>{item.shipmentPower || '—'}</td>
                      <td className="py-3 px-4 text-center">
                        <button onClick={() => setViewItem(item)} className="font-bold" style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', borderBottom: '1px dotted var(--accent)', fontSize: 13 }}>{item.count}</button>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {canEdit ? (
                        <div className="flex justify-end gap-2">
                          <button onClick={async () => {
                            const res = await showForm("Edit Import", [
                              { name: 'name', label: 'Name', type: 'text', default: item.name },
                              { name: 'category', label: 'Category', type: 'text', default: item.category },
                              { name: 'tier', label: 'Tier', type: 'text', default: item.tier },
                              { name: 'price', label: 'Price', type: 'text', default: item.price || '' },
                              { name: 'importTime', label: 'Import Time', type: 'text', default: item.importTime || '' },
                              { name: 'shipmentPower', label: 'Shipment Power', type: 'text', default: item.shipmentPower || '' }
                            ]);
                            if (!res) return;
                            const payload = await validItem(res);
                            if (payload && await act(() => editImportItem(item.id, payload))) refresh();
                          }} style={{ fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>Edit</button>
                          <button onClick={() => removeItem(item)} style={{ fontSize: 11, color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>Del</button>
                        </div>
                        ) : <span style={{ fontSize: 11, color: 'var(--fg-4)' }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {viewItem && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }} onClick={() => setViewItem(null)} />
          <div style={{ position: 'relative', width: '100%', maxWidth: 400, background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
            <div className="p-5 flex justify-between items-center" style={{ borderBottom: '1px solid var(--border)' }}>
              <span className="font-bold uppercase">{viewItem.name}</span>
              <button onClick={() => setViewItem(null)} style={{ color: 'var(--fg-4)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
            <div className="p-5 max-h-64 overflow-y-auto scr space-y-1">
              <div className="text-[10px] font-bold uppercase mb-2" style={{ color: 'var(--fg-4)' }}>Authorized Factions</div>
              {viewItem.authorizedFactions.map(f => <div key={f} className="p-2.5 rounded" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>{f}</div>)}
              {viewItem.authorizedFactions.length === 0 && <div className="text-sm italic" style={{ color: 'var(--fg-4)' }}>None assigned.</div>}
            </div>
          </div>
        </div>
      )}
    </OperationsShell>
  );
}
