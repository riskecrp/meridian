"use client";
// Library › Documents. level_required is a clearance GATE (policy 5): the
// server (getDocuments) returns only what this viewer may read — L1..L3 by
// clearance, Lead Storytellers and Event Team the level-1 set. The pills filter
// the visible set by audience. L3 creates / edits / deletes. Deep link:
// ?sop=<title> expands that document; in-document links (data-doc-link) jump.
import { useEffect, useMemo, useState } from "react";
import { getDocuments, createDocument, updateDocument, deleteDocument } from "../../fm/documents/actions.js";
import QuillEditor from "../../../lib/QuillEditor";
import { Card, Badge, Button, Field, Empty, Modal, useAction, useToast, fmtDateTime } from "../ui.js";
import { confirmIt } from "./shared.js";

const AUDIENCE = { 1: { label: "All staff", tone: "good" }, 2: { label: "Leads+", tone: "warn" }, 3: { label: "Leadership", tone: "lock" } };
const audienceOf = (doc) => AUDIENCE[Number(doc.level_required) || 1] || AUDIENCE[1];
const ARCHIVED = "z. Archived";
const BLANK = { title: "", category: "General", content: "", level_required: 1 };

export default function Documents({ auth, initialQ = "", sop = "" }) {
  const [docs, setDocs] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [search, setSearch] = useState(initialQ);
  const [aud, setAud] = useState("mine");             // 'mine' | 'all' | 1 | 2 | 3
  const [openId, setOpenId] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [form, setForm] = useState(null);             // { id?, ...BLANK }
  const { run, busy } = useAction();
  const toast = useToast();

  const myLevel = Math.max(auth.level || 0, (auth.isEventTeam || auth.isLeadStoryteller) ? 1 : 0, 1);
  const canEdit = (auth.level || 0) >= 3;

  const load = async () => {
    try { const d = await getDocuments(); setDocs(d || []); setLoadErr(""); return d || []; }
    catch (e) { setDocs([]); setLoadErr(e?.message || "Could not load documents."); return []; }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { if (initialQ) setSearch(initialQ); }, [initialQ]);

  const jumpTo = (doc) => {
    setAud("all"); setShowArchived(s => s || doc.category === ARCHIVED); setOpenId(doc.id);
    setTimeout(() => document.querySelector(`[data-doc-id="${doc.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
  };
  // ?sop=<title> deep link (from the palette, Discord pings and SopLink).
  useEffect(() => {
    if (!sop || !docs) return;
    let title = sop; try { title = decodeURIComponent(sop); } catch {}
    const match = docs.find(d => d.title === title);
    if (match) jumpTo(match); else toast(`No document called “${title}” is visible to you.`, "bad");
  }, [sop, docs === null]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return (docs || []).filter(d => {
      if (!showArchived && d.category === ARCHIVED) return false;
      const lvl = d.level_required || 1;
      if (aud === "mine" && lvl > myLevel) return false;
      if (typeof aud === "number" && lvl !== aud) return false;
      return !q || d.title?.toLowerCase().includes(q) || d.category?.toLowerCase().includes(q) || (d.content || "").toLowerCase().includes(q);
    });
  }, [docs, search, aud, myLevel, showArchived]);
  const grouped = useMemo(() => filtered.reduce((a, d) => { const c = d.category || "General"; (a[c] = a[c] || []).push(d); return a; }, {}), [filtered]);
  const archivedCount = (docs || []).filter(d => d.category === ARCHIVED).length;
  const countFor = (v) => (docs || []).filter(d => d.category !== ARCHIVED && (v === "mine" ? (d.level_required || 1) <= myLevel : v === "all" ? true : (d.level_required || 1) === v)).length;
  const levels = [1, 2, 3].filter(v => v <= myLevel);

  const save = () => run(() => form.id ? updateDocument(form.id, form) : createDocument(form), {
    onDone: (r) => { toast(form.id ? "Document saved." : (r?.pinged ? "Document published and announced." : "Document published."), "good"); setForm(null); load(); },
  });
  const remove = (doc) => { if (!confirmIt(`Delete “${doc.title}”?`)) return; run(() => deleteDocument(doc.id), { success: "Document deleted.", onDone: load }); };
  const onBodyClick = (e) => {
    const a = e.target.closest?.("a[data-doc-link]");
    if (!a) return;
    e.preventDefault();
    const title = a.getAttribute("data-doc-link");
    const target = (docs || []).find(d => d.title === title);
    if (target) jumpTo(target); else toast(`“${title}” was not found or is above your access level.`, "bad");
  };

  if (docs === null) return <div className="stack"><div className="skeleton row" /><div className="skeleton block" /></div>;

  return (
    <div className="stack">
      <div className="row">
        <input className="inp grow" placeholder="Search title, category, content…" value={search} onChange={e => setSearch(e.target.value)} />
        {canEdit && <Button onClick={() => setForm({ ...BLANK })}>Create +</Button>}
      </div>
      <div className="chips">
        <button className={`chip${aud === "mine" ? " on" : ""}`} onClick={() => setAud("mine")}>For you <Badge>{countFor("mine")}</Badge></button>
        <button className={`chip${aud === "all" ? " on" : ""}`} onClick={() => setAud("all")}>All <Badge>{countFor("all")}</Badge></button>
        {levels.map(v => <button key={v} className={`chip${aud === v ? " on" : ""}`} onClick={() => setAud(aud === v ? "all" : v)}>{AUDIENCE[v].label} <Badge>{countFor(v)}</Badge></button>)}
      </div>
      {loadErr && <div className="err">{loadErr}</div>}
      {filtered.length === 0 && <Empty title="No documents match">{canEdit ? "Create one, or widen the filter." : "Try another search or audience."}</Empty>}
      {Object.keys(grouped).sort().map(cat => (
        <Card key={cat} title={cat} right={<Badge>{grouped[cat].length}</Badge>}>
          <div className="list">
            {grouped[cat].map(doc => {
              const open = openId === doc.id;
              const a = audienceOf(doc);
              return (
                <div key={doc.id} data-doc-id={doc.id}>
                  <div className="line click" onClick={() => setOpenId(open ? null : doc.id)} role="button" aria-expanded={open}>
                    <span className="t grow">{doc.title}</span>
                    <Badge tone={a.tone}>{a.label}</Badge>
                    <span className="faint tiny hide-sm">{doc.created_by}</span>
                    {canEdit && <span className="actions-inline" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" onClick={() => setForm({ id: doc.id, title: doc.title, category: doc.category, content: doc.content || "", level_required: doc.level_required || 1 })}>Edit</Button>
                      <Button variant="danger ghost" size="sm" disabled={busy} onClick={() => remove(doc)}>Del</Button>
                    </span>}
                    <span className="faint">{open ? "▴" : "▾"}</span>
                  </div>
                  {open && (
                    <div className="detail">
                      <div className="doc-body quill-content" onClick={onBodyClick} dangerouslySetInnerHTML={{ __html: doc.content || "<p><em>This document is empty.</em></p>" }} />
                      <div className="tiny faint mono" style={{ marginTop: 10 }}>Updated {fmtDateTime(doc.updated_at) || "—"}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      ))}
      {archivedCount > 0 && <div><Button variant="quiet" size="sm" onClick={() => setShowArchived(v => !v)}>{showArchived ? "▴ Hide archived" : `▾ Show archived (${archivedCount})`}</Button></div>}

      {form && (
        <Modal title={`${form.id ? "Edit" : "Create"} document`} maxWidth={820} onClose={() => setForm(null)} onSave={save} saveLabel={form.id ? "Save" : "Publish"} saveDisabled={busy || !form.title.trim()}>
          <div className="form-grid">
            <Field label="Title"><input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Category"><input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="General" /></Field>
            <Field label="Visible to" help="The clearance needed to read it — a gate, not a label.">
              <select value={form.level_required} onChange={e => setForm({ ...form, level_required: parseInt(e.target.value) })}>
                <option value={1}>All FM staff (L1+)</option>
                <option value={2}>Team Leads &amp; Leadership (L2+)</option>
                <option value={3}>FM Leadership only (L3)</option>
              </select>
            </Field>
          </div>
          <QuillEditor value={form.content} onChange={v => setForm({ ...form, content: v })} placeholder="Start writing…" />
        </Modal>
      )}
    </div>
  );
}
