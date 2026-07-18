"use client";
import { useEffect, useState, useMemo } from "react";
import { useAuth } from "../../../../lib/useAuth";
import { useDialog } from "../../../../lib/useDialog";
import {
  getLoadouts, addWeapon, editWeapon, deleteWeapon,
  addAmmoCompat, removeAmmoCompat, addAttachmentCompat, removeAttachmentCompat,
  getAmmoList, getAttachmentList, getWeaponCategories,
  getSpawnItems, addSpawnItem, editSpawnItem, deleteSpawnItem,
} from "../actions";

const inp = { width:'100%', background:'var(--bg-2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 12px', fontSize:13, color:'var(--fg-0)', outline:'none' };
const btn = { background:'var(--accent)', color:'white', border:'none', padding:'7px 14px', borderRadius:8, fontSize:11, fontWeight:700, cursor:'pointer', letterSpacing:'0.02em', flexShrink:0 };

function catPill(active) {
  return { padding:'4px 12px', borderRadius:6, fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', cursor:'pointer', border:'none', transition:'background 0.15s, color 0.15s', background: active ? 'rgba(160,126,245,0.2)' : 'rgba(255,255,255,0.05)', color: active ? 'var(--accent-h)' : 'var(--fg-3)' };
}

function ammoColors(type) {
  const map = { Standard:['rgba(255,255,255,0.06)','var(--fg-3)'], AP:['var(--red-bg)','var(--red)'], FMJ:['var(--amber-bg)','var(--amber)'], HP:['var(--green-bg)','var(--green)'] };
  return map[type] || ['var(--accent-bg)','var(--accent)'];
}

export default function ArsenalPage() {
  const auth = useAuth();
  const { showConfirm, showForm, showAlert } = useDialog();
  const [tab, setTab] = useState('loadouts');

  // Loadout state
  const [loadouts, setLoadouts]             = useState([]);
  const [ammoOptions, setAmmoOptions]       = useState([]);
  const [attachOptions, setAttachOptions]   = useState([]);
  const [catFilter, setCatFilter]           = useState(null);
  const [loadoutSearch, setLoadoutSearch]   = useState('');
  const [expanded, setExpanded]             = useState(null);

  // Spawn state
  const [spawns, setSpawns]       = useState([]);
  const [spawnSearch, setSpawnSearch] = useState('');
  const [spawnQty, setSpawnQty]   = useState(1);
  const [copied, setCopied]       = useState(null);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (auth.loading) return;
    refresh();
  }, [auth.loading]);

  const refresh = async () => {
    setLoading(true);
    const base = [getLoadouts(), getAmmoList(), getAttachmentList()];
    const [l, a, at, sp] = await Promise.all([...base, ...((auth.level >= 3 || auth.isEventTeam) ? [getSpawnItems()] : [])]);
    setLoadouts(l); setAmmoOptions(a); setAttachOptions(at);
    if (sp) setSpawns(sp);
    setLoading(false);
  };

  const copy = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };

  const spawnCmd = (item, qty) => {
    const t = (item.item_type || '').toLowerCase();
    if (t === 'weapon' || t === 'ammo') return `/GetWeapon ${item.game_id} ${qty} 0`;
    if (t.includes('component') || t.includes('attachment')) return `/GetWeaponComponent ${item.game_id}`;
    return `/GetItem ${item.game_id} ${qty}`;
  };

  const filteredLoadouts = useMemo(() => {
    const q = loadoutSearch.toLowerCase();
    return loadouts
      .filter(w => !catFilter || w.weapon_category === catFilter)
      .filter(w => !q || w.weapon_name.toLowerCase().includes(q) || w.caliber?.toLowerCase().includes(q) || (w.ammo||[]).some(a => a.ammo_name.toLowerCase().includes(q)) || (w.attachments||[]).some(a => a.attachment_name.toLowerCase().includes(q)));
  }, [loadouts, catFilter, loadoutSearch]);

  const filteredSpawns = useMemo(() => {
    const q = spawnSearch.toLowerCase();
    return q ? spawns.filter(i => i.name?.toLowerCase().includes(q) || i.category?.toLowerCase().includes(q) || (i.game_id||'').includes(q)) : spawns;
  }, [spawns, spawnSearch]);

  if (auth.loading || loading) return <div className="p-10 text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading...</div>;

  const categories = [...new Set(loadouts.map(w => w.weapon_category))].filter(Boolean).sort();

  return (
    <div style={{display:'flex', flexDirection:'column', height:'100vh'}}>

      {/* ── Header ── */}
      <div className="page-hdr" style={{background:'linear-gradient(180deg,rgba(192,132,252,0.08) 0%,transparent 100%)'}}>
        <div className="accent-bar" style={{background:'linear-gradient(90deg,var(--storytelling) 0%,transparent 60%)'}} />
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:16}}>
          <div>
            <div className="page-hdr-tag" style={{color:'var(--storytelling)'}}>Storytelling / Arsenal</div>
            <h1>Arsenal</h1>
            <div className="page-hdr-sub">
              Weapon loadouts, ammo &amp; attachment compatibility{auth.level >= 3 || auth.isEventTeam ? ' · spawn commands' : ''}
            </div>
          </div>

          {/* Tab switcher */}
          <div style={{display:'flex', gap:3, background:'rgba(255,255,255,0.04)', border:'1px solid var(--border)', borderRadius:10, padding:3, marginTop:6, flexShrink:0}}>
            {[
              { id:'loadouts', label:'Loadouts', always:true },
              { id:'spawn',    label:'Spawn Commands', always:false },
            ].filter(t => t.always || auth.level >= 3 || auth.isEventTeam).map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                padding:'5px 14px', borderRadius:8, fontSize:11, fontWeight:600,
                cursor:'pointer', border:'none', letterSpacing:'0.01em',
                background: tab === t.id ? 'rgba(160,126,245,0.22)' : 'transparent',
                color:       tab === t.id ? 'var(--accent-h)'        : 'var(--fg-2)',
                transition: 'background 0.15s, color 0.15s',
                boxShadow:  tab === t.id ? 'inset 0 1px 0 rgba(255,255,255,0.08)' : 'none',
              }}>{t.label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Body — explicit height avoids flex-chain collapse in all browsers ── */}
      <div style={{height:'calc(100vh - 84px)', overflow:'hidden', display:'flex', flexDirection:'column', padding:'14px 24px 0'}}>

        {/* ══ LOADOUTS TAB ══ */}
        {tab === 'loadouts' && (
          <div style={{display:'flex', flexDirection:'column', flex:1, minHeight:0, gap:10}}>

            {/* Controls row */}
            <div style={{display:'flex', gap:8, flexShrink:0, alignItems:'center', flexWrap:'wrap'}}>
              <input style={{...inp, flex:1, minWidth:200}} placeholder="Search weapons, ammo, or attachments…" value={loadoutSearch} onChange={e => setLoadoutSearch(e.target.value)} />
              {(auth.level >= 2 || auth.isEventTeam) && (
                <button style={btn} onClick={async () => {
                  const cats = await getWeaponCategories();
                  const catOpts = cats.map(c => ({label:c, value:c}));
                  const calOpts = [...new Set(loadouts.map(w=>w.caliber).filter(Boolean))].sort().map(c=>({label:c,value:c}));
                  const res = await showForm("Add Weapon", [
                    {name:'name',     label:'Weapon Name', type:'text'},
                    {name:'category', label:'Category',    type:'select', options:[...catOpts, {label:'Other…',value:'__other'}], placeholder:'Select…'},
                    {name:'customCat',label:'Custom Category (if Other)', type:'text'},
                    {name:'caliber',  label:'Caliber',     type:'select', options:[...calOpts, {label:'None',value:''}, {label:'Other…',value:'__other_cal'}], placeholder:'Select…'},
                    {name:'customCal',label:'Custom Caliber (if Other)', type:'text'},
                  ]);
                  if (!res?.name) return;
                  await addWeapon({
                    name:     res.name,
                    category: res.category==='__other'    ? res.customCat : res.category||'',
                    caliber:  res.caliber==='__other_cal' ? res.customCal : res.caliber||'',
                  });
                  refresh();
                }}>+ Weapon</button>
              )}
            </div>

            {/* Category filter pills */}
            {categories.length > 0 && (
              <div style={{display:'flex', gap:5, flexWrap:'wrap', flexShrink:0}}>
                <button style={catPill(!catFilter)} onClick={() => setCatFilter(null)}>All</button>
                {categories.map(cat => (
                  <button key={cat} style={catPill(catFilter===cat)} onClick={() => setCatFilter(catFilter===cat ? null : cat)}>{cat}</button>
                ))}
              </div>
            )}

            {/* Weapon list — 70vh is simple and works everywhere */}
            <div style={{height:'70vh', overflowY:'auto', background:'rgba(255,255,255,0.025)', border:'1px solid rgba(255,255,255,0.09)', borderRadius:12}} className="scr">
              {filteredLoadouts.map(w => {
                const isExp = expanded === w.id;
                return (
                  <div key={w.id} style={{borderBottom:'1px solid rgba(255,255,255,0.06)', background: isExp ? 'rgba(160,126,245,0.05)' : 'transparent'}}>

                    {/* Weapon row */}
                    <div className="group" style={{display:'flex', alignItems:'center', gap:14, padding:'13px 18px', cursor:'pointer', minHeight:50}} onClick={() => setExpanded(isExp ? null : w.id)}>
                      <span style={{fontSize:10, fontWeight:700, textTransform:'uppercase', padding:'3px 9px', borderRadius:5, background:'rgba(255,255,255,0.07)', color:'var(--fg-2)', fontFamily:'var(--font-mono)', flexShrink:0, letterSpacing:'0.06em', whiteSpace:'nowrap'}}>{w.weapon_category}</span>
                      <span style={{fontSize:14, fontWeight:600, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{w.weapon_name}</span>
                      {w.caliber && <span style={{fontSize:10, fontWeight:700, padding:'3px 9px', borderRadius:5, background:'var(--accent-bg)', color:'var(--accent)', fontFamily:'var(--font-mono)', flexShrink:0}}>{w.caliber}</span>}
                      <span style={{fontSize:11, color:'var(--fg-3)', fontFamily:'var(--font-mono)', flexShrink:0, whiteSpace:'nowrap'}}>{(w.attachments||[]).length} att · {(w.ammo||[]).length} ammo</span>
                      {(auth.level >= 2 || auth.isEventTeam) && (
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity" style={{display:'flex', gap:6}} onClick={e => e.stopPropagation()}>
                          <button onClick={async () => {
                            const calOpts2 = [...new Set(loadouts.map(ww=>ww.caliber).filter(Boolean))].sort().map(c=>({label:c,value:c}));
                            const catOpts2 = [...new Set(loadouts.map(ww=>ww.weapon_category).filter(Boolean))].sort().map(c=>({label:c,value:c}));
                            const res = await showForm("Edit Weapon", [
                              {name:'name',     label:'Name',     type:'text',   default:w.weapon_name},
                              {name:'category', label:'Category', type:'select', options:[...catOpts2,{label:'Other…',value:'__other'}], default:w.weapon_category},
                              {name:'customCat',label:'Custom Category', type:'text'},
                              {name:'caliber',  label:'Caliber',  type:'select', options:[...calOpts2,{label:'None',value:''},{label:'Other…',value:'__other_cal'}], default:w.caliber},
                              {name:'customCal',label:'Custom Caliber', type:'text'},
                            ]);
                            if (res?.name) {
                              await editWeapon(w.id, {
                                name:     res.name,
                                category: res.category==='__other'    ? res.customCat : res.category||'',
                                caliber:  res.caliber==='__other_cal' ? res.customCal : res.caliber||'',
                              });
                              refresh();
                            }
                          }} style={{fontSize:10, color:'var(--accent)', background:'none', border:'none', cursor:'pointer', fontWeight:700}}>Edit</button>
                          <button onClick={async () => { if (await showConfirm('Delete ' + w.weapon_name + '?')) { await deleteWeapon(w.id); refresh(); } }} style={{fontSize:10, color:'var(--red)', background:'none', border:'none', cursor:'pointer', fontWeight:700}}>Del</button>
                        </div>
                      )}
                      <span style={{fontSize:10, color:'var(--fg-4)', transform:isExp?'rotate(180deg)':'none', transition:'transform 0.15s', flexShrink:0}}>▼</span>
                    </div>

                    {/* Expanded: attachments + ammo side by side */}
                    {isExp && (
                      <div style={{borderTop:'1px solid rgba(255,255,255,0.07)', padding:'16px 18px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:24, background:'rgba(0,0,0,0.15)'}}>

                        {/* Attachments */}
                        <div>
                          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:9}}>
                            <span style={{fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.18em', color:'var(--amber)', fontFamily:'var(--font-mono)'}}>Attachments</span>
                            {(auth.level >= 2 || auth.isEventTeam) && (
                              <button onClick={async () => {
                                const opts = attachOptions.filter(a => !(w.attachments||[]).some(x => x.attachment_name===a)).map(a => ({label:a,value:a}));
                                if (!opts.length) { await showAlert('All attachments already assigned.'); return; }
                                const res = await showForm("Add Attachment",[{name:'att',label:'Attachment',type:'select',options:opts,placeholder:'Select…'}]);
                                if (res?.att) { await addAttachmentCompat(w.id, res.att); refresh(); }
                              }} style={{fontSize:9, fontWeight:700, color:'var(--amber)', background:'rgba(251,191,36,0.08)', border:'1px solid rgba(251,191,36,0.2)', borderRadius:5, padding:'2px 9px', cursor:'pointer', letterSpacing:'0.04em'}}>+ Add</button>
                            )}
                          </div>
                          <div style={{display:'flex', flexWrap:'wrap', gap:5}}>
                            {(w.attachments||[]).map(a => (
                              <span key={a.id} className="group/att" style={{display:'inline-flex', alignItems:'center', gap:4, fontSize:11, padding:'4px 9px', borderRadius:6, background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.08)', color:'var(--fg-1)'}}>
                                {a.attachment_name}
                                {(auth.level >= 2 || auth.isEventTeam) && <button onClick={async()=>{if(await showConfirm('Remove?')){await removeAttachmentCompat(a.id);refresh();}}} className="opacity-0 group-hover/att:opacity-100 transition-opacity" style={{color:'var(--red)',background:'none',border:'none',cursor:'pointer',fontSize:10,lineHeight:1}}>✕</button>}
                              </span>
                            ))}
                            {!(w.attachments||[]).length && <span style={{fontSize:11, color:'var(--fg-4)', fontStyle:'italic'}}>None assigned</span>}
                          </div>
                        </div>

                        {/* Ammo */}
                        <div>
                          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:9}}>
                            <span style={{fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.18em', color:'var(--fg-3)', fontFamily:'var(--font-mono)'}}>Compatible Ammo</span>
                            {(auth.level >= 2 || auth.isEventTeam) && (
                              <button onClick={async () => {
                                const opts = ammoOptions.filter(a => !(w.ammo||[]).some(x => x.ammo_name===a)).map(a => ({label:a,value:a}));
                                if (!opts.length) { await showAlert('All ammo types already assigned.'); return; }
                                const res = await showForm("Add Compatible Ammo",[{name:'ammo',label:'Ammo Type',type:'select',options:opts,placeholder:'Select…'}]);
                                if (res?.ammo) { await addAmmoCompat(w.id, res.ammo); refresh(); }
                              }} style={{fontSize:9, fontWeight:700, color:'var(--accent)', background:'var(--accent-bg)', border:'1px solid rgba(160,126,245,0.2)', borderRadius:5, padding:'2px 9px', cursor:'pointer', letterSpacing:'0.04em'}}>+ Add</button>
                            )}
                          </div>
                          <div style={{display:'flex', flexDirection:'column', gap:4}}>
                            {(w.ammo||[]).map(a => {
                              const [bg, col] = ammoColors(a.ammo_type);
                              return (
                                <div key={a.id} className="group/ammo" style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'5px 9px', borderRadius:6, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.07)'}}>
                                  <div style={{display:'flex', alignItems:'center', gap:7}}>
                                    <span style={{fontSize:8, fontWeight:700, padding:'2px 6px', borderRadius:4, background:bg, color:col, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.06em'}}>{a.ammo_type}</span>
                                    <span style={{fontSize:12}}>{a.ammo_name}</span>
                                  </div>
                                  {(auth.level >= 2 || auth.isEventTeam) && <button onClick={async()=>{if(await showConfirm('Remove this ammo?')){await removeAmmoCompat(a.id);refresh();}}} className="opacity-0 group-hover/ammo:opacity-100 transition-opacity" style={{color:'var(--red)',background:'none',border:'none',cursor:'pointer',fontSize:10}}>✕</button>}
                                </div>
                              );
                            })}
                            {!(w.ammo||[]).length && <span style={{fontSize:11, color:'var(--fg-4)', fontStyle:'italic'}}>No ammo assigned</span>}
                          </div>
                        </div>

                      </div>
                    )}
                  </div>
                );
              })}
              {!filteredLoadouts.length && !loadouts.length && <div style={{padding:'40px 20px', textAlign:'center', color:'var(--fg-4)', fontStyle:'italic', fontSize:12}}>No weapons in the database yet.</div>}
              {!filteredLoadouts.length && loadouts.length > 0 && <div style={{padding:'40px 20px', textAlign:'center', color:'var(--fg-4)', fontStyle:'italic', fontSize:12}}>No weapons match your search or filter.</div>}
            </div>
          </div>
        )}

        {/* ══ SPAWN COMMANDS TAB (L3) ══ */}
        {tab === 'spawn' && (auth.level >= 3 || auth.isEventTeam) && (
          <div style={{display:'flex', flexDirection:'column', flex:1, minHeight:0, gap:10}}>

            {/* Controls */}
            <div style={{display:'flex', gap:8, flexShrink:0, alignItems:'center'}}>
              <input style={{...inp, flex:1}} placeholder="Search items, categories, or game IDs…" value={spawnSearch} onChange={e => setSpawnSearch(e.target.value)} />
              {/* Qty picker */}
              <div style={{display:'flex', alignItems:'center', gap:8, padding:'0 12px', borderRadius:8, background:'var(--accent-bg)', border:'1px solid rgba(160,126,245,0.2)', height:38, flexShrink:0}}>
                <span style={{fontSize:10, fontWeight:700, color:'var(--accent)', fontFamily:'var(--font-mono)'}}>QTY</span>
                <input type="number" min="1" value={spawnQty} onChange={e => setSpawnQty(e.target.value)} style={{width:42, textAlign:'center', background:'transparent', border:'none', fontSize:14, fontWeight:700, color:'var(--fg-0)', fontFamily:'var(--font-mono)', outline:'none'}} />
              </div>
              <button style={btn} onClick={async () => {
                const res = await showForm("Add Spawn Item", [
                  {name:'name',     label:'Name',     type:'text'},
                  {name:'gameId',   label:'Game ID',  type:'text'},
                  {name:'category', label:'Category', type:'text'},
                  {name:'itemType', label:'Type',     type:'select', options:[{label:'Item',value:'item'},{label:'Weapon',value:'weapon'},{label:'Ammo',value:'ammo'},{label:'Component',value:'component'}]},
                ]);
                if (res?.name) { await addSpawnItem(res); refresh(); }
              }}>+ Item</button>
            </div>

            {/* Spawn table — 75vh is simple and always works */}
            <div className="sec-card scr" style={{height:'75vh', overflowY:'auto'}}>
              <table className="dtable">
                <thead style={{position:'sticky', top:0, zIndex:2, background:'var(--bg-2)'}}>
                  <tr>
                    <th style={{width:110}}>Category</th>
                    <th>Name</th>
                    <th style={{width:140}}>Game ID</th>
                    <th style={{width:260}}>Command</th>
                    <th style={{width:100}}></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSpawns.map((item, idx) => {
                    const cmd = spawnCmd(item, spawnQty);
                    const ic  = copied === `sp-${idx}`;
                    return (
                      <tr key={item.id ?? idx} className="group">
                        <td style={{color:'var(--fg-3)', fontFamily:'var(--font-mono)', fontSize:10}}>{item.category}</td>
                        <td style={{fontWeight:500}}>{item.name}</td>
                        <td style={{fontFamily:'var(--font-mono)', fontSize:11, color:'var(--fg-3)'}}>{item.game_id}</td>
                        <td>
                          <code style={{fontSize:10, fontFamily:'var(--font-mono)', color:'var(--fg-2)', background:'rgba(255,255,255,0.04)', padding:'2px 7px', borderRadius:5}}>{cmd}</code>
                        </td>
                        <td>
                          <div style={{display:'flex', gap:5, alignItems:'center'}}>
                            <button onClick={() => copy(cmd, `sp-${idx}`)} style={{fontSize:10, fontWeight:700, padding:'4px 10px', borderRadius:6, cursor:'pointer', border:'none', background:ic?'var(--green)':'rgba(255,255,255,0.07)', color:ic?'white':'var(--fg-2)', minWidth:46, transition:'background 0.15s'}}>
                              {ic ? '✓' : 'Copy'}
                            </button>
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity" style={{display:'flex', gap:3}}>
                              <button onClick={async()=>{const res=await showForm("Edit",[{name:'name',label:'Name',type:'text',default:item.name},{name:'gameId',label:'Game ID',type:'text',default:item.game_id},{name:'category',label:'Category',type:'text',default:item.category},{name:'itemType',label:'Type',type:'select',default:item.item_type,options:[{label:'Item',value:'item'},{label:'Weapon',value:'weapon'},{label:'Ammo',value:'ammo'},{label:'Component',value:'component'}]}]);if(res?.name){await editSpawnItem(item.id,res);refresh();}}} style={{fontSize:10,color:'var(--accent)',background:'none',border:'none',cursor:'pointer',fontWeight:700}}>✎</button>
                              <button onClick={async()=>{if(await showConfirm(`Delete "${item.name}"?`)){await deleteSpawnItem(item.id);refresh();}}} style={{fontSize:10,color:'var(--red)',background:'none',border:'none',cursor:'pointer',fontWeight:700}}>✕</button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!filteredSpawns.length && <div className="empty-state" style={{margin:'16px'}}>No items match your search.</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
