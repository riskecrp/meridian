"use client";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../lib/useAuth";
import { useDialog } from "../../../../lib/useDialog";
import { getAuditLog, deleteAuditLogEntry } from "../actions";
import { st } from "../_shared/styles";
import OperationsShell from "../_shared/Shell";

export default function AuditPage() {
  const auth = useAuth();
  const { showConfirm } = useDialog();
  const [auditLog, setAuditLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [auditSearch, setAuditSearch] = useState('');

  useEffect(() => {
    if (auth.loading || (auth.level < 3 && !auth.isEventTeam)) return;
    refresh();
  }, [auth.loading, auth.level]);

  const refresh = async () => { setLoading(true); setAuditLog(await getAuditLog(200)); setLoading(false); };

  if (auth.loading) return <div className="p-10 text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading...</div>;
  if (auth.level < 3 && !auth.isEventTeam) return <div className="p-10" style={{color:'var(--red)'}}>Access denied.</div>;
  if (loading) return <div className="p-10 text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading...</div>;

  return (
    <OperationsShell title="Audit Log" docs={[{"title": "Staff Management", "label": "Staff Management Guide", "minLevel": 3}]} authLevel={auth?.level || 3}>
      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.18em', color:'var(--fg-4)', fontFamily:'var(--font-mono)' }}>Last 200 Entries</div>
          <input style={{ ...st.input, maxWidth: 300 }} placeholder="Search actor, action, target..." value={auditSearch} onChange={e => setAuditSearch(e.target.value)} />
        </div>
        <div className="sec-card" style={{ maxHeight:'calc(100vh - 220px)', overflowY:'auto' }}>
          <table className="dtable">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Action</th>
                <th>Target</th>
                <th>Details</th>
                <th>Actor</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {auditLog.filter(log => {
                if (!auditSearch) return true;
                const q = auditSearch.toLowerCase();
                // 'bot' is searchable too, so "show me what the bot did" is one word.
                return (log.actor_name||'').toLowerCase().includes(q)||(log.action||'').toLowerCase().includes(q)||(log.target_type||'').toLowerCase().includes(q)||(log.target_label||'').toLowerCase().includes(q)||(log.details||'').toLowerCase().includes(q)||(log.source||'').toLowerCase().includes(q);
              }).map(log => (
                <tr key={log.id} className="group">
                  <td style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--fg-4)', whiteSpace:'nowrap' }}>{log.timestamp}</td>
                  <td style={{ fontWeight:700, whiteSpace:'nowrap', color:log.action.includes('DELETE')||log.action==='REJECT'?'var(--red)':log.action.includes('CREATE')?'var(--green)':'var(--accent)' }}>{log.action}</td>
                  <td style={{ color:'var(--fg-3)', whiteSpace:'nowrap' }}>{log.target_type}</td>
                  <td style={{ maxWidth:320, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{log.target_label||log.details}</td>
                  {/* Both halves write here now. The badge says which, because
                      "Promotion Bot created a task" and "someone created a task"
                      are different events and used to look identical. */}
                  <td style={{ color:'var(--fg-3)', whiteSpace:'nowrap' }}>
                    {log.actor_name}
                    {log.source === 'bot' && (
                      <span style={{ marginLeft:6, fontSize:9, fontWeight:700, letterSpacing:'0.1em',
                        padding:'1px 5px', borderRadius:4, background:'var(--accent-bg)', color:'var(--accent)',
                        fontFamily:'var(--font-mono)' }} title="Performed through the Discord bot">BOT</span>
                    )}
                  </td>
                  <td><button onClick={async()=>{if(await showConfirm('Delete this audit entry?')){await deleteAuditLogEntry(log.id);refresh();}}} className="opacity-0 group-hover:opacity-100 transition-opacity" style={{color:'var(--red)',background:'none',border:'none',cursor:'pointer',fontSize:10,fontWeight:700}}>Del</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </OperationsShell>
  );
}
