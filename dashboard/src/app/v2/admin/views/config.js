"use client";
// Admin › Config: Important Links, Recurring Reminders. (Documents moved to Library.)
// Split out of admin/page.js — content unchanged.
import { useEffect, useMemo, useState } from "react";
import { getLinks, saveLinks, publishLinks } from "../../../fm/operations/links/actions.js";
import { listReminders, listChannels, getTargetOptions, createReminder, updateReminder, deleteReminder, getReminderProgress, adminCompleteInstance, forceSendRecurringReminder } from "../../../fm/operations/reminders/actions.js";

/* ── Important Links (Discord-published editor) ── */
let _uid = 0; const nid = () => `r${++_uid}`;
const hydrate = (s) => (s || []).map(x => ({ id: nid(), type: x.type === "text" ? "text" : "links", heading: x.heading || "", ordered: !!x.ordered, text: x.text || "", links: (x.links || []).map(l => ({ id: nid(), label: l.label || "", url: l.url || "" })) }));
const dehydrate = (s) => s.map(x => x.type === "text" ? { type: "text", heading: x.heading, text: x.text } : { type: "links", heading: x.heading, ordered: x.ordered, links: x.links.map(l => ({ label: l.label, url: l.url })) });

// **bold** only — the one bit of Discord markdown the preview renders.
const boldMd = (text) => String(text).split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
  /^\*\*[^*]+\*\*$/.test(p) ? <strong key={i} style={{ color: "var(--ink-0)" }}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>);

