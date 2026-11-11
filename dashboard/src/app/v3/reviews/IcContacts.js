"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getAllIcContacts, getThreadMessages, assignIcContact, setIcContactStatus, stageRoleplay, completeIcContact, getStaffList, getIcContactFormData } from "../../fm/teams/actions.js";
import { FM_GUILD_ID } from "../../../lib/constants";
import { Card, Badge, Button, Field, Empty, useAction, fmtDate, fmtDateTime } from "../ui.js";

/*
 * IC contacts triage (L3): every incoming IC contact across factions, with the
 * v2 actions — assign a staffer, change the status (completing archives it),
 * stage an RP change from the contact (the server records the contact on the
 * request and advances it to pending_roleplay) and read the Discord thread.
 */
const IC_STATUS = {
  pending_discussion: { label: "Pending Discussion", tone: "warn" },
  pending_roleplay: { label: "Pending Roleplay", tone: "info" },
  completed: { label: "Completed", tone: "good" },
};

export default function IcContacts() {
  const [contacts, setContacts] = useState(null);
  const [staffList, setStaffList] = useState([]);
  const [filter, setFilter] = useState("active");
  const [q, setQ] = useState("");
  const load = async () => {
    const [c, s] = await Promise.all([getAllIcContacts().catch(() => []), getStaffList().catch(() => [])]);
    setContacts(c || []); setStaffList(s || []);
  };
  useEffect(() => { load(); }, []);
  if (!contacts) return <div className="stack"><div className="skeleton" style={{ height: 36 }} /><div className="skeleton" style={{ height: 140 }} /><div className="skeleton" style={{ height: 140 }} /></div>;

  const filtered = contacts
    .filter(c => filter === "all" ? true : filter === "unassigned" ? (c.status !== "completed" && !c.assigned_to) : c.status !== "completed")
    .filter(c => !q || [c.faction_name, c.sender_name, c.team_name, c.message, c.assigned_name].some(x => (x || "").toLowerCase().includes(q.toLowerCase())));
  const active = contacts.filter(c => c.status !== "completed").length;
  return (
    <>
      <div className="rv-toolbar">
        <div className="chips">
          {[["active", `Active`, active], ["unassigned", "Unassigned", contacts.filter(c => c.status !== "completed" && !c.assigned_to).length], ["all", "All", contacts.length]].map(([v, l, n]) => (
            <button key={v} className={`chip${filter === v ? " on" : ""}`} onClick={() => setFilter(v)}>{l} <span className="tiny faint">{n}</span></button>
          ))}
        </div>
        <input className="inp rv-inp" placeholder="Filter contacts…" value={q} onChange={e => setQ(e.target.value)} aria-label="Filter contacts" />
        <span className="mono tiny faint rv-due">{filtered.length} contact{filtered.length !== 1 ? "s" : ""}</span>
      </div>
      {contacts.length === 0 ? <Empty title="No IC contacts">Nothing has come in through the faction portals yet.</Empty>
        : filtered.length === 0 ? <Empty>Nothing matches this filter.</Empty>
        : <div className="stack">{filtered.map(c => <IcContactCard key={c.id} contact={c} staffList={staffList} onRefresh={load} />)}</div>}
    </>
  );
}

