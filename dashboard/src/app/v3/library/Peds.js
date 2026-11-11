"use client";
// Library › Peds — every GTA V ped model with preview, model name, joaat hash
// and tags. Paged on the server (getPedsPage, 48 per page, filters in SQL);
// images lazy-load. Reading is open to everyone in the Library; tag curation
// is L2 (Event Team read-only, policy 4).
import { useEffect, useRef, useState } from "react";
import { getPedsPage, updatePedTags } from "../../v2/story/actions.js";
import { Card, Button, Field, Empty, Modal, useAction } from "../ui.js";
import { useCopy, CopyButton } from "./shared.js";

const PAGE = 48;

export default function Peds({ auth, initialQ = "" }) {
  const canEdit = (auth.level || 0) >= 2;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState(initialQ);
  const [picked, setPicked] = useState([]);
  const [category, setCategory] = useState("");
  const [imageOnly, setImageOnly] = useState(false);
  const [allTags, setAllTags] = useState(false);
  const [view, setView] = useState("grid");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const [copied, copy] = useCopy();
  const reqRef = useRef(0);

  useEffect(() => { if (initialQ) setQ(initialQ); }, [initialQ]);
  useEffect(() => { setPage(1); }, [q, picked, category, imageOnly]);
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

  if (!data && loading) return <div className="stack"><div className="skeleton row" /><div className="skeleton block" /></div>;
  if (!data && err) return <div className="err">{err}</div>;
  if (data && total === 0) return <Empty title="The ped catalogue is empty">Run <code className="mono">scripts/build-peds.mjs</code> and apply the migration.</Empty>;

  const toggleTag = (t) => setPicked(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t]);
  const tagsToShow = allTags ? tagCounts : tagCounts.slice(0, 20);
  const filtering = picked.length || category || q || imageOnly;
  const clear = () => { setPicked([]); setCategory(""); setQ(""); setImageOnly(false); };

  return (
    <div className="stack">
      <div className="row">
        <input className="inp grow" placeholder="Search name, hash or tag…" value={q} onChange={e => setQ(e.target.value)} />
        <select className="inp auto" value={category} onChange={e => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={imageOnly} onChange={e => setImageOnly(e.target.checked)} /> With preview only</label>
        <span className="spacer" />
        <span className="tiny faint mono">{loading ? "…" : `${matched} of ${total}`}</span>
        <div className="chips">
          <button className={`chip${view === "grid" ? " on" : ""}`} onClick={() => setView("grid")}>Grid</button>
          <button className={`chip${view === "table" ? " on" : ""}`} onClick={() => setView("table")}>Table</button>
        </div>
      </div>
      <div className="chips">
        {tagsToShow.map(([t, n]) => <button key={t} className={`chip tag${picked.includes(t) ? " on" : ""}`} onClick={() => toggleTag(t)} title={`${n} peds`}>{t} <span className="faint mono">{n}</span></button>)}
        {tagCounts.length > 20 && <button className="linkbtn" onClick={() => setAllTags(a => !a)}>{allTags ? "Fewer tags" : `All ${tagCounts.length} tags`}</button>}
        {filtering ? <button className="linkbtn c-rose" onClick={clear}>Clear filters</button> : null}
      </div>
      {err && <div className="err">{err}</div>}
      {!loading && rows.length === 0 && <Empty title="No peds match">Loosen the search or drop a tag.</Empty>}

      {view === "grid" ? (
        <div className={`ped-grid${loading ? " dim" : ""}`}>
          {rows.map(p => (
            <button key={p.id} className="ped-tile" onClick={() => setOpen(p)} title={p.display_name || p.model_name}>
              <div className="ped-img">{p.image ? <img src={`/peds/${p.image}`} alt={p.model_name} loading="lazy" decoding="async" /> : <span className="nm">{p.model_name}</span>}</div>
              <div className="cap"><div className="m">{p.model_name}</div><div className="n">{p.display_name || p.category || "—"}</div></div>
            </button>
          ))}
        </div>
      ) : (
        <Card flush className={loading ? "dim" : ""}>
          <div className="tblwrap">
            <table className="tbl">
              <thead><tr><th></th><th>Model</th><th className="hide-sm">Name</th><th>Hash</th><th className="hide-sm">Category</th><th className="hide-sm">Tags</th></tr></thead>
              <tbody>
                {rows.map(p => (
                  <tr key={p.id} className="link" onClick={() => setOpen(p)}>
                    <td>{p.image ? <img className="ped-thumb" src={`/peds/${p.image}`} alt="" loading="lazy" decoding="async" /> : <div className="ped-thumb" />}</td>
                    <td className="mono">{p.model_name}</td>
                    <td className="hide-sm">{p.display_name || <span className="faint">—</span>}</td>
                    <td className="mono muted">{p.hash_hex}</td>
                    <td className="hide-sm muted">{p.category || "—"}</td>
                    <td className="hide-sm faint tiny">{p.tags.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {pages > 1 && (
        <div className="pager">
          <Button variant="ghost" size="sm" disabled={page <= 1 || loading} onClick={() => setPage(p => Math.max(1, p - 1))}>← Prev</Button>
          <span className="tiny faint mono">Page {page} of {pages}</span>
          <Button variant="ghost" size="sm" disabled={page >= pages || loading} onClick={() => setPage(p => Math.min(pages, p + 1))}>Next →</Button>
        </div>
      )}

      {open && (
        <PedDetail ped={open} canEdit={canEdit} copied={copied} copy={copy}
          onTag={(t) => { setOpen(null); setPicked(p => p.includes(t) ? p : [...p, t]); }}
          onClose={() => setOpen(null)}
          onSaved={(updated) => { setData(d => d ? { ...d, rows: d.rows.map(r => r.id === updated.id ? updated : r) } : d); setOpen(updated); }} />
      )}
    </div>
  );
}

function PedDetail({ ped, canEdit, copied, copy, onTag, onClose, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [tagText, setTagText] = useState(ped.tags.join(", "));
  const [notes, setNotes] = useState(ped.notes || "");
  const { run, busy } = useAction();
  useEffect(() => { setTagText(ped.tags.join(", ")); setNotes(ped.notes || ""); setEditing(false); }, [ped.id]);

  const save = () => run(() => updatePedTags(ped.id, tagText.split(",").map(t => t.trim()).filter(Boolean), notes), {
    success: "Tags saved.",
    onDone: (r) => { onSaved({ ...ped, tags: r.tags, notes: notes.trim() || null, tags_curated: 1 }); setEditing(false); },
  });
  const kv = (k, v) => v ? <div className="kv"><span className="k">{k}</span><span>{v}</span></div> : null;

  return (
    <Modal title={ped.display_name || ped.model_name} maxWidth={600} onClose={onClose} onSave={editing ? save : undefined} saveLabel="Save tags" saveDisabled={busy}>
      <div className="tiny faint">{ped.category || "Uncategorised"}{ped.dlc && ped.dlc !== "basegame" ? ` · ${ped.dlc}` : ""}</div>
      <div className="row top">
        <div className="ped-hero">{ped.image ? <img src={`/peds/${ped.image}`} alt={ped.model_name} /> : <span className="tiny faint">No preview</span>}</div>
        <div className="stack grow gap-sm">
          <div className="kv"><span className="k">Model</span><CopyButton text={ped.model_name} id={`m${ped.id}`} copied={copied} copy={copy} label={ped.model_name} /></div>
          <div className="kv"><span className="k">Hash</span><CopyButton text={String(ped.hash)} id={`d${ped.id}`} copied={copied} copy={copy} label={String(ped.hash)} /><CopyButton text={ped.hash_hex} id={`h${ped.id}`} copied={copied} copy={copy} label={ped.hash_hex} /></div>
          {kv("Ped type", ped.ped_type)}
          {kv("Gender", ped.gender)}
          {kv("Age", ped.age)}
          {kv("Variations", [ped.props != null ? `${ped.props} props` : null, ped.components != null ? `${ped.components} components` : null].filter(Boolean).join(" · "))}
          {kv("Preview", ped.image_source === "gtax.dev" ? "gtax.dev render (rear view)" : ped.image_source)}
          {kv("Curated by", ped.tags_curated ? `${ped.updated_by || "staff"}${ped.updated_at ? ` · ${ped.updated_at}` : ""}` : null)}
        </div>
      </div>
      <div className="row spread"><span className="lbl">Tags</span>{canEdit && !editing && <Button variant="quiet" size="sm" onClick={() => setEditing(true)}>Edit tags</Button>}</div>
      {editing ? (
        <>
          <Field label="Tags" help="Comma-separated; free text — staff shorthand is fine."><input value={tagText} onChange={e => setTagText(e.target.value)} /></Field>
          <Field label="Notes (optional)"><textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. where this model is used" /></Field>
          <div><Button variant="quiet" size="sm" disabled={busy} onClick={() => { setTagText(ped.tags.join(", ")); setNotes(ped.notes || ""); setEditing(false); }}>Discard changes</Button></div>
        </>
      ) : (
        <>
          <div className="chips">
            {ped.tags.map(t => <button key={t} className="chip tag" onClick={() => onTag(t)} title={`Filter by “${t}”`}>{t}</button>)}
            {!ped.tags.length && <span className="tiny faint">Untagged.</span>}
          </div>
          {ped.notes && <div className="small muted">{ped.notes}</div>}
        </>
      )}
    </Modal>
  );
}
