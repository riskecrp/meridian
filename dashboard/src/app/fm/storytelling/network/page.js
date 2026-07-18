"use client";
import { useEffect, useState, useMemo } from "react";
import { useAuth } from "../../../../lib/useAuth";
import { useDialog } from "../../../../lib/useDialog";
import dynamic from "next/dynamic";
import { getNPCs, getTurfs, addNPC, editNPC, deleteNPC, updateTurf, disbandTurf } from "../actions";
import { s } from "../_shared/styles";
import StorytellingShell from "../_shared/Shell";

const GTAMap = dynamic(() => import("../../../../lib/GTAMap"), { ssr: false, loading: () => <div style={{height:400,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--fg-4)"}}>Loading map...</div> });

export default function NetworkPage() {
  const auth = useAuth();
  const { showConfirm } = useDialog();

  const [npcs, setNpcs] = useState([]);
  const [turfs, setTurfs] = useState([]);
  const [loading, setLoading] = useState(true);

  const [npcSearch, setNpcSearch] = useState("");
  const [npcFilter, setNpcFilter] = useState(null);
  const [mapView, setMapView] = useState(false);
  const [mapTurf, setMapTurf] = useState(null);
  const [showNPCForm, setShowNPCForm] = useState(false);
  const [npcEditId, setNpcEditId] = useState(null);
  const [npcForm, setNpcForm] = useState({ name:'',position:'',type:'',turf:'' });
  const [showTurfForm, setShowTurfForm] = useState(false);
  const [turfForm, setTurfForm] = useState({ oldTurf:'',newTurf:'',power:'' });
  const [copied, setCopied] = useState(null);

  const canAccess = !auth.loading && (auth.level >= 2 || auth.isEventTeam || auth.isLeadStoryteller);

  useEffect(() => {
    if (auth.loading || !canAccess) return;
    refresh();
  }, [auth.loading, canAccess]);

  const refresh = async () => { setLoading(true); const [n, t] = await Promise.all([getNPCs(), getTurfs()]); setNpcs(n); setTurfs(t); setLoading(false); };

  const copy = (text, id) => { navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(null), 1500); };

  const handleNPCSubmit = async () => {
    if(!npcForm.name.trim()) return;
    const submitData = {...npcForm, type: npcForm.type === '__new' ? (npcForm.customType||'').trim() : npcForm.type, turf: npcForm.turf || 'Neutral'};
    if(npcEditId) await editNPC(npcEditId, submitData);
    else await addNPC(submitData);
    setShowNPCForm(false); setNpcEditId(null); setNpcForm({name:'',position:'',type:'',turf:'Neutral'});
    refresh();
  };
  const handleTurfSubmit = async () => {
    if(!turfForm.newTurf.trim()) return;
    await updateTurf(turfForm.oldTurf, turfForm.newTurf, turfForm.power);
    setShowTurfForm(false); refresh();
  };

  const npcNetwork = useMemo(() => {
    const net = {};
    // Seed from the turfs table so turfs with no NPCs yet still show up.
    turfs.forEach(t => { const nm=(t.name||'').trim(); if(!nm||nm==='Neutral'||nm==='Unaffiliated')return; if(!net[nm])net[nm]={name:nm,power:t.shipment_power||'',npcs:[]}; });
    npcs.forEach(n => { let t=(n.turf||'').trim()||'Neutral'; if(t.toLowerCase()==='neutral')t='Neutral'; if(!net[t])net[t]={name:t,power:n.shipment_power||'',npcs:[]}; net[t].npcs.push(n); });
    const q = npcSearch.toLowerCase();
    const all = Object.values(net)
      .filter(t=>t.name.toLowerCase().includes(q)||t.npcs.some(n=>n.name.toLowerCase().includes(q)||(n.npc_type||'').toLowerCase().includes(q)))
      .sort((a,b)=>{ if(a.name==='Neutral')return 1; if(b.name==='Neutral')return -1; return a.name.localeCompare(b.name); });
    return { all };
  }, [npcs, turfs, npcSearch]);

  const npcCounts = useMemo(() => npcs.reduce((a,n) => { const t = (n.npc_type||'Unknown').trim(); a[t] = (a[t]||0)+1; return a; }, {}), [npcs]);
  const neutralCount = useMemo(() => npcs.filter(n => (n.turf||'').trim().toLowerCase() === 'neutral').length, [npcs]);
  const flatFiltered = useMemo(() => {
    if (!npcFilter) return [];
    if (npcFilter === '__neutral') return npcs.filter(n => (n.turf||'').trim().toLowerCase() === 'neutral').sort((a,b) => a.name.localeCompare(b.name));
    return npcs.filter(n => (n.npc_type||'').trim().toLowerCase() === npcFilter.toLowerCase()).sort((a,b) => a.name.localeCompare(b.name));
  }, [npcs, npcFilter]);

  if (auth.loading) return <div className="p-10 text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading...</div>;
  if (!canAccess) return <div className="p-10 text-sm" style={{color:'var(--red)'}}>Access denied. L2+ required.</div>;
  if (loading) return <div className="p-10 text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading...</div>;

  const renderNPCRow = (n) => {
    const cmd = `/tppos ${n.position}`; const ic = copied === `npc-${n.id}`;
    return (
      <div key={n.id} className="flex items-center justify-between py-2 px-4 group" style={{borderBottom:'1px solid var(--border)'}}>
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-[10px] font-bold uppercase w-24 shrink-0" style={{color:'var(--fg-4)'}}>{n.npc_type}</span>
          <span className="text-sm font-medium truncate">{n.name}</span>
          {npcFilter && <span className="text-[10px] px-2 py-0.5 rounded" style={{background:'var(--accent-bg)',color:'var(--accent)'}}>{n.turf}</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] font-mono hidden md:block" style={{color:'var(--fg-4)'}}>{n.position}</span>
          <button onClick={() => copy(cmd, `npc-${n.id}`)} className="px-2.5 py-1 rounded text-[10px] font-bold" style={{background: ic ? 'var(--green)' : 'var(--bg-3)', color: ic ? 'white' : 'var(--fg-3)', minWidth:55, textAlign:'center'}}>{ic ? 'Done' : 'TP'}</button>
          {auth.level >= 3 && (
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => { setNpcEditId(n.id); setNpcForm({name:n.name,position:n.position,type:n.npc_type,turf:n.turf||'Neutral'}); setShowNPCForm(true); }} style={{...s.btnSm,color:'var(--accent)'}}>Edit</button>
              <button onClick={async () => { if(await showConfirm(`Delete "${n.name}"?`)){await deleteNPC(n.id);refresh();} }} style={{...s.btnSm,color:'var(--red)'}}>Del</button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <StorytellingShell title="NPC Ecosystem">
      <div className="flex flex-col md:flex-row gap-2 justify-between items-center mb-3 shrink-0">
        <input style={{ ...s.input, maxWidth:350 }} placeholder="Search turfs or NPCs..." value={npcSearch} onChange={e => setNpcSearch(e.target.value)} />
        <div className="flex gap-2">
          <button onClick={() => { setMapView(!mapView); setMapTurf(null); }} style={{ ...s.btnGhost, color: mapView ? 'var(--accent)' : 'var(--fg-3)' }}>{mapView ? '📋 List' : '🗺️ Map'}</button>
          {auth.level>=3 && <button style={s.btn} onClick={() => { setTurfForm({oldTurf:'',newTurf:'',power:''}); setShowTurfForm(true); }}>+ Turf</button>}
          {auth.level>=3 && <button style={s.btnGhost} onClick={() => { setNpcEditId(null); setNpcForm({name:'',position:'',type:'',turf:'Neutral'}); setShowNPCForm(true); }}>+ NPC</button>}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-3 shrink-0">
        {Object.entries(npcCounts).map(([type,count]) => (
          <button key={type} onClick={() => setNpcFilter(npcFilter===type?null:type)} className="px-2.5 py-1 rounded text-[10px] font-bold uppercase" style={{ background: npcFilter===type ? 'var(--accent)' : 'var(--bg-1)', color: npcFilter===type ? 'white' : 'var(--fg-3)', border:'1px solid var(--border)' }}>{count} {type}</button>
        ))}
        {neutralCount > 0 && (
          <button onClick={() => setNpcFilter(npcFilter==='__neutral'?null:'__neutral')} className="px-2.5 py-1 rounded text-[10px] font-bold uppercase" style={{ background: npcFilter==='__neutral' ? 'var(--red)' : 'var(--bg-1)', color: npcFilter==='__neutral' ? 'white' : 'var(--red)', border:'1px solid var(--red-bg)' }}>{neutralCount} Neutral</button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto scr pb-10">
        {mapView && (
          <div className="mb-4">
            <GTAMap
              npcs={npcFilter ? npcs.filter(n=>(n.npc_type||'').trim().toLowerCase()===npcFilter?.toLowerCase()) : npcs}
              selectedTurf={mapTurf}
              height={500}
              onCopyTP={(cmd) => { setCopied('map-tp'); setTimeout(() => setCopied(null), 2000); }}
            />
            <div className="flex flex-wrap gap-1.5 mt-3">
              <button onClick={() => setMapTurf(null)} className="px-2.5 py-1 rounded text-[10px] font-bold" style={{ background: !mapTurf ? 'var(--accent)' : 'var(--bg-1)', color: !mapTurf ? 'white' : 'var(--fg-3)', border:'1px solid var(--border)' }}>All NPCs</button>
              {Object.keys(npcs.reduce((a,n) => { a[(n.turf||'Neutral').trim()] = 1; return a; }, {})).sort().map(t => (
                <button key={t} onClick={() => setMapTurf(t)} className="px-2.5 py-1 rounded text-[10px] font-bold" style={{ background: mapTurf===t ? 'var(--accent)' : 'var(--bg-1)', color: mapTurf===t ? 'white' : 'var(--fg-3)', border:'1px solid var(--border)' }}>{t}</button>
              ))}
            </div>
          </div>
        )}
        {!mapView && npcFilter ? (
          <div className="rounded-lg overflow-hidden" style={{background:'var(--bg-1)',border:`1px solid ${npcFilter==='__neutral'?'var(--red-bg)':'var(--border)'}`}}>
            <div className="px-4 py-2.5 flex justify-between items-center" style={{background:npcFilter==='__neutral'?'var(--red-bg)':'var(--accent-bg)'}}>
              <span className="font-bold text-sm" style={{color:npcFilter==='__neutral'?'var(--red)':'var(--accent)'}}>Viewing: {npcFilter==='__neutral'?'Neutral Dealers':npcFilter}</span>
              <button style={s.btnGhost} onClick={() => setNpcFilter(null)}>Clear</button>
            </div>
            {flatFiltered.map(renderNPCRow)}
          </div>
        ) : (!mapView && <>
          {npcNetwork.all.map(turf => {
            const isNeutral = turf.name === 'Neutral';
            return (
              <div key={turf.name} className="rounded-lg overflow-hidden mb-4" style={{background:'var(--bg-1)',border:`1px solid ${isNeutral?'var(--red-bg)':'var(--border)'}`}}>
                <div className="px-4 py-2.5 flex justify-between items-center group" style={{background:isNeutral?'var(--red-bg)':'var(--bg-2)'}}>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm italic" style={{color:isNeutral?'var(--red)':'var(--accent)'}}>{turf.name}</span>
                    {!isNeutral && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{background:'var(--accent-bg)',color:'var(--accent)'}}>PWR:{turf.power}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px]" style={{color:'var(--fg-4)'}}>{turf.npcs.length}</span>
                    {auth.level>=3 && !isNeutral && (
                      <div className="opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
                        <button onClick={() => { setTurfForm({oldTurf:turf.name,newTurf:turf.name,power:turf.power}); setShowTurfForm(true); }} style={{...s.btnSm,color:'var(--fg-3)'}}>Edit</button>
                        <button onClick={async () => { if(await showConfirm(`Disband "${turf.name}"?`)){await disbandTurf(turf.name);refresh();} }} style={{...s.btnSm,color:'var(--red)'}}>Disband</button>
                      </div>
                    )}
                  </div>
                </div>
                {turf.npcs.map(renderNPCRow)}
              </div>
            );
          })}
        </>)}
      </div>

      {/* NPC FORM MODAL */}
      {showNPCForm && (
        <div style={s.modal}>
          <div style={s.modalBg} onClick={() => setShowNPCForm(false)} />
          <div style={{ position:'relative', width:'100%', maxWidth:450, background:'var(--bg-1)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
            <div className="p-4 flex justify-between" style={{ borderBottom:'1px solid var(--border)' }}>
              <h3 className="font-bold uppercase text-sm">{npcEditId ? 'Edit' : 'Add'} NPC</h3>
              <button onClick={() => setShowNPCForm(false)} style={{ color:'var(--fg-4)', background:'none', border:'none', cursor:'pointer', fontSize:16 }}>✕</button>
            </div>
            <div className="p-4 space-y-3">
              <div><div style={s.label}>Name</div><input style={s.input} value={npcForm.name} onChange={e => setNpcForm({...npcForm, name:e.target.value})} /></div>
              <div><div style={s.label}>TP Position</div><input style={s.input} value={npcForm.position} onChange={e => setNpcForm({...npcForm, position:e.target.value})} /></div>
              <div>
                <div style={s.label}>NPC Type</div>
                <select style={s.input} value={npcForm.type} onChange={e => setNpcForm({...npcForm, type:e.target.value})}>
                  <option value="">Select type...</option>
                  {[...new Set(npcs.map(n=>(n.npc_type||'').trim()).filter(Boolean))].sort().map(t => <option key={t} value={t}>{t}</option>)}
                  {auth.level>=3 ? <option value="__new">+ New Type...</option> : null}
                </select>
                {npcForm.type==='__new' && <input style={{...s.input,marginTop:8}} placeholder="Enter new type name..." onChange={e => setNpcForm({...npcForm, customType:e.target.value})} />}
              </div>
              <div>
                <div style={s.label}>Turf</div>
                <select style={s.input} value={npcForm.turf} onChange={e => setNpcForm({...npcForm, turf:e.target.value})}>
                  <option value="Neutral">Neutral</option>
                  {[...new Set([...turfs.map(t=>(t.name||'').trim()), ...npcs.map(n=>(n.turf||'').trim())].filter(t=>t&&t!=='Neutral'))].sort().map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="p-4 flex justify-end gap-2" style={{ borderTop:'1px solid var(--border)' }}>
              <button style={s.btnGhost} onClick={() => setShowNPCForm(false)}>Cancel</button>
              <button style={s.btn} onClick={handleNPCSubmit}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* TURF FORM MODAL */}
      {showTurfForm && (
        <div style={s.modal}>
          <div style={s.modalBg} onClick={() => setShowTurfForm(false)} />
          <div style={{ position:'relative', width:'100%', maxWidth:400, background:'var(--bg-1)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
            <div className="p-4 flex justify-between" style={{ borderBottom:'1px solid var(--border)' }}>
              <h3 className="font-bold uppercase text-sm">{turfForm.oldTurf ? 'Edit' : 'Create'} Turf</h3>
              <button onClick={() => setShowTurfForm(false)} style={{ color:'var(--fg-4)', background:'none', border:'none', cursor:'pointer', fontSize:16 }}>✕</button>
            </div>
            <div className="p-4 space-y-3">
              <div><div style={s.label}>Turf Name</div><input style={s.input} value={turfForm.newTurf} onChange={e => setTurfForm({...turfForm, newTurf:e.target.value})} /></div>
              <div><div style={s.label}>Shipment Power</div><input style={s.input} value={turfForm.power} onChange={e => setTurfForm({...turfForm, power:e.target.value})} /></div>
            </div>
            <div className="p-4 flex justify-end gap-2" style={{ borderTop:'1px solid var(--border)' }}>
              <button style={s.btnGhost} onClick={() => setShowTurfForm(false)}>Cancel</button>
              <button style={s.btn} onClick={handleTurfSubmit}>Save</button>
            </div>
          </div>
        </div>
      )}
    </StorytellingShell>
  );
}
