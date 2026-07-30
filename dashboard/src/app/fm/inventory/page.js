"use client";
import { useEffect, useState } from "react";
import { useDialog } from "../../../lib/useDialog";
import { useAuth } from "../../../lib/useAuth";
import { getInventory, addInventoryItem, updateStock, deleteInventoryItem, getDistributionStats } from "./actions";
import SopLink from "../../../lib/SopLink";
import { ui } from "../../../lib/ui.js";

const st = {
  ...ui,
};

export default function InventoryPage() {
  const auth = useAuth();
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('stock');
  const [adjustItem, setAdjustItem] = useState(null);
  const [adjustVal, setAdjustVal] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name:'', category:'', stock:'', threshold:'', purchaseable:true });
  const { showConfirm, showPrompt, showAlert } = useDialog();
  const actor = { id:auth.id, name:auth.name };

  useEffect(() => {
    if (!auth.loading) Promise.all([getInventory(), auth.level>=3?getDistributionStats():Promise.resolve({})]).then(([i,s])=>{setItems(i);setStats(s);setLoading(false);});
  }, [auth.loading]);

  const refresh = async () => setItems(await getInventory());

  if (auth.loading||loading) return <div className="p-10 text-sm animate-pulse" style={{color:'var(--green)'}}>Loading inventory...</div>;

  const critical = items.filter(i=>i.current_stock<=i.threshold&&i.purchaseable===0);
  const categories = items.reduce((a,i)=>{if(!a[i.category])a[i.category]=[];a[i.category].push(i);return a;},{});

  return (
    <div className="page-shell">
      <div className="page-hdr" style={{background:'linear-gradient(180deg,rgba(34,197,94,0.04) 0%,transparent 100%)'}}>
        <div className="accent-bar" style={{background:'linear-gradient(90deg,var(--green) 0%,transparent 60%)'}} />
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
          <div>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <div className="page-hdr-tag" style={{color:'var(--green)'}}>Overview / Inventory</div>
              {auth.level >= 3 && <SopLink title="Faction Administration" label="Inventory Guide" />}
            </div>
            <h1>Inventory</h1>
            <div className="page-hdr-sub">Live warehouse telemetry and distribution tracking</div>
          </div>
          <div style={{display:'flex',gap:8,marginTop:4}}>
            {auth.level>=3 && <button style={{...st.btnGhost,color:'var(--green)'}} onClick={()=>setTab(tab==='stock'?'analytics':'stock')}>{tab==='stock'?'Analytics':'Stock'}</button>}
            {auth.level>=3 && <button style={{...st.btn,background:'var(--green)'}} onClick={()=>setShowAdd(true)}>Register +</button>}
          </div>
        </div>
      </div>
      <div className="page-body scr" style={{display:'flex',flexDirection:'column',gap:16}}>

      {tab==='stock' && (<>
        {critical.length>0 && (
          <div className="sec-card" style={{borderColor:'var(--red-bg)',background:'var(--red-bg)'}}>
            <div className="sec-card-hdr" style={{background:'rgba(239,68,68,0.12)',borderColor:'var(--red-bg)',color:'var(--red)'}}>
              <span style={{display:'flex',alignItems:'center',gap:6}}><span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{background:'var(--red)',display:'inline-block'}} /> Active Shortages</span>
              <span style={{fontFamily:'var(--font-mono)'}}>{critical.length} item{critical.length!==1?'s':''}</span>
            </div>
            <div style={{padding:'10px 14px',display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))',gap:6}}>
              {critical.map(i=>(
                <div key={i.id} className={`flex items-center justify-between p-2.5 rounded ${auth.level>=3?'cursor-pointer':''}`} onClick={()=>auth.level>=3&&(setAdjustItem(i),setAdjustVal(i.current_stock))} style={{background:'var(--bg-1)',border:'1px solid var(--border)'}}>
                  <div className="overflow-hidden mr-2"><div className="text-[8px] font-bold uppercase truncate" style={{color:'var(--red)'}}>{i.category}</div><div className="text-[10px] font-bold truncate" style={{color:'var(--red)'}}>{i.name}</div></div>
                  <span className="text-base font-mono font-bold" style={{color:'var(--red)'}}>{i.current_stock}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {Object.entries(categories).sort((a,b)=>a[0].localeCompare(b[0])).map(([cat,catItems])=>(
          <div key={cat}>
            <div style={{fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.18em',color:'var(--fg-4)',fontFamily:'var(--font-mono)',marginBottom:6}}>{cat}</div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {catItems.map(i=>(
                <div key={i.id} className={`flex items-center justify-between p-2.5 rounded ${auth.level>=3?'cursor-pointer':''}`} onClick={()=>auth.level>=3&&(setAdjustItem(i),setAdjustVal(i.current_stock))} style={{background:'var(--bg-1)',border:'1px solid var(--border)'}}>
                  <span className="text-[10px] font-bold uppercase truncate pr-2" style={{color:(i.current_stock<=i.threshold&&i.purchaseable===0)?'var(--red)':(i.current_stock<=i.threshold?'var(--fg-1)':'var(--fg-1)')}}>{i.name}</span>
                  <span className="text-xs font-mono font-medium" style={{color:'var(--green)'}}>{i.current_stock}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </>)}

      {tab==='analytics' && auth.level>=3 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Object.entries(stats).sort((a,b)=>b[1].cash-a[1].cash).map(([name,data])=>(
            <div key={name} className="p-4 rounded-xl flex flex-col sm:flex-row gap-4" style={{background:'var(--bg-1)',border:'1px solid var(--border)'}}>
              <div className="sm:w-1/3 sm:border-r sm:pr-4" style={{borderColor:'var(--border)'}}>
                <div className="font-bold text-sm mb-1">{name}</div>
                <div className="text-xl font-mono" style={{color:'var(--green)'}}>${data.cash.toLocaleString()}</div>
              </div>
              <div className="sm:w-2/3 flex flex-wrap gap-1.5">
                {Object.entries(data.items).sort((a,b)=>b[1]-a[1]).map(([item,qty])=>(<span key={item} className="px-2 py-1 rounded text-[10px]" style={{background:'var(--bg-2)',border:'1px solid var(--border)'}}><span style={{color:'var(--accent)',fontWeight:700}}>{qty}x</span> <span style={{color:'var(--fg-3)'}}>{item}</span></span>))}
                {Object.keys(data.items).length===0 && <span className="text-[10px] italic" style={{color:'var(--fg-4)'}}>No items</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ADJUST STOCK MODAL */}
      {adjustItem && (
        <div style={st.modal}><div style={st.modalBg} onClick={()=>setAdjustItem(null)} />
          <form onSubmit={async e=>{e.preventDefault();await updateStock(adjustItem.id,parseInt(adjustVal));setAdjustItem(null);refresh();}} style={{position:'relative',width:'100%',maxWidth:350,background:'var(--bg-1)',border:'1px solid var(--border)',borderRadius:16,overflow:'hidden'}}>
            <div className="p-4" style={{borderBottom:'1px solid var(--border)'}}><div className="text-[9px] font-bold uppercase" style={{color:'var(--green)'}}>Adjust Stock</div><h3 className="text-lg font-bold">{adjustItem.name}</h3></div>
            <div className="p-5"><input type="number" autoFocus required style={{...st.input,textAlign:'center',fontSize:24,fontFamily:'monospace'}} value={adjustVal} onChange={e=>setAdjustVal(e.target.value)} /></div>
            <div className="p-4 flex justify-between gap-3" style={{borderTop:'1px solid var(--border)'}}>
              {auth.level>=3 && <button type="button" style={{...st.btnGhost,color:'var(--red)'}} onClick={async()=>{if(await showConfirm('Delete item?')){await deleteInventoryItem(adjustItem.id);setAdjustItem(null);refresh();}}}>Delete</button>}
              <div className="flex gap-3 ml-auto"><button type="button" style={st.btnGhost} onClick={()=>setAdjustItem(null)}>Cancel</button><button type="submit" style={{...st.btn,background:'var(--green)'}}>Update</button></div>
            </div>
          </form>
        </div>
      )}

      {/* ADD ITEM MODAL */}
      {showAdd && (
        <div style={st.modal}><div style={st.modalBg} onClick={()=>setShowAdd(false)} />
          <form onSubmit={async e=>{e.preventDefault();await addInventoryItem(addForm);setShowAdd(false);setAddForm({name:'',category:'',stock:'',threshold:'',purchaseable:true});refresh();}} style={{position:'relative',width:'100%',maxWidth:450,background:'var(--bg-1)',border:'1px solid var(--border)',borderRadius:16,overflow:'hidden'}}>
            <div className="p-5" style={{borderBottom:'1px solid var(--border)'}}><h3 className="font-bold uppercase">Register Item</h3></div>
            <div className="p-5 space-y-3">
              <div><div style={st.label}>Name</div><input required style={st.input} value={addForm.name} onChange={e=>setAddForm({...addForm,name:e.target.value})} /></div>
              <div><div style={st.label}>Category</div><input required style={st.input} value={addForm.category} onChange={e=>setAddForm({...addForm,category:e.target.value})} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><div style={st.label}>Starting Stock</div><input type="number" required style={st.input} value={addForm.stock} onChange={e=>setAddForm({...addForm,stock:e.target.value})} /></div>
                <div><div style={st.label}>Alert Threshold</div><input type="number" required style={st.input} value={addForm.threshold} onChange={e=>setAddForm({...addForm,threshold:e.target.value})} /></div>
              </div>
              <label className="flex items-center gap-2 pt-1 cursor-pointer"><input type="checkbox" checked={addForm.purchaseable} onChange={e=>setAddForm({...addForm,purchaseable:e.target.checked})} /><span className="text-xs" style={{color:'var(--fg-3)'}}>Purchaseable in store</span></label>
            </div>
            <div className="p-5 flex justify-end gap-3" style={{borderTop:'1px solid var(--border)'}}><button type="button" style={st.btnGhost} onClick={()=>setShowAdd(false)}>Cancel</button><button type="submit" style={{...st.btn,background:'var(--green)'}}>Save</button></div>
          </form>
        </div>
      )}
      </div>
    </div>
  );
}
