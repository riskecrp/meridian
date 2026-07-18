"use client";
import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useAuth } from "../../../../lib/useAuth";
import { getAnnouncementTargets, sendICCommunication, uploadToImgbb } from "../actions";
import { DocBar } from "../../../../lib/SopLink";
import HistoryView from "../HistoryView";

function tierColor(t) {
  if (t >= 6) return '#f1f5f9'; if (t >= 5) return '#c8d3e0';
  if (t >= 4) return '#a78bfa'; if (t >= 3) return '#60a5fa';
  if (t >= 2) return '#4ade80'; return '#94a3b8';
}

export default function ICCommunicationsPage() {
  const auth = useAuth();
  const [targets, setTargets]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [link, setLink]           = useState('');
  const [message, setMessage]     = useState('');
  const [channelType, setChannelType] = useState('command');
  const [sending, setSending]     = useState(false);
  const [result, setResult]       = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState('');
  const [dragging, setDragging]   = useState(false);
  const [tab, setTab]             = useState('compose');
  const fileInputRef = useRef(null);

  const processFile = useCallback(async (file) => {
    if (!file || !file.type.startsWith('image/')) { setUploadErr('Please select an image file.'); return; }
    setUploading(true); setUploadErr(''); setLink('');
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target.result.split(',')[1];
      const res = await uploadToImgbb(base64, file.name);
      setUploading(false);
      if (res.ok) { setLink(res.url); }
      else { setUploadErr(res.error || 'Upload failed.'); }
    };
    reader.readAsDataURL(file);
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  useEffect(() => {
    if (auth.loading || (auth.level < 1 && !auth.isLeadStoryteller)) return;
    getAnnouncementTargets().then(t => { setTargets(t || []); setLoading(false); });
  }, [auth.loading, auth.level]);

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

  const configurable = useMemo(() => targets.filter(hasChan), [targets, channelType]);
  const unconfigured = useMemo(() => targets.filter(t => !hasChan(t)), [targets, channelType]);
  const allSelected  = configurable.length > 0 && configurable.every(t => selected.has(t.config_id));

  // Prune selections whose channel isn't set once the target type narrows.
  useEffect(() => {
    setSelected(prev => new Set([...prev].filter(id => targets.some(t => t.config_id === id && hasChan(t)))));
  }, [channelType]);

  const toggle      = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAll   = () => setSelected(new Set(configurable.map(t => t.config_id)));
  const deselectAll = () => setSelected(new Set());

  const handleSend = async () => {
    if (!link.trim() || !selected.size) return;
    setSending(true);
    setResult(null);
    const res = await sendICCommunication([...selected], link, message, channelType);
    setSending(false);
    setResult(res);
    if (res.ok && res.sent > 0) {
      setLink('');
      setMessage('');
      setSelected(new Set());
    }
  };

  if (auth.loading || loading) {
    return <div style={{ padding: 40, color: 'var(--fg-4)', fontSize: 13 }}>Loading…</div>;
  }

  const isLeadership = auth.level >= 3;

  return (
    <div style={{ maxWidth: tab === 'history' ? 1140 : 860, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--fg-0)', letterSpacing: '-0.02em', marginBottom: 4 }}>
          IC Communication
        </h1>
        <p style={{ fontSize: 13, color: 'var(--fg-3)', margin: 0 }}>
          {isLeadership
            ? `Send IC content to any or all ${configurable.length} configured faction Discords.`
            : `Send IC content to your team's ${configurable.length} configured faction Discord${configurable.length !== 1 ? 's' : ''}.`}
          {' '}A copy of the link is always posted in the FM IC channel.
        </p>
        <DocBar authLevel={auth.level} links={[{ title: 'Communications', label: 'IC Communication Guide', minLevel: 1 }]} />
      </div>

      {/* Compose / History tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid var(--border)' }}>
        {[{ v: 'compose', l: 'Compose' }, { v: 'history', l: 'History' }].map(o => (
          <button key={o.v} onClick={() => setTab(o.v)}
            style={{ fontSize: 13, fontWeight: 600, padding: '8px 16px', cursor: 'pointer', border: 'none', background: 'none',
              color: tab === o.v ? 'var(--fg-0)' : 'var(--fg-3)', marginBottom: -1,
              borderBottom: `2px solid ${tab === o.v ? '#60a5fa' : 'transparent'}` }}>
            {o.l}
          </button>
        ))}
      </div>

      {tab === 'history' ? (
        <HistoryView kind="ic" />
      ) : (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>

        {/* ── Left: Composer ── */}
        <div>
          {/* Image upload */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
              color: 'var(--fg-4)', marginBottom: 8 }}>Image <span style={{ color: 'var(--red)', fontWeight: 400 }}>*</span></div>

            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => !uploading && fileInputRef.current?.click()}
              style={{ padding: '20px 16px', borderRadius: 8, textAlign: 'center', cursor: uploading ? 'wait' : 'pointer',
                border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border)'}`,
                background: dragging ? 'rgba(99,102,241,0.06)' : 'var(--bg-1)',
                transition: 'border-color 0.15s, background 0.15s' }}>
              <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = ''; }} />
              {uploading ? (
                <div style={{ fontSize: 13, color: 'var(--accent)' }}>Uploading to imgbb…</div>
              ) : link ? (
                <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
                  ✓ Uploaded — click or drop to replace
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 13, color: 'var(--fg-2)', marginBottom: 4 }}>
                    Drop image here or <span style={{ color: 'var(--accent)', fontWeight: 600 }}>click to browse</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--fg-4)' }}>PNG, JPG, GIF, WEBP</div>
                </div>
              )}
            </div>

            {uploadErr && (
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--red)' }}>✗ {uploadErr}</div>
            )}

            {/* Image preview */}
            {link && (
              <div style={{ marginTop: 8, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)',
                background: 'var(--bg-1)', maxHeight: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={link} alt="Preview" onError={e => e.target.style.display='none'}
                  style={{ maxWidth: '100%', maxHeight: 220, objectFit: 'contain', display: 'block' }} />
                <button
                  onClick={e => { e.stopPropagation(); setLink(''); setUploadErr(''); }}
                  style={{ position: 'absolute', top: 6, right: 6, fontSize: 10, padding: '2px 8px', borderRadius: 4,
                    background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', cursor: 'pointer' }}>
                  Remove
                </button>
              </div>
            )}
          </div>

          {/* Message field */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
              color: 'var(--fg-4)', marginBottom: 8 }}>Message <span style={{ color: 'var(--fg-4)', fontWeight: 400 }}>(optional)</span></div>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Optional accompanying message…"
              rows={5}
              style={{ width: '100%', resize: 'vertical', padding: '10px 12px', borderRadius: 8,
                border: '1px solid var(--border)', background: 'var(--bg-1)', color: 'var(--fg-0)',
                fontSize: 13, lineHeight: 1.6, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
            />
          </div>

          {/* What gets posted preview */}
          <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8,
            background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
              color: 'var(--fg-4)', marginBottom: 6 }}>Posted in faction channels</div>
            <div style={{ fontSize: 12, color: 'var(--fg-2)', wordBreak: 'break-word' }}>
              <span style={{ fontWeight: 700, color: 'var(--fg-1)' }}>A Message from Meridian</span>
              {message.trim() && <><br /><br /><span style={{ color: 'var(--fg-2)', whiteSpace: 'pre-wrap' }}>{message.trim()}</span></>}
              {link.trim()
                ? <><br /><br /><span style={{ fontStyle: 'italic', color: 'var(--fg-4)' }}>[image renders here]</span></>
                : <><br /><br /><span style={{ fontStyle: 'italic', color: 'var(--fg-4)' }}>Paste a link above to attach an image</span></>}
            </div>
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)',
              fontSize: 10, color: 'var(--fg-4)' }}>
              FM IC channel receives: link only
            </div>
          </div>

          <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              onClick={handleSend}
              disabled={sending || !link.trim() || !selected.size}
              style={{ fontSize: 13, fontWeight: 700, padding: '9px 22px', borderRadius: 7, cursor: 'pointer',
                background: 'rgba(96,165,250,0.85)', color: '#fff', border: 'none',
                opacity: (sending || !link.trim() || !selected.size) ? 0.45 : 1 }}>
              {sending ? 'Sending…' : `Send → ${selected.size} faction${selected.size !== 1 ? 's' : ''} · ${channelLabel}`}
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
                    ✓ Sent to {result.sent} of {result.total} {result.channelLabel || ''} channel{result.total !== 1 ? 's' : ''} · Link copied to FM IC channel
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
                    background: channelType === o.v ? 'rgba(96,165,250,0.85)' : 'transparent',
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
            <button onClick={allSelected ? deselectAll : selectAll}
              style={{ fontSize: 10, padding: '3px 10px', borderRadius: 5, cursor: 'pointer',
                border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg-3)' }}>
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>
          </div>

          <div style={{ borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden', background: 'var(--bg-1)' }}>
            {targets.length === 0 ? (
              <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 13, color: 'var(--fg-4)', fontStyle: 'italic' }}>
                No factions configured. Add comms channels in Bot Servers settings.
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
                        cursor: 'pointer', background: checked ? 'rgba(96,165,250,0.06)' : 'transparent',
                        transition: 'background 0.1s' }}>
                      <input type="checkbox" checked={checked} onChange={() => {}} style={{ flexShrink: 0, accentColor: '#60a5fa' }} />
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
                    {unconfigured.map(t => {
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
