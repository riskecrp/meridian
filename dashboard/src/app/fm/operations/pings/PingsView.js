"use client";
import { useEffect, useMemo, useState } from "react";
import {
  getPingConfig, updatePingRoute, testPing, refreshDirectory,
  updateNamedChannel, addSyncChannel, setSyncChannelEnabled, removeSyncChannel,
} from "./actions.js";

// Shared by /fm/operations/pings and v2 Admin › Config › Pings. Renders content
// only — no page heading or width wrapper — so each surface frames it its own way.
// Styling uses the global CSS vars, which are defined at :root and so resolve
// inside the v2 shell too.

const S = {
  group:      { marginBottom: 28 },
  groupHead:  { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 2 },
  groupTitle: { fontSize: 13, fontWeight: 700, color: 'var(--fg-0)', letterSpacing: '0.02em' },
  groupBlurb: { fontSize: 11.5, color: 'var(--fg-3)' },
  row:        { borderTop: '1px solid var(--border)', padding: '12px 0' },
  rowTop:     { display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  label:      { fontSize: 13, fontWeight: 600, color: 'var(--fg-0)' },
  desc:       { fontSize: 11.5, color: 'var(--fg-2)', marginTop: 2, maxWidth: 620, lineHeight: 1.45 },
  meta:       { fontSize: 10.5, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)', marginTop: 3 },
  fieldRow:   { display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10, alignItems: 'flex-end' },
  field:      { display: 'flex', flexDirection: 'column', gap: 4 },
  fieldLabel: { fontSize: 10, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em' },
  select:     { background: 'var(--bg-2)', color: 'var(--fg-0)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: 12, minWidth: 230 },
  btn:        { background: 'var(--bg-3)', color: 'var(--fg-1)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 11px', fontSize: 11.5, cursor: 'pointer' },
  btnPrimary: { background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 6, padding: '6px 11px', fontSize: 11.5, cursor: 'pointer', fontWeight: 600 },
  pill:       { fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 99, textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' },
  note:       { fontSize: 11, color: 'var(--fg-3)', marginTop: 6, lineHeight: 1.5 },
  warn:       { background: 'var(--amber-bg)', border: '1px solid var(--amber)', color: 'var(--amber)', borderRadius: 8, padding: '10px 12px', fontSize: 12, marginBottom: 18 },
  toast:      { position: 'fixed', bottom: 22, right: 22, zIndex: 9999, borderRadius: 8, padding: '10px 14px', fontSize: 12.5, fontWeight: 600, boxShadow: 'var(--shadow-lg)' },
};

const KIND_NOTE = {
  dm:       'Delivered as a direct message — there is no channel to choose. The switch still mutes it.',
  per_item: 'Each record carries its own destination (chosen when the reminder is created). The switch still mutes it.',
  source:   'The bot READS this channel rather than posting to it.',
};

function ChannelSelect({ value, channels, onChange, disabled }) {
  // Preserve an id that is not in the fetched list (private channel, stale cache)
  // so opening the picker can never silently blank a working destination.
  const known = channels.some(c => c.id === value);
  // Grouped by server then category — several routes post outside the FM guild,
  // so the server has to be visible or you can't tell two #general apart.
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
    <select style={S.select} value={value || ''} disabled={disabled}
            onChange={e => onChange(e.target.value)}>
      <option value="">— none —</option>
      {value && !known && <option value={value}>{`Unlisted channel (${value})`}</option>}
      {grouped.map(([label, list]) => (
        <optgroup key={label} label={label}>
          {list.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

// Roles are offered from the server the ping actually posts to — a mention of a
// role from another guild renders as dead text in Discord.
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
      <button type="button" style={{ ...S.select, textAlign: 'left', cursor: 'pointer' }}
              onClick={() => setOpen(o => !o)}>
        {value.length ? value.map(nameFor).map(n => `@${n}`).join(', ') : '— no role ping —'}
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
                <label key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 6px',
                                           fontSize: 12, color: 'var(--fg-1)', cursor: 'pointer' }}>
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

function RouteRow({ route, channels, roles, deadChannels, onSaved, toast }) {
  const [channelId, setChannelId] = useState(route.channel_id);
  const [altChannelId, setAltChannelId] = useState(route.alt_channel_id);
  const [mentions, setMentions] = useState(route.mention_roles);
  const [enabled, setEnabled] = useState(route.enabled);
  const [busy, setBusy] = useState(false);

  const dirty =
    channelId !== route.channel_id ||
    altChannelId !== route.alt_channel_id ||
    enabled !== route.enabled ||
    JSON.stringify(mentions) !== JSON.stringify(route.mention_roles);

  const save = async () => {
    setBusy(true);
    const res = await updatePingRoute(route.key, {
      channel_id: channelId, alt_channel_id: altChannelId, mention_roles: mentions, enabled,
    });
    setBusy(false);
    if (!res.ok) return toast(res.error, true);
    toast('Saved');
    onSaved();
  };

  const runTest = async (alt) => {
    setBusy(true);
    const res = await testPing(route.key, { alt });
    setBusy(false);
    toast(res.ok ? 'Test sent' : res.error, !res.ok);
  };

  const configurable = route.kind === 'channel' || route.kind === 'source';

  // A saved destination Discord returned 404 for is a silently-broken ping.
  const missing = [channelId, altChannelId].filter(id => id && deadChannels.includes(id));

  return (
    <div style={S.row}>
      <div style={S.rowTop}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={S.label}>{route.label}</span>
            {!enabled && <span style={{ ...S.pill, background: 'var(--red-bg)', color: 'var(--red)' }}>Off</span>}
            {missing.length > 0 && (
              <span style={{ ...S.pill, background: 'var(--red-bg)', color: 'var(--red)' }}
                    title={`Discord does not recognise: ${missing.join(', ')}. The channel was probably deleted — this ping is going nowhere.`}>
                ⚠ Channel not found
              </span>
            )}
            {route.alt_label && <span style={{ ...S.pill, background: 'var(--amber-bg)', color: 'var(--amber)' }}>🔒 Two destinations</span>}
            {route.kind !== 'channel' && <span style={{ ...S.pill, background: 'var(--bg-3)', color: 'var(--fg-2)' }}>{route.kind}</span>}
          </div>
          <div style={S.desc}>{route.description}</div>
          {route.dynamic_mentions && (
            <div style={S.note}>Also mentions, from the event itself: <strong>{route.dynamic_mentions}</strong></div>
          )}
          {KIND_NOTE[route.kind] && <div style={S.note}>{KIND_NOTE[route.kind]}</div>}
          <div style={S.meta}>{route.key} · {route.source_hint}</div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--fg-2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          Enabled
        </label>
      </div>

      {configurable && (
        <div style={S.fieldRow}>
          <div style={S.field}>
            <span style={S.fieldLabel}>{route.alt_label ? 'Default channel' : route.kind === 'source' ? 'Watched channel' : 'Channel'}</span>
            <ChannelSelect value={channelId} channels={channels} onChange={setChannelId} />
          </div>

          {route.alt_label && (
            <div style={S.field}>
              <span style={S.fieldLabel}>🔒 {route.alt_label}</span>
              <ChannelSelect value={altChannelId} channels={channels} onChange={setAltChannelId} />
            </div>
          )}

          {route.kind !== 'source' && (
            <div style={S.field}>
              <span style={S.fieldLabel}>Role mentions</span>
              <RolePicker value={mentions} roles={roles} channelId={channelId} channels={channels} onChange={setMentions} />
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ ...S.btnPrimary, opacity: dirty && !busy ? 1 : 0.4 }} disabled={!dirty || busy} onClick={save}>Save</button>
            {route.kind === 'channel' && (
              <>
                <button style={{ ...S.btn, opacity: busy || dirty ? 0.4 : 1 }} disabled={busy || dirty}
                        onClick={() => runTest(false)} title={dirty ? 'Save first' : 'Send a test message'}>Test</button>
                {route.alt_label && (
                  <button style={{ ...S.btn, opacity: busy || dirty ? 0.4 : 1 }} disabled={busy || dirty}
                          onClick={() => runTest(true)} title={dirty ? 'Save first' : 'Test the second destination'}>Test 🔒</button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NamedChannels({ rows, channels, onSaved, toast }) {
  return (
    <div style={S.group}>
      <div style={S.groupHead}>
        <span style={S.groupTitle}>Named channels</span>
        <span style={S.groupBlurb}>Shorthand names used by the recurring-reminder picker and dashboard visibility rules.</span>
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
    <div style={{ ...S.row, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={S.label}>{row.description || row.key}</div>
        <div style={S.meta}>{row.key}</div>
      </div>
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
    <div style={S.group}>
      <div style={S.groupHead}>
        <span style={S.groupTitle}>Conversation sync</span>
        <span style={S.groupBlurb}>Channels the bot harvests message history from. Not pings — this drives Admin › Conversations.</span>
      </div>
      {rows.map(r => (
        <div key={r.channel_id} style={{ ...S.row, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={S.label}>#{channels.find(c => c.id === r.channel_id)?.name || r.name || 'unknown channel'}</div>
            <div style={S.meta}>{r.channel_id}</div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--fg-2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={r.enabled}
                   onChange={async e => { await setSyncChannelEnabled(r.channel_id, e.target.checked); toast('Saved'); onSaved(); }} />
            Enabled
          </label>
          <button style={{ ...S.btn, color: 'var(--red)' }}
                  onClick={async () => {
                    if (!window.confirm(`Stop harvesting #${r.name || r.channel_id}?`)) return;
                    await removeSyncChannel(r.channel_id); toast('Removed'); onSaved();
                  }}>Remove</button>
        </div>
      ))}
      <div style={{ ...S.row, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={S.field}>
          <span style={S.fieldLabel}>Add a channel</span>
          <ChannelSelect value={adding} channels={channels} onChange={setAdding} />
        </div>
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

export default function PingsView() {
  const [cfg, setCfg] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [toastMsg, setToastMsg] = useState(null);

  // Surface failures rather than sitting on the loading state — a rejected
  // action would otherwise look like an endless spinner with no clue why.
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
    setTimeout(() => setToastMsg(null), isError ? 5000 : 2200);
  };

  if (loadError) return (
    <div style={{ ...S.warn, background: 'var(--red-bg)', borderColor: 'var(--red)', color: 'var(--red)' }}>
      <strong>Could not load ping configuration.</strong>
      <div style={{ marginTop: 4, fontFamily: 'var(--font-mono)', fontSize: 11 }}>{loadError}</div>
      <button style={{ ...S.btn, marginTop: 10 }} onClick={load}>Retry</button>
    </div>
  );

  if (!cfg) return <div style={{ color: 'var(--fg-3)', fontSize: 13, padding: '20px 0' }}>Loading ping configuration…</div>;

  const disabledCount = cfg.routes.filter(r => !r.enabled).length;

  return (
    <div>
      {cfg.directoryError && (
        <div style={S.warn}>
          Could not reach Discord to list channels and roles ({cfg.directoryError}). The pickers below may be
          incomplete or stale — existing destinations are preserved and still work.
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, color: 'var(--fg-2)', maxWidth: 700, lineHeight: 1.5 }}>
          Every notification Meridian sends, and where it goes. Changes take effect immediately — the bot reads
          the same settings, so nothing needs restarting.
          {disabledCount > 0 && <strong style={{ color: 'var(--amber)' }}> {disabledCount} currently switched off.</strong>}
        </div>
        <button style={S.btn} onClick={async () => { await refreshDirectory(); await load(); toast('Channel list refreshed'); }}>
          Refresh channels
        </button>
      </div>

      {cfg.groups.map(g => {
        const rows = cfg.routes.filter(r => r.group_key === g.key);
        if (!rows.length) return null;
        return (
          <div key={g.key} style={S.group}>
            <div style={S.groupHead}>
              <span style={S.groupTitle}>{g.label}</span>
              <span style={S.groupBlurb}>{g.blurb}</span>
            </div>
            {rows.map(r => (
              <RouteRow key={r.key} route={r} channels={cfg.channels} roles={cfg.roles} deadChannels={cfg.deadChannels || []} onSaved={load} toast={toast} />
            ))}
          </div>
        );
      })}

      <NamedChannels rows={cfg.namedChannels} channels={cfg.channels} onSaved={load} toast={toast} />
      <SyncChannels rows={cfg.syncChannels} channels={cfg.channels} onSaved={load} toast={toast} />

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
