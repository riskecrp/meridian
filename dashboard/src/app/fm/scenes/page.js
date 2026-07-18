"use client";
import { useEffect, useState } from "react";
import { useAuth } from "../../../lib/useAuth";
import { useDialog } from "../../../lib/useDialog";
import { getSceneLogs, getFactionNames, getInventoryForScene, getStaffForScene, submitScene, addMyselfToScene, removeAssistantFromScene, editSceneNotes, deleteScene, requestSceneDeletion, getAttentionFactions, getTreasuryStats } from "./actions";
import SopLink from "../../../lib/SopLink";
import { useDraft, loadDraft, clearDraft } from "../../../lib/useDraft";

const BLANK_SCENE = { faction:'', cash:'', items:[], otherRewards:'', notes:'', assistants:[] };
// A scene draft is only worth keeping if the user has actually entered something.
const sceneIsBlank = (f) => !f || (
  !f.faction && !String(f.cash ?? '').trim() && (f.items?.length || 0) === 0 &&
  !String(f.otherRewards ?? '').trim() && !String(f.notes ?? '').trim() && (f.assistants?.length || 0) === 0
);

const st = {
  btn: { background:'var(--accent)', color:'white', border:'none', padding:'8px 16px', borderRadius:8, fontSize:11, fontWeight:800, cursor:'pointer', textTransform:'uppercase', letterSpacing:'0.1em' },
  btnGhost: { background:'transparent', color:'var(--fg-3)', border:'1px solid var(--border)', padding:'6px 14px', borderRadius:8, fontSize:10, fontWeight:700, cursor:'pointer', textTransform:'uppercase' },
  input: { width:'100%', background:'var(--bg-2)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 14px', fontSize:13, color:'var(--fg-0)', outline:'none' },
  label: { fontSize:10, fontWeight:700, color:'var(--fg-4)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:4 },
  modal: { position:'fixed', inset:0, zIndex:50, display:'flex', alignItems:'center', justifyContent:'center', padding:24 },
  modalBg: { position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', backdropFilter:'blur(8px)' },
};

export default function ScenesPage() {
  const auth = useAuth();
  const [logs, setLogs] = useState([]);
  const [factions, setFactions] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [attention, setAttention] = useState([]);
  const [treasury, setTreasury] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showTreasury, setShowTreasury] = useState(false);
  const [form, setForm] = useState(BLANK_SCENE);
  const [hasDraft, setHasDraft] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editText, setEditText] = useState("");
  const [addingToScene, setAddingToScene] = useState(null);

  // Restore any scene draft saved before a reload/crash. The form stays hidden;
  // a banner offers to resume it. Persist on every keystroke while the modal is open.
  useEffect(() => {
    const d = loadDraft('scenes:new');
    if (d && !sceneIsBlank(d)) { setForm(d); setHasDraft(true); }
  }, []);
  useDraft('scenes:new', form, { enabled: showForm, blank: sceneIsBlank });

  const { showConfirm, showAlert } = useDialog();
  const actor = { id: auth.id, name: auth.name };

  useEffect(() => {
    if (!auth.loading) {
      Promise.all([getSceneLogs(), getFactionNames(), getInventoryForScene(), getStaffForScene(), getAttentionFactions(), auth.level >= 3 ? getTreasuryStats() : Promise.resolve({})]).then(([l,f,i,s,a,t]) => {
        setLogs(l); setFactions(f); setInventory(i); setStaffList(s); setAttention(a); setTreasury(t); setLoading(false);
      });
    }
  }, [auth.loading]);

  const refresh = async () => { setLogs(await getSceneLogs()); setAttention(await getAttentionFactions()); setInventory(await getInventoryForScene()); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const res = await submitScene(form);
    if (res.ok) { setShowForm(false); setForm(BLANK_SCENE); clearDraft('scenes:new'); setHasDraft(false); refresh(); }
    else await showAlert("Error: " + (res.error || "Unknown"));
  };

  const toggleAssistant = (staff) => {
    setForm(f => {
      const exists = f.assistants.some(a => a.staff_id === staff.discord_id);
      return { ...f, assistants: exists
        ? f.assistants.filter(a => a.staff_id !== staff.discord_id)
        : [...f.assistants, { staff_id: staff.discord_id, staff_name: staff.display_name }]
      };
    });
  };

  const handleAddMyself = async (logId) => {
    setAddingToScene(logId);
    const res = await addMyselfToScene(logId);
    setAddingToScene(null);
    if (res.ok) { refresh(); }
    else await showAlert(res.error || "Could not add yourself to this scene.");
  };

  const handleSaveEdit = async () => { await editSceneNotes(editId, editText); setEditId(null); refresh(); };

  if (auth.loading || loading) return <div className="p-10 text-sm animate-pulse" style={{ color:'var(--accent)' }}>Loading scenes...</div>;

  const filtered = logs
    .filter(l => {
      const matchSearch = !search || l.faction?.toLowerCase().includes(search.toLowerCase()) || l.logged_by?.toLowerCase().includes(search.toLowerCase());
      const logDate = new Date(l.date);
      const matchFrom = !dateFrom || logDate >= new Date(dateFrom);
      const matchTo = !dateTo || logDate <= new Date(dateTo + 'T23:59:59');
      return matchSearch && matchFrom && matchTo;
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const hasFilters = search || dateFrom || dateTo;

  return (
    <div className="page-shell">
      <div className="page-hdr" style={{ background:'linear-gradient(180deg,rgba(34,197,94,0.04) 0%,transparent 100%)' }}>
        <div className="accent-bar" style={{ background:'linear-gradient(90deg,var(--green) 0%,transparent 60%)' }} />
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
          <div>
            <div className="page-hdr-tag" style={{ color:'var(--green)' }}>Overview / Scene Intelligence</div>
            <h1>Scene Intelligence</h1>
            <div className="page-hdr-sub">Record scene outcomes and distribute rewards</div>
          </div>
          <div style={{ display:'flex', gap:8, marginTop:4 }}>
            {auth.level >= 3 && <button style={{ ...st.btnGhost, color:'var(--amber)' }} onClick={async () => { setTreasury(await getTreasuryStats()); setShowTreasury(true); }}>Treasury</button>}
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <SopLink title="Scenes & Intel" label="Scene Logging Guide" />
              <button style={st.btn} onClick={() => setShowForm(true)}>Log Scene +</button>
            </div>
          </div>
        </div>
      </div>
      <div className="page-body scr" style={{ display:'flex', flexDirection:'column', gap:14 }}>

      {/* Unsaved draft recovery */}
      {hasDraft && !showForm && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap',
          padding:'10px 14px', borderRadius:10, background:'var(--amber-bg)', border:'1px solid var(--amber)' }}>
          <span style={{ fontSize:12, fontWeight:600, color:'var(--amber)' }}>
            You have an unsaved scene draft from a previous session.
          </span>
          <div style={{ display:'flex', gap:8 }}>
            <button style={st.btn} onClick={() => { setShowForm(true); setHasDraft(false); }}>Resume</button>
            <button style={st.btnGhost} onClick={() => { clearDraft('scenes:new'); setForm(BLANK_SCENE); setHasDraft(false); }}>Discard</button>
          </div>
        </div>
      )}

      {/* Attention */}
      {attention.length > 0 && (
      <div className="sec-card" style={{ borderColor:'var(--red-bg)', background:'var(--red-bg)' }}>
        <div className="sec-card-hdr" style={{ background:'rgba(239,68,68,0.12)', borderColor:'var(--red-bg)', color:'var(--red)' }}>
          <span style={{ display:'flex', alignItems:'center', gap:6 }}><span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background:'var(--red)', display:'inline-block' }} /> Attention Required</span>
          <span style={{ fontFamily:'var(--font-mono)' }}>{attention.length} faction{attention.length!==1?'s':''}</span>
        </div>
        <div style={{ padding:'10px 14px', display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:8 }}>
          {attention.map(([fac, count], i) => (
            <div key={i} style={{ background:'var(--bg-1)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 12px' }}>
              <div style={{ fontSize:12, fontWeight:700, marginBottom:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{fac}</div>
              <div style={{ fontSize:10, fontFamily:'var(--font-mono)', color:'var(--red)' }}>{count} scenes 30d</div>
            </div>
          ))}
        </div>
      </div>
      )}

      {/* Filter bar */}
      <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
        <input
          style={{...st.input, flex:'1', minWidth:180, maxWidth:340}}
          placeholder="Search by faction or staff..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <div style={{ fontSize:10, fontWeight:700, color:'var(--fg-3)', textTransform:'uppercase', letterSpacing:'0.12em', fontFamily:'var(--font-mono)', whiteSpace:'nowrap' }}>From</div>
          <input
            type="date"
            style={{...st.input, width:'auto', padding:'8px 12px', fontSize:12, cursor:'pointer'}}
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
          />
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <div style={{ fontSize:10, fontWeight:700, color:'var(--fg-3)', textTransform:'uppercase', letterSpacing:'0.12em', fontFamily:'var(--font-mono)', whiteSpace:'nowrap' }}>To</div>
          <input
            type="date"
            style={{...st.input, width:'auto', padding:'8px 12px', fontSize:12, cursor:'pointer'}}
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
          />
        </div>
        {hasFilters && (
          <button
            style={{...st.btnGhost, whiteSpace:'nowrap', flexShrink:0}}
            onClick={() => { setSearch(''); setDateFrom(''); setDateTo(''); }}
          >
            Clear
          </button>
        )}
        <div style={{ fontSize:10, color:'var(--fg-3)', fontFamily:'var(--font-mono)', whiteSpace:'nowrap', marginLeft:'auto' }}>
          {filtered.length} result{filtered.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Logs */}
      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        {filtered.map(log => {
          const isAuthor = log.author_id === auth.id;
          return (
            <div key={log.id} className="sec-card">
              <div className="sec-card-hdr">
                <span style={{ fontFamily:'var(--font-display)', fontSize:13, color:'var(--fg-0)', letterSpacing:0 }}>{log.faction}</span>
                <span style={{ fontFamily:'var(--font-mono)', fontSize:10 }}>{log.date}</span>
              </div>
              <div style={{ padding:'12px 14px' }}>
              {editId === log.id ? (
                <div className="space-y-3 my-3"><textarea style={{ ...st.input, minHeight:100 }} value={editText} onChange={e => setEditText(e.target.value)} /><div className="flex gap-2"><button style={st.btn} onClick={handleSaveEdit}>Save</button><button style={st.btnGhost} onClick={() => setEditId(null)}>Cancel</button></div></div>
              ) : (
                <p className="text-sm leading-relaxed my-3 whitespace-pre-wrap" style={{ color:'var(--fg-2)' }}>{log.notes}</p>
              )}
              <div style={{ display:'flex', gap:16, padding:'8px 12px', borderRadius:6, background:'var(--bg-2)', marginBottom:10, flexWrap:'wrap' }}>
                <div>
                  <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'var(--fg-4)', marginBottom:2, fontFamily:'var(--font-mono)' }}>Staff</div>
                  <div style={{ fontSize:12, fontWeight:600 }}>{log.logged_by}</div>
                </div>
                {log.assistants?.length > 0 && (
                  <div>
                    <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'var(--fg-4)', marginBottom:2, fontFamily:'var(--font-mono)' }}>Also Present</div>
                    <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                      {log.assistants.map(a => (
                        <span key={a.id} style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:10, fontWeight:600, padding:'1px 5px 1px 7px', borderRadius:4,
                          background:'rgba(99,102,241,0.12)', color:'#818cf8', border:'1px solid rgba(99,102,241,0.25)' }}>
                          {a.staff_name}
                          {auth.level >= 2 && (
                            <button
                              onClick={async () => {
                                if (await showConfirm(`Remove ${a.staff_name} from this scene?`)) {
                                  await removeAssistantFromScene(a.id);
                                  refresh();
                                }
                              }}
                              style={{ fontSize:9, lineHeight:1, padding:'0 2px', background:'none', border:'none',
                                color:'rgba(129,140,248,0.6)', cursor:'pointer', fontWeight:700 }}
                              title="Remove">
                              ✕
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'var(--fg-4)', marginBottom:2, fontFamily:'var(--font-mono)' }}>Rewards</div>
                  <div style={{ fontSize:12, fontFamily:'var(--font-mono)', color:'var(--green)' }}>{log.rewards}</div>
                </div>
              </div>
              <div className="flex justify-between items-center pt-2" style={{ borderTop:'1px solid var(--border)' }}>
                <div className="flex gap-3">
                  {isAuthor && editId !== log.id && <button style={{ fontSize:10, color:'var(--accent)', background:'none', border:'none', cursor:'pointer', fontWeight:700, textTransform:'uppercase' }} onClick={() => { setEditId(log.id); setEditText(log.notes); }}>Edit</button>}
                  {isAuthor && <button style={{ fontSize:10, color:'var(--amber)', background:'none', border:'none', cursor:'pointer', fontWeight:700, textTransform:'uppercase' }} onClick={async () => { if (await showConfirm("Request deletion?")) { await requestSceneDeletion(log.id, log.notes); await showAlert("Deletion requested."); } }}>Req. Delete</button>}
                  {!isAuthor && !log.assistants?.some(a => a.staff_id === auth.id) && (
                    <button
                      disabled={addingToScene === log.id}
                      style={{ fontSize:10, color:'var(--green)', background:'none', border:'none', cursor:'pointer', fontWeight:700, textTransform:'uppercase', opacity: addingToScene === log.id ? 0.5 : 1 }}
                      onClick={() => handleAddMyself(log.id)}>
                      {addingToScene === log.id ? 'Adding…' : '+ Add Myself'}
                    </button>
                  )}
                </div>
                {auth.level >= 3 && <button style={{ fontSize:10, color:'var(--red)', background:'none', border:'none', cursor:'pointer', fontWeight:700, textTransform:'uppercase' }} onClick={async () => { if (await showConfirm("L3 DELETE: Permanently remove this scene log?")) { await deleteScene(log.id); refresh(); } }}>L3 Delete</button>}
              </div>
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && <div className="empty-state">No scene logs match your search.</div>}

      {/* LOG SCENE FORM */}
      {showForm && (
        <div style={st.modal}><div style={st.modalBg} onClick={() => setShowForm(false)} />
          <form onSubmit={handleSubmit} style={{ position:'relative', width:'100%', maxWidth:900, maxHeight:'90vh', background:'var(--bg-1)', border:'1px solid var(--border)', borderRadius:16, display:'flex', flexDirection:'column', overflow:'hidden' }}>
            <div className="p-6 flex justify-between items-center" style={{ borderBottom:'1px solid var(--border)' }}>
              <h2 className="text-xl font-bold uppercase tracking-tight">Log Scene</h2>
              <button type="button" onClick={() => setShowForm(false)} style={{ color:'var(--fg-4)', fontSize:20, background:'none', border:'none', cursor:'pointer' }}>✕</button>
            </div>
            <div className="p-6 space-y-6 overflow-y-auto scr flex-1">
              <div><div style={st.label}>Target Faction</div><select required style={st.input} value={form.faction} onChange={e => setForm({...form, faction: e.target.value})}><option value="">Select...</option>{factions.map(f => <option key={f} value={f}>{f}</option>)}</select></div>
              <div className="p-5 rounded-xl space-y-4" style={{ background:'var(--bg-2)', border:'1px solid var(--border)' }}>
                <div className="flex justify-between items-center" style={{ paddingBottom:8, borderBottom:'1px solid var(--border)' }}>
                  <div style={st.label}>Rewards & Inventory</div>
                  <button type="button" style={{ fontSize:10, color:'var(--accent)', background:'none', border:'none', cursor:'pointer', fontWeight:700 }} onClick={() => setForm({...form, items:[...form.items, {name:'',qty:1}]})}>+ Add Item</button>
                </div>
                <div><div style={st.label}>Cash Reward</div><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color:'var(--fg-4)' }}>$</span><input type="number" style={{ ...st.input, paddingLeft:28 }} value={form.cash} onChange={e => setForm({...form, cash: e.target.value})} /></div></div>
                {form.items.map((item, idx) => (
                  <div key={idx} className="flex gap-3 items-end">
                    <div className="flex-1"><div style={st.label}>Item</div><input list={`inv-${idx}`} style={st.input} placeholder="Type to search..." value={item.name} onChange={e => { const n=[...form.items]; n[idx].name=e.target.value; setForm({...form, items:n}); }} /><datalist id={`inv-${idx}`}>{inventory.map((inv,i) => <option key={i} value={inv.name}>{`Stock: ${inv.current_stock}`}</option>)}</datalist></div>
                    <div className="w-20"><div style={st.label}>Qty</div><input type="number" min="1" style={{ ...st.input, textAlign:'center' }} value={item.qty} onChange={e => { const n=[...form.items]; n[idx].qty=e.target.value; setForm({...form, items:n}); }} /></div>
                    <button type="button" onClick={() => setForm({...form, items: form.items.filter((_,i)=>i!==idx)})} style={{ color:'var(--red)', background:'none', border:'none', cursor:'pointer', padding:8 }}>✕</button>
                  </div>
                ))}
                <div><div style={st.label}>Other Rewards</div><input style={st.input} placeholder="e.g. 1x Declasse Tulip" value={form.otherRewards} onChange={e => setForm({...form, otherRewards: e.target.value})} /></div>
              </div>
              {/* Assistants */}
              <div>
                <div style={{ ...st.label, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span>Also Present (Optional)</span>
                  {form.assistants.length > 0 && (
                    <span style={{ fontWeight:400, color:'var(--accent)', textTransform:'none', letterSpacing:0 }}>
                      {form.assistants.length} selected
                    </span>
                  )}
                </div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:5, padding:'8px 10px', borderRadius:8,
                  border:'1px solid var(--border)', background:'var(--bg-2)', maxHeight:120, overflowY:'auto' }}>
                  {staffList.filter(s => s.discord_id !== auth.id).map(s => {
                    const selected = form.assistants.some(a => a.staff_id === s.discord_id);
                    return (
                      <button key={s.discord_id} type="button" onClick={() => toggleAssistant(s)}
                        style={{ fontSize:10, fontWeight:600, padding:'3px 9px', borderRadius:5, cursor:'pointer', border:'1px solid',
                          background: selected ? 'rgba(99,102,241,0.18)' : 'transparent',
                          color: selected ? '#818cf8' : 'var(--fg-3)',
                          borderColor: selected ? 'rgba(99,102,241,0.4)' : 'var(--border)',
                          transition:'all 0.1s' }}>
                        {selected ? '✓ ' : ''}{s.display_name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div><div style={st.label}>Notes</div><textarea required rows="5" style={{ ...st.input, minHeight:120 }} value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} /></div>
            </div>
            <div className="p-6 flex justify-between items-center" style={{ borderTop:'1px solid var(--border)' }}>
              <span className="text-[10px] font-mono flex items-center gap-2" style={{ color:'var(--fg-4)' }}><span className="w-1.5 h-1.5 rounded-full" style={{ background:'var(--green)' }} /> {auth.name} · Draft auto-saved</span>
              <div className="flex gap-3"><button type="button" style={st.btnGhost} onClick={() => setShowForm(false)}>Cancel</button><button type="submit" style={st.btn}>Submit Scene</button></div>
            </div>
          </form>
        </div>
      )}

      {/* TREASURY MODAL (L3) */}
      {showTreasury && (
        <div style={st.modal}><div style={st.modalBg} onClick={() => setShowTreasury(false)} />
          <div style={{ position:'relative', width:'100%', maxWidth:800, maxHeight:'85vh', background:'var(--bg-1)', border:'1px solid var(--border)', borderRadius:16, display:'flex', flexDirection:'column', overflow:'hidden' }}>
            <div className="p-6 flex justify-between items-center" style={{ borderBottom:'1px solid var(--border)' }}>
              <h2 className="text-lg font-bold uppercase tracking-tight">Treasury & Distribution</h2>
              <button onClick={() => setShowTreasury(false)} style={{ color:'var(--fg-4)', fontSize:20, background:'none', border:'none', cursor:'pointer' }}>✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4 scr">
              {Object.entries(treasury).sort((a,b) => b[1].cash - a[1].cash).map(([name, data]) => (
                <div key={name} className="p-4 rounded-lg flex flex-col sm:flex-row gap-4" style={{ background:'var(--bg-2)', border:'1px solid var(--border)' }}>
                  <div className="sm:w-1/3 sm:border-r sm:pr-4" style={{ borderColor:'var(--border)' }}>
                    <div className="font-bold text-sm mb-1">{name}</div>
                    <div className="text-xl font-mono" style={{ color:'var(--green)' }}>${data.cash.toLocaleString()}</div>
                  </div>
                  <div className="sm:w-2/3 flex flex-wrap gap-1.5">
                    {Object.entries(data.items).sort((a,b)=>b[1]-a[1]).map(([item, qty]) => (
                      <span key={item} className="px-2 py-1 rounded text-[10px]" style={{ background:'var(--bg-1)', border:'1px solid var(--border)' }}><span style={{ color:'var(--accent)', fontWeight:700 }}>{qty}x</span> <span style={{ color:'var(--fg-3)' }}>{item}</span></span>
                    ))}
                    {Object.keys(data.items).length === 0 && <span className="text-[10px] italic" style={{ color:'var(--fg-4)' }}>No items distributed</span>}
                  </div>
                </div>
              ))}
              {Object.keys(treasury).length === 0 && <div className="text-center py-8 text-sm" style={{ color:'var(--fg-4)' }}>No distribution data.</div>}
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
