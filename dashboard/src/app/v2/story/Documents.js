"use client";
// Library › Documents. Everyone sees the whole catalog; the old clearance
// gate is now an AUDIENCE tag ("who this is for") used for the default
// "For you" filter — relevance, not secrecy (owner ruling 2026-08-03).
// L3 keeps CRUD. Deep links: ?sop=<title> expands a document.
import { useEffect, useState } from "react";
import { createDocument, updateDocument, deleteDocument } from "../../fm/documents/actions.js";
import { getAllDocuments } from "../actions.js";
import QuillEditor from "../../../lib/QuillEditor";
import { useRun } from "../hooks.js";

const AUDIENCE = {
  1: { label: "Everyone", color: "var(--good)" },
  2: { label: "Leads+", color: "var(--amber)" },
  3: { label: "Leadership", color: "var(--lock)" },
};

export default function DocumentsView({ auth }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [aud, setAud] = useState("mine"); // 'mine' | 'all' | 1 | 2 | 3
  const [expandedId, setExpandedId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editDoc, setEditDoc] = useState(null);
  const [form, setForm] = useState({ title: "", category: "General", content: "", level_required: 1 });
  const [showArchived, setShowArchived] = useState(false);
  const { busy, err, setErr, run } = useRun();

  useEffect(() => {
    getAllDocuments().then(d => {
      setDocs(d || []); setLoading(false);
      const sop = new URLSearchParams(window.location.search).get("sop");
      if (sop) {
        const match = (d || []).find(doc => doc.title === decodeURIComponent(sop));
        if (match) {
          setAud("all");
          setExpandedId(match.id);
          setTimeout(() => document.querySelector(`[data-doc-id="${match.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
        }
      }
    });
  }, []);
  const refresh = async () => setDocs((await getAllDocuments().catch(() => [])) || []);

  const handleSave = () => {
    if (!form.title.trim()) return;
    run(() => editDoc ? updateDocument(editDoc.id, form) : createDocument(form), () => {
      setShowForm(false); setEditDoc(null); setForm({ title: "", category: "General", content: "", level_required: 1 });
      refresh();
    });
  };

  if (loading) return <div className="empty">Loading documents…</div>;

  const myLevel = auth.level || 1;
  const q = search.toLowerCase();
  const filtered = docs.filter(d => {
    if (!showArchived && d.category === "z. Archived") return false;
    const lvl = d.level_required || 1;
    if (aud === "mine" && lvl > myLevel) return false;
    if (typeof aud === "number" && lvl !== aud) return false;
    return !q || d.title?.toLowerCase().includes(q) || d.category?.toLowerCase().includes(q) || (d.content || "").toLowerCase().includes(q);
  });
  const grouped = filtered.reduce((a, d) => { const c = d.category || "General"; (a[c] = a[c] || []).push(d); return a; }, {});
  const archivedCount = docs.filter(d => d.category === "z. Archived").length;
  const countFor = (v) => docs.filter(d => d.category !== "z. Archived" && (v === "mine" ? (d.level_required || 1) <= myLevel : v === "all" ? true : (d.level_required || 1) === v)).length;

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input className="filter-inp" style={{ maxWidth: 340 }} placeholder="Search title, category, content…" value={search} onChange={e => setSearch(e.target.value)} />
        <span style={{ flex: 1 }} />
        {auth.level >= 3 && <button className="btn" onClick={() => { setEditDoc(null); setForm({ title: "", category: "General", content: "", level_required: 1 }); setShowForm(true); }}>Create +</button>}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        <button className={`pill${aud === "mine" ? " on" : ""}`} onClick={() => setAud("mine")}>For you <span className="ct">{countFor("mine")}</span></button>
        <button className={`pill${aud === "all" ? " on" : ""}`} onClick={() => setAud("all")}>All <span className="ct">{countFor("all")}</span></button>
        {[1, 2, 3].map(v => <button key={v} className={`pill${aud === v ? " on" : ""}`} onClick={() => setAud(aud === v ? "all" : v)}>{AUDIENCE[v].label} <span className="ct">{countFor(v)}</span></button>)}
      </div>

      {Object.keys(grouped).sort().map(cat => (
        <div className="card" key={cat}>
          <div className="hd"><div className="t">{cat}</div><div className="meta">{grouped[cat].length}</div></div>
          {grouped[cat].map(doc => {
            const open = expandedId === doc.id;
            const a = AUDIENCE[doc.level_required || 1];
            const forMe = (doc.level_required || 1) <= myLevel;
            return (
              <div key={doc.id} data-doc-id={doc.id} style={{ borderBottom: "1px solid var(--line)" }}>
                <div className="row" onClick={() => setExpandedId(open ? null : doc.id)}>
                  <span className="desc" style={{ opacity: forMe ? 1 : 0.7 }}>{doc.title}</span>
                  <span className="chip" style={{ background: `color-mix(in srgb, ${a.color} 14%, transparent)`, color: a.color }}>{a.label}</span>
                  <span className="chip role">{doc.created_by}</span>
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
                            setAud("all");
                            setExpandedId(targetDoc.id);
                            setTimeout(() => document.querySelector(`[data-doc-id="${targetDoc.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
                          } else {
                            window.alert("Document not found: " + title);
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
      {filtered.length === 0 && <div className="empty">No documents match.</div>}
      {archivedCount > 0 && (
        <button className="act" style={{ marginTop: 4 }} onClick={() => setShowArchived(v => !v)}>
          {showArchived ? "▲ Hide archived" : `▼ Show archived (${archivedCount})`}
        </button>
      )}

      {showForm && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={() => { setShowForm(false); setEditDoc(null); setErr(""); }} />
          <div style={{ position: "relative", width: "100%", maxWidth: 750, maxHeight: "90vh", background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 12, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
              <span style={{ fontWeight: 700, color: "var(--ink-0)" }}>{editDoc ? "Edit" : "Create"} document</span>
              <button className="act" style={{ padding: "2px 8px" }} onClick={() => { setShowForm(false); setEditDoc(null); setErr(""); }}>✕</button>
            </div>
            <div style={{ padding: 18, overflowY: "auto", flex: 1 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
                <input className="filter-inp" placeholder="Title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
                <input className="filter-inp" placeholder="Category" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} />
                <select className="filter-inp" value={form.level_required} onChange={e => setForm({ ...form, level_required: parseInt(e.target.value) })} title="Audience — who this is written for (everyone can still read it)">
                  <option value={1}>Audience: Everyone</option>
                  <option value={2}>Audience: Leads+</option>
                  <option value={3}>Audience: Leadership</option>
                </select>
              </div>
              <QuillEditor value={form.content} onChange={v => setForm({ ...form, content: v })} placeholder="Start writing…" />
              {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
            </div>
            <div style={{ padding: "12px 18px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "flex-end", gap: 8, flexShrink: 0 }}>
              <button className="act" onClick={() => { setShowForm(false); setEditDoc(null); setErr(""); }}>Cancel</button>
              <button className="act primary" disabled={busy} onClick={handleSave}>Save</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
