"use client";
// Library › Knowledge Base. Lore entries (read L1+/ET/LST, write L2+) and
// "Management" command entries (read + write L3; Event Team reads them). Copy
// buttons, per-person favourites (localStorage), category pills, ?q= seeding.
import { useEffect, useMemo, useState } from "react";
import { getLoreEntries, getCommandEntries, addKBEntry, editKBEntry, deleteKBEntry } from "../../fm/storytelling/actions.js";
import { Badge, Button, Field, Empty, Modal, useAction } from "../ui.js";
import { useCopy, CopyButton, confirmIt } from "./shared.js";

const BLANK = (type) => ({ type, category: "", title: "", content: "", notes: "" });

export default function KnowledgeBase({ auth, initialQ = "" }) {
  const level = auth.level || 0;
  const canMgmt = level >= 3 || !!auth.isEventTeam;  // read management commands (server: requireActor(3, ET))
  const canEdit = level >= 2;                         // lore CRUD (policy 4: Event Team is read-only here)
  const canAddMgmt = level >= 3;                      // management CRUD
  const [lore, setLore] = useState(null);
  const [cmds, setCmds] = useState([]);
  const [loadErr, setLoadErr] = useState("");
  const [search, setSearch] = useState(initialQ);
  const [filter, setFilter] = useState(null);         // null | category | "__fav" | "__mgmt"
  const [favs, setFavs] = useState([]);
  const [form, setForm] = useState(null);
  const [copied, copy] = useCopy();
  const { run, busy } = useAction();

  const load = async () => {
    try {
      const [l, c] = await Promise.all([getLoreEntries(), canMgmt ? getCommandEntries() : Promise.resolve([])]);
      setLore(l || []); setCmds(c || []); setLoadErr("");
    } catch (e) { setLore([]); setLoadErr(e?.message || "Could not load the Knowledge Base."); }
  };
  useEffect(() => { load(); }, [canMgmt]);
  useEffect(() => { if (initialQ) { setSearch(initialQ); setFilter(null); } }, [initialQ]);
  useEffect(() => { try { setFavs(JSON.parse(localStorage.getItem("meridian_kb_favs_" + auth.id) || "[]")); } catch {} }, [auth.id]);
  const toggleFav = (uid) => { const n = favs.includes(uid) ? favs.filter(f => f !== uid) : [...favs, uid]; setFavs(n); try { localStorage.setItem("meridian_kb_favs_" + auth.id, JSON.stringify(n)); } catch {} };

  const all = useMemo(() => [
    ...(lore || []).map(i => ({ ...i, dtype: "lore", uid: `l-${i.id}` })),
    ...(canMgmt ? cmds.map(i => ({ ...i, dtype: "command", uid: `c-${i.id}` })) : []),
  ], [lore, cmds, canMgmt]);
  const categories = useMemo(() => {
    const c = {};
    (lore || []).forEach(i => { const k = i.category || "General"; c[k] = (c[k] || 0) + 1; });
    return Object.entries(c).sort((a, b) => a[0].localeCompare(b[0]));
  }, [lore]);
  const items = useMemo(() => {
    let f = all;
    if (search) { const q = search.toLowerCase(); f = f.filter(i => [i.title, i.category, i.content, i.notes].some(x => (x || "").toLowerCase().includes(q))); }
    if (filter === "__fav") f = f.filter(i => favs.includes(i.uid));
    else if (filter === "__mgmt") f = f.filter(i => i.dtype === "command");
    else if (filter) f = f.filter(i => (i.category || "General") === filter && i.dtype !== "command");
    else f = f.filter(i => i.dtype !== "command");
    return [...f].sort((a, b) => { const af = favs.includes(a.uid), bf = favs.includes(b.uid); if (af !== bf) return af ? -1 : 1; return (a.title || "").localeCompare(b.title || ""); });
  }, [all, search, filter, favs]);

  const save = () => run(() => form.id ? editKBEntry(form.id, form) : addKBEntry(form, form.type), { success: form.id ? "Entry updated." : "Entry added.", onDone: () => { setForm(null); load(); } });
  const remove = (item) => { if (!confirmIt(`Delete "${item.title}"?`)) return; run(() => deleteKBEntry(item.id), { success: "Entry deleted.", onDone: load }); };

  if (lore === null) return <div className="stack"><div className="skeleton row" /><div className="skeleton block" /></div>;

  return (
    <div className="stack">
      <div className="row">
        <input className="inp grow" placeholder="Search title, content, category, notes…" value={search} onChange={e => setSearch(e.target.value)} />
        {canEdit && <Button onClick={() => setForm(BLANK("lore"))}>+ Entry</Button>}
        {canAddMgmt && <Button variant="ghost" onClick={() => setForm(BLANK("command"))}>+ Management</Button>}
      </div>
      <div className="chips">
        <button className={`chip${filter === null ? " on" : ""}`} onClick={() => setFilter(null)}>All <Badge>{(lore || []).length}</Badge></button>
        {categories.map(([c, n]) => <button key={c} className={`chip${filter === c ? " on" : ""}`} onClick={() => setFilter(filter === c ? null : c)}>{c} <Badge>{n}</Badge></button>)}
        <button className={`chip${filter === "__fav" ? " on warn" : ""}`} onClick={() => setFilter(filter === "__fav" ? null : "__fav")}>★ Favourites <Badge>{favs.length}</Badge></button>
        {canMgmt && <button className={`chip${filter === "__mgmt" ? " on good" : ""}`} onClick={() => setFilter(filter === "__mgmt" ? null : "__mgmt")}>Management <Badge>{cmds.length}</Badge></button>}
      </div>
      {loadErr && <div className="err">{loadErr}</div>}
      {items.length === 0 ? <Empty title="No entries match">{canEdit ? "Add one with “+ Entry”." : "Try another search or category."}</Empty> : (
        <div className="entry-grid">
          {items.map(item => {
            const isFav = favs.includes(item.uid), isCmd = item.dtype === "command";
            return (
              <div key={item.uid} className={`entry${isFav ? " fav" : ""}${isCmd ? " mgmt" : ""}`}>
                <div className="row spread">
                  <div className="row gap-xs">{item.category && <Badge tone="accent">{item.category}</Badge>}{isCmd && <Badge tone="good">MGMT</Badge>}</div>
                  <button className={`star${isFav ? " on" : ""}`} onClick={() => toggleFav(item.uid)} title={isFav ? "Remove favourite" : "Favourite"}>{isFav ? "★" : "☆"}</button>
                </div>
                <div className="et">{item.title}</div>
                {item.content && <div className={`codeblock${isCmd ? " good" : ""}`}>{item.content}</div>}
                {item.notes && <div className="tiny faint italic">{item.notes}</div>}
                <div className="foot">
                  <CopyButton text={item.content || item.title} id={item.uid} copied={copied} copy={copy} />
                  {(isCmd ? canAddMgmt : canEdit) && <>
                    <button className="copybtn" onClick={() => setForm({ id: item.id, type: item.dtype, category: item.category || "", title: item.title || "", content: item.content || "", notes: item.notes || "" })}>Edit</button>
                    <button className="copybtn c-rose" disabled={busy} onClick={() => remove(item)}>Del</button>
                  </>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {form && (
        <Modal title={`${form.id ? "Edit" : "Add"} ${form.type === "command" ? "management" : "KB"} entry`} onClose={() => setForm(null)} onSave={save} saveDisabled={busy || !form.title.trim()}>
          <Field label="Category"><input list="kbcats" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="General" /></Field>
          <datalist id="kbcats">{categories.map(([c]) => <option key={c} value={c} />)}</datalist>
          <Field label="Title"><input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Content" help="This is the value the Copy button copies."><textarea rows={4} value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} /></Field>
          <Field label="Notes (optional)"><input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
        </Modal>
      )}
    </div>
  );
}
