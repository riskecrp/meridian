"use client";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../lib/useAuth";
import { useDialog } from "../../../../lib/useDialog";
import { getChangeLogs, addChangeLog, editChangeLog, deleteChangeLog } from "../actions";
import { s } from "../_shared/styles";
import StorytellingShell from "../_shared/Shell";

export default function ChangeLogPage() {
  const auth = useAuth();
  const { showConfirm, showForm } = useDialog();
  const [changeLogs, setChangeLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [clFilter, setClFilter] = useState('all');
  const [clSearch, setClSearch] = useState('');

  useEffect(() => {
    if (auth.loading) return;
    refresh();
  }, [auth.loading]);

  const refresh = async () => { setLoading(true); setChangeLogs(await getChangeLogs()); setLoading(false); };

  if (auth.loading || loading) return <div className="p-10 text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading...</div>;

  return (
    <StorytellingShell title="Change Log">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex gap-2 mb-3 shrink-0 items-center flex-wrap">
          <input style={{ ...s.input, flex:1, minWidth:200 }} placeholder="Search by name or location..." value={clSearch} onChange={e => setClSearch(e.target.value)} />
          <div className="flex gap-1">
            {['all','black_market_doctor','drop_location'].map(f => (
              <button key={f} onClick={() => setClFilter(f)} className="px-3 py-1.5 rounded text-[10px] font-bold uppercase" style={{background:clFilter===f?'var(--accent)':'var(--bg-1)',color:clFilter===f?'white':'var(--fg-3)',border:'1px solid var(--border)'}}>
                {f==='all'?'All':f==='black_market_doctor'?'Doctors':'Drops'}
              </button>
            ))}
          </div>
          {auth.level >= 3 && (
            <button style={s.btn} onClick={async () => {
              const typeRes = await showForm("New Entry", [
                {name:'changeType',label:'Type',type:'select',options:[{label:'Black Market Doctor',value:'black_market_doctor'},{label:'Drop Location',value:'drop_location'}]}
              ]);
              if (!typeRes) return;
              let res;
              if (typeRes.changeType === 'black_market_doctor') {
                res = await showForm("Black Market Doctor", [
                  {name:'name',label:'Name',type:'text'},
                  {name:'position',label:'/tppos Location',type:'text'},
                  {name:'action',label:'Action',type:'select',options:[{label:'Added',value:'Added'},{label:'Moved',value:'Moved'},{label:'Removed',value:'Removed'}]},
                  {name:'blockedOff',label:'Location blocked off? (if removed)',type:'checkbox'},
                  {name:'notes',label:'Notes',type:'text'}
                ]);
              } else {
                res = await showForm("Drop Location", [
                  {name:'name',label:'Name',type:'text'},
                  {name:'position',label:'/tppos Location',type:'text'}
                ]);
              }
              if (res && res.name) { await addChangeLog({...res, changeType: typeRes.changeType}); refresh(); }
            }}>+ Entry</button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto scr pb-10">
          <div className="rounded-xl overflow-hidden" style={{background:'var(--bg-1)',border:'1px solid var(--border)'}}>
            {changeLogs
              .filter(cl => clFilter === 'all' || cl.change_type === clFilter)
              .filter(cl => {
                if (!clSearch) return true;
                const q = clSearch.toLowerCase();
                return cl.name.toLowerCase().includes(q) || (cl.position||'').toLowerCase().includes(q) || (cl.notes||'').toLowerCase().includes(q);
              })
              .map(cl => (
                <div key={cl.id} className="flex flex-col md:flex-row gap-1 md:gap-3 py-2.5 px-4 text-[12px] group" style={{borderBottom:'1px solid var(--border)'}}>
                  <span className="min-w-[80px] font-mono shrink-0" style={{color:'var(--fg-4)'}}>{cl.created_at?.substring(0,10)}</span>
                  <span className="min-w-[55px] shrink-0"><span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase" style={{background:cl.change_type==='black_market_doctor'?'var(--red-bg)':'var(--accent-bg)',color:cl.change_type==='black_market_doctor'?'var(--red)':'var(--accent)'}}>{cl.change_type==='black_market_doctor'?'Doctor':'Drop'}</span></span>
                  {cl.action&&<span className="min-w-[60px] shrink-0"><span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{background:cl.action==='Added'?'var(--green-bg)':cl.action==='Removed'?'var(--red-bg)':'var(--amber-bg)',color:cl.action==='Added'?'var(--green)':cl.action==='Removed'?'var(--red)':'var(--amber)'}}>{cl.action}</span></span>}
                  {cl.action==='Removed'&&<span className="shrink-0"><span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{background:cl.blocked_off?'var(--green-bg)':'var(--red-bg)',color:cl.blocked_off?'var(--green)':'var(--red)'}}>{cl.blocked_off?'Blocked':'NOT Blocked'}</span></span>}
                  <span className="min-w-[120px] font-bold truncate shrink-0" style={{color:'var(--fg-0)'}}>{cl.name}</span>
                  {cl.position&&<span className="font-mono truncate" style={{color:'var(--accent)'}}>/tppos {cl.position}</span>}
                  {cl.notes&&<span className="truncate" style={{color:'var(--fg-3)'}}>{cl.notes}</span>}
                  <span className="flex-1" />
                  <span className="min-w-[70px] text-right shrink-0" style={{color:'var(--fg-4)'}}>{cl.created_by}</span>
                  {auth.level>=3&&(
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button onClick={async()=>{let res;if(cl.change_type==='black_market_doctor'){res=await showForm("Edit Doctor",[{name:'name',label:'Name',type:'text',default:cl.name},{name:'position',label:'/tppos Location',type:'text',default:cl.position},{name:'action',label:'Action',type:'select',options:[{label:'Added',value:'Added'},{label:'Moved',value:'Moved'},{label:'Removed',value:'Removed'}],default:cl.action},{name:'blockedOff',label:'Blocked off?',type:'checkbox',default:!!cl.blocked_off},{name:'notes',label:'Notes',type:'text',default:cl.notes}]);}else{res=await showForm("Edit Drop",[{name:'name',label:'Name',type:'text',default:cl.name},{name:'position',label:'/tppos Location',type:'text',default:cl.position}]);}if(res&&res.name){await editChangeLog(cl.id,{...res,changeType:cl.change_type});refresh();}}} style={{color:'var(--accent)',background:'none',border:'none',cursor:'pointer',fontSize:10,fontWeight:700}}>Edit</button>
                      <button onClick={async()=>{if(await showConfirm('Delete?')){await deleteChangeLog(cl.id);refresh();}}} style={{color:'var(--red)',background:'none',border:'none',cursor:'pointer',fontSize:10,fontWeight:700}}>Del</button>
                    </div>
                  )}
                </div>
              ))
            }
            {changeLogs.length===0&&<div className="text-center py-10 text-sm" style={{color:'var(--fg-4)'}}>No change log entries yet.</div>}
            {changeLogs.length>0&&changeLogs.filter(cl=>clFilter==='all'||cl.change_type===clFilter).filter(cl=>!clSearch||cl.name.toLowerCase().includes(clSearch.toLowerCase())).length===0&&(
              <div className="text-center py-10 text-sm" style={{color:'var(--fg-4)'}}>No entries match your filter.</div>
            )}
          </div>
        </div>
      </div>
    </StorytellingShell>
  );
}
