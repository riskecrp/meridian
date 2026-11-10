"use client";
import { useEffect, useState } from "react";
import { useAuth } from "../../../lib/useAuth";
import { useDialog } from "../../../lib/useDialog";
import { getTeams, getTeamTasks, getTeamReminders, getMyTasks, getMyReminders, createTask, claimTask, completeTask, editTask, reassignTask, unclaimTask, requestTaskInfo, createReminder, snoozeReminder, deleteReminder, getStaffList, getRoleTargets, getTeamIcContactsAll, assignIcContact, setIcContactStatus, stageRoleplay, completeIcContact } from "./actions";
import RpChangeForm from "./RpChangeForm";
import SopLink from "../../../lib/SopLink";
import { ui } from "../../../lib/ui.js";
import { FM_GUILD_ID } from "../../../lib/constants.js";

// Every server action answers { ok, error }; a failure is shown, never swallowed.
const fmtWhen = (v) => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : (v || ''); };

const st = {
  ...ui,
  card: { background:'var(--bg-1)', border:'1px solid var(--border)', borderRadius:12 },
  modalContent: { position:'relative', width:'100%', maxWidth:900, maxHeight:'90vh', background:'var(--bg-1)', border:'1px solid var(--border)', borderRadius:16, display:'flex', flexDirection:'column', overflow:'hidden' },
};

