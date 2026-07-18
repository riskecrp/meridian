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
  // Other
  const [details, setDetails] = useState('');

  useEffect(() => {
    getIcContactFormData(contact.faction_id).then(setFormData);
  }, [contact.faction_id]);

  if (!formData) return (
    <div style={{ padding: '12px', fontSize: 12, color: 'var(--fg-4)', fontStyle: 'italic' }}>Loading form data...</div>
  );

  const { npcs, npcTypes, properties } = formData;

  const handleNpcSelect = (val) => {
    setSelectedNpc(val);
    // val format: "npc_type|turf"
    const [type] = val.split('|');
    // pre-fill new type to same (user will change it)
    if (!rpNewType) setRpNewType(type);
  };

  const canSubmit = () => {
    if (rpType === 'NPC') return selectedNpc && rpNewType && rpNewType !== selectedNpc.split('|')[0];
    if (rpType === 'HQ') return oldAddr && newAddr.trim();
    return details.trim();
  };

  const handleSubmit = () => {
    let data;
    if (rpType === 'NPC') {
      const [npcType, turf] = selectedNpc.split('|');
      data = { type: 'NPC', oldValue: npcType, newValue: rpNewType, turf };
    } else if (rpType === 'HQ') {
      data = { type: 'HQ', oldValue: oldAddr, newValue: newAddr.trim(), turf: 'N/A' };
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
        {['NPC', 'HQ', 'Other'].map(t => (
          <button key={t} onClick={() => { setRpType(t); setSelectedNpc(''); setRpNewType(''); setOldAddr(''); setNewAddr(''); setDetails(''); }} style={tabBtn(rpType === t)}>{t}</button>
        ))}
      </div>

      {/* NPC fields */}
      {rpType === 'NPC' && (<>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Current NPC</div>
          <select value={selectedNpc} onChange={e => handleNpcSelect(e.target.value)} style={inp}>
            <option value="">Select NPC...</option>
            {npcs.map(n => (
              <option key={n.id} value={`${n.npc_type}|${n.turf}`}>
                {n.name} ({n.npc_type}) — {n.turf}
              </option>
            ))}
          </select>
          {selectedNpc && (
            <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 4 }}>
              Turf: <span style={{ color: 'var(--fg-1)' }}>{selectedNpc.split('|')[1]}</span>
              {' · '}Current type: <span style={{ color: 'var(--fg-1)' }}>{selectedNpc.split('|')[0]}</span>
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
