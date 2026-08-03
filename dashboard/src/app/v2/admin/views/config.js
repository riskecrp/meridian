"use client";
// Admin › Config: Important Links, Recurring Reminders, Documents.
// Split out of admin/page.js — content unchanged.
import { useEffect, useMemo, useState } from "react";
import { getLinks, saveLinks, publishLinks } from "../../../fm/operations/links/actions.js";
import { listReminders, listChannels, getTargetOptions, createReminder, updateReminder, deleteReminder, getReminderProgress, adminCompleteInstance, forceSendRecurringReminder } from "../../../fm/operations/reminders/actions.js";
import { getDocuments, createDocument, updateDocument, deleteDocument } from "../../../fm/documents/actions.js";
import QuillEditor from "../../../../lib/QuillEditor";

/* ── Important Links (Discord-published editor) ── */
let _uid = 0; const nid = () => `r${++_uid}`;
const hydrate = (s) => (s || []).map(x => ({ id: nid(), type: x.type === "text" ? "text" : "links", heading: x.heading || "", ordered: !!x.ordered, text: x.text || "", links: (x.links || []).map(l => ({ id: nid(), label: l.label || "", url: l.url || "" })) }));
const dehydrate = (s) => s.map(x => x.type === "text" ? { type: "text", heading: x.heading, text: x.text } : { type: "links", heading: x.heading, ordered: x.ordered, links: x.links.map(l => ({ label: l.label, url: l.url })) });

