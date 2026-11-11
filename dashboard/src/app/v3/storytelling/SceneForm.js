"use client";
// The "log a scene" form, shared by Scene Logs (fresh log) and the Scene
// Library ("+ Add to faction" with the idea's title seeded into the notes).
// `form` is the submitScene payload: { faction, cash, items:[{name,qty}],
// otherRewards, notes, assistants:[{staff_id,staff_name}] }.
import { Button, Field, Modal } from "../ui.js";

export const BLANK_SCENE = { faction: "", cash: "", items: [], otherRewards: "", notes: "", assistants: [] };
export const sceneIsBlank = (f) => !f || (
  !f.faction && !String(f.cash ?? "").trim() && (f.items?.length || 0) === 0 &&
  !String(f.otherRewards ?? "").trim() && !String(f.notes ?? "").trim() && (f.assistants?.length || 0) === 0
);

export default function SceneForm({ auth, title = "Log scene", form, setForm, lists, onSubmit, onClose, busy, proposed, footer }) {
  const factions = lists?.factions || [], inventory = lists?.inventory || [], staff = lists?.staff || [];
  const toggleAssistant = (s) => setForm(f => {
    const has = f.assistants.some(a => a.staff_id === s.discord_id);
    return { ...f, assistants: has ? f.assistants.filter(a => a.staff_id !== s.discord_id) : [...f.assistants, { staff_id: s.discord_id, staff_name: s.display_name }] };
  });
  const setItem = (idx, patch) => setForm(f => { const n = [...f.items]; n[idx] = { ...n[idx], ...patch }; return { ...f, items: n }; });
  return (
    <Modal title={title} maxWidth={720} onClose={onClose} onSave={onSubmit} saveLabel={busy ? "Submitting…" : "Submit scene"} saveDisabled={busy || !form.faction || !form.notes.trim()}>
      <Field label="Target faction">
        <select value={form.faction} onChange={e => setForm({ ...form, faction: e.target.value })}>
          <option value="">{lists ? "Select…" : "Loading…"}</option>
          {factions.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </Field>
      <div className="pane stack gap-md">
        <div className="row spread"><span className="lbl">Rewards &amp; inventory</span><Button type="button" variant="ghost" size="sm" onClick={() => setForm({ ...form, items: [...form.items, { name: "", qty: 1 }] })}>+ Add item</Button></div>
        <Field label="Cash reward ($)"><input type="number" min="0" value={form.cash} onChange={e => setForm({ ...form, cash: e.target.value })} placeholder="0" /></Field>
        {form.items.map((item, idx) => (
          <div key={idx} className="item-row">
            <Field label="Item">
              <input list={`scene-inv-${idx}`} placeholder="Type to search…" value={item.name} onChange={e => setItem(idx, { name: e.target.value })} />
              <datalist id={`scene-inv-${idx}`}>{inventory.map((inv, i) => <option key={i} value={inv.name}>{inv.category || ""}</option>)}</datalist>
            </Field>
            <Field label="Qty"><input type="number" min="1" value={item.qty} onChange={e => setItem(idx, { qty: e.target.value })} /></Field>
            <Button type="button" variant="danger ghost" size="sm" onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) })}>✕</Button>
          </div>
        ))}
        {proposed && <div className="tiny c-accent">Proposed: {proposed}</div>}
        <Field label="Other rewards"><input placeholder="e.g. 1x Declasse Tulip" value={form.otherRewards} onChange={e => setForm({ ...form, otherRewards: e.target.value })} /></Field>
      </div>
      <Field label={`Also present (optional)${form.assistants.length ? ` · ${form.assistants.length} selected` : ""}`}>
        <div className="pickbox">
          {staff.filter(s => s.discord_id !== auth.id).map(s => { const sel = form.assistants.some(a => a.staff_id === s.discord_id); return <button key={s.discord_id} type="button" className={`chip tag${sel ? " on" : ""}`} onClick={() => toggleAssistant(s)}>{sel ? "✓ " : ""}{s.display_name}</button>; })}
          {staff.length === 0 && <span className="tiny faint">{lists ? "No other staff on the roster." : "Loading…"}</span>}
        </div>
      </Field>
      <Field label="Scene notes" help="Required. What happened, who was there, what was handed out."><textarea rows={6} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
      {footer && <div className="tiny faint mono">{footer}</div>}
    </Modal>
  );
}
