"use client";
// Storytelling › Change Log — black-market doctor and drop-location changes.
// Read: everyone here. Add / edit / delete: L3 and Event Team (policy 4); each
// write posts to Discord through the action's own ping route.
import { useEffect, useMemo, useState } from "react";
import { getChangeLogs, addChangeLog, editChangeLog, deleteChangeLog } from "../../fm/storytelling/actions.js";
import { Card, Badge, Button, Field, Empty, Modal, useAction, fmtDate } from "../ui.js";
import { useCopy, CopyButton, confirmIt } from "../library/shared.js";

const BLANK = { change_type: "black_market_doctor", name: "", position: "", action: "Added", blocked_off: false, notes: "" };
const ACTION_TONE = { Added: "good", Moved: "warn", Removed: "bad" };

export default function ChangeLog({ auth, initialQ = "" }) {
  const canWrite = (auth.level || 0) >= 3 || !!auth.isEventTeam;
  const [rows, setRows] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState(initialQ);
  const [form, setForm] = useState(null);
  const [copied, copy] = useCopy();
  const { run, busy } = useAction();

  const load = async () => { try { setRows(await getChangeLogs() || []); setLoadErr(""); } catch (e) { setRows([]); setLoadErr(e?.message || "Could not load the change log."); } };
  useEffect(() => { load(); }, []);
  useEffect(() => { if (initialQ) setSearch(initialQ); }, [initialQ]);

  const shown = useMemo(() => (rows || []).filter(c => filter === "all" || c.change_type === filter).filter(c => !search || [c.name, c.position, c.notes].some(x => (x || "").toLowerCase().includes(search.toLowerCase()))), [rows, filter, search]);
  const save = () => run(() => {
    const p = { name: form.name, position: form.position, changeType: form.change_type, action: form.change_type === "black_market_doctor" ? form.action : "", blockedOff: form.blocked_off, notes: form.notes };
    return form.id ? editChangeLog(form.id, p) : addChangeLog(p);
  }, { success: form.id ? "Entry updated and re-posted to Discord." : "Entry added and posted to Discord.", onDone: () => { setForm(null); load(); } });
  const remove = (c) => { if (!confirmIt(`Delete the log entry for “${c.name}”? Discord is told only the entry was removed.`)) return; run(() => deleteChangeLog(c.id), { success: "Entry deleted.", onDone: load }); };

  if (rows === null) return <div className="stack"><div className="skeleton row" /><div className="skeleton block" /></div>;

  return (
    <div className="stack">
      <div className="row">
        <input className="inp grow" placeholder="Search by name, location or notes…" value={search} onChange={e => setSearch(e.target.value)} />
        <div className="chips">{[["all", "All"], ["black_market_doctor", "Doctors"], ["drop_location", "Drops"]].map(([v, l]) => <button key={v} className={`chip tag${filter === v ? " on" : ""}`} onClick={() => setFilter(v)}>{l}</button>)}</div>
        {canWrite && <Button onClick={() => setForm({ ...BLANK })}>+ Entry</Button>}
      </div>
      {loadErr && <div className="err">{loadErr}</div>}
      {shown.length === 0 ? <Empty title="No entries">{canWrite ? "Record a doctor or drop change with “+ Entry”." : ""}</Empty> : (
        <Card>
          <div className="list">
            {shown.map(c => {
              const doctor = c.change_type === "black_market_doctor";
              return (
                <div key={c.id} className="line">
                  <span className="tiny faint mono hide-sm">{fmtDate(c.created_at)}</span>
                  <Badge tone={doctor ? "bad" : "accent"}>{doctor ? "Doctor" : "Drop"}</Badge>
                  {c.action && <Badge tone={ACTION_TONE[c.action]}>{c.action}</Badge>}
                  {c.action === "Removed" && <Badge tone={c.blocked_off ? "good" : "bad"}>{c.blocked_off ? "Blocked off" : "Not blocked"}</Badge>}
                  <span className="t">{c.name}</span>
                  {c.position && <CopyButton text={`/tppos ${c.position}`} id={`cl-${c.id}`} copied={copied} copy={copy} label={`/tppos ${c.position}`} title="Copy teleport command" />}
                  {c.notes && <span className="muted small">{c.notes}</span>}
                  <span className="spacer" />
                  <span className="tiny faint hide-sm">{c.created_by}</span>
                  {canWrite && <span className="actions-inline">
                    <Button size="sm" variant="ghost" onClick={() => setForm({ id: c.id, change_type: c.change_type, name: c.name || "", position: c.position || "", action: c.action || "Added", blocked_off: !!c.blocked_off, notes: c.notes || "" })}>Edit</Button>
                    <Button size="sm" variant="danger ghost" disabled={busy} onClick={() => remove(c)}>Del</Button>
                  </span>}
                </div>
              );
            })}
          </div>
        </Card>
      )}
      {form && (
        <Modal title={`${form.id ? "Edit" : "New"} change-log entry`} onClose={() => setForm(null)} onSave={save} saveLabel={form.id ? "Save & re-post" : "Add & post"} saveDisabled={busy || !form.name.trim()}>
          <Field label="Type"><select value={form.change_type} onChange={e => setForm({ ...form, change_type: e.target.value })}><option value="black_market_doctor">Black Market Doctor</option><option value="drop_location">Drop Location</option></select></Field>
          <Field label="Name"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="/tppos location"><input className="mono" placeholder="x y z" value={form.position} onChange={e => setForm({ ...form, position: e.target.value })} /></Field>
          {form.change_type === "black_market_doctor" && <>
            <Field label="Action"><select value={form.action} onChange={e => setForm({ ...form, action: e.target.value })}>{["Added", "Moved", "Removed"].map(a => <option key={a} value={a}>{a}</option>)}</select></Field>
            {form.action === "Removed" && <label className="check"><input type="checkbox" checked={form.blocked_off} onChange={e => setForm({ ...form, blocked_off: e.target.checked })} /> Location blocked off?</label>}
          </>}
          <Field label="Notes (optional)"><input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
        </Modal>
      )}
    </div>
  );
}
