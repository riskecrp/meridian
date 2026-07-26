"use client";
import { useEffect, useState } from "react";
import PingsView from "../pings/PingsView.js";
import { getPingSummary } from "../pings/actions.js";
import {
  getBotServerConfigs, addBotServerConfig, updateBotServerConfig, deleteBotServerConfig,
  addBotWatchRole, deleteBotWatchRole, getMdbAccessRoles, addMdbAccessRole, deleteMdbAccessRole,
} from "../actions.js";
import { getFactionNames } from "../../factions/actions.js";

// The wiring that connects Meridian to Discord, in one place: what it posts
// (pings), the servers it talks to, and who is allowed in. These were three
// separate nav items answering one question — "how is this plumbed in?" — and
// all are set-once-and-forget, so they belong together.
//
// Sections are collapsed by default and load their own data on open: the page
// must open instantly, and a page showing 45 pings AND 22 servers at once would
// be worse than the three screens it replaces.
//
// Shared by /fm/operations/discord and v2 Admin › Config › Discord & Access, so
// it styles with the global CSS vars rather than v2-scoped class names.

const S = {
  sect:      { border: '1px solid var(--border)', borderRadius: 10, marginBottom: 12, overflow: 'hidden' },
  head:      { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', cursor: 'pointer', background: 'var(--bg-2)' },
  title:     { fontSize: 14, fontWeight: 700, color: 'var(--fg-0)' },
  summary:   { fontSize: 11.5, color: 'var(--fg-3)' },
  body:      { padding: '16px', borderTop: '1px solid var(--border)' },
  soft:      { fontSize: 11.5, color: 'var(--fg-3)', lineHeight: 1.5 },
  btn:       { background: 'var(--bg-3)', color: 'var(--fg-1)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 11px', fontSize: 11.5, cursor: 'pointer' },
  btnPri:    { background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 6, padding: '6px 11px', fontSize: 11.5, cursor: 'pointer', fontWeight: 600 },
  danger:    { background: 'none', color: 'var(--red)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 9px', fontSize: 11, cursor: 'pointer' },
  input:     { background: 'var(--bg-2)', color: 'var(--fg-0)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: 12, width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' },
  lbl:       { fontSize: 10, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 },
  card:      { border: '1px solid var(--border)', borderRadius: 9, marginBottom: 8, overflow: 'hidden' },
  cardHead:  { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer', flexWrap: 'wrap' },
  grid2:     { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 },
  kvGrid:    { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12, padding: '12px', borderTop: '1px solid var(--border)' },
  mono:      { fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--fg-4)' },
  chip:      { fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--accent-bg)', color: 'var(--accent)' },
  modalWrap: { position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalBg:   { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)' },
  modal:     { position: 'relative', width: '100%', maxWidth: 560, maxHeight: '88vh', overflowY: 'auto', background: 'var(--bg-1)', border: '1px solid var(--border-h)', borderRadius: 12, padding: 18, backdropFilter: 'blur(8px)' },
  empty:     { fontSize: 12, color: 'var(--fg-3)', fontStyle: 'italic', padding: '10px 0' },
};

function Section({ title, blurb, summary, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={S.sect}>
      <div style={S.head} onClick={() => setOpen(o => !o)}>
        <span style={{ color: 'var(--fg-4)', fontSize: 11 }}>{open ? '▾' : '▸'}</span>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={S.title}>{title}</div>
          <div style={S.soft}>{blurb}</div>
        </div>
        <span style={S.summary}>{summary}</span>
      </div>
      {open && <div style={S.body}>{children}</div>}
    </div>
  );
}

// ── Faction servers ──────────────────────────────────────────────────────────

const SERVER_FIELDS = [
  ['guild_name',           'Server name',              'e.g. Alliance Discord'],
  ['access_role_id',       'Access role ID',           'Role required to log into the DB site'],
  ['access_role_name',     'Access role name',         'e.g. Ally Member'],
  ['comms_channel_id',     'Command channel ID',       'Right-click channel → Copy ID'],
  ['comms_channel_name',   'Command channel name',     'e.g. #command'],
  ['faction_channel_id',   'Faction-wide channel ID',  'Right-click channel → Copy ID'],
  ['faction_channel_name', 'Faction-wide channel name','e.g. #announcements'],
];

function KV({ label, name, id }) {
  return (
    <div>
      <div style={S.lbl}>{label}</div>
      {id ? (
        <>
          <div style={{ fontSize: 12.5, color: 'var(--fg-0)' }}>{name || <span style={{ color: 'var(--fg-3)', fontStyle: 'italic' }}>Unnamed</span>}</div>
          <div style={S.mono}>{id}</div>
        </>
      ) : <div style={{ fontSize: 11.5, fontStyle: 'italic', color: 'var(--fg-3)' }}>Not set</div>}
    </div>
  );
}

function ServerCard({ server, factions, onRefresh }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [addingWatch, setAddingWatch] = useState(false);
  const [watchForm, setWatchForm] = useState({ role_id: '', role_name: '' });

  const startEdit = (e) => {
    e.stopPropagation();
    setForm({
      guild_name: server.guild_name || '', access_role_id: server.access_role_id || '',
      access_role_name: server.access_role_name || '', comms_channel_id: server.comms_channel_id || '',
      comms_channel_name: server.comms_channel_name || '', faction_channel_id: server.faction_channel_id || '',
      faction_channel_name: server.faction_channel_name || '', faction: server.faction_name || '',
    });
    setEditing(true); setOpen(true);
  };
  const f = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));
  const saveEdit = async () => {
    setSaving(true);
    await updateBotServerConfig(server.id, form);
    setSaving(false); setEditing(false); onRefresh();
  };
  const submitWatch = async () => {
    if (!watchForm.role_id.trim()) return;
    await addBotWatchRole({ config_id: server.id, ...watchForm });
    setAddingWatch(false); setWatchForm({ role_id: '', role_name: '' });
    onRefresh();
  };

  return (
    <div style={S.card}>
      <div style={S.cardHead} onClick={() => { if (!editing) setOpen(o => !o); }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--fg-4)', fontSize: 10 }}>{open ? '▾' : '▸'}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-0)' }}>{server.guild_name || 'Unnamed server'}</span>
          <span style={S.mono}>{server.guild_id}</span>
          {server.faction_name && <span style={S.chip}>{server.faction_name}</span>}
        </div>
        <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
          {!editing && <button style={S.btn} onClick={startEdit}>Edit</button>}
          <button style={S.danger} onClick={async () => {
            if (!window.confirm(`Remove ${server.guild_name || server.guild_id} and all its roles?`)) return;
            await deleteBotServerConfig(server.id); onRefresh();
          }}>Remove</button>
        </div>
      </div>

      {open && (editing ? (
        <div style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
          <div style={S.grid2}>
            <div>
              <div style={S.lbl}>Linked faction</div>
              <select style={S.input} value={form.faction} onChange={f('faction')}>
                <option value="">— None —</option>
                {factions.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            {SERVER_FIELDS.map(([k, label, ph]) => (
              <div key={k}>
                <div style={S.lbl}>{label}</div>
                <input style={S.input} value={form[k]} onChange={f(k)} placeholder={ph} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button style={S.btnPri} disabled={saving} onClick={saveEdit}>{saving ? 'Saving…' : 'Save changes'}</button>
            <button style={S.btn} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <div style={S.kvGrid}>
            <KV label="Access role" name={server.access_role_name} id={server.access_role_id} />
            <KV label="Command channel" name={server.comms_channel_name} id={server.comms_channel_id} />
            <KV label="Faction-wide channel" name={server.faction_channel_name} id={server.faction_channel_id} />
            <div>
              <div style={S.lbl}>Linked faction</div>
              <div style={{ fontSize: 12.5, color: server.faction_name ? 'var(--accent)' : 'var(--fg-3)', fontStyle: server.faction_name ? 'normal' : 'italic' }}>
                {server.faction_name || 'None'}
              </div>
            </div>
          </div>
          <div style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8, flexWrap: 'wrap' }}>
              <span style={S.lbl}>Monitored roles — pings shown on the dashboard</span>
              <button style={S.btn} onClick={() => setAddingWatch(v => !v)}>{addingWatch ? 'Cancel' : '+ Add role'}</button>
            </div>
            {addingWatch && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                <input style={{ ...S.input, maxWidth: 240 }} placeholder="Role ID the bot watches for pings"
                       value={watchForm.role_id} onChange={e => setWatchForm({ ...watchForm, role_id: e.target.value })} />
                <input style={{ ...S.input, maxWidth: 190 }} placeholder="Role name, e.g. @leadership"
                       value={watchForm.role_name} onChange={e => setWatchForm({ ...watchForm, role_name: e.target.value })} />
                <button style={S.btnPri} disabled={!watchForm.role_id.trim()} onClick={submitWatch}>Add</button>
              </div>
            )}
            {!server.watchRoles?.length ? <div style={S.empty}>No roles monitored.</div> : server.watchRoles.map(r => (
              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                                       padding: '5px 10px', borderRadius: 7, background: 'var(--bg-2)', marginBottom: 4 }}>
                <span>
                  <span style={{ fontSize: 12.5, color: 'var(--fg-0)' }}>{r.role_name || <span style={{ color: 'var(--fg-3)', fontStyle: 'italic' }}>Unnamed</span>}</span>
                  <span style={{ ...S.mono, marginLeft: 10 }}>{r.role_id}</span>
                </span>
                <button style={S.danger} onClick={async () => {
                  if (!window.confirm(`Remove monitored role ${r.role_name || r.role_id}?`)) return;
                  await deleteBotWatchRole(r.id); onRefresh();
                }}>Remove</button>
              </div>
            ))}
          </div>
        </>
      ))}
    </div>
  );
}

