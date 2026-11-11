"use client";
import { useEffect, useState } from "react";
import { Modal, Field, useAction } from "../../ui.js";
import {
  addMember, updateMember, addFactionProperty, editFactionProperty, updateFactionLinks,
  requestRPChange, getNPCsForRP, getFactionProperties,
} from "../../../fm/factions/actions.js";
import { PROPERTY_TYPES } from "../../../../../../shared/validate.js";

/* The hub's shared modals. Each one owns its form state and runs its action
   through useAction (errors toast, the modal stays open on failure); `onDone`
   is the hub's reload. */

export function MemberModal({ detail, member, onClose, onDone }) {
  const [f, setF] = useState(member ? { name: member.character_name, phone: member.phone, residence: member.residence, role: member.is_leader } : { name: "", phone: "N/A", residence: "N/A", role: 0 });
  const { run, busy } = useAction();
  const save = () => run(() => member ? updateMember(member.id, f) : addMember(detail.id, detail.name, f), { success: member ? "Member updated." : "Member added.", onDone: async () => { onClose(); await onDone(); } });
  return (
    <Modal title={member ? "Edit member" : "Add member"} onClose={onClose} onSave={save} saveDisabled={busy || !f.name.trim()}>
      <Field label="Character name"><input autoFocus value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
      <div className="form-grid">
        <Field label="Phone"><input value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Residence"><input value={f.residence} onChange={e => setF({ ...f, residence: e.target.value })} /></Field>
      </div>
      <Field label="Role"><select value={f.role} onChange={e => setF({ ...f, role: parseInt(e.target.value) })}><option value={0}>Member</option><option value={1}>Command</option><option value={2}>Leader</option></select></Field>
    </Modal>
  );
}

