"use client";
import { useEffect, useState, useMemo, useCallback } from "react";
import { useAuth } from "../../../../lib/useAuth";
import { useDialog } from "../../../../lib/useDialog";
import { getStaffList, getStaffActivity, getTeamList, getFactionAssignments, addStaff, updateStaff, removeStaff, createTeam, renameTeam, deleteTeam, commitAllChanges, getAllStaffCOI, getMeridianFactions, addStaffCOI, removeStaffCOI, getStaffFactions, retireStaff, promoteToLead, takeoverTeam, getDashboardAccessList, grantDashboardAccess, revokeDashboardAccess } from "./actions";

const btn  = { background:'var(--accent)', color:'white', border:'none', padding:'6px 14px', borderRadius:8, fontSize:11, fontWeight:700, cursor:'pointer', letterSpacing:'0.03em' };
const ghost = { background:'transparent', color:'var(--fg-2)', border:'1px solid var(--border)', padding:'6px 14px', borderRadius:8, fontSize:11, fontWeight:600, cursor:'pointer' };
const micro = { background:'none', border:'none', cursor:'pointer', fontSize:10, fontWeight:600, padding:'2px 5px', borderRadius:4 };

// ── COI Modal ──────────────────────────────────────────────────────────────
function COIModal({ staff, coiEntries, meridianFactions, onAdd, onRemove, onClose }) {
  const [selectedMeridian, setSelectedMeridian] = useState('');
  const [manualEntry, setManualEntry]           = useState('');
  const [adding, setAdding]                     = useState(false);

  const entries = coiEntries.filter(e => e.discord_id === staff.discord_id);

  const handleAdd = async (name, source) => {
    if (!name?.trim()) return;
    setAdding(true);
    await onAdd(staff.discord_id, name.trim(), source);
    setSelectedMeridian(''); setManualEntry('');
    setAdding(false);
  };

  return (
    <div style={{ position:'fixed', inset:0, zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', backdropFilter:'blur(8px)' }} onClick={onClose} />
      <div style={{ position:'relative', width:'100%', maxWidth:480, background:'var(--bg-1)', border:'1px solid var(--border)', borderRadius:16, overflow:'hidden', zIndex:1 }}>
        <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.12em', color:'var(--amber)', marginBottom:2 }}>⚠ Conflict of Interest</div>
            <div style={{ fontSize:15, fontWeight:700, color:'var(--fg-0)' }}>{staff.display_name}</div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--fg-4)', fontSize:20, cursor:'pointer', lineHeight:1 }}>✕</button>
        </div>
        <div style={{ padding:20, display:'flex', flexDirection:'column', gap:16 }}>
          <div>
            <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.12em', color:'var(--fg-4)', marginBottom:8 }}>Flagged Factions</div>
            {entries.length === 0 ? (
              <div style={{ fontSize:12, color:'var(--fg-4)', fontStyle:'italic' }}>None set.</div>
            ) : (
              <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                {entries.map(e => (
                  <div key={e.id} style={{ display:'flex', alignItems:'center', gap:5, padding:'4px 10px', borderRadius:6, background:'rgba(251,191,36,0.1)', border:'1px solid rgba(251,191,36,0.25)' }}>
                    <span style={{ fontSize:12, color:'var(--amber)' }}>{e.faction_name}</span>
                    {e.source === 'manual' && <span style={{ fontSize:9, color:'var(--fg-4)', fontFamily:'var(--font-mono)' }}>manual</span>}
                    <button onClick={() => onRemove(e.id)} style={{ background:'none', border:'none', color:'var(--fg-4)', cursor:'pointer', fontSize:14, lineHeight:1, padding:'0 2px' }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.12em', color:'var(--fg-4)', marginBottom:6 }}>Add from Meridian Factions</div>
            <div style={{ display:'flex', gap:8 }}>
              <select style={{ flex:1, background:'var(--bg-2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 12px', fontSize:12, color:'var(--fg-1)', outline:'none' }} value={selectedMeridian} onChange={e => setSelectedMeridian(e.target.value)}>
                <option value=''>Select faction…</option>
                {meridianFactions.filter(f => !entries.some(e => e.faction_name.toLowerCase() === f.name.toLowerCase())).map(f => <option key={f.id} value={f.name}>{f.name} (T{f.tier})</option>)}
              </select>
              <button onClick={() => handleAdd(selectedMeridian, 'meridian')} disabled={!selectedMeridian || adding} style={{ padding:'8px 14px', borderRadius:8, background:'var(--accent)', color:'#fff', border:'none', fontSize:11, fontWeight:700, cursor:'pointer', opacity:(!selectedMeridian||adding)?0.4:1 }}>Add</button>
            </div>
          </div>
          <div>
            <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.12em', color:'var(--fg-4)', marginBottom:6 }}>Add Other Faction (Manual)</div>
            <div style={{ display:'flex', gap:8 }}>
              <input style={{ flex:1, background:'var(--bg-2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 12px', fontSize:12, color:'var(--fg-1)', outline:'none' }} placeholder="Faction name…" value={manualEntry} onChange={e => setManualEntry(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAdd(manualEntry, 'manual')} />
              <button onClick={() => handleAdd(manualEntry, 'manual')} disabled={!manualEntry.trim() || adding} style={{ padding:'8px 14px', borderRadius:8, background:'var(--amber)', color:'#000', border:'none', fontSize:11, fontWeight:700, cursor:'pointer', opacity:(!manualEntry.trim()||adding)?0.4:1 }}>Add</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Retire Modal ──────────────────────────────────────────────────────────
function RetireModal({ member, allStaff, onConfirm, onClose }) {
  const [factions,  setFactions]  = useState(null);
  const [assignments, setAssignments] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getStaffFactions(member.discord_id).then(f => {
      setFactions(f);
      const init = {};
      f.forEach(faction => { init[faction.id] = ''; });
      setAssignments(init);
    });
  }, [member.discord_id]);

  const otherStaff = allStaff.filter(s => s.discord_id !== member.discord_id);

  const handleConfirm = async () => {
    setSaving(true);
    const reassignments = (factions || []).map(f => ({
      factionId: f.id,
      newLeadId: assignments[f.id] || '',
    }));
    await onConfirm(reassignments);
    setSaving(false);
  };

  return (
    <div style={{ position:'fixed', inset:0, zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', backdropFilter:'blur(8px)' }} onClick={onClose} />
      <div style={{ position:'relative', width:'100%', maxWidth:520, background:'var(--bg-1)', border:'1px solid rgba(248,113,113,0.3)', borderRadius:16, overflow:'hidden', zIndex:1 }}>

        {/* Header */}
        <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.12em', color:'var(--red)', marginBottom:2 }}>Retire Staff</div>
            <div style={{ fontSize:16, fontWeight:700, color:'var(--fg-0)' }}>{member.display_name}</div>
            <div style={{ fontSize:11, color:'var(--fg-3)', marginTop:2 }}>{member.rank} · {member.team_name}</div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--fg-4)', fontSize:20, cursor:'pointer' }}>✕</button>
        </div>

        <div style={{ padding:20, display:'flex', flexDirection:'column', gap:16 }}>
          <div style={{ fontSize:12, color:'var(--fg-3)', lineHeight:1.6, padding:'10px 14px', borderRadius:8, background:'rgba(248,113,113,0.06)', border:'1px solid rgba(248,113,113,0.15)' }}>
            Removing <strong style={{color:'var(--fg-1)'}}>{member.display_name}</strong> from active staff.
            All historical data (scenes, notes, logs) remains attributed to them.
          </div>

          {/* Faction reassignment */}
          {factions === null ? (
            <div style={{ fontSize:12, color:'var(--fg-4)', fontStyle:'italic' }}>Loading factions…</div>
          ) : factions.length === 0 ? (
            <div style={{ fontSize:12, color:'var(--fg-4)', fontStyle:'italic' }}>No active factions to reassign.</div>
          ) : (
            <div>
              <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'var(--amber)', marginBottom:10 }}>
                Reassign Factions ({factions.length})
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {factions.map(f => (
                  <div key={f.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:8, background:'var(--bg-2)', border:'1px solid var(--border)' }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12, fontWeight:600, color:'var(--fg-1)' }}>{f.name}</div>
                      <div style={{ fontSize:9, color:'var(--fg-4)', fontFamily:'var(--font-mono)' }}>Tier {f.tier}</div>
                    </div>
                    <select
                      value={assignments[f.id] || ''}
                      onChange={e => setAssignments(prev => ({ ...prev, [f.id]: e.target.value }))}
                      style={{ background:'var(--bg-0)', border:'1px solid var(--border)', borderRadius:6, padding:'5px 8px', fontSize:11, color:'var(--fg-1)', outline:'none', minWidth:140 }}
                    >
                      <option value=''>Leave unassigned</option>
                      {otherStaff.map(s => (
                        <option key={s.discord_id} value={s.discord_id}>
                          {s.display_name} ({s.rank})
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display:'flex', gap:8, justifyContent:'flex-end', paddingTop:4 }}>
            <button onClick={onClose} style={{ ...ghost }}>Cancel</button>
            <button
              onClick={handleConfirm}
              disabled={saving || factions === null}
              style={{ ...btn, background:'var(--red)', opacity:(saving||factions===null)?0.5:1 }}
            >
              {saving ? 'Retiring…' : 'Confirm Retirement'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Promote Modal ─────────────────────────────────────────────────────────
function PromoteModal({ member, teams, staff, onConfirm, onTakeover, onClose }) {
  const [mode, setMode] = useState(null); // null | 'create' | 'takeover'

  // Create mode
  const [newTeamName, setNewTeamName] = useState(`Team ${member.display_name}`);

  // Takeover mode
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [disposition, setDisposition]       = useState('guide'); // 'guide' | 'retire'
  const [takeoverTeamName, setTakeoverTeamName] = useState('');

  const [saving, setSaving] = useState(false);

  const currentLead = staff.find(s => s.team_id === selectedTeamId && s.rank?.toLowerCase().includes('lead'));

  useEffect(() => {
    if (!selectedTeamId) { setTakeoverTeamName(''); return; }
    const teamObj = teams.find(t => t.id === selectedTeamId);
    setTakeoverTeamName(teamObj?.name || '');
    setDisposition('guide');
  }, [selectedTeamId]);

  const handleCreateConfirm = async () => {
    setSaving(true);
    await onConfirm(newTeamName);
    setSaving(false);
  };

  const handleTakeoverConfirm = async () => {
    setSaving(true);
    await onTakeover({
      existingTeamId: selectedTeamId,
      oldLeadStaffId: currentLead?.id || null,
      oldLeadDiscordId: currentLead?.discord_id || null,
      oldLeadStaffName: currentLead?.display_name || null,
      disposition: currentLead ? disposition : null,
      newTeamName: takeoverTeamName,
    });
    setSaving(false);
  };

  const canTakeover = selectedTeamId && takeoverTeamName.trim() && !saving;

  return (
    <div style={{ position:'fixed', inset:0, zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', backdropFilter:'blur(8px)' }} onClick={onClose} />
      <div style={{ position:'relative', width:'100%', maxWidth: mode === 'takeover' ? 520 : 440, background:'var(--bg-1)', border:'1px solid rgba(74,222,128,0.25)', borderRadius:16, overflow:'hidden', zIndex:1 }}>

        {/* Header */}
        <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.12em', color:'var(--green)', marginBottom:2 }}>Promote to Lead</div>
            <div style={{ fontSize:16, fontWeight:700, color:'var(--fg-0)' }}>{member.display_name}</div>
            <div style={{ fontSize:11, color:'var(--fg-3)', marginTop:2 }}>Guide → Team Lead · Clearance L1 → L2</div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--fg-4)', fontSize:20, cursor:'pointer' }}>✕</button>
        </div>

        <div style={{ padding:20, display:'flex', flexDirection:'column', gap:16, maxHeight:'80vh', overflowY:'auto' }} className="scr">

          {/* ── Step 1: mode picker ── */}
          {!mode && (
            <>
              <div style={{ fontSize:12, color:'var(--fg-3)', lineHeight:1.6 }}>
                Is <strong style={{ color:'var(--fg-1)' }}>{member.display_name}</strong> starting a brand-new team, or taking over an existing one?
              </div>
              <div style={{ display:'flex', gap:10 }}>
                <button
                  onClick={() => setMode('create')}
                  style={{ flex:1, padding:'16px 10px', borderRadius:10, background:'rgba(74,222,128,0.07)', border:'1px solid rgba(74,222,128,0.3)', color:'var(--green)', fontSize:12, fontWeight:700, cursor:'pointer', lineHeight:1.4 }}
                >
                  + Create New Team
                </button>
                <button
                  onClick={() => setMode('takeover')}
                  style={{ flex:1, padding:'16px 10px', borderRadius:10, background:'rgba(160,126,245,0.07)', border:'1px solid rgba(160,126,245,0.3)', color:'var(--accent)', fontSize:12, fontWeight:700, cursor:'pointer', lineHeight:1.4 }}
                >
                  ↗ Take Over Existing Team
                </button>
              </div>
            </>
          )}

          {/* ── Create New Team ── */}
          {mode === 'create' && (
            <>
              <div>
                <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'var(--fg-4)', marginBottom:6 }}>Team Name</div>
                <input
                  value={newTeamName}
                  onChange={e => setNewTeamName(e.target.value)}
                  autoFocus
                  style={{ width:'100%', background:'var(--bg-2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 12px', fontSize:13, color:'var(--fg-1)', outline:'none', fontWeight:600 }}
                  placeholder="Team Name…"
                />
                <div style={{ fontSize:10, color:'var(--fg-4)', marginTop:4 }}>This renames their current team — leave as-is if the name isn't changing.</div>
              </div>
              <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
                <button onClick={() => setMode(null)} style={{ ...ghost }}>← Back</button>
                <button onClick={onClose} style={{ ...ghost }}>Cancel</button>
                <button onClick={handleCreateConfirm} disabled={saving || !newTeamName.trim()} style={{ ...btn, background:'var(--green)', color:'#000', opacity:(saving||!newTeamName.trim())?0.5:1 }}>
                  {saving ? 'Promoting…' : 'Promote ✓'}
                </button>
              </div>
            </>
          )}

          {/* ── Take Over Existing Team ── */}
          {mode === 'takeover' && (
            <>
              {/* Team picker */}
              <div>
                <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'var(--fg-4)', marginBottom:6 }}>Team to Take Over</div>
                <select
                  value={selectedTeamId}
                  onChange={e => setSelectedTeamId(e.target.value)}
                  style={{ width:'100%', background:'var(--bg-2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 12px', fontSize:12, color: selectedTeamId ? 'var(--fg-1)' : 'var(--fg-4)', outline:'none' }}
                >
                  <option value=''>Select a team…</option>
                  {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>

              {selectedTeamId && (
                <>
                  {/* Old lead disposition */}
                  {currentLead ? (
                    <div style={{ padding:'14px', borderRadius:10, background:'rgba(248,113,113,0.05)', border:'1px solid rgba(248,113,113,0.2)', display:'flex', flexDirection:'column', gap:10 }}>
                      <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'var(--red)' }}>
                        Current Lead — {currentLead.display_name}
                      </div>
                      <div style={{ fontSize:11, color:'var(--fg-3)', lineHeight:1.5 }}>
                        All their factions and the team Discord role will be automatically transferred to <strong style={{ color:'var(--fg-1)' }}>{member.display_name}</strong>. What happens to {currentLead.display_name}?
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                        {[
                          { value:'guide', label:'Return to Guide', desc:'Stays on roster · moved to Unassigned' },
                          { value:'retire', label:'Leaving FM',     desc:'Fully retired from the staff roster' },
                        ].map(opt => (
                          <label
                            key={opt.value}
                            style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'8px 10px', borderRadius:8, background: disposition===opt.value ? 'rgba(255,255,255,0.05)' : 'transparent', border:`1px solid ${disposition===opt.value ? 'rgba(255,255,255,0.12)' : 'transparent'}`, cursor:'pointer' }}
                          >
                            <input type='radio' name='disposition' value={opt.value} checked={disposition===opt.value} onChange={() => setDisposition(opt.value)} style={{ marginTop:3, accentColor:'var(--accent)', flexShrink:0 }} />
                            <div>
                              <div style={{ fontSize:12, fontWeight:600, color:'var(--fg-1)' }}>{opt.label}</div>
                              <div style={{ fontSize:10, color:'var(--fg-4)' }}>{opt.desc}</div>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize:11, color:'var(--fg-4)', fontStyle:'italic', padding:'10px 14px', borderRadius:8, background:'var(--bg-2)', border:'1px solid var(--border)' }}>
                      No current lead on this team.
                    </div>
                  )}

                  {/* Team rename */}
                  <div>
                    <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'var(--fg-4)', marginBottom:6 }}>Team Name</div>
                    <input
                      value={takeoverTeamName}
                      onChange={e => setTakeoverTeamName(e.target.value)}
                      style={{ width:'100%', background:'var(--bg-2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 12px', fontSize:13, color:'var(--fg-1)', outline:'none', fontWeight:600 }}
                      placeholder="Team name…"
                    />
                    <div style={{ fontSize:10, color:'var(--fg-4)', marginTop:4 }}>Edit to rename the team, or leave as-is.</div>
                  </div>
                </>
              )}

              <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
                <button onClick={() => { setMode(null); setSelectedTeamId(''); }} style={{ ...ghost }}>← Back</button>
                <button onClick={onClose} style={{ ...ghost }}>Cancel</button>
                <button onClick={handleTakeoverConfirm} disabled={!canTakeover} style={{ ...btn, background:'var(--green)', color:'#000', opacity:!canTakeover?0.5:1 }}>
                  {saving ? 'Processing…' : 'Take Over ✓'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function StaffPage() {
  const auth = useAuth();
  const { showConfirm, showPrompt, showAlert, showForm } = useDialog();
  const [staff, setStaff]               = useState([]);
  const [activity, setActivity]         = useState([]);
  const [teams, setTeams]               = useState([]);
  const [factions, setFactions]         = useState([]);
  const [loading, setLoading]           = useState(true);
  const [staffMoves, setStaffMoves]         = useState([]);
  const [factionMoves, setFactionMoves]     = useState([]);
  const [committing, setCommitting]         = useState(false);
  const [dragOver, setDragOver]             = useState(null);
  const [coiEntries, setCoiEntries]         = useState([]);
  const [meridianFactions, setMeridianFactions] = useState([]);
  const [coiModalStaff, setCoiModalStaff]   = useState(null);
  const [showCOIManager, setShowCOIManager] = useState(false);
  const [retireMember,  setRetireMember]    = useState(null);
  const [promoteMember, setPromoteMember]   = useState(null);
  const [accessList,    setAccessList]      = useState([]);
  const [accessForm,    setAccessForm]      = useState({ discordId: '', displayName: '' });
  const [accessBusy,    setAccessBusy]      = useState(false);
  const [accessError,   setAccessError]     = useState('');

  useEffect(() => { if (!auth.loading && auth.level >= 3) refresh(); }, [auth.loading]);

  const refresh = async () => {
    const [st, ac, te, fa, coi, mf, al] = await Promise.all([
      getStaffList(), getStaffActivity(), getTeamList(), getFactionAssignments(),
      getAllStaffCOI(), getMeridianFactions(), getDashboardAccessList(),
    ]);
    setStaff(st); setActivity(ac); setTeams(te); setFactions(fa);
    setCoiEntries(coi); setMeridianFactions(mf); setAccessList(al);
    setStaffMoves([]); setFactionMoves([]); setLoading(false);
  };

  const refreshCOI = async () => { setCoiEntries(await getAllStaffCOI()); };

  // Build a fast lookup: discord_id → [faction_name, ...]
  const coiMap = useMemo(() => {
    const m = {};
    coiEntries.forEach(e => {
      if (!m[e.discord_id]) m[e.discord_id] = [];
      m[e.discord_id].push(e.faction_name.toLowerCase());
    });
    return m;
  }, [coiEntries]);

  const getScenes = (name) => activity.find(a => a.name === name)?.scene_count || 0;
  const totalPending = staffMoves.length + factionMoves.length;

  const handleDragStart = useCallback((e, type, data) => {
    e.dataTransfer.setData("text/plain", JSON.stringify({ type, ...data }));
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDragOver = useCallback((e, teamId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(teamId);
  }, []);

  const handleDragLeave = useCallback(() => setDragOver(null), []);

  const handleDrop = useCallback(async (e, targetTeamId, targetTeamName) => {
    e.preventDefault();
    setDragOver(null);
    try {
      const data = JSON.parse(e.dataTransfer.getData("text/plain"));
      if (data.type === 'staff') {
        const origTeamId = data.originalTeamId || data.teamId;
        if (origTeamId === targetTeamId) {
          setStaffMoves(prev => prev.filter(m => m.staffId !== data.staffId));
        } else {
          // COI check — does this guide have a conflict with any faction in the target team?
          const targetFactions = boardState.find(col => col.id === targetTeamId)?.factions || [];
          const staffCOI       = coiMap[data.discordId] || [];
          const conflicts      = targetFactions.filter(f => staffCOI.includes(f.name.toLowerCase()));
          if (conflicts.length > 0) {
            const names = conflicts.map(f => f.name).join(', ');
            const proceed = await showConfirm(
              `⚠️ COI Alert — ${data.name}\n\n` +
              `This guide has a declared conflict of interest with:\n${names}\n\n` +
              `"${targetTeamName}" oversees these factions. Proceed anyway?`
            );
            if (!proceed) return;
          }
          setStaffMoves(prev => {
            const filtered = prev.filter(m => m.staffId !== data.staffId);
            return [...filtered, { staffId:data.staffId, staffName:data.name, discordId:data.discordId, oldTeamId:origTeamId, oldTeamName:data.originalTeamName||data.teamName, newTeamId:targetTeamId, newTeamName:targetTeamName }];
          });
        }
      } else if (data.type === 'faction') {
        const origTeamId = data.originalTeamId || data.teamId;
        if (origTeamId === targetTeamId) {
          setFactionMoves(prev => prev.filter(m => m.factionId !== data.factionId));
        } else {
          setFactionMoves(prev => {
            const filtered = prev.filter(m => m.factionId !== data.factionId);
            return [...filtered, { factionId:data.factionId, factionName:data.name, oldTeamId:origTeamId, oldTeamName:data.originalTeamName||data.teamName, newTeamId:targetTeamId, newTeamName:targetTeamName }];
          });
        }
      }
    } catch(err) {}
  }, []);

  const boardState = useMemo(() => {
    const board = {};
    const sMoveMap = {}; staffMoves.forEach(m => { sMoveMap[m.staffId] = m; });
    const fMoveMap = {}; factionMoves.forEach(m => { fMoveMap[m.factionId] = m; });

    teams.forEach(t => { board[t.id] = { id:t.id, name:t.name, members:[], factions:[] }; });
    if (!board['']) board[''] = { id:'', name:'Unassigned', members:[], factions:[] };

    staff.forEach(st => {
      const move = sMoveMap[st.id];
      const effectiveTeam = move ? move.newTeamId : st.team_id;
      const effectiveName = move ? move.newTeamName : st.team_name;
      if (!board[effectiveTeam]) board[effectiveTeam] = { id:effectiveTeam, name:effectiveName, members:[], factions:[] };
      board[effectiveTeam].members.push({ ...st, scenes30d:getScenes(st.display_name), isPending:!!move, originalTeamId:st.team_id, originalTeamName:st.team_name });
    });

    factions.forEach(f => {
      const move = fMoveMap[f.id];
      const effectiveTeam = move ? move.newTeamId : f.teamId;
      const effectiveName = move ? move.newTeamName : f.teamName;
      if (!board[effectiveTeam]) board[effectiveTeam] = { id:effectiveTeam, name:effectiveName, members:[], factions:[] };
      board[effectiveTeam].factions.push({ ...f, isPending:!!move, originalTeamId:f.teamId, originalTeamName:f.teamName });
    });

    Object.values(board).forEach(col => {
      col.members.sort((a,b) => {
        const al = a.rank?.toLowerCase().includes('lead') ? 0 : 1;
        const bl = b.rank?.toLowerCase().includes('lead') ? 0 : 1;
        return al !== bl ? al - bl : a.display_name.localeCompare(b.display_name);
      });
      col.factions.sort((a,b) => a.name.localeCompare(b.name));
    });

    return Object.values(board).sort((a,b) => {
      if (a.id === '') return 1; if (b.id === '') return -1;
      return a.name.localeCompare(b.name);
    });
  }, [staff, teams, factions, staffMoves, factionMoves, activity]);

  const handleRetireConfirm = async (reassignments) => {
    await retireStaff(retireMember.id, retireMember.display_name, retireMember.discord_id, reassignments);
    setRetireMember(null);
    await showAlert(`${retireMember.display_name} has been retired. All historical data is preserved.`);
    refresh();
  };

  const handlePromoteConfirm = async (newTeamName) => {
    await promoteToLead(promoteMember.id, promoteMember.display_name, promoteMember.team_id, newTeamName);
    setPromoteMember(null);
    await showAlert(`${promoteMember.display_name} promoted to Team Lead.${newTeamName !== promoteMember.team_name ? `\nTeam renamed to "${newTeamName}".` : ''}`);
    refresh();
  };

  const handleTakeoverConfirm = async ({ existingTeamId, oldLeadStaffId, oldLeadDiscordId, oldLeadStaffName, disposition, newTeamName }) => {
    const result = await takeoverTeam(
      promoteMember.id, promoteMember.display_name,
      existingTeamId,
      oldLeadStaffId, oldLeadDiscordId, oldLeadStaffName,
      disposition,
      newTeamName
    );
    const captured = promoteMember;
    setPromoteMember(null);
    const lines = [
      `${captured.display_name} promoted to Team Lead on "${newTeamName}".`,
      oldLeadStaffName ? `${oldLeadStaffName} ${disposition === 'retire' ? 'retired' : 'returned to Guide'}.` : '',
      `${result.factionsTransferred} faction(s) transferred.`,
      `Discord role synced: ${result.rolesSynced} | Failed: ${result.rolesFailed}`,
    ].filter(Boolean);
    await showAlert(lines.join('\n'));
    refresh();
  };

  const handleCommit = async () => {
    if (totalPending === 0) return;
    const lines = [];
    if (staffMoves.length) lines.push(`${staffMoves.length} staff move(s)`);
    if (factionMoves.length) lines.push(`${factionMoves.length} faction reassignment(s)`);
    if (!await showConfirm(`Commit ${lines.join(' + ')}?\n\nDiscord roles will sync automatically.`)) return;
    setCommitting(true);
    const result = await commitAllChanges(staffMoves, factionMoves);
    setCommitting(false);
    await showAlert(`Done!\nStaff moved: ${result.staffMoves}\nFactions reassigned: ${result.factionMoves}\nRoles synced: ${result.rolesSynced} | Failed: ${result.rolesFailed}`);
    refresh();
  };

  const handleAddStaff = async () => {
    const teamOpts = teams.map(t => ({label:t.name, value:t.id}));
    const res = await showForm("Add Staff", [
      {name:'discordId', label:'Discord ID', type:'text'},
      {name:'name', label:'Display Name', type:'text'},
      {name:'teamId', label:'Team', type:'select', options:teamOpts, placeholder:'Select...'},
      {name:'rank', label:'Rank', type:'select', options:[{label:'Guide',value:'Guide'},{label:'Team Lead',value:'Team Lead'}], default:'Guide'},
    ]);
    if (!res) return; // cancelled
    if (!res.name?.trim()) { await showAlert('Display name is required.'); return; }
    if (!res.discordId?.trim()) { await showAlert('Discord ID is required. Right-click the user in Discord → Copy User ID.'); return; }
    const tname = teams.find(t => t.id === res.teamId)?.name || '';
    await addStaff({discordId:res.discordId.trim(), name:res.name.trim(), teamId:res.teamId||'', teamName:tname, rank:res.rank||'Guide'});
    refresh();
  };

  const handleCreateTeam = async () => {
    const res = await showForm("Create Team", [
      {name:'teamId', label:'Discord Role ID', type:'text'},
      {name:'teamName', label:'Team Name', type:'text'},
      {name:'channelId', label:'Team Channel ID', type:'text'},
    ]);
    if (res?.teamId && res?.teamName) { await createTeam(res.teamId, res.teamName, res.channelId || ''); refresh(); }
  };

  if (auth.loading || loading) return <div className="p-10 text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading...</div>;
  if (auth.level < 3) return <div className="p-10" style={{color:'var(--red)'}}>Access denied.</div>;

  return (
    <div style={{display:'flex', flexDirection:'column', height:'100vh'}}>

      {/* Page header */}
      <div className="page-hdr" style={{background:'linear-gradient(180deg,rgba(248,113,113,0.04) 0%,transparent 100%)'}}>
        <div className="accent-bar" style={{background:'linear-gradient(90deg,var(--red) 0%,transparent 60%)'}} />
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start'}}>
          <div>
            <div className="page-hdr-tag" style={{color:'var(--red)'}}>Operations / Staff</div>
            <h1>Staff</h1>
            <div className="page-hdr-sub">Drag to reassign · Commit to sync Discord roles</div>
          </div>
          <div style={{display:'flex', gap:8, alignItems:'center', marginTop:4, flexWrap:'wrap'}}>
            {totalPending > 0 && <>
              <button onClick={handleCommit} disabled={committing} style={{...btn, background:'var(--green)', opacity:committing?0.5:1}}>
                {committing ? 'Syncing…' : `Commit ${totalPending} change${totalPending!==1?'s':''}`}
              </button>
              <button onClick={() => {setStaffMoves([]); setFactionMoves([]);}} style={{...ghost, color:'var(--red)', borderColor:'rgba(248,113,113,0.3)'}}>Discard</button>
            </>}
            <button style={{...ghost, color:'var(--amber)', borderColor:'rgba(251,191,36,0.3)'}} onClick={() => setShowCOIManager(true)}>⚠ Manage COI</button>
            <button style={ghost} onClick={handleCreateTeam}>+ Team</button>
            <button style={btn} onClick={handleAddStaff}>+ Staff</button>
          </div>
        </div>
      </div>

      {/* Board */}
      <div style={{flex:1, overflowX:'auto', overflowY:'hidden', display:'flex', gap:10, padding:'12px 16px 16px', alignItems:'stretch'}} className="scr">
        {boardState.filter(col => col.name !== 'Game Affairs Management' && !col.name?.toLowerCase().includes('game affairs')).map(col => {
          const isOver    = dragOver === col.id;
          const hasPending = col.members.some(m => m.isPending) || col.factions.some(f => f.isPending);
          const isUnassigned = col.id === '';
          const showFactionDivider = col.members.length > 0 && col.factions.length > 0;

          return (
            <div
              key={col.id}
              className="group"
              onDragOver={(e) => handleDragOver(e, col.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, col.id, col.name)}
              style={{
                width: 240, minWidth: 240,
                display: 'flex', flexDirection: 'column',
                borderRadius: 14, overflow: 'hidden',
                background: isOver ? 'rgba(160,126,245,0.06)' : 'rgba(255,255,255,0.035)',
                backdropFilter: 'blur(20px)',
                border: isOver
                  ? '2px dashed rgba(160,126,245,0.5)'
                  : hasPending
                    ? '1px solid rgba(74,222,128,0.35)'
                    : '1px solid rgba(255,255,255,0.09)',
                boxShadow: isOver
                  ? '0 0 24px rgba(160,126,245,0.15), var(--card-shadow)'
                  : 'var(--card-shadow)',
                transition: 'border 0.15s, background 0.15s, box-shadow 0.15s',
              }}
            >
              {/* Column header */}
              <div style={{
                padding: '9px 12px 8px',
                borderBottom: '1px solid rgba(255,255,255,0.07)',
                background: 'rgba(255,255,255,0.03)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                flexShrink: 0,
              }}>
                <div>
                  <div style={{fontSize:12, fontWeight:600, letterSpacing:'-0.01em', color:isUnassigned?'var(--fg-3)':'var(--fg-0)', lineHeight:1.2}}>{col.name}</div>
                  <div style={{fontSize:9, color:'var(--fg-4)', fontFamily:'var(--font-mono)', marginTop:3, letterSpacing:'0.06em'}}>
                    {col.members.length} staff · {col.factions.length} faction{col.factions.length!==1?'s':''}
                  </div>
                </div>
                {col.id && (
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" style={{marginTop:1}}>
                    <button
                      onClick={async()=>{const n=await showPrompt("Rename:",col.name);if(n&&n!==col.name){await renameTeam(col.id,n);refresh();}}}
                      style={{...micro, color:'var(--fg-3)'}}
                    >Ren</button>
                    <button
                      onClick={async()=>{if(await showConfirm(`Dissolve "${col.name}"?`)){await deleteTeam(col.id,col.name);refresh();}}}
                      style={{...micro, color:'var(--red)'}}
                    >Del</button>
                  </div>
                )}
              </div>

              {/* Cards */}
              <div style={{flex:1, overflowY:'auto', padding:'6px'}} className="scr">

                {/* Staff cards */}
                {col.members.map(m => {
                  const hasCOI = coiMap[m.discord_id]?.length > 0;
                  return (
                    <div
                      key={m.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, 'staff', {
                        staffId:m.id, name:m.display_name, discordId:m.discord_id,
                        teamId:col.id, teamName:col.name,
                        originalTeamId:m.originalTeamId, originalTeamName:m.originalTeamName,
                      })}
                      className="group/card"
                      style={{
                        display:'flex', alignItems:'center', gap:6,
                        padding:'5px 7px', borderRadius:8, marginBottom:3,
                        background: m.isPending ? 'rgba(74,222,128,0.1)' : 'rgba(255,255,255,0.04)',
                        border: m.isPending ? '1px solid rgba(74,222,128,0.3)' : '1px solid rgba(255,255,255,0.07)',
                        cursor:'grab', userSelect:'none',
                        transition:'background 0.12s, border 0.12s',
                      }}
                    >
                      {/* Drag grip */}
                      <span style={{fontSize:10, color:'var(--fg-4)', flexShrink:0, lineHeight:1}}>⠿</span>

                      {/* Name */}
                      <div style={{flex:1, minWidth:0}}>
                        <div style={{fontSize:12, fontWeight:400, color:m.isPending?'var(--green)':'var(--fg-0)', lineHeight:1.3, wordBreak:'break-word'}}>
                          {m.display_name}
                        </div>
                        {m.isPending && <div style={{fontSize:8, color:'var(--green)', fontFamily:'var(--font-mono)', marginTop:1}}>← {m.originalTeamName||'Unassigned'}</div>}
                      </div>

                      {/* COI — only when set */}
                      {hasCOI && (
                        <button
                          onClick={(ev)=>{ev.stopPropagation();setCoiModalStaff(m);}}
                          title={`COI: ${coiEntries.filter(e=>e.discord_id===m.discord_id).map(e=>e.faction_name).join(', ')}`}
                          style={{...micro, flexShrink:0, fontWeight:700, color:'var(--amber)', background:'rgba(251,191,36,0.12)', border:'1px solid rgba(251,191,36,0.25)', borderRadius:4, padding:'1px 5px', fontSize:8}}
                        >⚠</button>
                      )}

                      {/* Actions — reveal on hover */}
                      <div className="opacity-0 group-hover/card:opacity-100 transition-opacity shrink-0 flex gap-0.5">
                        {/* Promote to Lead — only for Guides */}
                        {m.rank?.toLowerCase() === 'guide' && (
                          <button
                            onClick={() => setPromoteMember(m)}
                            title="Promote to Lead"
                            style={{...micro, color:'var(--green)', background:'rgba(74,222,128,0.1)', border:'1px solid rgba(74,222,128,0.2)', borderRadius:4, padding:'1px 5px', fontSize:8}}
                          >↑ Lead</button>
                        )}
                        <button
                          onClick={async()=>{
                            const res=await showForm(`Edit: ${m.display_name}`,[
                              {name:'name',label:'Name',type:'text',default:m.display_name},
                              {name:'rank',label:'Rank',type:'select',options:[{label:'Guide',value:'Guide'},{label:'Team Lead',value:'Team Lead'},{label:'Management',value:'Management'}],default:m.rank},
                              {name:'lst',label:'Lead Storyteller (full access to all factions)',type:'checkbox',default:!!m.lead_storyteller},
                            ]);
                            if(!res)return;
                            if(res.name!==m.display_name) await updateStaff(m.id,'display_name',res.name);
                            if(res.rank!==m.rank) await updateStaff(m.id,'rank',res.rank);
                            if(!!res.lst !== !!m.lead_storyteller) await updateStaff(m.id,'lead_storyteller',res.lst?1:0);
                            refresh();
                          }}
                          style={{...micro, color:'var(--fg-3)'}}
                        >✎</button>
                        {/* Retire */}
                        <button
                          onClick={() => setRetireMember(m)}
                          title="Retire staff member"
                          style={{...micro, color:'var(--red)', fontSize:10}}
                        >✕</button>
                      </div>
                    </div>
                  );
                })}

                {/* Faction divider */}
                {showFactionDivider && (
                  <div style={{height:1, background:'rgba(255,255,255,0.07)', margin:'6px 2px'}} />
                )}

                {/* Faction cards */}
                {col.factions.map(f => (
                  <div
                    key={`f-${f.id}`}
                    draggable
                    onDragStart={(e) => handleDragStart(e, 'faction', {
                      factionId:f.id, name:f.name,
                      teamId:col.id, teamName:col.name,
                      originalTeamId:f.originalTeamId, originalTeamName:f.originalTeamName,
                    })}
                    style={{
                      display:'flex', alignItems:'center', gap:7,
                      padding:'5px 7px 5px 9px', borderRadius:8, marginBottom:3,
                      background: f.isPending ? 'rgba(74,222,128,0.08)' : 'rgba(255,255,255,0.03)',
                      border: f.isPending ? '1px solid rgba(74,222,128,0.25)' : '1px solid rgba(255,255,255,0.06)',
                      borderLeft: `2px solid ${f.isPending ? 'var(--green)' : 'rgba(251,191,36,0.5)'}`,
                      cursor:'grab', userSelect:'none',
                    }}
                  >
                    <span style={{fontSize:10, color:'var(--fg-4)', flexShrink:0, lineHeight:1}}>⠿</span>
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{fontSize:11, fontWeight:500, color:f.isPending?'var(--green)':'var(--fg-1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', lineHeight:1.2}}>
                        {f.name}
                      </div>
                      {f.isPending && <div style={{fontSize:8, color:'var(--green)', fontFamily:'var(--font-mono)', marginTop:1}}>← {f.originalTeamName||'Unassigned'}</div>}
                    </div>
                    <span style={{fontSize:8, fontWeight:700, padding:'1px 5px', borderRadius:4, background:'rgba(255,255,255,0.06)', color:'var(--fg-3)', fontFamily:'var(--font-mono)', flexShrink:0}}>
                      T{f.tier}
                    </span>
                  </div>
                ))}

                {/* Empty drop target */}
                {col.members.length === 0 && col.factions.length === 0 && (
                  <div style={{padding:'20px 8px', textAlign:'center', fontSize:10, color:'var(--fg-4)', fontStyle:'italic', fontFamily:'var(--font-mono)'}}>
                    Drop here
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Retire Modal ── */}
      {retireMember && (
        <RetireModal
          member={retireMember}
          allStaff={staff}
          onConfirm={handleRetireConfirm}
          onClose={() => setRetireMember(null)}
        />
      )}

      {/* ── Promote Modal ── */}
      {promoteMember && (
        <PromoteModal
          member={promoteMember}
          teams={teams}
          staff={staff}
          onConfirm={handlePromoteConfirm}
          onTakeover={handleTakeoverConfirm}
          onClose={() => setPromoteMember(null)}
        />
      )}

      {/* ── COI Manager — full staff list ── */}
      {showCOIManager && (
        <div style={{ position:'fixed', inset:0, zIndex:150, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
          <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', backdropFilter:'blur(8px)' }} onClick={() => setShowCOIManager(false)} />
          <div style={{ position:'relative', width:'100%', maxWidth:680, maxHeight:'85vh', background:'var(--bg-1)', border:'1px solid var(--border)', borderRadius:16, display:'flex', flexDirection:'column', overflow:'hidden', zIndex:1 }}>

            {/* Header */}
            <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
              <div>
                <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.12em', color:'var(--amber)', marginBottom:2 }}>Conflict of Interest</div>
                <div style={{ fontSize:15, fontWeight:700, color:'var(--fg-0)' }}>Manage COI — All Staff</div>
              </div>
              <button onClick={() => setShowCOIManager(false)} style={{ background:'none', border:'none', color:'var(--fg-4)', fontSize:20, cursor:'pointer', lineHeight:1 }}>✕</button>
            </div>

            {/* Staff list */}
            <div style={{ flex:1, overflowY:'auto', padding:16, display:'flex', flexDirection:'column', gap:6 }} className="scr">
              {staff
                .filter(s => !s.rank?.toLowerCase().includes('management'))
                .sort((a,b) => a.display_name.localeCompare(b.display_name))
                .map(s => {
                  const sCOI = coiEntries.filter(e => e.discord_id === s.discord_id);
                  return (
                    <div key={s.id} style={{
                      display:'flex', alignItems:'center', justifyContent:'space-between', gap:12,
                      padding:'10px 14px', borderRadius:10,
                      background:'var(--bg-2)', border:'1px solid var(--border)',
                    }}>
                      {/* Name + team */}
                      <div style={{ minWidth:0, flex:1 }}>
                        <div style={{ fontSize:13, fontWeight:600, color:'var(--fg-0)', lineHeight:1.2 }}>{s.display_name}</div>
                        <div style={{ fontSize:10, color:'var(--fg-4)', marginTop:2 }}>{s.team_name || 'Unassigned'} · {s.rank}</div>
                      </div>

                      {/* Current COI pills */}
                      <div style={{ display:'flex', flexWrap:'wrap', gap:4, flex:2, justifyContent:'flex-end' }}>
                        {sCOI.length === 0 && (
                          <span style={{ fontSize:11, color:'var(--fg-4)', fontStyle:'italic' }}>No COI set</span>
                        )}
                        {sCOI.map(e => (
                          <span key={e.id} style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'2px 8px', borderRadius:5, background:'rgba(251,191,36,0.1)', border:'1px solid rgba(251,191,36,0.25)', fontSize:11, color:'var(--amber)' }}>
                            {e.faction_name}
                            <button onClick={async () => { await removeStaffCOI(e.id); await refreshCOI(); }} style={{ background:'none', border:'none', color:'var(--fg-4)', cursor:'pointer', fontSize:13, lineHeight:1, padding:0 }}>×</button>
                          </span>
                        ))}
                      </div>

                      {/* Edit button */}
                      <button
                        onClick={() => { setShowCOIManager(false); setCoiModalStaff(s); }}
                        style={{ ...ghost, padding:'4px 10px', fontSize:10, flexShrink:0 }}
                      >Edit</button>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* ── Individual Dashboard Access ── */}
      <div className="sec-card" style={{ marginTop: 24 }}>
        <div className="sec-card-hdr">
          <span>Individual Dashboard Access</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-4)' }}>
            {accessList.length} grant{accessList.length !== 1 ? 's' : ''} active
          </span>
        </div>

        {/* Granted users */}
        {accessList.map(entry => (
          <div key={entry.discord_id} style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 4, background: 'rgba(160,126,245,0.15)', color: 'var(--accent)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', flexShrink: 0 }}>L{entry.level}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-0)' }}>{entry.display_name}</div>
              <div style={{ fontSize: 10, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>
                {entry.discord_id}
                {entry.granted_by_name && <span style={{ marginLeft: 8, color: 'var(--fg-4)' }}>· Granted by {entry.granted_by_name}</span>}
                {entry.granted_at && <span style={{ marginLeft: 8 }}>· {entry.granted_at.substring(0, 10)}</span>}
              </div>
            </div>
            <button
              onClick={async () => {
                if (!await showConfirm(`Revoke dashboard access for ${entry.display_name}? They will be logged out immediately.`)) return;
                await revokeDashboardAccess(entry.discord_id);
                setAccessList(al => al.filter(e => e.discord_id !== entry.discord_id));
              }}
              style={{ fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(248,113,113,0.4)', background: 'transparent', color: 'var(--red)', cursor: 'pointer', flexShrink: 0 }}>
              Revoke
            </button>
          </div>
        ))}

        {accessList.length === 0 && (
          <div style={{ padding: '14px 16px', color: 'var(--fg-4)', fontSize: 12, fontStyle: 'italic' }}>No individual grants yet.</div>
        )}

        {/* Add grant form */}
        <div style={{ padding: '14px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Discord ID</div>
            <input
              value={accessForm.discordId}
              onChange={e => setAccessForm(f => ({ ...f, discordId: e.target.value }))}
              placeholder="e.g. 225429360411279360"
              style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 7, padding: '7px 10px', fontSize: 12, color: 'var(--fg-0)', width: 220 }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Display Name</div>
            <input
              value={accessForm.displayName}
              onChange={e => setAccessForm(f => ({ ...f, displayName: e.target.value }))}
              placeholder="Name for reference"
              style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 7, padding: '7px 10px', fontSize: 12, color: 'var(--fg-0)', width: 180 }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 9, color: 'transparent' }}>_</div>
            <button
              disabled={accessBusy || !accessForm.discordId.trim()}
              onClick={async () => {
                setAccessError('');
                setAccessBusy(true);
                const res = await grantDashboardAccess(accessForm.discordId.trim(), accessForm.displayName.trim());
                setAccessBusy(false);
                if (!res.ok) { setAccessError(res.error || 'Failed.'); return; }
                setAccessForm({ discordId: '', displayName: '' });
                setAccessList(await getDashboardAccessList());
              }}
              style={{ ...btn, opacity: (accessBusy || !accessForm.discordId.trim()) ? 0.5 : 1 }}>
              {accessBusy ? 'Granting…' : 'Grant L3 Access'}
            </button>
          </div>
          {accessError && <div style={{ fontSize: 11, color: 'var(--red)', alignSelf: 'center' }}>{accessError}</div>}
        </div>
      </div>

      {/* COI Modal */}
      {coiModalStaff && (
        <COIModal
          staff={coiModalStaff}
          coiEntries={coiEntries}
          meridianFactions={meridianFactions}
          onAdd={async (discordId, name, source) => {
            await addStaffCOI(discordId, name, source);
            await refreshCOI();
          }}
          onRemove={async (id) => {
            await removeStaffCOI(id);
            await refreshCOI();
          }}
          onClose={() => setCoiModalStaff(null)}
        />
      )}
    </div>
  );
}