const EMPTY_SERVER = { guild_id: '', guild_name: '', faction: '', access_role_id: '', access_role_name: '',
                       comms_channel_id: '', comms_channel_name: '', faction_channel_id: '', faction_channel_name: '' };

function FactionServers({ servers, factions, onRefresh }) {
  const [addForm, setAddForm] = useState(null);

  const submitAdd = async () => {
    if (!addForm.guild_id.trim()) return;
    const res = await addBotServerConfig(addForm);
    if (res?.error) return window.alert(res.error);
    setAddForm(null); onRefresh();
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ ...S.soft, maxWidth: 660 }}>
          One entry per Discord server Meridian works with. <strong>Access role</strong> gates login to meridiandatabase.net ·
          <strong> Command channel</strong> receives leadership announcements · <strong>Faction-wide channel</strong> receives
          whole-faction ones · <strong>Monitored roles</strong> are the pings surfaced on the dashboard.
        </div>
        <button style={S.btnPri} onClick={() => setAddForm({ ...EMPTY_SERVER })}>Add server +</button>
      </div>

      {!servers.length && <div style={S.empty}>No servers configured yet.</div>}
      {servers.map(s => <ServerCard key={s.id} server={s} factions={factions} onRefresh={onRefresh} />)}

      {addForm && (
        <div style={S.modalWrap}>
          <div style={S.modalBg} onClick={() => setAddForm(null)} />
          <div style={S.modal}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg-0)', marginBottom: 14 }}>Add a Discord server</div>
            <div style={S.grid2}>
              <div>
                <div style={S.lbl}>Discord server ID *</div>
                <input style={S.input} value={addForm.guild_id} onChange={e => setAddForm({ ...addForm, guild_id: e.target.value })}
                       placeholder="Right-click server → Copy ID" />
              </div>
              <div>
                <div style={S.lbl}>Linked faction</div>
                <select style={S.input} value={addForm.faction} onChange={e => setAddForm({ ...addForm, faction: e.target.value })}>
                  <option value="">— None —</option>
                  {factions.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              {SERVER_FIELDS.map(([k, label, ph]) => (
                <div key={k}>
                  <div style={S.lbl}>{label}</div>
                  <input style={S.input} value={addForm[k]} onChange={e => setAddForm({ ...addForm, [k]: e.target.value })} placeholder={ph} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button style={S.btn} onClick={() => setAddForm(null)}>Cancel</button>
              <button style={S.btnPri} disabled={!addForm.guild_id.trim()} onClick={submitAdd}>Add</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Site access ──────────────────────────────────────────────────────────────

function SiteAccess({ roles, onRefresh }) {
  const [adding, setAdding] = useState(null);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ ...S.soft, maxWidth: 660 }}>
          Discord roles allowed to log in to <strong>meridiandatabase.net</strong>. A member needs at least one of them.
          <strong> If this list is empty, every guild member can get in.</strong> Per-server access roles are set on each
          server above; this list applies across all of them.
        </div>
        <button style={S.btnPri} onClick={() => setAdding({ role_id: '', role_name: '' })}>Add role +</button>
      </div>

      {!roles.length ? (
        <div style={{ ...S.empty, color: 'var(--amber)', fontStyle: 'normal' }}>
          No roles configured — every guild member can currently access the site.
        </div>
      ) : roles.map(r => (
        <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                                 padding: '9px 12px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ flex: 1, minWidth: 160, fontSize: 12.5, color: 'var(--fg-0)' }}>
            {r.role_name || <span style={{ color: 'var(--fg-3)', fontStyle: 'italic' }}>Unnamed</span>}
          </span>
          <span style={S.mono}>{r.role_id}</span>
          <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>added {r.created_at?.substring(0, 10)}</span>
          <button style={S.danger} onClick={async () => {
            if (!window.confirm(`Remove ${r.role_name || r.role_id} from the allow-list?`)) return;
            await deleteMdbAccessRole(r.id); onRefresh();
          }}>Remove</button>
        </div>
      ))}

      {adding && (
        <div style={S.modalWrap}>
          <div style={S.modalBg} onClick={() => setAdding(null)} />
          <div style={{ ...S.modal, maxWidth: 420 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg-0)', marginBottom: 14 }}>Allow a role in</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div style={S.lbl}>Discord role ID</div>
                <input style={S.input} value={adding.role_id} onChange={e => setAdding({ ...adding, role_id: e.target.value })}
                       placeholder="Right-click role → Copy ID" />
              </div>
              <div>
                <div style={S.lbl}>Role name (label)</div>
                <input style={S.input} value={adding.role_name} onChange={e => setAdding({ ...adding, role_name: e.target.value })}
                       placeholder="e.g. Alliance Member" />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button style={S.btn} onClick={() => setAdding(null)}>Cancel</button>
              <button style={S.btnPri} disabled={!adding.role_id.trim()} onClick={async () => {
                await addMdbAccessRole(adding); setAdding(null); onRefresh();
              }}>Add</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function DiscordAccessView() {
  const [pingSummary, setPingSummary] = useState(null);
  const [servers, setServers] = useState([]);
  const [factions, setFactions] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      setError('');
      const [ps, s, f, r] = await Promise.all([
        getPingSummary(), getBotServerConfigs(), getFactionNames(), getMdbAccessRoles(),
      ]);
      setPingSummary(ps); setServers(s || []); setFactions(f || []); setRoles(r || []);
    } catch (e) {
      setError(e?.message || 'Could not load these settings.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const refreshServers = async () => setServers((await getBotServerConfigs()) || []);
  const refreshRoles = async () => setRoles((await getMdbAccessRoles()) || []);

  if (error) return (
    <div style={{ border: '1px solid var(--red)', background: 'var(--red-bg)', color: 'var(--red)', borderRadius: 10, padding: '12px 14px' }}>
      <strong>Could not load these settings.</strong>
      <div style={{ marginTop: 4, ...S.mono, color: 'var(--red)' }}>{error}</div>
      <button style={{ ...S.btn, marginTop: 10 }} onClick={load}>Retry</button>
    </div>
  );
  if (loading) return <div style={{ color: 'var(--fg-3)', fontSize: 13, padding: '20px 0' }}>Loading…</div>;

  const linked = servers.filter(s => s.faction_name).length;

  return (
    <div>
      <div style={{ ...S.soft, marginBottom: 16, maxWidth: 720 }}>
        How Meridian is wired into Discord — what it posts, the servers it talks to, and who can get in.
        These are set-up settings you shouldn&apos;t need often; day-to-day staff changes live under Staff &amp; Teams.
      </div>

      <Section
        title="Pings"
        blurb="Every notification Meridian posts, and which channel it lands in."
        summary={pingSummary
          ? `${pingSummary.total} pings across ${pingSummary.channels} channels${pingSummary.off ? ` · ${pingSummary.off} off` : ''}`
          : ''}
      >
        <PingsView />
      </Section>

      <Section
        title="Discord servers"
        blurb="The servers Meridian talks to, and the channels and roles it uses in each."
        summary={`${servers.length} server${servers.length === 1 ? '' : 's'}${linked ? ` · ${linked} linked to a faction` : ''}`}
      >
        <FactionServers servers={servers} factions={factions} onRefresh={refreshServers} />
      </Section>

      <Section
        title="Site access"
        blurb="Which Discord roles can log in to meridiandatabase.net."
        summary={roles.length ? `${roles.length} role${roles.length === 1 ? '' : 's'} allowed` : 'open to everyone'}
      >
        <SiteAccess roles={roles} onRefresh={refreshRoles} />
      </Section>
    </div>
  );
}
