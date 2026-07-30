"use client";
import { useEffect, useState } from "react";
import { useDialog } from "../../../lib/useDialog";
import { useAuth } from "../../../lib/useAuth";
import { getInventory, addInventoryItem, deleteInventoryItem, getDistributionStats } from "./actions";
import SopLink from "../../../lib/SopLink";
import { ui } from "../../../lib/ui.js";
import TableSkeleton from "../../../lib/TableSkeleton";

// The item catalogue behind the scene form, and the record of what has been
// handed out. Stock counts and shortage alerts are gone — see actions.js for why.
//
// Two tabs because they answer different questions: "what can I give out?" and
// "how much has been given out?". The second is Leadership's, so it is L2.

const st = { ...ui };

export default function InventoryPage() {
  const auth = useAuth();
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('items');
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', category: '' });
  const { showConfirm } = useDialog();

  useEffect(() => {
    if (auth.loading) return;
    Promise.all([getInventory(), auth.level >= 2 ? getDistributionStats() : Promise.resolve({})])
      .then(([i, s]) => { setItems(i); setStats(s); setLoading(false); });
  }, [auth.loading, auth.level]);

  const refresh = async () => setItems(await getInventory());

  if (auth.loading || loading) return <TableSkeleton cols={['1fr', '1fr', '1fr', '1fr']} rows={6} />;

  const categories = items.reduce((a, i) => {
    const key = i.category || 'Uncategorised';
    (a[key] = a[key] || []).push(i);
    return a;
  }, {});
  const givenOut = Object.entries(stats).sort((a, b) => b[1].cash - a[1].cash);

  return (
    <div className="page-shell">
      <div className="page-hdr" style={{ background: 'linear-gradient(180deg,rgba(34,197,94,0.04) 0%,transparent 100%)' }}>
        <div className="accent-bar" style={{ background: 'linear-gradient(90deg,var(--green) 0%,transparent 60%)' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="page-hdr-tag" style={{ color: 'var(--green)' }}>Operations / Scene Items</div>
              {auth.level >= 3 && <SopLink title="Faction Administration" label="Inventory Guide" />}
            </div>
            <h1>Scene Items</h1>
            <div className="page-hdr-sub">The list offered when logging a scene, and what has been handed out</div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            {auth.level >= 2 && (
              <button style={{ ...st.btnGhost, color: 'var(--green)' }}
                onClick={() => setTab(tab === 'items' ? 'given' : 'items')}>
                {tab === 'items' ? 'Given out' : 'Item list'}
              </button>
            )}
            {auth.level >= 3 && tab === 'items' && (
              <button style={{ ...st.btn, background: 'var(--green)' }} onClick={() => setShowAdd(true)}>Add item +</button>
            )}
          </div>
        </div>
      </div>

      <div className="page-body scr" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {tab === 'items' && Object.entries(categories).sort((a, b) => a[0].localeCompare(b[0])).map(([cat, catItems]) => (
          <div key={cat}>
            <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.18em', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)', marginBottom: 6 }}>
              {cat} · {catItems.length}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {catItems.map(i => (
                <div key={i.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '9px 10px', borderRadius: 8, background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--fg-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.name}</span>
                  {auth.level >= 3 && (
                    <button style={{ ...st.btnSm, color: 'var(--fg-4)', flexShrink: 0 }}
                      title={`Remove ${i.name} from the list`}
                      onClick={async () => {
                        if (await showConfirm(`Remove "${i.name}" from the item list? Scenes that already gave it out keep their record.`)) {
                          await deleteInventoryItem(i.id); refresh();
                        }
                      }}>✕</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        {tab === 'items' && !items.length && (
          <div className="sec-card" style={{ padding: 20, fontSize: 13, color: 'var(--fg-3)' }}>
            No items yet. Add one and it becomes selectable when logging a scene.
          </div>
        )}

        {tab === 'given' && auth.level >= 2 && (
          <>
            <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
              Everything recorded through the scene form, totalled per person. Cash and items are logged
              at the moment a scene is submitted, so this is a record of what was handed out rather than
              a count of what is left.
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {givenOut.map(([name, data]) => (
                <div key={name} className="p-4 rounded-xl flex flex-col sm:flex-row gap-4" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
                  <div className="sm:w-1/3 sm:border-r sm:pr-4" style={{ borderColor: 'var(--border)' }}>
                    <div className="font-bold text-sm mb-1">{name}</div>
                    <div className="text-xl font-mono" style={{ color: 'var(--green)' }}>${data.cash.toLocaleString()}</div>
                  </div>
                  <div className="sm:w-2/3 flex flex-wrap gap-1.5">
                    {Object.entries(data.items).sort((a, b) => b[1] - a[1]).map(([item, qty]) => (
                      <span key={item} className="px-2 py-1 rounded text-[10px]" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                        <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{qty}x</span> <span style={{ color: 'var(--fg-3)' }}>{item}</span>
                      </span>
                    ))}
                    {Object.keys(data.items).length === 0 && <span className="text-[10px] italic" style={{ color: 'var(--fg-4)' }}>Cash only</span>}
                  </div>
                </div>
              ))}
              {!givenOut.length && (
                <div className="sec-card" style={{ padding: 20, fontSize: 13, color: 'var(--fg-3)' }}>
                  Nothing has been handed out through the scene form yet.
                </div>
              )}
            </div>
          </>
        )}

        {showAdd && (
          <div style={st.modal}>
            <div style={st.modalBg} onClick={() => setShowAdd(false)} />
            <form
              onSubmit={async e => {
                e.preventDefault();
                await addInventoryItem(addForm);
                setShowAdd(false); setAddForm({ name: '', category: '' }); refresh();
              }}
              style={{ position: 'relative', width: '100%', maxWidth: 430, background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
              <div className="p-5" style={{ borderBottom: '1px solid var(--border)' }}>
                <h3 className="font-bold uppercase">Add item</h3>
                <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }}>It becomes selectable on the scene form straight away.</div>
              </div>
              <div className="p-5 space-y-3">
                <div><div style={st.label}>Name</div>
                  <input required autoFocus style={st.input} value={addForm.name}
                    onChange={e => setAddForm({ ...addForm, name: e.target.value })} /></div>
                <div><div style={st.label}>Category</div>
                  <input required style={st.input} value={addForm.category} placeholder="e.g. Weapons, Drugs, Materials"
                    onChange={e => setAddForm({ ...addForm, category: e.target.value })} /></div>
              </div>
              <div className="p-5 flex justify-end gap-3" style={{ borderTop: '1px solid var(--border)' }}>
                <button type="button" style={st.btnGhost} onClick={() => setShowAdd(false)}>Cancel</button>
                <button type="submit" style={{ ...st.btn, background: 'var(--green)' }}>Save</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
