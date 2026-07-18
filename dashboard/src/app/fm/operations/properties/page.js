"use client";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../lib/useAuth";
import { useDialog } from "../../../../lib/useDialog";
import { getGlobalProperties, addGlobalProperty, assignProperty, confiscateProperty, deleteProperty, editPropertyDetail } from "../actions";
import { st } from "../_shared/styles";
import OperationsShell from "../_shared/Shell";

export default function PropertiesPage() {
  const auth = useAuth();
  const { showConfirm, showPrompt, showForm } = useDialog();

  // L2 + Lead Storytellers get read-only access; L3 / Event Team can edit.
  const canView = auth.level >= 2 || auth.isEventTeam || auth.isLeadStoryteller;
  const canEdit = auth.level >= 3 || auth.isEventTeam;

  const [props, setProps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [propSearch, setPropSearch] = useState("");
  const [propFilter, setPropFilter] = useState("all");
  const [expanded, setExpanded] = useState(null);
  const [editingDetail, setEditingDetail] = useState(null); // { id, address, type, isHQ, owner, notes }

  useEffect(() => {
    if (auth.loading || !canView) return;
    refresh();
  }, [auth.loading, auth.level]);

  const refresh = async () => { setLoading(true); setProps(await getGlobalProperties()); setLoading(false); };

  const isUnassigned = (f) => !f || f.trim() === '' || f.toLowerCase() === 'none';
  const filteredProps = props.filter(p => {
    if (propSearch && !p.address?.toLowerCase().includes(propSearch.toLowerCase()) && !p.faction?.toLowerCase().includes(propSearch.toLowerCase()) && !p.current_owner?.toLowerCase().includes(propSearch.toLowerCase())) return false;
    if (propFilter === 'active') return !p.confiscated && !isUnassigned(p.faction);
    if (propFilter === 'confiscated') return p.confiscated;
    if (propFilter === 'unassigned') return !p.confiscated && isUnassigned(p.faction);
    return true;
  });

  if (auth.loading) return <div className="p-10 text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading...</div>;
  if (!canView) return <div className="p-10" style={{color:'var(--red)'}}>Access denied.</div>;
  if (loading) return <div className="p-10 text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading...</div>;

  return (
    <OperationsShell title="Properties" docs={[{"title": "Faction Administration", "label": "Inventory & Properties Guide", "minLevel": 3}]} authLevel={auth?.level || 3}>
      <div className="space-y-4">
        <div className="flex flex-col md:flex-row gap-3 justify-between">
          <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'var(--bg-2)' }}>
            {['all', 'active', 'confiscated', 'unassigned'].map(f => (
              <button key={f} style={st.tab(propFilter === f)} onClick={() => setPropFilter(f)}>{f}</button>
            ))}
          </div>
          <div className="flex gap-3">
            <input style={{ ...st.input, width: 250 }} placeholder="Search address, faction, owner..." value={propSearch} onChange={e => setPropSearch(e.target.value)} />
            {canEdit && <button style={st.btn} onClick={async () => {
              const res = await showForm("Add Property", [
                { name: 'address',  label: 'Address',                    type: 'text' },
                { name: 'faction',  label: 'Faction (blank=unassigned)', type: 'text' },
                { name: 'type',     label: 'Type',                       type: 'text', placeholder: 'e.g. HQ, Warehouse, Property' },
                { name: 'isHQ',     label: 'Mark as HQ?',                type: 'checkbox' },
                { name: 'owner',    label: 'Current Owner',              type: 'text', placeholder: 'Character name' },
                { name: 'notes',    label: 'Notes',                      type: 'textarea', placeholder: 'Any relevant details...' },
              ]);
              if (res?.address) { await addGlobalProperty({ address: res.address, faction: res.faction || '', type: res.type || 'Property', isHQ: !!res.isHQ, owner: res.owner || '', notes: res.notes || '' }); refresh(); }
            }}>Add +</button>}
          </div>
        </div>

        <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
          <table className="w-full text-left">
            <thead>
              <tr style={{ background: 'var(--bg-2)' }}>
                <th className="py-3 px-4 text-[11px] font-bold uppercase" style={{ color: 'var(--fg-4)' }}>Status</th>
                <th className="py-3 px-4 text-[11px] font-bold uppercase" style={{ color: 'var(--fg-4)' }}>Faction</th>
                <th className="py-3 px-4 text-[11px] font-bold uppercase" style={{ color: 'var(--fg-4)' }}>Address</th>
                <th className="py-3 px-4 text-[11px] font-bold uppercase" style={{ color: 'var(--fg-4)' }}>Owner</th>
                <th className="py-3 px-4 text-right text-[11px] font-bold uppercase" style={{ color: 'var(--fg-4)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredProps.map(p => {
                const none   = isUnassigned(p.faction);
                const status = p.confiscated ? 'CONF' : none ? 'NONE' : 'ACTIVE';
                const col    = p.confiscated ? 'var(--red)' : none ? 'var(--fg-4)' : 'var(--green)';
                const isExp  = expanded === p.id;
                const isEdit = editingDetail?.id === p.id;
                return (
                  <>
                    <tr key={p.id} style={{ borderTop: '1px solid var(--border)', background: isExp ? 'rgba(255,255,255,0.02)' : 'transparent' }}>
                      <td className="py-3 px-4">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ color: col }}>{status}</span>
                      </td>
                      <td className="py-3 px-4 font-medium">{none ? <span style={{ color: 'var(--fg-4)' }}>—</span> : p.faction}</td>
                      <td className="py-3 px-4">
                        <div className="text-sm font-mono" style={{ color: 'var(--fg-2)' }}>{p.address}</div>
                        {p.notes && <div style={{ fontSize: 11, color: 'var(--fg-4)', marginTop: 2, lineHeight: 1.4 }}>{p.notes}</div>}
                      </td>
                      <td className="py-3 px-4 text-sm" style={{ color: p.current_owner ? 'var(--fg-1)' : 'var(--fg-4)' }}>
                        {p.current_owner || <span style={{ fontStyle: 'italic', fontSize: 11 }}>—</span>}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {canEdit ? (
                        <div className="flex justify-end gap-2">
                          <button style={{ fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer' }}
                            onClick={() => {
                              if (isExp && isEdit) { setExpanded(null); setEditingDetail(null); }
                              else { setExpanded(p.id); setEditingDetail({ id: p.id, address: p.address, type: p.type || 'Property', isHQ: !!p.is_hq, owner: p.current_owner || '', notes: p.notes || '' }); }
                            }}>
                            {isExp && isEdit ? 'Close' : 'Edit'}
                          </button>
                          <button style={{ ...st.btnGhost, padding: '4px 10px' }} onClick={async () => { const f = await showPrompt("Assign to faction:", p.faction); if (f !== null) { await assignProperty(p.id, f); refresh(); } }}>Assign</button>
                          {!p.confiscated && !none && <button style={{ fontSize: 11, color: 'var(--amber)', background: 'none', border: 'none', cursor: 'pointer' }} onClick={async () => { await confiscateProperty(p.id); refresh(); }}>Conf.</button>}
                          <button style={{ fontSize: 11, color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer' }} onClick={async () => { if (await showConfirm('Delete this property?')) { await deleteProperty(p.id); refresh(); } }}>Del</button>
                        </div>
                        ) : <span style={{ fontSize: 11, color: 'var(--fg-4)' }}>—</span>}
                      </td>
                    </tr>
                    {isExp && isEdit && (
                      <tr key={`${p.id}-edit`} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                        <td colSpan={5} style={{ padding: '12px 16px 16px', background: 'rgba(0,0,0,0.18)' }}>
                          <div className="flex flex-col md:flex-row gap-4 flex-wrap">
                            <div style={{ flex: '0 0 220px' }}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Address</div>
                              <input style={{ ...st.input, fontSize: 13 }} value={editingDetail.address} onChange={e => setEditingDetail(d => ({ ...d, address: e.target.value }))} />
                            </div>
                            <div style={{ flex: '0 0 140px' }}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Type</div>
                              <input style={{ ...st.input, fontSize: 13 }} placeholder="e.g. HQ, Warehouse" value={editingDetail.type} onChange={e => setEditingDetail(d => ({ ...d, type: e.target.value }))} />
                            </div>
                            <div style={{ flex: '0 0 100px', display: 'flex', flexDirection: 'column' }}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>HQ?</div>
                              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginTop: 8 }}>
                                <input type="checkbox" checked={editingDetail.isHQ} onChange={e => setEditingDetail(d => ({ ...d, isHQ: e.target.checked }))} />
                                <span style={{ fontSize: 12 }}>Mark as HQ</span>
                              </label>
                            </div>
                            <div style={{ flex: '0 0 200px' }}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Current Owner</div>
                              <input style={{ ...st.input, fontSize: 13 }} placeholder="Character name..." value={editingDetail.owner} onChange={e => setEditingDetail(d => ({ ...d, owner: e.target.value }))} />
                            </div>
                            <div style={{ flex: 1, minWidth: 200 }}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Notes</div>
                              <textarea rows={2} style={{ ...st.input, fontSize: 13, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} placeholder="Any relevant details..." value={editingDetail.notes} onChange={e => setEditingDetail(d => ({ ...d, notes: e.target.value }))} />
                            </div>
                          </div>
                          <div className="flex gap-2 mt-3">
                            <button style={st.btn} onClick={async () => {
                              await editPropertyDetail(p.id, { address: editingDetail.address, type: editingDetail.type, isHQ: editingDetail.isHQ, owner: editingDetail.owner, notes: editingDetail.notes });
                              setExpanded(null); setEditingDetail(null); refresh();
                            }}>Save</button>
                            <button style={st.btnGhost} onClick={() => { setExpanded(null); setEditingDetail(null); }}>Cancel</button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
          {filteredProps.length === 0 && (
            <div className="py-10 text-center text-sm" style={{ color: 'var(--fg-4)' }}>No properties found.</div>
          )}
        </div>
      </div>
    </OperationsShell>
  );
}
