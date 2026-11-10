"use client";
// Library › Peds — every GTA V ped model with its preview, model name, joaat
// hash and tags. Reference for anyone picking a model for an NPC, a scene or a
// faction dossier: search by look ("airport", "biker"), copy the model name or
// the hash, done.
//
// Data: peds table, seeded from migrations/011_peds.sql. A handful of models
// (17 of 1,106 after migration 013) have no preview image, so those tiles fall
// back to a name plate rather than pretending.
//
// The catalogue is paged on the server (getPedsPage, 48 per page, filters in
// SQL) so a tab open costs one page, not the whole 1,100-row catalogue;
// images are lazy-loaded.
import { useEffect, useRef, useState } from "react";
import { getPedsPage, updatePedTags } from "./actions.js";
import { useCopy, useRun } from "../hooks.js";

const PAGE = 48;

export default function Peds({ auth, initialQ = "" }) {
  const canEdit = auth.level >= 2;
  const [data, setData] = useState(null);       // last page payload from the server
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState(initialQ);
  const [picked, setPicked] = useState([]);      // tag filter, AND-ed
  const [category, setCategory] = useState("");
  const [imageOnly, setImageOnly] = useState(false);
  const [allTags, setAllTags] = useState(false);
  const [view, setView] = useState("grid");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);        // ped in the detail panel
  const [copied, copy] = useCopy();
  const reqRef = useRef(0);

  useEffect(() => { if (initialQ) setQ(initialQ); }, [initialQ]);
  // Any filter change goes back to page 1.
  useEffect(() => { setPage(1); }, [q, picked, category, imageOnly]);

  // Fetch one page whenever the filters or page change (search is debounced).
  useEffect(() => {
    const id = ++reqRef.current;
    setLoading(true);
    const t = setTimeout(() => {
      getPedsPage({ q, category, tags: picked, imageOnly, page, per: PAGE })
        .then(r => { if (id === reqRef.current) { setData(r); setErr(""); setLoading(false); } })
        .catch(e => { if (id === reqRef.current) { setErr(e?.message || "Could not load peds."); setLoading(false); } });
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, picked, category, imageOnly, page]);

  const rows = data?.rows || [];
  const total = data?.total || 0;
  const matched = data?.matched || 0;
  const pages = data?.pages || 1;
  const categories = data?.categories || [];
  const tagCounts = data?.tagCounts || [];

  if (!data && loading) return <div className="empty">Loading peds…</div>;
  if (!data && err) return <div className="err">{err}</div>;
  if (data && total === 0) return <div className="empty">The ped catalogue is empty — run <code>scripts/build-peds.mjs</code> and apply the migration.</div>;

  const toggleTag = (t) => setPicked(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t]);
  const tagsToShow = allTags ? tagCounts : tagCounts.slice(0, 20);
  const clear = () => { setPicked([]); setCategory(""); setQ(""); setImageOnly(false); };
  const filtering = picked.length || category || q || imageOnly;
  const pager = pages > 1 && (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 10, marginTop: 14 }}>
      <button className="act" disabled={page <= 1 || loading} onClick={() => setPage(p => Math.max(1, p - 1))}>← Prev</button>
      <span style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--v2-mono)" }}>Page {page} of {pages}</span>
      <button className="act" disabled={page >= pages || loading} onClick={() => setPage(p => Math.min(pages, p + 1))}>Next →</button>
    </div>
  );

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input className="filter-inp" placeholder="Search name, hash or tag…" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 300 }} />
        <select className="filter-inp" value={category} onChange={e => setCategory(e.target.value)} style={{ maxWidth: 190 }}>
          <option value="">All categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <label style={{ fontSize: 11.5, color: "var(--ink-2)", display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={imageOnly} onChange={e => setImageOnly(e.target.checked)} /> With preview only
        </label>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--v2-mono)" }}>{loading ? "…" : `${matched} of ${total}`}</span>
        <div className="sub-tabs" style={{ padding: 0 }}>
          <button className={`tab${view === "grid" ? " on" : ""}`} onClick={() => setView("grid")}>Grid</button>
          <button className={`tab${view === "table" ? " on" : ""}`} onClick={() => setView("table")}>Table</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        {tagsToShow.map(([t, n]) => {
          const on = picked.includes(t);
          return (
            <button key={t} className="act" onClick={() => toggleTag(t)} title={`${n} peds`}
              style={{ padding: "2px 8px", fontSize: 11, borderRadius: 999, background: on ? "var(--accent)" : "var(--panel-2)", color: on ? "#fff" : "var(--ink-2)", border: `1px solid ${on ? "var(--accent)" : "var(--line-2)"}` }}>
              {t} <span style={{ opacity: 0.6, fontFamily: "var(--v2-mono)" }}>{n}</span>
            </button>
          );
        })}
        {tagCounts.length > 20 && (
          <button className="act" style={{ padding: "2px 8px", fontSize: 11, color: "var(--accent)" }} onClick={() => setAllTags(a => !a)}>
            {allTags ? "Fewer tags" : `All ${tagCounts.length} tags`}
          </button>
        )}
        {filtering ? <button className="act" style={{ padding: "2px 8px", fontSize: 11, color: "var(--rose)" }} onClick={clear}>Clear</button> : null}
      </div>

      {err && <div className="err" style={{ marginBottom: 10 }}>{err}</div>}
      {!loading && rows.length === 0 && <div className="empty">No peds match.</div>}

      {view === "grid" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(132px,1fr))", gap: 10, opacity: loading ? 0.6 : 1 }}>
          {rows.map(p => (
            <button key={p.id} onClick={() => setOpen(p)} title={p.display_name || p.model_name}
              style={{ textAlign: "left", padding: 0, cursor: "pointer", background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 10, overflow: "hidden", fontFamily: "inherit" }}>
              <div style={{ aspectRatio: "1/1", background: "var(--panel-2)", display: "grid", placeItems: "center", overflow: "hidden" }}>
                {p.image
                  ? <img src={`/peds/${p.image}`} alt={p.model_name} loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : <span style={{ fontSize: 10, color: "var(--ink-3)", fontFamily: "var(--v2-mono)", padding: 8, textAlign: "center", wordBreak: "break-all" }}>{p.model_name}</span>}
              </div>
              <div style={{ padding: "6px 8px 8px" }}>
                <div style={{ fontFamily: "var(--v2-mono)", fontSize: 10.5, color: "var(--ink-1)", wordBreak: "break-all", lineHeight: 1.3 }}>{p.model_name}</div>
                <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.display_name || p.category || "—"}</div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="card" style={{ opacity: loading ? 0.6 : 1 }}><div style={{ overflowX: "auto" }}>
          <table className="dtable" style={{ minWidth: 720 }}>
            <thead><tr><th></th><th>Model</th><th>Name</th><th>Hash</th><th>Category</th><th>Tags</th></tr></thead>
            <tbody>
              {rows.map(p => (
                <tr key={p.id} style={{ cursor: "pointer" }} onClick={() => setOpen(p)}>
                  <td style={{ width: 40 }}>{p.image ? <img src={`/peds/${p.image}`} alt="" loading="lazy" decoding="async" style={{ width: 32, height: 32, objectFit: "cover", borderRadius: 5 }} /> : <div style={{ width: 32, height: 32, borderRadius: 5, background: "var(--panel-2)" }} />}</td>
                  <td style={{ fontFamily: "var(--v2-mono)", fontSize: 11 }}>{p.model_name}</td>
                  <td>{p.display_name || <span style={{ color: "var(--ink-3)" }}>—</span>}</td>
                  <td style={{ fontFamily: "var(--v2-mono)", fontSize: 11, color: "var(--ink-2)" }}>{p.hash_hex}</td>
                  <td style={{ fontSize: 11, color: "var(--ink-2)" }}>{p.category || "—"}</td>
                  <td style={{ fontSize: 11, color: "var(--ink-3)" }}>{p.tags.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      )}

      {pager}

      {open && (
        <PedDetail
          ped={open}
          canEdit={canEdit}
          copied={copied}
          copy={copy}
          onTag={(t) => { setOpen(null); setPicked(p => p.includes(t) ? p : [...p, t]); }}
          onClose={() => setOpen(null)}
          onSaved={(updated) => {
            setData(d => d ? { ...d, rows: d.rows.map(r => r.id === updated.id ? updated : r) } : d);
            setOpen(updated);
          }}
        />
      )}
    </>
  );
}

function PedDetail({ ped, canEdit, copied, copy, onTag, onClose, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [tagText, setTagText] = useState(ped.tags.join(", "));
  const [notes, setNotes] = useState(ped.notes || "");
  const { busy, err, run } = useRun();
  useEffect(() => { setTagText(ped.tags.join(", ")); setNotes(ped.notes || ""); setEditing(false); }, [ped.id]);

  const save = () => run(
    () => updatePedTags(ped.id, tagText.split(",").map(t => t.trim()).filter(Boolean), notes),
    (r) => { onSaved({ ...ped, tags: r.tags, notes: notes.trim() || null, tags_curated: 1 }); setEditing(false); }
  );
  const kv = (label, value) => value ? (
    <div style={{ display: "flex", gap: 8, fontSize: 12 }}>
      <span style={{ minWidth: 92, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--ink-3)", paddingTop: 2 }}>{label}</span>
      <span style={{ color: "var(--ink-1)" }}>{value}</span>
    </div>
  ) : null;
  const copyBtn = (text, id, label) => (
    <button className="act" onClick={() => copy(text, id)} title={`Copy ${label}`}
      style={{ padding: "2px 8px", fontFamily: "var(--v2-mono)", fontSize: 11.5, color: copied === id ? "var(--good)" : "var(--ink-1)" }}>
      {copied === id ? "✓ copied" : text}
    </button>
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={onClose} />
      <div style={{ position: "relative", width: "100%", maxWidth: 560, maxHeight: "88vh", overflowY: "auto", background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 12, padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
          <div>
            <div style={{ fontWeight: 700, color: "var(--ink-0)" }}>{ped.display_name || ped.model_name}</div>
            <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{ped.category || "Uncategorised"}{ped.dlc && ped.dlc !== "basegame" ? ` · ${ped.dlc}` : ""}</div>
          </div>
          <button className="act" style={{ padding: "2px 8px" }} onClick={onClose}>✕</button>
        </div>

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <div style={{ width: 168, height: 168, flexShrink: 0, borderRadius: 10, background: "var(--panel-2)", display: "grid", placeItems: "center", overflow: "hidden" }}>
            {ped.image
              ? <img src={`/peds/${ped.image}`} alt={ped.model_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : <span style={{ fontSize: 11, color: "var(--ink-3)", textAlign: "center", padding: 10 }}>No preview<br />available</span>}
          </div>
          <div style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column", gap: 7 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ minWidth: 92, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--ink-3)" }}>Model</span>
              {copyBtn(ped.model_name, `m${ped.id}`, "model name")}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ minWidth: 92, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--ink-3)" }}>Hash</span>
              {copyBtn(String(ped.hash), `d${ped.id}`, "decimal hash")}
              {copyBtn(ped.hash_hex, `h${ped.id}`, "hex hash")}
            </div>
            {kv("Ped type", ped.ped_type)}
            {kv("Gender", ped.gender)}
            {kv("Age", ped.age)}
            {kv("Variations", [ped.props != null ? `${ped.props} props` : null, ped.components != null ? `${ped.components} components` : null].filter(Boolean).join(" · "))}
            {kv("Preview", ped.image_source === "gtax.dev" ? "gtax.dev render (rear view)" : ped.image_source)}
            {kv("Curated by", ped.tags_curated ? `${ped.updated_by || "staff"}${ped.updated_at ? ` · ${ped.updated_at}` : ""}` : null)}
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--ink-3)" }}>Tags</span>
            <span style={{ flex: 1 }} />
            {canEdit && !editing && <button className="act" style={{ padding: "2px 8px", fontSize: 11, color: "var(--accent)" }} onClick={() => setEditing(true)}>Edit tags</button>}
          </div>
          {editing ? (
            <>
              <input className="filter-inp" style={{ width: "100%" }} value={tagText} onChange={e => setTagText(e.target.value)} placeholder="comma, separated, tags" />
              <textarea className="filter-inp" style={{ width: "100%", marginTop: 8 }} rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional) — e.g. where this model is used" />
              {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
                <button className="act" disabled={busy} onClick={() => { setTagText(ped.tags.join(", ")); setNotes(ped.notes || ""); setEditing(false); }}>Cancel</button>
                <button className="act primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save tags"}</button>
              </div>
            </>
          ) : (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {ped.tags.map(t => <button key={t} className="chip role" style={{ cursor: "pointer" }} onClick={() => onTag(t)} title={`Filter by "${t}"`}>{t}</button>)}
              {!ped.tags.length && <span style={{ fontSize: 12, fontStyle: "italic", color: "var(--ink-3)" }}>Untagged.</span>}
            </div>
          )}
          {!editing && ped.notes && <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 8 }}>{ped.notes}</div>}
        </div>
      </div>
    </div>
  );
}
