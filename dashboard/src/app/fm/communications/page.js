"use client";
import { useEffect, useState, useMemo } from "react";
import { useAuth } from "../../../lib/useAuth";
import { getAnnouncementTargets, sendAnnouncement } from "./actions";
import { DocBar } from "../../../lib/SopLink";
import HistoryView from "./HistoryView";

function tierColor(t) {
  if (t >= 6) return '#f1f5f9'; if (t >= 5) return '#c8d3e0';
  if (t >= 4) return '#a78bfa'; if (t >= 3) return '#60a5fa';
  if (t >= 2) return '#4ade80'; return '#94a3b8';
}

export default function CommunicationsPage() {
  const auth = useAuth();
  const [targets, setTargets]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState(new Set());
  const [message, setMessage]     = useState('');
  const [postToFM, setPostToFM]   = useState(false);
  const [channelType, setChannelType] = useState('command');
  const [sending, setSending]     = useState(false);
  const [result, setResult]       = useState(null);
  const [tab, setTab]             = useState('compose');

  const channelLabel = channelType === 'faction' ? 'Faction-wide' : channelType === 'both' ? 'Command + Faction-wide' : 'Command';
  const hasChan = (t) => channelType === 'command' ? !!t.comms_channel_id
    : channelType === 'faction' ? !!t.faction_channel_id
    : (!!t.comms_channel_id || !!t.faction_channel_id);
  const chanSummary = (t) => {
    const parts = [];
    if (channelType !== 'faction' && t.comms_channel_id) parts.push('#' + (t.comms_channel_name || t.comms_channel_id).replace(/^#/, ''));
    if (channelType !== 'command' && t.faction_channel_id) parts.push('#' + (t.faction_channel_name || t.faction_channel_id).replace(/^#/, ''));
    return parts.join('  ·  ');
  };

  useEffect(() => {
    if (auth.loading || (auth.level < 1 && !auth.isLeadStoryteller)) return;
    getAnnouncementTargets().then(t => { setTargets(t || []); setLoading(false); });
  }, [auth.loading, auth.level]);

  const configurable = useMemo(() => targets.filter(hasChan), [targets, channelType]);
  const unconfigured = useMemo(() => targets.filter(t => !hasChan(t)), [targets, channelType]);
  const allSelected  = configurable.length > 0 && configurable.every(t => selected.has(t.config_id));

  // Dropping to a stricter channel type can orphan a selection whose channel isn't set — prune it.
  useEffect(() => {
    setSelected(prev => new Set([...prev].filter(id => targets.some(t => t.config_id === id && hasChan(t)))));
  }, [channelType]);

  const toggle = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAll   = () => setSelected(new Set(configurable.map(t => t.config_id)));
  const deselectAll = () => setSelected(new Set());

  const handleSend = async () => {
    if (!message.trim() || (!selected.size && !postToFM)) return;
    setSending(true);
    setResult(null);
    const res = await sendAnnouncement([...selected], message, postToFM, channelType);
    setSending(false);
    setResult(res);
    if (res.ok) {
      setMessage('');
      setSelected(new Set());
      setPostToFM(false);
    }
  };

  if (auth.loading || loading) {
    return <div style={{ padding: 40, color: 'var(--fg-4)', fontSize: 13 }}>Loading…</div>;
  }

  const isLeadership = auth.level >= 3;
  const canSend      = message.trim() && (selected.size > 0 || (isLeadership && postToFM));

  return (
    <div style={{ maxWidth: tab === 'history' ? 1140 : 860, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--fg-0)', letterSpacing: '-0.02em', marginBottom: 4 }}>
          Faction Announcements
        </h1>
        <p style={{ fontSize: 13, color: 'var(--fg-3)', margin: 0 }}>
          {isLeadership
            ? `Send a message to any or all ${configurable.length} configured faction Discords.`
            : `Send a message to your team's ${configurable.length} configured faction Discord${configurable.length !== 1 ? 's' : ''}.`}
        </p>
        <DocBar authLevel={auth.level}
          links={[
            { title: 'Communications', label: 'Announcements Guide', minLevel: 1 },
            { title: 'Discord Channels & Routing', label: 'Leadership Announcements Guide', minLevel: 3 },
          ]} />
      </div>

      {/* Compose / History tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid var(--border)' }}>
        {[{ v: 'compose', l: 'Compose' }, { v: 'history', l: 'History' }].map(o => (
          <button key={o.v} onClick={() => setTab(o.v)}
            style={{ fontSize: 13, fontWeight: 600, padding: '8px 16px', cursor: 'pointer', border: 'none', background: 'none',
              color: tab === o.v ? 'var(--fg-0)' : 'var(--fg-3)', marginBottom: -1,
              borderBottom: `2px solid ${tab === o.v ? 'var(--accent)' : 'transparent'}` }}>
            {o.l}
          </button>
        ))}
      </div>

      {tab === 'history' ? (
        <HistoryView kind="announcement" />
      ) : (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>

        {/* ── Left: Composer ── */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
            color: 'var(--fg-4)', marginBottom: 8 }}>Message</div>

          {/* Preview of what will be sent */}
          <div style={{ marginBottom: 10, padding: '10px 14px', borderRadius: 8,
            background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', fontSize: 12, color: 'var(--fg-3)' }}>
            <span style={{ fontWeight: 700, color: 'var(--fg-1)' }}>A Message from Faction Management</span>
            {message.trim() && <><br /><br /><span style={{ color: 'var(--fg-2)', whiteSpace: 'pre-wrap' }}>{message.trim()}</span></>}
            {!message.trim() && <span style={{ color: 'var(--fg-4)', fontStyle: 'italic' }}><br /><br />Your message will appear here…</span>}
          </div>

          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Type your announcement here…"
            rows={8}
            style={{ width: '100%', resize: 'vertical', padding: '10px 12px', borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--bg-1)', color: 'var(--fg-0)',
              fontSize: 13, lineHeight: 1.6, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
          />

          {/* FM Discord checkbox — Leadership only */}
          {isLeadership && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={postToFM} onChange={e => setPostToFM(e.target.checked)}
                style={{ accentColor: 'var(--accent)', width: 14, height: 14 }} />
              <span style={{ fontSize: 12, color: 'var(--fg-2)', fontWeight: 500 }}>
                Also post in FM Discord
              </span>
              <span style={{ fontSize: 11, color: 'var(--fg-4)' }}>
                — pings <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>@Faction Management</span>
              </span>
            </label>
          )}

          <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={handleSend}
              disabled={sending || !canSend}
              style={{ fontSize: 13, fontWeight: 700, padding: '9px 22px', borderRadius: 7, cursor: 'pointer',
                background: 'var(--accent, #6366f1)', color: '#fff', border: 'none',
                opacity: (sending || !canSend) ? 0.45 : 1 }}>
              {sending ? 'Sending…' : (() => {
                const parts = [
                  selected.size > 0 && `${selected.size} faction${selected.size !== 1 ? 's' : ''} · ${channelLabel}`,
                  postToFM && 'FM Discord',
                ].filter(Boolean);
                return parts.length ? `Send → ${parts.join('  +  ')}` : 'Send';
              })()}
            </button>
          </div>

          {/* Result */}
          {result && (
            <div style={{ marginTop: 14, padding: '12px 16px', borderRadius: 8,
              background: result.ok ? 'rgba(52,211,153,0.08)' : 'rgba(239,68,68,0.08)',
              border: `1px solid ${result.ok ? 'rgba(52,211,153,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
              {result.ok ? (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#34d399', marginBottom: 4 }}>
                    {result.total > 0 && `✓ Sent to ${result.sent} of ${result.total} ${result.channelLabel || ''} channel${result.total !== 1 ? 's' : ''}`}
                    {result.postedToFM && `${result.total > 0 ? ' · ' : '✓ '}Posted in FM Discord with @Faction Management ping`}
                  </div>
                  {result.failed?.length > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--red)' }}>
                      Failed: {result.failed.map(f => `${f.name} (${f.reason || f.status})`).join(', ')}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--red)' }}>✗ {result.error}</div>
              )}
            </div>
          )}
        </div>

        {/* ── Right: Recipient selector ── */}
        <div>
          {/* Channel target toggle */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-4)', marginBottom: 8 }}>Send to</div>
            <div style={{ display: 'flex', gap: 4, padding: 3, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-1)' }}>
              {[{ v: 'command', l: 'Command' }, { v: 'faction', l: 'Faction-wide' }, { v: 'both', l: 'Both' }].map(o => (
                <button key={o.v} onClick={() => setChannelType(o.v)}
                  style={{ flex: 1, fontSize: 11, fontWeight: 700, padding: '6px 4px', borderRadius: 5, cursor: 'pointer', border: 'none',
                    background: channelType === o.v ? 'var(--accent, #6366f1)' : 'transparent',
                    color: channelType === o.v ? '#fff' : 'var(--fg-3)', transition: 'background 0.1s' }}>{o.l}</button>
              ))}
            </div>
            <div style={{ marginTop: 6, fontSize: 10, color: 'var(--fg-4)' }}>
              {channelType === 'command' && 'Leadership command channels only.'}
              {channelType === 'faction' && 'Whole-faction channels — visible to all members.'}
              {channelType === 'both' && 'Both command and faction-wide channels.'}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-4)' }}>
              Recipients
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={allSelected ? deselectAll : selectAll}
                style={{ fontSize: 10, padding: '3px 10px', borderRadius: 5, cursor: 'pointer',
                  border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg-3)' }}>
                {allSelected ? 'Deselect All' : 'Select All'}
              </button>
            </div>
          </div>

          <div style={{ borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden', background: 'var(--bg-1)' }}>
            {targets.length === 0 ? (
              <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 13, color: 'var(--fg-4)', fontStyle: 'italic' }}>
                No factions configured. Add servers in Bot Servers settings.
              </div>
            ) : (
              <>
                {configurable.map((t, i) => {
                  const tc = tierColor(t.tier);
                  const checked = selected.has(t.config_id);
                  return (
                    <div key={t.config_id}
                      onClick={() => toggle(t.config_id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px',
                        borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                        cursor: 'pointer', background: checked ? 'rgba(99,102,241,0.06)' : 'transparent',
                        transition: 'background 0.1s' }}>
                      <input type="checkbox" checked={checked} onChange={() => {}} style={{ flexShrink: 0, accentColor: 'var(--accent)' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-0)' }}>{t.name}</span>
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                            background: `${tc}18`, color: tc, border: `1px solid ${tc}30`,
                            fontFamily: 'var(--font-mono)' }}>T{t.tier}</span>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--fg-4)', marginTop: 1 }}>
                          {t.guild_name && <span>{t.guild_name} · </span>}
                          <span style={{ color: 'var(--fg-3)' }}>{chanSummary(t)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {unconfigured.length > 0 && (
                  <>
                    <div style={{ padding: '6px 14px', background: 'rgba(255,255,255,0.015)',
                      borderTop: '1px solid var(--border)', fontSize: 10, fontWeight: 700,
                      textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-4)' }}>
                      No {channelLabel} Channel Set
                    </div>
                    {unconfigured.map((t, i) => {
                      const tc = tierColor(t.tier);
                      return (
                        <div key={t.config_id}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px',
                            borderTop: '1px solid var(--border)', opacity: 0.45, cursor: 'not-allowed' }}>
                          <input type="checkbox" disabled style={{ flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-0)' }}>{t.name}</span>
                              <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                                background: `${tc}18`, color: tc, border: `1px solid ${tc}30`,
                                fontFamily: 'var(--font-mono)' }}>T{t.tier}</span>
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--fg-4)', marginTop: 1 }}>
                              {t.guild_name || 'No server name'} · Channel not configured
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </>
            )}
          </div>

          <div style={{ marginTop: 8, fontSize: 10, color: 'var(--fg-4)' }}>
            {selected.size} of {configurable.length} selected
            {unconfigured.length > 0 && ` · ${unconfigured.length} without a ${channelLabel} channel`}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
