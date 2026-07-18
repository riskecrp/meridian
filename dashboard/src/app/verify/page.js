"use client";
import { useEffect, useState } from 'react';
import { getVerifySession, getVerifyActivity, getVerifyNotes, getVerifyScenes } from './actions';

const now = new Date();
const DEFAULT_PERIOD = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/* ── tiny helpers ─────────────────────────────────────── */
function Tag({ children, color = 'var(--accent)', bg = 'rgba(160,126,245,0.13)' }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: bg, color, letterSpacing: '0.02em' }}>
      {children}
    </span>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--fg-0)', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--fg-4)', marginTop: 3 }}>{label}</div>
    </div>
  );
}

function People({ label, names }) {
  if (!names?.length) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
      <span style={{ fontSize: 11, color: 'var(--fg-4)', whiteSpace: 'nowrap' }}>{label}:</span>
      <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>{names.join(', ')}</span>
    </div>
  );
}

/* ── tabs ────────────────────────────────────────────── */
const TABS = [['activity', 'Staff Activity'], ['notes', 'Meeting Notes'], ['scenes', 'Scenes']];

/* ── activity tab ────────────────────────────────────── */
function ActivityTab({ staff }) {
  const support  = staff.filter(m => m.category !== 'moderator');
  const mods     = staff.filter(m => m.category === 'moderator');

  const Section = ({ title, rows, accent, bg }) => (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ width: 4, height: 18, borderRadius: 2, background: accent }} />
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg-0)' }}>{title}</span>
        <span style={{ fontSize: 12, color: 'var(--fg-4)' }}>{rows.length} members</span>
      </div>
      <div style={{ border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-2)' }}>
              {['Name', 'Character', 'Team', 'Hours', 'Scenes', 'Meetings'].map(h => (
                <th key={h} style={{ padding: '10px 14px', fontSize: 11, fontWeight: 700, color: 'var(--fg-4)', textAlign: 'left', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} style={{ padding: '20px 14px', fontSize: 13, color: 'var(--fg-4)', textAlign: 'center' }}>No members</td></tr>
            )}
            {rows.map((m, i) => (
              <tr key={m.discord_id} style={{ background: i % 2 === 0 ? 'var(--bg-1)' : 'transparent' }}>
                <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 600, color: 'var(--fg-0)', borderBottom: '1px solid var(--border)' }}>{m.display_name}</td>
                <td style={{ padding: '11px 14px', fontSize: 13, color: 'var(--fg-2)', borderBottom: '1px solid var(--border)' }}>{m.character_name || <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                <td style={{ padding: '11px 14px', fontSize: 11, color: 'var(--fg-4)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{m.team_name || '—'}</td>
                <td style={{ padding: '11px 14px', fontSize: 14, fontWeight: 700, color: accent, borderBottom: '1px solid var(--border)' }}>{m.hours}h</td>
                <td style={{ padding: '11px 14px', fontSize: 13, color: 'var(--fg-1)', borderBottom: '1px solid var(--border)' }}>{m.scenes}</td>
                <td style={{ padding: '11px 14px', fontSize: 13, color: 'var(--fg-1)', borderBottom: '1px solid var(--border)' }}>{m.meetings}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div>
      <Section title="Support" rows={support} accent="var(--accent)" bg="rgba(160,126,245,0.08)" />
      <Section title="Moderator+" rows={mods} accent="#22c55e" bg="rgba(34,197,94,0.08)" />
    </div>
  );
}

/* ── notes tab ───────────────────────────────────────── */
function NotesTab({ notes }) {
  const [expanded, setExpanded] = useState(null);
  if (notes.length === 0) return <Empty text="No meeting notes for this period." />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {notes.map(n => (
        <div key={n.id} style={{ border: `1px solid ${expanded === n.id ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 14, overflow: 'hidden', background: 'var(--bg-1)', transition: 'border-color 0.15s' }}>
          <div style={{ padding: '16px 20px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 16 }}
            onClick={() => setExpanded(expanded === n.id ? null : n.id)}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg-0)' }}>{n.faction_name}</span>
                <Tag>{n.date}</Tag>
              </div>
              <People label="Author"  names={[n.author]} />
              <People label="Present" names={n.present} />
            </div>
            <span style={{ color: 'var(--fg-4)', fontSize: 12, transform: expanded === n.id ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0, marginTop: 3 }}>▼</span>
          </div>
          {expanded === n.id && (
            <div className="quill-content" style={{ padding: '0 20px 20px', borderTop: '1px solid var(--border)', paddingTop: 16, fontSize: 13, lineHeight: 1.7, color: 'var(--fg-1)' }}
              dangerouslySetInnerHTML={{ __html: n.content || '<em style="color:var(--fg-4)">No content</em>' }} />
          )}
        </div>
      ))}
    </div>
  );
}

/* ── scenes tab ──────────────────────────────────────── */
function ScenesTab({ scenes }) {
  const [expanded, setExpanded] = useState(null);
  if (scenes.length === 0) return <Empty text="No scenes for this period." />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {scenes.map(sc => (
        <div key={sc.id} style={{ border: `1px solid ${expanded === sc.id ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 14, overflow: 'hidden', background: 'var(--bg-1)', transition: 'border-color 0.15s' }}>
          <div style={{ padding: '14px 20px', cursor: sc.notes ? 'pointer' : 'default', display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 16 }}
            onClick={() => sc.notes && setExpanded(expanded === sc.id ? null : sc.id)}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg-0)' }}>{sc.faction_name}</span>
                <Tag bg="rgba(34,197,94,0.12)" color="#22c55e">{sc.date}</Tag>
              </div>
              <People label="Author"    names={[sc.logged_by]} />
              <People label="Assistants" names={sc.assistants} />
            </div>
            {sc.notes && (
              <span style={{ color: 'var(--fg-4)', fontSize: 12, transform: expanded === sc.id ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0, marginTop: 3 }}>▼</span>
            )}
          </div>
          {expanded === sc.id && sc.notes && (
            <div style={{ padding: '0 20px 16px', borderTop: '1px solid var(--border)', paddingTop: 14, fontSize: 13, color: 'var(--fg-2)', lineHeight: 1.6 }}>
              {sc.notes}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Empty({ text }) {
  return <div style={{ padding: '60px 0', textAlign: 'center', fontSize: 13, color: 'var(--fg-4)' }}>{text}</div>;
}

function Loading() {
  return <div style={{ padding: '60px 0', textAlign: 'center', fontSize: 13, color: 'var(--accent)', animation: 'pulse 1.5s infinite' }}>Loading…</div>;
}

/* ── main page ───────────────────────────────────────── */
export default function VerifyPage() {
  const [session, setSession] = useState(null);
  const [period,  setPeriod]  = useState(DEFAULT_PERIOD);
  const [tab,     setTab]     = useState('activity');
  const [staff,   setStaff]   = useState([]);
  const [notes,   setNotes]   = useState([]);
  const [scenes,  setScenes]  = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { getVerifySession().then(setSession); }, []);

  useEffect(() => {
    const [y, m] = period.split('-').map(Number);
    setLoading(true);
    Promise.all([getVerifyActivity(y, m), getVerifyNotes(y, m), getVerifyScenes(y, m)])
      .then(([a, n, sc]) => { setStaff(a); setNotes(n); setScenes(sc); setLoading(false); })
      .catch(() => setLoading(false));
  }, [period]);

  const [py, pm] = period.split('-').map(Number);
  const periodLabel = `${MONTH_NAMES[pm - 1]} ${py}`;

  const totalHours    = staff.reduce((s, m) => s + m.hours, 0).toFixed(1);
  const totalScenes   = staff.reduce((s, m) => s + m.scenes, 0);
  const totalMeetings = notes.length;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-0)', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>

      {/* ── header ── */}
      <div style={{ background: 'var(--bg-1)', borderBottom: '1px solid var(--border)', padding: '0 32px', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, color: '#fff' }}>M</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--fg-0)', lineHeight: 1.1 }}>Meridian FM</div>
            <div style={{ fontSize: 11, color: 'var(--fg-4)' }}>Activity Verification</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          {session && <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>{session.discord_name}</span>}
          <a href="/api/auth/verify-logout" style={{ fontSize: 12, color: 'var(--fg-4)', textDecoration: 'none', padding: '5px 12px', borderRadius: 7, border: '1px solid var(--border)' }}>Logout</a>
        </div>
      </div>

      <div style={{ maxWidth: 1060, margin: '0 auto', padding: '36px 24px' }}>

        {/* ── period + summary ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 28 }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--fg-0)' }}>{periodLabel}</div>
            <div style={{ fontSize: 12, color: 'var(--fg-4)', marginTop: 2 }}>Faction Management activity report</div>
          </div>
          <input type="month" value={period} onChange={e => e.target.value && setPeriod(e.target.value)}
            style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 12px', fontSize: 13, color: 'var(--fg-1)', outline: 'none', cursor: 'pointer' }} />
        </div>

        {/* ── summary stats ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 32 }}>
          {[
            { label: 'Staff Members', value: staff.length },
            { label: 'Total Hours',   value: `${totalHours}h` },
            { label: 'Scenes Logged', value: totalScenes },
            { label: 'Meetings Held', value: totalMeetings },
          ].map(({ label, value }) => (
            <div key={label} style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 18px', textAlign: 'center' }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--fg-0)', lineHeight: 1 }}>{value}</div>
              <div style={{ fontSize: 11, color: 'var(--fg-4)', marginTop: 5 }}>{label}</div>
            </div>
          ))}
        </div>

        {/* ── tabs ── */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 22, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
          {TABS.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{
              padding: '9px 18px', borderRadius: '8px 8px 0 0', fontSize: 13, fontWeight: tab === id ? 700 : 500,
              cursor: 'pointer', border: 'none', borderBottom: tab === id ? '2px solid var(--accent)' : '2px solid transparent',
              background: tab === id ? 'rgba(160,126,245,0.08)' : 'transparent',
              color: tab === id ? 'var(--accent)' : 'var(--fg-3)', transition: 'all 0.15s',
            }}>
              {label}
              {id === 'notes'    && !loading && <span style={{ marginLeft: 6, fontSize: 10, background: 'var(--bg-3)', padding: '1px 6px', borderRadius: 99, color: 'var(--fg-4)' }}>{notes.length}</span>}
              {id === 'scenes'   && !loading && <span style={{ marginLeft: 6, fontSize: 10, background: 'var(--bg-3)', padding: '1px 6px', borderRadius: 99, color: 'var(--fg-4)' }}>{scenes.length}</span>}
            </button>
          ))}
        </div>

        {/* ── content ── */}
        {loading ? <Loading /> : (
          <>
            {tab === 'activity' && <ActivityTab staff={staff} />}
            {tab === 'notes'    && <NotesTab    notes={notes} />}
            {tab === 'scenes'   && <ScenesTab   scenes={scenes} />}
          </>
        )}
      </div>
    </div>
  );
}
