"use client";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../../lib/useAuth";
import { useDialog } from "../../../../lib/useDialog";
import { getMeetingNotes, saveMeetingNote, deleteMeetingNote, getNoteTargets, getAttendeesForTarget } from "../actions";
import { s } from "../_shared/styles";
import LeadershipShell from "../_shared/Shell";
import QuillEditor from "../../../../lib/QuillEditor";
import { useDraft, loadDraft, clearDraft, isBlankDraft } from "../../../../lib/useDraft";

// A meeting-note draft is only worth keeping when the editor body has content.
const noteDraftBlank = (d) => isBlankDraft(d?.content);

// Strip HTML tags so the Quill note body can be plain-text searched.
const stripHtml = (h) => (h || '').replace(/<[^>]*>/g, ' ');

// Small colored pill describing what a note is about.
const TYPE_CHIP = {
  faction: { label: 'Faction', fg: 'var(--accent)', bg: 'var(--accent-bg)' },
  team:    { label: 'Team',    fg: 'var(--green)',  bg: 'var(--green-bg)'  },
  group:   { label: 'Group',   fg: 'var(--amber)',  bg: 'var(--amber-bg)'  },
};

export default function NotesPage() {
  const auth = useAuth();
  const { showConfirm, showAlert } = useDialog();
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [notes, setNotes]           = useState([]);
  const [editingNote, setEditingNote] = useState(null);
  const [expandedNote, setExpandedNote] = useState(null);
  const [noteTargets, setNoteTargets] = useState({ factions: [], teams: [], groups: [] });
  const [teamMembers, setTeamMembers]   = useState([]);
  const [attendance, setAttendance]     = useState({});
  const [content, setContent]           = useState('');
  const [newDraft, setNewDraft]         = useState(null);   // unsaved new-note draft from a previous session
  const [search, setSearch]             = useState('');
  const [sortBy, setSortBy]             = useState('recent'); // recent | oldest | faction

  const canAccess = !auth.loading && auth.level >= 1;

  // Autosave the in-progress note to localStorage on every keystroke so it
  // survives a reload/crash. New notes use one key; edits are keyed per note id.
  const draftKey = editingNote ? (editingNote.id ? `notes:edit:${editingNote.id}` : 'notes:new') : null;
  const draftValue = useMemo(
    () => ({ content, targetType: editingNote?.targetType ?? null, targetKey: editingNote?.targetKey ?? null }),
    [content, editingNote],
  );
  useDraft(draftKey, draftValue, { enabled: !!editingNote, blank: noteDraftBlank });

  // On load, surface any unsaved *new* note draft via a resume banner.
  useEffect(() => {
    const d = loadDraft('notes:new');
    if (d && !noteDraftBlank(d)) setNewDraft(d);
  }, []);

  // Search + sort the note list (defaults to most-recent first).
  const visibleNotes = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = notes;
    if (q) list = notes.filter(n =>
      (n.display_name || '').toLowerCase().includes(q) ||
      (n.author || '').toLowerCase().includes(q) ||
      stripHtml(n.content).toLowerCase().includes(q)
    );
    const out = [...list];
    if (sortBy === 'faction') out.sort((a, b) => (a.display_name || '').localeCompare(b.display_name || '') || (b.created_at || '').localeCompare(a.created_at || ''));
    else if (sortBy === 'oldest') out.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
    else out.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')); // recent
    return out;
  }, [notes, search, sortBy]);

  useEffect(() => {
    if (auth.loading || !canAccess) return;
    (async () => {
      setLoading(true);
      const [n, targets] = await Promise.all([getMeetingNotes(), getNoteTargets()]);
      setNotes(n);
      setNoteTargets(targets || { factions: [], teams: [], groups: [] });
      setLoading(false);
    })();
  }, [auth.loading, canAccess]);

  // Reload the attendance list whenever the selected target changes
  useEffect(() => {
    const { targetType, targetKey } = editingNote || {};
    if (!targetType || !targetKey) { setTeamMembers([]); setAttendance({}); return; }
    getAttendeesForTarget(targetType, targetKey).then(members => {
      setTeamMembers(members || []);
      const att = {};
      (members || []).forEach(m => { att[m.discord_id] = true; });
      setAttendance(att);
    }).catch(() => { setTeamMembers([]); setAttendance({}); });
  }, [editingNote?.targetType, editingNote?.targetKey]);

  const startNewNote = () => {
    setContent('');
    setTeamMembers([]);
    setAttendance({});
    setEditingNote({ id: null, targetType: null, targetKey: null });
  };

  const openEdit = (n) => {
    // Prefer an unsaved local draft for this note over the stored version.
    const d = loadDraft(`notes:edit:${n.id}`);
    setContent(d && !noteDraftBlank(d) ? d.content : (n.content || ''));
    setTeamMembers([]);
    setAttendance({});
    const targetType = n.target_type || 'faction';
    const targetKey  = targetType === 'faction' ? String(n.faction_id) : String(n.target_key);
    setEditingNote({ id: n.id, targetType, targetKey });
  };

  // Resume a new-note draft recovered after a reload/crash.
  const resumeDraft = () => {
    if (!newDraft) return;
    setContent(newDraft.content || '');
    setTeamMembers([]);
    setAttendance({});
    setEditingNote({ id: null, targetType: newDraft.targetType || null, targetKey: newDraft.targetKey || null });
    setNewDraft(null);
  };

  const handleTargetChange = (val) => {
    setTeamMembers([]);
    setAttendance({});
    if (!val) { setEditingNote(e => ({ ...e, targetType: null, targetKey: null })); return; }
    const idx = val.indexOf(':');
    const type = val.slice(0, idx);
    const key  = val.slice(idx + 1);
    setEditingNote(e => ({ ...e, targetType: type, targetKey: key }));
  };

  const saveNote = async () => {
    if (!editingNote.targetType || !editingNote.targetKey) { showAlert('Please select a faction, team, or group.'); return; }
    setSaving(true);
    const attendeeIds = teamMembers.filter(m => attendance[m.discord_id]).map(m => m.discord_id);
    await saveMeetingNote({ id: editingNote.id, targetType: editingNote.targetType, targetKey: editingNote.targetKey, content, attendeeIds });
    clearDraft(editingNote.id ? `notes:edit:${editingNote.id}` : 'notes:new');
    setNewDraft(null);
    setSaving(false);
    setEditingNote(null);
    setContent('');
    setTeamMembers([]);
    setAttendance({});
    setNotes(await getMeetingNotes());
  };

  const cancel = () => {
    setEditingNote(null);
    setContent('');
    setTeamMembers([]);
    setAttendance({});
  };

  const selValue = editingNote?.targetType && editingNote?.targetKey
    ? `${editingNote.targetType}:${editingNote.targetKey}`
    : '';

  if (auth.loading) return <div className="p-10 text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading...</div>;
  if (!canAccess)   return <div className="p-10 text-sm" style={{color:'var(--red)'}}>Access denied.</div>;

  return (
    <LeadershipShell title="Meeting Notes" section="Communications" accent="var(--accent)" headerBg="rgba(160,126,245,0.06)" subtitle={auth.level >= 3 ? 'All teams' : 'Your team & factions'} docs={[{"title":"OOC Meetings","label":"Meeting Notes Guide","minLevel":2}]} level={auth.level}>

      {loading && <div className="text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading...</div>}

      {/* ── Note list ── */}
      {!loading && !editingNote && (
        <div>
          {newDraft && (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap',
              padding:'10px 14px', borderRadius:10, marginBottom:12, background:'var(--amber-bg)', border:'1px solid var(--amber)' }}>
              <span style={{ fontSize:12, fontWeight:600, color:'var(--amber)' }}>
                You have an unsaved meeting note from a previous session.
              </span>
              <div style={{ display:'flex', gap:8 }}>
                <button style={s.btn} onClick={resumeDraft}>Resume</button>
                <button style={s.btnGhost} onClick={() => { clearDraft('notes:new'); setNewDraft(null); }}>Discard</button>
              </div>
            </div>
          )}
          <div className="flex justify-between items-center mb-3">
            <div className="text-sm font-bold">Meeting Notes</div>
            <button style={s.btn} onClick={startNewNote}>+ New Meeting</button>
          </div>
          {notes.length > 0 && (
            <div className="flex gap-2 items-center mb-3 flex-wrap">
              <input
                style={{ ...s.input, flex: '1', minWidth: 200, maxWidth: 360 }}
                placeholder="Search by faction, author, or content…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <select style={{ ...s.input, width: 'auto', cursor: 'pointer' }} value={sortBy} onChange={e => setSortBy(e.target.value)}>
                <option value="recent">Most recent</option>
                <option value="oldest">Oldest first</option>
                <option value="faction">Faction (A–Z)</option>
              </select>
              <div className="text-[10px] font-mono" style={{ color: 'var(--fg-4)', marginLeft: 'auto' }}>
                {visibleNotes.length} note{visibleNotes.length !== 1 ? 's' : ''}
              </div>
            </div>
          )}
          <div className="space-y-2">
            {visibleNotes.map(n => {
              const chip = TYPE_CHIP[n.target_type] || TYPE_CHIP.faction;
              return (
              <div key={n.id} className="rounded-xl overflow-hidden group" style={{background:'var(--bg-1)', border: expandedNote===n.id ? '1px solid var(--accent)' : '1px solid var(--border)'}}>
                <div className="flex justify-between items-start gap-3 p-4 cursor-pointer" onClick={() => setExpandedNote(expandedNote===n.id ? null : n.id)}>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold flex items-center gap-2">
                      <span style={{fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', color:chip.fg, background:chip.bg, border:`1px solid ${chip.fg}`, borderRadius:6, padding:'1px 6px'}}>{chip.label}</span>
                      <span className="truncate">{n.display_name}</span>
                    </div>
                    <div className="text-[10px]" style={{color:'var(--fg-4)'}}>{n.author} · {n.created_at?.substring(0,16)}</div>
                  </div>
                  <div className="flex gap-2 items-center shrink-0">
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100" onClick={e => e.stopPropagation()}>
                      <button onClick={() => openEdit(n)} style={{fontSize:10,color:'var(--accent)',background:'none',border:'none',cursor:'pointer',fontWeight:700}}>Edit</button>
                      <button onClick={async () => { if (await showConfirm('Delete note?')) { await deleteMeetingNote(n.id); setNotes(await getMeetingNotes()); }}} style={{fontSize:10,color:'var(--red)',background:'none',border:'none',cursor:'pointer',fontWeight:700}}>Del</button>
                    </div>
                    <span style={{color:'var(--fg-4)',transform:expandedNote===n.id?'rotate(180deg)':'none',transition:'transform 0.15s',fontSize:11}}>▼</span>
                  </div>
                </div>
                {expandedNote === n.id && (
                  <div className="px-4 pb-4 pt-2 quill-content" style={{borderTop:'1px solid var(--border)'}} dangerouslySetInnerHTML={{__html: n.content || '<em style="color:var(--fg-4)">No content</em>'}} />
                )}
              </div>
              );
            })}
            {notes.length === 0 && <div className="text-center py-10 text-sm" style={{color:'var(--fg-4)'}}>No meeting notes yet.</div>}
            {notes.length > 0 && visibleNotes.length === 0 && <div className="text-center py-10 text-sm" style={{color:'var(--fg-4)'}}>No notes match your search.</div>}
          </div>
        </div>
      )}

      {/* ── Editor ── */}
      {!loading && editingNote && (
        <div style={{display:'flex', flexDirection:'column', gap:16}}>

          {/* Top row: target + attendance */}
          <div style={{display:'grid', gridTemplateColumns: teamMembers.length > 0 ? '1fr 1fr' : '1fr', gap:16, alignItems:'start'}}>

            {/* Target selector */}
            <div>
              <div style={s.label}>Meeting Subject *</div>
              <select
                style={s.input}
                value={selValue}
                onChange={e => handleTargetChange(e.target.value)}
              >
                <option value="">Select faction, team, or group…</option>
                {noteTargets.factions.length > 0 && (
                  <optgroup label="Factions">
                    {noteTargets.factions.map(f => <option key={`faction:${f.id}`} value={`faction:${f.id}`}>{f.name}</option>)}
                  </optgroup>
                )}
                {noteTargets.teams.length > 0 && (
                  <optgroup label="FM Teams">
                    {noteTargets.teams.map(t => <option key={`team:${t.team_id}`} value={`team:${t.team_id}`}>{t.team_name}</option>)}
                  </optgroup>
                )}
                {noteTargets.groups.length > 0 && (
                  <optgroup label="Staff Groups">
                    {noteTargets.groups.map(g => <option key={`group:${g.key}`} value={`group:${g.key}`}>{g.label}</option>)}
                  </optgroup>
                )}
              </select>
              {!editingNote.targetKey && (
                <div style={{fontSize:11, color:'var(--fg-4)', marginTop:6}}>Select a faction, team, or group to load the attendance list.</div>
              )}
            </div>

            {/* Attendance */}
            {teamMembers.length > 0 && (
              <div>
                <div style={s.label}>Attendance</div>
                <div style={{display:'flex', flexDirection:'column', gap:4}}>
                  {teamMembers.map(m => (
                    <label key={m.discord_id} style={{
                      display:'flex', alignItems:'center', gap:8, cursor:'pointer',
                      padding:'6px 12px', borderRadius:8,
                      background: attendance[m.discord_id] ? 'rgba(160,126,245,0.12)' : 'var(--bg-2)',
                      border: `1px solid ${attendance[m.discord_id] ? 'var(--accent)' : 'var(--border)'}`,
                      fontSize:12, fontWeight: attendance[m.discord_id] ? 600 : 400,
                      color: attendance[m.discord_id] ? 'var(--accent)' : 'var(--fg-3)',
                      userSelect:'none',
                    }}>
                      <input
                        type="checkbox"
                        checked={attendance[m.discord_id] || false}
                        onChange={() => setAttendance(a => ({...a, [m.discord_id]: !a[m.discord_id]}))}
                      />
                      <span style={{flex:1}}>{m.display_name}</span>
                      <span style={{fontSize:9, color:'var(--fg-4)'}}>{m.rank}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Quill editor */}
          <div>
            <div style={s.label}>Meeting Notes</div>
            <QuillEditor value={content} onChange={setContent} placeholder="Document the meeting…" />
          </div>

          {/* Actions */}
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:8}}>
            <button style={s.btnGhost} onClick={cancel}>Cancel</button>
            <span style={{fontSize:10, color:'var(--fg-4)', fontFamily:'var(--font-mono)'}}>Draft auto-saved</span>
            <button style={{...s.btn, opacity: saving ? 0.5 : 1}} onClick={saveNote} disabled={saving}>
              {saving ? 'Saving…' : 'Save Meeting Notes'}
            </button>
          </div>

        </div>
      )}
    </LeadershipShell>
  );
}