function IcContactCard({ contact, staffList, onRefresh }) {
  const [assigning, setAssigning] = useState(false);
  const [assignId, setAssignId] = useState("");
  const [stagingRP, setStagingRP] = useState(false);
  const { run, busy } = useAction();
  const meta = IC_STATUS[contact.status] || IC_STATUS.pending_discussion;
  const done = contact.status === "completed";
  const changeStatus = (s) => {
    if (s === contact.status) return;
    if (s === "completed") { if (!window.confirm("Complete and archive this contact?")) return; run(() => completeIcContact(contact.id), { success: "Contact completed.", onDone: onRefresh }); }
    else run(() => setIcContactStatus(contact.id, s), { success: `Status set to ${IC_STATUS[s]?.label || s}.`, onDone: onRefresh });
  };
  return (
    <Card className={done ? "ic-done" : ""}>
      <div className="row spread" style={{ paddingBottom: 8, borderBottom: "1px solid var(--line)" }}>
        <div className="row" style={{ gap: 8 }}>
          <Link href={`/v3/factions/${encodeURIComponent(contact.faction_name)}?tab=comms`} className="ic-faction">{contact.faction_name}</Link>
          <span className="faint">·</span>
          <span className="small">{contact.sender_name}</span>
          {contact.contact_type && <Badge tone="accent">{contact.contact_type}</Badge>}
          {contact.team_name && <Badge>{contact.team_name}</Badge>}
          {contact.faction_archived ? <Badge tone="lock">ARCHIVED</Badge> : null}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className="mono tiny faint" title={contact.submitted_at}>{fmtDate(contact.submitted_at)}</span>
          {contact.thread_id && <a className="tiny ic-link" href={`https://discord.com/channels/${FM_GUILD_ID}/${contact.thread_id}`} target="_blank" rel="noreferrer">Thread ↗</a>}
          {contact.faction_archived
            ? <Badge tone={meta.tone}>{meta.label}</Badge>
            : <select className={`inp ic-status ${meta.tone}`} disabled={busy} value={contact.status} onChange={e => changeStatus(e.target.value)} aria-label="Contact status">
              <option value="pending_discussion">Pending Discussion</option>
              <option value="pending_roleplay">Pending Roleplay</option>
              <option value="completed">Completed</option>
            </select>}
        </div>
      </div>
      <div style={{ paddingTop: 10 }}>
        <p className="ic-msg">{contact.message}</p>
        <div className="small muted" style={{ marginBottom: 10 }}>
          {contact.assigned_name ? <><span style={{ color: "var(--accent)" }}>{contact.assigned_name}</span> assigned</> : "Unassigned"}
          {contact.rp_change_id ? <> · RP change request #{contact.rp_change_id} <Link href="/v3?panel=queue" className="ic-link">(queue)</Link></> : null}
        </div>
        {assigning && (
          <div className="row" style={{ marginBottom: 10 }}>
            <select className="inp rv-inp" style={{ minWidth: 220, flex: 1 }} value={assignId} onChange={e => setAssignId(e.target.value)}>
              <option value="">Select member…</option>
              {staffList.map(s => <option key={s.discord_id} value={s.discord_id}>{s.display_name}{s.team_name ? ` (${s.team_name})` : ""}</option>)}
            </select>
            <Button size="sm" disabled={!assignId || busy} onClick={() => run(() => assignIcContact(contact.id, assignId), { success: "Assigned.", onDone: () => { setAssigning(false); setAssignId(""); onRefresh(); } })}>Confirm</Button>
            <Button size="sm" variant="quiet" onClick={() => setAssigning(false)}>Cancel</Button>
          </div>
        )}
        {stagingRP && (
          <RpStageForm contact={contact} busy={busy} onCancel={() => setStagingRP(false)}
            onSubmit={(rpData) => run(() => stageRoleplay(contact.id, rpData), { success: "RP change requested — FM Leadership has been pinged to approve it.", onDone: () => { setStagingRP(false); onRefresh(); } })} />
        )}
        {!assigning && !stagingRP && !contact.faction_archived && (
          <div className="actions-inline">
            <Button size="sm" variant="ghost" onClick={() => setAssigning(true)}>Assign</Button>
            {!done && <Button size="sm" variant="ghost" onClick={() => setStagingRP(true)}>Request RP change</Button>}
          </div>
        )}
        {contact.thread_id && <IcThread threadId={contact.thread_id} />}
      </div>
    </Card>
  );
}

function IcThread({ threadId }) {
  const [msgs, setMsgs] = useState(null);
  const [open, setOpen] = useState(false);
  const toggle = () => { if (!open && msgs === null) getThreadMessages(threadId).then(m => setMsgs(m || [])).catch(() => setMsgs([])); setOpen(o => !o); };
  return (
    <div style={{ marginTop: 10 }}>
      <Button size="sm" variant="quiet" onClick={toggle}>{open ? "Hide thread" : "View thread messages"}</Button>
      {open && (
        <div className="ic-thread">
          {msgs === null ? <div className="skeleton" style={{ height: 40, margin: 10 }} />
            : msgs.length === 0 ? <div className="small muted" style={{ padding: "10px 12px" }}>No messages in the thread (or the bot cannot read it).</div>
              : msgs.map(m => (
                <div key={m.id} className={`ic-m${m.authorBot ? " bot" : ""}`}>
                  <div className="row" style={{ gap: 8, marginBottom: 2 }}><span className="small" style={{ fontWeight: 700, color: m.authorBot ? "var(--accent)" : "var(--ink-0)" }}>{m.author}</span><span className="mono tiny faint">{fmtDateTime(m.timestamp)}</span></div>
                  <p className="small" style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{m.content}</p>
                </div>
              ))}
        </div>
      )}
    </div>
  );
}

/*
 * Stage an RP change from a contact (same contract as fm/teams/RpChangeForm and
 * the hub's Stage RP modal). NPC: { type, npcId, oldValue, newValue, turf };
 * HQ: { oldValue: current address, newValue }; TURF: { turf, oldValue: turf,
 * newValue: new name }; PROPERTY: { oldValue: address | N/A, newValue: address
 * | REMOVED }; Other: { newValue: details }.
 */
function RpStageForm({ contact, busy, onSubmit, onCancel }) {
  const [data, setData] = useState(null);
  const [f, setF] = useState({ type: "NPC", npcId: "", newType: "", oldAddr: "", newAddr: "", turf: "", turfNew: "", propOld: "", propNew: "", propRemove: false, details: "" });
  useEffect(() => { getIcContactFormData(contact.faction_id).then(d => setData(d || { npcs: [], npcTypes: [], properties: [] })).catch(() => setData({ npcs: [], npcTypes: [], properties: [] })); }, [contact.faction_id]);
  if (!data) return <div className="skeleton" style={{ height: 80 }} />;
  const { npcs = [], npcTypes = [], properties = [], scoped } = data;
  const npc = npcs.find(n => String(n.id) === f.npcId);
  const turfs = [...new Set(npcs.map(n => n.turf).filter(t => t && t !== "Neutral"))].sort();
  const set = (patch) => setF({ ...f, ...patch });
  const canSubmit = f.type === "NPC" ? (npc && f.newType && f.newType !== npc.npc_type)
    : f.type === "HQ" ? (f.oldAddr && f.newAddr.trim())
    : f.type === "TURF" ? (f.turf && f.turfNew.trim())
    : f.type === "PROPERTY" ? (f.propOld && (f.propOld === "N/A" ? f.propNew.trim() : (f.propRemove || f.propNew.trim())))
    : f.details.trim();
  const submit = () => {
    if (f.type === "NPC") onSubmit({ type: "NPC", npcId: npc.id, oldValue: npc.npc_type, newValue: f.newType, turf: npc.turf });
    else if (f.type === "HQ") onSubmit({ type: "HQ", oldValue: f.oldAddr, newValue: f.newAddr.trim(), turf: "N/A" });
    else if (f.type === "TURF") onSubmit({ type: "TURF", turf: f.turf, oldValue: f.turf, newValue: f.turfNew.trim() });
    else if (f.type === "PROPERTY") onSubmit({ type: "PROPERTY", oldValue: f.propOld || "N/A", newValue: f.propOld !== "N/A" && f.propRemove ? "REMOVED" : f.propNew.trim(), turf: "N/A" });
    else onSubmit({ type: "Other", oldValue: "N/A", newValue: f.details.trim(), turf: "N/A" });
  };
  const reset = (type) => setF({ type, npcId: "", newType: "", oldAddr: "", newAddr: "", turf: "", turfNew: "", propOld: "", propNew: "", propRemove: false, details: "" });
  return (
    <div className="inline-form">
      <span className="lbl">RP change request — {contact.faction_name}</span>
      <div className="chips">{[["NPC", "NPC"], ["HQ", "HQ"], ["TURF", "Turf"], ["PROPERTY", "Property"], ["Other", "Other"]].map(([t, l]) => <button key={t} type="button" className={`chip${f.type === t ? " on" : ""}`} onClick={() => reset(t)}>{l}</button>)}</div>
      {data.error && <div className="err">{data.error}</div>}
      <div className="form-grid">
        {f.type === "NPC" && <>
          <Field label="Current NPC" help={!scoped && npcs.length > 0 ? "No NPC is registered to this faction's turf — showing every claimable NPC." : npc ? `Turf ${npc.turf} · currently ${npc.npc_type}` : undefined}>
            <select value={f.npcId} onChange={e => { const id = e.target.value; const n = npcs.find(x => String(x.id) === id); set({ npcId: id, newType: f.newType || n?.npc_type || "" }); }}><option value="">Select NPC…</option>{npcs.map(n => <option key={n.id} value={String(n.id)}>{n.name} ({n.npc_type}) — {n.turf}</option>)}</select>
          </Field>
          <Field label="New NPC type"><select value={f.newType} onChange={e => set({ newType: e.target.value })}><option value="">Select new type…</option>{npcTypes.map(t => <option key={t} value={t}>{t}</option>)}</select></Field>
        </>}
        {f.type === "HQ" && <>
          <Field label="Current address"><select value={f.oldAddr} onChange={e => set({ oldAddr: e.target.value })}><option value="">Select property…</option>{properties.map(p => <option key={p.id} value={p.address}>{p.is_hq ? "HQ: " : ""}{p.address}</option>)}</select></Field>
          <Field label="New address"><input value={f.newAddr} onChange={e => set({ newAddr: e.target.value })} placeholder="Enter new address…" /></Field>
        </>}
        {f.type === "TURF" && <>
          <Field label="Turf being changed" help={turfs.length === 0 ? "No turf is registered for this faction's NPCs." : undefined}><select value={f.turf} onChange={e => set({ turf: e.target.value })}><option value="">Select turf…</option>{turfs.map(t => <option key={t} value={t}>{t}</option>)}</select></Field>
          <Field label="New turf name" help="Executing renames the turf and moves every NPC on it; renaming onto an existing turf merges them. Same name = shipment-power change only."><input value={f.turfNew} onChange={e => set({ turfNew: e.target.value })} placeholder="New name for the turf…" /></Field>
        </>}
        {f.type === "PROPERTY" && <>
          <Field label="Current property"><select value={f.propOld} onChange={e => set({ propOld: e.target.value, propRemove: false })}><option value="">Select…</option><option value="N/A">— New property (not on the list yet) —</option>{properties.map(p => <option key={p.id} value={p.address}>{p.is_hq ? "HQ: " : ""}{p.address}</option>)}</select></Field>
          {f.propOld && f.propOld !== "N/A" && <label className="check"><input type="checkbox" checked={f.propRemove} onChange={e => set({ propRemove: e.target.checked, propNew: e.target.checked ? "" : f.propNew })} /> Remove this property from the faction</label>}
          {!(f.propOld && f.propOld !== "N/A" && f.propRemove) && <Field label={f.propOld === "N/A" ? "Address to add" : "New address"}><input value={f.propNew} onChange={e => set({ propNew: e.target.value })} placeholder={f.propOld === "N/A" ? "Address of the new property…" : "New address for this property…"} /></Field>}
        </>}
        {f.type === "Other" && <Field label="Details"><input value={f.details} onChange={e => set({ details: e.target.value })} placeholder="Describe the change…" /></Field>}
      </div>
      <div className="actions-inline">
        <Button disabled={!canSubmit || busy} onClick={submit}>Submit RP request</Button>
        <Button variant="quiet" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
