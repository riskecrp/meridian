"use client";
import React, { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/useAuth.js";
import { useDialog } from "../../../lib/useDialog.js";
import { getMyTasks, getMyReminders, claimMyTask, completeMyTask, editMyTask, reassignMyTask, unclaimMyTask, requestTaskInfo, createMyTask, getMyRecurringInstances, completeMyRecurringInstance, getQACountsForTasks, createMyReminder, snoozeMyReminder, deleteMyReminder, getStaffForCreate, getRoleTargetsForCreate, getMyTeamFactions, getAllServerTasks, getMyCreatedTasks, getMyTeamAllTasks, getMyMentions, markMentionRead, markAllMentionsRead, replyToMention, getLeadershipMentions, markLeadershipMentionRead, markAllLeadershipMentionsRead, replyToLeadershipMention, getTeamWatchPings, markWatchPingRead, markAllWatchPingsRead, replyToWatchPing, getDMTrackingStatus, toggleDMTracking, getForwardedDMs, markDMRead, markAllDMsRead, deleteDM } from "./actions.js";
import { getTeamIcContacts, getTeamIcContactsAll, getAllIcContacts, assignIcContact, setIcContactStatus, stageRoleplay, completeIcContact } from "../teams/actions.js";
import RpChangeForm from "../teams/RpChangeForm.js";
import SopLink from "../../../lib/SopLink";
import { getPendingQueue, getTeamPerformance, getGuideActivity } from "../leadership/actions.js";
import { executeRPChange, approveRPChange, denyRPChange, resubmitRPChange, markRPDone, getMyRPRequests, resolveDeletion, getAnalytics, deleteRPChange } from "../operations/actions.js";
import { completePromotion, cancelPromotion } from "../factions/actions.js";

// ── Widget registry ────────────────────────────────────────────────────────────
const WIDGETS = {
  pending:      { name: 'Pending Actions',    minLevel: 2, lst: true },
  tasks:        { name: 'Active Tasks',       minLevel: 1, eventTeam: true },
  reminders:    { name: 'Events & Reminders', minLevel: 1, eventTeam: true },
  performance:  { name: 'Team Performance',   minLevel: 2 },
  guides:       { name: 'Guide Activity',     minLevel: 2 },
  properties:   { name: 'Properties',         minLevel: 3 },
  factions:     { name: 'My Factions',        minLevel: 1 },
  ic_contacts:  { name: 'IC Contacts',        minLevel: 1 },
};

const STAT_BOXES = [
  { id: 'assignedToMe', label: 'Assigned to Me', color: 'var(--accent)' },
  { id: 'teamTasks',    label: 'Team Tasks',     color: 'var(--fg-1)'   },
  { id: 'upcoming',     label: 'Upcoming',       color: 'var(--amber)'  },
  { id: 'factions',     label: 'Factions',       color: 'var(--green)'  },
];

const ET_LAYOUT = [
  { id: 'tasks',     size: 'full' },
  { id: 'reminders', size: 'full' },
];

const DEFAULT_LAYOUTS = {
  1: [
    { id: 'tasks',       size: 'full' },
    { id: 'ic_contacts', size: 'full' },
    { id: 'reminders',   size: 'full' },
    { id: 'factions',    size: 'full' },
  ],
  2: [
    { id: 'pending',     size: 'full' },
    { id: 'tasks',       size: 'full' },
    { id: 'ic_contacts', size: 'full' },
    { id: 'reminders',   size: 'full' },
    { id: 'performance', size: 'half' },
    { id: 'guides',      size: 'half' },
    { id: 'factions',    size: 'full' },
  ],
  3: [
    { id: 'pending',     size: 'full' },
    { id: 'tasks',       size: 'full' },
    { id: 'ic_contacts', size: 'full' },
    { id: 'reminders',   size: 'full' },
    { id: 'performance', size: 'half' },
    { id: 'guides',      size: 'half' },
    { id: 'properties',  size: 'half' },
    { id: 'factions',    size: 'full' },
  ],
};

// ── Modals ─────────────────────────────────────────────────────────────────────

function CompleteModal({ task, onClose, onDone }) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    setSubmitting(true);
    await completeMyTask(task.task_uid, note.trim() || undefined);
    setSubmitting(false);
    onDone();
  };
  return (
    <div style={{ position:'fixed', inset:0, zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', backdropFilter:'blur(8px)' }} onClick={onClose} />
      <div style={{ position:'relative', width:'100%', maxWidth:480, background:'var(--bg-1)', border:'1px solid var(--border)', borderRadius:16, overflow:'hidden' }}>
        <div className="p-5" style={{ borderBottom:'1px solid var(--border)' }}>
          <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color:'var(--green)' }}>Complete Task</div>
          <h3 className="text-base font-bold mt-1">{task.description?.substring(0, 80)}{task.description?.length > 80 ? '...' : ''}</h3>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <div style={{ fontSize:10, fontWeight:700, color:'var(--fg-4)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:6 }}>Completion Notes (optional)</div>
            <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Anything the creator should know..." rows={4}
              style={{ width:'100%', background:'var(--bg-2)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 14px', fontSize:13, color:'var(--fg-0)', resize:'vertical' }} />
          </div>
          <div className="text-[10px]" style={{ color:'var(--fg-4)' }}>If the creator gets pinged, the note will be included.</div>
        </div>
        <div className="p-4 flex justify-end gap-3" style={{ borderTop:'1px solid var(--border)' }}>
          <button onClick={onClose} style={{ background:'transparent', color:'var(--fg-3)', border:'1px solid var(--border)', padding:'6px 14px', borderRadius:8, fontSize:11, fontWeight:700, cursor:'pointer', textTransform:'uppercase' }}>Cancel</button>
          <button onClick={submit} disabled={submitting}
            style={{ background:'var(--green)', color:'white', border:'none', padding:'8px 16px', borderRadius:8, fontSize:11, fontWeight:800, cursor: submitting?'wait':'pointer', textTransform:'uppercase', letterSpacing:'0.08em', opacity: submitting ? 0.6 : 1 }}>
            {submitting ? 'Completing...' : 'Complete Task'}
          </button>
        </div>
      </div>
    </div>
  );
}

function UnclaimModal({ task, onClose, onDone }) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    setSubmitting(true);
    await unclaimMyTask(task.task_uid, note.trim() || undefined);
    setSubmitting(false);
    onDone();
  };
  return (
    <div style={{ position:'fixed', inset:0, zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', backdropFilter:'blur(8px)' }} onClick={onClose} />
      <div style={{ position:'relative', width:'100%', maxWidth:480, background:'var(--bg-1)', border:'1px solid var(--border)', borderRadius:16, overflow:'hidden' }}>
        <div className="p-5" style={{ borderBottom:'1px solid var(--border)' }}>
          <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color:'var(--fg-3)' }}>Unclaim Task</div>
          <h3 className="text-base font-bold mt-1">{task.description?.substring(0, 80)}{task.description?.length > 80 ? '...' : ''}</h3>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <div style={{ fontSize:10, fontWeight:700, color:'var(--fg-4)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:6 }}>Reason / Note (optional)</div>
            <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Why are you releasing this?" rows={3}
              style={{ width:'100%', background:'var(--bg-2)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 14px', fontSize:13, color:'var(--fg-0)', resize:'vertical' }} />
          </div>
        </div>
        <div className="p-4 flex justify-end gap-3" style={{ borderTop:'1px solid var(--border)' }}>
          <button onClick={onClose} style={{ background:'transparent', color:'var(--fg-3)', border:'1px solid var(--border)', padding:'6px 14px', borderRadius:8, fontSize:11, fontWeight:700, cursor:'pointer', textTransform:'uppercase' }}>Cancel</button>
          <button onClick={submit} disabled={submitting}
            style={{ background:'var(--fg-3)', color:'var(--bg-0)', border:'none', padding:'8px 16px', borderRadius:8, fontSize:11, fontWeight:800, cursor: submitting?'wait':'pointer', textTransform:'uppercase', letterSpacing:'0.08em', opacity: submitting ? 0.6 : 1 }}>
            {submitting ? 'Unclaiming...' : 'Unclaim'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RequestInfoModal({ task, onClose, onDone }) {
  const [question, setQuestion] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    setErr('');
    if (!question.trim()) { setErr('Question is required.'); return; }
    setSubmitting(true);
    const res = await requestTaskInfo(task.task_uid, question.trim());
    setSubmitting(false);
    if (!res.ok) { setErr(res.error || 'Failed to send'); return; }
    onDone();
  };
  return (
    <div style={{ position:'fixed', inset:0, zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', backdropFilter:'blur(8px)' }} onClick={onClose} />
      <div style={{ position:'relative', width:'100%', maxWidth:520, background:'var(--bg-1)', border:'1px solid var(--border)', borderRadius:16, overflow:'hidden' }}>
        <div className="p-5" style={{ borderBottom:'1px solid var(--border)' }}>
          <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color:'var(--accent)' }}>Request More Info</div>
          <h3 className="text-base font-bold mt-1">{task.description?.substring(0, 100)}{task.description?.length > 100 ? '...' : ''}</h3>
          <div className="text-[11px] mt-1" style={{ color:'var(--fg-3)' }}>The creator will be pinged in their visible channel.</div>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <div style={{ fontSize:10, fontWeight:700, color:'var(--fg-4)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:6 }}>Your Question</div>
            <textarea value={question} onChange={e => setQuestion(e.target.value)} placeholder="What do you need to know?" rows={5}
              style={{ width:'100%', background:'var(--bg-2)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 14px', fontSize:13, color:'var(--fg-0)', resize:'vertical' }} />
          </div>
          {err && <div className="text-xs" style={{ color:'var(--red)' }}>{err}</div>}
        </div>
        <div className="p-4 flex justify-end gap-3" style={{ borderTop:'1px solid var(--border)' }}>
          <button onClick={onClose} style={{ background:'transparent', color:'var(--fg-3)', border:'1px solid var(--border)', padding:'6px 14px', borderRadius:8, fontSize:11, fontWeight:700, cursor:'pointer', textTransform:'uppercase' }}>Cancel</button>
          <button onClick={submit} disabled={submitting || !question.trim()}
            style={{ background:'var(--accent)', color:'white', border:'none', padding:'8px 16px', borderRadius:8, fontSize:11, fontWeight:800, cursor: submitting?'wait':'pointer', textTransform:'uppercase', letterSpacing:'0.08em', opacity: (submitting || !question.trim()) ? 0.6 : 1 }}>
            {submitting ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReassignModal({ task, auth, onClose, onDone }) {
  const [staffList, setStaffList] = useState([]);
  const [roleTargets, setRoleTargets] = useState({ leadershipId: '', leadId: '', allFmId: '', teams: [] });
  const [type, setType] = useState('User');
  const [tid, setTid] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    getStaffForCreate().then(setStaffList);
    getRoleTargetsForCreate().then(setRoleTargets);
  }, []);

  const isL2 = auth.level < 3;
  const filteredStaff = isL2
    ? staffList.filter(s => {
        const r = (s.rank || '').toLowerCase();
        return !r.includes('leadership') && !r.includes('management') && !r.includes('game affairs');
      })
    : staffList;

  const submit = async () => {
    setErr('');
    if (!tid) { setErr('Pick a target.'); return; }
    setSubmitting(true);
    const res = await reassignMyTask(task.task_uid, tid, type, note);
    setSubmitting(false);
    if (!res.ok) { setErr(res.error || 'Failed to reassign'); return; }
    onDone();
  };

  return (
    <div style={{ position:'fixed', inset:0, zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', backdropFilter:'blur(8px)' }} onClick={onClose} />
      <div style={{ position:'relative', width:'100%', maxWidth:480, background:'var(--bg-1)', border:'1px solid var(--border)', borderRadius:16, overflow:'hidden' }}>
        <div className="p-5" style={{ borderBottom:'1px solid var(--border)' }}>
          <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color:'var(--amber)' }}>Reassign Task</div>
          <h3 className="text-lg font-bold mt-1">{task.description?.substring(0, 80)}{task.description?.length > 80 ? '...' : ''}</h3>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <div style={{ fontSize:10, fontWeight:700, color:'var(--fg-4)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:6 }}>Target Type</div>
            <div className="flex gap-2">
              {['User', 'Role', 'Team'].map(opt => (
                <button key={opt} onClick={() => { setType(opt); setTid(''); }}
                  className="px-3 py-1.5 rounded text-[11px] font-bold uppercase"
                  style={{ background: type === opt ? 'var(--accent)' : 'var(--bg-2)', color: type === opt ? 'white' : 'var(--fg-3)', border: '1px solid var(--border)', cursor: 'pointer' }}>{opt}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize:10, fontWeight:700, color:'var(--fg-4)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:6 }}>Target</div>
            <select value={tid} onChange={e => setTid(e.target.value)}
              style={{ width:'100%', background:'var(--bg-2)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 14px', fontSize:13, color:'var(--fg-0)' }}>
              <option value="">Select...</option>
              {type === 'User' && filteredStaff.map(s => (
                <option key={s.discord_id} value={s.discord_id}>{s.display_name}</option>
              ))}
              {type === 'Role' && (<>
                {!isL2 && roleTargets.leadershipId && <option value={roleTargets.leadershipId}>FM Leadership</option>}
                {!isL2 && <option value="1457189093594239147">Game Affairs Management</option>}
                {roleTargets.leadId && <option value={roleTargets.leadId}>FM Team Lead</option>}
                {roleTargets.allFmId && <option value={roleTargets.allFmId}>All FM</option>}
              </>)}
              {type === 'Team' && roleTargets.teams.map(t => (
                <option key={t.team_id} value={t.team_id}>{t.team_name}</option>
              ))}
            </select>
          </div>
          <div>
            <div style={{ fontSize:10, fontWeight:700, color:'var(--fg-4)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:6 }}>Note (optional)</div>
            <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Add context for the new assignee or the creator..." rows={3}
              style={{ width:'100%', background:'var(--bg-2)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 14px', fontSize:13, color:'var(--fg-0)', resize:'vertical' }} />
          </div>
          {err && <div className="text-xs" style={{ color:'var(--red)' }}>{err}</div>}
          {isL2 && <div className="text-[10px]" style={{ color:'var(--fg-4)' }}>L2 cannot reassign to FM Leadership, Game Affairs, or L3 individuals.</div>}
        </div>
        <div className="p-4 flex justify-end gap-3" style={{ borderTop:'1px solid var(--border)' }}>
          <button onClick={onClose} style={{ background:'transparent', color:'var(--fg-3)', border:'1px solid var(--border)', padding:'6px 14px', borderRadius:8, fontSize:11, fontWeight:700, cursor:'pointer', textTransform:'uppercase' }}>Cancel</button>
          <button onClick={submit} disabled={submitting || !tid}
            style={{ background:'var(--amber)', color:'black', border:'none', padding:'8px 16px', borderRadius:8, fontSize:11, fontWeight:800, cursor: submitting?'wait':'pointer', textTransform:'uppercase', letterSpacing:'0.08em', opacity: submitting ? 0.6 : 1 }}>
            {submitting ? 'Reassigning...' : 'Reassign'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const auth = useAuth();
  const { showConfirm, showPrompt, showAlert, showForm } = useDialog();
  const router = useRouter();

  // ── Data state ──
  const [data, setData] = useState({ assignedToMe: [], forMyTeam: [] });
  const [reminders, setReminders] = useState([]);
  const [teamFactions, setTeamFactions] = useState({ teamName: '', factions: [] });
  const [reassigning, setReassigning] = useState(null);
  const [recurringInstances, setRecurringInstances] = useState([]);
  const [qaCounts, setQaCounts] = useState({});
  const [completing, setCompleting] = useState(null);
  const [unclaimingTask, setUnclaimingTask] = useState(null);
  const [requestingInfo, setRequestingInfo] = useState(null);
  const [filter, setFilter] = useState('all');
  const [expandedTask, setExpandedTask] = useState(null);
  const [expandedReminder, setExpandedReminder] = useState(null);
  const [createdByMeTasks, setCreatedByMeTasks] = useState([]);
  const [teamAllTasks, setTeamAllTasks] = useState([]);
  const [taskSection, setTaskSection] = useState('assigned');
  const [queue, setQueue] = useState({ rpChanges: [], deletions: [], promos: [] });
  const [performance, setPerformance] = useState([]);
  const [guides, setGuides] = useState([]);
  const [analytics, setAnalytics] = useState({});
  const [allServerTasks, setAllServerTasks] = useState([]);
  const [expandedAllTask, setExpandedAllTask] = useState(null);
  const [serverTaskTeamFilter, setServerTaskTeamFilter] = useState('all');
  const [icContacts, setIcContacts] = useState([]);
  const [icContactsBusy, setIcContactsBusy] = useState({});
  const [icStagingId, setIcStagingId] = useState(null);
  const [icShowAll, setIcShowAll] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createMode, setCreateMode] = useState('task');
  const [staffList, setStaffList] = useState([]);
  const [roleTargets, setRoleTargets] = useState({ teams: [] });
  const [createForm, setCreateForm] = useState({
    desc: '', targetType: 'Role', targetId: '', enableDM: false,
    eventType: 'General', date: '', time: '', warning: false, note: ''
  });

  // ── Personal mentions (owner-only) ──
  const IS_FM_LEADERSHIP = auth.level >= 3;
  const [mentions, setMentions] = useState([]);
  const [mentionsOpen, setMentionsOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [replySending, setReplySending] = useState(false);
  const [replyError, setReplyError] = useState('');
  const unreadCount = mentions.filter(m => !m.is_read).length;

  // ── FM Leadership role mentions (owner-only) ──
  const [leadershipMentions, setLeadershipMentions] = useState([]);
  const [leadershipMentionsOpen, setLeadershipMentionsOpen] = useState(false);

  // ── Create task from ping ──
  const [pingTask, setPingTask]         = useState(null); // { key: 'panel-id', desc }
  const [pingTaskDesc, setPingTaskDesc] = useState('');
  const [pingTaskTarget, setPingTaskTarget] = useState('');
  const [pingTaskBusy, setPingTaskBusy] = useState(false);
  const openPingTask = (panel, id, snippet) => {
    setPingTask({ key: `${panel}-${id}` });
    setPingTaskDesc(snippet);
    setPingTaskTarget('');
  };
  const closePingTask = () => { setPingTask(null); setPingTaskDesc(''); setPingTaskTarget(''); };
  const submitPingTask = async () => {
    if (!pingTaskTarget || !pingTaskDesc.trim()) return;
    setPingTaskBusy(true);
    const [type, ...rest] = pingTaskTarget.split(':');
    await createMyTask({ desc: pingTaskDesc.trim(), targetType: type, targetId: rest.join(':'), enableDM: false });
    setPingTaskBusy(false);
    closePingTask();
  };

  // ── Forwarded DMs (all FM — opt-in) ──
  const [dmTrackingEnabled, setDmTrackingEnabled] = useState(false);
  const [forwardedDMs, setForwardedDMs]           = useState([]);
  const [dmsOpen, setDmsOpen]                     = useState(false);
  const [dmsInfoOpen, setDmsInfoOpen]             = useState(false);
  const unreadDMCount = forwardedDMs.filter(d => !d.is_read).length;

  // ── Watch role pings (all FM staff) ──
  const [watchPings, setWatchPings] = useState([]);
  const [watchPingsOpen, setWatchPingsOpen] = useState(false);
  const [watchReplyingTo, setWatchReplyingTo] = useState(null);
  const [watchReplyText, setWatchReplyText] = useState('');
  const [watchReplySending, setWatchReplySending] = useState(false);
  const [watchReplyError, setWatchReplyError] = useState('');
  const watchUnreadCount = watchPings.filter(p => !p.is_read).length;
  const [leadershipReplyingTo, setLeadershipReplyingTo] = useState(null);
  const [leadershipReplyText, setLeadershipReplyText] = useState('');
  const [leadershipReplySending, setLeadershipReplySending] = useState(false);
  const [leadershipReplyError, setLeadershipReplyError] = useState('');
  const leadershipUnreadCount = leadershipMentions.filter(m => !m.is_read).length;

  useEffect(() => {
    if (auth.loading || (!auth.isEventTeam && auth.level < 1)) return;
    getTeamWatchPings().then(rows => {
      setWatchPings(rows || []);
    });
    getMyMentions().then(rows => {
      setMentions(rows || []);
    });
    getDMTrackingStatus().then(({ enabled }) => {
      setDmTrackingEnabled(enabled);
      if (enabled) {
        getForwardedDMs().then(rows => {
          setForwardedDMs(rows || []);
        });
      }
    });
    if (!IS_FM_LEADERSHIP) return;
    getLeadershipMentions().then(rows => setLeadershipMentions(rows || []));
  }, [auth.id, auth.loading]);

  const dismissMention = async (id) => {
    await markMentionRead(id);
    setMentions(ms => ms.map(m => m.id === id ? { ...m, is_read: 1 } : m));
  };
  const dismissAll = async () => {
    await markAllMentionsRead();
    setMentions(ms => ms.map(m => ({ ...m, is_read: 1 })));
  };
  const sendReply = async () => {
    if (!replyText.trim() || replySending) return;
    setReplySending(true);
    setReplyError('');
    const res = await replyToMention(replyingTo, replyText);
    setReplySending(false);
    if (res.ok) {
      setMentions(ms => ms.map(m => m.id === replyingTo ? { ...m, is_read: 1 } : m));
      setReplyingTo(null);
      setReplyText('');
    } else {
      setReplyError(res.error || 'Failed to send.');
    }
  };

  const dismissWatchPing = async (id) => {
    await markWatchPingRead(id);
    setWatchPings(ps => ps.map(p => p.id === id ? { ...p, is_read: 1 } : p));
  };
  const dismissAllWatchPings = async () => {
    await markAllWatchPingsRead();
    setWatchPings(ps => ps.map(p => ({ ...p, is_read: 1 })));
  };
  const sendWatchReply = async () => {
    if (!watchReplyText.trim() || !watchReplyingTo) return;
    setWatchReplySending(true); setWatchReplyError('');
    const res = await replyToWatchPing(watchReplyingTo, watchReplyText);
    setWatchReplySending(false);
    if (res.ok) {
      setWatchPings(ps => ps.map(p => p.id === watchReplyingTo ? { ...p, is_read: 1 } : p));
      setWatchReplyingTo(null); setWatchReplyText('');
    } else { setWatchReplyError(res.error || 'Failed to send.'); }
  };

  const dismissLeadershipMention = async (id) => {
    await markLeadershipMentionRead(id);
    setLeadershipMentions(ms => ms.map(m => m.id === id ? { ...m, is_read: 1 } : m));
  };
  const dismissAllLeadership = async () => {
    await markAllLeadershipMentionsRead();
    setLeadershipMentions(ms => ms.map(m => ({ ...m, is_read: 1 })));
  };
  const sendLeadershipReply = async () => {
    if (!leadershipReplyText.trim() || leadershipReplySending) return;
    setLeadershipReplySending(true);
    setLeadershipReplyError('');
    const res = await replyToLeadershipMention(leadershipReplyingTo, leadershipReplyText);
    setLeadershipReplySending(false);
    if (res.ok) {
      setLeadershipMentions(ms => ms.map(m => m.id === leadershipReplyingTo ? { ...m, is_read: 1 } : m));
      setLeadershipReplyingTo(null);
      setLeadershipReplyText('');
    } else {
      setLeadershipReplyError(res.error || 'Failed to send.');
    }
  };

  // ── My RP Requests (L2+) ──
  const [myRPRequests, setMyRPRequests] = useState([]);
  const [rpRequestsOpen, setRpRequestsOpen] = useState(false);
  const [rpMarkingDone, setRpMarkingDone] = useState(null);
  const [rpDoneNote, setRpDoneNote] = useState('');
  const [rpResubmitting, setRpResubmitting] = useState(null);
  const [rpResubmitNote, setRpResubmitNote] = useState('');
  const rpActionCount = myRPRequests.filter(r => r.status === 'APPROVED' || r.status === 'DENIED').length;

  useEffect(() => {
    if (auth.loading || !auth.id || auth.level < 1) return;
    getMyRPRequests().then(rows => setMyRPRequests(rows || [])).catch(() => {});
  }, [auth.id, auth.loading]);

  // ── Layout / customization state ──
  const [layout, setLayout] = useState(null);
  const [visibleStats, setVisibleStats] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const dragSrc = useRef(null);

  // Default widget layout for this user. LSTs additionally get the Pending
  // Actions widget — they have no L2 clearance but do oversee pending items.
  const makeDefaultLayout = () => {
    if (auth.isEventTeam) return ET_LAYOUT;
    const base = DEFAULT_LAYOUTS[Math.min(auth.level, 3)] || DEFAULT_LAYOUTS[1];
    if (auth.isLeadStoryteller && !base.find(w => w.id === 'pending')) return [{ id: 'pending', size: 'full' }, ...base];
    return base;
  };

  // ── Load layout from localStorage ──
  useEffect(() => {
    if (!auth.id || auth.loading) return;
    const defaultLayout = makeDefaultLayout();
    try {
      const saved = localStorage.getItem(`mdash-layout-${auth.id}`);
      if (saved) {
        let filtered = JSON.parse(saved).filter(w => WIDGETS[w.id]);
        // Inject ic_contacts after tasks if missing
        if (!filtered.find(w => w.id === 'ic_contacts')) {
          const tasksIdx = filtered.findIndex(w => w.id === 'tasks');
          const insertAt = tasksIdx >= 0 ? tasksIdx + 1 : filtered.length;
          filtered.splice(insertAt, 0, { id: 'ic_contacts', size: 'full' });
          try { localStorage.setItem(`mdash-layout-${auth.id}`, JSON.stringify(filtered)); } catch {}
        }
        // LSTs gained the Pending Actions widget — inject it if missing.
        if (auth.isLeadStoryteller && !filtered.find(w => w.id === 'pending')) {
          filtered.unshift({ id: 'pending', size: 'full' });
          try { localStorage.setItem(`mdash-layout-${auth.id}`, JSON.stringify(filtered)); } catch {}
        }
        setLayout(filtered.length > 0 ? filtered : defaultLayout);
      } else {
        setLayout(defaultLayout);
      }
    } catch {
      setLayout(defaultLayout);
    }
    try {
      const savedStats = localStorage.getItem(`mdash-stats-${auth.id}`);
      setVisibleStats(savedStats ? JSON.parse(savedStats) : STAT_BOXES.map(s => s.id));
    } catch {
      setVisibleStats(STAT_BOXES.map(s => s.id));
    }
  }, [auth.id, auth.loading]);

  // ── Size system ──
  // 12-column grid: quarter=3, third=4, half=6, two_thirds=8, full=12
  const SIZES = [
    { key: 'quarter',    cols: 3,  label: '¼'    },
    { key: 'third',      cols: 4,  label: '⅓'    },
    { key: 'half',       cols: 6,  label: '½'    },
    { key: 'two_thirds', cols: 8,  label: '⅔'    },
    { key: 'full',       cols: 12, label: 'Full' },
  ];
  const sizeCols = (s) => SIZES.find(x => x.key === s)?.cols ?? 12;

  // ── Layout helpers ──
  const saveLayout = (next) => {
    setLayout(next);
    try { localStorage.setItem(`mdash-layout-${auth.id}`, JSON.stringify(next)); } catch {}
  };
  const removeWidget  = (id)       => saveLayout(layout.filter(w => w.id !== id));
  const setWidgetSize = (id, size) => saveLayout(layout.map(w => w.id === id ? { ...w, size } : w));
  const addWidget     = (id)       => saveLayout([...layout, { id, size: 'full' }]);
  const resetLayout   = ()         => { saveLayout(makeDefaultLayout()); saveStats(STAT_BOXES.map(s => s.id)); };
  const reorderWidgets = (from, to) => {
    const next = [...layout];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    saveLayout(next);
  };

  // ── Stat bar helpers ──
  const saveStats      = (next) => { setVisibleStats(next); try { localStorage.setItem(`mdash-stats-${auth.id}`, JSON.stringify(next)); } catch {} };
  const removeStatBox  = (id)   => saveStats((visibleStats || []).filter(s => s !== id));
  const addStatBox     = (id)   => saveStats([...(visibleStats || []), id]);

  const refreshQueue = () => {
    if (auth.level >= 2 || auth.isLeadStoryteller) getPendingQueue().then(setQueue).catch(() => {});
  };

  const refresh = async () => {
    if (!auth.id) return;
    const [t, r, f] = await Promise.all([getMyTasks(), getMyReminders(), getMyTeamFactions()]);
    setData(t);
    setReminders(r);
    setTeamFactions(f);
    getMyRecurringInstances().then(setRecurringInstances).catch(() => setRecurringInstances([]));
    const allUids = [...(t.assignedToMe || []), ...(t.forMyTeam || [])].map(x => x.task_uid).filter(Boolean);
    if (allUids.length > 0) getQACountsForTasks(allUids).then(setQaCounts).catch(() => {});
    if (auth.level >= 3) getAllServerTasks().then(d => setAllServerTasks(d || [])).catch(() => {});
    if (auth.level >= 2) {
      getMyCreatedTasks().then(setCreatedByMeTasks).catch(() => {});
      getMyTeamAllTasks().then(setTeamAllTasks).catch(() => {});
    }
    if (auth.level >= 3) getAllIcContacts().then(d => setIcContacts(d || [])).catch(() => {});
    else if (auth.teamId) getTeamIcContactsAll(auth.teamId).then(d => setIcContacts(d || [])).catch(() => {});
  };

  useEffect(() => {
    if (!auth.loading && auth.id) {
      refresh();
      getStaffForCreate().then(setStaffList);
      getRoleTargetsForCreate().then(setRoleTargets);
      if (auth.level >= 2 || auth.isLeadStoryteller) getPendingQueue().then(setQueue).catch(() => {});
      if (auth.level >= 2) {
        getTeamPerformance().then(d => setPerformance(d || [])).catch(() => {});
        getGuideActivity().then(d => setGuides(d || [])).catch(() => {});
        if (auth.level >= 3) {
          getAnalytics().then(d => setAnalytics(d || {})).catch(() => {});
          getAllServerTasks().then(d => setAllServerTasks(d || [])).catch(() => {});
        }
      }
    }
  }, [auth.id, auth.loading]);

  if (auth.loading) return <div style={{padding:40,color:'var(--fg-3)'}}>Loading…</div>;
  if (!auth.ok)     return <div style={{padding:40,color:'var(--fg-3)'}}>Not authorized.</div>;

  const actor = { id: auth.id, name: auth.displayName || auth.name };

  // Task filter/sort
  const allTasks = [...data.assignedToMe, ...data.forMyTeam];
  let displayedTasks = filter === 'mine' ? data.assignedToMe : filter === 'team' ? data.forMyTeam : allTasks;
  displayedTasks = [...displayedTasks].sort((a, b) => {
    const ac = a.claimed_by !== 'None' && a.claimed_by;
    const bc = b.claimed_by !== 'None' && b.claimed_by;
    if (ac !== bc) return ac ? 1 : -1;
    return (b.created_at || '').localeCompare(a.created_at || '');
  });

  const sortedReminders = [...reminders].sort((a, b) => a.epochMs - b.epochMs);

  const S = {
    btn:      { background:'var(--accent)', color:'white', border:'none', padding:'8px 16px', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:700 },
    btnGhost: { background:'none', color:'var(--fg-3)', border:'1px solid var(--border)', padding:'8px 16px', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:700 },
    btnDanger:{ background:'none', color:'var(--red)', border:'1px solid var(--red)', padding:'6px 12px', borderRadius:6, cursor:'pointer', fontSize:11, fontWeight:700 },
    btnSmall: { background:'none', color:'var(--accent)', border:'1px solid var(--accent)', padding:'5px 10px', borderRadius:5, cursor:'pointer', fontSize:10, fontWeight:700 },
    label:    { fontSize:9, color:'var(--fg-4)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4, fontWeight:700 },
    input:    { width:'100%', background:'var(--bg-2)', border:'1px solid var(--border)', borderRadius:6, padding:'8px 10px', fontSize:12, color:'var(--fg-1)' },
    tabBtn: (active) => ({
      background: active ? 'var(--bg-2)' : 'none',
      color: active ? 'var(--accent)' : 'var(--fg-3)',
      border: '1px solid ' + (active ? 'var(--accent)' : 'var(--border)'),
      padding:'6px 14px', borderRadius:6, cursor:'pointer', fontSize:11, fontWeight:700,
    }),
  };

  // ── Widget render functions ────────────────────────────────────────────────

  const renderPending = () => {
    const hasPending = queue.rpChanges.length > 0 || queue.deletions.length > 0 || queue.promos.length > 0;
    const total = queue.rpChanges.length + queue.deletions.length + queue.promos.length;
    const qBtn = (color, bg, border) => ({ fontSize:11, fontWeight:700, cursor:'pointer', padding:'6px 0', borderRadius:7, border:`1px solid ${border}`, background:bg, color, flex:1, letterSpacing:'0.02em' });
    return (
      <div className="sec-card">
        <div className="sec-card-hdr">
          <span>Pending Actions</span>
          <span style={{fontFamily:'var(--font-mono)'}}>{total} item{total !== 1 ? 's' : ''}</span>
        </div>
        {!hasPending ? (
          <div style={{padding:'28px 16px', textAlign:'center', color:'var(--fg-4)', fontStyle:'italic', fontSize:13}}>No pending actions.</div>
        ) : (
          <div style={{padding:'10px 14px', display:'flex', flexWrap:'wrap', gap:8}}>
            {queue.rpChanges.map(rc => {
              const statusColor = rc.status==='RP_DONE' ? 'var(--green)' : rc.status==='APPROVED' ? 'var(--accent)' : 'var(--amber)';
              const statusLabel = rc.status==='RP_DONE' ? 'READY TO EXECUTE' : rc.status==='APPROVED' ? 'AWAITING RP' : 'PENDING APPROVAL';
              return (
                <div key={rc.id} style={{padding:'10px 12px', borderRadius:8, background:'var(--amber-bg)', border:`1px solid ${rc.status==='RP_DONE'?'rgba(74,222,128,0.25)':rc.status==='APPROVED'?'rgba(160,126,245,0.2)':'rgba(251,191,36,0.2)'}`, flex:'1 1 240px', minWidth:0, display:'flex', flexDirection:'column', gap:6}}>
                  <div>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:3}}>
                      <span style={{fontSize:10, fontWeight:700, color:'var(--amber)', fontFamily:'var(--font-mono)'}}>RP CHANGE · {rc.faction_name}</span>
                      <span style={{fontSize:9, fontWeight:800, color:statusColor, fontFamily:'var(--font-mono)', letterSpacing:'0.06em'}}>{statusLabel}</span>
                    </div>
                    <div style={{fontSize:12, color:'var(--fg-1)', marginBottom:2}}>{rc.execution_type}: <strong>{rc.old_value}</strong> → <strong>{rc.new_value}</strong></div>
                    <div style={{fontSize:10, color:'var(--fg-4)', fontFamily:'var(--font-mono)'}}>{rc.requested_by} · {rc.date}</div>
                    {rc.status==='RP_DONE' && rc.rp_note && <div style={{fontSize:10, color:'var(--fg-3)', marginTop:3, fontStyle:'italic'}}>"{rc.rp_note}"</div>}
                  </div>
                  {auth.level >= 3 && (
                    <div style={{display:'flex', gap:6, borderTop:'1px solid rgba(251,191,36,0.15)', paddingTop:8}}>
                      {rc.status === 'PENDING' && <>
                        <button style={qBtn('var(--red)','transparent','rgba(248,113,113,0.3)')} onClick={async()=>{
                          const reason = await showPrompt('Reason for denial (required):','');
                          if (reason?.trim()) { await denyRPChange(rc.id, reason.trim()); refreshQueue(); getMyRPRequests().then(setMyRPRequests); }
                        }}>Deny</button>
                        <button style={qBtn('white','var(--green)','transparent')} onClick={async()=>{ await approveRPChange(rc.id); refreshQueue(); getMyRPRequests().then(setMyRPRequests); }}>Approve</button>
                      </>}
                      {rc.status === 'APPROVED' && (
                        <span style={{fontSize:10, color:'var(--accent)', fontStyle:'italic'}}>Waiting for Team Lead to confirm RP is done.</span>
                      )}
                      {rc.status === 'RP_DONE' && (
                        <button style={qBtn('white','var(--green)','transparent')} onClick={async()=>{
                          if (rc.execution_type==='NPC') {
                            const res = await showForm("Execute NPC Swap",[{name:'npcName',label:'Final NPC Name',type:'text'},{name:'npcPos',label:'TP Position',type:'text'}]);
                            if (res?.npcName) { await executeRPChange(rc.id, res); refreshQueue(); getMyRPRequests().then(setMyRPRequests); }
                          } else {
                            if (await showConfirm('Execute this change?')) { await executeRPChange(rc.id, {}); refreshQueue(); getMyRPRequests().then(setMyRPRequests); }
                          }
                        }}>Execute</button>
                      )}
                      <button style={qBtn('var(--fg-4)','transparent','rgba(255,255,255,0.08)')} onClick={async()=>{
                        if (await showConfirm(`Delete this RP change request for ${rc.faction}? This cannot be undone.`)) {
                          await deleteRPChange(rc.id);
                          refreshQueue();
                          getMyRPRequests().then(setMyRPRequests);
                        }
                      }}>Delete</button>
                    </div>
                  )}
                </div>
              );
            })}
            {queue.deletions.map(d => (
              <div key={d.id} style={{padding:'10px 12px', borderRadius:8, background:'var(--red-bg)', border:'1px solid rgba(248,113,113,0.2)', flex:'1 1 240px', minWidth:0, display:'flex', flexDirection:'column', gap:6}}>
                <div>
                  <div style={{fontSize:10, fontWeight:700, color:'var(--red)', fontFamily:'var(--font-mono)', marginBottom:3}}>DELETE REQUEST · {d.content_type}</div>
                  <div style={{fontSize:12, color:'var(--fg-1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:2}}>{d.original_text?.substring(0,100)}</div>
                  <div style={{fontSize:10, color:'var(--fg-4)', fontFamily:'var(--font-mono)'}}>{d.requested_by} · {d.created_at?.substring(0,10)}</div>
                </div>
                {auth.level >= 3 && (
                  <div style={{display:'flex', gap:6, borderTop:'1px solid rgba(248,113,113,0.15)', paddingTop:8}}>
                    <button style={qBtn('var(--fg-2)','transparent','var(--border)')} onClick={async()=>{ await resolveDeletion(d.id,false); refreshQueue(); }}>Reject</button>
                    <button style={qBtn('white','var(--red)','transparent')} onClick={async()=>{ if(await showConfirm('Permanently delete this content?')){ await resolveDeletion(d.id,true); refreshQueue(); } }}>Approve Delete</button>
                  </div>
                )}
              </div>
            ))}
            {queue.promos.map(p => {
              let displayTier = p.target_tier;
              try { displayTier = JSON.parse(p.target_tier).tier; } catch {}
              return (
                <div key={p.faction_id} style={{padding:'10px 12px', borderRadius:8, background:'var(--green-bg)', border:'1px solid rgba(74,222,128,0.2)', flex:'1 1 240px', minWidth:0, display:'flex', flexDirection:'column', gap:6}}>
                  <div>
                    <div style={{fontSize:10, fontWeight:700, color:'var(--green)', fontFamily:'var(--font-mono)', marginBottom:3}}>STAGED PROMO · {p.faction_name}</div>
                    <div style={{fontSize:12, color:'var(--fg-1)', fontFamily:'var(--font-mono)'}}>T{p.current_tier} → T{displayTier}</div>
                  </div>
                  <div style={{display:'flex', gap:6, borderTop:'1px solid rgba(74,222,128,0.15)', paddingTop:8}}>
                    {auth.level >= 3 && (
                      <button style={qBtn('var(--red)','transparent','rgba(248,113,113,0.3)')} onClick={async()=>{ if(await showConfirm(`Cancel promo for ${p.faction_name}?`)){await cancelPromotion(p.faction_id,p.faction_name,actor);refreshQueue();} }}>Cancel</button>
                    )}
                    <button style={qBtn('white','var(--green)','transparent')} onClick={async()=>{ if(await showConfirm(`Complete promo for ${p.faction_name}?`)){await completePromotion(p.faction_id,p.faction_name,actor);refreshQueue();} }}>Complete</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderTasks = () => {
    // ── L3: merged 4-section Tasks widget ─────────────────────────────────────
    if (auth.level >= 3) {
      const leadershipTasks = allServerTasks.filter(t => t.teamContext === 'Leadership');
      const teams = ['all', ...Array.from(new Set(allServerTasks.map(t => t.teamContext).filter(Boolean))).sort()];
      const filteredServerTasks = serverTaskTeamFilter === 'all' ? allServerTasks : allServerTasks.filter(t => t.teamContext === serverTaskTeamFilter);

      const L3_TABS = [
        { id: 'assigned',   label: 'Assigned to Me',    count: data.assignedToMe.length },
        { id: 'created',    label: 'Created by Me',     count: createdByMeTasks.length },
        { id: 'leadership', label: 'FM Leadership',     count: leadershipTasks.length },
        { id: 'all',        label: 'All Server Tasks',  count: allServerTasks.length },
      ];

      const effectiveSection = ['assigned','created','leadership','all'].includes(taskSection) ? taskSection : 'assigned';
      let shownTasks, emptyMsg;
      if (effectiveSection === 'created') {
        shownTasks = createdByMeTasks;
        emptyMsg = 'No tasks created by you.';
      } else if (effectiveSection === 'leadership') {
        shownTasks = leadershipTasks;
        emptyMsg = 'No tasks targeted at FM Leadership.';
      } else if (effectiveSection === 'all') {
        shownTasks = filteredServerTasks;
        emptyMsg = 'No tasks.';
      } else {
        shownTasks = data.assignedToMe;
        emptyMsg = 'No tasks assigned to you.';
      }

      const unclaimedCount = shownTasks.filter(t => !t.claimed_by || t.claimed_by === 'None').length;
      const isAllTab = effectiveSection === 'all';
      const showQA = effectiveSection === 'assigned' || effectiveSection === 'created';

      const renderL3Row = (t) => {
        const isClaimedByMe = t.claimed_by === auth.id;
        const isAssignedToMe = t.target_type === 'User' && t.target_id === auth.id;
        const isClaimed = t.claimed_by && t.claimed_by !== 'None';
        const canEdit = t.created_by_id === auth.id || auth.level >= 2;
        const isExp = expandedTask === t.task_uid;
        return (
          <div key={t.task_uid} style={{borderBottom:'1px solid var(--border)', borderLeft:(isClaimedByMe||isAssignedToMe)?'2px solid var(--accent)':undefined}}>
            <div onClick={() => setExpandedTask(isExp ? null : t.task_uid)} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',cursor:'pointer',minHeight:44}}>
              <span style={{width:7,height:7,borderRadius:'50%',background:isClaimed?'var(--green)':'var(--amber)',flexShrink:0}} />
              <span style={{flex:1,fontSize:13,color:'var(--fg-0)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',lineHeight:1.3}}>{t.description}</span>
              {isAllTab && t.teamContext && serverTaskTeamFilter==='all' && (
                <span style={{fontSize:9,fontWeight:700,padding:'1px 6px',borderRadius:4,background:'rgba(255,255,255,0.06)',color:'var(--fg-4)',fontFamily:'var(--font-mono)',flexShrink:0}}>{t.teamContext}</span>
              )}
              <span style={{fontSize:10,color:'var(--fg-4)',fontFamily:'var(--font-mono)',flexShrink:0,whiteSpace:'nowrap'}}>{t.targetLabel}</span>
              {showQA && qaCounts[t.task_uid]?.open > 0 && <span style={{fontSize:9,fontWeight:700,padding:'1px 6px',borderRadius:4,background:'var(--amber-bg)',color:'var(--amber)',fontFamily:'var(--font-mono)',flexShrink:0}}>{qaCounts[t.task_uid].open} Q</span>}
              <span style={{fontSize:10,color:'var(--fg-4)',transform:isExp?'rotate(180deg)':'none',transition:'transform 0.15s',flexShrink:0}}>▼</span>
            </div>
            {isExp && (
              <div style={{padding:'12px 16px 14px',borderTop:'1px solid rgba(255,255,255,0.05)',background:'rgba(0,0,0,0.18)'}}>
                <p style={{fontSize:13,color:'var(--fg-1)',lineHeight:1.55,marginBottom:10,whiteSpace:'pre-wrap'}}>{t.description}</p>
                <div style={{display:'flex',gap:12,fontSize:10,color:'var(--fg-4)',fontFamily:'var(--font-mono)',marginBottom:12,flexWrap:'wrap'}}>
                  <span>By <strong style={{color:'var(--fg-2)'}}>{t.created_by_name||'System'}</strong></span>
                  <span>For <strong style={{color:'var(--fg-2)'}}>{t.targetLabel}</strong></span>
                  {isAllTab && t.teamContext && <span>Team <strong style={{color:'var(--fg-2)'}}>{t.teamContext}</strong></span>}
                  <strong style={{color:isClaimed?'var(--green)':'var(--amber)'}}>{isClaimed?`Claimed · ${t.claimerName}`:'Unclaimed'}</strong>
                  {showQA && qaCounts[t.task_uid]?.total > 0 && <a href={`/fm/tasks/${t.task_uid}`} style={{color:'var(--accent)',textDecoration:'none'}}>💬 {qaCounts[t.task_uid].open>0?`${qaCounts[t.task_uid].open} open`:`${qaCounts[t.task_uid].total} answered`}</a>}
                </div>
                <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                  {!isClaimed && <button style={S.btnSmall} onClick={async()=>{await claimMyTask(t.task_uid);refresh();}}>Claim</button>}
                  {canEdit && <button style={{...S.btnSmall,color:'var(--fg-2)',borderColor:'var(--border)'}} onClick={async()=>{const v=await showPrompt('Edit:',t.description);if(v&&v!==t.description){await editMyTask(t.task_uid,v);refresh();}}}>Edit</button>}
                  <button style={{...S.btnSmall,color:'var(--amber)',borderColor:'rgba(251,191,36,0.3)'}} onClick={()=>setReassigning(t)}>Reassign</button>
                  {t.created_by_id&&t.created_by_id!==auth.id && <button style={{...S.btnSmall,color:'var(--accent)',borderColor:'rgba(160,126,245,0.3)'}} onClick={()=>setRequestingInfo(t)}>Request Info</button>}
                  {isClaimed&&(t.claimed_by===auth.id||auth.level>=3) && <button style={{...S.btnSmall,color:'var(--fg-2)',borderColor:'var(--border)'}} onClick={()=>setUnclaimingTask(t)}>Unclaim</button>}
                  <button style={S.btnDanger} onClick={()=>setCompleting(t)}>Complete</button>
                </div>
              </div>
            )}
          </div>
        );
      };

      return (
        <div className="sec-card">
          <div className="sec-card-hdr">
            <span>Tasks</span>
            <span style={{fontFamily:'var(--font-mono)',fontSize:11,color:'var(--fg-3)'}}>{shownTasks.length} tasks · <span style={{color:'var(--amber)'}}>{unclaimedCount} unclaimed</span></span>
          </div>
          {/* Section tabs */}
          <div style={{padding:'8px 14px 0',display:'flex',gap:6,flexWrap:'wrap'}}>
            {L3_TABS.map(tab => (
              <button key={tab.id} onClick={() => { setTaskSection(tab.id); setExpandedTask(null); }}
                style={{padding:'3px 10px',borderRadius:6,fontSize:10,fontWeight:600,cursor:'pointer',border:'none',
                  background:effectiveSection===tab.id?'rgba(160,126,245,0.2)':'rgba(255,255,255,0.05)',
                  color:effectiveSection===tab.id?'var(--accent-h)':'var(--fg-3)'}}>
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>
          {/* Team sub-filter for All Server Tasks */}
          {isAllTab && (
            <div style={{padding:'5px 14px 0',display:'flex',gap:5,flexWrap:'wrap'}}>
              {teams.map(team => (
                <button key={team} onClick={() => { setServerTaskTeamFilter(team); setExpandedTask(null); }}
                  style={{padding:'2px 8px',borderRadius:5,fontSize:9,fontWeight:600,cursor:'pointer',border:'none',
                    background:serverTaskTeamFilter===team?'rgba(160,126,245,0.15)':'rgba(255,255,255,0.04)',
                    color:serverTaskTeamFilter===team?'var(--accent-h)':'var(--fg-4)'}}>
                  {team==='all'?`All (${allServerTasks.length})`:team}
                </button>
              ))}
            </div>
          )}
          {shownTasks.length === 0 ? (
            <div style={{padding:'32px 16px',textAlign:'center',color:'var(--fg-4)',fontStyle:'italic',fontSize:13}}>{emptyMsg}</div>
          ) : shownTasks.map(renderL3Row)}
        </div>
      );
    }

    // ── L1 / L2: original tasks widget ────────────────────────────────────────
    const tabs = [
      { id: 'assigned', label: `Assigned to Me (${data.assignedToMe.length})` },
      ...(auth.level >= 2 ? [{ id: 'created', label: `Created by Me (${createdByMeTasks.length})` }] : []),
      ...(auth.level >= 2 && auth.level < 3 ? [{ id: 'team', label: `My Team (${teamAllTasks.length})` }] : []),
    ];
    const shownTasks = taskSection === 'created' ? createdByMeTasks : taskSection === 'team' ? teamAllTasks : data.assignedToMe;
    const emptyMsg = taskSection === 'created' ? 'No tasks created by you.' : taskSection === 'team' ? 'No tasks targeted at your team.' : 'No tasks assigned to you.';
    const unclaimedCount = shownTasks.filter(t => !t.claimed_by || t.claimed_by === 'None').length;

    return (
      <div className="sec-card">
        <div className="sec-card-hdr">
          <span>Active Tasks</span>
          <span style={{fontFamily:'var(--font-mono)',fontSize:11,color:'var(--fg-3)'}}>{shownTasks.length} tasks · <span style={{color:'var(--amber)'}}>{unclaimedCount} unclaimed</span></span>
        </div>
        {tabs.length > 1 && (
          <div style={{padding:'8px 14px 0',display:'flex',gap:6,flexWrap:'wrap'}}>
            {tabs.map(tab => (
              <button key={tab.id} onClick={() => { setTaskSection(tab.id); setExpandedTask(null); }}
                style={{padding:'3px 10px',borderRadius:6,fontSize:10,fontWeight:600,cursor:'pointer',border:'none',background:taskSection===tab.id?'rgba(160,126,245,0.2)':'rgba(255,255,255,0.05)',color:taskSection===tab.id?'var(--accent-h)':'var(--fg-3)'}}>
                {tab.label}
              </button>
            ))}
          </div>
        )}
        {shownTasks.length === 0 ? (
          <div style={{padding:'32px 16px',textAlign:'center',color:'var(--fg-4)',fontStyle:'italic',fontSize:13}}>{emptyMsg}</div>
        ) : shownTasks.map(t => {
          const isClaimedByMe = t.claimed_by === auth.id;
          const isAssignedToMe = t.target_type === 'User' && t.target_id === auth.id;
          const isClaimed = t.claimed_by && t.claimed_by !== 'None';
          const canEdit = t.created_by_id === auth.id || auth.level >= 2;
          const isExp = expandedTask === t.task_uid;
          return (
            <div key={t.task_uid} style={{borderBottom:'1px solid var(--border)', borderLeft:(isClaimedByMe||isAssignedToMe)?'2px solid var(--accent)':undefined}}>
              <div onClick={() => setExpandedTask(isExp ? null : t.task_uid)} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',cursor:'pointer',minHeight:44}}>
                <span style={{width:7,height:7,borderRadius:'50%',background:isClaimed?'var(--green)':'var(--amber)',flexShrink:0}} />
                <span style={{flex:1,fontSize:13,color:'var(--fg-0)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',lineHeight:1.3}}>{t.description}</span>
                <span style={{fontSize:10,color:'var(--fg-4)',fontFamily:'var(--font-mono)',flexShrink:0,whiteSpace:'nowrap'}}>{t.targetLabel}</span>
                {qaCounts[t.task_uid]?.open > 0 && <span style={{fontSize:9,fontWeight:700,padding:'1px 6px',borderRadius:4,background:'var(--amber-bg)',color:'var(--amber)',fontFamily:'var(--font-mono)',flexShrink:0}}>{qaCounts[t.task_uid].open} Q</span>}
                <span style={{fontSize:10,color:'var(--fg-4)',transform:isExp?'rotate(180deg)':'none',transition:'transform 0.15s',flexShrink:0}}>▼</span>
              </div>
              {isExp && (
                <div style={{padding:'12px 16px 14px',borderTop:'1px solid rgba(255,255,255,0.05)',background:'rgba(0,0,0,0.18)'}}>
                  <p style={{fontSize:13,color:'var(--fg-1)',lineHeight:1.55,marginBottom:10,whiteSpace:'pre-wrap'}}>{t.description}</p>
                  <div style={{display:'flex',gap:12,fontSize:10,color:'var(--fg-4)',fontFamily:'var(--font-mono)',marginBottom:12,flexWrap:'wrap'}}>
                    <span>By <strong style={{color:'var(--fg-2)'}}>{t.created_by_name||'System'}</strong></span>
                    <span>For <strong style={{color:'var(--fg-2)'}}>{t.targetLabel}</strong></span>
                    <strong style={{color:isClaimed?'var(--green)':'var(--amber)'}}>{isClaimed?`Claimed · ${t.claimerName}`:'Unclaimed'}</strong>
                    {qaCounts[t.task_uid]?.total > 0 && <a href={`/fm/tasks/${t.task_uid}`} style={{color:'var(--accent)',textDecoration:'none'}}>💬 {qaCounts[t.task_uid].open>0?`${qaCounts[t.task_uid].open} open`:`${qaCounts[t.task_uid].total} answered`}</a>}
                  </div>
                  <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                    {!isClaimed && <button style={S.btnSmall} onClick={async()=>{await claimMyTask(t.task_uid);refresh();}}>Claim</button>}
                    {canEdit && <button style={{...S.btnSmall,color:'var(--fg-2)',borderColor:'var(--border)'}} onClick={async()=>{const v=await showPrompt('Edit:',t.description);if(v&&v!==t.description){await editMyTask(t.task_uid,v);refresh();}}}>Edit</button>}
                    {auth.level>=2 && <button style={{...S.btnSmall,color:'var(--amber)',borderColor:'rgba(251,191,36,0.3)'}} onClick={()=>setReassigning(t)}>Reassign</button>}
                    {t.created_by_id&&t.created_by_id!==auth.id && <button style={{...S.btnSmall,color:'var(--accent)',borderColor:'rgba(160,126,245,0.3)'}} onClick={()=>setRequestingInfo(t)}>Request Info</button>}
                    {isClaimed&&(t.claimed_by===auth.id||auth.level>=3) && <button style={{...S.btnSmall,color:'var(--fg-2)',borderColor:'var(--border)'}} onClick={()=>setUnclaimingTask(t)}>Unclaim</button>}
                    <button style={S.btnDanger} onClick={()=>setCompleting(t)}>Complete</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderReminders = () => (
    <div className="sec-card">
      <div className="sec-card-hdr">
        <span>Events &amp; Reminders</span>
        <button onClick={()=>{setShowCreate(true);setCreateMode('reminder');}} style={{fontSize:10,fontWeight:700,color:'var(--accent)',background:'transparent',border:'none',cursor:'pointer',letterSpacing:'0.04em'}}>+ Schedule</button>
      </div>
      {sortedReminders.length === 0 ? (
        <div style={{padding:'32px 16px',textAlign:'center',color:'var(--fg-4)',fontStyle:'italic',fontSize:13}}>No upcoming events.</div>
      ) : sortedReminders.map(r => {
        const isOwner = r.author_id === auth.id;
        const isExp = expandedReminder === r.uuid;
        const when = new Date(r.epochMs);
        const isUrgent = r.epochMs - Date.now() < 86400000;
        return (
          <div key={r.uuid} style={{borderBottom:'1px solid var(--border)', borderLeft: isUrgent ? '2px solid var(--amber)' : undefined}}>
            <div onClick={()=>setExpandedReminder(isExp?null:r.uuid)} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',cursor:'pointer',minHeight:44}}>
              <span style={{width:7,height:7,borderRadius:'50%',background:isUrgent?'var(--amber)':'var(--accent)',flexShrink:0}} />
              <span style={{flex:1,fontSize:13,color:'var(--fg-0)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.message}</span>
              <span style={{fontSize:10,color:isUrgent?'var(--amber)':'var(--fg-4)',fontFamily:'var(--font-mono)',flexShrink:0,whiteSpace:'nowrap'}}>
                {when.toLocaleDateString(undefined,{month:'short',day:'numeric'})} {when.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}
              </span>
              <span style={{fontSize:10,color:'var(--fg-4)',transform:isExp?'rotate(180deg)':'none',transition:'transform 0.15s',flexShrink:0}}>▼</span>
            </div>
            {isExp && (
              <div style={{padding:'10px 16px 14px',borderTop:'1px solid rgba(255,255,255,0.05)',background:'rgba(0,0,0,0.18)'}}>
                <div style={{display:'flex',gap:12,fontSize:10,color:'var(--fg-4)',fontFamily:'var(--font-mono)',marginBottom:10,flexWrap:'wrap'}}>
                  <span>By <strong style={{color:'var(--fg-2)'}}>{r.authorName}</strong></span>
                  <span>When <strong style={{color:isUrgent?'var(--amber)':'var(--fg-2)'}}>{when.toLocaleString()}</strong></span>
                  {r.target_tag && <span>Target <code style={{background:'rgba(255,255,255,0.06)',padding:'1px 5px',borderRadius:3}}>{r.target_tag}</code></span>}
                </div>
                <div style={{display:'flex',gap:6}}>
                  <button style={S.btnSmall} onClick={async()=>{await snoozeMyReminder(r.uuid);refresh();}}>Snooze 1h</button>
                  {(isOwner||auth.level>=2) && <button style={S.btnDanger} onClick={async()=>{if(await showConfirm('Delete this reminder?')){await deleteMyReminder(r.uuid);refresh();}}}>Delete</button>}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  const renderPerformance = () => (
    <div className="sec-card">
      <div className="sec-card-hdr">
        <span>Team Performance — 30d</span>
        <span style={{fontFamily:'var(--font-mono)'}}>{performance.length} teams</span>
      </div>
      {performance.length === 0 ? (
        <div style={{padding:'28px 16px',textAlign:'center',color:'var(--fg-4)',fontStyle:'italic',fontSize:13}}>Loading performance data…</div>
      ) : (
        <table className="dtable">
          <thead><tr><th>Team</th><th style={{textAlign:'right'}}>Scenes</th><th style={{textAlign:'right'}}>Forum</th><th style={{textAlign:'right'}}>Open</th></tr></thead>
          <tbody>
            {performance.map(t => (
              <tr key={t.teamId}>
                <td>
                  <div style={{fontWeight:600,fontSize:12,lineHeight:1.3}}>{t.teamName}</div>
                  <div style={{fontSize:9,color:'var(--fg-4)',fontFamily:'var(--font-mono)',marginTop:1}}>{t.guideCount}G · {t.factionCount}F · {t.leadName}</div>
                </td>
                <td style={{textAlign:'right',fontFamily:'var(--font-mono)',fontWeight:600,color:'var(--accent)'}}>{t.scenes30}</td>
                <td style={{textAlign:'right',fontFamily:'var(--font-mono)',color:'var(--amber)'}}>{t.forumPosts30}</td>
                <td style={{textAlign:'right',fontFamily:'var(--font-mono)',color:t.openTasks>0?'var(--red)':'var(--fg-3)'}}>{t.openTasks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  const renderGuides = () => (
    <div className="sec-card" style={{display:'flex',flexDirection:'column'}}>
      <div className="sec-card-hdr">
        <span>Guide Activity — 30d</span>
        <span style={{fontFamily:'var(--font-mono)'}}>{guides.length} guides</span>
      </div>
      {guides.length === 0 ? (
        <div style={{padding:'28px 16px',textAlign:'center',color:'var(--fg-4)',fontStyle:'italic',fontSize:13}}>Loading guide data…</div>
      ) : (
        <div style={{overflowY:'auto',maxHeight:320}} className="scr">
          <table className="dtable">
            <thead style={{position:'sticky',top:0,background:'var(--bg-2)',zIndex:1}}>
              <tr><th style={{width:28}}>#</th><th>Guide</th><th style={{textAlign:'right'}}>30d</th><th style={{textAlign:'right'}}>Notes</th></tr>
            </thead>
            <tbody>
              {[...guides].sort((a,b)=>b.scenes30-a.scenes30).map((g,i)=>(
                <tr key={g.id||i}>
                  <td style={{color:'var(--fg-4)',fontFamily:'var(--font-mono)'}}>{i+1}</td>
                  <td><span style={{fontWeight:500,fontSize:12}}>{g.name}</span><span style={{marginLeft:6,fontSize:9,color:'var(--fg-4)'}}>{g.team}</span></td>
                  <td style={{textAlign:'right',fontFamily:'var(--font-mono)',fontWeight:600,color:g.scenes30>=10?'var(--green)':g.scenes30>=5?'var(--amber)':'var(--red)'}}>{g.scenes30}</td>
                  <td style={{textAlign:'right',fontFamily:'var(--font-mono)',color:'var(--fg-3)'}}>{g.notes30}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const renderProperties = () => (
    <div className="sec-card">
      <div className="sec-card-hdr">Properties</div>
      <div style={{padding:'10px 14px', display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:8}}>
        {[
          ['Total Properties', analytics.total_properties,  'var(--green)'],
          ['Confiscated',      analytics.confiscated_assets, 'var(--amber)'],
        ].map(([k,v,col]) => (
          <div key={k} onClick={()=>router.push('/fm/operations/properties')}
            style={{padding:'12px 14px',background:'var(--bg-2)',borderRadius:8,cursor:'pointer',transition:'background 0.15s'}}
            onMouseEnter={e=>e.currentTarget.style.background='var(--bg-1)'}
            onMouseLeave={e=>e.currentTarget.style.background='var(--bg-2)'}
          >
            <div style={{fontSize:24,fontWeight:300,fontFamily:'var(--font-mono)',color:col,lineHeight:1,marginBottom:5}}>{v??'—'}</div>
            <div style={{fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.14em',color:'var(--fg-2)',fontFamily:'var(--font-mono)'}}>{k}</div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderFactions = () => (
    teamFactions.factions.length === 0 ? (
      <div className="sec-card">
        <div className="sec-card-hdr"><span>My Factions</span></div>
        <div style={{padding:'28px 16px',textAlign:'center',color:'var(--fg-4)',fontStyle:'italic',fontSize:13}}>No factions assigned.</div>
      </div>
    ) : (
      <div className="sec-card">
        <div className="sec-card-hdr">
          <span>{auth.level>=3 ? 'All Factions' : (teamFactions.teamName ? `${teamFactions.teamName} Factions` : 'My Factions')}</span>
          <span style={{fontFamily:'var(--font-mono)'}}>{teamFactions.factions.length}</span>
        </div>
        <div style={{padding:'10px 14px',display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:8}}>
          {teamFactions.factions.map(f => (
            <div key={f.id}
              onClick={()=>router.push(`/fm/factions?detail=${encodeURIComponent(f.name)}`)}
              style={{padding:'10px 12px',borderRadius:9,cursor:'pointer',background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.08)',transition:'border-color 0.15s,background 0.15s'}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor='var(--accent)';e.currentTarget.style.background='rgba(160,126,245,0.07)';}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor='rgba(255,255,255,0.08)';e.currentTarget.style.background='rgba(255,255,255,0.03)';}}
            >
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:5,gap:6}}>
                <div style={{fontWeight:600,fontSize:12,color:'var(--fg-0)',lineHeight:1.3,flex:1,minWidth:0}}>{f.name}</div>
                <div style={{display:'flex',gap:4,flexShrink:0}}>
                  <a href={`https://meridiandatabase.net/faction/${encodeURIComponent(f.name)}`} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={{fontSize:8,fontWeight:700,padding:'1px 5px',borderRadius:3,border:'1px solid rgba(99,102,241,0.3)',background:'rgba(99,102,241,0.08)',color:'#818cf8',textDecoration:'none'}}>Portal ↗</a>
                  <span style={{fontSize:8,fontWeight:700,padding:'1px 5px',borderRadius:3,background:'rgba(255,255,255,0.07)',color:'var(--fg-3)',fontFamily:'var(--font-mono)'}}>T{f.tier}</span>
                </div>
              </div>
              {f.pending_promo && <div style={{fontSize:8,fontWeight:700,color:'var(--amber)',marginBottom:3}}>PROMO PENDING</div>}
              <div style={{display:'flex',justifyContent:'space-between',fontSize:9,color:'var(--fg-4)',fontFamily:'var(--font-mono)'}}>
                <span>{f.scenes30d}sc</span><span>{f.forum_posts_30d||0}fr</span>
              </div>
              <div style={{fontSize:9,color:'var(--fg-4)',marginTop:3,fontFamily:'var(--font-mono)'}}>↳ {f.leadName}</div>
            </div>
          ))}
        </div>
      </div>
    )
  );

  const IC_STATUS = {
    pending_discussion: { label: 'Pending Discussion', color: 'var(--amber)', bg: 'var(--amber-bg)' },
    pending_roleplay:   { label: 'Pending Roleplay',   color: 'var(--blue)',  bg: 'var(--blue-bg)'  },
    completed:          { label: 'Completed',           color: 'var(--green)', bg: 'var(--green-bg)' },
  };

  const refreshIcContacts = () => {
    if (auth.level >= 3) getAllIcContacts().then(d => setIcContacts(d || [])).catch(() => {});
    else if (auth.teamId) getTeamIcContactsAll(auth.teamId).then(d => setIcContacts(d || [])).catch(() => {});
  };

  const renderIcContacts = () => {
    const visible = icShowAll ? icContacts : icContacts.filter(c => c.status !== 'completed');
    const activeCount = icContacts.filter(c => c.status !== 'completed').length;
    const btnSm = (color) => ({fontSize:10, fontWeight:700, padding:'3px 9px', borderRadius:6, border:`1px solid var(--border)`, background:'transparent', color, cursor:'pointer'});
    const inp = {background:'var(--bg-2)', border:'1px solid var(--border)', borderRadius:7, padding:'6px 10px', fontSize:12, color:'var(--fg-0)', outline:'none', width:'100%'};
    return (
      <div className="sec-card">
        <div className="sec-card-hdr">
          <span>IC Contacts</span>
          <div style={{display:'flex', alignItems:'center', gap:8}}>
            <span style={{fontFamily:'var(--font-mono)', color:'var(--fg-4)'}}>{activeCount} active</span>
            <button onClick={() => setIcShowAll(v => !v)} style={{fontSize:9, fontWeight:700, padding:'2px 8px', borderRadius:4, border:'1px solid var(--border)', background: icShowAll ? 'var(--accent-bg)' : 'transparent', color: icShowAll ? 'var(--accent)' : 'var(--fg-4)', cursor:'pointer', textTransform:'uppercase', letterSpacing:'0.06em'}}>
              {icShowAll ? 'All' : 'Active'}
            </button>
          </div>
        </div>
        {visible.length === 0 ? (
          <div style={{padding:'28px 16px', textAlign:'center', color:'var(--fg-4)', fontStyle:'italic', fontSize:13}}>{icShowAll ? 'No IC contacts.' : 'No active IC contacts.'}</div>
        ) : (
          <div style={{display:'flex', flexDirection:'column'}}>
            {visible.map(c => {
              const meta = IC_STATUS[c.status] || IC_STATUS.pending_discussion;
              const busy = icContactsBusy[c.id];
              const isStaging = icStagingId === c.id;

              const doComplete = async () => {
                setIcContactsBusy(b => ({...b, [c.id]: true}));
                await completeIcContact(c.id);
                setIcContactsBusy(b => ({...b, [c.id]: false}));
                refreshIcContacts();
              };
              const doStage = async (rpData) => {
                setIcContactsBusy(b => ({...b, [c.id]: true}));
                await stageRoleplay(c.id, rpData);
                setIcStagingId(null);
                setIcContactsBusy(b => ({...b, [c.id]: false}));
                refreshIcContacts();
              };

              return (
                <div key={c.id} style={{padding:'12px 16px', borderBottom:'1px solid var(--border)'}}>
                  <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, marginBottom:6, flexWrap:'wrap'}}>
                    <div style={{display:'flex', alignItems:'center', gap:8}}>
                      <span style={{fontSize:12, fontWeight:700, color:'var(--fg-0)'}}>{c.faction_name}</span>
                      <span style={{fontSize:10, color:'var(--fg-4)'}}>·</span>
                      <span style={{fontSize:11, color:'var(--fg-3)'}}>{c.sender_name}</span>
                      {c.team_name && auth.level >= 3 && (
                        <span style={{fontSize:9, fontWeight:700, padding:'1px 6px', borderRadius:4, background:'var(--accent-bg)', color:'var(--accent)'}}>{c.team_name}</span>
                      )}
                    </div>
                    <div style={{display:'flex', alignItems:'center', gap:6}}>
                      {c.assigned_name && <span style={{fontSize:10, color:'var(--accent)'}}>{c.assigned_name}</span>}
                      {c.thread_id && (
                        <a href={`https://discord.com/channels/@me/${c.thread_id}`} target="_blank" rel="noreferrer"
                          style={{fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:4, border:'1px solid rgba(88,101,242,0.3)', background:'transparent', color:'#818cf8', textDecoration:'none'}}>Thread ↗</a>
                      )}
                      {c.status === 'completed' ? (
                        <span style={{fontSize:9, fontWeight:700, padding:'3px 8px', borderRadius:5, background:meta.bg, color:meta.color, fontFamily:'var(--font-mono)', letterSpacing:'0.05em', textTransform:'uppercase'}}>Completed</span>
                      ) : (
                        <select
                          disabled={busy}
                          value={c.status}
                          onChange={async e => {
                            const s = e.target.value;
                            setIcContactsBusy(b => ({...b, [c.id]: true}));
                            if (s === 'completed') await completeIcContact(c.id);
                            else await setIcContactStatus(c.id, s);
                            setIcContactsBusy(b => ({...b, [c.id]: false}));
                            refreshIcContacts();
                          }}
                          style={{fontSize:9, fontWeight:700, padding:'3px 6px', borderRadius:5, background:meta.bg, color:meta.color, border:`1px solid ${meta.color}44`, cursor:'pointer', outline:'none', fontFamily:'var(--font-mono)', letterSpacing:'0.05em', textTransform:'uppercase'}}
                        >
                          <option value="pending_discussion">Pending Discussion</option>
                          <option value="pending_roleplay">Pending Roleplay</option>
                          <option value="completed">Completed</option>
                        </select>
                      )}
                    </div>
                  </div>

                  <p style={{fontSize:12, color:'var(--fg-2)', lineHeight:1.6, margin:'0 0 10px', whiteSpace:'pre-wrap', maxHeight:72, overflow:'hidden'}}>{c.message}</p>

                  {/* Request RP Change inline form */}
                  {isStaging && c.status !== 'completed' && (
                    <div style={{marginBottom:8}}>
                      <RpChangeForm contact={c} busy={busy} onSubmit={doStage} onCancel={() => setIcStagingId(null)} />
                    </div>
                  )}

                  {!isStaging && c.status !== 'completed' && auth.level >= 2 && (
                    <div style={{display:'flex', flexWrap:'wrap', gap:5}}>
                      <button disabled={busy} onClick={() => setIcStagingId(c.id)}
                        style={btnSm('var(--blue)')}>Request RP Change</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const RENDER = {
    pending:      renderPending,
    tasks:        renderTasks,
    reminders:    renderReminders,
    performance:  renderPerformance,
    guides:       renderGuides,
    properties:   renderProperties,
    factions:     renderFactions,
    ic_contacts:  renderIcContacts,
  };

  // Widgets accessible at the current level
  const accessibleLayout = (layout || []).filter(w => {
    const def = WIDGETS[w.id];
    if (!def) return false;
    if (auth.isEventTeam) return !!def.eventTeam;
    if (def.lst && auth.isLeadStoryteller) return true;
    return def.minLevel <= auth.level;
  });
  const currentIds = new Set(accessibleLayout.map(w => w.id));
  const availableToAdd = Object.entries(WIDGETS).filter(([id, def]) => {
    if (currentIds.has(id)) return false;
    if (auth.isEventTeam) return !!def.eventTeam;
    if (def.lst && auth.isLeadStoryteller) return true;
    return def.minLevel <= auth.level;
  });

  // ── Edit mode chrome styles ──
  const editBar = {
    wrapper:   { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'6px 10px', background:'rgba(160,126,245,0.13)', border:'1px solid rgba(160,126,245,0.3)', borderBottom:'none', borderRadius:'10px 10px 0 0', cursor:'grab', userSelect:'none', gap:8, flexWrap:'wrap' },
    name:      { fontSize:10, fontWeight:700, color:'var(--accent)', fontFamily:'var(--font-mono)', flexShrink:0 },
    sizeBtn:   (active) => ({ padding:'2px 8px', borderRadius:5, border:`1px solid ${active?'var(--accent)':'rgba(160,126,245,0.25)'}`, background: active?'rgba(160,126,245,0.25)':'transparent', color: active?'var(--accent)':'var(--fg-3)', fontSize:10, fontWeight:700, cursor:'pointer', letterSpacing:'0.04em', transition:'all 0.1s' }),
    removeBtn: { padding:'2px 8px', borderRadius:5, border:'1px solid rgba(248,113,113,0.4)', background:'transparent', color:'var(--red)', fontSize:12, fontWeight:700, cursor:'pointer' },
  };

  return (
    <div style={{padding:'14px 18px 32px', display:'flex', flexDirection:'column', gap:16, maxWidth:1100, width:'100%', boxSizing:'border-box', margin:'0 auto'}}>

      {/* ── Header ── */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
        <div>
          <div style={{fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.22em',color:'var(--accent)',fontFamily:'var(--font-mono)',marginBottom:3}}>Faction Management / Dashboard</div>
          <h1 style={{fontSize:20,fontWeight:700,margin:0,letterSpacing:'-0.01em',fontFamily:'var(--font-display)'}}>Welcome back, {auth.displayName || auth.name}</h1>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          {auth.level >= 1 && <SopLink title="Quick Reference" label="Dashboard Guide" />}
          {auth.level >= 1 && <SopLink title="Tasks & Reminders" label="Task Guide" />}
          <button
            onClick={() => setEditMode(m => !m)}
            style={{
              background: editMode ? 'rgba(74,222,128,0.15)' : 'transparent',
              color: editMode ? 'var(--green)' : 'var(--fg-3)',
              border: `1px solid ${editMode ? 'rgba(74,222,128,0.4)' : 'var(--border)'}`,
              padding:'7px 14px', borderRadius:6, cursor:'pointer', fontSize:11, fontWeight:700, letterSpacing:'0.04em',
            }}>
            {editMode ? '✓ Done' : '⊞ Customize'}
          </button>
          <button style={S.btn} onClick={()=>{setShowCreate(true);setCreateMode('task');}}>+ Create</button>
        </div>
      </div>

      {/* ── Forwarded DMs Panel (all FM — opt-in) ── */}
      <div style={{borderRadius:10, border:'1px solid var(--border)', background:'var(--bg-2)', overflow:'hidden', marginBottom:8}}>
          <div onClick={() => dmTrackingEnabled ? setDmsOpen(o => !o) : setDmsInfoOpen(o => !o)} style={{display:'flex', alignItems:'center', gap:10, padding:'10px 14px', cursor:'pointer', userSelect:'none', background: (dmsOpen||dmsInfoOpen) ? 'var(--bg-3)' : 'transparent', transition:'background 0.12s'}}>
            <span style={{fontSize:16}}>💬</span>
            <span style={{fontSize:12, fontWeight:700, color:'var(--fg-1)'}}>Forwarded DMs</span>
            {dmTrackingEnabled && unreadDMCount > 0 && (
              <span style={{fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:10, background:'var(--accent)', color:'#fff'}}>{unreadDMCount} new</span>
            )}
            {!dmTrackingEnabled && <span style={{fontSize:10, color:'var(--fg-4)', fontStyle:'italic'}}>not enabled</span>}
            <span style={{marginLeft:'auto', fontSize:12, color:'var(--fg-4)'}}>{(dmsOpen||dmsInfoOpen) ? '▲' : '▼'}</span>
            {dmsOpen && unreadDMCount > 0 && (
              <button style={{fontSize:10, color:'var(--fg-3)', background:'none', border:'1px solid var(--border)', borderRadius:5, padding:'2px 8px', cursor:'pointer'}}
                onClick={e => { e.stopPropagation(); markAllDMsRead().then(() => setForwardedDMs(ds => ds.map(d => ({...d, is_read:1})))); }}>
                Mark all read
              </button>
            )}
          </div>

          {/* Opt-in / info panel */}
          {dmsInfoOpen && !dmTrackingEnabled && (
            <div style={{borderTop:'1px solid var(--border)', padding:'14px 16px'}}>
              <div style={{fontSize:12, color:'var(--fg-1)', fontWeight:600, marginBottom:6}}>Forward Discord DMs to your dashboard</div>
              <div style={{fontSize:12, color:'var(--fg-3)', lineHeight:1.7, marginBottom:12}}>
                When enabled, you can forward any Discord DM to the <strong style={{color:'var(--fg-1)'}}>Meridian Database bot</strong> and it will appear here — with a link back to the original conversation and a button to create a task from it.
                <br /><br />
                <strong style={{color:'var(--fg-1)'}}>How to use:</strong> Open a DM with the bot in Discord, then forward any message to it. That's it.
              </div>
              <button style={{padding:'7px 16px', borderRadius:7, background:'var(--accent)', border:'none', color:'#fff', fontSize:12, fontWeight:700, cursor:'pointer'}}
                onClick={() => {
                  toggleDMTracking(true).then(() => {
                    setDmTrackingEnabled(true);
                    setDmsInfoOpen(false);
                    setDmsOpen(true);
                    getForwardedDMs().then(rows => setForwardedDMs(rows || []));
                  });
                }}>
                Enable DM Tracking
              </button>
            </div>
          )}

          {/* DM list */}
          {dmsOpen && dmTrackingEnabled && (
            <div style={{maxHeight:480, overflowY:'auto', borderTop:'1px solid var(--border)'}}>
              <div style={{display:'flex', justifyContent:'flex-end', padding:'6px 14px', borderBottom:'1px solid var(--border)'}}>
                <button style={{fontSize:10, color:'var(--red)', background:'none', border:'none', cursor:'pointer', opacity:0.7}}
                  onClick={() => { if(window.confirm('Disable DM tracking?')) { toggleDMTracking(false).then(() => { setDmTrackingEnabled(false); setDmsOpen(false); setForwardedDMs([]); }); } }}>
                  Disable DM Tracking
                </button>
              </div>
              {forwardedDMs.length === 0 ? (
                <div style={{padding:'16px', fontSize:12, color:'var(--fg-4)', fontStyle:'italic'}}>No forwarded DMs yet. Open a DM with the Meridian Database bot in Discord and forward any message to it.</div>
              ) : forwardedDMs.map(dm => (
                <div key={dm.id} style={{padding:'10px 14px', borderBottom:'1px solid var(--border)', background: dm.is_read ? 'transparent' : 'rgba(160,126,245,0.04)'}}>
                  <div style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:8}}>
                    <div style={{flex:1, minWidth:0}}>
                      {!dm.is_read && <span style={{display:'inline-block', width:6, height:6, borderRadius:'50%', background:'var(--accent)', marginRight:6, verticalAlign:'middle', flexShrink:0}} />}
                      <span style={{fontSize:11, color:'var(--fg-4)', fontFamily:'var(--font-mono)', marginBottom:4, display:'block'}}>{dm.author_name ? `from ${dm.author_name} · ` : ''}{new Date(dm.forwarded_at).toLocaleString('en-GB', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'})}</span>
                      <p style={{fontSize:13, color:'var(--fg-1)', lineHeight:1.55, margin:0, whiteSpace:'pre-wrap', wordBreak:'break-word'}}>{dm.content}</p>
                    </div>
                  </div>
                  <div style={{display:'flex', gap:6, marginTop:8, flexWrap:'wrap'}}>
                    <button style={{fontSize:10, fontWeight:700, color:'var(--accent)', background:'var(--accent-bg)', border:'1px solid var(--accent)', borderRadius:5, padding:'3px 10px', cursor:'pointer'}}
                      onClick={() => { openPingTask('dm', dm.id, dm.content); if (!dm.is_read) { markDMRead(dm.id); setForwardedDMs(ds => ds.map(d => d.id===dm.id ? {...d,is_read:1} : d)); } }}>
                      + Create Task
                    </button>
                    {dm.source_channel_id && (
                      <a
                        href={`https://discord.com/channels/@me/${dm.source_channel_id}${dm.source_message_id ? '/' + dm.source_message_id : ''}`}
                        target="_blank" rel="noreferrer"
                        style={{fontSize:10, color:'#818cf8', background:'rgba(88,101,242,0.1)', border:'1px solid rgba(88,101,242,0.25)', borderRadius:5, padding:'3px 10px', textDecoration:'none', display:'inline-flex', alignItems:'center', gap:4}}>
                        ↗ Open DM
                      </a>
                    )}
                    {!dm.is_read && (
                      <button style={{fontSize:10, color:'var(--fg-3)', background:'none', border:'1px solid var(--border)', borderRadius:5, padding:'3px 10px', cursor:'pointer'}}
                        onClick={() => { markDMRead(dm.id); setForwardedDMs(ds => ds.map(d => d.id===dm.id ? {...d,is_read:1} : d)); }}>
                        Mark read
                      </button>
                    )}
                    <button style={{fontSize:10, color:'var(--red)', background:'none', border:'none', cursor:'pointer', marginLeft:'auto'}}
                      onClick={() => { deleteDM(dm.id); setForwardedDMs(ds => ds.filter(d => d.id !== dm.id)); }}>
                      Delete
                    </button>
                  </div>
                  {pingTask?.key === `dm-${dm.id}` && (
                    <div style={{marginTop:8, padding:'10px 12px', borderRadius:8, background:'var(--bg-3)', border:'1px solid var(--border)'}}>
                      <div style={{fontSize:10, fontWeight:700, color:'var(--fg-4)', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.08em'}}>Create Task From DM</div>
                      <textarea rows={3} style={{width:'100%', background:'var(--bg-2)', border:'1px solid var(--border)', borderRadius:6, padding:'8px 10px', fontSize:12, color:'var(--fg-1)', fontFamily:'inherit', resize:'vertical', marginBottom:6}}
                        value={pingTaskDesc} onChange={e => setPingTaskDesc(e.target.value)} />
                      <select style={{width:'100%', background:'var(--bg-2)', border:'1px solid var(--border)', borderRadius:6, padding:'7px 10px', fontSize:12, color:'var(--fg-1)', marginBottom:8}}
                        value={pingTaskTarget} onChange={e => setPingTaskTarget(e.target.value)}>
                        <option value=''>— Select target —</option>
                        {roleTargets.leadershipId && <option value={`Role:${roleTargets.leadershipId}`}>FM Leadership</option>}
                        {roleTargets.leadId       && <option value={`Role:${roleTargets.leadId}`}>FM Team Leads</option>}
                        {roleTargets.allFmId      && <option value={`Role:${roleTargets.allFmId}`}>All FM</option>}
                        {(roleTargets.teams||[]).map(t => <option key={t.id} value={`Role:${t.id}`}>{t.name}</option>)}
                        {staffList.map(s => <option key={s.id} value={`User:${s.id}`}>{s.name}</option>)}
                      </select>
                      <div style={{display:'flex', gap:6}}>
                        <button style={{flex:1, padding:'6px', borderRadius:6, background:'var(--accent)', border:'none', color:'#fff', fontSize:12, fontWeight:700, cursor:'pointer'}}
                          disabled={pingTaskBusy || !pingTaskTarget} onClick={submitPingTask}>
                          {pingTaskBusy ? 'Creating…' : 'Create Task'}
                        </button>
                        <button style={{padding:'6px 12px', borderRadius:6, background:'none', border:'1px solid var(--border)', color:'var(--fg-3)', fontSize:12, cursor:'pointer'}}
                          onClick={closePingTask}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

      {/* ── Personal Mentions Panel (all FM staff) ── */}
      <div style={{borderRadius:10, border:'1px solid var(--border)', background:'var(--bg-2)', overflow:'hidden'}}>
          <div
            onClick={() => setMentionsOpen(o => !o)}
            style={{display:'flex', alignItems:'center', gap:10, padding:'10px 14px', cursor:'pointer', userSelect:'none',
              background: mentionsOpen ? 'var(--bg-3)' : 'transparent', transition:'background 0.12s'}}
          >
            <span style={{fontSize:16}}>🔔</span>
            <span style={{fontSize:12, fontWeight:700, color:'var(--fg-1)'}}>Discord Mentions</span>
            {unreadCount > 0 && (
              <span style={{fontSize:10, fontWeight:800, padding:'1px 7px', borderRadius:999,
                background:'rgba(239,68,68,0.18)', color:'var(--red, #ef4444)', border:'1px solid rgba(239,68,68,0.35)'}}>
                {unreadCount} new
              </span>
            )}
            <span style={{marginLeft:'auto', fontSize:12, color:'var(--fg-4)'}}>{mentionsOpen ? '▲' : '▼'}</span>
            {mentionsOpen && unreadCount > 0 && (
              <button
                onClick={e => { e.stopPropagation(); dismissAll(); }}
                style={{fontSize:10, fontWeight:700, padding:'3px 10px', borderRadius:5, border:'1px solid var(--border)',
                  background:'transparent', color:'var(--fg-3)', cursor:'pointer'}}>
                Mark all read
              </button>
            )}
          </div>

          {mentionsOpen && (
            <div style={{borderTop:'1px solid var(--border)', maxHeight:420, overflowY:'auto'}}>
              {mentions.length === 0 ? (
                <div style={{padding:'24px', textAlign:'center', color:'var(--fg-4)', fontStyle:'italic', fontSize:13}}>No mentions yet.</div>
              ) : [...mentions].sort((a,b) => a.is_read !== b.is_read ? a.is_read - b.is_read : b.created_at.localeCompare(a.created_at)).map(m => {
                const discordLink = `https://discord.com/channels/${m.guild_id}/${m.channel_id}/${m.message_id}`;
                const appLink     = `discord://-/channels/${m.guild_id}/${m.channel_id}/${m.message_id}`;
                const ts = m.created_at ? new Date(m.created_at).toLocaleString() : '';
                const snippet = (m.content || '').replace(/<@!?[0-9]+>/g, '@…');
                return (
                  <React.Fragment key={m.id}>
                  <div style={{
                    display:'flex', alignItems:'flex-start', gap:10, padding:'10px 14px',
                    borderBottom: replyingTo === m.id ? 'none' : '1px solid var(--border)',
                    background: m.is_read ? 'transparent' : 'rgba(99,102,241,0.05)',
                    opacity: m.is_read ? 0.6 : 1,
                  }}>
                    {!m.is_read && (
                      <span style={{width:6, height:6, borderRadius:'50%', background:'var(--accent, #6366f1)',
                        flexShrink:0, marginTop:6}} />
                    )}
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:3, flexWrap:'wrap'}}>
                        <span style={{fontSize:13, fontWeight:700, color:'#ffffff'}}>{m.author_name}</span>
                        <span style={{fontSize:10, color:'rgba(255,255,255,0.45)', marginLeft:'auto'}}>{ts}</span>
                      </div>
                      <div style={{display:'flex', alignItems:'center', gap:5, marginBottom:5, flexWrap:'wrap'}}>
                        {(m.channel_name || m.channel_id) && (
                          <span style={{fontSize:11, fontWeight:500, color:'rgba(255,255,255,0.7)', fontFamily:'var(--font-mono)'}}>
                            #{m.channel_name || m.channel_id}
                          </span>
                        )}
                        {m.guild_name && (
                          <>
                            <span style={{fontSize:9, color:'rgba(255,255,255,0.25)'}}>·</span>
                            <span style={{fontSize:11, fontWeight:600, padding:'1px 7px', borderRadius:3,
                              background:'rgba(125,211,252,0.15)', color:'#7dd3fc', border:'1px solid rgba(125,211,252,0.3)'}}>
                              {m.guild_name}
                            </span>
                          </>
                        )}
                      </div>
                      <div style={{fontSize:13, color:'rgba(255,255,255,0.88)', lineHeight:1.5, wordBreak:'break-word'}}>{snippet}</div>
                    </div>
                    <div style={{display:'flex', gap:5, flexShrink:0, flexDirection:'column', alignItems:'flex-end'}}>
                      <a href={appLink} target="_blank" rel="noreferrer"
                        style={{fontSize:10, fontWeight:700, padding:'4px 9px', borderRadius:5, textDecoration:'none',
                          background:'rgba(88,101,242,0.15)', color:'#818cf8', border:'1px solid rgba(88,101,242,0.3)'}}>
                        Open App
                      </a>
                      <a href={discordLink} target="_blank" rel="noreferrer"
                        style={{fontSize:10, fontWeight:700, padding:'4px 9px', borderRadius:5, textDecoration:'none',
                          background:'var(--bg-3)', color:'var(--fg-3)', border:'1px solid var(--border)'}}>
                        Web
                      </a>
                      <button
                        onClick={() => { setReplyingTo(replyingTo === m.id ? null : m.id); setReplyText(''); setReplyError(''); }}
                        style={{fontSize:10, fontWeight:700, padding:'4px 9px', borderRadius:5, border:'1px solid var(--border)',
                          background: replyingTo === m.id ? 'var(--accent-bg, rgba(99,102,241,0.15))' : 'transparent',
                          color: replyingTo === m.id ? 'var(--accent, #6366f1)' : 'var(--fg-3)', cursor:'pointer'}}>
                        ↩ Reply
                      </button>
                      <button onClick={() => openPingTask('mention', m.id, (m.content||'').replace(/<@!?&?[0-9]+>/g,'@…').substring(0,200))}
                        style={{fontSize:9, padding:'3px 7px', borderRadius:4, border:'1px solid rgba(99,102,241,0.3)',
                          background:'rgba(99,102,241,0.1)', color:'#818cf8', cursor:'pointer'}}>
                        📋 Task
                      </button>
                      {!m.is_read && (
                        <button onClick={() => dismissMention(m.id)}
                          style={{fontSize:9, padding:'3px 7px', borderRadius:4, border:'1px solid var(--border)',
                            background:'transparent', color:'var(--fg-4)', cursor:'pointer'}}>
                          ✓
                        </button>
                      )}
                    </div>
                  </div>
                  {pingTask?.key === `mention-${m.id}` && (
                    <div style={{padding:'8px 14px 12px', borderTop:'1px solid var(--border)', background:'var(--bg-3)'}}>
                      <div style={{fontSize:11, fontWeight:700, color:'var(--fg-1)', marginBottom:6}}>📋 Create Task from Ping</div>
                      <textarea value={pingTaskDesc} onChange={e=>setPingTaskDesc(e.target.value)} rows={2}
                        style={{width:'100%',resize:'vertical',padding:'6px 9px',borderRadius:5,border:'1px solid var(--border)',
                          background:'var(--bg-2)',color:'var(--fg-0)',fontSize:12,lineHeight:1.4,outline:'none',boxSizing:'border-box',fontFamily:'inherit',marginBottom:6}}/>
                      <select value={pingTaskTarget} onChange={e=>setPingTaskTarget(e.target.value)}
                        style={{width:'100%',padding:'6px 9px',borderRadius:5,border:'1px solid var(--border)',background:'var(--bg-2)',color:'var(--fg-0)',fontSize:12,marginBottom:6}}>
                        <option value=''>Assign to…</option>
                        <optgroup label='Roles &amp; Teams'>
                          {roleTargets.leadershipId&&<option value={`Role:${roleTargets.leadershipId}`}>FM Leadership</option>}
                          {roleTargets.leadId&&<option value={`Role:${roleTargets.leadId}`}>FM Team Leads</option>}
                          {roleTargets.allFmId&&<option value={`Role:${roleTargets.allFmId}`}>All FM</option>}
                          {roleTargets.teams?.map(t=><option key={t.team_id} value={`Role:${t.team_id}`}>{t.team_name}</option>)}
                        </optgroup>
                        <optgroup label='Individual Staff'>
                          {staffList.map(s=><option key={s.discord_id} value={`User:${s.discord_id}`}>{s.display_name}</option>)}
                        </optgroup>
                      </select>
                      <div style={{display:'flex',gap:6,alignItems:'center'}}>
                        <button onClick={submitPingTask} disabled={pingTaskBusy||!pingTaskTarget||!pingTaskDesc.trim()}
                          style={{fontSize:11,fontWeight:700,padding:'5px 14px',borderRadius:5,cursor:'pointer',
                            background:'rgba(99,102,241,0.85)',color:'#fff',border:'none',
                            opacity:(pingTaskBusy||!pingTaskTarget||!pingTaskDesc.trim())?0.5:1}}>
                          {pingTaskBusy?'Creating…':'Create Task'}
                        </button>
                        <button onClick={closePingTask}
                          style={{fontSize:11,padding:'5px 10px',borderRadius:5,cursor:'pointer',border:'1px solid var(--border)',background:'transparent',color:'var(--fg-3)'}}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  {replyingTo === m.id && (
                    <div style={{padding:'8px 14px 12px 14px', borderTop:'1px solid var(--border)', background:'var(--bg-3)'}}>
                      <textarea
                        autoFocus
                        placeholder={`Reply to ${m.author_name} in #${m.channel_name || m.channel_id}…`}
                        value={replyText}
                        onChange={e => setReplyText(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendReply(); if (e.key === 'Escape') { setReplyingTo(null); setReplyText(''); } }}
                        rows={3}
                        style={{
                          width:'100%', resize:'vertical', padding:'8px 10px', borderRadius:6,
                          border:'1px solid var(--border)', background:'var(--bg-2)', color:'var(--fg-1)',
                          fontSize:12, lineHeight:1.5, outline:'none', boxSizing:'border-box', fontFamily:'inherit',
                        }}
                      />
                      {replyError && <div style={{fontSize:11, color:'var(--red, #ef4444)', marginTop:4}}>{replyError}</div>}
                      <div style={{display:'flex', gap:6, marginTop:6, alignItems:'center'}}>
                        <button onClick={sendReply} disabled={replySending || !replyText.trim()}
                          style={{fontSize:11, fontWeight:700, padding:'5px 14px', borderRadius:5, cursor:'pointer',
                            background:'rgba(99,102,241,0.85)', color:'#fff', border:'none',
                            opacity: (replySending || !replyText.trim()) ? 0.5 : 1}}>
                          {replySending ? 'Sending…' : 'Send Reply'}
                        </button>
                        <span style={{fontSize:10, color:'var(--fg-4)'}}>⌘↵ to send · Esc to cancel</span>
                        <span style={{fontSize:10, color:'var(--fg-4)', marginLeft:'auto'}}>Sends as bot, attributed to you</span>
                      </div>
                    </div>
                  )}
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </div>

      {/* ── FM Leadership Role Mentions Panel (L3 only) ── */}
      {IS_FM_LEADERSHIP && (
        <div style={{borderRadius:10, border:'1px solid rgba(245,158,11,0.3)', background:'var(--bg-2)', overflow:'hidden'}}>
          <div
            onClick={() => setLeadershipMentionsOpen(o => !o)}
            style={{display:'flex', alignItems:'center', gap:10, padding:'10px 14px', cursor:'pointer', userSelect:'none',
              background: leadershipMentionsOpen ? 'rgba(245,158,11,0.06)' : 'transparent', transition:'background 0.12s'}}
          >
            <span style={{fontSize:16}}>👑</span>
            <span style={{fontSize:12, fontWeight:700, color:'var(--fg-1)'}}>FM Leadership Pings</span>
            <span style={{fontSize:9, fontWeight:700, padding:'1px 6px', borderRadius:4,
              background:'rgba(245,158,11,0.15)', color:'#f59e0b', border:'1px solid rgba(245,158,11,0.3)',
              letterSpacing:'0.06em', textTransform:'uppercase', fontFamily:'var(--font-mono)'}}>
              @&amp;Role
            </span>
            {leadershipUnreadCount > 0 && (
              <span style={{fontSize:10, fontWeight:800, padding:'1px 7px', borderRadius:999,
                background:'rgba(245,158,11,0.18)', color:'#f59e0b', border:'1px solid rgba(245,158,11,0.4)'}}>
                {leadershipUnreadCount} new
              </span>
            )}
            <span style={{marginLeft:'auto', fontSize:12, color:'var(--fg-4)'}}>{leadershipMentionsOpen ? '▲' : '▼'}</span>
            {leadershipMentionsOpen && leadershipUnreadCount > 0 && (
              <button
                onClick={e => { e.stopPropagation(); dismissAllLeadership(); }}
                style={{fontSize:10, fontWeight:700, padding:'3px 10px', borderRadius:5, border:'1px solid rgba(245,158,11,0.3)',
                  background:'transparent', color:'#f59e0b', cursor:'pointer'}}>
                Mark all read
              </button>
            )}
          </div>

          {leadershipMentionsOpen && (
            <div style={{borderTop:'1px solid rgba(245,158,11,0.2)', maxHeight:420, overflowY:'auto'}}>
              {leadershipMentions.length === 0 ? (
                <div style={{padding:'24px', textAlign:'center', color:'var(--fg-4)', fontStyle:'italic', fontSize:13}}>No FM Leadership pings yet.</div>
              ) : [...leadershipMentions].sort((a,b) => a.is_read !== b.is_read ? a.is_read - b.is_read : b.created_at.localeCompare(a.created_at)).map(m => {
                const discordLink = `https://discord.com/channels/${m.guild_id}/${m.channel_id}/${m.message_id}`;
                const appLink     = `discord://-/channels/${m.guild_id}/${m.channel_id}/${m.message_id}`;
                const ts = m.created_at ? new Date(m.created_at).toLocaleString() : '';
                const snippet = (m.content || '').replace(/<@&?!?[0-9]+>/g, '@…');
                return (
                  <React.Fragment key={m.id}>
                  <div style={{
                    display:'flex', alignItems:'flex-start', gap:10, padding:'10px 14px',
                    borderBottom: leadershipReplyingTo === m.id ? 'none' : '1px solid rgba(245,158,11,0.1)',
                    background: m.is_read ? 'transparent' : 'rgba(245,158,11,0.04)',
                    opacity: m.is_read ? 0.6 : 1,
                  }}>
                    {!m.is_read && (
                      <span style={{width:6, height:6, borderRadius:'50%', background:'#f59e0b',
                        flexShrink:0, marginTop:6}} />
                    )}
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:3, flexWrap:'wrap'}}>
                        <span style={{fontSize:13, fontWeight:700, color:'#ffffff'}}>{m.author_name}</span>
                        <span style={{fontSize:10, color:'rgba(255,255,255,0.45)', marginLeft:'auto'}}>{ts}</span>
                      </div>
                      <div style={{display:'flex', alignItems:'center', gap:5, marginBottom:5, flexWrap:'wrap'}}>
                        {(m.channel_name || m.channel_id) && (
                          <span style={{fontSize:11, fontWeight:500, color:'rgba(255,255,255,0.7)', fontFamily:'var(--font-mono)'}}>
                            #{m.channel_name || m.channel_id}
                          </span>
                        )}
                        {m.guild_name && (
                          <>
                            <span style={{fontSize:9, color:'rgba(255,255,255,0.25)'}}>·</span>
                            <span style={{fontSize:11, fontWeight:600, padding:'1px 7px', borderRadius:3,
                              background:'rgba(125,211,252,0.15)', color:'#7dd3fc', border:'1px solid rgba(125,211,252,0.3)'}}>
                              {m.guild_name}
                            </span>
                          </>
                        )}
                      </div>
                      <div style={{fontSize:13, color:'rgba(255,255,255,0.88)', lineHeight:1.5, wordBreak:'break-word'}}>{snippet}</div>
                    </div>
                    <div style={{display:'flex', gap:5, flexShrink:0, flexDirection:'column', alignItems:'flex-end'}}>
                      <a href={appLink} target="_blank" rel="noreferrer"
                        style={{fontSize:10, fontWeight:700, padding:'4px 9px', borderRadius:5, textDecoration:'none',
                          background:'rgba(245,158,11,0.15)', color:'#f59e0b', border:'1px solid rgba(245,158,11,0.35)'}}>
                        Open App
                      </a>
                      <a href={discordLink} target="_blank" rel="noreferrer"
                        style={{fontSize:10, fontWeight:700, padding:'4px 9px', borderRadius:5, textDecoration:'none',
                          background:'var(--bg-3)', color:'var(--fg-3)', border:'1px solid var(--border)'}}>
                        Web
                      </a>
                      <button
                        onClick={() => { setLeadershipReplyingTo(leadershipReplyingTo === m.id ? null : m.id); setLeadershipReplyText(''); setLeadershipReplyError(''); }}
                        style={{fontSize:10, fontWeight:700, padding:'4px 9px', borderRadius:5, border:'1px solid rgba(245,158,11,0.3)',
                          background: leadershipReplyingTo === m.id ? 'rgba(245,158,11,0.15)' : 'transparent',
                          color: leadershipReplyingTo === m.id ? '#f59e0b' : 'var(--fg-3)', cursor:'pointer'}}>
                        ↩ Reply
                      </button>
                      <button onClick={() => openPingTask('leadership', m.id, (m.content||'').replace(/<@!?&?[0-9]+>/g,'@…').substring(0,200))}
                        style={{fontSize:9, padding:'3px 7px', borderRadius:4, border:'1px solid rgba(99,102,241,0.3)',
                          background:'rgba(99,102,241,0.1)', color:'#818cf8', cursor:'pointer'}}>
                        📋 Task
                      </button>
                      {!m.is_read && (
                        <button onClick={() => dismissLeadershipMention(m.id)}
                          style={{fontSize:9, padding:'3px 7px', borderRadius:4, border:'1px solid rgba(245,158,11,0.25)',
                            background:'transparent', color:'var(--fg-4)', cursor:'pointer'}}>
                          ✓
                        </button>
                      )}
                    </div>
                  </div>
                  {pingTask?.key === `leadership-${m.id}` && (
                    <div style={{padding:'8px 14px 12px', borderTop:'1px solid rgba(245,158,11,0.2)', background:'var(--bg-3)'}}>
                      <div style={{fontSize:11, fontWeight:700, color:'var(--fg-1)', marginBottom:6}}>📋 Create Task from Ping</div>
                      <textarea value={pingTaskDesc} onChange={e=>setPingTaskDesc(e.target.value)} rows={2}
                        style={{width:'100%',resize:'vertical',padding:'6px 9px',borderRadius:5,border:'1px solid rgba(245,158,11,0.3)',
                          background:'var(--bg-2)',color:'var(--fg-0)',fontSize:12,lineHeight:1.4,outline:'none',boxSizing:'border-box',fontFamily:'inherit',marginBottom:6}}/>
                      <select value={pingTaskTarget} onChange={e=>setPingTaskTarget(e.target.value)}
                        style={{width:'100%',padding:'6px 9px',borderRadius:5,border:'1px solid var(--border)',background:'var(--bg-2)',color:'var(--fg-0)',fontSize:12,marginBottom:6}}>
                        <option value=''>Assign to…</option>
                        <optgroup label='Roles &amp; Teams'>
                          {roleTargets.leadershipId&&<option value={`Role:${roleTargets.leadershipId}`}>FM Leadership</option>}
                          {roleTargets.leadId&&<option value={`Role:${roleTargets.leadId}`}>FM Team Leads</option>}
                          {roleTargets.allFmId&&<option value={`Role:${roleTargets.allFmId}`}>All FM</option>}
                          {roleTargets.teams?.map(t=><option key={t.team_id} value={`Role:${t.team_id}`}>{t.team_name}</option>)}
                        </optgroup>
                        <optgroup label='Individual Staff'>
                          {staffList.map(s=><option key={s.discord_id} value={`User:${s.discord_id}`}>{s.display_name}</option>)}
                        </optgroup>
                      </select>
                      <div style={{display:'flex',gap:6,alignItems:'center'}}>
                        <button onClick={submitPingTask} disabled={pingTaskBusy||!pingTaskTarget||!pingTaskDesc.trim()}
                          style={{fontSize:11,fontWeight:700,padding:'5px 14px',borderRadius:5,cursor:'pointer',
                            background:'rgba(99,102,241,0.85)',color:'#fff',border:'none',
                            opacity:(pingTaskBusy||!pingTaskTarget||!pingTaskDesc.trim())?0.5:1}}>
                          {pingTaskBusy?'Creating…':'Create Task'}
                        </button>
                        <button onClick={closePingTask}
                          style={{fontSize:11,padding:'5px 10px',borderRadius:5,cursor:'pointer',border:'1px solid var(--border)',background:'transparent',color:'var(--fg-3)'}}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  {leadershipReplyingTo === m.id && (
                    <div style={{padding:'8px 14px 12px 14px', borderTop:'1px solid rgba(245,158,11,0.2)', background:'var(--bg-3)'}}>
                      <textarea
                        autoFocus
                        placeholder={`Reply to ${m.author_name} in #${m.channel_name || m.channel_id}…`}
                        value={leadershipReplyText}
                        onChange={e => setLeadershipReplyText(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendLeadershipReply(); if (e.key === 'Escape') { setLeadershipReplyingTo(null); setLeadershipReplyText(''); } }}
                        rows={3}
                        style={{
                          width:'100%', resize:'vertical', padding:'8px 10px', borderRadius:6,
                          border:'1px solid rgba(245,158,11,0.3)', background:'var(--bg-2)', color:'var(--fg-1)',
                          fontSize:12, lineHeight:1.5, outline:'none', boxSizing:'border-box', fontFamily:'inherit',
                        }}
                      />
                      {leadershipReplyError && <div style={{fontSize:11, color:'var(--red, #ef4444)', marginTop:4}}>{leadershipReplyError}</div>}
                      <div style={{display:'flex', gap:6, marginTop:6, alignItems:'center'}}>
                        <button onClick={sendLeadershipReply} disabled={leadershipReplySending || !leadershipReplyText.trim()}
                          style={{fontSize:11, fontWeight:700, padding:'5px 14px', borderRadius:5, cursor:'pointer',
                            background:'rgba(245,158,11,0.85)', color:'#000', border:'none',
                            opacity: (leadershipReplySending || !leadershipReplyText.trim()) ? 0.5 : 1}}>
                          {leadershipReplySending ? 'Sending…' : 'Send Reply'}
                        </button>
                        <span style={{fontSize:10, color:'var(--fg-4)'}}>⌘↵ to send · Esc to cancel</span>
                        <span style={{fontSize:10, color:'var(--fg-4)', marginLeft:'auto'}}>Sends as bot, attributed to you</span>
                      </div>
                    </div>
                  )}
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Watch Role Pings Panel (FM staff only — hidden for Event Team) ── */}
      {!auth.isEventTeam && <div style={{borderRadius:10, border:'1px solid rgba(52,211,153,0.25)', background:'var(--bg-2)', overflow:'hidden'}}>
        <div
          onClick={() => setWatchPingsOpen(o => !o)}
          style={{display:'flex', alignItems:'center', gap:10, padding:'10px 14px', cursor:'pointer', userSelect:'none',
            background: watchPingsOpen ? 'rgba(52,211,153,0.05)' : 'transparent', transition:'background 0.12s'}}
        >
          <span style={{fontSize:16}}>📡</span>
          <span style={{fontSize:12, fontWeight:700, color:'var(--fg-0)'}}>
            {auth.level >= 3 ? 'All Server Pings' : 'Team Discord Pings'}
          </span>
          <span style={{fontSize:9, fontWeight:700, padding:'1px 6px', borderRadius:4,
            background:'rgba(52,211,153,0.15)', color:'#34d399', border:'1px solid rgba(52,211,153,0.3)',
            letterSpacing:'0.06em', textTransform:'uppercase', fontFamily:'var(--font-mono)'}}>
            @&amp;Role
          </span>
          {watchUnreadCount > 0 && (
            <span style={{fontSize:10, fontWeight:800, padding:'1px 7px', borderRadius:999,
              background:'rgba(239,68,68,0.18)', color:'#ef4444', border:'1px solid rgba(239,68,68,0.35)'}}>
              {watchUnreadCount} new
            </span>
          )}
          <span style={{marginLeft:'auto', fontSize:12, color:'var(--fg-3)'}}>{watchPingsOpen ? '▲' : '▼'}</span>
          {watchPingsOpen && watchUnreadCount > 0 && (
            <button onClick={e => { e.stopPropagation(); dismissAllWatchPings(); }}
              style={{fontSize:10, fontWeight:700, padding:'3px 10px', borderRadius:5,
                border:'1px solid rgba(52,211,153,0.3)', background:'transparent', color:'#34d399', cursor:'pointer'}}>
              Mark all read
            </button>
          )}
        </div>
        {watchPingsOpen && (
          <div style={{borderTop:'1px solid rgba(52,211,153,0.15)', maxHeight:420, overflowY:'auto'}}>
            {watchPings.length === 0 ? (
              <div style={{padding:'24px', textAlign:'center', color:'var(--fg-3)', fontStyle:'italic', fontSize:13}}>No role pings yet.</div>
            ) : watchPings.map(p => {
              const discordLink = `https://discord.com/channels/${p.guild_id}/${p.channel_id}/${p.message_id}`;
              const appLink     = `discord://-/channels/${p.guild_id}/${p.channel_id}/${p.message_id}`;
              const ts = p.created_at ? new Date(p.created_at).toLocaleString() : '';
              const snippet = (p.content || '').replace(/<@&?!?[0-9]+>/g, '@…');
              const isReplying = watchReplyingTo === p.id;
              return (
                <React.Fragment key={p.id}>
                <div style={{
                  display:'flex', alignItems:'flex-start', gap:10, padding:'10px 14px',
                  borderBottom: isReplying ? 'none' : '1px solid rgba(52,211,153,0.08)',
                  background: p.is_read ? 'transparent' : 'rgba(52,211,153,0.03)',
                  opacity: p.is_read ? 0.6 : 1,
                }}>
                  {!p.is_read && <span style={{width:6, height:6, borderRadius:'50%', background:'#34d399', flexShrink:0, marginTop:6}} />}
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:3, flexWrap:'wrap'}}>
                      <span style={{fontSize:13, fontWeight:700, color:'#ffffff'}}>{p.author_name}</span>
                      <span style={{fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:3,
                        background:'rgba(52,211,153,0.15)', color:'#34d399', border:'1px solid rgba(52,211,153,0.3)'}}>
                        @{p.watch_role_name}
                      </span>
                      <span style={{fontSize:10, color:'rgba(255,255,255,0.45)', marginLeft:'auto'}}>{ts}</span>
                    </div>
                    <div style={{display:'flex', alignItems:'center', gap:5, marginBottom:5, flexWrap:'wrap'}}>
                      {p.channel_name && (
                        <span style={{fontSize:11, fontWeight:500, color:'rgba(255,255,255,0.7)', fontFamily:'var(--font-mono)'}}>
                          #{p.channel_name}
                        </span>
                      )}
                      {(p.server_name || p.guild_name) && (
                        <>
                          {p.channel_name && <span style={{fontSize:9, color:'rgba(255,255,255,0.25)'}}>·</span>}
                          <span style={{fontSize:11, fontWeight:600, padding:'1px 7px', borderRadius:3,
                            background:'rgba(125,211,252,0.15)', color:'#7dd3fc', border:'1px solid rgba(125,211,252,0.3)'}}>
                            {p.server_name || p.guild_name}
                          </span>
                        </>
                      )}
                      {p.faction_name && p.faction_name !== (p.server_name || p.guild_name) && (
                        <>
                          <span style={{fontSize:9, color:'rgba(255,255,255,0.25)'}}>·</span>
                          <span style={{fontSize:11, fontWeight:600, padding:'1px 7px', borderRadius:3,
                            background:'rgba(167,139,250,0.15)', color:'#a78bfa', border:'1px solid rgba(167,139,250,0.3)'}}>
                            {p.faction_name}
                          </span>
                        </>
                      )}
                    </div>
                    <div style={{fontSize:13, color:'rgba(255,255,255,0.88)', lineHeight:1.5, wordBreak:'break-word'}}>{snippet}</div>
                  </div>
                  <div style={{display:'flex', gap:5, flexShrink:0, flexDirection:'column', alignItems:'flex-end'}}>
                    <a href={appLink} target="_blank" rel="noreferrer"
                      style={{fontSize:10, fontWeight:700, padding:'4px 9px', borderRadius:5, textDecoration:'none',
                        background:'rgba(52,211,153,0.15)', color:'#34d399', border:'1px solid rgba(52,211,153,0.3)'}}>
                      Open App
                    </a>
                    <a href={discordLink} target="_blank" rel="noreferrer"
                      style={{fontSize:10, fontWeight:700, padding:'4px 9px', borderRadius:5, textDecoration:'none',
                        background:'var(--bg-3)', color:'var(--fg-2)', border:'1px solid var(--border)'}}>
                      Web
                    </a>
                    <button onClick={() => { setWatchReplyingTo(isReplying ? null : p.id); setWatchReplyText(''); setWatchReplyError(''); }}
                      style={{fontSize:10, fontWeight:700, padding:'4px 9px', borderRadius:5,
                        border:'1px solid rgba(52,211,153,0.3)',
                        background: isReplying ? 'rgba(52,211,153,0.15)' : 'transparent',
                        color: isReplying ? '#34d399' : 'var(--fg-3)', cursor:'pointer'}}>
                      ↩ Reply
                    </button>
                    <button onClick={() => openPingTask('watch', p.id, (p.content||'').replace(/<@!?&?[0-9]+>/g,'@…').substring(0,200))}
                      style={{fontSize:9, padding:'3px 7px', borderRadius:4, border:'1px solid rgba(99,102,241,0.3)',
                        background:'rgba(99,102,241,0.1)', color:'#818cf8', cursor:'pointer'}}>
                      📋 Task
                    </button>
                    {!p.is_read && (
                      <button onClick={() => dismissWatchPing(p.id)}
                        style={{fontSize:9, padding:'3px 7px', borderRadius:4, border:'1px solid rgba(52,211,153,0.2)',
                          background:'transparent', color:'var(--fg-3)', cursor:'pointer'}}>✓</button>
                    )}
                  </div>
                </div>
                {pingTask?.key === `watch-${p.id}` && (
                  <div style={{padding:'8px 14px 12px', borderTop:'1px solid rgba(52,211,153,0.15)', background:'var(--bg-3)'}}>
                    <div style={{fontSize:11, fontWeight:700, color:'var(--fg-1)', marginBottom:6}}>📋 Create Task from Ping</div>
                    <textarea value={pingTaskDesc} onChange={e=>setPingTaskDesc(e.target.value)} rows={2}
                      style={{width:'100%',resize:'vertical',padding:'6px 9px',borderRadius:5,border:'1px solid rgba(52,211,153,0.3)',
                        background:'var(--bg-2)',color:'var(--fg-0)',fontSize:12,lineHeight:1.4,outline:'none',boxSizing:'border-box',fontFamily:'inherit',marginBottom:6}}/>
                    <select value={pingTaskTarget} onChange={e=>setPingTaskTarget(e.target.value)}
                      style={{width:'100%',padding:'6px 9px',borderRadius:5,border:'1px solid var(--border)',background:'var(--bg-2)',color:'var(--fg-0)',fontSize:12,marginBottom:6}}>
                      <option value=''>Assign to…</option>
                      <optgroup label='Roles &amp; Teams'>
                        {roleTargets.leadershipId&&<option value={`Role:${roleTargets.leadershipId}`}>FM Leadership</option>}
                        {roleTargets.leadId&&<option value={`Role:${roleTargets.leadId}`}>FM Team Leads</option>}
                        {roleTargets.allFmId&&<option value={`Role:${roleTargets.allFmId}`}>All FM</option>}
                        {roleTargets.teams?.map(t=><option key={t.team_id} value={`Role:${t.team_id}`}>{t.team_name}</option>)}
                      </optgroup>
                      <optgroup label='Individual Staff'>
                        {staffList.map(s=><option key={s.discord_id} value={`User:${s.discord_id}`}>{s.display_name}</option>)}
                      </optgroup>
                    </select>
                    <div style={{display:'flex',gap:6,alignItems:'center'}}>
                      <button onClick={submitPingTask} disabled={pingTaskBusy||!pingTaskTarget||!pingTaskDesc.trim()}
                        style={{fontSize:11,fontWeight:700,padding:'5px 14px',borderRadius:5,cursor:'pointer',
                          background:'rgba(99,102,241,0.85)',color:'#fff',border:'none',
                          opacity:(pingTaskBusy||!pingTaskTarget||!pingTaskDesc.trim())?0.5:1}}>
                        {pingTaskBusy?'Creating…':'Create Task'}
                      </button>
                      <button onClick={closePingTask}
                        style={{fontSize:11,padding:'5px 10px',borderRadius:5,cursor:'pointer',border:'1px solid var(--border)',background:'transparent',color:'var(--fg-3)'}}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {isReplying && (
                  <div style={{padding:'8px 14px 12px 14px', borderTop:'1px solid rgba(52,211,153,0.15)', background:'var(--bg-3)'}}>
                    <textarea autoFocus
                      placeholder={`Reply to ${p.author_name} in #${p.channel_name || p.channel_id}…`}
                      value={watchReplyText} onChange={e => setWatchReplyText(e.target.value)}
                      onKeyDown={e => { if (e.key==='Enter'&&(e.metaKey||e.ctrlKey)) sendWatchReply(); if(e.key==='Escape'){setWatchReplyingTo(null);setWatchReplyText('');} }}
                      rows={3} style={{width:'100%', resize:'vertical', padding:'8px 10px', borderRadius:6,
                        border:'1px solid rgba(52,211,153,0.3)', background:'var(--bg-2)', color:'#ffffff',
                        fontSize:12, lineHeight:1.5, outline:'none', boxSizing:'border-box', fontFamily:'inherit'}}
                    />
                    {watchReplyError && <div style={{fontSize:11, color:'var(--red)', marginTop:4}}>{watchReplyError}</div>}
                    <div style={{display:'flex', gap:6, marginTop:6, alignItems:'center'}}>
                      <button onClick={sendWatchReply} disabled={watchReplySending || !watchReplyText.trim()}
                        style={{fontSize:11, fontWeight:700, padding:'5px 14px', borderRadius:5, cursor:'pointer',
                          background:'rgba(52,211,153,0.85)', color:'#000', border:'none',
                          opacity:(watchReplySending||!watchReplyText.trim())?0.5:1}}>
                        {watchReplySending ? 'Sending…' : 'Send Reply'}
                      </button>
                      <span style={{fontSize:10, color:'var(--fg-3)'}}>⌘↵ to send · Esc to cancel</span>
                      <span style={{fontSize:10, color:'var(--fg-3)', marginLeft:'auto'}}>Sends as bot, attributed to you</span>
                    </div>
                  </div>
                )}
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>}

      {/* ── My RP Requests Panel (L2+ / Lead Storyteller) ── */}
      {(auth.level >= 2 || auth.isLeadStoryteller) && myRPRequests.length > 0 && (
        <div style={{borderRadius:10, border:'1px solid rgba(251,191,36,0.3)', background:'var(--bg-2)', overflow:'hidden'}}>
          <div
            onClick={() => setRpRequestsOpen(o => !o)}
            style={{display:'flex', alignItems:'center', gap:10, padding:'10px 14px', cursor:'pointer', userSelect:'none',
              background: rpRequestsOpen ? 'rgba(251,191,36,0.06)' : 'transparent', transition:'background 0.12s'}}
          >
            <span style={{fontSize:16}}>📋</span>
            <span style={{fontSize:12, fontWeight:700, color:'var(--fg-1)'}}>My RP Requests</span>
            <span style={{fontSize:9, fontWeight:700, color:'var(--fg-4)', fontFamily:'var(--font-mono)'}}>{myRPRequests.length} active</span>
            {rpActionCount > 0 && (
              <span style={{fontSize:10, fontWeight:800, padding:'1px 7px', borderRadius:999,
                background:'rgba(251,191,36,0.18)', color:'#f59e0b', border:'1px solid rgba(251,191,36,0.4)'}}>
                {rpActionCount} need action
              </span>
            )}
            <span style={{marginLeft:'auto', fontSize:12, color:'var(--fg-4)'}}>{rpRequestsOpen ? '▲' : '▼'}</span>
          </div>
          {rpRequestsOpen && (
            <div style={{borderTop:'1px solid rgba(251,191,36,0.2)'}}>
              {myRPRequests.map(r => {
                const isPending  = r.status === 'PENDING';
                const isApproved = r.status === 'APPROVED';
                const isDenied   = r.status === 'DENIED';
                const isRPDone   = r.status === 'RP_DONE';
                const statusColor = isApproved ? 'var(--green)' : isDenied ? 'var(--red)' : isRPDone ? 'var(--accent)' : 'var(--amber)';
                const statusLabel = isApproved ? 'APPROVED — Schedule RP' : isDenied ? 'DENIED — Action Required' : isRPDone ? 'RP DONE — Awaiting Execution' : 'PENDING APPROVAL';
                return (
                  <React.Fragment key={r.id}>
                    <div style={{padding:'12px 14px', borderBottom: (rpMarkingDone===r.id||rpResubmitting===r.id) ? 'none' : '1px solid rgba(251,191,36,0.1)',
                      background: isDenied ? 'rgba(248,113,113,0.04)' : isApproved ? 'rgba(74,222,128,0.04)' : 'transparent'}}>
                      <div style={{display:'flex', alignItems:'flex-start', gap:10}}>
                        <div style={{flex:1, minWidth:0}}>
                          <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:4, flexWrap:'wrap'}}>
                            <span style={{fontSize:11, fontWeight:700, color:'var(--fg-1)'}}>{r.faction_name}</span>
                            <span style={{fontSize:9, fontWeight:800, color:statusColor, fontFamily:'var(--font-mono)', letterSpacing:'0.06em'}}>{statusLabel}</span>
                          </div>
                          <div style={{fontSize:12, color:'var(--fg-2)', marginBottom:4}}>{r.execution_type}: <strong>{r.old_value}</strong> → <strong>{r.new_value}</strong></div>
                          {isDenied && r.deny_reason && (
                            <div style={{fontSize:11, color:'var(--red)', background:'rgba(248,113,113,0.08)', border:'1px solid rgba(248,113,113,0.2)', borderRadius:6, padding:'6px 10px', marginBottom:6}}>
                              <strong>Denial reason:</strong> {r.deny_reason}
                            </div>
                          )}
                          <div style={{fontSize:10, color:'var(--fg-4)', fontFamily:'var(--font-mono)'}}>Submitted {r.date}</div>
                        </div>
                        <div style={{display:'flex', flexDirection:'column', gap:5, flexShrink:0}}>
                          {isApproved && (
                            <button onClick={() => { setRpMarkingDone(r.id); setRpDoneNote(''); setRpResubmitting(null); }}
                              style={{fontSize:10, fontWeight:700, padding:'5px 10px', borderRadius:5, cursor:'pointer',
                                background:'rgba(74,222,128,0.15)', color:'var(--green)', border:'1px solid rgba(74,222,128,0.35)'}}>
                              Mark RP Done
                            </button>
                          )}
                          {isDenied && (
                            <button onClick={() => { setRpResubmitting(r.id); setRpResubmitNote(''); setRpMarkingDone(null); }}
                              style={{fontSize:10, fontWeight:700, padding:'5px 10px', borderRadius:5, cursor:'pointer',
                                background:'rgba(248,113,113,0.15)', color:'var(--red)', border:'1px solid rgba(248,113,113,0.3)'}}>
                              Respond &amp; Resubmit
                            </button>
                          )}
                          {auth.level >= 3 && (
                            <button onClick={async () => {
                                if (await showConfirm(`Delete this RP change request for ${r.faction_name}? This cannot be undone.`)) {
                                  await deleteRPChange(r.id);
                                  setMyRPRequests(rs => rs.filter(x => x.id !== r.id));
                                  refreshQueue();
                                }
                              }}
                              style={{fontSize:10, fontWeight:700, padding:'5px 10px', borderRadius:5, cursor:'pointer',
                                background:'transparent', color:'var(--fg-4)', border:'1px solid var(--border)'}}>
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    {rpMarkingDone === r.id && (
                      <div style={{padding:'8px 14px 12px', borderTop:'1px solid rgba(74,222,128,0.2)', borderBottom:'1px solid rgba(251,191,36,0.1)', background:'var(--bg-3)'}}>
                        <div style={{fontSize:10, fontWeight:700, color:'var(--fg-4)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6}}>Confirmation Note (optional)</div>
                        <textarea
                          autoFocus
                          placeholder="Brief note about how the scene went..."
                          value={rpDoneNote}
                          onChange={e => setRpDoneNote(e.target.value)}
                          rows={2}
                          style={{width:'100%', resize:'vertical', padding:'8px 10px', borderRadius:6, border:'1px solid rgba(74,222,128,0.3)',
                            background:'var(--bg-2)', color:'var(--fg-1)', fontSize:12, lineHeight:1.5, outline:'none', boxSizing:'border-box', fontFamily:'inherit'}}
                        />
                        <div style={{display:'flex', gap:6, marginTop:6}}>
                          <button onClick={async () => {
                            await markRPDone(r.id, rpDoneNote);
                            setRpMarkingDone(null); setRpDoneNote('');
                            getMyRPRequests().then(setMyRPRequests); refreshQueue();
                          }} style={{fontSize:11, fontWeight:700, padding:'5px 14px', borderRadius:5, cursor:'pointer',
                            background:'rgba(74,222,128,0.85)', color:'#000', border:'none'}}>
                            Confirm RP Done
                          </button>
                          <button onClick={() => setRpMarkingDone(null)}
                            style={{fontSize:11, padding:'5px 12px', borderRadius:5, cursor:'pointer',
                              background:'transparent', color:'var(--fg-4)', border:'1px solid var(--border)'}}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                    {rpResubmitting === r.id && (
                      <div style={{padding:'8px 14px 12px', borderTop:'1px solid rgba(248,113,113,0.2)', borderBottom:'1px solid rgba(251,191,36,0.1)', background:'var(--bg-3)'}}>
                        <div style={{fontSize:10, fontWeight:700, color:'var(--fg-4)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6}}>Additional Context for FM Leadership</div>
                        <textarea
                          autoFocus
                          placeholder="Explain why this change is needed..."
                          value={rpResubmitNote}
                          onChange={e => setRpResubmitNote(e.target.value)}
                          rows={3}
                          style={{width:'100%', resize:'vertical', padding:'8px 10px', borderRadius:6, border:'1px solid rgba(248,113,113,0.3)',
                            background:'var(--bg-2)', color:'var(--fg-1)', fontSize:12, lineHeight:1.5, outline:'none', boxSizing:'border-box', fontFamily:'inherit'}}
                        />
                        <div style={{display:'flex', gap:6, marginTop:6}}>
                          <button onClick={async () => {
                            if (!rpResubmitNote.trim()) return;
                            await resubmitRPChange(r.id, rpResubmitNote);
                            setRpResubmitting(null); setRpResubmitNote('');
                            getMyRPRequests().then(setMyRPRequests);
                          }} disabled={!rpResubmitNote.trim()}
                            style={{fontSize:11, fontWeight:700, padding:'5px 14px', borderRadius:5, cursor:'pointer',
                              background:'rgba(248,113,113,0.85)', color:'#fff', border:'none', opacity: !rpResubmitNote.trim() ? 0.5 : 1}}>
                            Resubmit Request
                          </button>
                          <button onClick={() => setRpResubmitting(null)}
                            style={{fontSize:11, padding:'5px 12px', borderRadius:5, cursor:'pointer',
                              background:'transparent', color:'var(--fg-4)', border:'1px solid var(--border)'}}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Stat bar ── */}
      {visibleStats && (visibleStats.length > 0 || editMode) && (
        <div className="stat-row">
          {STAT_BOXES.map(s => {
            const isVisible = visibleStats.includes(s.id);
            if (!isVisible && !editMode) return null;
            const value = s.id === 'assignedToMe' ? data.assignedToMe.length
                        : s.id === 'teamTasks'    ? data.forMyTeam.length
                        : s.id === 'upcoming'     ? sortedReminders.length
                        : teamFactions.factions.length;
            if (s.id === 'factions' && teamFactions.factions.length === 0 && !editMode) return null;
            return (
              <div key={s.id} className="stat-box" style={editMode ? {position:'relative', opacity: isVisible ? 1 : 0.4} : {}}>
                {editMode && isVisible && (
                  <button onClick={() => removeStatBox(s.id)}
                    style={{position:'absolute',top:5,right:5,background:'none',border:'none',color:'var(--red)',cursor:'pointer',fontSize:11,fontWeight:700,lineHeight:1,padding:'2px 5px'}}>✕</button>
                )}
                {editMode && !isVisible && (
                  <button onClick={() => addStatBox(s.id)}
                    style={{position:'absolute',inset:0,background:'rgba(160,126,245,0.08)',border:'1px dashed rgba(160,126,245,0.4)',borderRadius:'inherit',color:'var(--accent)',cursor:'pointer',fontSize:10,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center'}}>+ Add</button>
                )}
                <div className="stat-num" style={{color:s.color}}>{value}</div>
                <div className="stat-lbl">{s.label}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Edit mode hint bar ── */}
      {editMode && (
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 14px',background:'rgba(160,126,245,0.08)',border:'1px dashed rgba(160,126,245,0.35)',borderRadius:10,gap:12,flexWrap:'wrap'}}>
          <span style={{fontSize:11,color:'var(--fg-3)'}}>Drag to reorder &nbsp;·&nbsp; Pick size with ¼ ⅓ ½ ⅔ Full &nbsp;·&nbsp; ✕ to remove &nbsp;·&nbsp; Gaps fill automatically</span>
          <button onClick={resetLayout} style={{fontSize:10,fontWeight:700,color:'var(--fg-4)',background:'transparent',border:'1px solid var(--border)',padding:'4px 12px',borderRadius:6,cursor:'pointer',letterSpacing:'0.04em',textTransform:'uppercase'}}>
            Reset to Default
          </button>
        </div>
      )}

      {/* ── Widget grid — 12-column, dense auto-flow fills gaps ── */}
      {layout && (
        <div style={{display:'grid', gridTemplateColumns:'repeat(12, minmax(0, 1fr))', gridAutoFlow:'dense', gap:16}}>
          {accessibleLayout.map((widget, idx) => {
            const cols = sizeCols(widget.size);
            const isDragOver = dragOverIdx === idx && dragSrc.current !== null && dragSrc.current !== idx;
            return (
              <div
                key={widget.id}
                style={{
                  gridColumn: cols >= 12 ? '1 / -1' : `span ${cols}`,
                  outline: isDragOver ? '2px dashed var(--accent)' : '2px solid transparent',
                  outlineOffset: 3,
                  borderRadius: 12,
                  opacity: dragSrc.current === idx && dragOverIdx !== null ? 0.45 : 1,
                  transition: 'opacity 0.12s, outline-color 0.12s',
                  minWidth: 0,
                }}
                draggable={editMode}
                onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; dragSrc.current = idx; }}
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragSrc.current !== null) setDragOverIdx(idx); }}
                onDragLeave={() => setDragOverIdx(null)}
                onDrop={e => {
                  e.preventDefault();
                  if (dragSrc.current !== null && dragSrc.current !== idx) reorderWidgets(dragSrc.current, idx);
                  dragSrc.current = null; setDragOverIdx(null);
                }}
                onDragEnd={() => { dragSrc.current = null; setDragOverIdx(null); }}
              >
                {/* Edit mode chrome bar */}
                {editMode && (
                  <div style={editBar.wrapper} onClick={e => e.stopPropagation()}>
                    <span style={editBar.name}>⠿ &nbsp;{WIDGETS[widget.id]?.name}</span>
                    <div style={{display:'flex', alignItems:'center', gap:4, flexWrap:'wrap'}}>
                      {SIZES.map(s => (
                        <button key={s.key} style={editBar.sizeBtn(widget.size === s.key)}
                          onClick={() => setWidgetSize(widget.id, s.key)}>
                          {s.label}
                        </button>
                      ))}
                      <button style={{...editBar.removeBtn, marginLeft:4}} onClick={() => removeWidget(widget.id)}>✕</button>
                    </div>
                  </div>
                )}
                {/* Widget content */}
                <div style={editMode ? {borderRadius:'0 0 10px 10px', overflow:'hidden'} : {}}>
                  {RENDER[widget.id]?.()}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add widget panel (edit mode only) ── */}
      {editMode && availableToAdd.length > 0 && (
        <div style={{padding:'14px 16px', background:'rgba(255,255,255,0.03)', border:'1px dashed rgba(160,126,245,0.3)', borderRadius:12}}>
          <div style={{fontSize:10,fontWeight:700,color:'var(--accent)',fontFamily:'var(--font-mono)',marginBottom:10,textTransform:'uppercase',letterSpacing:'0.12em'}}>Add Widget</div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            {availableToAdd.map(([id, def]) => (
              <button key={id} onClick={()=>addWidget(id)}
                style={{padding:'7px 16px',borderRadius:8,border:'1px solid rgba(160,126,245,0.35)',background:'transparent',color:'var(--fg-2)',fontSize:11,fontWeight:600,cursor:'pointer',transition:'background 0.15s'}}
                onMouseEnter={e=>e.currentTarget.style.background='rgba(160,126,245,0.1)'}
                onMouseLeave={e=>e.currentTarget.style.background='transparent'}
              >+ {def.name}</button>
            ))}
          </div>
        </div>
      )}

      {/* ── Create modal ── */}
      {showCreate && (
        <div style={{position:'fixed',inset:0,zIndex:50,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',padding:24}} onClick={()=>setShowCreate(false)}>
          <div style={{background:'var(--bg-0)',border:'1px solid var(--border)',borderRadius:12,padding:20,maxWidth:480,width:'100%'}} onClick={e=>e.stopPropagation()}>
            <div style={{display:'flex',gap:8,marginBottom:16}}>
              <button style={S.tabBtn(createMode==='task')} onClick={()=>setCreateMode('task')}>Task</button>
              <button style={S.tabBtn(createMode==='reminder')} onClick={()=>setCreateMode('reminder')}>Event/Reminder</button>
            </div>

            {createMode==='task' ? (
              <div style={{display:'flex',flexDirection:'column',gap:12}}>
                <div>
                  <div style={S.label}>Description</div>
                  <textarea rows="3" style={{...S.input,fontFamily:'inherit',resize:'vertical'}} value={createForm.desc} onChange={e=>setCreateForm({...createForm,desc:e.target.value})} placeholder="What needs doing?" />
                </div>
                <div>
                  <div style={S.label}>Target</div>
                  <select style={S.input} value={createForm.targetType+':'+createForm.targetId} onChange={e=>{
                    const [tt,ti] = e.target.value.split(':');
                    setCreateForm({...createForm,targetType:tt,targetId:ti});
                  }}>
                    <option value="Role:">— Choose target —</option>
                    {roleTargets.leadershipId && <option value={`Role:${roleTargets.leadershipId}`}>Role: FM Leadership</option>}
                    {roleTargets.leadId && <option value={`Role:${roleTargets.leadId}`}>Role: Team Leads</option>}
                    {roleTargets.allFmId && <option value={`Role:${roleTargets.allFmId}`}>Role: All FM</option>}
                    {roleTargets.teams?.map(t => (<option key={t.team_id} value={`Role:${t.team_id}`}>Team: {t.team_name}</option>))}
                    <optgroup label="Individual users">
                      {staffList.map(s => (<option key={s.discord_id} value={`User:${s.discord_id}`}>{s.display_name} ({s.team_name})</option>))}
                    </optgroup>
                  </select>
                </div>
                <label style={{display:'flex',alignItems:'center',gap:8,fontSize:12,cursor:'pointer'}}>
                  <input type="checkbox" checked={createForm.enableDM} onChange={e=>setCreateForm({...createForm,enableDM:e.target.checked})} />
                  Daily DM reminder until claimed
                </label>
              </div>
            ) : (
              <div style={{display:'flex',flexDirection:'column',gap:12}}>
                <div>
                  <div style={S.label}>Event Type</div>
                  <select style={S.input} value={createForm.eventType} onChange={e=>setCreateForm({...createForm,eventType:e.target.value})}>
                    <option>General</option><option>OOC Meeting</option><option>One-Off</option><option>World Storyline</option><option>Onboarding</option>
                  </select>
                </div>
                <div>
                  <div style={S.label}>Message</div>
                  <input style={S.input} value={createForm.note} onChange={e=>setCreateForm({...createForm,note:e.target.value})} placeholder="Brief description" />
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                  <div><div style={S.label}>Date</div><input type="date" style={S.input} value={createForm.date} onChange={e=>setCreateForm({...createForm,date:e.target.value})} /></div>
                  <div><div style={S.label}>Time</div><input type="time" style={S.input} value={createForm.time} onChange={e=>setCreateForm({...createForm,time:e.target.value})} /></div>
                </div>
                <div>
                  <div style={S.label}>Target</div>
                  <select style={S.input} value={createForm.targetType+':'+createForm.targetId} onChange={e=>{
                    const [tt,ti] = e.target.value.split(':');
                    setCreateForm({...createForm,targetType:tt,targetId:ti});
                  }}>
                    <option value="Role:">— Choose target —</option>
                    {roleTargets.leadershipId && <option value={`Role:${roleTargets.leadershipId}`}>Role: FM Leadership</option>}
                    {roleTargets.leadId && <option value={`Role:${roleTargets.leadId}`}>Role: Team Leads</option>}
                    {roleTargets.allFmId && <option value={`Role:${roleTargets.allFmId}`}>Role: All FM</option>}
                    {roleTargets.teams?.map(t => (<option key={t.team_id} value={`Role:${t.team_id}`}>Team: {t.team_name}</option>))}
                    <optgroup label="Individual users">
                      {staffList.map(s => (<option key={s.discord_id} value={`User:${s.discord_id}`}>{s.display_name} ({s.team_name})</option>))}
                    </optgroup>
                  </select>
                </div>
              </div>
            )}

            <div style={{display:'flex',justifyContent:'space-between',marginTop:20}}>
              <button style={S.btnGhost} onClick={()=>setShowCreate(false)}>Cancel</button>
              <button style={S.btn} onClick={async()=>{
                if (createMode === 'task') {
                  if (!createForm.desc.trim()) { showAlert('Description required'); return; }
                  if (!createForm.targetId) { showAlert('Target required'); return; }
                  await createMyTask({desc:createForm.desc.trim(),targetType:createForm.targetType,targetId:createForm.targetId,enableDM:createForm.enableDM});
                } else {
                  if (!createForm.note.trim()) { showAlert('Message required'); return; }
                  if (!createForm.date || !createForm.time) { showAlert('Date and time required'); return; }
                  if (!createForm.targetId) { showAlert('Target required'); return; }
                  const epochMs = new Date(createForm.date + 'T' + createForm.time).getTime();
                  await createMyReminder({message:createForm.note.trim(),epochMs,targetType:createForm.targetType,targetId:createForm.targetId,eventType:createForm.eventType,note:createForm.note});
                }
                setShowCreate(false);
                setCreateForm({desc:'',targetType:'Role',targetId:'',enableDM:false,eventType:'General',date:'',time:'',warning:false,note:''});
                refresh();
              }}>Create</button>
            </div>
          </div>
        </div>
      )}

      {reassigning && <ReassignModal task={reassigning} auth={auth} onClose={()=>setReassigning(null)} onDone={()=>{setReassigning(null);refresh();}} />}
      {completing   && <CompleteModal task={completing} onClose={()=>setCompleting(null)} onDone={()=>{setCompleting(null);refresh();}} />}
      {unclaimingTask && <UnclaimModal task={unclaimingTask} onClose={()=>setUnclaimingTask(null)} onDone={()=>{setUnclaimingTask(null);refresh();}} />}
      {requestingInfo && <RequestInfoModal task={requestingInfo} onClose={()=>setRequestingInfo(null)} onDone={()=>{setRequestingInfo(null);refresh();}} />}
    </div>
  );
}
