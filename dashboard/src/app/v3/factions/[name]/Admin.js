"use client";
import { useEffect, useState } from "react";
import { renameFaction, editFactionLead, setFactionAliases, editFactionTier, deleteFaction, restoreFaction, editAuditEntry, deleteAuditEntry } from "../../../fm/factions/actions.js";
import { getStaffList } from "../../../fm/teams/actions.js";
import { Card, Badge, Button, Empty, Modal, Field, useAction } from "../../ui.js";
import { short } from "../shared.js";

/* Admin: the faction's identity (rename, lead, aliases, tier, FM thread),
   its audit trail and the danger zone. Gates mirror the actions: identity and
   archive/restore are L3, the trail is readable by every leader; audit rows
   are editable by L3 while the faction is active. */
export default function Admin({ hub, onRenamed, onArchived }) {
  const { detail, isL3, archived, reload, setModal } = hub;
  const { run, busy } = useAction();
  const [form, setForm] = useState(null);     // { kind, ... }
  const [staff, setStaff] = useState(null);
  const [editId, setEditId] = useState(null);
  const [editText, setEditText] = useState("");
  const canEdit = isL3 && !archived;
  useEffect(() => { if (form?.kind === "lead" && staff === null) getStaffList().then(s => setStaff(s || [])).catch(() => setStaff([])); }, [form?.kind]);
  const done = (msg) => ({ success: msg, onDone: async () => { setForm(null); await reload(); } });
  const aliases = String(detail.aliases || "").split(",").map(s => s.trim()).filter(Boolean);

  return (
    <div className="grid two">
      <div className="stack">
        <Card title="Identity" right={canEdit ? <span className="muted small">leadership edits</span> : archived ? <Badge tone="warn">archived · read-only</Badge> : <span className="muted small">leadership edits</span>}>
          <div className="list">
            {[
              ["Name", detail.name, "rename"],
              ["Tier", `Tier ${detail.tier}`, "tier"],
              ["Lead", detail.leadName || "Unassigned", "lead"],
              ["Aliases", aliases.length ? aliases.join(", ") : "—", "aliases"],
              ["FM thread", detail.threadId || "—", "thread"],
            ].map(([k, v, kind]) => (
              <div className="li" key={k}>
                <div className="body"><div className="lbl">{k}</div><div className={`t${kind === "thread" ? " mono small" : ""}`}>{v}</div></div>
                {canEdit && <div className="side"><Button size="sm" variant="ghost" onClick={() => kind === "thread" ? setModal({ kind: "link", field: "thread" }) : setForm({ kind, value: kind === "rename" ? detail.name : kind === "tier" ? String(detail.tier) : kind === "lead" ? (detail.leadId || "") : aliases.join(", ") })}>Edit</Button></div>}
              </div>
            ))}
          </div>
          {canEdit && <div className="hint" style={{ marginTop: 8 }}>Setting the tier here bypasses the review cycle — use it for corrections; promotions and demotions belong on the Review tab.</div>}
        </Card>

        {isL3 && (
          <Card title={<span style={{ color: "var(--rose)" }}>Danger zone</span>}>
            {archived
              ? <div className="danger-row"><span className="x">Archived{detail.archivedAt ? ` on ${String(detail.archivedAt).slice(0, 10)}` : ""}. Restoring puts it back on every list and re-enables writes.</span><Button size="sm" variant="good" disabled={busy} onClick={() => { if (window.confirm(`Restore ${detail.name}?`)) run(() => restoreFaction(detail.id), done(`${detail.name} restored.`)); }}>Restore faction</Button></div>
              : <div className="danger-row"><span className="x">Archive removes the faction from active lists, clears any staged promotion and denies its open RP requests — restorable from here or from the archived list.</span><Button size="sm" variant="danger ghost" disabled={busy} onClick={() => { if (window.confirm(`Archive ${detail.name}?`)) run(() => deleteFaction(detail.id), { success: `${detail.name} archived.`, onDone: onArchived }); }}>Archive faction</Button></div>}
          </Card>
        )}
      </div>

      <Card title="Audit trail" right={<span className="muted small">{detail.history.length} most recent</span>}>
        {detail.history.length === 0 ? <Empty>No history.</Empty> : detail.history.map(h => (
          <div className="tl" key={h.id}>
            <span className="when">{short(h.created_at)}</span>
            <div className="body">
              <div className="t"><Badge tone={h.action_type.includes("PROMO") ? "good" : h.action_type.includes("DEMOT") || h.action_type.includes("ARCHIV") ? "warn" : "accent"}>{h.action_type}</Badge></div>
              {editId === h.id
                ? <div><textarea className="inp" rows={2} value={editText} onChange={e => setEditText(e.target.value)} /><div className="inline-actions"><Button size="sm" disabled={busy} onClick={() => run(() => editAuditEntry(h.id, editText), { success: "Entry updated.", onDone: async () => { setEditId(null); await reload(); } })}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Cancel</Button></div></div>
                : <div className="d">{h.details}</div>}
            </div>
            <span className="by">{h.authorized_by}</span>
            {canEdit && editId !== h.id && <span className="actions-inline"><Button size="sm" variant="quiet" onClick={() => { setEditId(h.id); setEditText(h.details || ""); }}>Edit</Button><Button size="sm" variant="danger ghost" disabled={busy} onClick={() => { if (window.confirm("Delete this audit entry?")) run(() => deleteAuditEntry(h.id), { success: "Entry deleted.", onDone: reload }); }}>Del</Button></span>}
          </div>
        ))}
      </Card>

      {form?.kind === "rename" && <Modal title="Rename faction" onClose={() => setForm(null)} saveLabel="Rename" saveDisabled={busy || !form.value.trim() || form.value.trim() === detail.name}
        onSave={() => { const nm = form.value.trim(); run(() => renameFaction(detail.id, detail.name, nm), { success: `Renamed to ${nm}.`, onDone: () => { setForm(null); onRenamed(nm); } }); }}>
        <Field label="New name" help="Renames the faction everywhere — portal, records, history. The old name becomes an alias."><input autoFocus value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} /></Field>
      </Modal>}
      {form?.kind === "tier" && <Modal title="Set tier" onClose={() => setForm(null)} saveDisabled={busy || String(form.value) === String(detail.tier)}
        onSave={() => run(() => editFactionTier(detail.id, parseInt(form.value)), done(`Tier set to ${form.value}.`))}>
        <Field label="Tier" help="A direct correction. Imports are not changed; promotions and demotions on the Review tab handle those."><select autoFocus value={form.value} onChange={e => setForm({ ...form, value: e.target.value })}>{[...Array(10)].map((_, i) => <option key={i} value={i}>Tier {i}</option>)}</select></Field>
      </Modal>}
      {form?.kind === "lead" && <Modal title="Faction lead" onClose={() => setForm(null)} saveDisabled={busy || staff === null}
        onSave={() => run(() => editFactionLead(detail.id, form.value), done("Lead updated."))}>
        <Field label="Lead" help="The lead's team becomes the faction's team: its guides see the faction, its leads review it.">
          {staff === null ? <div className="skeleton" style={{ height: 34 }} /> : (
            <select autoFocus value={form.value} onChange={e => setForm({ ...form, value: e.target.value })}>
              <option value="">— No lead —</option>
              {staff.map(s => <option key={s.discord_id} value={s.discord_id}>{s.display_name}{s.team_name ? ` · ${s.team_name}` : ""} (L{s.clearance})</option>)}
            </select>
          )}
        </Field>
      </Modal>}
      {form?.kind === "aliases" && <Modal title="Forum aliases" onClose={() => setForm(null)} saveDisabled={busy}
        onSave={() => run(() => setFactionAliases(detail.id, form.value), done("Aliases saved."))}>
        <Field label="Aliases" help="Comma-separated alternative names used for forum matching and bot commands."><input autoFocus value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} /></Field>
      </Modal>}
    </div>
  );
}
