"use client";
import { useEffect, useState, useMemo } from "react";
import { useAuth } from "../../../../lib/useAuth";
import { useDialog } from "../../../../lib/useDialog";
import StorytellingShell from "../_shared/Shell";
import { getSceneLibrary, addSceneLibraryEntry, editSceneLibraryEntry, deleteSceneLibraryEntry, getSceneLibraryFeedback, addSceneLibraryFeedback } from "../actions";
import { getFactionNames, getInventoryForScene, getStaffForScene, submitScene } from "../../scenes/actions";
import { ui } from "../../../../lib/ui.js";

const st = {
  ...ui,
  chip:     (active) => ({ padding:'4px 12px', borderRadius:20, fontSize:10, fontWeight:700, cursor:'pointer', border:'1px solid', textTransform:'uppercase', letterSpacing:'0.08em',
    background: active ? 'rgba(192,132,252,0.18)' : 'transparent',
    color: active ? 'var(--storytelling)' : 'var(--fg-4)',
    borderColor: active ? 'rgba(192,132,252,0.35)' : 'var(--border)',
  }),
};

const SORT_OPTIONS = [
  { value:'newest',    label:'Newest' },
  { value:'oldest',    label:'Oldest' },
  { value:'staff_asc', label:'Staff: Low → High' },
  { value:'staff_desc',label:'Staff: High → Low' },
  { value:'az',        label:'A → Z' },
];

const EMPTY_ENTRY = { title:'', description:'', staff_required:1, spawning_required:false, spawning_details:'', ped_required:false, proposed_rewards:'', tags:'' };
const EMPTY_SCENE = { faction:'', cash:'', items:[], otherRewards:'', notes:'', assistants:[] };

function StatusBadge({ status }) {
  const approved = status === 'approved';
  return (
    <span style={{
      display:'inline-block', padding:'2px 10px', borderRadius:20, fontSize:9, fontWeight:800,
      textTransform:'uppercase', letterSpacing:'0.12em',
      background: approved ? 'rgba(34,197,94,0.15)' : 'rgba(251,191,36,0.13)',
      color: approved ? 'var(--green)' : 'var(--amber)',
      border:`1px solid ${approved ? 'rgba(34,197,94,0.3)' : 'rgba(251,191,36,0.3)'}`,
    }}>
      {approved ? 'Approved' : 'Idea'}
    </span>
  );
}

function ReqStats({ staffRequired, spawningRequired, pedRequired }) {
  const col = (label, value, active, activeColor) => (
    <div style={{ textAlign:'center', padding:'6px 8px', flex:1 }}>
      <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.11em', color:'var(--fg-4)', marginBottom:3 }}>{label}</div>
      <div style={{ fontSize: label === 'Staff' ? 14 : 11, fontWeight:800, fontFamily:'var(--font-mono)', color: active ? activeColor : 'var(--fg-4)', opacity: active ? 1 : 0.4, lineHeight:1 }}>
        {value}
      </div>
    </div>
  );
  return (
    <div style={{ display:'flex', borderRadius:8, border:'1px solid var(--border)', background:'var(--bg-2)', overflow:'hidden' }}>
      {col('Staff', staffRequired, true, 'var(--accent)')}
      <div style={{ width:1, background:'var(--border)', flexShrink:0 }} />
      {col('Spawning', spawningRequired ? 'Yes' : 'No', !!spawningRequired, 'var(--amber)')}
      <div style={{ width:1, background:'var(--border)', flexShrink:0 }} />
      {col('Peds', pedRequired ? 'Yes' : 'No', !!pedRequired, '#60a5fa')}
    </div>
  );
}

function FilterGroup({ label, children }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
      <span style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.11em', color:'var(--fg-4)', whiteSpace:'nowrap' }}>{label}</span>
      <div style={{ display:'flex', gap:3 }}>{children}</div>
    </div>
  );
}

function FilterChip({ label, active, activeColor, activeBg, activeBorder, onClick }) {
  const color  = active ? (activeColor  || 'var(--storytelling)') : 'var(--fg-4)';
  const bg     = active ? (activeBg     || 'rgba(192,132,252,0.15)') : 'transparent';
  const border = active ? (activeBorder || 'rgba(192,132,252,0.35)') : 'var(--border)';
  return (
    <button onClick={onClick} style={{ padding:'3px 10px', borderRadius:20, fontSize:10, fontWeight:700, cursor:'pointer', border:'1px solid', textTransform:'uppercase', letterSpacing:'0.07em', background:bg, color, borderColor:border, transition:'all 0.1s' }}>
      {label}
    </button>
  );
}

