"use client";
import { useEffect, useState, useMemo, useCallback } from "react";
import { useAuth } from "../../../../lib/useAuth";

const RISK_ID = "738214924760907907";

const s = {
  card:  { background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 12 },
  label: { fontSize: 10, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.12em' },
  input: { background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'var(--fg-1)', outline: 'none', width: '100%' },
  tab:   (a) => ({ padding: '8px 18px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', background: 'none', border: 'none', borderBottom: a ? '2px solid var(--accent)' : '2px solid transparent', color: a ? 'var(--accent)' : 'var(--fg-4)', transition: 'color 0.15s' }),
  th:    { padding: '9px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--fg-4)' },
  td:    { padding: '8px 14px', verticalAlign: 'top' },
};

function fmt(ts) {
  if (!ts) return '—';
  return new Date(ts + 'Z').toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function UserCell({ displayName, username, userId }) {
  if (!displayName && !username) return <span style={{ color:'var(--fg-4)', fontStyle:'italic' }}>unknown</span>;
  return (
    <div>
      <div style={{ color:'var(--fg-1)', fontWeight:600 }}>{displayName || username}</div>
      {displayName && displayName !== username && <div style={{ color:'var(--fg-4)', fontSize:10, fontFamily:'var(--font-mono)' }}>@{username}</div>}
      {userId && <div style={{ color:'var(--fg-4)', fontSize:10, fontFamily:'var(--font-mono)' }}>{userId}</div>}
    </div>
  );
}

function Filters({ search, setSearch, guild, setGuild, guilds, children }) {
  return (
    <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
      <input style={{ ...s.input, maxWidth:240 }} placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
      <select style={{ ...s.input, maxWidth:200 }} value={guild} onChange={e => setGuild(e.target.value)}>
        {guilds.map(g => <option key={g}>{g}</option>)}
      </select>
      {children}
    </div>
  );
}

function Stats({ items }) {
  return (
    <div style={{ display:'grid', gridTemplateColumns:`repeat(${items.length},1fr)`, gap:10 }}>
      {items.map(({ label, value, color }) => (
        <div key={label} style={{ ...s.card, padding:'14px 18px' }}>
          <div style={s.label}>{label}</div>
          <div style={{ fontSize:26, fontWeight:800, color: color || 'var(--fg-1)', marginTop:4 }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

// ── Member Events ──────────────────────────────────────────────────────────
function MemberLog() {
  const [logs, setLogs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [guild, setGuild]     = useState('All');
  const [event, setEvent]     = useState('All');

  useEffect(() => {
    fetch('/api/memberlog').then(r => r.ok ? r.json() : []).then(d => { setLogs(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const guilds   = useMemo(() => ['All', ...new Set(logs.map(l => l.guild_name))].sort(), [logs]);
  const filtered = useMemo(() => logs.filter(l => {
    if (guild !== 'All' && l.guild_name !== guild) return false;
    if (event !== 'All' && l.event !== event) return false;
    const q = search.toLowerCase();
    return !q || l.username.toLowerCase().includes(q) || l.display_name.toLowerCase().includes(q);
  }), [logs, guild, event, search]);

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <Stats items={[{ label:'Showing', value:filtered.length },{ label:'Joins', value:filtered.filter(l=>l.event==='join').length, color:'var(--green)' },{ label:'Leaves', value:filtered.filter(l=>l.event==='leave').length, color:'var(--red)' }]} />
      <Filters search={search} setSearch={setSearch} guild={guild} setGuild={setGuild} guilds={guilds}>
        <select style={{ ...s.input, maxWidth:140 }} value={event} onChange={e => setEvent(e.target.value)}>
          <option>All</option><option value="join">Joins only</option><option value="leave">Leaves only</option>
        </select>
      </Filters>
      <div style={s.card}>
        {loading ? <div style={{ padding:32, textAlign:'center', color:'var(--fg-4)' }}>Loading…</div> : filtered.length === 0 ? <div style={{ padding:32, textAlign:'center', color:'var(--fg-4)', fontStyle:'italic' }}>No events yet.</div> : (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead><tr style={{ background:'rgba(255,255,255,0.025)', borderBottom:'1px solid var(--border)' }}>{['Event','Username','Display Name','Server','Time'].map(h => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>{filtered.map((l,i) => (
              <tr key={l.id} style={{ borderBottom:'1px solid var(--border)', background:i%2?'rgba(255,255,255,0.012)':'transparent' }}>
                <td style={s.td}><span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:4, textTransform:'uppercase', background:l.event==='join'?'rgba(74,222,128,0.12)':'rgba(248,113,113,0.12)', color:l.event==='join'?'var(--green)':'var(--red)' }}>{l.event==='join'?'↗ Join':'↙ Leave'}</span></td>
                <td style={{ ...s.td, fontFamily:'var(--font-mono)', color:'var(--fg-1)' }}>{l.username}</td>
                <td style={{ ...s.td, color:'var(--fg-2)' }}>{l.display_name !== l.username ? l.display_name : '—'}</td>
                <td style={{ ...s.td, color:'var(--fg-3)' }}>{l.guild_name}</td>
                <td style={{ ...s.td, fontFamily:'var(--font-mono)', fontSize:11, color:'var(--fg-4)', whiteSpace:'nowrap' }}>{fmt(l.created_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Deleted Messages ───────────────────────────────────────────────────────
function DeletedMessages() {
  const [logs, setLogs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [guild, setGuild]     = useState('All');
  const [cached, setCached]   = useState('All');

  useEffect(() => {
    fetch('/api/deletedmessages').then(r => r.ok ? r.json() : []).then(d => { setLogs(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const guilds   = useMemo(() => ['All', ...new Set(logs.map(l => l.guild_name))].sort(), [logs]);
  const filtered = useMemo(() => logs.filter(l => {
    if (guild !== 'All' && l.guild_name !== guild) return false;
    if (cached === 'cached' && !l.had_content) return false;
    if (cached === 'uncached' && l.had_content) return false;
    const q = search.toLowerCase();
    return !q || l.author_name.toLowerCase().includes(q) || l.content.toLowerCase().includes(q) || l.channel_name.toLowerCase().includes(q);
  }), [logs, guild, cached, search]);

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <div style={{ padding:'10px 14px', borderRadius:8, background:'rgba(251,191,36,0.07)', border:'1px solid rgba(251,191,36,0.2)', fontSize:12, color:'var(--fg-3)' }}>⚠ Content only available for messages the bot cached since last restart.</div>
      <Stats items={[{ label:'Showing', value:filtered.length },{ label:'With content', value:logs.filter(l=>l.had_content).length, color:'var(--green)' },{ label:'No content', value:logs.filter(l=>!l.had_content).length, color:'var(--fg-4)' }]} />
      <Filters search={search} setSearch={setSearch} guild={guild} setGuild={setGuild} guilds={guilds}>
        <select style={{ ...s.input, maxWidth:180 }} value={cached} onChange={e => setCached(e.target.value)}>
          <option value="All">All messages</option><option value="cached">With content</option><option value="uncached">No content</option>
        </select>
      </Filters>
      <div style={s.card}>
        {loading ? <div style={{ padding:32, textAlign:'center', color:'var(--fg-4)' }}>Loading…</div> : filtered.length === 0 ? <div style={{ padding:32, textAlign:'center', color:'var(--fg-4)', fontStyle:'italic' }}>No deleted messages logged yet.</div> : (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead><tr style={{ background:'rgba(255,255,255,0.025)', borderBottom:'1px solid var(--border)' }}>{['Author','Deleted By','Channel','Server','Content','Time'].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>{filtered.map((l,i) => {
              const selfDel = !l.deleter_id || l.deleter_id === l.author_id;
              return (
                <tr key={l.id} style={{ borderBottom:'1px solid var(--border)', background:i%2?'rgba(255,255,255,0.012)':'transparent' }}>
                  <td style={s.td}><UserCell displayName={l.author_display_name} username={l.author_name} userId={l.author_id} /></td>
                  <td style={s.td}>{selfDel ? <span style={{ color:'var(--fg-4)', fontStyle:'italic', fontSize:11 }}>Self / unknown</span> : <div><div style={{ color:'var(--red)', fontWeight:600 }}>{l.deleter_name}</div><div style={{ color:'var(--fg-4)', fontSize:10, fontFamily:'var(--font-mono)' }}>{l.deleter_id}</div></div>}</td>
                  <td style={{ ...s.td, color:'var(--fg-3)', whiteSpace:'nowrap' }}>#{l.channel_name||l.channel_id}</td>
                  <td style={{ ...s.td, color:'var(--fg-3)', whiteSpace:'nowrap' }}>{l.guild_name}</td>
                  <td style={{ ...s.td, maxWidth:360 }}>{l.had_content ? <span style={{ color:'var(--fg-2)', lineHeight:1.5, wordBreak:'break-word' }}>{l.content}</span> : <span style={{ color:'var(--fg-4)', fontStyle:'italic', fontSize:11 }}>Not cached · ID {l.message_id}</span>}</td>
                  <td style={{ ...s.td, fontFamily:'var(--font-mono)', fontSize:11, color:'var(--fg-4)', whiteSpace:'nowrap' }}>{fmt(l.created_at)}</td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Edited Messages ────────────────────────────────────────────────────────
function EditedMessages() {
  const [logs, setLogs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [guild, setGuild]     = useState('All');

  useEffect(() => {
    fetch('/api/editedmessages').then(r => r.ok ? r.json() : []).then(d => { setLogs(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const guilds   = useMemo(() => ['All', ...new Set(logs.map(l => l.guild_name))].sort(), [logs]);
  const filtered = useMemo(() => logs.filter(l => {
    if (guild !== 'All' && l.guild_name !== guild) return false;
    const q = search.toLowerCase();
    return !q || l.author_name.toLowerCase().includes(q) || l.author_display_name.toLowerCase().includes(q) || l.content_before.toLowerCase().includes(q) || l.content_after.toLowerCase().includes(q);
  }), [logs, guild, search]);

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <Stats items={[{ label:'Showing', value:filtered.length },{ label:'Total edits', value:logs.length },{ label:'Servers', value:new Set(logs.map(l=>l.guild_id)).size }]} />
      <Filters search={search} setSearch={setSearch} guild={guild} setGuild={setGuild} guilds={guilds} />
      <div style={s.card}>
        {loading ? <div style={{ padding:32, textAlign:'center', color:'var(--fg-4)' }}>Loading…</div> : filtered.length === 0 ? <div style={{ padding:32, textAlign:'center', color:'var(--fg-4)', fontStyle:'italic' }}>No edited messages logged yet.</div> : (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead><tr style={{ background:'rgba(255,255,255,0.025)', borderBottom:'1px solid var(--border)' }}>{['Author','Channel','Server','Before','After','Time'].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>{filtered.map((l,i) => (
              <tr key={l.id} style={{ borderBottom:'1px solid var(--border)', background:i%2?'rgba(255,255,255,0.012)':'transparent' }}>
                <td style={s.td}><UserCell displayName={l.author_display_name} username={l.author_name} userId={l.author_id} /></td>
                <td style={{ ...s.td, color:'var(--fg-3)', whiteSpace:'nowrap' }}>#{l.channel_name||l.channel_id}</td>
                <td style={{ ...s.td, color:'var(--fg-3)', whiteSpace:'nowrap' }}>{l.guild_name}</td>
                <td style={{ ...s.td, maxWidth:280, color:'var(--fg-4)', lineHeight:1.5, wordBreak:'break-word' }}>{l.content_before}</td>
                <td style={{ ...s.td, maxWidth:280, color:'var(--fg-1)', lineHeight:1.5, wordBreak:'break-word' }}>{l.content_after}</td>
                <td style={{ ...s.td, fontFamily:'var(--font-mono)', fontSize:11, color:'var(--fg-4)', whiteSpace:'nowrap' }}>{fmt(l.created_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Keyword Alerts ─────────────────────────────────────────────────────────
function KeywordAlerts() {
  const [keywords, setKeywords]     = useState([]);
  const [alerts, setAlerts]         = useState([]);
  const [loadingKw, setLoadingKw]   = useState(true);
  const [loadingAl, setLoadingAl]   = useState(true);
  const [newPhrase, setNewPhrase]   = useState('');
  const [saving, setSaving]         = useState(false);
  const [search, setSearch]         = useState('');
  const [guild, setGuild]           = useState('All');

  const loadKeywords = useCallback(() => {
    fetch('/api/keywords').then(r => r.ok ? r.json() : []).then(d => { setKeywords(d); setLoadingKw(false); }).catch(() => setLoadingKw(false));
  }, []);
  const loadAlerts = useCallback(() => {
    fetch('/api/keywordalerts').then(r => r.ok ? r.json() : []).then(d => { setAlerts(d); setLoadingAl(false); }).catch(() => setLoadingAl(false));
  }, []);

  useEffect(() => { loadKeywords(); loadAlerts(); }, [loadKeywords, loadAlerts]);

  const addKeyword = async () => {
    const phrase = newPhrase.trim();
    if (!phrase) return;
    setSaving(true);
    await fetch('/api/keywords', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ phrase }) });
    setNewPhrase(''); setSaving(false); loadKeywords();
  };

  const removeKeyword = async (id) => {
    await fetch('/api/keywords', { method:'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id }) });
    loadKeywords();
  };

  const guilds   = useMemo(() => ['All', ...new Set(alerts.map(a => a.guild_name))].sort(), [alerts]);
  const filtered = useMemo(() => alerts.filter(a => {
    if (guild !== 'All' && a.guild_name !== guild) return false;
    const q = search.toLowerCase();
    return !q || a.keyword.toLowerCase().includes(q) || a.author_name.toLowerCase().includes(q) || a.content.toLowerCase().includes(q);
  }), [alerts, guild, search]);

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>

      {/* Keyword list */}
      <div style={s.card}>
        <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.12em', color:'var(--fg-3)' }}>Monitored Phrases</span>
          <span style={{ fontSize:11, color:'var(--fg-4)' }}>{keywords.length} active</span>
        </div>
        <div style={{ padding:16, display:'flex', flexDirection:'column', gap:12 }}>
          {/* Add form */}
          <div style={{ display:'flex', gap:8 }}>
            <input
              style={{ ...s.input, flex:1 }}
              placeholder="Add keyword or phrase…"
              value={newPhrase}
              onChange={e => setNewPhrase(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addKeyword()}
            />
            <button
              onClick={addKeyword} disabled={saving || !newPhrase.trim()}
              style={{ padding:'8px 18px', borderRadius:8, background:'var(--accent)', color:'#fff', border:'none', fontSize:12, fontWeight:700, cursor:'pointer', opacity: saving||!newPhrase.trim()?0.5:1 }}
            >
              {saving ? '…' : 'Add'}
            </button>
          </div>
          {/* List */}
          {loadingKw ? <div style={{ color:'var(--fg-4)', fontSize:12 }}>Loading…</div> : keywords.length === 0 ? (
            <div style={{ color:'var(--fg-4)', fontSize:12, fontStyle:'italic' }}>No keywords set. Add one above.</div>
          ) : (
            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              {keywords.map(kw => (
                <div key={kw.id} style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 10px', borderRadius:6, background:'rgba(160,126,245,0.1)', border:'1px solid rgba(160,126,245,0.22)' }}>
                  <span style={{ fontSize:12, color:'var(--accent)' }}>{kw.phrase}</span>
                  <button onClick={() => removeKeyword(kw.id)} style={{ background:'none', border:'none', color:'var(--fg-4)', cursor:'pointer', fontSize:14, lineHeight:1, padding:'0 2px' }}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Alert log */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontSize:13, fontWeight:700, color:'var(--fg-2)' }}>Alert Log</span>
        <button onClick={() => { setLoadingAl(true); loadAlerts(); }} style={{ fontSize:11, color:'var(--accent)', background:'none', border:'none', cursor:'pointer', fontWeight:600 }}>Refresh</button>
      </div>
      <Stats items={[{ label:'Total alerts', value:alerts.length, color:'var(--red)' },{ label:'Showing', value:filtered.length },{ label:'Unique keywords', value:new Set(alerts.map(a=>a.keyword)).size }]} />
      <Filters search={search} setSearch={setSearch} guild={guild} setGuild={setGuild} guilds={guilds} />
      <div style={s.card}>
        {loadingAl ? <div style={{ padding:32, textAlign:'center', color:'var(--fg-4)' }}>Loading…</div> : filtered.length === 0 ? <div style={{ padding:32, textAlign:'center', color:'var(--fg-4)', fontStyle:'italic' }}>No alerts triggered yet.</div> : (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead><tr style={{ background:'rgba(255,255,255,0.025)', borderBottom:'1px solid var(--border)' }}>{['Keyword','Type','Author','Channel','Server','Content','Time'].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>{filtered.map((a,i) => (
              <tr key={a.id} style={{ borderBottom:'1px solid var(--border)', background:i%2?'rgba(255,255,255,0.012)':'transparent' }}>
                <td style={s.td}><span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:4, background:'rgba(248,113,113,0.12)', color:'var(--red)' }}>{a.keyword}</span></td>
                <td style={{ ...s.td, color:'var(--fg-4)', fontSize:11 }}>{a.event_type}</td>
                <td style={s.td}><UserCell displayName={a.author_name} username={a.author_name} userId={a.author_id} /></td>
                <td style={{ ...s.td, color:'var(--fg-3)', whiteSpace:'nowrap' }}>#{a.channel_name||a.channel_id}</td>
                <td style={{ ...s.td, color:'var(--fg-3)', whiteSpace:'nowrap' }}>{a.guild_name}</td>
                <td style={{ ...s.td, maxWidth:340, color:'var(--fg-2)', lineHeight:1.5, wordBreak:'break-word' }}>{a.content}</td>
                <td style={{ ...s.td, fontFamily:'var(--font-mono)', fontSize:11, color:'var(--fg-4)', whiteSpace:'nowrap' }}>{fmt(a.created_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Root ───────────────────────────────────────────────────────────────────
export default function ServerLogsPage() {
  const auth = useAuth();
  const [tab, setTab] = useState('members');

  if (auth.loading) return null;
  if (auth.id !== RISK_ID) return <div style={{ padding:48, textAlign:'center', color:'var(--fg-4)', fontStyle:'italic' }}>Access denied.</div>;

  const tabs = [
    { id:'members', label:'Member Events' },
    { id:'deleted', label:'Deleted Messages' },
    { id:'edited',  label:'Edited Messages' },
    { id:'alerts',  label:'⚠ Keyword Alerts' },
  ];

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div>
        <h1 style={{ fontSize:22, fontWeight:800, color:'var(--fg-0)', letterSpacing:'-0.02em', marginBottom:4 }}>Server Logs</h1>
        <p style={{ fontSize:12, color:'var(--fg-4)' }}>All servers the bot is in · visible only to you</p>
      </div>
      <div style={{ display:'flex', borderBottom:'1px solid var(--border)', gap:0 }}>
        {tabs.map(t => <button key={t.id} style={s.tab(tab===t.id)} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      {tab === 'members' && <MemberLog />}
      {tab === 'deleted' && <DeletedMessages />}
      {tab === 'edited'  && <EditedMessages />}
      {tab === 'alerts'  && <KeywordAlerts />}
    </div>
  );
}
