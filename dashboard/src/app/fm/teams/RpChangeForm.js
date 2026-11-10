"use client";
import { useEffect, useState } from "react";
import { getIcContactFormData } from "./actions";

export default function RpChangeForm({ contact, onSubmit, onCancel, busy }) {
  const [formData, setFormData] = useState(null);
  const [rpType, setRpType]     = useState('NPC');
  // NPC fields
  const [selectedNpc, setSelectedNpc] = useState('');
  const [rpNewType, setRpNewType]     = useState('');
  // HQ fields
  const [oldAddr, setOldAddr] = useState('');
  const [newAddr, setNewAddr] = useState('');
  // TURF fields — turf = the turf being changed, newValue = its new name (shared/rpChanges.js renames
  // the turfs row and every NPC on it; renaming onto an existing turf merges)
  const [turfName, setTurfName] = useState('');
  const [turfNew, setTurfNew]   = useState('');
  // PROPERTY fields — oldValue = current address or N/A (adds), newValue = new address or REMOVED
  const [propOld, setPropOld]       = useState('');
  const [propNew, setPropNew]       = useState('');
  const [propRemove, setPropRemove] = useState(false);
  // Other
  const [details, setDetails] = useState('');

  useEffect(() => {
    getIcContactFormData(contact.faction_id).then(setFormData);
  }, [contact.faction_id]);

  if (!formData) return (
    <div style={{ padding: '12px', fontSize: 12, color: 'var(--fg-4)', fontStyle: 'italic' }}>Loading form data...</div>
  );

  const { npcs, npcTypes, properties, scoped } = formData;
  // The option value is the NPC id, so the server can record exactly which NPC
  // the request is about (two NPCs of one type on one turf are no longer ambiguous).
  const npcById = (id) => npcs.find(n => String(n.id) === String(id));
  const current = npcById(selectedNpc);
  const turfs = [...new Set(npcs.map(n => n.turf).filter(t => t && t !== 'Neutral'))].sort();
  const PROP_NA = 'N/A';

  const handleNpcSelect = (val) => {
    setSelectedNpc(val);
    const npc = npcById(val);
    // pre-fill new type to same (user will change it)
    if (!rpNewType && npc) setRpNewType(npc.npc_type);
  };

  const canSubmit = () => {
    if (rpType === 'NPC') return current && rpNewType && rpNewType !== current.npc_type;
    if (rpType === 'HQ') return oldAddr && newAddr.trim();
    if (rpType === 'TURF') return turfName && turfNew.trim();
    if (rpType === 'PROPERTY') return propOld && (propOld === PROP_NA ? propNew.trim() : (propRemove || propNew.trim()));
    return details.trim();
  };
  const resetFields = () => { setSelectedNpc(''); setRpNewType(''); setOldAddr(''); setNewAddr(''); setTurfName(''); setTurfNew(''); setPropOld(''); setPropNew(''); setPropRemove(false); setDetails(''); };

  const handleSubmit = () => {
    let data;
    if (rpType === 'NPC') {
      data = { type: 'NPC', npcId: current.id, oldValue: current.npc_type, newValue: rpNewType, turf: current.turf };
    } else if (rpType === 'HQ') {
      data = { type: 'HQ', oldValue: oldAddr, newValue: newAddr.trim(), turf: 'N/A' };
    } else if (rpType === 'TURF') {
      data = { type: 'TURF', turf: turfName, oldValue: turfName, newValue: turfNew.trim() };
    } else if (rpType === 'PROPERTY') {
      data = { type: 'PROPERTY', oldValue: propOld || PROP_NA, newValue: propOld !== PROP_NA && propRemove ? 'REMOVED' : propNew.trim(), turf: 'N/A' };
    } else {
      data = { type: 'Other', oldValue: 'N/A', newValue: details.trim(), turf: 'N/A' };
    }
    onSubmit(data);
  };

  const inp = { background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 7, padding: '6px 10px', fontSize: 12, color: 'var(--fg-0)', outline: 'none', width: '100%' };
  const tabBtn = (active) => ({ flex: 1, padding: '5px', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer', border: `1px solid ${active ? 'var(--blue)' : 'var(--border)'}`, background: active ? 'var(--blue-bg)' : 'transparent', color: active ? 'var(--blue)' : 'var(--fg-3)' });

  return (
    <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--blue)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>RP Change Request</div>

      {/* Type selector */}
      <div style={{ display: 'flex', gap: 6 }}>
        {[['NPC', 'NPC'], ['HQ', 'HQ'], ['TURF', 'Turf'], ['PROPERTY', 'Property'], ['Other', 'Other']].map(([t, label]) => (
          <button key={t} onClick={() => { setRpType(t); resetFields(); }} style={tabBtn(rpType === t)}>{label}</button>
        ))}
      </div>

      {/* NPC fields */}
      {rpType === 'NPC' && (<>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Current NPC</div>
          <select value={selectedNpc} onChange={e => handleNpcSelect(e.target.value)} style={inp}>
            <option value="">Select NPC...</option>
            {npcs.map(n => (
              <option key={n.id} value={String(n.id)}>
                {n.name} ({n.npc_type}) — {n.turf}
              </option>
            ))}
          </select>
          {!scoped && npcs.length > 0 && (
            <div style={{ fontSize: 10, color: 'var(--fg-4)', marginTop: 4 }}>No NPC is registered to this faction&apos;s turf — showing every claimable NPC.</div>
          )}
          {formData.error && <div style={{ fontSize: 10, color: 'var(--red)', marginTop: 4 }}>{formData.error}</div>}
          {current && (
            <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 4 }}>
              Turf: <span style={{ color: 'var(--fg-1)' }}>{current.turf}</span>
              {' · '}Current type: <span style={{ color: 'var(--fg-1)' }}>{current.npc_type}</span>
            </div>
          )}
        </div>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>New NPC Type</div>
          <select value={rpNewType} onChange={e => setRpNewType(e.target.value)} style={inp}>
            <option value="">Select new type...</option>
            {npcTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </>)}

      {/* HQ fields */}
      {rpType === 'HQ' && (<>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Current Address</div>
          <select value={oldAddr} onChange={e => setOldAddr(e.target.value)} style={inp}>
            <option value="">Select property...</option>
            {properties.map(p => (
              <option key={p.id} value={p.address}>{p.is_hq ? 'HQ: ' : ''}{p.address}</option>
            ))}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>New Address</div>
          <input style={inp} placeholder="Enter new address..." value={newAddr} onChange={e => setNewAddr(e.target.value)} />
        </div>
      </>)}

      {/* TURF fields */}
      {rpType === 'TURF' && (<>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Turf being changed</div>
          <select value={turfName} onChange={e => setTurfName(e.target.value)} style={inp}>
            <option value="">Select turf...</option>
            {turfs.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          {turfs.length === 0 && <div style={{ fontSize: 10, color: 'var(--fg-4)', marginTop: 4 }}>No turf is registered for this faction&apos;s NPCs.</div>}
        </div>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>New turf name</div>
          <input style={inp} placeholder="New name for the turf..." value={turfNew} onChange={e => setTurfNew(e.target.value)} />
          <div style={{ fontSize: 10, color: 'var(--fg-4)', marginTop: 4 }}>Executing renames the turf and moves every NPC on it; renaming onto an existing turf merges them. Use the same name to change only its shipment power at execution.</div>
        </div>
      </>)}

      {/* PROPERTY fields */}
      {rpType === 'PROPERTY' && (<>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Current property</div>
          <select value={propOld} onChange={e => { setPropOld(e.target.value); setPropRemove(false); }} style={inp}>
            <option value="">Select...</option>
            <option value={PROP_NA}>— New property (not on the list yet) —</option>
            {properties.map(p => (
              <option key={p.id} value={p.address}>{p.is_hq ? 'HQ: ' : ''}{p.address}</option>
            ))}
          </select>
        </div>
        {propOld && propOld !== PROP_NA && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg-2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={propRemove} onChange={e => { setPropRemove(e.target.checked); if (e.target.checked) setPropNew(''); }} />
            Remove this property from the faction
          </label>
        )}
        {!(propOld && propOld !== PROP_NA && propRemove) && (
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>{propOld === PROP_NA ? 'Address to add' : 'New address'}</div>
            <input style={inp} placeholder={propOld === PROP_NA ? 'Address of the new property...' : 'New address for this property...'} value={propNew} onChange={e => setPropNew(e.target.value)} />
          </div>
        )}
      </>)}

      {/* Other */}
      {rpType === 'Other' && (
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Details</div>
          <input style={inp} placeholder="Describe the change..." value={details} onChange={e => setDetails(e.target.value)} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
        <button disabled={!canSubmit() || busy} onClick={handleSubmit}
          style={{ padding: '6px 14px', borderRadius: 7, fontSize: 10, fontWeight: 700, cursor: canSubmit() && !busy ? 'pointer' : 'not-allowed', background: 'var(--accent)', color: 'white', border: 'none', opacity: !canSubmit() || busy ? 0.5 : 1 }}>
          Submit RP Request
        </button>
        <button onClick={onCancel} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 10, fontWeight: 700, cursor: 'pointer', background: 'transparent', color: 'var(--fg-3)', border: '1px solid var(--border)' }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