export function PropertyModal({ detail, prop, onClose, onDone }) {
  const [f, setF] = useState(prop ? { address: prop.address, type: prop.property_type || "Property", isHQ: !!prop.isHQ } : { address: "", type: "Property", isHQ: false });
  const { run, busy } = useAction();
  const save = () => run(() => prop ? editFactionProperty(prop.id, f) : addFactionProperty(detail.id, detail.name, f), { success: prop ? "Property updated." : "Property saved.", onDone: async () => { onClose(); await onDone(); } });
  return (
    <Modal title={prop ? "Edit property" : "Add property"} onClose={onClose} onSave={save} saveDisabled={busy || !f.address.trim()}>
      <Field label="Address"><input autoFocus value={f.address} onChange={e => setF({ ...f, address: e.target.value })} /></Field>
      <Field label="Type"><select value={PROPERTY_TYPES.includes(f.type) ? f.type : "Property"} onChange={e => setF({ ...f, type: e.target.value, isHQ: e.target.value === "HQ" ? true : f.isHQ })}>{PROPERTY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></Field>
      <label className="check"><input type="checkbox" checked={f.isHQ} onChange={e => setF({ ...f, isHQ: e.target.checked })} /> Mark as HQ (replaces the current HQ)</label>
      <div className="hint">Below leadership, additions and HQ moves are queued for approval as RP changes (policy 16); leadership applies them directly.</div>
    </Modal>
  );
}

export function LinkModal({ detail, field, onClose, onDone }) {
  const [v, setV] = useState(field === "thread" ? (detail.threadId || "") : (detail[field] || ""));
  const { run, busy } = useAction();
  const labels = { discord: "Discord URL", forum: "Forum URL", thread: "FM thread id" };
  const save = () => run(() => updateFactionLinks(detail.id, field, v), { success: `${labels[field] || field} saved.`, onDone: async () => { onClose(); await onDone(); } });
  return (
    <Modal title={`Edit ${labels[field] || field}`} onClose={onClose} onSave={save} saveDisabled={busy}>
      <Field label={labels[field] || field} help={field === "thread" ? "The Discord thread id for this faction in the FM server." : "Must start with http(s)://. Leave empty to clear."}>
        <input autoFocus value={v} onChange={e => setV(e.target.value)} />
      </Field>
    </Modal>
  );
}

/* Request RP change (the PENDING step of shared/rpState.js). NPC / HQ / TURF /
   PROPERTY / Other per the existing requestRPChange contract; when opened from an
   incoming IC contact the contact id rides along and the server advances that
   contact to pending_roleplay and tells its thread. */
export function RPChangeModal({ detail, contactId = null, onClose, onDone }) {
  const [lists, setLists] = useState(null);
  const [f, setF] = useState({ type: "", oldVal: "", newVal: "", turf: "", remove: false });
  const { run, busy } = useAction();
  useEffect(() => {
    Promise.all([getNPCsForRP().catch(() => []), getFactionProperties(detail.id).catch(() => [])]).then(([npcs, props]) => setLists({ npcs: npcs || [], props: props || [] }));
  }, [detail.id]);
  const npcs = lists?.npcs || [], props = lists?.props || [];
  const reset = (type) => setF({ type, oldVal: "", newVal: "", turf: "", remove: false });
  const removing = f.type === "PROPERTY" && f.remove && f.oldVal && f.oldVal !== "N/A";
  const disabled = busy || !f.type || (f.type === "NPC" && !f.oldVal) || (f.type === "TURF" && !f.turf) || (f.type === "PROPERTY" && !f.oldVal) || (!removing && !f.newVal.trim());

  const submit = () => {
    let payload;
    if (f.type === "NPC") {
      const npc = npcs.find(n => String(n.id) === String(f.oldVal));
      payload = { type: "NPC", npcId: npc?.id, oldValue: npc?.npc_type || "N/A", newValue: f.newVal, turf: npc?.turf || "N/A" };
    } else if (f.type === "HQ") payload = { type: "HQ", oldValue: f.oldVal, newValue: f.newVal, turf: "N/A" };
    // TURF contract: turf = the turf being changed, oldValue = its current name, newValue = the new name.
    else if (f.type === "TURF") payload = { type: "TURF", oldValue: f.turf || "N/A", newValue: f.newVal, turf: f.turf || "N/A" };
    // PROPERTY contract: oldValue = current address or N/A (adds), newValue = new address or REMOVED.
    else if (f.type === "PROPERTY") payload = { type: "PROPERTY", oldValue: f.oldVal || "N/A", newValue: removing ? "REMOVED" : f.newVal, turf: "N/A" };
    else payload = { type: "Other", oldValue: f.oldVal || "N/A", newValue: f.newVal, turf: "N/A" };
    payload.factionId = detail.id;
    if (contactId) payload.contactId = contactId;
    run(() => requestRPChange(payload), { success: "RP change requested — FM Leadership has been pinged to approve it.", onDone: async () => { onClose(); await onDone(); } });
  };

  return (
    <Modal title={contactId ? "Request RP change for this contact" : "Request RP change"} onClose={onClose} onSave={f.type ? submit : null} saveLabel="Submit request" saveDisabled={disabled}>
      <Field label="Change type">
        <select autoFocus value={f.type} onChange={e => reset(e.target.value)}>
          <option value="">Select change type…</option><option value="NPC">NPC change</option><option value="HQ">HQ relocation</option><option value="TURF">Turf change</option><option value="PROPERTY">Property change</option><option value="Other">Other</option>
        </select>
      </Field>
      {!lists && f.type && <div className="skeleton" style={{ height: 34 }} />}
      {lists && f.type === "NPC" && <>
        <Field label="Current NPC"><select value={f.oldVal} onChange={e => setF({ ...f, oldVal: e.target.value })}><option value="">Pick the NPC…</option>{npcs.map(n => <option key={n.id} value={String(n.id)}>{n.name} ({n.npc_type}) — {n.turf}</option>)}</select></Field>
        <Field label="New NPC type"><select value={f.newVal} onChange={e => setF({ ...f, newVal: e.target.value })}><option value="">Pick a type…</option>{[...new Set(npcs.map(n => n.npc_type))].sort().map(t => <option key={t} value={t}>{t}</option>)}</select></Field>
      </>}
      {lists && f.type === "HQ" && <>
        <Field label="Current address"><select value={f.oldVal} onChange={e => setF({ ...f, oldVal: e.target.value })}><option value="">Current address…</option>{props.map(p => <option key={p.id} value={p.address}>{p.is_hq ? "HQ: " : ""}{p.address}</option>)}</select></Field>
        <Field label="New HQ address"><input value={f.newVal} onChange={e => setF({ ...f, newVal: e.target.value })} /></Field>
      </>}
      {lists && f.type === "TURF" && <>
        <Field label="Turf being changed"><select value={f.turf} onChange={e => setF({ ...f, turf: e.target.value, oldVal: e.target.value })}><option value="">Pick a turf…</option>{[...new Set(npcs.map(n => n.turf).filter(t => t && t !== "Neutral"))].sort().map(t => <option key={t} value={t}>{t}</option>)}</select></Field>
        <Field label="New turf name" help="Executing renames the turf and moves every NPC on it; renaming onto an existing turf merges them. Same name = shipment-power change only (set at execution)."><input value={f.newVal} onChange={e => setF({ ...f, newVal: e.target.value })} /></Field>
      </>}
      {lists && f.type === "PROPERTY" && <>
        <Field label="Property">
          <select value={f.oldVal} onChange={e => setF({ ...f, oldVal: e.target.value, remove: false })}>
            <option value="">Current property…</option>
            <option value="N/A">— New property (not on the list yet) —</option>
            {props.map(p => <option key={p.id} value={p.address}>{p.is_hq ? "HQ: " : ""}{p.address}</option>)}
          </select>
        </Field>
        {f.oldVal && f.oldVal !== "N/A" && <label className="check"><input type="checkbox" checked={!!f.remove} onChange={e => setF({ ...f, remove: e.target.checked, newVal: e.target.checked ? "" : f.newVal })} /> Remove this property from the faction</label>}
        {!removing && <Field label={f.oldVal === "N/A" ? "Address to add" : "New address"}><input value={f.newVal} onChange={e => setF({ ...f, newVal: e.target.value })} /></Field>}
      </>}
      {f.type === "Other" && <>
        <Field label="Current state"><input value={f.oldVal} onChange={e => setF({ ...f, oldVal: e.target.value })} /></Field>
        <Field label="New state"><input value={f.newVal} onChange={e => setF({ ...f, newVal: e.target.value })} /></Field>
      </>}
    </Modal>
  );
}
