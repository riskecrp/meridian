"use client";
import { useEffect, useMemo, useState } from "react";
import {
  getPingConfig, updatePingRoute, testPing, refreshDirectory, movePings,
  updateNamedChannel, addSyncChannel, setSyncChannelEnabled, removeSyncChannel,
} from "./actions.js";
import { PING_GROUPS } from "./pingGroups.js";

// Shared by /fm/operations/pings and v2 Admin › Config › Pings. Renders content
// only — no page heading or width wrapper — so each surface frames it its own way.
// Styling uses the global CSS vars, which are defined at :root and so resolve
// inside the v2 shell too.
//
// Organised BY DESTINATION by default: the question people actually arrive with
// is "what lands in this channel?", not "what channel does this route use?".
// Rows stay collapsed until opened so the page reads as a summary, and the
// technical route key is tucked behind Details.

const S = {
  bar:        { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 },
  search:     { background: 'var(--bg-2)', color: 'var(--fg-0)', border: '1px solid var(--border)', borderRadius: 7, padding: '7px 10px', fontSize: 12.5, minWidth: 220, flex: 1 },
  seg:        { display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden' },
  segBtn:     (on) => ({ padding: '7px 12px', fontSize: 12, cursor: 'pointer', border: 'none',
                         background: on ? 'var(--accent-bg)' : 'transparent', color: on ? 'var(--accent)' : 'var(--fg-2)', fontWeight: on ? 700 : 500 }),
  sect:       { border: '1px solid var(--border)', borderRadius: 10, marginBottom: 12, overflow: 'hidden' },
  sectHead:   { display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', background: 'var(--bg-2)', flexWrap: 'wrap' },
  chanName:   { fontSize: 14, fontWeight: 700, color: 'var(--fg-0)', fontFamily: 'var(--font-mono)' },
  guildTag:   { fontSize: 10.5, color: 'var(--fg-3)' },
  count:      { fontSize: 11.5, color: 'var(--fg-3)' },
  row:        { borderTop: '1px solid var(--border)' },
  rowHead:    { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', cursor: 'pointer', flexWrap: 'wrap' },
  rowName:    { fontSize: 12.5, color: 'var(--fg-0)', fontWeight: 500 },
  body:       { padding: '4px 14px 14px 14px', background: 'var(--bg-0)' },
  field:      { display: 'flex', flexDirection: 'column', gap: 4 },
  fieldLabel: { fontSize: 10, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em' },
  fieldRow:   { display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 },
  select:     { background: 'var(--bg-2)', color: 'var(--fg-0)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: 12, minWidth: 230 },
  btn:        { background: 'var(--bg-3)', color: 'var(--fg-1)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 11px', fontSize: 11.5, cursor: 'pointer' },
  btnPrimary: { background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 6, padding: '6px 11px', fontSize: 11.5, cursor: 'pointer', fontWeight: 600 },
  pill:       { fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 99, textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' },
  soft:       { fontSize: 11, color: 'var(--fg-3)', lineHeight: 1.5 },
  attn:       { border: '1px solid var(--red)', background: 'var(--red-bg)', borderRadius: 10, padding: '12px 14px', marginBottom: 16 },
  warn:       { background: 'var(--amber-bg)', border: '1px solid var(--amber)', color: 'var(--amber)', borderRadius: 8, padding: '10px 12px', fontSize: 12, marginBottom: 16 },
  toast:      { position: 'fixed', bottom: 22, right: 22, zIndex: 9999, borderRadius: 8, padding: '10px 14px', fontSize: 12.5, fontWeight: 600, boxShadow: 'var(--shadow-lg)' },
};

// Buckets for pings that have no channel of their own to sit under.
const SPECIAL = {
  dm:       { title: 'Sent as a direct message', blurb: 'Goes straight to the person, so there is no channel to choose. You can still switch it off.' },
  per_item: { title: 'Uses whatever channel the reminder was made in', blurb: 'The destination is picked when the reminder is created, not here. You can still switch these off.' },
  source:   { title: 'Channels the bot reads', blurb: 'Not a notification — the bot watches this channel. Changing it changes what gets counted.' },
};

// ── shared bits ──────────────────────────────────────────────────────────────

function ChannelSelect({ value, channels, onChange, disabled, placeholder }) {
  const known = channels.some(c => c.id === value);
  const grouped = useMemo(() => {
    const g = new Map();
    for (const c of channels) {
      const k = `${c.guildName}${c.category ? ` › ${c.category}` : ''}`;
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(c);
    }
    return [...g.entries()];
  }, [channels]);

  return (
    <select style={S.select} value={value || ''} disabled={disabled} onChange={e => onChange(e.target.value)}>
      <option value="">{placeholder || '— nowhere —'}</option>
      {value && !known && <option value={value}>{`Unrecognised channel (${value})`}</option>}
      {grouped.map(([label, list]) => (
        <optgroup key={label} label={label}>
          {list.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

function RolePicker({ value, roles, channelId, channels, onChange }) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const nameFor = id => roles.find(r => r.id === id)?.name || id;
  const toggle = id => onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id]);

  const targetGuild = channels.find(c => c.id === channelId)?.guildId || '';
  const inScope = (targetGuild && !showAll) ? roles.filter(r => r.guildId === targetGuild) : roles;
  const grouped = useMemo(() => {
    const g = new Map();
    for (const r of inScope) {
      if (!g.has(r.guildName)) g.set(r.guildName, []);
      g.get(r.guildName).push(r);
    }
    return [...g.entries()];
  }, [inScope]);

  return (
    <div style={{ position: 'relative' }}>
      <button type="button" style={{ ...S.select, textAlign: 'left', cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        {value.length ? value.map(nameFor).map(n => `@${n}`).join(', ') : '— nobody —'}
      </button>
      {open && (
        <div style={{ position: 'absolute', zIndex: 50, top: '100%', left: 0, marginTop: 4, maxHeight: 300,
                      overflowY: 'auto', background: 'var(--bg-2)', border: '1px solid var(--border-h)',
                      borderRadius: 8, padding: 6, minWidth: 250, boxShadow: 'var(--shadow-lg)' }}>
          {grouped.map(([guildName, list]) => (
            <div key={guildName}>
              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                            color: 'var(--fg-4)', padding: '6px 6px 2px' }}>{guildName}</div>
              {list.map(r => (
                <label key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 6px', fontSize: 12, color: 'var(--fg-1)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={value.includes(r.id)} onChange={() => toggle(r.id)} />
                  @{r.name}
                </label>
              ))}
            </div>
          ))}
          {!grouped.length && <div style={{ fontSize: 11.5, color: 'var(--fg-3)', padding: 6 }}>No roles found for this server.</div>}
          {targetGuild && (
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: 'var(--fg-3)', padding: '6px 6px 0' }}>
              <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
              Show roles from every server
            </label>
          )}
          <button type="button" style={{ ...S.btn, width: '100%', marginTop: 6 }} onClick={() => setOpen(false)}>Done</button>
        </div>
      )}
    </div>
  );
}

const chanLabel = (id, channels) => {
  const c = channels.find(x => x.id === id);
  return c ? `#${c.name}` : (id ? 'an unrecognised channel' : 'nowhere');
};

// ── one ping ─────────────────────────────────────────────────────────────────

function PingRow({ route, channels, roles, deadChannels, onSaved, toast, hideChannel }) {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState(false);
  const [channelId, setChannelId] = useState(route.channel_id);
  const [altChannelId, setAltChannelId] = useState(route.alt_channel_id);
  const [mentions, setMentions] = useState(route.mention_roles);
  const [enabled, setEnabled] = useState(route.enabled);
  const [busy, setBusy] = useState(false);

  // Re-sync when a bulk move or another edit changes this route underneath us.
  useEffect(() => {
    setChannelId(route.channel_id); setAltChannelId(route.alt_channel_id);
    setMentions(route.mention_roles); setEnabled(route.enabled);
  }, [route.channel_id, route.alt_channel_id, route.enabled, JSON.stringify(route.mention_roles)]);

  const dirty =
    channelId !== route.channel_id || altChannelId !== route.alt_channel_id ||
    enabled !== route.enabled || JSON.stringify(mentions) !== JSON.stringify(route.mention_roles);

  const dead = [channelId, altChannelId].some(id => id && deadChannels.includes(id));
  const mentionNames = mentions.map(id => roles.find(r => r.id === id)?.name).filter(Boolean);

  const save = async () => {
    setBusy(true);
    const res = await updatePingRoute(route.key, { channel_id: channelId, alt_channel_id: altChannelId, mention_roles: mentions, enabled });
    setBusy(false);
    if (!res.ok) return toast(res.error, true);
    toast('Saved'); onSaved();
  };
  const runTest = async (alt) => {
    setBusy(true);
    const res = await testPing(route.key, { alt });
    setBusy(false);
    toast(res.ok ? `Test sent to ${chanLabel(alt ? altChannelId : channelId, channels)}` : res.error, !res.ok);
  };

  const configurable = route.kind === 'channel' || route.kind === 'source';

  return (
    <div style={S.row}>
      <div style={S.rowHead} onClick={() => setOpen(o => !o)}>
        <span style={{ color: 'var(--fg-4)', fontSize: 10 }}>{open ? '▾' : '▸'}</span>
        <span style={{ ...S.rowName, opacity: enabled ? 1 : 0.55, textDecoration: enabled ? 'none' : 'line-through' }}>
          {route.label}
        </span>
        {!enabled && <span style={{ ...S.pill, background: 'var(--bg-3)', color: 'var(--fg-3)' }}>Off</span>}
        {dead && <span style={{ ...S.pill, background: 'var(--red-bg)', color: 'var(--red)' }}>⚠ Channel gone</span>}
        {mentionNames.length > 0 && (
          <span style={{ fontSize: 11, color: 'var(--accent)' }}>pings {mentionNames.map(n => `@${n}`).join(', ')}</span>
        )}
        {hideChannel && channelId && (
          <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{chanLabel(channelId, channels)}</span>
        )}
        {route.alt_channel_id && (
          <span style={{ fontSize: 11, color: 'var(--amber)' }}>
            🔒 leadership-only → {chanLabel(route.alt_channel_id, channels)}
          </span>
        )}
      </div>

      {open && (
        <div style={S.body}>
          <div style={{ ...S.soft, maxWidth: 660, marginBottom: 4 }}>{route.description}</div>
          {route.dynamic_mentions && (
            <div style={S.soft}>Always @-mentions <strong>{route.dynamic_mentions.toLowerCase()}</strong> — that comes from the event itself and can't be changed here.</div>
          )}
          {SPECIAL[route.kind] && <div style={{ ...S.soft, marginTop: 4 }}>{SPECIAL[route.kind].blurb}</div>}

          <div style={S.fieldRow}>
            {configurable && (
              <div style={S.field}>
                <span style={S.fieldLabel}>{route.kind === 'source' ? 'Watches' : 'Goes to'}</span>
                <ChannelSelect value={channelId} channels={channels} onChange={setChannelId} />
              </div>
            )}
            {route.alt_label && (
              <div style={S.field}>
                <span style={S.fieldLabel}>🔒 Instead, when {route.alt_label.toLowerCase()}</span>
                <ChannelSelect value={altChannelId} channels={channels} onChange={setAltChannelId} />
              </div>
            )}
            {route.kind !== 'source' && (
              <div style={S.field}>
                <span style={S.fieldLabel}>@-mentions</span>
                <RolePicker value={mentions} roles={roles} channelId={channelId} channels={channels} onChange={setMentions} />
              </div>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--fg-2)', cursor: 'pointer', paddingBottom: 6 }}>
              <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
              {enabled ? 'On' : 'Off'}
            </label>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <button style={{ ...S.btnPrimary, opacity: dirty && !busy ? 1 : 0.4 }} disabled={!dirty || busy} onClick={save}>Save</button>
            {route.kind === 'channel' && (
              <>
                <button style={{ ...S.btn, opacity: busy || dirty ? 0.4 : 1 }} disabled={busy || dirty} onClick={() => runTest(false)}
                        title={dirty ? 'Save your changes first' : 'Post a test message here'}>Send a test</button>
                {route.alt_channel_id && (
                  <button style={{ ...S.btn, opacity: busy || dirty ? 0.4 : 1 }} disabled={busy || dirty} onClick={() => runTest(true)}
                          title={dirty ? 'Save your changes first' : 'Test the leadership-only destination'}>Test 🔒</button>
                )}
              </>
            )}
            <button style={{ ...S.btn, marginLeft: 'auto' }} onClick={() => setDetails(d => !d)}>{details ? 'Hide details' : 'Details'}</button>
          </div>

          {details && (
            <div style={{ ...S.soft, marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
              {route.key} · sent from {route.source_hint}
              {route.updated_by ? ` · last changed by ${route.updated_by} (${route.updated_at})` : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── a destination and everything that lands in it ────────────────────────────

function ChannelSection({ channelId, channels, primary, confidential, roles, deadChannels, onSaved, toast }) {
  const [moveTo, setMoveTo] = useState('');
  const [busy, setBusy] = useState(false);
  const chan = channels.find(c => c.id === channelId);
  const isDead = channelId && deadChannels.includes(channelId);
  const homeGuild = channels.find(c => c.guildId)?.guildName;

  const doMove = async () => {
    setBusy(true);
    const res = await movePings(primary.map(r => r.key), moveTo);
    setBusy(false);
    if (!res.ok) return toast(res.error, true);
    setMoveTo('');
    toast(`Moved ${res.moved} ping${res.moved === 1 ? '' : 's'}`); onSaved();
  };

  return (
    <div style={S.sect}>
      <div style={S.sectHead}>
        <span style={{ ...S.chanName, color: isDead ? 'var(--red)' : 'var(--fg-0)' }}>
          {channelId ? (chan ? `#${chan.name}` : `Unrecognised channel`) : 'Not going anywhere'}
        </span>
        {chan && chan.guildName !== homeGuild && <span style={S.guildTag}>in {chan.guildName}</span>}
        {isDead && <span style={{ ...S.pill, background: 'var(--red-bg)', color: 'var(--red)' }}>⚠ Deleted in Discord</span>}
        <span style={S.count}>
          {primary.length} ping{primary.length === 1 ? '' : 's'}
          {confidential.length > 0 && ` · ${confidential.length} more when leadership-only`}
        </span>
        {primary.length > 0 && channelId && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            <ChannelSelect value={moveTo} channels={channels} onChange={setMoveTo} placeholder="Move all to…" />
            <button style={{ ...S.btnPrimary, opacity: moveTo && !busy ? 1 : 0.4 }} disabled={!moveTo || busy} onClick={doMove}>Move</button>
          </div>
        )}
      </div>

      {primary.map(r => (
        <PingRow key={r.key} route={r} channels={channels} roles={roles} deadChannels={deadChannels} onSaved={onSaved} toast={toast} />
      ))}

      {confidential.length > 0 && (
        <div style={{ ...S.row, padding: '9px 14px', ...S.soft }}>
          🔒 Also arrives here when leadership-scoped:{' '}
          <strong style={{ color: 'var(--fg-2)' }}>{confidential.map(r => r.label).join(' · ')}</strong>
        </div>
      )}
    </div>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function PingsView() {
  const [cfg, setCfg] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [toastMsg, setToastMsg] = useState(null);
  const [view, setView] = useState('channel');
  const [q, setQ] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const load = async () => {
    try {
      setLoadError('');
      setCfg(await getPingConfig());
    } catch (e) {
      setLoadError(e?.message || 'Could not load ping configuration.');
    }
  };
  useEffect(() => { load(); }, []);

  const toast = (msg, isError) => {
    setToastMsg({ msg, isError });
    setTimeout(() => setToastMsg(null), isError ? 5000 : 2400);
  };

  const channels = cfg?.channels || [];
  const dead = cfg?.deadChannels || [];

  const matches = (r) => {
    if (!q.trim()) return true;
    const needle = q.toLowerCase();
    const chan = channels.find(c => c.id === r.channel_id)?.name || '';
    return `${r.label} ${r.description} ${chan} ${r.key}`.toLowerCase().includes(needle);
  };

  const visible = useMemo(() => (cfg?.routes || []).filter(matches), [cfg, q, channels]);

  // Group by destination: a route sits under its primary channel, and is listed
  // (not duplicated as an editable row) under its confidential channel too.
  const byChannel = useMemo(() => {
    const map = new Map();
    const bucket = (id) => {
      if (!map.has(id)) map.set(id, { primary: [], confidential: [] });
      return map.get(id);
    };
    for (const r of visible) {
      if (r.kind === 'dm' || r.kind === 'per_item') continue;
      bucket(r.channel_id || '').primary.push(r);
      if (r.alt_channel_id) bucket(r.alt_channel_id).confidential.push(r);
    }
    return [...map.entries()].sort((a, b) => {
      // Broken first, then "nowhere", then busiest.
      const aDead = a[0] && dead.includes(a[0]), bDead = b[0] && dead.includes(b[0]);
      if (aDead !== bDead) return aDead ? -1 : 1;
      if (!a[0] !== !b[0]) return a[0] ? 1 : -1;
      return b[1].primary.length - a[1].primary.length;
    });
  }, [visible, dead]);

  const unchannelled = useMemo(
    () => visible.filter(r => r.kind === 'dm' || r.kind === 'per_item'),
    [visible]
  );

  if (loadError) return (
    <div style={{ ...S.warn, background: 'var(--red-bg)', borderColor: 'var(--red)', color: 'var(--red)' }}>
      <strong>Could not load ping configuration.</strong>
      <div style={{ marginTop: 4, fontFamily: 'var(--font-mono)', fontSize: 11 }}>{loadError}</div>
      <button style={{ ...S.btn, marginTop: 10 }} onClick={load}>Retry</button>
    </div>
  );
  if (!cfg) return <div style={{ color: 'var(--fg-3)', fontSize: 13, padding: '20px 0' }}>Loading…</div>;

  const broken = cfg.routes.filter(r => (r.channel_id && dead.includes(r.channel_id)) || (r.alt_channel_id && dead.includes(r.alt_channel_id)));
  const missingChannel = cfg.routes.filter(r => r.kind === 'channel' && r.enabled && !r.channel_id);
  const offCount = cfg.routes.filter(r => !r.enabled).length;

  return (
    <div>
      {cfg.directoryError && (
        <div style={S.warn}>
          Couldn&apos;t reach Discord to list your channels ({cfg.directoryError}). Names may be missing or out of date —
          nothing has changed, and existing destinations still work.
        </div>
      )}

      {(broken.length > 0 || missingChannel.length > 0) && (
        <div style={S.attn}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--red)', marginBottom: 6 }}>
            {broken.length + missingChannel.length} ping{broken.length + missingChannel.length === 1 ? '' : 's'} going nowhere
          </div>
          <div style={{ ...S.soft, color: 'var(--fg-1)' }}>
            {broken.map(r => r.label).concat(missingChannel.map(r => r.label)).join(' · ')}
            <div style={{ marginTop: 4 }}>These are switched on but their channel is missing or was deleted in Discord, so nobody is being notified. Open the one below and pick a channel.</div>
          </div>
        </div>
      )}

      <div style={S.bar}>
        <input style={S.search} placeholder="Search a ping or a channel…" value={q} onChange={e => setQ(e.target.value)} />
        <div style={S.seg}>
          <button style={S.segBtn(view === 'channel')} onClick={() => setView('channel')}>By channel</button>
          <button style={S.segBtn(view === 'area')} onClick={() => setView('area')}>By area</button>
        </div>
        <button style={S.btn} onClick={async () => { await refreshDirectory(); await load(); toast('Channel list refreshed'); }}>
          Refresh channels
        </button>
      </div>

      <div style={{ ...S.soft, marginBottom: 14 }}>
        Everything Meridian posts to Discord, and where it lands. Changes apply straight away — nothing needs restarting.
        {offCount > 0 && <> Currently <strong style={{ color: 'var(--amber)' }}>{offCount} switched off</strong>.</>}
      </div>

      {view === 'channel' ? (
        <>
          {byChannel.map(([channelId, { primary, confidential }]) => (
            <ChannelSection key={channelId || 'none'} channelId={channelId} channels={channels}
                            primary={primary} confidential={confidential} roles={cfg.roles}
                            deadChannels={dead} onSaved={load} toast={toast} />
          ))}

          {unchannelled.length > 0 && (
            <div style={S.sect}>
              <div style={S.sectHead}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-0)' }}>Not tied to a channel</span>
                <span style={S.count}>{unchannelled.length}</span>
              </div>
              {unchannelled.map(r => (
                <PingRow key={r.key} route={r} channels={channels} roles={cfg.roles} deadChannels={dead} onSaved={load} toast={toast} />
              ))}
            </div>
          )}
        </>
      ) : (
        PING_GROUPS.map(g => {
          const rows = visible.filter(r => r.group_key === g.key);
          if (!rows.length) return null;
          return (
            <div key={g.key} style={S.sect}>
              <div style={S.sectHead}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-0)' }}>{g.label}</span>
                <span style={S.count}>{g.blurb}</span>
              </div>
              {rows.map(r => (
                <PingRow key={r.key} route={r} channels={channels} roles={cfg.roles} deadChannels={dead}
                         onSaved={load} toast={toast} hideChannel />
              ))}
            </div>
          );
        })
      )}

      {!visible.length && (
        <div style={{ ...S.soft, padding: '24px 0', textAlign: 'center' }}>Nothing matches “{q}”.</div>
      )}

      <div style={{ marginTop: 22 }}>
        <button style={S.btn} onClick={() => setShowAdvanced(s => !s)}>
          {showAdvanced ? 'Hide' : 'Show'} advanced settings
        </button>
        {showAdvanced && (
          <div style={{ marginTop: 14 }}>
            <NamedChannels rows={cfg.namedChannels} channels={channels} onSaved={load} toast={toast} />
            <SyncChannels rows={cfg.syncChannels} channels={channels} onSaved={load} toast={toast} />
          </div>
        )}
      </div>

      {toastMsg && (
        <div style={{ ...S.toast,
                      background: toastMsg.isError ? 'var(--red-bg)' : 'var(--green-bg)',
                      color: toastMsg.isError ? 'var(--red)' : 'var(--green)',
                      border: `1px solid ${toastMsg.isError ? 'var(--red)' : 'var(--green)'}` }}>
          {toastMsg.msg}
        </div>
      )}
    </div>
  );
}

// ── advanced ─────────────────────────────────────────────────────────────────

function NamedChannels({ rows, channels, onSaved, toast }) {
  return (
    <div style={S.sect}>
      <div style={S.sectHead}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-0)' }}>Channel shortcuts</span>
        <span style={S.count}>Named channels offered when someone creates a recurring reminder, and used to decide who can see it.</span>
      </div>
      {rows.map(r => <NamedChannelRow key={r.key} row={r} channels={channels} onSaved={onSaved} toast={toast} />)}
    </div>
  );
}

function NamedChannelRow({ row, channels, onSaved, toast }) {
  const [value, setValue] = useState(row.channel_id);
  const [busy, setBusy] = useState(false);
  const dirty = value !== row.channel_id;
  return (
    <div style={{ ...S.row, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '10px 14px' }}>
      <div style={{ flex: 1, minWidth: 200, fontSize: 12.5, color: 'var(--fg-0)' }}>{row.description || row.key}</div>
      <ChannelSelect value={value} channels={channels} onChange={setValue} />
      <button style={{ ...S.btnPrimary, opacity: dirty && !busy ? 1 : 0.4 }} disabled={!dirty || busy}
              onClick={async () => {
                setBusy(true);
                const res = await updateNamedChannel(row.key, value);
                setBusy(false);
                if (!res.ok) return toast(res.error, true);
                toast('Saved'); onSaved();
              }}>Save</button>
    </div>
  );
}

function SyncChannels({ rows, channels, onSaved, toast }) {
  const [adding, setAdding] = useState('');
  return (
    <div style={S.sect}>
      <div style={S.sectHead}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-0)' }}>Conversation history</span>
        <span style={S.count}>Channels the bot reads to build Admin › Conversations. Nothing is posted to these.</span>
      </div>
      {rows.map(r => (
        <div key={r.channel_id} style={{ ...S.row, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '10px 14px' }}>
          <div style={{ flex: 1, minWidth: 180, fontSize: 12.5, color: 'var(--fg-0)', fontFamily: 'var(--font-mono)' }}>
            #{channels.find(c => c.id === r.channel_id)?.name || r.name || 'unknown channel'}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--fg-2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={r.enabled}
                   onChange={async e => {
                     const res = await setSyncChannelEnabled(r.channel_id, e.target.checked);
                     if (!res.ok) return toast(res.error, true);
                     toast('Saved'); onSaved();
                   }} />
            Reading
          </label>
          <button style={{ ...S.btn, color: 'var(--red)' }}
                  onClick={async () => {
                    if (!window.confirm(`Stop reading #${r.name || r.channel_id}?`)) return;
                    const res = await removeSyncChannel(r.channel_id);
                    if (!res.ok) return toast(res.error, true);
                    toast('Removed'); onSaved();
                  }}>Remove</button>
        </div>
      ))}
      <div style={{ ...S.row, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 14px' }}>
        <ChannelSelect value={adding} channels={channels} onChange={setAdding} placeholder="Add a channel…" />
        <button style={{ ...S.btnPrimary, opacity: adding ? 1 : 0.4 }} disabled={!adding}
                onClick={async () => {
                  const name = channels.find(c => c.id === adding)?.name || '';
                  const res = await addSyncChannel(adding, name);
                  if (!res.ok) return toast(res.error, true);
                  setAdding(''); toast('Added'); onSaved();
                }}>Add</button>
      </div>
    </div>
  );
}