// ── Shared Create Form Component ──
function CreateActionForm({ staffList, roleTargets, defaultTargetType, defaultTargetId, onSubmit, onCancel }) {
  const [mode, setMode] = useState('task');
  const [desc, setDesc] = useState('');
  const [targetType, setTargetType] = useState(defaultTargetType || 'Role');
  const [targetId, setTargetId] = useState(defaultTargetId || '');
  const [enableDM, setEnableDM] = useState(false);
  const [eventType, setEventType] = useState('OOC Meeting');
  const [eventDate, setEventDate] = useState('');
  const [eventNote, setEventNote] = useState('');
  const { showAlert } = useDialog();

  const buildRoleOptions = () => {
    const opts = [];
    if (roleTargets.leadershipId) opts.push({ label: 'FM Leadership', value: roleTargets.leadershipId });
    if (roleTargets.leadId) opts.push({ label: 'FM Team Leads', value: roleTargets.leadId });
    if (roleTargets.allFmId) opts.push({ label: 'All Faction Management', value: roleTargets.allFmId });
    (roleTargets.teams || []).forEach(t => opts.push({ label: t.team_name, value: t.team_id }));
    return opts;
  };

  const handleSubmit = () => {
    if (!targetId) return showAlert('Please select a target.');
    if (mode === 'task') {
      if (!desc.trim()) return showAlert('Description required.');
      onSubmit({ mode: 'task', desc, targetType, targetId, enableDM });
    } else {
      if (!eventDate) return showAlert('Date required.');
      const epochMs = new Date(eventDate).getTime();
      if (isNaN(epochMs)) return showAlert('Invalid date.');
      onSubmit({ mode: 'event', targetType, targetId, eventType, epochMs, note: eventNote });
    }
  };

  return (
    <div className="p-5 rounded-xl space-y-4" style={{ background:'var(--accent-bg)', border:'1px solid var(--accent-bg)' }}>
      {/* Mode Toggle */}
      <div className="flex gap-2">
        <button style={{ ...st.btnGhost, ...(mode==='task'?{background:'var(--accent)',color:'white',border:'none'}:{}) }} onClick={()=>setMode('task')}>Task</button>
        <button style={{ ...st.btnGhost, ...(mode==='event'?{background:'var(--accent)',color:'white',border:'none'}:{}) }} onClick={()=>setMode('event')}>Event / Reminder</button>
      </div>

      {/* Target Selector — shared by both modes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <div style={st.label}>Ping Type</div>
          <select style={st.input} value={targetType} onChange={e => { setTargetType(e.target.value); setTargetId(''); }}>
            <option value="Role">Team / Role</option>
            <option value="User">Individual Member</option>
          </select>
        </div>
        <div>
          <div style={st.label}>{targetType === 'User' ? 'Select Member' : 'Select Team / Role'}</div>
          {targetType === 'User' ? (
            <select style={st.input} value={targetId} onChange={e => setTargetId(e.target.value)}>
              <option value="">Select staff member...</option>
              {staffList.map(s => <option key={s.discord_id} value={s.discord_id}>{s.display_name} ({s.team_name})</option>)}
            </select>
          ) : (
            <select style={st.input} value={targetId} onChange={e => setTargetId(e.target.value)}>
              <option value="">Select team or role...</option>
              {buildRoleOptions().map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Task-specific fields */}
      {mode === 'task' && (
        <div className="space-y-3">
          <div>
            <div style={st.label}>Task Description</div>
            <textarea style={{ ...st.input, minHeight:80 }} placeholder="Describe the task..." value={desc} onChange={e => setDesc(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={enableDM} onChange={e => setEnableDM(e.target.checked)} />
            <span className="text-xs" style={{ color:'var(--fg-3)' }}>Enable daily DM reminders for assigned member</span>
          </label>
        </div>
      )}

      {/* Event-specific fields */}
      {mode === 'event' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div style={st.label}>Event Type</div>
              <select style={st.input} value={eventType} onChange={e => setEventType(e.target.value)}>
                <option>OOC Meeting</option>
                <option>RP Op / Scene</option>
                <option>Internal Meeting</option>
                <option>Deadline / Reminder</option>
              </select>
            </div>
            <div>
              <div style={st.label}>Date & Time (Local)</div>
              <input type="datetime-local" style={st.input} value={eventDate} onChange={e => setEventDate(e.target.value)} />
            </div>
          </div>
          <div>
            <div style={st.label}>Details (optional)</div>
            <input style={st.input} placeholder="Meeting topic, agenda..." value={eventNote} onChange={e => setEventNote(e.target.value)} />
          </div>
          <div className="text-[10px]" style={{ color:'var(--fg-4)' }}>The 30-minute warning ping is a global switch on the reminder.warning route (Admin › Pings).</div>
        </div>
      )}

      {/* Submit */}
      <div className="flex gap-3 pt-2" style={{ borderTop:'1px solid var(--border)' }}>
        <button style={st.btn} onClick={handleSubmit}>{mode === 'task' ? 'Create Task' : 'Schedule Event'}</button>
        <button style={st.btnGhost} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ── Task Card ──
function TaskCard({ t, auth, staffList, onRefresh }) {
  const [claiming, setClaiming] = useState(false);
  const [claimDM, setClaimDM] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completeNote, setCompleteNote] = useState('');
  const [completeSubmitting, setCompleteSubmitting] = useState(false);
  const [unclaimOpen, setUnclaimOpen] = useState(false);
  const [unclaimNote, setUnclaimNote] = useState('');
  const [unclaimSubmitting, setUnclaimSubmitting] = useState(false);
  const [riOpen, setRiOpen] = useState(false);
  const [riQuestion, setRiQuestion] = useState('');
  const [riSubmitting, setRiSubmitting] = useState(false);
  const [riErr, setRiErr] = useState('');
  const [reassignNote, setReassignNote] = useState('');
  const canRequestInfo = t.created_by_id && t.created_by_id !== auth.id;
  const doComplete = async () => {
    setCompleteSubmitting(true);
    const res = await completeTask(t.task_uid, completeNote.trim() || undefined);
    setCompleteSubmitting(false);
    if (!res?.ok) { await showAlert(res?.error || 'Could not complete the task.'); return; }
    setCompleteOpen(false); setCompleteNote(''); onRefresh();
  };
  const doUnclaim = async () => {
    setUnclaimSubmitting(true);
    const res = await unclaimTask(t.task_uid, unclaimNote.trim() || undefined);
    setUnclaimSubmitting(false);
    if (!res?.ok) { await showAlert(res?.error || 'Could not release the task.'); return; }
    setUnclaimOpen(false); setUnclaimNote(''); onRefresh();
  };
  const doClaim = async () => {
    const res = await claimTask(t.task_uid, { enableDM: claimDM });
    if (!res?.ok) { await showAlert(res?.error || 'Could not claim the task.'); return; }
    setClaiming(false); setClaimDM(false); onRefresh();
  };
  const doRequestInfo = async () => {
    setRiErr('');
    if (!riQuestion.trim()) { setRiErr('Question is required.'); return; }
    setRiSubmitting(true);
    const res = await requestTaskInfo(t.task_uid, riQuestion.trim());
    setRiSubmitting(false);
    if (!res.ok) { setRiErr(res.error || 'Failed'); return; }
    setRiOpen(false); setRiQuestion(''); onRefresh();
  };
  const [raType, setRaType] = useState('User');
  const [raTid, setRaTid] = useState('');
  const [raRoles, setRaRoles] = useState({ leadershipId:'', leadId:'', allFmId:'', teams:[] });
  const [raSubmitting, setRaSubmitting] = useState(false);
  const [raErr, setRaErr] = useState('');
  const isClaimed = !!t.claimed_by && t.claimed_by !== 'None';
  const canReassign = auth.level >= 2;
  const canUnclaim = isClaimed && (t.claimed_by === auth.id || auth.level >= 3);
  const isL2 = auth.level < 3;
  // Lazy-load roles when reassigning opens
  useEffect(() => { if (reassignOpen && !raRoles.leadId && !raRoles.allFmId) { getRoleTargets().then(setRaRoles).catch(() => {}); } }, [reassignOpen]);
  // Team leads cannot hand tasks to leadership (staff.clearance is the truth, not the rank text).
  const filteredStaff = isL2 ? staffList.filter(s => Number(s.clearance || 0) < 3) : staffList;
  const raRoleOptions = [
    ...(!isL2 && raRoles.leadershipId ? [{ label: 'FM Leadership', value: raRoles.leadershipId }] : []),
    ...(raRoles.leadId ? [{ label: 'FM Team Leads', value: raRoles.leadId }] : []),
    ...(raRoles.allFmId ? [{ label: 'All Faction Management', value: raRoles.allFmId }] : []),
    ...(raRoles.teams || []).map(tm => ({ label: tm.team_name, value: tm.team_id })),
  ];
  const doReassign = async () => {
    setRaErr('');
    if (!raTid) { setRaErr('Pick a target.'); return; }
    setRaSubmitting(true);
    const res = await reassignTask(t.task_uid, raTid, raType, reassignNote.trim() || undefined);
    setRaSubmitting(false);
    if (!res.ok) { setRaErr(res.error || 'Failed'); return; }
    setReassignOpen(false); setRaTid(''); onRefresh();
  };
  const canEdit = t.created_by_id === auth.id || auth.level >= 2;
  const { showPrompt, showAlert } = useDialog();

  return (
    <div className="p-4 rounded-lg" style={{ background:'var(--bg-1)', border:'1px solid var(--border)' }}>
      <div className="flex justify-between items-start mb-2">
        <span className="text-[10px] font-mono" style={{ color:'var(--fg-4)' }}>{fmtWhen(t.created_at)}{t.targetLabel ? ` · ${t.targetLabel}` : ''}</span>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: !isClaimed ? 'var(--amber-bg)' : 'var(--green-bg)', color: !isClaimed ? 'var(--amber)' : 'var(--green)' }}>
          {!isClaimed ? 'Unclaimed' : t.claimerName}
        </span>
      </div>
      {t.next_reminder && <div className="text-[9px] mb-1 flex items-center gap-1" style={{ color:'var(--accent)' }}>🔔 Daily DM active</div>}
      <p className="text-sm leading-relaxed mb-3" style={{ color:'var(--fg-1)' }}>{t.description}</p>
      <div className="flex flex-wrap gap-2 pt-2" style={{ borderTop:'1px solid var(--border)' }}>
        {claiming ? (
          <div className="flex items-center gap-2 w-full p-2 rounded" style={{ background:'var(--bg-2)' }}>
            <span className="text-xs flex-1" style={{ color:'var(--fg-2)' }}>Claim this task as <b>{auth.name}</b>?</span>
            <label className="text-[9px] flex items-center gap-1 whitespace-nowrap" style={{ color:'var(--fg-3)' }}><input type="checkbox" checked={claimDM} onChange={e => setClaimDM(e.target.checked)} /> 24h DM</label>
            <button style={st.btn} onClick={doClaim}>Confirm</button>
            <button style={st.btnGhost} onClick={() => setClaiming(false)}>Cancel</button>
          </div>
        ) : reassignOpen ? (
          <div className="w-full p-2 rounded space-y-2" style={{ background:'var(--bg-2)' }}>
            <div className="flex gap-2">
              <select style={{ ...st.input, width:'auto' }} value={raType} onChange={e => { setRaType(e.target.value); setRaTid(''); }}>
                <option value="User">Member</option>
                <option value="Role">Team / Role</option>
              </select>
              <select style={{ ...st.input, flex:1 }} value={raTid} onChange={e => setRaTid(e.target.value)}>
                <option value="">{raType === 'User' ? 'Select staff member...' : 'Select team or role...'}</option>
                {raType === 'User'
                  ? filteredStaff.map(s => <option key={s.discord_id} value={s.discord_id}>{s.display_name}{s.team_name ? ` (${s.team_name})` : ''}</option>)
                  : raRoleOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <input style={st.input} placeholder="Note for the new assignee (optional)" value={reassignNote} onChange={e => setReassignNote(e.target.value)} />
            {raErr && <div className="text-xs" style={{ color:'var(--red)' }}>{raErr}</div>}
            <div className="flex gap-2">
              <button style={st.btn} disabled={raSubmitting} onClick={doReassign}>{raSubmitting ? 'Reassigning...' : 'Confirm'}</button>
              <button style={st.btnGhost} onClick={() => { setReassignOpen(false); setRaErr(''); }}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            {!isClaimed && <button style={st.btnGhost} onClick={() => setClaiming(true)}>Claim</button>}
            {canEdit && <button style={{ ...st.btnGhost, color:'var(--accent)' }} onClick={async () => { const v = await showPrompt("Edit task:", t.description); if (v) { const res = await editTask(t.task_uid, v); if (!res?.ok) await showAlert(res?.error || 'Could not edit the task.'); onRefresh(); } }}>Edit</button>}
            {canReassign && <button style={{ ...st.btnGhost, color:'var(--amber)' }} onClick={() => setReassignOpen(true)}>Reassign</button>}
            {canRequestInfo && <button style={{ ...st.btnGhost, color:'var(--accent)' }} onClick={() => setRiOpen(true)}>Request Info</button>}
            {canUnclaim && <button style={{ ...st.btnGhost, color:'var(--fg-3)' }} onClick={() => setUnclaimOpen(true)}>Unclaim</button>}
            <button style={st.btnDanger} onClick={() => setCompleteOpen(true)}>Complete</button>
          </>
        )}
      </div>
      {completeOpen && (
        <div style={{ position:'fixed', inset:0, zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
          <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', backdropFilter:'blur(8px)' }} onClick={() => setCompleteOpen(false)} />
          <div style={{ position:'relative', width:'100%', maxWidth:480, background:'var(--bg-1)', border:'1px solid var(--border)', borderRadius:16, overflow:'hidden' }}>
            <div className="p-5" style={{ borderBottom:'1px solid var(--border)' }}>
              <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color:'var(--green)' }}>Complete Task</div>
              <h3 className="text-base font-bold mt-1">{t.description?.substring(0, 80)}{t.description?.length > 80 ? '...' : ''}</h3>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <div style={{ fontSize:10, fontWeight:700, color:'var(--fg-4)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:6 }}>Completion Notes (optional)</div>
                <textarea value={completeNote} onChange={e => setCompleteNote(e.target.value)} placeholder="Anything the creator should know..." rows={4}
                  style={{ width:'100%', background:'var(--bg-2)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 14px', fontSize:13, color:'var(--fg-0)', resize:'vertical' }} />
              </div>
            </div>
            <div className="p-4 flex justify-end gap-3" style={{ borderTop:'1px solid var(--border)' }}>
              <button onClick={() => setCompleteOpen(false)} style={{ background:'transparent', color:'var(--fg-3)', border:'1px solid var(--border)', padding:'6px 14px', borderRadius:8, fontSize:11, fontWeight:700, cursor:'pointer', textTransform:'uppercase' }}>Cancel</button>
              <button onClick={doComplete} disabled={completeSubmitting} style={{ background:'var(--green)', color:'white', border:'none', padding:'8px 16px', borderRadius:8, fontSize:11, fontWeight:800, cursor: completeSubmitting?'wait':'pointer', textTransform:'uppercase', letterSpacing:'0.08em', opacity: completeSubmitting ? 0.6 : 1 }}>{completeSubmitting ? 'Completing...' : 'Complete Task'}</button>
            </div>
          </div>
        </div>
      )}
      {unclaimOpen && (
        <div style={{ position:'fixed', inset:0, zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
          <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', backdropFilter:'blur(8px)' }} onClick={() => setUnclaimOpen(false)} />
          <div style={{ position:'relative', width:'100%', maxWidth:480, background:'var(--bg-1)', border:'1px solid var(--border)', borderRadius:16, overflow:'hidden' }}>
            <div className="p-5" style={{ borderBottom:'1px solid var(--border)' }}>
              <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color:'var(--fg-3)' }}>Unclaim Task</div>
              <h3 className="text-base font-bold mt-1">{t.description?.substring(0, 80)}{t.description?.length > 80 ? '...' : ''}</h3>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <div style={{ fontSize:10, fontWeight:700, color:'var(--fg-4)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:6 }}>Reason / Note (optional)</div>
                <textarea value={unclaimNote} onChange={e => setUnclaimNote(e.target.value)} placeholder="Why are you releasing this?" rows={3}
                  style={{ width:'100%', background:'var(--bg-2)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 14px', fontSize:13, color:'var(--fg-0)', resize:'vertical' }} />
              </div>
            </div>
            <div className="p-4 flex justify-end gap-3" style={{ borderTop:'1px solid var(--border)' }}>
              <button onClick={() => setUnclaimOpen(false)} style={{ background:'transparent', color:'var(--fg-3)', border:'1px solid var(--border)', padding:'6px 14px', borderRadius:8, fontSize:11, fontWeight:700, cursor:'pointer', textTransform:'uppercase' }}>Cancel</button>
              <button onClick={doUnclaim} disabled={unclaimSubmitting} style={{ background:'var(--fg-3)', color:'var(--bg-0)', border:'none', padding:'8px 16px', borderRadius:8, fontSize:11, fontWeight:800, cursor: unclaimSubmitting?'wait':'pointer', textTransform:'uppercase', letterSpacing:'0.08em', opacity: unclaimSubmitting ? 0.6 : 1 }}>{unclaimSubmitting ? 'Unclaiming...' : 'Unclaim'}</button>
            </div>
          </div>
        </div>
      )}
      {riOpen && (
        <div style={{ position:'fixed', inset:0, zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
          <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', backdropFilter:'blur(8px)' }} onClick={() => setRiOpen(false)} />
          <div style={{ position:'relative', width:'100%', maxWidth:520, background:'var(--bg-1)', border:'1px solid var(--border)', borderRadius:16, overflow:'hidden' }}>
            <div className="p-5" style={{ borderBottom:'1px solid var(--border)' }}>
              <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color:'var(--accent)' }}>Request More Info</div>
              <h3 className="text-base font-bold mt-1">{t.description?.substring(0, 100)}{t.description?.length > 100 ? '...' : ''}</h3>
              <div className="text-[11px] mt-1" style={{ color:'var(--fg-3)' }}>The creator will be pinged in their visible channel.</div>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <div style={{ fontSize:10, fontWeight:700, color:'var(--fg-4)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:6 }}>Your Question</div>
                <textarea value={riQuestion} onChange={e => setRiQuestion(e.target.value)} placeholder="What do you need to know?" rows={5}
                  style={{ width:'100%', background:'var(--bg-2)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 14px', fontSize:13, color:'var(--fg-0)', resize:'vertical' }} />
              </div>
              {riErr && <div className="text-xs" style={{ color:'var(--red)' }}>{riErr}</div>}
            </div>
            <div className="p-4 flex justify-end gap-3" style={{ borderTop:'1px solid var(--border)' }}>
              <button onClick={() => setRiOpen(false)} style={{ background:'transparent', color:'var(--fg-3)', border:'1px solid var(--border)', padding:'6px 14px', borderRadius:8, fontSize:11, fontWeight:700, cursor:'pointer', textTransform:'uppercase' }}>Cancel</button>
              <button onClick={doRequestInfo} disabled={riSubmitting || !riQuestion.trim()} style={{ background:'var(--accent)', color:'white', border:'none', padding:'8px 16px', borderRadius:8, fontSize:11, fontWeight:800, cursor: riSubmitting?'wait':'pointer', textTransform:'uppercase', letterSpacing:'0.08em', opacity: (riSubmitting || !riQuestion.trim()) ? 0.6 : 1 }}>{riSubmitting ? 'Sending...' : 'Send'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Reminder Card ──
function ReminderCard({ r, auth, onRefresh }) {
  const canEdit = r.author_id === auth.id || auth.level >= 2;
  const { showConfirm, showAlert } = useDialog();
  const timeStr = new Date(r.epochMs).toLocaleString([], { dateStyle:'short', timeStyle:'short' });
  const act = async (fn, msg) => { const res = await fn(); if (!res?.ok) await showAlert(res?.error || msg); onRefresh(); };

  return (
    <div className="p-4 rounded-lg" style={{ background:'var(--bg-1)', border:'1px solid var(--border)' }}>
      <div className="flex justify-between items-start mb-2">
        <span className="text-xs font-bold" style={{ color:'var(--accent)' }}>{r.authorName}</span>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background:'var(--accent-bg)', color:'var(--accent)' }}>{timeStr}</span>
      </div>
      <p className="text-sm leading-relaxed mb-3" style={{ color:'var(--fg-1)' }}>{r.message}</p>
      <div className="flex gap-2 pt-2" style={{ borderTop:'1px solid var(--border)' }}>
        {canEdit && <button style={st.btnGhost} onClick={() => act(() => snoozeReminder(r.uuid), 'Could not snooze the event.')}>Snooze +1h</button>}
        {canEdit && <button style={st.btnDanger} onClick={async () => { if (await showConfirm("Delete this event?")) act(() => deleteReminder(r.uuid), 'Could not delete the event.'); }}>Delete</button>}
      </div>
    </div>
  );
}

// ── IC Contact Card ──
const STATUS_META = {
  pending_discussion: { label: 'Pending Discussion', color: 'var(--amber)',    bg: 'var(--amber-bg)' },
  pending_roleplay:   { label: 'Pending Roleplay',   color: 'var(--blue)',     bg: 'var(--blue-bg)'  },
  completed:          { label: 'Completed',           color: 'var(--green)',    bg: 'var(--green-bg)' },
};

function IcContactCard({ contact, auth, staffList, onRefresh }) {
  const [assigning, setAssigning] = useState(false);
  const [assignId, setAssignId]   = useState('');
  const [stagingRP, setStagingRP] = useState(false);
  const [busy, setBusy]           = useState(false);
  const meta = STATUS_META[contact.status] || STATUS_META.pending_discussion;
  const canStage = auth.level >= 2;
  const { showAlert } = useDialog();
  const check = async (res) => { if (!res?.ok) { await showAlert(res?.error || 'Action failed.'); return false; } return true; };

  const doAssign = async () => {
    if (!assignId) return;
    setBusy(true);
    const ok = await check(await assignIcContact(contact.id, assignId));
    setBusy(false);
    if (ok) { setAssigning(false); setAssignId(''); onRefresh(); }
  };

  const doStatusChange = async (newStatus) => {
    setBusy(true);
    const res = newStatus === 'completed' ? await completeIcContact(contact.id) : await setIcContactStatus(contact.id, newStatus);
    setBusy(false);
    await check(res); onRefresh();
  };

  const doStage = async (rpData) => {
    setBusy(true);
    const ok = await check(await stageRoleplay(contact.id, rpData));
    setBusy(false);
    if (ok) { setStagingRP(false); onRefresh(); }
  };

  return (
    <div style={{ borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-1)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '10px 14px', background: 'var(--bg-2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{contact.faction_name}</span>
          <span style={{ fontSize: 10, color: 'var(--fg-3)' }}>·</span>
          <span style={{ fontSize: 11, color: 'var(--fg-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{contact.sender_name}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {contact.thread_id && (
            <a href={`https://discord.com/channels/${FM_GUILD_ID}/${contact.thread_id}`} target="_blank" rel="noreferrer"
              style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 5, background: 'rgba(88,101,242,0.12)', color: '#818cf8', textDecoration: 'none' }}>Thread ↗</a>
          )}
          <select
            disabled={busy}
            value={contact.status}
            onChange={e => doStatusChange(e.target.value)}
            style={{ fontSize: 9, fontWeight: 700, padding: '3px 6px', borderRadius: 5, background: meta.bg, color: meta.color, border: `1px solid ${meta.color}44`, cursor: 'pointer', outline: 'none', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em', textTransform: 'uppercase' }}
          >
            <option value="pending_discussion">Pending Discussion</option>
            <option value="pending_roleplay">Pending Roleplay</option>
            <option value="completed">Completed</option>
          </select>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '12px 14px' }}>
        <p style={{ fontSize: 13, color: 'var(--fg-1)', lineHeight: 1.65, whiteSpace: 'pre-wrap', margin: '0 0 10px' }}>{contact.message}</p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--fg-4)', marginBottom: 10 }}>
          {contact.assigned_name
            ? <><span style={{ color: 'var(--accent)' }}>{contact.assigned_name}</span><span>assigned</span></>
            : <span>Unassigned</span>}
          <span>·</span>
          <span>{new Date(contact.submitted_at).toLocaleDateString()}</span>
        </div>

        {/* Assign form */}
        {assigning && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
            <select value={assignId} onChange={e => setAssignId(e.target.value)} style={{ ...st.input, width: 'auto', flex: 1, padding: '6px 10px', fontSize: 12 }}>
              <option value="">Select member...</option>
              {staffList.map(s => <option key={s.discord_id} value={s.discord_id}>{s.display_name}</option>)}
            </select>
            <button disabled={!assignId || busy} onClick={doAssign} style={{ ...st.btn, padding: '6px 12px', fontSize: 10 }}>Confirm</button>
            <button onClick={() => setAssigning(false)} style={{ ...st.btnGhost, padding: '6px 10px', fontSize: 10 }}>Cancel</button>
          </div>
        )}

        {/* Request RP Change form */}
        {stagingRP && (
          <div style={{ marginBottom: 8 }}>
            <RpChangeForm contact={contact} busy={busy} onSubmit={doStage} onCancel={() => setStagingRP(false)} />
          </div>
        )}

        {/* Action buttons — hidden for completed contacts */}
        {!assigning && !stagingRP && contact.status !== 'completed' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <button onClick={() => setAssigning(true)} style={{ ...st.btnGhost, fontSize: 10, padding: '5px 11px' }}>Assign</button>
            {canStage && (
              <button onClick={() => setStagingRP(true)} style={{ ...st.btnGhost, fontSize: 10, padding: '5px 11px', color: 'var(--blue)' }}>Request RP Change</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ──
export default function TeamsPage() {
  const auth = useAuth();
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [workspace, setWorkspace] = useState(null);
  const [wsTasks, setWsTasks] = useState([]);
  const [wsReminders, setWsReminders] = useState([]);
  const [wsContacts, setWsContacts] = useState([]);
  const [wsContactsShowAll, setWsContactsShowAll] = useState(false);
  const [staffList, setStaffList] = useState([]);
  const [showPersonal, setShowPersonal] = useState(false);
  const [myTasks, setMyTasks] = useState([]);
  const [myReminders, setMyReminders] = useState([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [roleTargets, setRoleTargets] = useState({ teams: [] });

  const { showAlert } = useDialog();
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!auth.loading) {
      Promise.all([getTeams(), getStaffList(), getRoleTargets()]).then(([t, s, r]) => {
        setTeams(t); setStaffList(s); setRoleTargets(r); setLoading(false);
      }).catch(e => { setLoadError(e?.message || 'Could not load teams.'); setLoading(false); });
    }
  }, [auth.loading]);

  const openWorkspace = async (team) => {
    setWorkspace(team); setShowCreateForm(false); setWsContactsShowAll(false);
    const [tasks, rems, contacts] = await Promise.all([getTeamTasks(team.id), getTeamReminders(team.id), getTeamIcContactsAll(team.id)]);
    setWsTasks(tasks); setWsReminders(rems); setWsContacts(contacts);
  };

  const refreshWorkspace = async () => {
    if (workspace) {
      const [tasks, rems, contacts] = await Promise.all([getTeamTasks(workspace.id), getTeamReminders(workspace.id), getTeamIcContactsAll(workspace.id)]);
      setWsTasks(tasks); setWsReminders(rems); setWsContacts(contacts);
    }
  };

  const openPersonal = async () => {
    setShowPersonal(true); setShowCreateForm(false);
    const [tasks, rems] = await Promise.all([getMyTasks(), getMyReminders()]);
    setMyTasks(tasks); setMyReminders(rems);
  };

  const refreshPersonal = async () => {
    const [tasks, rems] = await Promise.all([getMyTasks(), getMyReminders()]);
    setMyTasks(tasks); setMyReminders(rems);
  };

  const handleFormSubmit = async (data) => {
    const res = data.mode === 'task'
      ? await createTask({ desc: data.desc, targetId: data.targetId, targetType: data.targetType, enableDM: data.enableDM })
      : await createReminder({ message: `[${data.eventType}] ${data.note || ''}`.trim(), epochMs: data.epochMs, eventType: data.eventType, note: data.note, targetType: data.targetType, targetId: data.targetId });
    if (!res?.ok) { await showAlert(res?.error || 'Could not create that.'); return; }
    setShowCreateForm(false);
    if (workspace) refreshWorkspace();
    if (showPersonal) refreshPersonal();
  };

  if (auth.loading || loading) return <div className="p-10 text-sm animate-pulse" style={{ color:'var(--accent)' }}>Loading teams...</div>;
  if (loadError) return <div className="p-10 text-sm" style={{ color:'var(--red)' }}>{loadError}</div>;

  return (
    <div className="w-full max-w-[1400px] mx-auto p-6 lg:p-10 space-y-8">
      <div className="flex justify-between items-end pb-6" style={{ borderBottom:'1px solid var(--border)' }}>
        <div>
          <h1 className="text-3xl font-black tracking-tighter italic uppercase">Teams</h1>
          <p className="text-sm mt-1" style={{ color:'var(--fg-3)' }}>Team structure, assigned factions, and task workspace.</p>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          {auth.level >= 2 && <SopLink title="Teams & Workspaces" label="Team Performance Guide" />}
          <button style={st.btn} onClick={openPersonal}>My Workspace</button>
        </div>
      </div>

      {/* Team Cards */}
      <div className="space-y-6">
        {teams.map(team => (
          <div key={team.id} style={st.card} className="overflow-hidden">
            <div className="px-6 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4" style={{ borderBottom:'1px solid var(--border)' }}>
              <div>
                <h2 className="text-xl font-bold uppercase italic tracking-tight cursor-pointer" onClick={() => openWorkspace(team)} style={{ color:'var(--fg-0)' }}>{team.name}</h2>
                <p className="text-xs mt-1" style={{ color:'var(--fg-3)' }}>
                  <span style={{ color:'var(--accent)' }}>{team.leads.map(l=>l.name).join(', ')||'No Lead'}</span>
                  {team.guides.length > 0 && <> · {team.guides.map(g=>g.name).join(', ')}</>}
                </p>
              </div>
              <div className="flex gap-6 p-3 rounded-lg" style={{ background:'var(--bg-2)' }}>
                <div className="text-center"><div className="text-xl font-light">{team.total30d}</div><div className="text-[9px] uppercase" style={{ color:'var(--fg-4)' }}>30D</div></div>
                <div className="text-center"><div className="text-xl font-light" style={{ color:'var(--fg-4)' }}>{team.totalAll}</div><div className="text-[9px] uppercase" style={{ color:'var(--fg-4)' }}>Total</div></div>
              </div>
            </div>
            <table className="w-full text-left text-sm">
              <thead><tr style={{ background:'var(--bg-2)' }}><th className="py-3 px-6 text-[10px] font-bold uppercase" style={{ color:'var(--fg-4)' }}>Faction</th><th className="py-3 px-4 text-center text-[10px] font-bold uppercase" style={{ color:'var(--fg-4)' }}>Tier</th><th className="py-3 px-4 text-center text-[10px] font-bold uppercase" style={{ color:'var(--fg-4)' }}>30D</th><th className="py-3 px-4 text-center text-[10px] font-bold uppercase" style={{ color:'var(--fg-4)' }}>Total</th></tr></thead>
              <tbody>
                {team.factions.map(f => (
                  <tr key={f.id} style={{ borderTop:'1px solid var(--border)' }}>
                    <td className="py-3 px-6 font-medium">{f.name}</td>
                    <td className="py-3 px-4 text-center"><span className="text-xs font-mono px-2 py-0.5 rounded" style={{ background:'var(--bg-3)', color:'var(--fg-3)' }}>T{f.tier}</span></td>
                    <td className="py-3 px-4 text-center text-xs font-bold" style={{ color:'var(--accent)' }}>{f.scenes30d}</td>
                    <td className="py-3 px-4 text-center text-xs" style={{ color:'var(--fg-4)' }}>{f.allTime}</td>
                  </tr>
                ))}
                {team.factions.length === 0 && <tr><td colSpan="4" className="py-4 px-6 text-center text-xs italic" style={{ color:'var(--fg-4)' }}>No factions assigned</td></tr>}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* ═══ TEAM WORKSPACE MODAL ═══ */}
      {workspace && (
        <div style={st.modal}><div style={st.modalBg} onClick={() => { setWorkspace(null); setShowCreateForm(false); }} />
          <div style={st.modalContent}>
            <div className="p-6 flex justify-between items-center" style={{ borderBottom:'1px solid var(--border)' }}>
              <div><div style={st.label}>Team Workspace</div><h2 className="text-xl font-bold uppercase italic tracking-tight">{workspace.name}</h2></div>
              <div className="flex items-center gap-3">
                <button style={st.btn} onClick={() => setShowCreateForm(!showCreateForm)}>
                  {showCreateForm ? 'Hide Form' : 'Create Action +'}
                </button>
                <button onClick={() => { setWorkspace(null); setShowCreateForm(false); }} style={{ color:'var(--fg-4)', fontSize:22, background:'none', border:'none', cursor:'pointer' }}>✕</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6 scr space-y-6">
              {showCreateForm && (
                <CreateActionForm
                  staffList={staffList}
                  roleTargets={roleTargets}
                  defaultTargetType="Role"
                  defaultTargetId={workspace.id}
                  onSubmit={handleFormSubmit}
                  onCancel={() => setShowCreateForm(false)}
                />
              )}

              {/* IC Contacts */}
              <div>
                <div className="font-bold text-xs uppercase tracking-widest mb-3 flex items-center gap-3" style={{ color:'var(--accent)' }}>
                  IC Contacts
                  <span style={{ fontSize:9, padding:'2px 7px', borderRadius:5, background:'var(--accent-bg)', color:'var(--accent)' }}>
                    {wsContacts.filter(c => c.status !== 'completed').length} active
                  </span>
                  <button onClick={() => setWsContactsShowAll(v => !v)} style={{ fontSize:9, fontWeight:700, padding:'2px 8px', borderRadius:4, border:'1px solid var(--border)', background: wsContactsShowAll ? 'var(--accent-bg)' : 'transparent', color: wsContactsShowAll ? 'var(--accent)' : 'var(--fg-4)', cursor:'pointer', textTransform:'uppercase', letterSpacing:'0.06em', marginLeft:'auto' }}>
                    {wsContactsShowAll ? 'All' : 'Active'}
                  </button>
                </div>
                <div className="space-y-3">
                  {(wsContactsShowAll ? wsContacts : wsContacts.filter(c => c.status !== 'completed'))
                    .map(c => <IcContactCard key={c.id} contact={c} auth={auth} staffList={staffList} onRefresh={refreshWorkspace} />)}
                  {wsContacts.filter(c => wsContactsShowAll || c.status !== 'completed').length === 0 && (
                    <div className="text-xs italic py-4 text-center" style={{ color:'var(--fg-4)' }}>
                      {wsContactsShowAll ? 'No IC contacts.' : 'No active IC contacts.'}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <div className="font-bold text-xs uppercase tracking-widest mb-3" style={{ color:'var(--fg-3)' }}>Active Tasks ({wsTasks.length})</div>
                <div className="space-y-3">
                  {wsTasks.map(t => <TaskCard key={t.id} t={t} auth={auth} staffList={staffList} onRefresh={refreshWorkspace} />)}
                  {wsTasks.length===0 && <div className="text-xs italic py-4 text-center" style={{ color:'var(--fg-4)' }}>No active tasks.</div>}
                </div>
              </div>
              <div>
                <div className="font-bold text-xs uppercase tracking-widest mb-3" style={{ color:'var(--fg-3)' }}>Scheduled Events ({wsReminders.length})</div>
                <div className="space-y-3">
                  {wsReminders.map(r => <ReminderCard key={r.id} r={r} auth={auth} onRefresh={refreshWorkspace} />)}
                  {wsReminders.length===0 && <div className="text-xs italic py-4 text-center" style={{ color:'var(--fg-4)' }}>No scheduled events.</div>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ PERSONAL WORKSPACE MODAL ═══ */}
      {showPersonal && (
        <div style={st.modal}><div style={st.modalBg} onClick={() => { setShowPersonal(false); setShowCreateForm(false); }} />
          <div style={st.modalContent}>
            <div className="p-6 flex justify-between items-center" style={{ borderBottom:'1px solid var(--border)' }}>
              <div><div style={st.label}>Personal Workspace</div><h2 className="text-xl font-bold uppercase italic tracking-tight">{auth.name}</h2></div>
              <div className="flex items-center gap-3">
                <button style={st.btn} onClick={() => setShowCreateForm(!showCreateForm)}>
                  {showCreateForm ? 'Hide Form' : 'Create Action +'}
                </button>
                <button onClick={() => { setShowPersonal(false); setShowCreateForm(false); }} style={{ color:'var(--fg-4)', fontSize:22, background:'none', border:'none', cursor:'pointer' }}>✕</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6 scr space-y-6">
              {showCreateForm && (
                <CreateActionForm
                  staffList={staffList}
                  roleTargets={roleTargets}
                  defaultTargetType="User"
                  defaultTargetId={auth.id}
                  onSubmit={handleFormSubmit}
                  onCancel={() => setShowCreateForm(false)}
                />
              )}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div>
                  <div className="font-bold text-xs uppercase tracking-widest mb-3" style={{ color:'var(--fg-3)' }}>My Tasks ({myTasks.length})</div>
                  <div className="space-y-3">
                    {myTasks.map(t => <TaskCard key={t.id} t={t} auth={auth} staffList={staffList} onRefresh={refreshPersonal} />)}
                    {myTasks.length===0 && <div className="text-xs italic py-4 text-center" style={{ color:'var(--fg-4)' }}>No tasks.</div>}
                  </div>
                </div>
                <div>
                  <div className="font-bold text-xs uppercase tracking-widest mb-3" style={{ color:'var(--fg-3)' }}>My Events ({myReminders.length})</div>
                  <div className="space-y-3">
                    {myReminders.map(r => <ReminderCard key={r.id} r={r} auth={auth} onRefresh={refreshPersonal} />)}
                    {myReminders.length===0 && <div className="text-xs italic py-4 text-center" style={{ color:'var(--fg-4)' }}>No events.</div>}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