function Links() {
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("Important Links");
  const [sections, setSections] = useState([]);
  const [postUrl, setPostUrl] = useState(null);
  const [pub, setPub] = useState(false);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState(null);
  useEffect(() => { getLinks().then(d => { setTitle(d.title); setSections(hydrate(d.sections)); setPostUrl(d.postUrl); setPub(d.published); setLoading(false); }).catch(() => setLoading(false)); }, []);
  const payload = useMemo(() => dehydrate(sections), [sections]);
  const patchS = (i, p) => setSections(s => s.map((x, j) => j === i ? { ...x, ...p } : x));
  const moveS = (i, d) => setSections(s => { const j = i + d; if (j < 0 || j >= s.length) return s; const n = [...s]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const rmS = (i) => setSections(s => s.filter((_, j) => j !== i));
  const addS = (t) => setSections(s => [...s, t === "text" ? { id: nid(), type: "text", heading: "New section", text: "" } : { id: nid(), type: "links", heading: "New section", ordered: false, links: [{ id: nid(), label: "", url: "" }] }]);
  const patchL = (si, li, p) => setSections(s => s.map((x, j) => j !== si ? x : { ...x, links: x.links.map((l, k) => k === li ? { ...l, ...p } : l) }));
  const rmL = (si, li) => setSections(s => s.map((x, j) => j !== si ? x : { ...x, links: x.links.filter((_, k) => k !== li) }));
  const addL = (si) => setSections(s => s.map((x, j) => j !== si ? x : { ...x, links: [...x.links, { id: nid(), label: "", url: "" }] }));
  const doSave = async () => { setBusy("save"); setStatus(null); try { await saveLinks(title, payload); setStatus({ ok: true, msg: "Draft saved." }); } catch (e) { setStatus({ ok: false, msg: e.message || "Failed." }); } setBusy(""); };
  const doPub = async () => { setBusy("pub"); setStatus(null); try { const r = await publishLinks(title, payload); if (r.ok) { setPostUrl(r.url); setPub(true); setStatus({ ok: true, msg: "Published to Discord." }); } else setStatus({ ok: false, msg: r.error || "Failed." }); } catch (e) { setStatus({ ok: false, msg: e.message || "Failed." }); } setBusy(""); };
  if (loading) return <div className="empty">Loading…</div>;
  return (
    <div style={{ maxWidth: 820 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span className="chip" style={{ background: pub ? "var(--good-bg)" : "var(--amber-bg)", color: pub ? "var(--good)" : "var(--amber)" }}>{pub ? "live" : "not published"}</span>
        {postUrl && <a href={postUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--accent)" }}>View post ↗</a>}
        <span style={{ fontSize: 11, color: "var(--ink-3)" }}>One bot-managed post in #fm-useful-links, edited in place.</span>
      </div>
      <input className="filter-inp" value={title} onChange={e => setTitle(e.target.value)} maxLength={100} placeholder="Post title" style={{ marginBottom: 14 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {sections.map((sec, si) => (
          <div className="card" key={sec.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 14, marginBottom: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span className="chip" style={{ background: sec.type === "text" ? "var(--amber-bg)" : "var(--accent-bg)", color: sec.type === "text" ? "var(--amber)" : "var(--accent)" }}>{sec.type === "text" ? "TEXT" : "LINKS"}</span>
              <input className="filter-inp" value={sec.heading} onChange={e => patchS(si, { heading: e.target.value })} placeholder="Section heading" style={{ fontWeight: 700 }} />
              <button className="act" style={{ padding: "2px 7px" }} onClick={() => moveS(si, -1)}>↑</button>
              <button className="act" style={{ padding: "2px 7px" }} onClick={() => moveS(si, 1)}>↓</button>
              <button className="act" style={{ padding: "2px 7px", color: "var(--rose)" }} onClick={() => rmS(si)}>✕</button>
            </div>
            {sec.type === "text" ? <textarea className="filter-inp" rows={4} value={sec.text} onChange={e => patchS(si, { text: e.target.value })} placeholder="Markdown — **bold**, bullet lines…" />
              : <>
                <label style={{ fontSize: 11, color: "var(--ink-2)", display: "inline-flex", gap: 6, marginBottom: 8 }}><input type="checkbox" checked={sec.ordered} onChange={e => patchS(si, { ordered: e.target.checked })} /> Numbered list</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {sec.links.map((l, li) => (
                    <div key={l.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ width: 16, textAlign: "right", fontFamily: "var(--v2-mono)", fontSize: 11, color: "var(--ink-3)" }}>{sec.ordered ? `${li + 1}.` : "•"}</span>
                      <input className="filter-inp" style={{ flex: "0 0 36%" }} value={l.label} onChange={e => patchL(si, li, { label: e.target.value })} placeholder="Label" />
                      <input className="filter-inp" value={l.url} onChange={e => patchL(si, li, { url: e.target.value })} placeholder="https://…" />
                      <button className="act" style={{ padding: "2px 7px", color: "var(--rose)" }} onClick={() => rmL(si, li)}>✕</button>
                    </div>
                  ))}
                </div>
                <button className="act" style={{ marginTop: 8 }} onClick={() => addL(si)}>+ Add link</button>
              </>}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}><button className="act" onClick={() => addS("links")}>+ Links section</button><button className="act" onClick={() => addS("text")}>+ Text section</button></div>
      <div style={{ display: "flex", gap: 10, marginTop: 20, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn" disabled={!!busy} onClick={doPub}>{busy === "pub" ? "Publishing…" : pub ? "Update Discord post" : "Publish to Discord"}</button>
        <button className="act" disabled={!!busy} onClick={doSave}>{busy === "save" ? "Saving…" : "Save draft"}</button>
        {status && <span style={{ fontSize: 12, fontWeight: 600, color: status.ok ? "var(--good)" : "var(--rose)" }}>{status.ok ? "✓ " : "⚠ "}{status.msg}</span>}
      </div>
    </div>
  );
}
/* ── Recurring Reminders (L2+; Progress + Force Send = L3) ── */
const CHANNEL_LABELS = {
  global_ping_channel: "#meridian-database (global)",
  event_announce_channel: "#up-and-coming",
  leadership_channel: "#management-board",
  team_lead_channel: "#team-leads",
};
const ord = (n) => (n >= 11 && n <= 13) ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";
const labelForTarget = (type, id, targets) =>
  type === "User" ? (targets.staff.find(s => s.discord_id === id)?.display_name || id)
  : type === "Team" ? (targets.teams.find(t => t.team_id === id)?.team_name || id)
  : (targets.roles.find(r => r.role_id === id)?.key || id);

function RecurringReminders({ auth }) {
  const [reminders, setReminders] = useState([]);
  const [channels, setChannels] = useState([]);
  const [targets, setTargets] = useState({ teams: [], staff: [], roles: [] });
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [progressFor, setProgressFor] = useState(null);
  const [progressRows, setProgressRows] = useState([]);
  const refresh = async () => {
    const [r, c, t] = await Promise.all([listReminders(), listChannels(), getTargetOptions()]);
    setReminders(r || []); setChannels(c || []); setTargets(t || { teams: [], staff: [], roles: [] }); setLoading(false);
  };
  useEffect(() => { refresh(); }, []);
  if (loading) return <div className="empty">Loading…</div>;
  const openProgress = async (rem) => {
    const now = new Date();
    const rows = await getReminderProgress(rem.id, now.getUTCFullYear(), now.getUTCMonth() + 1);
    setProgressFor(rem); setProgressRows(rows || []);
  };
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>Monthly tasks that ping a target on a set day.</span>
        <button className="btn" onClick={() => { setEditing(null); setShowForm(true); }}>New reminder +</button>
      </div>
      {reminders.length === 0 && <div className="empty">No reminders yet. Create one to get started.</div>}
      <div className="card">
        {reminders.map(r => {
          const chKey = channels.find(c => c.channel_id === r.channel_id)?.key || r.channel_id;
          const canEdit = auth.level >= 3 || r.created_by_id === auth.id;
          return (
            <div key={r.id} style={{ borderBottom: "1px solid var(--line)", padding: "10px 0", opacity: r.active ? 1 : 0.55 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 260 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontWeight: 700 }}>{r.title}</span>
                    {!r.active && <span className="chip" style={{ background: "var(--panel-2)", color: "var(--ink-3)" }}>INACTIVE</span>}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 16px", fontSize: 11, color: "var(--ink-2)", marginTop: 3 }}>
                    <span><b>Target:</b> {r.target_type}: {labelForTarget(r.target_type, r.target_id, targets)}</span>
                    <span><b>Channel:</b> {CHANNEL_LABELS[chKey] || chKey}</span>
                    <span><b>Ping:</b> {r.ping_day}{ord(r.ping_day)} / <b>Due:</b> {r.due_day}{ord(r.due_day)}</span>
                  </div>
                  {r.body && <p style={{ fontSize: 12, marginTop: 6, whiteSpace: "pre-wrap", color: "var(--ink-1)" }}>{r.body.substring(0, 200)}{r.body.length > 200 ? "…" : ""}</p>}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {auth.level >= 3 && r.active && <button className="act" onClick={() => openProgress(r)}>Progress</button>}
                  {auth.level >= 3 && r.active && <button className="act" style={{ color: "var(--accent)" }} onClick={async () => {
                    if (window.confirm(`Force-send "${r.title}" now? Pings the channel and creates this month's instances if missing.`)) {
                      const res = await forceSendRecurringReminder(r.id);
                      if (!res.ok) { window.alert(res.error || "Failed"); return; }
                      window.alert(`Sent. ${res.recipientsCount || 0} recipient(s) notified.`);
                      refresh();
                    }
                  }}>Force send</button>}
                  {canEdit && <button className="act" onClick={() => { setEditing(r); setShowForm(true); }}>Edit</button>}
                  {canEdit && r.active && <button className="act" style={{ color: "var(--rose)" }} onClick={async () => { if (window.confirm("Deactivate this reminder? Past instances stay in the DB.")) { await deleteReminder(r.id); refresh(); } }}>Delete</button>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {showForm && <ReminderForm editing={editing} channels={channels} targets={targets} onClose={() => { setShowForm(false); setEditing(null); }} onSaved={() => { setShowForm(false); setEditing(null); refresh(); }} />}
      {progressFor && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={() => { setProgressFor(null); setProgressRows([]); }} />
          <div style={{ position: "relative", width: "100%", maxWidth: 560, maxHeight: "85vh", overflowY: "auto", background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 12, padding: 18 }}>
            <div style={{ fontWeight: 700, color: "var(--ink-0)" }}>{progressFor.title}</div>
            <div style={{ fontSize: 11, color: "var(--ink-3)", margin: "2px 0 12px" }}>This month — {progressRows.filter(r => r.completed_at).length} / {progressRows.length} completed</div>
            {progressRows.length === 0 && <div style={{ fontSize: 12, fontStyle: "italic", color: "var(--ink-3)" }}>No instances generated yet (will fire on day {progressFor.ping_day}).</div>}
            {progressRows.filter(r => !r.completed_at).length > 0 && <>
              <div className="imp-grp">Pending ({progressRows.filter(r => !r.completed_at).length})</div>
              {progressRows.filter(r => !r.completed_at).map(p => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", borderRadius: 8, background: "var(--panel-2)", marginBottom: 4 }}>
                  <span style={{ fontSize: 13 }}>{p.recipient_name}</span>
                  <button className="act" style={{ padding: "2px 8px" }} onClick={async () => { await adminCompleteInstance(p.id); openProgress(progressFor); }}>Mark done</button>
                </div>
              ))}
            </>}
            {progressRows.filter(r => r.completed_at).length > 0 && <>
              <div className="imp-grp">Completed ({progressRows.filter(r => r.completed_at).length})</div>
              {progressRows.filter(r => r.completed_at).map(c => (
                <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line)", marginBottom: 4 }}>
                  <span style={{ fontSize: 13, color: "var(--good)" }}>✓ {c.recipient_name}</span>
                  <span style={{ fontSize: 10, fontFamily: "var(--v2-mono)", color: "var(--ink-3)" }}>by {c.completed_by_name === c.recipient_name ? "self" : c.completed_by_name}</span>
                </div>
              ))}
            </>}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}><button className="act" onClick={() => { setProgressFor(null); setProgressRows([]); }}>Close</button></div>
          </div>
        </div>
      )}
    </>
  );
}

function ReminderForm({ editing, channels, targets, onClose, onSaved }) {
  const [form, setForm] = useState({
    title: editing?.title || "", body: editing?.body || "", links: editing?.links || "",
    target_type: editing?.target_type || "Role", target_id: editing?.target_id || "",
    channel_id: editing?.channel_id || "", ping_day: editing?.ping_day || 1, due_day: editing?.due_day || 10,
    active: editing?.active ?? 1,
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const submit = async () => {
    setErr("");
    if (!form.title.trim()) { setErr("Title required"); return; }
    if (!form.target_id) { setErr("Pick a target"); return; }
    if (!form.channel_id) { setErr("Pick a channel"); return; }
    setSubmitting(true);
    const res = editing ? await updateReminder(editing.id, form) : await createReminder(form);
    setSubmitting(false);
    if (!res.ok) { setErr(res.error || "Failed"); return; }
    onSaved();
  };
  const targetOptions = form.target_type === "User" ? targets.staff.map(s => ({ value: s.discord_id, label: s.display_name }))
    : form.target_type === "Team" ? targets.teams.map(t => ({ value: t.team_id, label: t.team_name }))
    : targets.roles.map(r => ({ value: r.role_id, label: r.key }));
  const lbl = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--ink-3)", marginBottom: 4 };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={onClose} />
      <div style={{ position: "relative", width: "100%", maxWidth: 560, maxHeight: "88vh", overflowY: "auto", background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 12, padding: 18 }}>
        <div style={{ fontWeight: 700, color: "var(--ink-0)", marginBottom: 14 }}>{editing ? "Edit" : "New"} recurring reminder</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div><div style={lbl}>Title *</div><input className="filter-inp" style={{ width: "100%" }} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Monthly Faction Reviews" /></div>
          <div><div style={lbl}>Body / description</div><textarea className="filter-inp" style={{ width: "100%" }} rows={4} value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} placeholder="What needs to happen this month…" /></div>
          <div><div style={lbl}>Reference links (one per line)</div><textarea className="filter-inp" style={{ width: "100%" }} rows={2} value={form.links} onChange={e => setForm({ ...form, links: e.target.value })} placeholder={"https://ecrpfm.com/fm/leadership/reviews\nhttps://ecrpfm.com/fm/factions"} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><div style={lbl}>Target type *</div>
              <select className="filter-inp" style={{ width: "100%" }} value={form.target_type} onChange={e => setForm({ ...form, target_type: e.target.value, target_id: "" })}>
                <option value="Role">Role</option><option value="Team">Team</option><option value="User">User</option>
              </select></div>
            <div><div style={lbl}>Target *</div>
              <select className="filter-inp" style={{ width: "100%" }} value={form.target_id} onChange={e => setForm({ ...form, target_id: e.target.value })}>
                <option value="">Select…</option>
                {targetOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select></div>
          </div>
          <div><div style={lbl}>Discord channel *</div>
            <select className="filter-inp" style={{ width: "100%" }} value={form.channel_id} onChange={e => setForm({ ...form, channel_id: e.target.value })}>
              <option value="">Select…</option>
              {channels.map(c => <option key={c.key} value={c.channel_id}>{CHANNEL_LABELS[c.key] || c.key}</option>)}
            </select></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><div style={lbl}>Ping day (1-31) *</div><input type="number" min="1" max="31" className="filter-inp" style={{ width: "100%" }} value={form.ping_day} onChange={e => setForm({ ...form, ping_day: parseInt(e.target.value) || 1 })} /></div>
            <div><div style={lbl}>Due day (1-31) *</div><input type="number" min="1" max="31" className="filter-inp" style={{ width: "100%" }} value={form.due_day} onChange={e => setForm({ ...form, due_day: parseInt(e.target.value) || 1 })} /></div>
          </div>
          {editing && <label style={{ fontSize: 12.5, color: "var(--ink-1)", display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={!!form.active} onChange={e => setForm({ ...form, active: e.target.checked ? 1 : 0 })} /> Active</label>}
          {err && <div style={{ fontSize: 12, color: "var(--rose)" }}>{err}</div>}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button className="act" onClick={onClose}>Cancel</button>
          <button className="act primary" disabled={submitting} onClick={submit}>{submitting ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
/* ── Documents (all staff; L3 CRUD) ── */
function DocumentsView({ auth }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editDoc, setEditDoc] = useState(null);
  const [form, setForm] = useState({ title: "", category: "General", content: "", level_required: 1 });
  const [showArchived, setShowArchived] = useState(false);
  useEffect(() => {
    getDocuments().then(d => {
      // Client-side guard: never display a doc above the viewer's level
      const safe = (d || []).filter(doc => (doc.level_required || 1) <= auth.level);
      setDocs(safe); setLoading(false);
      const sop = new URLSearchParams(window.location.search).get("sop");
      if (sop) {
        const match = safe.find(doc => doc.title === decodeURIComponent(sop));
        if (match) {
          setExpandedId(match.id);
          setTimeout(() => document.querySelector(`[data-doc-id="${match.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
        }
      }
    });
  }, []);
  const refresh = async () => {
    const d = await getDocuments();
    setDocs((d || []).filter(doc => (doc.level_required || 1) <= auth.level));
  };
  const handleSave = async () => {
    if (!form.title.trim()) return;
    if (editDoc) await updateDocument(editDoc.id, form); else await createDocument(form);
    setShowForm(false); setEditDoc(null); setForm({ title: "", category: "General", content: "", level_required: 1 });
    refresh();
  };
  if (loading) return <div className="empty">Loading documents…</div>;
  const q = search.toLowerCase();
  const filtered = docs.filter(d => {
    if (!showArchived && d.category === "z. Archived") return false;
    return !q || d.title?.toLowerCase().includes(q) || d.category?.toLowerCase().includes(q);
  });
  const grouped = filtered.reduce((a, d) => { const c = d.category || "General"; (a[c] = a[c] || []).push(d); return a; }, {});
  const archivedCount = docs.filter(d => d.category === "z. Archived").length;
  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
        <input className="filter-inp" style={{ maxWidth: 340 }} placeholder="Search documents…" value={search} onChange={e => setSearch(e.target.value)} />
        <span style={{ flex: 1 }} />
        {auth.level >= 3 && <button className="btn" onClick={() => { setEditDoc(null); setForm({ title: "", category: "General", content: "", level_required: 1 }); setShowForm(true); }}>Create +</button>}
      </div>
      {Object.keys(grouped).sort().map(cat => (
        <div className="card" key={cat}>
          <div className="hd"><div className="t">{cat}</div><div className="meta">{grouped[cat].length}</div></div>
          {grouped[cat].map(doc => {
            const open = expandedId === doc.id;
            return (
              <div key={doc.id} data-doc-id={doc.id} style={{ borderBottom: "1px solid var(--line)" }}>
                <div className="row" onClick={() => setExpandedId(open ? null : doc.id)}>
                  <span className="desc">{doc.title}</span>
                  <span className="chip role">{doc.created_by}</span>
                  {doc.level_required > 1 && <span className="chip lock">L{doc.level_required}+</span>}
                  {auth.level >= 3 && (
                    <span onClick={e => e.stopPropagation()} style={{ display: "flex", gap: 4 }}>
                      <button className="act" style={{ padding: "2px 7px" }} onClick={() => { setEditDoc(doc); setForm({ title: doc.title, category: doc.category, content: doc.content, level_required: doc.level_required || 1 }); setShowForm(true); }}>Edit</button>
                      <button className="act" style={{ padding: "2px 7px", color: "var(--rose)" }} onClick={async () => { if (window.confirm("Delete this document?")) { await deleteDocument(doc.id); refresh(); } }}>Del</button>
                    </span>
                  )}
                  <span className="caret" style={{ transform: open ? "rotate(180deg)" : "none" }}>▼</span>
                </div>
                {open && (
                  <div className="task-detail">
                    <div className="quill-content" style={{ fontSize: 13.5, color: "var(--ink-1)", lineHeight: 1.6 }}
                      onClick={e => {
                        const target = e.target.closest("a[data-doc-link]");
                        if (target) {
                          e.preventDefault();
                          const title = target.getAttribute("data-doc-link");
                          const targetDoc = docs.find(d => d.title === title);
                          if (targetDoc) {
                            setExpandedId(targetDoc.id);
                            setTimeout(() => document.querySelector(`[data-doc-id="${targetDoc.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
                          } else {
                            window.alert("Document not found or above your access level: " + title);
                          }
                        }
                      }}
                      dangerouslySetInnerHTML={{ __html: doc.content }} />
                    <div style={{ marginTop: 10, fontSize: 10, fontFamily: "var(--v2-mono)", color: "var(--ink-3)" }}>Updated: {doc.updated_at}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
      {filtered.length === 0 && !showArchived && <div className="empty">No documents found.</div>}
      {archivedCount > 0 && (
        <button className="act" style={{ marginTop: 4 }} onClick={() => setShowArchived(v => !v)}>
          {showArchived ? "▲ Hide archived" : `▼ Show archived (${archivedCount})`}
        </button>
      )}
      {showForm && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={() => { setShowForm(false); setEditDoc(null); }} />
          <div style={{ position: "relative", width: "100%", maxWidth: 750, maxHeight: "90vh", background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 12, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
              <span style={{ fontWeight: 700, color: "var(--ink-0)" }}>{editDoc ? "Edit" : "Create"} document</span>
              <button className="act" style={{ padding: "2px 8px" }} onClick={() => { setShowForm(false); setEditDoc(null); }}>✕</button>
            </div>
            <div style={{ padding: 18, overflowY: "auto", flex: 1 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
                <input className="filter-inp" placeholder="Title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
                <input className="filter-inp" placeholder="Category" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} />
                <select className="filter-inp" value={form.level_required} onChange={e => setForm({ ...form, level_required: parseInt(e.target.value) })}>
                  <option value={1}>All FM Staff (L1+)</option>
                  <option value={2}>Team Leads & Leadership (L2+)</option>
                  <option value={3}>FM Leadership Only (L3)</option>
                </select>
              </div>
              <QuillEditor value={form.content} onChange={v => setForm({ ...form, content: v })} placeholder="Start writing…" />
            </div>
            <div style={{ padding: "12px 18px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "flex-end", gap: 8, flexShrink: 0 }}>
              <button className="act" onClick={() => { setShowForm(false); setEditDoc(null); }}>Cancel</button>
              <button className="act primary" onClick={handleSave}>Save</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export { Links, RecurringReminders, DocumentsView };
