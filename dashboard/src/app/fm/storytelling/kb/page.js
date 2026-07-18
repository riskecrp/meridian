"use client";
import { useEffect, useState, useMemo } from "react";
import { useAuth } from "../../../../lib/useAuth";
import { useDialog } from "../../../../lib/useDialog";
import { getLoreEntries, getCommandEntries, addKBEntry, editKBEntry, deleteKBEntry } from "../actions";
import StorytellingShell from "../_shared/Shell";

const inp = { width:'100%', background:'var(--bg-2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 12px', fontSize:13, color:'var(--fg-0)', outline:'none' };
const btn = { background:'var(--accent)', color:'white', border:'none', padding:'7px 16px', borderRadius:8, fontSize:11, fontWeight:700, cursor:'pointer' };

export default function KnowledgeBasePage() {
  const auth = useAuth();
  const { showConfirm, showForm: dialogForm } = useDialog();

  const [lore, setLore]   = useState([]);
  const [cmds, setCmds]   = useState([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch]         = useState("");
  const [activeFilter, setFilter]   = useState(null); // null=all, cat string, '__fav', '__mgmt'
  const [copied, setCopied]         = useState(null);
  const [favs, setFavs]             = useState([]);
  const [showForm, setShowForm]     = useState(false);
  const [formType, setFormType]     = useState('lore');
  const [editId, setEditId]         = useState(null);
  const [form, setForm]             = useState({ category:'', title:'', content:'', notes:'' });

  useEffect(() => {
    if (auth.loading) return;
    try { setFavs(JSON.parse(localStorage.getItem('meridian_kb_favs_' + auth.id) || "[]")); } catch(e) {}
    refresh();
  }, [auth.loading]);

  const refresh = async () => {
    setLoading(true);
    const [l, c] = await Promise.all([getLoreEntries(), getCommandEntries()]);
    setLore(l); setCmds(c); setLoading(false);
  };

  const copy = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1600);
  };

  const toggleFav = (uid) => {
    const next = favs.includes(uid) ? favs.filter(f => f !== uid) : [...favs, uid];
    setFavs(next);
    localStorage.setItem('meridian_kb_favs_' + auth.id, JSON.stringify(next));
  };

  const allItems = useMemo(() => [
    ...lore.map(i => ({ ...i, dtype:'lore', uid:`l-${i.id}` })),
    ...((auth.level >= 3 || auth.isEventTeam) ? cmds.map(i => ({ ...i, dtype:'command', uid:`c-${i.id}` })) : []),
  ], [lore, cmds, auth.level]);

  const categories = useMemo(() => {
    const cats = {};
    lore.forEach(i => { const c = i.category || 'General'; cats[c] = (cats[c]||0)+1; });
    return Object.entries(cats).sort((a,b) => a[0].localeCompare(b[0]));
  }, [lore]);

  const items = useMemo(() => {
    let filtered = allItems;
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(i => i.title?.toLowerCase().includes(q) || i.category?.toLowerCase().includes(q) || i.content?.toLowerCase().includes(q) || i.notes?.toLowerCase().includes(q));
    }
    if (activeFilter === '__fav') {
      filtered = filtered.filter(i => favs.includes(i.uid));
    } else if (activeFilter === '__mgmt') {
      filtered = filtered.filter(i => i.dtype === 'command');
    } else if (activeFilter) {
      filtered = filtered.filter(i => i.category === activeFilter && i.dtype !== 'command');
    } else {
      filtered = filtered.filter(i => i.dtype !== 'command');
    }
    return filtered.sort((a,b) => {
      const af = favs.includes(a.uid), bf = favs.includes(b.uid);
      if (af && !bf) return -1; if (!af && bf) return 1;
      return a.title.localeCompare(b.title);
    });
  }, [allItems, search, activeFilter, favs]);

  const openAdd = (type = 'lore') => {
    setFormType(type); setEditId(null); setForm({ category:'', title:'', content:'', notes:'' }); setShowForm(true);
  };
  const openEdit = (item) => {
    setFormType(item.dtype); setEditId(item.id); setForm({ category:item.category||'', title:item.title||'', content:item.content||'', notes:item.notes||'' }); setShowForm(true);
  };
  const handleSubmit = async () => {
    if (!form.title.trim()) return;
    if (editId) await editKBEntry(editId, form);
    else await addKBEntry(form, formType);
    setShowForm(false); setEditId(null); refresh();
  };

  if (auth.loading || loading) return <div className="p-10 text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading...</div>;

  const filterBtn = (id, label, color) => ({
    padding:'5px 13px', borderRadius:8, fontSize:11, fontWeight:600,
    cursor:'pointer', border:'none', flexShrink:0,
    background: activeFilter === id ? (color ? `rgba(${color},0.18)` : 'rgba(160,126,245,0.18)') : 'rgba(255,255,255,0.05)',
    color:       activeFilter === id ? (color ? `rgb(${color})` : 'var(--accent-h)') : 'var(--fg-2)',
    transition:'background 0.15s, color 0.15s',
  });

  return (
    <StorytellingShell title="Knowledge Base">
      {/* Controls */}
      <div style={{display:'flex', gap:8, marginBottom:10, flexShrink:0, alignItems:'center'}}>
        <input style={{...inp, flex:1}} placeholder="Search by title, content, category or notes…" value={search} onChange={e => setSearch(e.target.value)} />
        {(auth.level >= 2 || auth.isEventTeam) && <button style={btn} onClick={() => openAdd('lore')}>+ Entry</button>}
        {(auth.level >= 3 || auth.isEventTeam) && <button style={{...btn, background:'var(--green)'}} onClick={() => openAdd('command')}>+ Management</button>}
      </div>

      {/* Filter pills */}
      <div style={{display:'flex', gap:6, flexWrap:'wrap', marginBottom:14, flexShrink:0}}>
        <button style={filterBtn(null)} onClick={() => setFilter(null)}>
          All <span style={{opacity:.6, fontSize:10}}>({lore.length})</span>
        </button>
        {categories.map(([cat, count]) => (
          <button key={cat} style={filterBtn(cat)} onClick={() => setFilter(activeFilter === cat ? null : cat)}>
            {cat} <span style={{opacity:.6, fontSize:10}}>({count})</span>
          </button>
        ))}
        <button style={filterBtn('__fav', null, '251,191,36')} onClick={() => setFilter(activeFilter === '__fav' ? null : '__fav')}>
          ★ Favorites <span style={{opacity:.6, fontSize:10}}>({favs.length})</span>
        </button>
        {(auth.level >= 3 || auth.isEventTeam) && (
          <button style={filterBtn('__mgmt', null, '74,222,128')} onClick={() => setFilter(activeFilter === '__mgmt' ? null : '__mgmt')}>
            Management <span style={{opacity:.6, fontSize:10}}>({cmds.length})</span>
          </button>
        )}
      </div>

      {/* Card grid */}
      {items.length === 0 ? (
        <div style={{textAlign:'center', padding:'48px 20px', color:'var(--fg-4)', fontStyle:'italic', fontSize:13, border:'1px dashed var(--border)', borderRadius:12}}>
          {search ? 'No entries match your search.' : 'No entries in this category.'}
        </div>
      ) : (
        <div style={{height:'70vh', overflowY:'auto', display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:12, alignContent:'start', paddingBottom:16}} className="scr">
          {items.map(item => {
            const isFav = favs.includes(item.uid);
            const ic    = copied === item.uid;
            const isCmd = item.dtype === 'command';
            const hasContent = !!item.content;

            return (
              <div key={item.uid} style={{
                background: isFav ? 'rgba(251,191,36,0.06)' : isCmd ? 'rgba(74,222,128,0.05)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${isFav ? 'rgba(251,191,36,0.22)' : isCmd ? 'rgba(74,222,128,0.18)' : 'rgba(255,255,255,0.09)'}`,
                borderRadius:12,
                padding:14,
                display:'flex',
                flexDirection:'column',
                gap:8,
                transition:'border-color 0.15s',
              }}>
                {/* Top row: category + type badges + fav */}
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:6}}>
                  <div style={{display:'flex', gap:5, flexWrap:'wrap', flex:1}}>
                    {item.category && (
                      <span style={{fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', padding:'2px 7px', borderRadius:5, background:'rgba(255,255,255,0.07)', color:'var(--fg-2)', fontFamily:'var(--font-mono)'}}>
                        {item.category}
                      </span>
                    )}
                    {isCmd && (
                      <span style={{fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', padding:'2px 7px', borderRadius:5, background:'var(--green-bg)', color:'var(--green)', fontFamily:'var(--font-mono)'}}>
                        MGMT
                      </span>
                    )}
                  </div>
                  <button onClick={() => toggleFav(item.uid)} style={{color: isFav ? 'var(--amber)' : 'var(--fg-4)', background:'none', border:'none', cursor:'pointer', fontSize:16, lineHeight:1, padding:2, flexShrink:0, transition:'color 0.15s'}}>
                    {isFav ? '★' : '☆'}
                  </button>
                </div>

                {/* Title */}
                <div style={{fontSize:14, fontWeight:600, color:'var(--fg-0)', lineHeight:1.35, letterSpacing:'-0.01em'}}>
                  {item.title}
                </div>

                {/* Content block */}
                {hasContent && (
                  <div style={{
                    background:'rgba(0,0,0,0.25)',
                    border:'1px solid rgba(255,255,255,0.07)',
                    borderRadius:7,
                    padding:'8px 10px',
                    fontFamily:'var(--font-mono)',
                    fontSize:12,
                    color: isCmd ? 'var(--green)' : 'var(--accent-h)',
                    lineHeight:1.5,
                    wordBreak:'break-all',
                    whiteSpace:'pre-wrap',
                  }}>
                    {item.content}
                  </div>
                )}

                {/* Notes */}
                {item.notes && (
                  <div style={{fontSize:10, color:'var(--fg-4)', fontStyle:'italic', lineHeight:1.4}}>
                    {item.notes}
                  </div>
                )}

                {/* Actions */}
                <div style={{display:'flex', gap:6, marginTop:'auto', paddingTop:4}}>
                  <button
                    onClick={() => copy(item.content || item.title, item.uid)}
                    style={{
                      flex:1, padding:'8px', borderRadius:7, cursor:'pointer', border:'none',
                      background: ic ? 'var(--green)' : 'rgba(255,255,255,0.08)',
                      color: ic ? 'white' : 'var(--fg-1)',
                      fontSize:12, fontWeight:700,
                      transition:'background 0.15s, color 0.15s',
                    }}
                  >
                    {ic ? '✓ Copied' : 'Copy'}
                  </button>
                  {(auth.level >= 2 || auth.isEventTeam) && (
                    <>
                      <button
                        onClick={() => openEdit(item)}
                        style={{padding:'8px 12px', borderRadius:7, cursor:'pointer', border:'1px solid var(--border)', background:'transparent', color:'var(--fg-2)', fontSize:11, fontWeight:600}}
                      >Edit</button>
                      <button
                        onClick={async () => { if (await showConfirm(`Delete "${item.title}"?`)) { await deleteKBEntry(item.id); refresh(); } }}
                        style={{padding:'8px 10px', borderRadius:7, cursor:'pointer', border:'1px solid rgba(248,113,113,0.2)', background:'transparent', color:'var(--red)', fontSize:11, fontWeight:600}}
                      >Del</button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit modal */}
      {showForm && (
        <div style={{position:'fixed', inset:0, zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', padding:24}}>
          <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', backdropFilter:'blur(12px)'}} onClick={() => setShowForm(false)} />
          <div style={{position:'relative', width:'100%', maxWidth:520, background:'var(--bg-1)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden'}}>
            <div style={{padding:'14px 18px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <h3 style={{margin:0, fontSize:14, fontWeight:700}}>{editId ? 'Edit' : 'Add'} {formType === 'command' ? 'Management Entry' : 'KB Entry'}</h3>
              <button onClick={() => setShowForm(false)} style={{color:'var(--fg-4)', background:'none', border:'none', cursor:'pointer', fontSize:18, lineHeight:1}}>✕</button>
            </div>
            <div style={{padding:'16px 18px', display:'flex', flexDirection:'column', gap:12}}>
              <div>
                <div style={{fontSize:10, fontWeight:700, color:'var(--fg-4)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:5}}>Category</div>
                <input style={inp} value={form.category} onChange={e => setForm({...form, category:e.target.value})} placeholder="e.g. Addresses, Commands, Links" />
              </div>
              <div>
                <div style={{fontSize:10, fontWeight:700, color:'var(--fg-4)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:5}}>Title</div>
                <input style={inp} value={form.title} onChange={e => setForm({...form, title:e.target.value})} />
              </div>
              <div>
                <div style={{fontSize:10, fontWeight:700, color:'var(--fg-4)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:5}}>Content <span style={{fontWeight:400, textTransform:'none', letterSpacing:0, color:'var(--fg-4)'}}>(the value that gets copied)</span></div>
                <textarea rows={4} style={{...inp, resize:'vertical', minHeight:90}} value={form.content} onChange={e => setForm({...form, content:e.target.value})} placeholder="Address, command syntax, URL, etc." />
              </div>
              <div>
                <div style={{fontSize:10, fontWeight:700, color:'var(--fg-4)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:5}}>Notes <span style={{fontWeight:400, textTransform:'none', letterSpacing:0}}>(optional)</span></div>
                <input style={inp} value={form.notes} onChange={e => setForm({...form, notes:e.target.value})} />
              </div>
            </div>
            <div style={{padding:'12px 18px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'flex-end', gap:8}}>
              <button onClick={() => setShowForm(false)} style={{background:'transparent', color:'var(--fg-2)', border:'1px solid var(--border)', padding:'7px 16px', borderRadius:8, fontSize:11, fontWeight:600, cursor:'pointer'}}>Cancel</button>
              <button onClick={handleSubmit} style={btn}>Save</button>
            </div>
          </div>
        </div>
      )}
    </StorytellingShell>
  );
}