function Links() {
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [title, setTitle] = useState("Important Links");
  const [sections, setSections] = useState([]);
  const [postUrl, setPostUrl] = useState(null);
  const [pub, setPub] = useState(false);
  const [meta, setMeta] = useState({ updatedAt: null, updatedBy: null, channelLabel: "" });
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  useEffect(() => {
    getLinks().then(d => { setTitle(d.title); setSections(hydrate(d.sections)); setPostUrl(d.postUrl); setPub(d.published); setMeta({ updatedAt: d.updatedAt, updatedBy: d.updatedBy, channelLabel: d.channelLabel }); setLoading(false); })
      .catch(e => { setLoadErr(e?.message || "Could not load the post."); setLoading(false); });
  }, []);
  const payload = useMemo(() => dehydrate(sections), [sections]);
  const patchS = (i, p) => setSections(s => s.map((x, j) => j === i ? { ...x, ...p } : x));
  const moveS = (i, d) => setSections(s => { const j = i + d; if (j < 0 || j >= s.length) return s; const n = [...s]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const rmS = (i) => setSections(s => s.filter((_, j) => j !== i));
  const addS = (t) => setSections(s => [...s, t === "text" ? { id: nid(), type: "text", heading: "New section", text: "" } : { id: nid(), type: "links", heading: "New section", ordered: false, links: [{ id: nid(), label: "", url: "" }] }]);
  const patchL = (si, li, p) => setSections(s => s.map((x, j) => j !== si ? x : { ...x, links: x.links.map((l, k) => k === li ? { ...l, ...p } : l) }));
  const moveL = (si, li, d) => setSections(s => s.map((x, j) => { if (j !== si) return x; const k = li + d; if (k < 0 || k >= x.links.length) return x; const n = [...x.links]; [n[li], n[k]] = [n[k], n[li]]; return { ...x, links: n }; }));
  const rmL = (si, li) => setSections(s => s.map((x, j) => j !== si ? x : { ...x, links: x.links.filter((_, k) => k !== li) }));
  const addL = (si) => setSections(s => s.map((x, j) => j !== si ? x : { ...x, links: [...x.links, { id: nid(), label: "", url: "" }] }));
  const doSave = async () => {
    setBusy("save"); setStatus(null);
    try { const r = await saveLinks(title, payload); if (r?.ok === false) setStatus({ ok: false, msg: r.error || "Failed." }); else { setStatus({ ok: true, msg: "Draft saved." }); setMeta(m => ({ ...m, updatedAt: new Date().toISOString() })); } }
    catch (e) { setStatus({ ok: false, msg: e.message || "Failed." }); }
    setBusy("");
  };
  const doPub = async () => {
    setBusy("pub"); setStatus(null);
    try {
      const r = await publishLinks(title, payload);
      if (r.ok) {
        setPostUrl(r.url); setPub(true); setMeta(m => ({ ...m, updatedAt: new Date().toISOString() }));
        setStatus({ ok: true, msg: r.createdNew ? `Published — created the post${r.replacedOld ? " and removed the old one" : ""}.` : `Updated the post in place (${r.messageCount} message${r.messageCount !== 1 ? "s" : ""}).` });
      } else setStatus({ ok: false, msg: r.error || "Failed." });
    } catch (e) { setStatus({ ok: false, msg: e.message || "Failed." }); }
    setBusy("");
  };
  if (loading) return <div className="empty">Loading…</div>;
  if (loadErr) return <div className="empty" style={{ color: "var(--rose)" }}>{loadErr}</div>;
  return (
    <div style={{ maxWidth: 820 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <span className="chip" style={{ background: pub ? "var(--good-bg)" : "var(--amber-bg)", color: pub ? "var(--good)" : "var(--amber)" }}>{pub ? "live" : "not published"}</span>
        {postUrl && <a href={postUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--accent)" }}>View post ↗</a>}
        <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
          One bot-managed post in {meta.channelLabel ? <code style={{ fontFamily: "var(--v2-mono)" }}>{meta.channelLabel}</code> : "the configured forum channel"}, edited in place — publishing never creates a second post.
          {meta.updatedAt && <> Last updated {new Date(meta.updatedAt).toLocaleString()}{meta.updatedBy ? ` by ${meta.updatedBy}` : ""}.</>}
        </span>
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
                      <button className="act" title="Move up" style={{ padding: "2px 7px" }} onClick={() => moveL(si, li, -1)}>↑</button>
                      <button className="act" title="Move down" style={{ padding: "2px 7px" }} onClick={() => moveL(si, li, 1)}>↓</button>
                      <button className="act" style={{ padding: "2px 7px", color: "var(--rose)" }} onClick={() => rmL(si, li)}>✕</button>
                    </div>
                  ))}
                </div>
                <button className="act" style={{ marginTop: 8 }} onClick={() => addL(si)}>+ Add link</button>
              </>}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}><button className="act" onClick={() => addS("links")}>+ Links section</button><button className="act" onClick={() => addS("text")}>+ Text section</button><span style={{ flex: 1 }} /><button className="act" onClick={() => setShowPreview(p => !p)}>{showPreview ? "Hide preview" : "Discord preview"}</button></div>
      {showPreview && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="hd"><div className="t">Discord preview</div><div className="meta">how the post reads</div></div>
          {sections.length === 0 && <div className="empty">Nothing yet.</div>}
          {sections.map(sec => (
            <div key={sec.id} style={{ margin: "10px 0 16px" }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink-0)", marginBottom: 4 }}>{sec.heading}</div>
              {sec.type === "text"
                ? <div style={{ fontSize: 13, color: "var(--ink-1)", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{boldMd(sec.text)}</div>
                : <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {sec.links.map((l, li) => (
                    <div key={l.id} style={{ fontSize: 13, color: "var(--ink-1)" }}>
                      {sec.ordered && <span style={{ color: "var(--ink-3)" }}>{li + 1}. </span>}
                      {/^https?:\/\//i.test(l.url || "") ? <a href={l.url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>{l.label || l.url}</a> : <span>{l.label}{l.url ? <span style={{ color: "var(--rose)", fontSize: 11 }}> (URL must start with http:// or https:// — it will be dropped)</span> : null}</span>}
                    </div>
                  ))}
                </div>}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 10, marginTop: 20, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn" disabled={!!busy} onClick={doPub}>{busy === "pub" ? "Publishing…" : pub ? "Update Discord post" : "Publish to Discord"}</button>
        <button className="act" disabled={!!busy} onClick={doSave}>{busy === "save" ? "Saving…" : "Save draft"}</button>
        {status && <span style={{ fontSize: 12, fontWeight: 600, color: status.ok ? "var(--good)" : "var(--rose)" }}>{status.ok ? "✓ " : "⚠ "}{status.msg}</span>}
      </div>
    </div>
  );
}
/* ── Recurring Reminders ──
   L3: every reminder, Progress + Force send. L2 (team leads): the reminders
   they created, for their own team — the server (reminders/actions.js) scopes
   the list and refuses edits to anyone else's; this UI mirrors that gate so an
   L2 never sees a button that will fail. */
const ord = (n) => (n >= 11 && n <= 13) ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";
// listChannels() returns discord_config shortcuts (key, channel_id, description)
// plus team channels (key "team:<id>", description "<Team> channel").
const channelLabel = (key, description) => (description && description !== key) ? description : (key ? `#${String(key).replace(/^team:/, "team ").replace(/_channel$/, "").replace(/_/g, "-")}` : "");
const labelForTarget = (type, id, targets) =>
  type === "User" ? (targets.staff.find(s => s.discord_id === id)?.display_name || id)
  : type === "Team" ? (targets.teams.find(t => t.team_id === id)?.team_name || id)
  : (targets.roles.find(r => r.role_id === id)?.key || id);
const canEditReminder = (auth, r) => (auth?.level || 0) >= 3 || (!!auth?.id && r.created_by_id === auth.id);

function RecurringReminders({ auth }) {
  const isL3 = (auth?.level || 0) >= 3;
  const [reminders, setReminders] = useState([]);
  const [channels, setChannels] = useState([]);
  const [targets, setTargets] = useState({ teams: [], staff: [], roles: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [progressFor, setProgressFor] = useState(null);
  const [progressRows, setProgressRows] = useState([]);
  const refresh = async () => {
    // The list is the one call that must succeed; the pickers are best-effort
    // so a gate on one of them never leaves the page on "Loading…".
    const [r, c, t] = await Promise.allSettled([listReminders(), listChannels(), getTargetOptions()]);
    if (r.status === "fulfilled") { setReminders(r.value || []); setError(""); }
    else setError(r.reason?.message || "Could not load reminders.");
    setChannels(c.status === "fulfilled" ? (c.value || []) : []);
    setTargets(t.status === "fulfilled" ? (t.value || { teams: [], staff: [], roles: [] }) : { teams: [], staff: [], roles: [] });
    setLoading(false);
  };
  useEffect(() => { refresh(); }, []);
  if (loading) return <div className="empty">Loading…</div>;
  if (error) return <div className="empty" style={{ color: "var(--rose)" }}>{error}</div>;
  const openProgress = async (rem) => {
    const now = new Date();
    try {
      const rows = await getReminderProgress(rem.id, now.getUTCFullYear(), now.getUTCMonth() + 1);
      setProgressFor(rem); setProgressRows(rows || []);
    } catch (e) { window.alert(e?.message || "Could not load progress."); }
  };
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{isL3 ? "Monthly tasks that ping a target on a set day." : "Monthly reminders for your team. You can edit the ones you created."}</span>
        <button className="btn" onClick={() => { setEditing(null); setShowForm(true); }}>New reminder +</button>
      </div>
      {reminders.length === 0 && <div className="empty">No reminders yet. Create one to get started.</div>}
      <div className="card">
        {reminders.map(r => {
          const ch = channels.find(c => c.channel_id === r.channel_id);
          const canEdit = canEditReminder(auth, r);
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
                    <span><b>Channel:</b> {ch ? channelLabel(ch.key, ch.description) : r.channel_id}</span>
                    {r.created_by_name && <span><b>By:</b> {r.created_by_name}</span>}
                    <span><b>Ping:</b> {r.ping_day}{ord(r.ping_day)} / <b>Due:</b> {r.due_day}{ord(r.due_day)}</span>
                  </div>
                  {r.body && <p style={{ fontSize: 12, marginTop: 6, whiteSpace: "pre-wrap", color: "var(--ink-1)" }}>{r.body.substring(0, 200)}{r.body.length > 200 ? "…" : ""}</p>}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {canEdit && r.active && <button className="act" onClick={() => openProgress(r)}>Progress</button>}
                  {isL3 && r.active && <button className="act" style={{ color: "var(--accent)" }} onClick={async () => {
                    if (window.confirm(`Force-send "${r.title}" now? Pings the channel and creates this month's instances if missing.`)) {
                      let res;
                      try { res = await forceSendRecurringReminder(r.id); } catch (e) { window.alert(e?.message || "Failed"); return; }
                      if (!res?.ok) { window.alert(res?.error || "Failed"); return; }
                      const made = Number(res.instancesCreated) || 0;
                      window.alert(`Sent to ${res.recipientsCount || 0} recipient(s).\n${res.resent ? "This month's reminder had already gone out — this was a re-send; " : ""}${made ? `${made} new instance(s) created for this month.` : "no new instances were needed (they already existed)."}`);
                      refresh();
                    }
                  }}>Force send</button>}
                  {canEdit && <button className="act" onClick={() => { setEditing(r); setShowForm(true); }}>Edit</button>}
                  {canEdit && r.active && <button className="act" style={{ color: "var(--rose)" }} onClick={async () => {
                    if (!window.confirm("Deactivate this reminder? Past instances stay in the DB.")) return;
                    let res;
                    try { res = await deleteReminder(r.id); } catch (e) { window.alert(e?.message || "Failed"); return; }
                    if (res?.ok === false) { window.alert(res.error || "Failed"); return; }
                    refresh();
                  }}>Delete</button>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {showForm && <ReminderForm editing={editing} channels={channels} targets={targets} isL3={isL3} onClose={() => { setShowForm(false); setEditing(null); }} onSaved={() => { setShowForm(false); setEditing(null); refresh(); }} />}
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
                  <button className="act" style={{ padding: "2px 8px" }} onClick={async () => { try { const r = await adminCompleteInstance(p.id); if (r?.ok === false) window.alert(r.error || "Failed"); } catch (e) { window.alert(e?.message || "Failed"); } openProgress(progressFor); }}>Mark done</button>
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

function ReminderForm({ editing, channels, targets, isL3, onClose, onSaved }) {
  // Below L3 the server only accepts Team / User targets on the actor's own team.
  const [form, setForm] = useState({
    title: editing?.title || "", body: editing?.body || "", links: editing?.links || "",
    target_type: editing?.target_type || (isL3 ? "Role" : "Team"), target_id: editing?.target_id || "",
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
    const pd = parseInt(form.ping_day, 10), dd = parseInt(form.due_day, 10);
    if (!(pd >= 1 && pd <= 31) || !(dd >= 1 && dd <= 31)) { setErr("Days must be 1–31"); return; }
    if (dd < pd) { setErr("Due day cannot be before ping day"); return; }
    setSubmitting(true);
    let res;
    try { res = editing ? await updateReminder(editing.id, form) : await createReminder(form); }
    catch (e) { setSubmitting(false); setErr(e?.message || "Failed"); return; }
    setSubmitting(false);
    if (!res?.ok) { setErr(res?.error || "Failed"); return; }
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
          <div><div style={lbl}>Reference links (one per line)</div><textarea className="filter-inp" style={{ width: "100%" }} rows={2} value={form.links} onChange={e => setForm({ ...form, links: e.target.value })} placeholder={"One full URL per line, e.g. the Leadership › Reviews page"} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><div style={lbl}>Target type *</div>
              <select className="filter-inp" style={{ width: "100%" }} value={form.target_type} onChange={e => setForm({ ...form, target_type: e.target.value, target_id: "" })}>
                {isL3 && <option value="Role">Role</option>}<option value="Team">Team</option><option value="User">User</option>
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
              {channels.map(c => <option key={c.key} value={c.channel_id}>{channelLabel(c.key, c.description)}</option>)}
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
export { Links, RecurringReminders };
