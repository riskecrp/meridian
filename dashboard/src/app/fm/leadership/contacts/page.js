"use client";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../lib/useAuth";
import LeadershipShell from "../_shared/Shell";
import { getAllIcContacts, getThreadMessages, assignIcContact, setIcContactStatus, stageRoleplay, completeIcContact, getStaffList } from "../../teams/actions";
import RpChangeForm from "../../teams/RpChangeForm";
import { ui } from "../../../../lib/ui.js";

const STATUS_META = {
  pending_discussion: { label: 'Pending Discussion', color: 'var(--amber)', bg: 'var(--amber-bg)' },
  pending_roleplay:   { label: 'Pending Roleplay',   color: 'var(--blue)',  bg: 'var(--blue-bg)'  },
  completed:          { label: 'Completed',           color: 'var(--green)', bg: 'var(--green-bg)' },
};

const st = {
  ...ui,
};

function ThreadMessages({ threadId }) {
  const [msgs, setMsgs] = useState(null);
  const [open, setOpen] = useState(false);

  const load = async () => {
    setMsgs(null);
    const data = await getThreadMessages(threadId);
    setMsgs(data);
  };

  const toggle = () => {
    if (!open && msgs === null) load();
    setOpen(o => !o);
  };

  return (
    <div style={{ marginTop: 10 }}>
      <button onClick={toggle} style={{ ...st.btnGhost, color: 'var(--blue)', fontSize: 10 }}>
        {open ? 'Hide Thread' : 'View Thread Messages'}
      </button>
      {open && (
        <div style={{ marginTop: 8, borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden' }}>
          {msgs === null ? (
            <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--fg-4)', fontStyle: 'italic' }}>Loading...</div>
          ) : msgs.length === 0 ? (
            <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--fg-4)', fontStyle: 'italic' }}>No messages in thread.</div>
          ) : (
            msgs.map((m, i) => (
              <div key={m.id} style={{ padding: '10px 14px', borderBottom: i < msgs.length - 1 ? '1px solid var(--border)' : 'none', background: m.authorBot ? 'rgba(160,126,245,0.04)' : 'transparent' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: m.authorBot ? 'var(--accent)' : 'var(--fg-1)' }}>{m.author}</span>
                  <span style={{ fontSize: 10, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>{new Date(m.timestamp).toLocaleString([], { dateStyle:'short', timeStyle:'short' })}</span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--fg-1)', lineHeight: 1.6, whiteSpace: 'pre-wrap', margin: 0 }}>{m.content}</p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ContactCard({ contact, staffList, onRefresh }) {
  const [assigning, setAssigning] = useState(false);
  const [assignId, setAssignId]   = useState('');
  const [stagingRP, setStagingRP] = useState(false);
  const [busy, setBusy]           = useState(false);
  const meta = STATUS_META[contact.status] || STATUS_META.pending_discussion;

  const doAssign = async () => {
    if (!assignId) return;
    setBusy(true);
    const member = staffList.find(s => s.discord_id === assignId);
    await assignIcContact(contact.id, assignId, member?.display_name || assignId);
    setAssigning(false); setAssignId(''); setBusy(false); onRefresh();
  };

  const doStatusChange = async (newStatus) => {
    setBusy(true);
    if (newStatus === 'completed') await completeIcContact(contact.id);
    else await setIcContactStatus(contact.id, newStatus);
    setBusy(false); onRefresh();
  };

  const doStage = async (rpData) => {
    setBusy(true);
    await stageRoleplay(contact.id, rpData);
    setStagingRP(false);
    setBusy(false); onRefresh();
  };

  return (
    <div style={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-1)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', background: 'var(--bg-2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-0)' }}>{contact.faction_name}</span>
          <span style={{ fontSize: 10, color: 'var(--fg-4)' }}>·</span>
          <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>{contact.sender_name}</span>
          {contact.team_name && (
            <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: 'var(--accent-bg)', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{contact.team_name}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 10, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>{new Date(contact.submitted_at).toLocaleDateString()}</span>
          {contact.thread_id && (
            <a href={`https://discord.com/channels/@me/${contact.thread_id}`} target="_blank" rel="noreferrer"
              style={{ fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 5, background: 'rgba(88,101,242,0.12)', color: '#818cf8', textDecoration: 'none' }}>Thread ↗</a>
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
      <div style={{ padding: '14px 16px' }}>
        <p style={{ fontSize: 13, color: 'var(--fg-1)', lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: '0 0 12px' }}>{contact.message}</p>

        <div style={{ fontSize: 10, color: 'var(--fg-4)', marginBottom: 12 }}>
          {contact.assigned_name ? <><span style={{ color: 'var(--accent)' }}>{contact.assigned_name}</span> assigned</> : 'Unassigned'}
        </div>

        {/* Assign form */}
        {assigning && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <select value={assignId} onChange={e => setAssignId(e.target.value)} style={{ ...st.input, flex: 1 }}>
              <option value="">Select member...</option>
              {staffList.map(s => <option key={s.discord_id} value={s.discord_id}>{s.display_name} {s.team_name ? `(${s.team_name})` : ''}</option>)}
            </select>
            <button disabled={!assignId || busy} onClick={doAssign} style={{ ...st.btn, padding: '6px 12px', fontSize: 10 }}>Confirm</button>
            <button onClick={() => setAssigning(false)} style={st.btnGhost}>Cancel</button>
          </div>
        )}

        {/* Request RP Change form */}
        {stagingRP && (
          <div style={{ marginBottom: 10 }}>
            <RpChangeForm contact={contact} busy={busy} onSubmit={doStage} onCancel={() => setStagingRP(false)} />
          </div>
        )}

        {/* Action buttons */}
        {!assigning && !stagingRP && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            <button onClick={() => setAssigning(true)} style={st.btnGhost}>Assign</button>
            <button onClick={() => setStagingRP(true)} style={{ ...st.btnGhost, color: 'var(--blue)' }}>Request RP Change</button>
          </div>
        )}

        {contact.thread_id && <ThreadMessages threadId={contact.thread_id} />}
      </div>
    </div>
  );
}

export default function IcContactsPage() {
  const auth = useAuth();
  const [contacts, setContacts] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('active');

  const load = async () => {
    const [c, s] = await Promise.all([getAllIcContacts(), getStaffList()]);
    setContacts(c); setStaffList(s); setLoading(false);
  };

  useEffect(() => { if (!auth.loading) load(); }, [auth.loading]);

  const filtered = contacts.filter(c => filter === 'all' ? true : c.status !== 'completed');

  if (auth.loading || loading) return <LeadershipShell title="IC Contacts" section="Communications" accent="var(--accent)" headerBg="rgba(160,126,245,0.06)" level={auth.level}><div style={{ padding: 24, color: 'var(--accent)', fontSize: 13 }}>Loading...</div></LeadershipShell>;

  return (
    <LeadershipShell title="IC Contacts" section="Communications" accent="var(--accent)" headerBg="rgba(160,126,245,0.06)" level={auth.level}>
      <div style={{ padding: '0 24px 40px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {['active', 'all'].map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                ...st.btnGhost,
                ...(filter === f ? { background: 'var(--accent)', color: 'white', border: 'none' } : {}),
              }}>{f === 'active' ? 'Active' : 'All'}</button>
            ))}
          </div>
          <span style={{ fontSize: 11, color: 'var(--fg-4)' }}>{filtered.length} contact{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--fg-4)', fontStyle: 'italic', fontSize: 13 }}>No IC contacts.</div>
        ) : (
          filtered.map(c => <ContactCard key={c.id} contact={c} staffList={staffList} onRefresh={load} />)
        )}
      </div>
    </LeadershipShell>
  );
}
