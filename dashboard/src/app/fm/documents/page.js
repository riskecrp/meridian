"use client";
import { useEffect, useState } from "react";
import { useDialog } from "../../../lib/useDialog";
import { useAuth } from "../../../lib/useAuth";
import { getDocuments, createDocument, updateDocument, deleteDocument } from "./actions";
import QuillEditor from "../../../lib/QuillEditor";
import { ui } from "../../../lib/ui.js";

const st = {
  ...ui,
};

export default function DocumentsPage() {
  const auth = useAuth();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editDoc, setEditDoc] = useState(null);
  const [form, setForm] = useState({ title:'', category:'General', content:'', level_required:1 });
  const [showArchived, setShowArchived] = useState(false);
  const { showConfirm, showAlert } = useDialog();

  useEffect(() => {
    if (!auth.loading && auth.level >= 1) {
      getDocuments().then(d => {
        // Client-side guard: never display a doc above the viewer's level
        const safe = (d || []).filter(doc => (doc.level_required || 1) <= auth.level);
        setDocs(safe);
        setLoading(false);
        const params = new URLSearchParams(window.location.search);
        const sop = params.get('sop');
        if (sop) {
          const match = safe.find(doc => doc.title === decodeURIComponent(sop));
          if (match) {
            setExpandedId(match.id);
            setTimeout(() => document.querySelector(`[data-doc-id="${match.id}"]`)?.scrollIntoView({ behavior:'smooth', block:'start' }), 300);
          }
        }
      });
    }
  }, [auth.loading, auth.level]);

  const refresh = async () => {
    const d = await getDocuments();
    setDocs((d || []).filter(doc => (doc.level_required || 1) <= auth.level));
  };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    if (editDoc) await updateDocument(editDoc.id, form);
    else await createDocument(form);
    setShowForm(false); setEditDoc(null); setForm({ title:'', category:'General', content:'', level_required:1 });
    refresh();
  };

  if (auth.loading || loading) return <div className="p-10 text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading documents...</div>;

  const q = search.toLowerCase();
  const filtered = docs.filter(d => {
    if (!showArchived && d.category === 'z. Archived') return false;
    return !q || d.title?.toLowerCase().includes(q) || d.category?.toLowerCase().includes(q);
  });
  const grouped = filtered.reduce((a, d) => {
    const c = d.category || 'General';
    if (!a[c]) a[c] = [];
    a[c].push(d);
    return a;
  }, {});
  const archivedCount = docs.filter(d => d.category === 'z. Archived').length;

  return (
    <div style={{padding:'0 24px 40px'}}>
      {/* Header */}
      <div style={{padding:'24px 0 20px', borderBottom:'1px solid var(--border)', marginBottom:24, display:'flex', justifyContent:'space-between', alignItems:'flex-start'}}>
        <div>
          <div style={{fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.24em',color:'var(--accent)',fontFamily:'var(--font-mono)',marginBottom:4}}>Overview / Documents</div>
          <h1 style={{fontSize:22,fontWeight:700,margin:0,letterSpacing:'-0.02em'}}>Documents</h1>
          <div style={{fontSize:10,color:'var(--fg-4)',marginTop:3,fontFamily:'var(--font-mono)'}}>Operational documentation and reference material</div>
        </div>
        {auth.level >= 3 && (
          <button style={{...st.btn,marginTop:4}} onClick={() => {
            setEditDoc(null);
            setForm({ title:'', category:'General', content:'', level_required:1 });
            setShowForm(true);
          }}>Create +</button>
        )}
      </div>

      <div style={{display:'flex',flexDirection:'column',gap:16}}>
        <input
          style={{...st.input, maxWidth:380}}
          placeholder="Search documents..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        <div style={{display:'flex',flexDirection:'column',gap:20}}>
          {Object.keys(grouped).sort().map(cat => (
            <div key={cat}>
              <div style={{fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.18em',color:'var(--accent)',fontFamily:'var(--font-mono)',marginBottom:8,paddingBottom:6,borderBottom:'1px solid var(--border)'}}>
                {cat}
              </div>
              <div className="space-y-2">
                {grouped[cat].map(doc => (
                  <div key={doc.id} data-doc-id={doc.id} className="rounded-xl overflow-hidden"
                    style={{background:'var(--bg-1)',border:`1px solid ${expandedId===doc.id?'var(--accent)':'var(--border)'}`}}>
                    <div className="flex items-center justify-between p-4 cursor-pointer" onClick={() => setExpandedId(expandedId===doc.id ? null : doc.id)}>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold">{doc.title}</span>
                        <span className="text-[9px] font-mono px-2 py-0.5 rounded" style={{background:'var(--bg-3)',color:'var(--fg-4)'}}>{doc.created_by}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        {auth.level >= 3 && (
                          <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                            <button onClick={() => {
                              setEditDoc(doc);
                              setForm({ title:doc.title, category:doc.category, content:doc.content, level_required:doc.level_required||1 });
                              setShowForm(true);
                            }} style={{fontSize:10,color:'var(--accent)',background:'none',border:'none',cursor:'pointer',fontWeight:700}}>Edit</button>
                            <button onClick={async () => {
                              if (await showConfirm('Delete this document?')) { await deleteDocument(doc.id); refresh(); }
                            }} style={{fontSize:10,color:'var(--red)',background:'none',border:'none',cursor:'pointer',fontWeight:700}}>Del</button>
                          </div>
                        )}
                        <span style={{color:'var(--fg-4)',transform:expandedId===doc.id?'rotate(180deg)':'none',display:'inline-block',transition:'transform 0.2s'}}>▼</span>
                      </div>
                    </div>
                    {expandedId === doc.id && (
                      <div className="px-4 pb-4 pt-2" style={{borderTop:'1px solid var(--border)'}}>
                        <div
                          className="text-sm prose prose-sm max-w-none leading-relaxed quill-content"
                          style={{color:'var(--fg-2)'}}
                          onClick={e => {
                            const target = e.target.closest('a[data-doc-link]');
                            if (target) {
                              e.preventDefault();
                              const title = target.getAttribute('data-doc-link');
                              const targetDoc = docs.find(d => d.title === title);
                              if (targetDoc) {
                                setExpandedId(targetDoc.id);
                                setTimeout(() => document.querySelector(`[data-doc-id="${targetDoc.id}"]`)?.scrollIntoView({ behavior:'smooth', block:'start' }), 100);
                              } else {
                                showAlert('Document not found or above your access level: ' + title);
                              }
                            }
                          }}
                          dangerouslySetInnerHTML={{__html: doc.content}}
                        />
                        <div className="mt-3 text-[10px] font-mono" style={{color:'var(--fg-4)'}}>Updated: {doc.updated_at}</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {filtered.length === 0 && !showArchived && <div className="empty-state">No documents found.</div>}
        </div>

        {/* Archived toggle */}
        {archivedCount > 0 && (
          <div style={{ marginTop: 8, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <button
              onClick={() => setShowArchived(v => !v)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}
            >
              {showArchived ? '▲ Hide Archived' : `▼ Show Archived (${archivedCount})`}
            </button>
          </div>
        )}
      </div>

      {showForm && (
        <div style={st.modal}>
          <div style={st.modalBg} onClick={() => { setShowForm(false); setEditDoc(null); }} />
          <div style={{position:'relative',width:'100%',maxWidth:750,maxHeight:'90vh',background:'var(--bg-1)',border:'1px solid var(--border)',borderRadius:16,display:'flex',flexDirection:'column',overflow:'hidden'}}>
            <div className="p-6 flex justify-between items-center shrink-0" style={{borderBottom:'1px solid var(--border)'}}>
              <h2 className="text-lg font-bold uppercase">{editDoc ? 'Edit' : 'Create'} Document</h2>
              <button onClick={() => { setShowForm(false); setEditDoc(null); }} style={{color:'var(--fg-4)',fontSize:20,background:'none',border:'none',cursor:'pointer'}}>✕</button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto flex-1 scr">
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-1">
                  <div style={st.label}>Title</div>
                  <input style={st.input} value={form.title} onChange={e => setForm({...form, title:e.target.value})} />
                </div>
                <div>
                  <div style={st.label}>Category</div>
                  <input style={st.input} value={form.category} onChange={e => setForm({...form, category:e.target.value})} />
                </div>
                <div>
                  <div style={st.label}>Visible To</div>
                  <select style={st.input} value={form.level_required} onChange={e => setForm({...form, level_required:parseInt(e.target.value)})}>
                    <option value={1}>All FM Staff (L1+)</option>
                    <option value={2}>Team Leads &amp; Leadership (L2+)</option>
                    <option value={3}>FM Leadership Only (L3)</option>
                  </select>
                </div>
              </div>
              <div>
                <div style={st.label}>Content</div>
                <QuillEditor value={form.content} onChange={v => setForm({...form, content:v})} placeholder="Start writing..." />
              </div>
            </div>
            <div className="p-6 flex justify-end gap-3 shrink-0" style={{borderTop:'1px solid var(--border)'}}>
              <button style={st.btnGhost} onClick={() => { setShowForm(false); setEditDoc(null); }}>Cancel</button>
              <button style={st.btn} onClick={handleSave}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
