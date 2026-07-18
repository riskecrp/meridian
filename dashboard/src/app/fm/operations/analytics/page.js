"use client";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../lib/useAuth";
import { useDialog } from "../../../../lib/useDialog";
import { getAnalytics, getPendingDeletions, resolveDeletion, getPendingExecutions, executeRPChange, approveRPChange, denyRPChange } from "../actions";
import { st } from "../_shared/styles";
import OperationsShell from "../_shared/Shell";

export default function AnalyticsPage() {
  const auth = useAuth();
  const { showConfirm, showForm, showPrompt } = useDialog();

  const [analytics, setAnalytics] = useState({});
  const [deletions, setDeletions] = useState([]);
  const [executions, setExecutions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (auth.loading || auth.level < 3) return;
    refresh();
  }, [auth.loading, auth.level]);

  const refresh = async () => {
    setLoading(true);
    const [a, d, e] = await Promise.all([getAnalytics(), getPendingDeletions(), getPendingExecutions()]);
    setAnalytics(a); setDeletions(d); setExecutions(e); setLoading(false);
  };

  if (auth.loading) return <div className="p-10 text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading...</div>;
  if (auth.level < 3) return <div className="p-10" style={{color:'var(--red)'}}>Access denied.</div>;
  if (loading) return <div className="p-10 text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading...</div>;

  return (
    <OperationsShell title="Analytics">
      <div className="space-y-6">
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
                    ) : (
                      <>{ex.old_value} → <b style={{ color: 'var(--fg-0)' }}>{ex.new_value}</b></>
                    )}
                  </div>
                  <div className="text-[10px] mb-3" style={{ color: 'var(--fg-4)' }}>By: {ex.requested_by}</div>
                  <div className="text-[10px] font-bold mb-2" style={{color: ex.status==='RP_DONE'?'var(--green)':ex.status==='APPROVED'?'var(--accent)':'var(--amber)'}}>{ex.status}</div>
                  <div className="flex gap-2 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                    {ex.status === 'PENDING' && <>
                      <button style={st.btnGhost} onClick={async () => { const r = await showPrompt('Denial reason:',''); if (r?.trim()) { await denyRPChange(ex.id, r.trim()); refresh(); } }}>Deny</button>
                      <button style={{ ...st.btn, flex: 1, background:'var(--green)' }} onClick={async () => { await approveRPChange(ex.id); refresh(); }}>Approve</button>
                    </>}
                    {ex.status === 'APPROVED' && <span style={{fontSize:11,color:'var(--fg-4)',fontStyle:'italic'}}>Awaiting RP confirmation from team lead.</span>}
                    {ex.status === 'RP_DONE' && (
                      <button style={{ ...st.btn, flex: 1 }} onClick={async () => {
                        if (ex.type === 'NPC') {
                          const res = await showForm("Execute NPC Swap", [{ name: 'npcName', label: 'Final NPC Name', type: 'text' }, { name: 'npcPos', label: 'TP Position', type: 'text' }]);
                          if (res && res.npcName) { await executeRPChange(ex.id, res); refresh(); }
                        } else {
                          if (await showConfirm('Execute this change?')) { await executeRPChange(ex.id, {}); refresh(); }
                        }
                      }}>Execute</button>
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
                    <button style={st.btnGhost} onClick={async () => { await resolveDeletion(req.id, false); refresh(); }}>Reject</button>
                    <button style={{ ...st.btnDanger, flex: 1 }} onClick={async () => { await resolveDeletion(req.id, true); refresh(); }}>Approve Delete</button>
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