export default function SceneLibraryPage() {
  const auth = useAuth();
  const { showConfirm, showAlert } = useDialog();

  // access tiers
  const canSuggest = auth.level >= 1 || auth.isLeadStoryteller; // L1+ and LST can add/suggest/add-to-faction
  const canEdit    = auth.level >= 2 || auth.isLeadStoryteller; // L2+/LST can approve/edit/delete
  const readOnly   = !canSuggest;

  const [scenes, setScenes]       = useState([]);
  const [factions, setFactions]   = useState([]);
  const [inventory, setInventory] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading]     = useState(true);

  // filters
  const [search, setSearch]       = useState('');
  const [statusF, setStatusF]     = useState('all');
  const [spawningF, setSpawningF] = useState('all'); // 'all' | 'yes' | 'no'
  const [pedF, setPedF]           = useState('all'); // 'all' | 'yes' | 'no'
  const [staffMax, setStaffMax]   = useState(0);     // 0 = any, N = max staff required
  const [sort, setSort]           = useState('newest');

  // entry modal (add/edit)
  const [entryModal, setEntryModal]   = useState(null); // null | 'add' | scene object
  const [entryForm, setEntryForm]     = useState(EMPTY_ENTRY);
  const [entrySaving, setEntrySaving] = useState(false);

  // add-to-faction modal
  const [sceneModal, setSceneModal]   = useState(null);
  const [sceneForm, setSceneForm]     = useState(EMPTY_SCENE);
  const [sceneSaving, setSceneSaving] = useState(false);

  // feedback modal
  const [feedbackModal, setFeedbackModal]     = useState(null); // scene object | null
  const [feedbackList, setFeedbackList]       = useState([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackText, setFeedbackText]       = useState('');
  const [feedbackSaving, setFeedbackSaving]   = useState(false);

  useEffect(() => {
    if (auth.loading) return;
    const sceneData = getSceneLibrary();
    if (!canSuggest) {
      sceneData.then(s => { setScenes(s); setLoading(false); });
    } else {
      Promise.all([sceneData, getFactionNames(), getInventoryForScene(), getStaffForScene()])
        .then(([s, f, i, st]) => { setScenes(s); setFactions(f); setInventory(i); setStaffList(st); setLoading(false); });
    }
  }, [auth.loading, canSuggest]);

  const refresh = async () => setScenes(await getSceneLibrary());

  const filtered = useMemo(() => {
    let out = [...scenes];
    if (statusF !== 'all') out = out.filter(s => s.status === statusF);
    if (spawningF === 'yes') out = out.filter(s => !!s.spawning_required);
    if (spawningF === 'no')  out = out.filter(s => !s.spawning_required);
    if (pedF === 'yes') out = out.filter(s => !!s.ped_required);
    if (pedF === 'no')  out = out.filter(s => !s.ped_required);
    if (staffMax > 0)   out = out.filter(s => s.staff_required <= staffMax);
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter(s =>
        s.title?.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q) ||
        s.tags?.toLowerCase().includes(q) ||
        s.spawning_details?.toLowerCase().includes(q)
      );
    }
    switch (sort) {
      case 'oldest':     out.sort((a,b) => new Date(a.created_at) - new Date(b.created_at)); break;
      case 'staff_asc':  out.sort((a,b) => a.staff_required - b.staff_required); break;
      case 'staff_desc': out.sort((a,b) => b.staff_required - a.staff_required); break;
      case 'az':         out.sort((a,b) => a.title.localeCompare(b.title)); break;
      default:           out.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    }
    return out;
  }, [scenes, statusF, spawningF, pedF, staffMax, search, sort]);

  // ── entry modal ──
  const openAdd  = () => { setEntryForm(EMPTY_ENTRY); setEntryModal('add'); };
  const openEdit = (s) => { setEntryForm({ title:s.title, status:s.status, description:s.description, staff_required:s.staff_required, spawning_required:!!s.spawning_required, spawning_details:s.spawning_details||'', ped_required:!!s.ped_required, proposed_rewards:s.proposed_rewards, tags:s.tags }); setEntryModal(s); };

  const saveEntry = async () => {
    if (!entryForm.title.trim()) return showAlert('A title is required.');
    setEntrySaving(true);
    const payload = entryModal === 'add'
      ? { ...entryForm, status:'idea' }
      : entryForm;
    const res = entryModal === 'add'
      ? await addSceneLibraryEntry(payload)
      : await editSceneLibraryEntry(entryModal.id, payload);
    setEntrySaving(false);
    if (res.ok) { setEntryModal(null); refresh(); }
    else showAlert('Error: ' + (res.error || 'Unknown'));
  };

  const handleDelete = async (scene) => {
    if (!await showConfirm(`Permanently delete "${scene.title}"?`)) return;
    await deleteSceneLibraryEntry(scene.id);
    refresh();
  };

  const handleApprove = async (scene) => {
    const newStatus = scene.status === 'approved' ? 'idea' : 'approved';
    await editSceneLibraryEntry(scene.id, { ...scene, status: newStatus, spawning_required: !!scene.spawning_required, spawning_details: scene.spawning_details||'', ped_required: !!scene.ped_required });
    refresh();
  };

  // ── scene log modal ──
  const openSceneModal = (scene) => {
    setSceneForm({ ...EMPTY_SCENE, notes:`[Library: ${scene.title}]\n\n` });
    setSceneModal(scene);
  };

  const toggleAssistant = (staff) => {
    setSceneForm(f => {
      const exists = f.assistants.some(a => a.staff_id === staff.discord_id);
      return { ...f, assistants: exists
        ? f.assistants.filter(a => a.staff_id !== staff.discord_id)
        : [...f.assistants, { staff_id:staff.discord_id, staff_name:staff.display_name }]
      };
    });
  };

  // ── feedback modal ──
  const openFeedback = async (scene) => {
    setFeedbackModal(scene);
    setFeedbackText('');
    setFeedbackLoading(true);
    setFeedbackList(await getSceneLibraryFeedback(scene.id));
    setFeedbackLoading(false);
  };

  const submitFeedback = async () => {
    if (!feedbackText.trim()) return showAlert('Please enter feedback before submitting.');
    setFeedbackSaving(true);
    const res = await addSceneLibraryFeedback(feedbackModal.id, feedbackText);
    setFeedbackSaving(false);
    if (res.ok) {
      setFeedbackText('');
      setFeedbackList(await getSceneLibraryFeedback(feedbackModal.id));
    } else showAlert('Error: ' + (res.error || 'Unknown'));
  };

  const submitSceneLog = async (e) => {
    e.preventDefault();
    if (!sceneForm.faction) return showAlert('Please select a faction.');
    setSceneSaving(true);
    const res = await submitScene(sceneForm);
    setSceneSaving(false);
    if (res.ok) { setSceneModal(null); setSceneForm(EMPTY_SCENE); await showAlert('Scene logged to Scene Intelligence.'); }
    else showAlert('Error: ' + (res.error || 'Unknown'));
  };

  if (auth.loading || loading) return (
    <div className="p-10 text-sm animate-pulse" style={{ color:'var(--storytelling)' }}>Loading scene library…</div>
  );

  return (
    <StorytellingShell title="Scene Library">
      <div style={{ display:'flex', flexDirection:'column', gap:14, paddingBottom:24, flex:1, overflowY:'auto' }} className="scr">

        {/* ── Controls ── */}
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>

          {/* Search + sort + actions */}
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            <input
              style={{ ...st.input, flex:'1', minWidth:180, maxWidth:340 }}
              placeholder="Search scenes…"
              value={search} onChange={e => setSearch(e.target.value)}
            />
            <select style={{ ...st.input, width:'auto', padding:'8px 12px', fontSize:11, cursor:'pointer' }} value={sort} onChange={e => setSort(e.target.value)}>
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <span style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--fg-4)', whiteSpace:'nowrap', marginLeft:'auto' }}>
              {filtered.length} scene{filtered.length !== 1 ? 's' : ''}
            </span>
            {canSuggest && <button style={st.btn} onClick={openAdd}>+ Add Scene</button>}
          </div>

          {/* Filter bar */}
          <div style={{ display:'flex', gap:14, alignItems:'center', flexWrap:'wrap', padding:'10px 14px', borderRadius:10, background:'var(--bg-2)', border:'1px solid var(--border)' }}>

            {/* Status */}
            <FilterGroup label="Status">
              {[['all','All'],['idea','Idea'],['approved','Approved']].map(([v,l]) => (
                <FilterChip key={v} label={l} active={statusF === v} onClick={() => setStatusF(v)} />
              ))}
            </FilterGroup>

            <div style={{ width:1, alignSelf:'stretch', background:'var(--border)' }} />

            {/* Spawning */}
            <FilterGroup label="Spawning">
              <FilterChip label="Any"  active={spawningF === 'all'} onClick={() => setSpawningF('all')} />
              <FilterChip label="Yes"  active={spawningF === 'yes'} activeColor="var(--amber)" activeBg="rgba(251,191,36,0.12)" activeBorder="rgba(251,191,36,0.35)" onClick={() => setSpawningF('yes')} />
              <FilterChip label="No"   active={spawningF === 'no'}  activeColor="var(--green)"  activeBg="rgba(34,197,94,0.11)"   activeBorder="rgba(34,197,94,0.3)"    onClick={() => setSpawningF('no')} />
            </FilterGroup>

            <div style={{ width:1, alignSelf:'stretch', background:'var(--border)' }} />

            {/* Peds */}
            <FilterGroup label="Peds">
              <FilterChip label="Any"  active={pedF === 'all'} onClick={() => setPedF('all')} />
              <FilterChip label="Yes"  active={pedF === 'yes'} activeColor="#60a5fa" activeBg="rgba(96,165,250,0.12)" activeBorder="rgba(96,165,250,0.35)" onClick={() => setPedF('yes')} />
              <FilterChip label="No"   active={pedF === 'no'}  activeColor="var(--green)"  activeBg="rgba(34,197,94,0.11)"   activeBorder="rgba(34,197,94,0.3)"    onClick={() => setPedF('no')} />
            </FilterGroup>

            <div style={{ width:1, alignSelf:'stretch', background:'var(--border)' }} />

            {/* Staff */}
            <FilterGroup label="Max Staff">
              {[[0,'Any'],[1,'1'],[2,'2'],[3,'3'],[4,'4'],[5,'5+']].map(([v,l]) => (
                <FilterChip key={v} label={l} active={staffMax === v} onClick={() => setStaffMax(v)} />
              ))}
            </FilterGroup>

          </div>
        </div>

        {/* ── Grid ── */}
        {filtered.length === 0 ? (
          <div className="empty-state">No scenes match your filters.</div>
        ) : (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(360px,1fr))', gap:14, alignContent:'start' }}>
            {filtered.map(scene => (
              <SceneCard
                key={scene.id}
                scene={scene}
                canSuggest={canSuggest}
                canEdit={canEdit}
                readOnly={readOnly}
                onAddToFaction={() => openSceneModal(scene)}
                onEdit={() => openEdit(scene)}
                onDelete={() => handleDelete(scene)}
                onApprove={() => handleApprove(scene)}
                onFeedback={() => openFeedback(scene)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Add / Edit modal ── */}
      {entryModal && (
        <div style={st.modal}>
          <div style={st.modalBg} onClick={() => setEntryModal(null)} />
          <div style={{ position:'relative', zIndex:1, width:'100%', maxWidth:620, maxHeight:'90vh', background:'var(--bg-1)', border:'1px solid var(--border)', borderRadius:16, display:'flex', flexDirection:'column', overflow:'hidden' }}>
            <div style={{ padding:'20px 24px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <h2 style={{ margin:0, fontSize:16, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.04em' }}>
                {entryModal === 'add' ? 'New Scene Idea' : 'Edit Scene'}
              </h2>
              <button onClick={() => setEntryModal(null)} style={{ color:'var(--fg-4)', fontSize:20, background:'none', border:'none', cursor:'pointer' }}>✕</button>
            </div>

            <div style={{ flex:1, overflowY:'auto', padding:'20px 24px' }} className="scr">
              <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

                {/* Title */}
                <input
                  style={st.input}
                  value={entryForm.title}
                  onChange={e => setEntryForm({...entryForm, title:e.target.value})}
                  placeholder="Scene title…"
                />

                {/* Status — edit only, not shown on add */}
                {entryModal !== 'add' && (
                  <div>
                    <label style={st.label}>Status</label>
                    <div style={{ display:'flex', gap:8 }}>
                      {[['idea','Idea'],['approved','Approved']].map(([v,l]) => (
                        <button key={v} type="button"
                          onClick={() => setEntryForm({...entryForm, status:v})}
                          style={{
                            flex:1, padding:'8px', borderRadius:8, fontSize:11, fontWeight:700, cursor:'pointer', border:'1px solid', textTransform:'uppercase', letterSpacing:'0.08em',
                            background: entryForm.status === v ? (v === 'approved' ? 'rgba(34,197,94,0.15)' : 'rgba(251,191,36,0.12)') : 'transparent',
                            color: entryForm.status === v ? (v === 'approved' ? 'var(--green)' : 'var(--amber)') : 'var(--fg-4)',
                            borderColor: entryForm.status === v ? (v === 'approved' ? 'rgba(34,197,94,0.35)' : 'rgba(251,191,36,0.35)') : 'var(--border)',
                          }}>
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Description */}
                <div>
                  <label style={st.label}>Description</label>
                  <textarea rows={4} style={{ ...st.input, resize:'vertical', minHeight:90 }}
                    value={entryForm.description}
                    onChange={e => setEntryForm({...entryForm, description:e.target.value})}
                    placeholder="Describe the scene concept…" />
                </div>

                {/* Requirements */}
                <div style={{ padding:'14px 16px', borderRadius:10, background:'var(--bg-2)', border:'1px solid var(--border)', display:'flex', flexDirection:'column', gap:12 }}>
                  <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.12em', color:'var(--fg-4)' }}>Requirements</div>

                  <div style={{ display:'flex', gap:20, alignItems:'center', flexWrap:'wrap' }}>
                    {/* Staff required — compact */}
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <label style={{ ...st.label, marginBottom:0, whiteSpace:'nowrap' }}>Staff Required</label>
                      <input type="number" min={1} max={20}
                        style={{ ...st.input, width:64, textAlign:'center', padding:'8px 6px' }}
                        value={entryForm.staff_required}
                        onChange={e => setEntryForm({...entryForm, staff_required:parseInt(e.target.value)||1})} />
                    </div>

                    {/* Checkboxes */}
                    {[['spawning_required','Spawning Required'],['ped_required','Ped Required']].map(([key, label]) => (
                      <label key={key} style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', userSelect:'none' }}>
                        <div onClick={() => setEntryForm(f => ({...f, [key]:!f[key]}))}
                          style={{ width:18, height:18, borderRadius:4, border:'2px solid', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0,
                            background: entryForm[key] ? 'var(--storytelling)' : 'transparent',
                            borderColor: entryForm[key] ? 'var(--storytelling)' : 'var(--border)',
                            transition:'all 0.1s' }}>
                          {entryForm[key] && <span style={{ color:'white', fontSize:11, lineHeight:1, fontWeight:900 }}>✓</span>}
                        </div>
                        <span style={{ fontSize:12, color:'var(--fg-2)', fontWeight:600 }}>{label}</span>
                      </label>
                    ))}
                  </div>

                  {/* Spawning details — shown only when spawning is required */}
                  {entryForm.spawning_required && (
                    <div>
                      <label style={st.label}>What needs to be spawned?</label>
                      <input style={st.input} placeholder="e.g. 2x Insurgent, prop crates, gang NPCs…"
                        value={entryForm.spawning_details}
                        onChange={e => setEntryForm({...entryForm, spawning_details:e.target.value})} />
                    </div>
                  )}

                  {/* Proposed rewards */}
                  <div>
                    <label style={st.label}>Proposed Rewards</label>
                    <input style={st.input} placeholder="e.g. $500, 2x item…"
                      value={entryForm.proposed_rewards}
                      onChange={e => setEntryForm({...entryForm, proposed_rewards:e.target.value})} />
                  </div>
                </div>

                {/* Tags */}
                <div>
                  <label style={st.label}>Tags <span style={{ textTransform:'none', fontWeight:400, letterSpacing:0 }}>(comma-separated)</span></label>
                  <input style={st.input} placeholder="e.g. outdoor, night, gang, vehicle"
                    value={entryForm.tags}
                    onChange={e => setEntryForm({...entryForm, tags:e.target.value})} />
                </div>

              </div>
            </div>

            <div style={{ padding:'16px 24px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'flex-end', gap:10 }}>
              <button style={st.btnGhost} onClick={() => setEntryModal(null)}>Cancel</button>
              <button style={st.btn} onClick={saveEntry} disabled={entrySaving}>
                {entrySaving ? 'Saving…' : entryModal === 'add' ? 'Add Scene' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add to Faction / Scene Log modal ── */}
      {sceneModal && (
        <div style={st.modal}>
          <div style={st.modalBg} onClick={() => setSceneModal(null)} />
          <form onSubmit={submitSceneLog} style={{ position:'relative', zIndex:1, width:'100%', maxWidth:900, maxHeight:'92vh', background:'var(--bg-1)', border:'1px solid var(--border)', borderRadius:16, display:'flex', flexDirection:'column', overflow:'hidden' }}>

            <div style={{ padding:'20px 24px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div>
                <h2 style={{ margin:'0 0 4px', fontSize:16, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.04em' }}>Log Scene to Faction</h2>
                <div style={{ fontSize:11, color:'var(--storytelling)', fontWeight:700 }}>{sceneModal.title}</div>
              </div>
              <button type="button" onClick={() => setSceneModal(null)} style={{ color:'var(--fg-4)', fontSize:20, background:'none', border:'none', cursor:'pointer', marginTop:2 }}>✕</button>
            </div>

            <div style={{ flex:1, overflowY:'auto', padding:'20px 24px' }} className="scr">
              <div style={{ display:'flex', flexDirection:'column', gap:20 }}>

                <div>
                  <label style={st.label}>Target Faction *</label>
                  <select required style={st.input} value={sceneForm.faction} onChange={e => setSceneForm({...sceneForm, faction:e.target.value})}>
                    <option value="">Select faction…</option>
                    {factions.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>

                {/* Rewards */}
                <div style={{ padding:'14px 16px', borderRadius:10, background:'var(--bg-2)', border:'1px solid var(--border)' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12, paddingBottom:10, borderBottom:'1px solid var(--border)' }}>
                    <div style={st.label}>Rewards & Inventory</div>
                    <button type="button" style={{ fontSize:10, color:'var(--accent)', background:'none', border:'none', cursor:'pointer', fontWeight:700 }}
                      onClick={() => setSceneForm(f => ({...f, items:[...f.items, {name:'',qty:1}]}))}>+ Add Item</button>
                  </div>
                  <div style={{ marginBottom:12 }}>
                    <label style={st.label}>Cash Reward</label>
                    <div style={{ position:'relative' }}>
                      <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', fontSize:13, color:'var(--fg-4)' }}>$</span>
                      <input type="number" style={{ ...st.input, paddingLeft:28 }} value={sceneForm.cash} onChange={e => setSceneForm({...sceneForm, cash:e.target.value})} />
                    </div>
                  </div>
                  {sceneForm.items.map((item, idx) => (
                    <div key={idx} style={{ display:'flex', gap:10, alignItems:'flex-end', marginBottom:10 }}>
                      <div style={{ flex:1 }}>
                        <label style={st.label}>Item</label>
                        <input list={`inv-${idx}`} style={st.input} placeholder="Type to search…" value={item.name}
                          onChange={e => { const n=[...sceneForm.items]; n[idx].name=e.target.value; setSceneForm({...sceneForm, items:n}); }} />
                        <datalist id={`inv-${idx}`}>{inventory.map((inv,i) => <option key={i} value={inv.name}>{`Stock: ${inv.current_stock}`}</option>)}</datalist>
                      </div>
                      <div style={{ width:76 }}>
                        <label style={st.label}>Qty</label>
                        <input type="number" min="1" style={{ ...st.input, textAlign:'center' }} value={item.qty}
                          onChange={e => { const n=[...sceneForm.items]; n[idx].qty=e.target.value; setSceneForm({...sceneForm, items:n}); }} />
                      </div>
                      <button type="button" style={{ color:'var(--red)', background:'none', border:'none', cursor:'pointer', padding:8, fontSize:14 }}
                        onClick={() => setSceneForm(f => ({...f, items:f.items.filter((_,i)=>i!==idx)}))}>✕</button>
                    </div>
                  ))}
                  {sceneModal.proposed_rewards && (
                    <div style={{ marginTop:8, padding:'6px 10px', borderRadius:6, background:'rgba(192,132,252,0.08)', border:'1px solid rgba(192,132,252,0.2)', fontSize:11, color:'var(--storytelling)' }}>
                      Proposed: {sceneModal.proposed_rewards}
                    </div>
                  )}
                  <div style={{ marginTop:12 }}>
                    <label style={st.label}>Other Rewards</label>
                    <input style={st.input} placeholder="e.g. 1x Declasse Tulip" value={sceneForm.otherRewards} onChange={e => setSceneForm({...sceneForm, otherRewards:e.target.value})} />
                  </div>
                </div>

                {/* Staff present */}
                <div>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                    <label style={{ ...st.label, marginBottom:0 }}>Also Present <span style={{ textTransform:'none', fontWeight:400, letterSpacing:0 }}>(optional)</span></label>
                    {sceneForm.assistants.length > 0 && <span style={{ fontSize:10, color:'var(--accent)', fontWeight:700 }}>{sceneForm.assistants.length} selected</span>}
                  </div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:5, padding:'8px 10px', borderRadius:8, border:'1px solid var(--border)', background:'var(--bg-2)', maxHeight:120, overflowY:'auto' }} className="scr">
                    {staffList.filter(s => s.discord_id !== auth.id).map(s => {
                      const selected = sceneForm.assistants.some(a => a.staff_id === s.discord_id);
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

                <div>
                  <label style={st.label}>Scene Notes / Feedback *</label>
                  <textarea required rows={5} style={{ ...st.input, resize:'vertical', minHeight:120 }}
                    value={sceneForm.notes} onChange={e => setSceneForm({...sceneForm, notes:e.target.value})} />
                </div>

              </div>
            </div>

            <div style={{ padding:'16px 24px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:10, fontFamily:'var(--font-mono)', color:'var(--fg-4)', display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ width:6, height:6, borderRadius:'50%', background:'var(--green)', display:'inline-block' }} />
                {auth.name}
              </span>
              <div style={{ display:'flex', gap:10 }}>
                <button type="button" style={st.btnGhost} onClick={() => setSceneModal(null)}>Cancel</button>
                <button type="submit" style={st.btn} disabled={sceneSaving}>{sceneSaving ? 'Submitting…' : 'Submit Scene'}</button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* ── Feedback modal ── */}
      {feedbackModal && (
        <div style={st.modal}>
          <div style={st.modalBg} onClick={() => setFeedbackModal(null)} />
          <div style={{ position:'relative', zIndex:1, width:'100%', maxWidth:620, maxHeight:'88vh', background:'var(--bg-1)', border:'1px solid var(--border)', borderRadius:16, display:'flex', flexDirection:'column', overflow:'hidden' }}>
            <div style={{ padding:'20px 24px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div>
                <h2 style={{ margin:'0 0 4px', fontSize:16, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.04em' }}>Scene Feedback</h2>
                <div style={{ fontSize:11, color:'var(--storytelling)', fontWeight:700 }}>{feedbackModal.title}</div>
              </div>
              <button type="button" onClick={() => setFeedbackModal(null)} style={{ color:'var(--fg-4)', fontSize:20, background:'none', border:'none', cursor:'pointer', marginTop:2 }}>✕</button>
            </div>

            <div style={{ flex:1, overflowY:'auto', padding:'20px 24px' }} className="scr">
              <div style={{ display:'flex', flexDirection:'column', gap:14 }}>

                {feedbackLoading ? (
                  <div style={{ fontSize:12, color:'var(--fg-4)', textAlign:'center', padding:'20px 0' }}>Loading feedback…</div>
                ) : feedbackList.length === 0 ? (
                  <div style={{ fontSize:12, color:'var(--fg-4)', textAlign:'center', padding:'20px 0', fontStyle:'italic' }}>No feedback yet — be the first to weigh in.</div>
                ) : (
                  feedbackList.map(f => (
                    <div key={f.id} style={{ padding:'12px 14px', borderRadius:10, background:'var(--bg-2)', border:'1px solid var(--border)' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                        <span style={{ fontSize:11, fontWeight:800, color:'var(--storytelling)' }}>{f.created_by}</span>
                        <span style={{ fontSize:9, fontFamily:'var(--font-mono)', color:'var(--fg-4)' }}>{new Date(f.created_at).toLocaleString()}</span>
                      </div>
                      <div style={{ fontSize:12, color:'var(--fg-2)', lineHeight:1.6, whiteSpace:'pre-wrap' }}>{f.feedback}</div>
                    </div>
                  ))
                )}

              </div>
            </div>

            <div style={{ padding:'16px 24px', borderTop:'1px solid var(--border)', display:'flex', flexDirection:'column', gap:10 }}>
              <textarea rows={3} style={{ ...st.input, resize:'vertical', minHeight:70 }}
                placeholder="Leave feedback for the creator…"
                value={feedbackText} onChange={e => setFeedbackText(e.target.value)} />
              <div style={{ display:'flex', justifyContent:'flex-end', gap:10 }}>
                <button type="button" style={st.btnGhost} onClick={() => setFeedbackModal(null)}>Close</button>
                <button type="button" style={st.btn} onClick={submitFeedback} disabled={feedbackSaving}>
                  {feedbackSaving ? 'Sending…' : 'Send Feedback'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </StorytellingShell>
  );
}

function SceneCard({ scene, canSuggest, canEdit, readOnly, onAddToFaction, onEdit, onDelete, onApprove, onFeedback }) {
  const tags = scene.tags ? scene.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
  const isApproved = scene.status === 'approved';
  const [expanded, setExpanded] = useState(false);
  const needsExpand = scene.description && (scene.description.length > 180 || scene.description.includes('\n'));

  return (
    <div style={{
      background:'var(--bg-1)', border:'1px solid var(--border)', borderRadius:12,
      display:'flex', flexDirection:'column', overflow:'hidden', transition:'border-color 0.15s',
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor='rgba(192,132,252,0.35)'}
      onMouseLeave={e => e.currentTarget.style.borderColor='var(--border)'}
    >
      {/* Status stripe */}
      <div style={{ height:3, background: isApproved
        ? 'linear-gradient(90deg,var(--green),transparent)'
        : 'linear-gradient(90deg,var(--amber),transparent)' }} />

      <div style={{ padding:'14px 16px', flex:1, display:'flex', flexDirection:'column', gap:10 }}>

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <StatusBadge status={scene.status} />
          <span style={{ fontSize:9, fontFamily:'var(--font-mono)', color:'var(--fg-4)' }}>
            {scene.created_by}
          </span>
        </div>

        <div style={{ fontSize:15, fontWeight:800, fontFamily:'var(--font-display)', letterSpacing:'-0.01em', color:'var(--fg-0)', lineHeight:1.25 }}>
          {scene.title}
        </div>

        {scene.description && (
          <div>
            <div style={{
              fontSize:12, color:'var(--fg-3)', lineHeight:1.6, whiteSpace:'pre-wrap',
              ...(!expanded && needsExpand ? { display:'-webkit-box', WebkitLineClamp:3, WebkitBoxOrient:'vertical', overflow:'hidden' } : {}),
            }}>
              {scene.description}
            </div>
            {needsExpand && (
              <button onClick={() => setExpanded(e => !e)} style={{ marginTop:4, fontSize:10, fontWeight:700, color:'var(--storytelling)', background:'none', border:'none', cursor:'pointer', padding:0, letterSpacing:'0.04em' }}>
                {expanded ? '↑ Show less' : '↓ Show more'}
              </button>
            )}
          </div>
        )}

        <ReqStats staffRequired={scene.staff_required} spawningRequired={scene.spawning_required} pedRequired={scene.ped_required} />

        {!!scene.spawning_required && scene.spawning_details && (
          <div style={{ padding:'6px 10px', borderRadius:6, background:'rgba(251,191,36,0.07)', border:'1px solid rgba(251,191,36,0.2)', display:'flex', gap:8, alignItems:'baseline' }}>
            <span style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'var(--amber)', whiteSpace:'nowrap', flexShrink:0 }}>Spawn</span>
            <span style={{ fontSize:11, color:'var(--fg-2)', fontFamily:'var(--font-mono)', lineHeight:1.4 }}>{scene.spawning_details}</span>
          </div>
        )}

        {scene.proposed_rewards && (
          <div style={{ fontSize:11, color:'var(--green)', fontFamily:'var(--font-mono)', display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'var(--fg-4)' }}>Rewards</span>
            {scene.proposed_rewards}
          </div>
        )}

        {tags.length > 0 && (
          <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
            {tags.map(tag => (
              <span key={tag} style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:4, textTransform:'uppercase', letterSpacing:'0.06em', background:'var(--bg-2)', color:'var(--fg-4)', border:'1px solid var(--border)' }}>{tag}</span>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding:'10px 16px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center', background:'rgba(255,255,255,0.015)', gap:6 }}>
        {canSuggest ? (
          <button
            style={{ ...st.btn, background:'rgba(192,132,252,0.15)', color:'var(--storytelling)', border:'1px solid rgba(192,132,252,0.3)', padding:'5px 12px', fontSize:10 }}
            onClick={onAddToFaction}>
            + Add to Faction
          </button>
        ) : (
          <span style={{ fontSize:10, fontFamily:'var(--font-mono)', color:'var(--fg-4)', fontStyle:'italic' }}>Read only</span>
        )}

        <div style={{ display:'flex', gap:4, alignItems:'center' }}>
          {canEdit && (
            <button
              onClick={onApprove}
              style={{
                fontSize:9, fontWeight:800, padding:'3px 10px', borderRadius:5, border:'1px solid', cursor:'pointer', textTransform:'uppercase', letterSpacing:'0.08em', transition:'all 0.1s',
                background: isApproved ? 'rgba(251,191,36,0.12)' : 'rgba(34,197,94,0.12)',
                color: isApproved ? 'var(--amber)' : 'var(--green)',
                borderColor: isApproved ? 'rgba(251,191,36,0.3)' : 'rgba(34,197,94,0.3)',
              }}>
              {isApproved ? '↩ Idea' : '✓ Approve'}
            </button>
          )}
          {canEdit && !isApproved && <button style={{ ...st.btnSm, color:'var(--storytelling)' }} onClick={onFeedback}>Feedback</button>}
          {canEdit && <button style={{ ...st.btnSm, color:'var(--fg-3)' }} onClick={onEdit}>Edit</button>}
          {canEdit && <button style={{ ...st.btnSm, color:'var(--red)' }} onClick={onDelete}>Del</button>}
        </div>
      </div>
    </div>
  );
}
