"use client";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../lib/useAuth";
import { useDialog } from "../../../../lib/useDialog";
import { getMdbAccessRoles, addMdbAccessRole, deleteMdbAccessRole } from "../actions";
import { st } from "../_shared/styles";
import OperationsShell from "../_shared/Shell";

export default function MdbAccessPage() {
  const auth = useAuth();
  const { showConfirm, showForm } = useDialog();
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (auth.loading || auth.level < 3) return;
    getMdbAccessRoles().then(r => { setRoles(r || []); setLoading(false); });
  }, [auth.loading, auth.level]);

  if (auth.loading) return <div className="p-10 text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading...</div>;
  if (auth.level < 3) return <div className="p-10" style={{color:'var(--red)'}}>Access denied.</div>;
  if (loading) return <div className="p-10 text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading...</div>;

  return (
    <OperationsShell title="Database Site Access" docs={[{"title": "Meridian Database — Access & Setup", "label": "Meridian Database Access Guide", "minLevel": 3}]} authLevel={auth?.level || 3}>
      <div className="space-y-5">
        <div className="flex justify-between items-start">
          <div>
            <div className="text-sm" style={{color:'var(--fg-3)'}}>Control which Discord roles can log in to <strong style={{color:'var(--fg-1)'}}>meridiandatabase.net</strong>.</div>
            <div className="text-[10px] mt-1 font-mono" style={{color:'var(--fg-4)'}}>Members must have at least one of these roles. If the list is empty, all guild members are permitted.</div>
          </div>
          <button style={st.btn} onClick={async () => {
            const res = await showForm("Add Access Role", [
              { name: 'role_id',   label: 'Discord Role ID',   type: 'text', placeholder: 'Right-click role → Copy ID' },
              { name: 'role_name', label: 'Role Name (label)', type: 'text', placeholder: 'e.g. Alliance Member' },
            ]);
            if (res?.role_id) { await addMdbAccessRole(res); getMdbAccessRoles().then(setRoles); }
          }}>Add Role +</button>
        </div>

        {roles.length === 0 ? (
          <div className="py-10 text-center text-sm" style={{color:'var(--fg-4)'}}>
            No roles configured — all guild members can currently access the site.
          </div>
        ) : (
          <div className="rounded-xl overflow-hidden" style={{background:'var(--bg-1)', border:'1px solid var(--border)'}}>
            <table className="w-full">
              <thead>
                <tr style={{background:'var(--bg-2)'}}>
                  <th className="py-2.5 px-4 text-left text-[10px] font-bold uppercase" style={{color:'var(--fg-4)'}}>Role Name</th>
                  <th className="py-2.5 px-4 text-left text-[10px] font-bold uppercase" style={{color:'var(--fg-4)'}}>Role ID</th>
                  <th className="py-2.5 px-4 text-left text-[10px] font-bold uppercase" style={{color:'var(--fg-4)'}}>Added</th>
                  <th className="py-2.5 px-4" />
                </tr>
              </thead>
              <tbody>
                {roles.map(r => (
                  <tr key={r.id} style={{borderTop:'1px solid var(--border)'}}>
                    <td className="py-3 px-4 font-medium text-sm">{r.role_name || <span style={{color:'var(--fg-4)',fontStyle:'italic'}}>Unnamed</span>}</td>
                    <td className="py-3 px-4 text-[11px] font-mono" style={{color:'var(--fg-4)'}}>{r.role_id}</td>
                    <td className="py-3 px-4 text-[11px]" style={{color:'var(--fg-4)'}}>{r.created_at?.substring(0,10)}</td>
                    <td className="py-3 px-4 text-right">
                      <button style={{fontSize:11,color:'var(--red)',background:'none',border:'none',cursor:'pointer'}}
                        onClick={async()=>{ if(await showConfirm('Remove this role?')){ await deleteMdbAccessRole(r.id); getMdbAccessRoles().then(setRoles); } }}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </OperationsShell>
  );
}
