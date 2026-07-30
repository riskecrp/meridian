"use client";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../lib/useAuth";
import { useDialog } from "../../../../lib/useDialog";
import { ui } from "../../../../lib/ui.js";
import {
  listReminders, listChannels, getTargetOptions,
  createReminder, updateReminder, deleteReminder,
  getReminderProgress, adminCompleteInstance, forceSendRecurringReminder,
} from "./actions";

const st = {
  ...ui,
};

const CHANNEL_LABELS = {
  global_ping_channel: '#meridian-database (global)',
  event_announce_channel: '#up-and-coming',
  leadership_channel: '#management-board',
  team_lead_channel: '#team-leads',
};

export default function RemindersPage() {
  const auth = useAuth();
  const { showAlert, showConfirm } = useDialog();
  const [reminders, setReminders] = useState([]);
  const [channels, setChannels] = useState([]);
  const [targets, setTargets] = useState({ teams:[], staff:[], roles:[] });
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [progressFor, setProgressFor] = useState(null);
  const [progressRows, setProgressRows] = useState([]);

  const refresh = async () => {
    const [r, c, t] = await Promise.all([listReminders(), listChannels(), getTargetOptions()]);
    setReminders(r); setChannels(c); setTargets(t); setLoading(false);
  };

  useEffect(() => {
    if (auth.loading) return;
    if (auth.level < 2) { setLoading(false); return; }
    refresh();
  }, [auth.loading, auth.level]);

  if (auth.loading || loading) return <div className="p-10 text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading...</div>;
  if (auth.level < 2) return <div className="p-10 text-sm" style={{color:'var(--red)'}}>L2+ required.</div>;

  const openProgress = async (rem) => {
    const now = new Date();
    const rows = await getReminderProgress(rem.id, now.getUTCFullYear(), now.getUTCMonth() + 1);
    setProgressFor(rem); setProgressRows(rows);
  };

  return (
    <div className="page-shell">
      <div className="page-hdr" style={{background:'linear-gradient(180deg,rgba(248,113,113,0.04) 0%,transparent 100%)'}}>
        <div className="accent-bar" style={{background:'linear-gradient(90deg,var(--red) 0%,transparent 60%)'}} />
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
          <div>
            <div className="page-hdr-tag" style={{color:'var(--red)'}}>Operations / Recurring Reminders</div>
            <h1>Recurring Reminders</h1>
            <div className="page-hdr-sub">Monthly tasks that ping a target on a set day</div>
          </div>
          <button style={{...st.btn,marginTop:4}} onClick={() => { setEditing(null); setShowForm(true); }}>+ New</button>
        </div>
      </div>
      <div className="page-body scr" style={{display:'flex',flexDirection:'column',gap:10}}>

      {reminders.length === 0 && <div className="empty-state">No reminders yet. Create one to get started.</div>}

      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {reminders.map(r => {
          const chKey = channels.find(c => c.channel_id === r.channel_id)?.key || r.channel_id;
          const chLabel = CHANNEL_LABELS[chKey] || chKey;
          const targetLabel = labelForTarget(r.target_type, r.target_id, targets);
          const canEdit = auth.level >= 3 || r.created_by_id === auth.id;
          return (
            <div key={r.id} className="rounded-xl p-4" style={{background: r.active ? 'var(--bg-1)' : 'var(--bg-2)', border:'1px solid var(--border)', opacity: r.active ? 1 : 0.55}}>
              <div className="flex justify-between items-start gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="text-base font-bold">{r.title}</h3>
                    {!r.active && <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded" style={{background:'var(--bg-3)', color:'var(--fg-4)'}}>Inactive</span>}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]" style={{color:'var(--fg-3)'}}>
                    <span><strong>Target:</strong> {r.target_type}: {targetLabel}</span>
                    <span><strong>Channel:</strong> {chLabel}</span>
                    <span><strong>Ping:</strong> {r.ping_day}{ord(r.ping_day)} / <strong>Due:</strong> {r.due_day}{ord(r.due_day)}</span>
                  </div>
                  {r.body && <p className="text-xs mt-2 whitespace-pre-wrap" style={{color:'var(--fg-2)'}}>{r.body.substring(0, 200)}{r.body.length > 200 ? '...' : ''}</p>}
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  {auth.level >= 3 && r.active && <button style={st.btnGhost} onClick={() => openProgress(r)}>Progress</button>}
                  {auth.level >= 3 && r.active && <button style={{...st.btnGhost, color:'var(--accent)'}} onClick={async () => {
                    if (await showConfirm('Force-send "' + r.title + '" now? Pings the channel and creates this month\'s instances if missing.')) {
                      const res = await forceSendRecurringReminder(r.id);
                      if (!res.ok) { await showAlert(res.error || 'Failed'); return; }
                      await showAlert('Sent. ' + (res.recipientsCount || 0) + ' recipient(s) notified.');
                      refresh();
                    }
                  }}>Force Send</button>}
                  {canEdit && <button style={{...st.btnGhost, color:'var(--accent)'}} onClick={() => { setEditing(r); setShowForm(true); }}>Edit</button>}
                  {canEdit && r.active && <button style={{...st.btnGhost, color:'var(--red)'}} onClick={async () => { if (await showConfirm('Deactivate this reminder? Past instances stay in the DB.')) { await deleteReminder(r.id); refresh(); } }}>Delete</button>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {showForm && (
        <ReminderForm
          editing={editing}
          channels={channels}
          targets={targets}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); refresh(); }}
        />
      )}

      {progressFor && (
        <ProgressModal
          reminder={progressFor}
          rows={progressRows}
          onClose={() => { setProgressFor(null); setProgressRows([]); }}
          onAdmin={async (instId) => { await adminCompleteInstance(instId); openProgress(progressFor); }}
        />
      )}
      </div>
    </div>
  );
}

function ord(n) {
  if (n >= 11 && n <= 13) return 'th';
  const last = n % 10;
  return last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th';
}

function labelForTarget(type, id, targets) {
  if (type === 'User') return targets.staff.find(s => s.discord_id === id)?.display_name || id;
  if (type === 'Team') return targets.teams.find(t => t.team_id === id)?.team_name || id;
  if (type === 'Role') return targets.roles.find(r => r.role_id === id)?.key || id;
  return id;
}

function ReminderForm({ editing, channels, targets, onClose, onSaved }) {
  const [form, setForm] = useState({
    title: editing?.title || '',
    body: editing?.body || '',
    links: editing?.links || '',
    target_type: editing?.target_type || 'Role',
    target_id: editing?.target_id || '',
    channel_id: editing?.channel_id || '',
    ping_day: editing?.ping_day || 1,
    due_day: editing?.due_day || 10,
    active: editing?.active ?? 1,
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setErr('');
    if (!form.title.trim()) { setErr('Title required'); return; }
    if (!form.target_id) { setErr('Pick a target'); return; }
    if (!form.channel_id) { setErr('Pick a channel'); return; }
    setSubmitting(true);
    const res = editing ? await updateReminder(editing.id, form) : await createReminder(form);
    setSubmitting(false);
    if (!res.ok) { setErr(res.error || 'Failed'); return; }
    onSaved();
  };

  const targetOptions = form.target_type === 'User' ? targets.staff.map(s => ({ value: s.discord_id, label: s.display_name }))
    : form.target_type === 'Team' ? targets.teams.map(t => ({ value: t.team_id, label: t.team_name }))
    : targets.roles.map(r => ({ value: r.role_id, label: r.key }));

  return (
    <div style={{ position:'fixed', inset:0, zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', backdropFilter:'blur(8px)' }} onClick={onClose} />
      <div style={{ position:'relative', width:'100%', maxWidth:600, maxHeight:'90vh', overflowY:'auto', background:'var(--bg-1)', border:'1px solid var(--border)', borderRadius:16 }}>
        <div className="p-5" style={{borderBottom:'1px solid var(--border)'}}>
          <h3 className="text-lg font-bold uppercase tracking-tight">{editing ? 'Edit' : 'New'} Recurring Reminder</h3>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <div style={st.label}>Title *</div>
            <input style={st.input} value={form.title} onChange={e => setForm({...form, title: e.target.value})} placeholder="e.g. Monthly Faction Reviews" />
          </div>
          <div>
            <div style={st.label}>Body / Description</div>
            <textarea style={{...st.input, resize:'vertical'}} rows={4} value={form.body} onChange={e => setForm({...form, body: e.target.value})} placeholder="What needs to happen this month..." />
          </div>
          <div>
            <div style={st.label}>Reference Links (one per line)</div>
            <textarea style={{...st.input, resize:'vertical'}} rows={2} value={form.links} onChange={e => setForm({...form, links: e.target.value})} placeholder="https://ecrpfm.com/fm/leadership/reviews&#10;https://ecrpfm.com/fm/factions" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div style={st.label}>Target Type *</div>
              <select style={st.input} value={form.target_type} onChange={e => setForm({...form, target_type: e.target.value, target_id: ''})}>
                <option value="Role">Role</option>
                <option value="Team">Team</option>
                <option value="User">User</option>
              </select>
            </div>
            <div>
              <div style={st.label}>Target *</div>
              <select style={st.input} value={form.target_id} onChange={e => setForm({...form, target_id: e.target.value})}>
                <option value="">Select...</option>
                {targetOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <div style={st.label}>Discord Channel *</div>
            <select style={st.input} value={form.channel_id} onChange={e => setForm({...form, channel_id: e.target.value})}>
              <option value="">Select...</option>
              {channels.map(c => <option key={c.key} value={c.channel_id}>{CHANNEL_LABELS[c.key] || c.key}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div style={st.label}>Ping Day (1-31) *</div>
              <input type="number" min="1" max="31" style={st.input} value={form.ping_day} onChange={e => setForm({...form, ping_day: parseInt(e.target.value) || 1})} />
            </div>
            <div>
              <div style={st.label}>Due Day (1-31) *</div>
              <input type="number" min="1" max="31" style={st.input} value={form.due_day} onChange={e => setForm({...form, due_day: parseInt(e.target.value) || 1})} />
            </div>
          </div>
          {editing && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!form.active} onChange={e => setForm({...form, active: e.target.checked ? 1 : 0})} />
              <span className="text-xs" style={{color:'var(--fg-3)'}}>Active</span>
            </label>
          )}
          {err && <div className="text-xs" style={{color:'var(--red)'}}>{err}</div>}
        </div>
        <div className="p-4 flex justify-end gap-2" style={{borderTop:'1px solid var(--border)'}}>
          <button style={st.btnGhost} onClick={onClose}>Cancel</button>
          <button style={st.btn} onClick={submit} disabled={submitting}>{submitting ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

function ProgressModal({ reminder, rows, onClose, onAdmin }) {
  const completed = rows.filter(r => r.completed_at);
  const pending = rows.filter(r => !r.completed_at);
  return (
    <div style={{ position:'fixed', inset:0, zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', backdropFilter:'blur(8px)' }} onClick={onClose} />
      <div style={{ position:'relative', width:'100%', maxWidth:600, maxHeight:'90vh', overflowY:'auto', background:'var(--bg-1)', border:'1px solid var(--border)', borderRadius:16 }}>
        <div className="p-5" style={{borderBottom:'1px solid var(--border)'}}>
          <h3 className="text-lg font-bold uppercase tracking-tight">{reminder.title}</h3>
          <div className="text-[11px] mt-1" style={{color:'var(--fg-3)'}}>This month — {completed.length} / {rows.length} completed</div>
        </div>
        <div className="p-5 space-y-4">
          {rows.length === 0 && <div className="text-xs italic" style={{color:'var(--fg-4)'}}>No instances generated yet (will fire on day {reminder.ping_day}).</div>}
          {pending.length > 0 && (
            <div>
              <div style={st.label}>Pending ({pending.length})</div>
              <div className="space-y-1">
                {pending.map(p => (
                  <div key={p.id} className="flex justify-between items-center p-2 rounded" style={{background:'var(--bg-2)'}}>
                    <span className="text-sm">{p.recipient_name}</span>
                    <button style={{...st.btnGhost, fontSize:9, padding:'4px 8px'}} onClick={() => onAdmin(p.id)}>Mark done</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {completed.length > 0 && (
            <div>
              <div style={st.label}>Completed ({completed.length})</div>
              <div className="space-y-1">
                {completed.map(c => (
                  <div key={c.id} className="flex justify-between items-center p-2 rounded" style={{background:'var(--bg-1)', border:'1px solid var(--border)'}}>
                    <span className="text-sm" style={{color:'var(--green)'}}>✓ {c.recipient_name}</span>
                    <span className="text-[10px] font-mono" style={{color:'var(--fg-4)'}}>by {c.completed_by_name === c.recipient_name ? 'self' : c.completed_by_name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="p-4 flex justify-end" style={{borderTop:'1px solid var(--border)'}}>
          <button style={st.btnGhost} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
