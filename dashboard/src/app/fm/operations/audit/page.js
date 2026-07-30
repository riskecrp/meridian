"use client";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../lib/useAuth";
import { useDialog } from "../../../../lib/useDialog";
import { getAuditLog, deleteAuditLogEntry, getSyncStatus } from "../actions";
import { st } from "../_shared/styles";
import OperationsShell from "../_shared/Shell";

export default function AuditPage() {
  const auth = useAuth();
  const { showConfirm } = useDialog();
  const [auditLog, setAuditLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [auditSearch, setAuditSearch] = useState('');
  const [jobs, setJobs] = useState([]);

  useEffect(() => {
    if (auth.loading || (auth.level < 3 && !auth.isEventTeam)) return;
    refresh();
  }, [auth.loading, auth.level]);

  const refresh = async () => {
    setLoading(true);
    const [log, status] = await Promise.all([getAuditLog(200), getSyncStatus()]);
    setAuditLog(log); setJobs(status); setLoading(false);
  };

  // A job is judged against its own cadence: no success in three times the
  // interval it claims to run at means it has stopped, whether or not it ever
  // reported an error. A silent stall is the failure journald cannot show you.
  const jobState = (j) => {
    if (!j.last_ok_at) return { tone: 'var(--red)', dot: '●', text: j.last_error ? 'failing, never succeeded' : 'never run' };
    const okAgo = (Date.now() - new Date(j.last_ok_at.replace(' ', 'T') + 'Z').getTime()) / 60000;
    if (j.consecutive_failures > 0) return { tone: 'var(--red)', dot: '●', text: `${j.consecutive_failures} failure${j.consecutive_failures === 1 ? '' : 's'} in a row` };
    if (j.expected_every_minutes > 0 && okAgo > j.expected_every_minutes * 3) {
      return { tone: 'var(--amber)', dot: '●', text: `nothing for ${okAgo < 120 ? Math.round(okAgo) + 'm' : Math.round(okAgo / 60) + 'h'}` };
    }
    return { tone: 'var(--green)', dot: '●', text: okAgo < 90 ? `${Math.max(0, Math.round(okAgo))}m ago` : `${Math.round(okAgo / 60)}h ago` };
  };

  if (auth.loading) return <div className="p-10 text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading...</div>;
  if (auth.level < 3 && !auth.isEventTeam) return <div className="p-10" style={{color:'var(--red)'}}>Access denied.</div>;
  if (loading) return <div className="p-10 text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading...</div>;

  return (
    <OperationsShell title="Audit Log" docs={[{"title": "Staff Management", "label": "Staff Management Guide", "minLevel": 3}]} authLevel={auth?.level || 3}>
      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        {/* Background job health. Sits above the log because this is the page
            people open when something looks wrong, and a stalled sync is the most
            likely answer. */}
        {jobs.length > 0 && (
          <div className="sec-card" style={{ padding:'10px 14px' }}>
            <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.18em', color:'var(--fg-4)', fontFamily:'var(--font-mono)', marginBottom:8 }}>
              Background jobs
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(240px, 1fr))', gap:'8px 18px' }}>
              {jobs.map(j => {
                const s = jobState(j);
                return (
                  <div key={j.job} style={{ display:'flex', alignItems:'baseline', gap:8, minWidth:0 }}>
                    <span style={{ color:s.tone, fontSize:11 }}>{s.dot}</span>
                    <div style={{ minWidth:0 }}>
                      <div style={{ fontSize:12, color:'var(--fg-1)' }}>
                        {j.label || j.job}{' '}
                        <span style={{ color:s.tone, fontSize:11 }}>{s.text}</span>
                      </div>
                      <div style={{ fontSize:10.5, color:'var(--fg-3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}
                        title={j.last_error || j.last_detail}>
                        {j.last_error || j.last_detail || '—'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

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
