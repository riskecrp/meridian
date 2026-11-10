"use client";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../lib/useAuth";
import { useDialog } from "../../../../lib/useDialog";
import { getAnalytics, getPendingDeletions, resolveDeletion, getPendingExecutions, executeRPChange, approveRPChange, denyRPChange, getRPExecutionPreview } from "../actions";
import { st } from "../_shared/styles";
import OperationsShell from "../_shared/Shell";

export default function AnalyticsPage() {
  const auth = useAuth();
  const { showConfirm, showForm, showPrompt, showAlert } = useDialog();

  const [analytics, setAnalytics] = useState({});
  const [deletions, setDeletions] = useState([]);
  const [executions, setExecutions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (auth.loading || auth.level < 3) return;
    refresh();
  }, [auth.loading, auth.level]);

  const refresh = async () => {
    setLoading(true); setError('');
    try {
      const [a, d, e] = await Promise.all([getAnalytics(), getPendingDeletions(), getPendingExecutions()]);
      setAnalytics(a || {}); setDeletions(d || []); setExecutions(e || []);
    } catch (e) { setError(e?.message || 'Could not load analytics.'); }
    setLoading(false);
  };
  // Approve / deny / execute / resolve: `{ok:false}` (state-machine refusals,
  // unknown ids) and thrown auth errors are shown, never swallowed by a refresh.
  const act = async (fn) => {
    let r; try { r = await fn(); } catch (e) { await showAlert(e?.message || 'Failed'); return false; }
    if (r && r.ok === false) { await showAlert(r.error || 'Failed'); return false; }
    return true;
  };
  // Execute with the server's preview of what will be rewritten (shared/rpChanges.js
  // executionPreview — the same lookup executeRPChange runs). NPC asks for the final
  // name/position (and which NPC when the turf+type match is ambiguous); TURF may
  // take a shipment power; HQ / PROPERTY / Other confirm the summary.
  const executeWithPreview = async (ex) => {
    let pv;
    try { pv = await getRPExecutionPreview(ex.id); } catch (e) { await showAlert(e?.message || 'Could not load the execution preview.'); return false; }
    const type = String(pv?.type || ex.type || 'Other').toUpperCase();
    if (type === 'NPC') {
      const cands = pv?.candidates || [];
      const fields = [];
      if (!pv?.ok && cands.length > 1) {
        fields.push({ name: 'npcId', label: 'Which NPC? (several match the turf + type)', type: 'select', placeholder: 'Select NPC…', options: cands.map(c => ({ value: String(c.id), label: `${c.name} (${c.npc_type}) — ${c.turf}` })) });
      } else if (!pv?.ok) { await showAlert(pv?.error || 'Nothing to rewrite.'); return false; }
      fields.push({ name: 'npcName', label: 'Final NPC Name', type: 'text' }, { name: 'npcPos', label: 'TP Position', type: 'text' });
      const res = await showForm(pv?.ok ? `Execute NPC Swap — ${pv.summary}` : 'Execute NPC Swap', fields);
      if (!res) return false;
      if (fields[0].name === 'npcId' && !res.npcId) { await showAlert('Pick which NPC to rewrite.'); return false; }
      if (!res.npcName?.trim() || !res.npcPos?.trim()) { await showAlert('Final NPC name and TP position are both required.'); return false; }
      const data = { npcName: res.npcName.trim(), npcPos: res.npcPos.trim() };
      if (res.npcId) data.npcId = Number(res.npcId);
      return act(() => executeRPChange(ex.id, data));
    }
    if (!pv?.ok) { await showAlert(pv?.error || 'This request cannot be executed.'); return false; }
    if (type === 'TURF' && pv.mode === 'turf') {
      const res = await showForm(`Execute turf change — ${pv.summary}`, [{ name: 'shipmentPower', label: 'Shipment power (optional — blank keeps the current value)', type: 'text' }]);
      if (!res) return false;
      const data = {};
      if (res.shipmentPower?.trim()) data.shipmentPower = res.shipmentPower.trim();
      return act(() => executeRPChange(ex.id, data));
    }
    const what = type === 'OTHER' ? 'this change' : `this ${type} change`;
    if (!(await showConfirm(`Execute ${what} for ${ex.faction}?\n\n${pv.summary}`))) return false;
    return act(() => executeRPChange(ex.id, {}));
  };

  if (auth.loading) return <div className="p-10 text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading...</div>;
  if (auth.level < 3) return <div className="p-10" style={{color:'var(--red)'}}>Access denied.</div>;
  if (loading) return <div className="p-10 text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading...</div>;

  return (
    <OperationsShell title="Analytics">
      <div className="space-y-6">
        {error && <div style={{ color:'var(--red)', fontSize:12 }}>{error}</div>}
        {executions.length > 0 && (
          <div className="p-6 rounded-xl" style={{ background: 'var(--accent-bg)', border: '1px solid var(--accent-bg)' }}>
            <div className="text-[12px] font-black uppercase tracking-widest mb-4 flex items-center gap-2" style={{ color: 'var(--accent)' }}>
              <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--accent)' }} />
              Pending RP Changes ({executions.length})
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {executions.map(ex => (
                <div key={ex.id} className="p-5 rounded-lg" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', minHeight: 160 }}>
                  <div className="flex justify-between mb-3">
                    <span className="text-[11px] font-bold uppercase">{ex.type}</span>
                    <span className="text-[10px] font-mono" style={{ color: 'var(--fg-4)' }}>{ex.date}</span>
                  </div>
                  <div className="text-base font-bold mb-2" style={{ color: 'var(--accent)' }}>{ex.faction}</div>
                  <div className="text-sm leading-relaxed mb-2" style={{ color: 'var(--fg-3)' }}>
                    {ex.type === 'NPC' ? (
                      <>{ex.turf}: {ex.old_value} → <b style={{ color: 'var(--fg-0)' }}>{ex.new_value}</b>
                        {ex.npcDetails && <div className="mt-1 text-[11px]" style={{ color: 'var(--amber)' }}>NPCs: {ex.npcDetails}</div>}
                      </>
                    ) : ex.type === 'TURF' ? (
                      <>Turf {ex.turf}: {ex.old_value} → <b style={{ color: 'var(--fg-0)' }}>{ex.new_value}</b></>
                    ) : ex.type === 'PROPERTY' ? (
                      <>Property: {ex.old_value} → <b style={{ color: 'var(--fg-0)' }}>{ex.new_value}</b></>
                    ) : (
                      <>{ex.old_value} → <b style={{ color: 'var(--fg-0)' }}>{ex.new_value}</b></>
                    )}
                  </div>
                  <div className="text-[10px] mb-3" style={{ color: 'var(--fg-4)' }}>By: {ex.requested_by}</div>
                  <div className="text-[10px] font-bold mb-2" style={{color: ex.status==='RP_DONE'?'var(--green)':ex.status==='APPROVED'?'var(--accent)':'var(--amber)'}}>{ex.status}</div>
                  <div className="flex gap-2 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                    {ex.status === 'PENDING' && <>
                      <button style={st.btnGhost} onClick={async () => { const r = await showPrompt('Denial reason:',''); if (r?.trim()) { if (await act(() => denyRPChange(ex.id, r.trim()))) refresh(); } }}>Deny</button>
                      <button style={{ ...st.btn, flex: 1, background:'var(--green)' }} onClick={async () => { if (await act(() => approveRPChange(ex.id))) refresh(); }}>Approve</button>
                    </>}
                    {ex.status === 'APPROVED' && <span style={{fontSize:11,color:'var(--fg-4)',fontStyle:'italic'}}>Awaiting RP confirmation from team lead.</span>}
                    {ex.status === 'RP_DONE' && (
                      <button style={{ ...st.btn, flex: 1 }} onClick={async () => { if (await executeWithPreview(ex)) refresh(); }}>Execute</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {deletions.length > 0 && (
          <div className="p-6 rounded-xl" style={{ background: 'var(--red-bg)', border: '1px solid var(--red-bg)' }}>
            <div className="text-[12px] font-black uppercase tracking-widest mb-4" style={{ color: 'var(--red)' }}>Pending Deletions ({deletions.length})</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {deletions.map(req => (
                <div key={req.id} className="p-5 rounded-lg" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', minHeight: 140 }}>
                  <div className="flex justify-between mb-2">
                    <span className="text-[11px] font-bold uppercase">{req.content_type}</span>
                    <span className="text-[10px] font-mono" style={{ color: 'var(--fg-4)' }}>{req.created_at}</span>
                  </div>
                  <div className="text-sm mb-2" style={{ color: 'var(--fg-3)' }}>By: <span style={{ color: 'var(--red)' }}>{req.requested_by}</span></div>
                  <p className="text-sm italic p-3 rounded mb-3" style={{ background: 'var(--bg-2)', color: 'var(--fg-2)', borderLeft: '3px solid var(--red)' }}>{req.original_text?.substring(0, 150)}</p>
                  <div className="flex gap-2 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                    <button style={st.btnGhost} onClick={async () => { if (await act(() => resolveDeletion(req.id, false))) refresh(); }}>Reject</button>
                    <button style={{ ...st.btnDanger, flex: 1 }} onClick={async () => { if (await showConfirm(`Permanently delete this ${req.content_type}?`)) { if (await act(() => resolveDeletion(req.id, true))) refresh(); } }}>Approve Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
          <div className="sec-card">
            <div className="sec-card-hdr">Server Analytics</div>
            <div style={{ padding:'10px 14px', display:'flex', flexDirection:'column', gap:6 }}>
              {[['Total Factions', analytics.total_factions, 'var(--accent)'], ['Total Properties', analytics.total_properties, 'var(--green)'], ['Confiscated', analytics.confiscated_assets, 'var(--amber)'], ['Open Tasks', analytics.open_tasks, 'var(--fg-0)']].map(([k, v, col]) => (
                <div key={k} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 12px', background:'var(--bg-2)', borderRadius:6 }}>
                  <span style={{ fontSize:12, color:'var(--fg-3)' }}>{k}</span>
                  <span style={{ fontSize:20, fontWeight:300, fontFamily:'var(--font-mono)', color:col }}>{v || 0}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="sec-card">
            <div className="sec-card-hdr">Staff Activity — 30 Days</div>
            <div style={{ padding:'10px 14px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, maxHeight:280, overflowY:'auto' }} className="scr">
              {(analytics.activity || []).sort((a,b) => b.scene_count - a.scene_count).map((s, i) => (
                <div key={i} style={{ padding:'8px 10px', background:'var(--bg-2)', borderRadius:6, display:'flex', alignItems:'center', justifyContent:'space-between', borderLeft:`2px solid ${s.scene_count===0?'var(--red)':'var(--border)'}` }}>
                  <span style={{ fontSize:11, color:'var(--fg-3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1, marginRight:8 }}>{s.name}</span>
                  <span style={{ fontSize:16, fontWeight:300, fontFamily:'var(--font-mono)', color:s.scene_count===0?'var(--red)':'var(--fg-0)', flexShrink:0 }}>{s.scene_count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </OperationsShell>
  );
}
