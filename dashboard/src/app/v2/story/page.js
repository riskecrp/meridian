"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useAuth } from "../../../lib/useAuth";
import {
  getLoreEntries, getCommandEntries, addKBEntry, editKBEntry, deleteKBEntry,
  getChangeLogs, addChangeLog, editChangeLog, deleteChangeLog,
  getSceneLibrary,
  getLoadouts, addWeapon, editWeapon, deleteWeapon,
  addAmmoCompat, removeAmmoCompat, addAttachmentCompat, removeAttachmentCompat,
  getAmmoList, getAttachmentList,
  getSpawnItems, addSpawnItem, editSpawnItem, deleteSpawnItem,
  getNPCs, getTurfs, addNPC, editNPC, deleteNPC, updateTurf, disbandTurf,
} from "../../fm/storytelling/actions.js";
import { getSceneLogs, getFactionNames as getSceneFactionNames, getInventoryForScene, getStaffForScene, submitScene, addMyselfToScene, removeAssistantFromScene, editSceneNotes, deleteScene, requestSceneDeletion, getAttentionFactions, getTreasuryStats } from "../../fm/scenes/actions.js";
import { useDraft, loadDraft, clearDraft } from "../../../lib/useDraft";

import Modal from "../Modal.js";
import { useCopy, useRun } from "../hooks.js";

const GTAMap = dynamic(() => import("../../../lib/GTAMap"), { ssr: false, loading: () => <div style={{ height: 400, display: "grid", placeItems: "center", color: "var(--ink-3)" }}>Loading map…</div> });

export default function V2StoryPage() {
  return <Suspense fallback={<div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>}><V2Story /></Suspense>;
}

function V2Story() {
  const auth = useAuth();
  const level = auth?.level || 0;
  const isET = auth?.isEventTeam;
  const canNPC = level >= 2 || isET || auth?.isLeadStoryteller;
  const canMgmt = level >= 3 || isET;
  const canEditArsenal = level >= 2 || isET;

  // Section comes from the nav dropdown via ?tab= (no in-page tab row).
  const sp = useSearchParams();
  const [data, setData] = useState({});
  const [loaded, setLoaded] = useState({});
  const [busy, setBusy] = useState(false);

  const loaders = {
    kb: async () => ({ lore: await getLoreEntries().catch(() => []), command: canMgmt ? await getCommandEntries().catch(() => []) : [] }),
    changelog: () => getChangeLogs().catch(() => []),
    scenes: () => getSceneLibrary().catch(() => []),
    arsenal: async () => ({
      loadouts: await getLoadouts().catch(() => []),
      ammo: await getAmmoList().catch(() => []),
      att: await getAttachmentList().catch(() => []),
      spawns: canMgmt ? await getSpawnItems().catch(() => []) : [],
    }),
    npcs: async () => ({ npcs: await getNPCs().catch(() => []), turfs: await getTurfs().catch(() => []) }),
  };
  const ensure = async (t) => { if (loaded[t] || !loaders[t]) return; setBusy(true); const r = await loaders[t](); setData(d => ({ ...d, [t]: r })); setLoaded(l => ({ ...l, [t]: true })); setBusy(false); };
  const reload = async (t) => { const r = await loaders[t](); setData(d => ({ ...d, [t]: r })); };

  const TABS = [
    { id: "kb", label: "Knowledge Base" },
    { id: "scenelogs", label: "Scene Logs" },
    { id: "scenes", label: "Scene Library" },
    { id: "arsenal", label: "Arsenal" },
    ...(canNPC ? [{ id: "npcs", label: "NPC Ecosystem" }] : []),
    { id: "changelog", label: "Change Log" },
  ];
  const tabParam = sp.get("tab");
  const tab = TABS.some(t => t.id === tabParam) ? tabParam : "kb";

  useEffect(() => { if (!auth?.loading && auth?.id) ensure(tab); }, [tab, auth?.id, auth?.loading]);

  if (auth?.loading) return <div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>;
  if (!auth?.ok) return <div className="view" style={{ color: "var(--ink-3)" }}>Not authorized.</div>;

  const sectionLabel = TABS.find(t => t.id === tab)?.label || "";

  return (
    <div className="view">
      <div className="page-head">
        <div>
          <p className="eyebrow">Storytelling</p>
          <h1>{sectionLabel}</h1>
          <div className="sub">Switch sections from the Storytelling menu in the top bar.</div>
        </div>
      </div>
      {busy && !loaded[tab] && <div className="empty">Loading…</div>}

      {tab === "kb" && loaded.kb && <KB auth={auth} canMgmt={canMgmt} lore={data.kb.lore} cmds={data.kb.command} reload={() => reload("kb")} />}
      {tab === "changelog" && loaded.changelog && <ChangeLog auth={auth} rows={data.changelog} reload={() => reload("changelog")} />}
      {tab === "scenes" && loaded.scenes && <Scenes rows={data.scenes} />}
      {tab === "scenelogs" && <SceneLogs auth={auth} />}
      {tab === "arsenal" && loaded.arsenal && <Arsenal canEdit={canEditArsenal} canMgmt={canMgmt} d={data.arsenal} reload={() => reload("arsenal")} />}
      {tab === "npcs" && loaded.npcs && <NPCs auth={auth} npcs={data.npcs.npcs} turfs={data.npcs.turfs} reload={() => reload("npcs")} />}
    </div>
  );
}

/* ── Knowledge Base ── */
function KB({ auth, canMgmt, lore, cmds, reload }) {
  const canEdit = auth.level >= 2 || auth.isEventTeam;
  const [copied, copy] = useCopy();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState(null);
  const [favs, setFavs] = useState([]);
  const [form, setForm] = useState(null);
  const { busy, err, setErr, run } = useRun();
  useEffect(() => { try { setFavs(JSON.parse(localStorage.getItem("meridian_kb_favs_" + auth.id) || "[]")); } catch {} }, [auth.id]);
  const toggleFav = (uid) => { const n = favs.includes(uid) ? favs.filter(f => f !== uid) : [...favs, uid]; setFavs(n); localStorage.setItem("meridian_kb_favs_" + auth.id, JSON.stringify(n)); };
  const allItems = useMemo(() => [...lore.map(i => ({ ...i, dtype: "lore", uid: `l-${i.id}` })), ...(canMgmt ? cmds.map(i => ({ ...i, dtype: "command", uid: `c-${i.id}` })) : [])], [lore, cmds, canMgmt]);
  const categories = useMemo(() => { const c = {}; lore.forEach(i => { const k = i.category || "General"; c[k] = (c[k] || 0) + 1; }); return Object.entries(c).sort((a, b) => a[0].localeCompare(b[0])); }, [lore]);
  const items = useMemo(() => {
    let f = allItems;
    if (search) { const q = search.toLowerCase(); f = f.filter(i => [i.title, i.category, i.content, i.notes].some(x => (x || "").toLowerCase().includes(q))); }
    if (filter === "__fav") f = f.filter(i => favs.includes(i.uid));
    else if (filter === "__mgmt") f = f.filter(i => i.dtype === "command");
    else if (filter) f = f.filter(i => i.category === filter && i.dtype !== "command");
    else f = f.filter(i => i.dtype !== "command");
    return f.sort((a, b) => { const af = favs.includes(a.uid), bf = favs.includes(b.uid); if (af && !bf) return -1; if (!af && bf) return 1; return a.title.localeCompare(b.title); });
  }, [allItems, search, filter, favs]);
  const save = () => { if (!form.title.trim()) return; run(() => form.id ? editKBEntry(form.id, form) : addKBEntry(form, form.type), () => { setForm(null); reload(); }); };
  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <input className="filter-inp" style={{ flex: 1, minWidth: 200 }} placeholder="Search title, content, category, notes…" value={search} onChange={e => setSearch(e.target.value)} />
        {canEdit && <button className="btn" onClick={() => setForm({ type: "lore", category: "", title: "", content: "", notes: "" })}>+ Entry</button>}
        {canMgmt && <button className="btn ghost" onClick={() => setForm({ type: "command", category: "", title: "", content: "", notes: "" })}>+ Management</button>}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        <button className={`pill${filter === null ? " on" : ""}`} onClick={() => setFilter(null)}>All <span className="ct">{lore.length}</span></button>
        {categories.map(([c, n]) => <button key={c} className={`pill${filter === c ? " on" : ""}`} onClick={() => setFilter(filter === c ? null : c)}>{c} <span className="ct">{n}</span></button>)}
        <button className={`pill${filter === "__fav" ? " on amber" : ""}`} onClick={() => setFilter(filter === "__fav" ? null : "__fav")}>★ Favorites <span className="ct">{favs.length}</span></button>
        {canMgmt && <button className={`pill${filter === "__mgmt" ? " on good" : ""}`} onClick={() => setFilter(filter === "__mgmt" ? null : "__mgmt")}>Management <span className="ct">{cmds.length}</span></button>}
      </div>
      {items.length === 0 ? <div className="empty">No entries match.</div> : (
        <div className="entry-grid">
          {items.map(item => {
            const isFav = favs.includes(item.uid), isCmd = item.dtype === "command", ic = copied === item.uid;
            return (
              <div key={item.uid} className={`entry${isFav ? " fav" : ""}${isCmd ? " mgmt" : ""}`}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>{item.category && <span className="chip role">{item.category}</span>}{isCmd && <span className="chip" style={{ background: "var(--good-bg)", color: "var(--good)" }}>MGMT</span>}</div>
                  <button className={`star${isFav ? " on" : ""}`} onClick={() => toggleFav(item.uid)}>{isFav ? "★" : "☆"}</button>
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink-0)", lineHeight: 1.35 }}>{item.title}</div>
                {item.content && <div className={`codeblock${isCmd ? " good" : ""}`}>{item.content}</div>}
                {item.notes && <div style={{ fontSize: 11, color: "var(--ink-3)", fontStyle: "italic" }}>{item.notes}</div>}
                <div style={{ display: "flex", gap: 6, marginTop: "auto" }}>
                  <button className={`copybtn${ic ? " done" : ""}`} style={{ flex: 1 }} onClick={() => copy(item.content || item.title, item.uid)}>{ic ? "✓ Copied" : "Copy"}</button>
                  {canEdit && <>
                    <button className="copybtn" onClick={() => setForm({ id: item.id, type: item.dtype, category: item.category || "", title: item.title || "", content: item.content || "", notes: item.notes || "" })}>Edit</button>
                    <button className="copybtn" style={{ color: "var(--rose)" }} onClick={async () => { if (window.confirm(`Delete "${item.title}"?`)) { await deleteKBEntry(item.id); reload(); } }}>Del</button>
                  </>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {form && <Modal title={`${form.id ? "Edit" : "Add"} ${form.type === "command" ? "Management" : "KB"} entry`} onClose={() => { setForm(null); setErr(""); }} onSave={save} saveDisabled={busy || !form.title.trim()} error={err}>
        <input className="filter-inp" placeholder="Category" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} />
        <input className="filter-inp" placeholder="Title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
        <textarea className="filter-inp" rows={4} placeholder="Content (the value that gets copied)" value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} />
        <input className="filter-inp" placeholder="Notes (optional)" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
      </Modal>}
    </>
  );
}

/* ── Change Log ── */
function ChangeLog({ auth, rows, reload }) {
  const isL3 = auth.level >= 3;
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(null);
  const { busy, err, setErr, run } = useRun();
  const shown = rows.filter(c => filter === "all" || c.change_type === filter).filter(c => !search || [c.name, c.position, c.notes].some(x => (x || "").toLowerCase().includes(search.toLowerCase())));
  const save = () => { if (!form.name.trim()) return; const p = { name: form.name, position: form.position, changeType: form.change_type, action: form.action, blockedOff: form.blocked_off, notes: form.notes }; run(() => form.id ? editChangeLog(form.id, p) : addChangeLog(p), () => { setForm(null); reload(); }); };
  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <input className="filter-inp" style={{ flex: 1, minWidth: 200 }} placeholder="Search by name or location…" value={search} onChange={e => setSearch(e.target.value)} />
        {[["all", "All"], ["black_market_doctor", "Doctors"], ["drop_location", "Drops"]].map(([v, l]) => <button key={v} className={`pill${filter === v ? " on" : ""}`} onClick={() => setFilter(v)}>{l}</button>)}
        {isL3 && <button className="btn" onClick={() => setForm({ change_type: "black_market_doctor", name: "", position: "", action: "Added", blocked_off: false, notes: "" })}>+ Entry</button>}
      </div>
      <div className="card">
        {shown.length === 0 ? <div className="empty">No entries.</div> : shown.map(c => (
          <div className="clog" key={c.id}>
            <span style={{ minWidth: 78, fontFamily: "var(--v2-mono)", color: "var(--ink-3)", fontSize: 11 }}>{c.created_at?.slice(0, 10)}</span>
            <span className="chip" style={{ background: c.change_type === "black_market_doctor" ? "var(--rose-bg)" : "var(--accent-bg)", color: c.change_type === "black_market_doctor" ? "var(--rose)" : "var(--accent)" }}>{c.change_type === "black_market_doctor" ? "Doctor" : "Drop"}</span>
            {c.action && <span className="chip" style={{ background: c.action === "Added" ? "var(--good-bg)" : c.action === "Removed" ? "var(--rose-bg)" : "var(--amber-bg)", color: c.action === "Added" ? "var(--good)" : c.action === "Removed" ? "var(--rose)" : "var(--amber)" }}>{c.action}</span>}
            {c.action === "Removed" && <span className="chip" style={{ background: c.blocked_off ? "var(--good-bg)" : "var(--rose-bg)", color: c.blocked_off ? "var(--good)" : "var(--rose)" }}>{c.blocked_off ? "Blocked" : "Not blocked"}</span>}
            <span style={{ fontWeight: 700, color: "var(--ink-0)" }}>{c.name}</span>
            {c.position && <span style={{ fontFamily: "var(--v2-mono)", color: "var(--accent)" }}>/tppos {c.position}</span>}
            {c.notes && <span style={{ color: "var(--ink-2)" }}>{c.notes}</span>}
            <span style={{ flex: 1 }} />
            <span style={{ color: "var(--ink-3)", fontSize: 11 }}>{c.created_by}</span>
            {isL3 && <>
              <button className="act" style={{ padding: "2px 8px" }} onClick={() => setForm({ id: c.id, change_type: c.change_type, name: c.name, position: c.position, action: c.action, blocked_off: !!c.blocked_off, notes: c.notes || "" })}>Edit</button>
              <button className="act" style={{ padding: "2px 8px", color: "var(--rose)" }} onClick={async () => { if (window.confirm("Delete?")) { await deleteChangeLog(c.id); reload(); } }}>Del</button>
            </>}
          </div>
        ))}
      </div>
      {form && <Modal title={`${form.id ? "Edit" : "New"} change-log entry`} onClose={() => { setForm(null); setErr(""); }} onSave={save} saveDisabled={busy || !form.name.trim()} error={err}>
        <select className="filter-inp" value={form.change_type} onChange={e => setForm({ ...form, change_type: e.target.value })}><option value="black_market_doctor">Black Market Doctor</option><option value="drop_location">Drop Location</option></select>
        <input className="filter-inp" placeholder="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        <input className="filter-inp" placeholder="/tppos location" value={form.position} onChange={e => setForm({ ...form, position: e.target.value })} />
        {form.change_type === "black_market_doctor" && <>
          <select className="filter-inp" value={form.action} onChange={e => setForm({ ...form, action: e.target.value })}>{["Added", "Moved", "Removed"].map(a => <option key={a} value={a}>{a}</option>)}</select>
          {form.action === "Removed" && <label style={{ fontSize: 12.5, display: "flex", gap: 8, alignItems: "center", color: "var(--ink-1)" }}><input type="checkbox" checked={form.blocked_off} onChange={e => setForm({ ...form, blocked_off: e.target.checked })} /> Location blocked off?</label>}
          <input className="filter-inp" placeholder="Notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
        </>}
      </Modal>}
    </>
  );
}

/* ── Scene Library (read) ── */
function Scenes({ rows }) {
  const [q, setQ] = useState("");
  const shown = rows.filter(s => !q || [s.title, s.description, s.category, s.tags].some(x => (x || "").toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <input className="filter-inp" placeholder="Filter scenes…" value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 16, maxWidth: 380 }} />
      <div className="card">
        <div className="hd"><div className="t">Scene ideas</div><div className="meta">{shown.length}</div></div>
        {shown.length === 0 ? <div className="empty">No scenes.</div> : shown.map(s => (
          <div className="note" key={s.id}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700, color: "var(--ink-0)", fontSize: 13 }}>{s.title}</span>
              {s.status && <span className="chip role">{s.status}</span>}{s.category && <span className="chip role">{s.category}</span>}{s.proposed_rewards && <span className="chip lock">{s.proposed_rewards}</span>}
            </div>
            <div style={{ whiteSpace: "pre-wrap", color: "var(--ink-1)" }}>{s.description}</div>
            {(s.staff_required || s.spawning_required || s.ped_required) && <div className="by">{[s.staff_required && `Staff: ${s.staff_required}`, s.spawning_required && `Spawning: ${s.spawning_required}`, s.ped_required && `Peds: ${s.ped_required}`].filter(Boolean).join(" · ")}</div>}
          </div>
        ))}
      </div>
    </>
  );
}

const ammoChip = (type) => { const m = { AP: ["var(--rose-bg)", "var(--rose)"], FMJ: ["var(--amber-bg)", "var(--amber)"], HP: ["var(--good-bg)", "var(--good)"] }; return m[type] || ["var(--panel-2)", "var(--ink-2)"]; };

/* ── Arsenal — loadouts (weapon + ammo/attachment CRUD) + spawn commands ── */
function Arsenal({ canEdit, canMgmt, d, reload }) {
  const [sub, setSub] = useState("loadouts");
  const [copied, copy] = useCopy();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState(null);
  const [exp, setExp] = useState(null);
  const [wForm, setWForm] = useState(null); // weapon add/edit
  const [addAmmo, setAddAmmo] = useState({}); // weaponId -> selected
  const [addAtt, setAddAtt] = useState({});
  const [spawnForm, setSpawnForm] = useState(null);
  const [qty, setQty] = useState(1);
  const [sSearch, setSSearch] = useState("");

  const loadouts = d.loadouts || [];
  const { busy, err, setErr, run } = useRun();
  const cats = [...new Set(loadouts.map(w => w.weapon_category))].filter(Boolean).sort();
  const shown = loadouts.filter(w => !cat || w.weapon_category === cat).filter(w => !q || [w.weapon_name, w.caliber].some(x => (x || "").toLowerCase().includes(q.toLowerCase())) || (w.ammo || []).some(a => a.ammo_name.toLowerCase().includes(q.toLowerCase())) || (w.attachments || []).some(a => a.attachment_name.toLowerCase().includes(q.toLowerCase())));
  const saveWeapon = () => { if (!wForm.name.trim()) return; run(() => wForm.id ? editWeapon(wForm.id, wForm) : addWeapon(wForm), () => { setWForm(null); reload(); }); };

  const spawnCmd = (item, n) => { const t = (item.item_type || "").toLowerCase(); if (t === "weapon" || t === "ammo") return `/GetWeapon ${item.game_id} ${n} 0`; if (t.includes("component") || t.includes("attachment")) return `/GetWeaponComponent ${item.game_id}`; return `/GetItem ${item.game_id} ${n}`; };
  const spawns = d.spawns || [];
  const spawnShown = spawns.filter(i => !sSearch || [i.name, i.category, i.game_id].some(x => (x || "").toLowerCase().includes(sSearch.toLowerCase())));
  const saveSpawn = () => { if (!spawnForm.name.trim()) return; const p = { name: spawnForm.name, gameId: spawnForm.game_id, category: spawnForm.category, itemType: spawnForm.item_type }; run(() => spawnForm.id ? editSpawnItem(spawnForm.id, p) : addSpawnItem(p), () => { setSpawnForm(null); reload(); }); };

  return (
    <>
      <div className="hub-tabs" style={{ marginTop: 0 }}>
        <button className={`hub-tab${sub === "loadouts" ? " on" : ""}`} onClick={() => setSub("loadouts")}>Loadouts</button>
        {canMgmt && <button className={`hub-tab${sub === "spawn" ? " on" : ""}`} onClick={() => setSub("spawn")}>Spawn Commands</button>}
      </div>

      {sub === "loadouts" && <>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <input className="filter-inp" style={{ flex: 1, minWidth: 200 }} placeholder="Search weapons, ammo, attachments…" value={q} onChange={e => setQ(e.target.value)} />
          {canEdit && <button className="btn" onClick={() => setWForm({ name: "", category: "", caliber: "" })}>+ Weapon</button>}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          <button className={`pill${!cat ? " on" : ""}`} onClick={() => setCat(null)}>All</button>
          {cats.map(c => <button key={c} className={`pill${cat === c ? " on" : ""}`} onClick={() => setCat(cat === c ? null : c)}>{c}</button>)}
        </div>
        <div className="card">
          {shown.length === 0 ? <div className="empty">No weapons match.</div> : shown.map(w => (
            <div key={w.id} style={{ borderBottom: "1px solid var(--line)" }}>
              <div className="row" onClick={() => setExp(exp === w.id ? null : w.id)}>
                <span className="chip role">{w.weapon_category}</span>
                <span className="desc">{w.weapon_name}</span>
                {w.caliber && <span className="chip" style={{ background: "var(--accent-bg)", color: "var(--accent)" }}>{w.caliber}</span>}
                <span className="chip due">{(w.ammo || []).length} ammo · {(w.attachments || []).length} att</span>
                {canEdit && <>
                  <button className="act" style={{ padding: "2px 8px" }} onClick={e => { e.stopPropagation(); setWForm({ id: w.id, name: w.weapon_name, category: w.weapon_category || "", caliber: w.caliber || "" }); }}>Edit</button>
                  <button className="act" style={{ padding: "2px 8px", color: "var(--rose)" }} onClick={async e => { e.stopPropagation(); if (window.confirm(`Delete ${w.weapon_name}?`)) { await deleteWeapon(w.id); reload(); } }}>Del</button>
                </>}
                <span className="caret">▼</span>
              </div>
              {exp === w.id && (
                <div className="task-detail" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                  <div>
                    <div style={{ fontFamily: "var(--v2-mono)", fontSize: 10, color: "var(--amber)", marginBottom: 7, letterSpacing: "0.1em" }}>ATTACHMENTS</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: canEdit ? 8 : 0 }}>
                      {(w.attachments || []).map(a => <span key={a.id} className="chip role">{a.attachment_name}{canEdit && <button style={{ marginLeft: 5, color: "var(--rose)", background: "none", border: "none", cursor: "pointer" }} onClick={async () => { if (window.confirm("Remove?")) { await removeAttachmentCompat(a.id); reload(); } }}>✕</button>}</span>)}
                      {!(w.attachments || []).length && <span style={{ color: "var(--ink-3)", fontSize: 12 }}>None</span>}
                    </div>
                    {canEdit && <div style={{ display: "flex", gap: 5 }}>
                      <select className="filter-inp" value={addAtt[w.id] || ""} onChange={e => setAddAtt({ ...addAtt, [w.id]: e.target.value })}>
                        <option value="">+ attachment…</option>
                        {(d.att || []).filter(a => !(w.attachments || []).some(x => x.attachment_name === a)).map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                      <button className="act" disabled={!addAtt[w.id]} onClick={async () => { await addAttachmentCompat(w.id, addAtt[w.id]); setAddAtt({ ...addAtt, [w.id]: "" }); reload(); }}>Add</button>
                    </div>}
                  </div>
                  <div>
                    <div style={{ fontFamily: "var(--v2-mono)", fontSize: 10, color: "var(--ink-2)", marginBottom: 7, letterSpacing: "0.1em" }}>COMPATIBLE AMMO</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: canEdit ? 8 : 0 }}>
                      {(w.ammo || []).map(a => { const [bg, col] = ammoChip(a.ammo_type); return <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 7 }}><span className="chip" style={{ background: bg, color: col }}>{a.ammo_type}</span><span style={{ fontSize: 12, color: "var(--ink-1)" }}>{a.ammo_name}</span>{canEdit && <button style={{ color: "var(--rose)", background: "none", border: "none", cursor: "pointer", fontSize: 11 }} onClick={async () => { if (window.confirm("Remove?")) { await removeAmmoCompat(a.id); reload(); } }}>✕</button>}</div>; })}
                      {!(w.ammo || []).length && <span style={{ color: "var(--ink-3)", fontSize: 12 }}>None</span>}
                    </div>
                    {canEdit && <div style={{ display: "flex", gap: 5 }}>
                      <select className="filter-inp" value={addAmmo[w.id] || ""} onChange={e => setAddAmmo({ ...addAmmo, [w.id]: e.target.value })}>
                        <option value="">+ ammo…</option>
                        {(d.ammo || []).filter(a => !(w.ammo || []).some(x => x.ammo_name === a)).map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                      <button className="act" disabled={!addAmmo[w.id]} onClick={async () => { await addAmmoCompat(w.id, addAmmo[w.id]); setAddAmmo({ ...addAmmo, [w.id]: "" }); reload(); }}>Add</button>
                    </div>}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        {wForm && <Modal title={`${wForm.id ? "Edit" : "Add"} weapon`} onClose={() => { setWForm(null); setErr(""); }} onSave={saveWeapon} saveDisabled={busy || !wForm.name.trim()} error={err}>
          <input className="filter-inp" placeholder="Weapon name" value={wForm.name} onChange={e => setWForm({ ...wForm, name: e.target.value })} />
          <input className="filter-inp" placeholder="Category" list="wcats" value={wForm.category} onChange={e => setWForm({ ...wForm, category: e.target.value })} />
          <datalist id="wcats">{cats.map(c => <option key={c} value={c} />)}</datalist>
          <input className="filter-inp" placeholder="Caliber (optional)" value={wForm.caliber} onChange={e => setWForm({ ...wForm, caliber: e.target.value })} />
        </Modal>}
      </>}

      {sub === "spawn" && canMgmt && <>
        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
          <input className="filter-inp" style={{ flex: 1, minWidth: 200 }} placeholder="Search items, categories, game IDs…" value={sSearch} onChange={e => setSSearch(e.target.value)} />
          <span style={{ fontFamily: "var(--v2-mono)", fontSize: 11, color: "var(--ink-3)" }}>QTY</span>
          <input className="filter-inp" type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} style={{ width: 64 }} />
          <button className="btn" onClick={() => setSpawnForm({ name: "", game_id: "", category: "", item_type: "item" })}>+ Item</button>
        </div>
        <div className="card">
          <table className="dtable">
            <thead><tr><th>Category</th><th>Name</th><th>Game ID</th><th>Command</th><th></th></tr></thead>
            <tbody>
              {spawnShown.map((item, idx) => { const cmd = spawnCmd(item, qty); const ic = copied === `sp-${item.id ?? idx}`; return (
                <tr key={item.id ?? idx}>
                  <td style={{ fontFamily: "var(--v2-mono)", fontSize: 10, color: "var(--ink-3)" }}>{item.category}</td>
                  <td><b>{item.name}</b></td>
                  <td style={{ fontFamily: "var(--v2-mono)", fontSize: 11, color: "var(--ink-2)" }}>{item.game_id}</td>
                  <td><code style={{ fontFamily: "var(--v2-mono)", fontSize: 10.5, color: "var(--ink-1)" }}>{cmd}</code></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className={`copybtn${ic ? " done" : ""}`} style={{ padding: "3px 9px" }} onClick={() => copy(cmd, `sp-${item.id ?? idx}`)}>{ic ? "✓" : "Copy"}</button>
                    <button className="act" style={{ padding: "2px 7px", marginLeft: 4 }} onClick={() => setSpawnForm({ id: item.id, name: item.name, game_id: item.game_id, category: item.category, item_type: item.item_type })}>✎</button>
                    <button className="act" style={{ padding: "2px 7px", marginLeft: 3, color: "var(--rose)" }} onClick={async () => { if (window.confirm(`Delete "${item.name}"?`)) { await deleteSpawnItem(item.id); reload(); } }}>✕</button>
                  </td>
                </tr>
              ); })}
            </tbody>
          </table>
          {spawnShown.length === 0 && <div className="empty">No items match.</div>}
        </div>
        {spawnForm && <Modal title={`${spawnForm.id ? "Edit" : "Add"} spawn item`} onClose={() => { setSpawnForm(null); setErr(""); }} onSave={saveSpawn} saveDisabled={busy || !spawnForm.name.trim()} error={err}>
          <input className="filter-inp" placeholder="Name" value={spawnForm.name} onChange={e => setSpawnForm({ ...spawnForm, name: e.target.value })} />
          <input className="filter-inp" placeholder="Game ID" value={spawnForm.game_id} onChange={e => setSpawnForm({ ...spawnForm, game_id: e.target.value })} />
          <input className="filter-inp" placeholder="Category" value={spawnForm.category} onChange={e => setSpawnForm({ ...spawnForm, category: e.target.value })} />
          <select className="filter-inp" value={spawnForm.item_type} onChange={e => setSpawnForm({ ...spawnForm, item_type: e.target.value })}>{["item", "weapon", "ammo", "component"].map(t => <option key={t} value={t}>{t}</option>)}</select>
        </Modal>}
      </>}
    </>
  );
}

/* ── NPC Ecosystem — turf grouping, TP copy, filters, map, CRUD ── */
function NPCs({ auth, npcs, turfs, reload }) {
  const isL3 = auth.level >= 3;
  const [copied, copy] = useCopy();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState(null);
  const [mapView, setMapView] = useState(false);
  const [mapTurf, setMapTurf] = useState(null);
  const [npcForm, setNpcForm] = useState(null); // {id?, name, position, type, customType?, turf}
  const [turfForm, setTurfForm] = useState(null); // {oldTurf, newTurf, power}
  const { busy, err, setErr, run } = useRun();

  const network = useMemo(() => {
    const net = {};
    turfs.forEach(t => { const nm = (t.name || "").trim(); if (!nm || nm === "Neutral" || nm === "Unaffiliated") return; net[nm] = { name: nm, power: t.shipment_power || "", npcs: [] }; });
    npcs.forEach(n => { let t = (n.turf || "").trim() || "Neutral"; if (t.toLowerCase() === "neutral") t = "Neutral"; if (!net[t]) net[t] = { name: t, power: n.shipment_power || "", npcs: [] }; net[t].npcs.push(n); });
    const q = search.toLowerCase();
    return Object.values(net).filter(t => t.name.toLowerCase().includes(q) || t.npcs.some(n => n.name.toLowerCase().includes(q) || (n.npc_type || "").toLowerCase().includes(q))).sort((a, b) => a.name === "Neutral" ? 1 : b.name === "Neutral" ? -1 : a.name.localeCompare(b.name));
  }, [npcs, turfs, search]);
  const counts = useMemo(() => npcs.reduce((a, n) => { const t = (n.npc_type || "Unknown").trim(); a[t] = (a[t] || 0) + 1; return a; }, {}), [npcs]);
  const neutralCount = npcs.filter(n => (n.turf || "").trim().toLowerCase() === "neutral").length;
  const flat = filter ? (filter === "__neutral" ? npcs.filter(n => (n.turf || "").trim().toLowerCase() === "neutral") : npcs.filter(n => (n.npc_type || "").trim().toLowerCase() === filter.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name)) : [];
  const npcTypes = [...new Set(npcs.map(n => (n.npc_type || "").trim()).filter(Boolean))].sort();
  const turfNames = [...new Set([...turfs.map(t => (t.name || "").trim()), ...npcs.map(n => (n.turf || "").trim())].filter(t => t && t !== "Neutral"))].sort();

  const saveNPC = () => { if (!npcForm.name.trim()) return; const p = { ...npcForm, type: npcForm.type === "__new" ? (npcForm.customType || "").trim() : npcForm.type, turf: npcForm.turf || "Neutral" }; run(() => npcForm.id ? editNPC(npcForm.id, p) : addNPC(p), () => { setNpcForm(null); reload(); }); };
  const saveTurf = () => { if (!turfForm.newTurf.trim()) return; run(() => updateTurf(turfForm.oldTurf, turfForm.newTurf, turfForm.power), () => { setTurfForm(null); reload(); }); };

  const NpcRow = (n) => { const ic = copied === `npc-${n.id}`; return (
    <div className="clog" key={n.id}>
      <span style={{ minWidth: 90, fontFamily: "var(--v2-mono)", fontSize: 10, textTransform: "uppercase", color: "var(--ink-3)" }}>{n.npc_type}</span>
      <span style={{ fontWeight: 600, color: "var(--ink-0)" }}>{n.name}</span>
      {filter && <span className="chip role">{n.turf}</span>}
      <span style={{ flex: 1 }} />
      <span style={{ fontFamily: "var(--v2-mono)", fontSize: 10.5, color: "var(--ink-3)" }}>{n.position}</span>
      <button className={`copybtn${ic ? " done" : ""}`} style={{ padding: "3px 9px" }} onClick={() => copy(`/tppos ${n.position}`, `npc-${n.id}`)}>{ic ? "✓" : "TP"}</button>
      {isL3 && <>
        <button className="act" style={{ padding: "2px 7px" }} onClick={() => setNpcForm({ id: n.id, name: n.name, position: n.position, type: n.npc_type, turf: n.turf || "Neutral" })}>✎</button>
        <button className="act" style={{ padding: "2px 7px", color: "var(--rose)" }} onClick={async () => { if (window.confirm(`Delete "${n.name}"?`)) { await deleteNPC(n.id); reload(); } }}>✕</button>
      </>}
    </div>
  ); };

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input className="filter-inp" style={{ maxWidth: 320 }} placeholder="Search turfs or NPCs…" value={search} onChange={e => setSearch(e.target.value)} />
        <span style={{ flex: 1 }} />
        <button className="act" onClick={() => { setMapView(!mapView); setMapTurf(null); }}>{mapView ? "📋 List" : "🗺️ Map"}</button>
        {isL3 && <button className="btn ghost" onClick={() => setTurfForm({ oldTurf: "", newTurf: "", power: "" })}>+ Turf</button>}
        {isL3 && <button className="btn" onClick={() => setNpcForm({ name: "", position: "", type: "", turf: "Neutral" })}>+ NPC</button>}
      </div>

      {mapView ? (
        <>
          <GTAMap npcs={filter ? npcs.filter(n => (n.npc_type || "").trim().toLowerCase() === filter?.toLowerCase()) : npcs} selectedTurf={mapTurf} height={500} onCopyTP={() => {}} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
            <button className={`pill${!mapTurf ? " on" : ""}`} onClick={() => setMapTurf(null)}>All NPCs</button>
            {[...new Set(npcs.map(n => (n.turf || "Neutral").trim()))].sort().map(t => <button key={t} className={`pill${mapTurf === t ? " on" : ""}`} onClick={() => setMapTurf(t)}>{t}</button>)}
          </div>
        </>
      ) : <>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          {Object.entries(counts).map(([t, n]) => <button key={t} className={`pill${filter === t ? " on" : ""}`} onClick={() => setFilter(filter === t ? null : t)}>{n} {t}</button>)}
          {neutralCount > 0 && <button className={`pill${filter === "__neutral" ? " on amber" : ""}`} onClick={() => setFilter(filter === "__neutral" ? null : "__neutral")}>{neutralCount} Neutral</button>}
        </div>
        {filter ? (
          <div className="card"><div className="hd"><div className="t">{filter === "__neutral" ? "Neutral dealers" : filter}</div><div className="meta">{flat.length}</div></div>{flat.map(NpcRow)}</div>
        ) : network.map(turf => (
          <div className="card" key={turf.name}>
            <div className="hd">
              <div className="t">{turf.name}{turf.name !== "Neutral" && <span className="chip role" style={{ marginLeft: 8 }}>PWR {turf.power || "—"}</span>}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="meta">{turf.npcs.length}</span>
                {isL3 && turf.name !== "Neutral" && <>
                  <button className="act" style={{ padding: "2px 7px" }} onClick={() => setTurfForm({ oldTurf: turf.name, newTurf: turf.name, power: turf.power })}>Edit</button>
                  <button className="act" style={{ padding: "2px 7px", color: "var(--rose)" }} onClick={async () => { if (window.confirm(`Disband "${turf.name}"?`)) { await disbandTurf(turf.name); reload(); } }}>Disband</button>
                </>}
              </div>
            </div>
            {turf.npcs.map(NpcRow)}
          </div>
        ))}
      </>}

      {npcForm && <Modal title={`${npcForm.id ? "Edit" : "Add"} NPC`} onClose={() => { setNpcForm(null); setErr(""); }} onSave={saveNPC} saveDisabled={busy || !npcForm.name.trim()} error={err}>
        <input className="filter-inp" placeholder="Name" value={npcForm.name} onChange={e => setNpcForm({ ...npcForm, name: e.target.value })} />
        <input className="filter-inp" placeholder="TP position" value={npcForm.position} onChange={e => setNpcForm({ ...npcForm, position: e.target.value })} />
        <select className="filter-inp" value={npcForm.type} onChange={e => setNpcForm({ ...npcForm, type: e.target.value })}>
          <option value="">Select type…</option>
          {npcTypes.map(t => <option key={t} value={t}>{t}</option>)}
          <option value="__new">+ New type…</option>
        </select>
        {npcForm.type === "__new" && <input className="filter-inp" placeholder="New type name" value={npcForm.customType || ""} onChange={e => setNpcForm({ ...npcForm, customType: e.target.value })} />}
        <select className="filter-inp" value={npcForm.turf} onChange={e => setNpcForm({ ...npcForm, turf: e.target.value })}>
          <option value="Neutral">Neutral</option>
          {turfNames.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </Modal>}
      {turfForm && <Modal title={`${turfForm.oldTurf ? "Edit" : "Create"} turf`} onClose={() => { setTurfForm(null); setErr(""); }} onSave={saveTurf} saveDisabled={busy || !turfForm.newTurf.trim()} error={err}>
        <input className="filter-inp" placeholder="Turf name" value={turfForm.newTurf} onChange={e => setTurfForm({ ...turfForm, newTurf: e.target.value })} />
        <input className="filter-inp" placeholder="Shipment power" value={turfForm.power} onChange={e => setTurfForm({ ...turfForm, power: e.target.value })} />
      </Modal>}
    </>
  );
}

/* ── Scene Logs (port of /fm/scenes Scene Intelligence): record outcomes + distribute rewards ── */
const BLANK_SCENE = { faction: "", cash: "", items: [], otherRewards: "", notes: "", assistants: [] };
const sceneIsBlank = (f) => !f || (
  !f.faction && !String(f.cash ?? "").trim() && (f.items?.length || 0) === 0 &&
  !String(f.otherRewards ?? "").trim() && !String(f.notes ?? "").trim() && (f.assistants?.length || 0) === 0
);

function SceneLogs({ auth }) {
  const [logs, setLogs] = useState([]);
  const [factions, setFactions] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [attention, setAttention] = useState([]);
  const [treasury, setTreasury] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showTreasury, setShowTreasury] = useState(false);
  const [form, setForm] = useState(BLANK_SCENE);
  const [hasDraft, setHasDraft] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editText, setEditText] = useState("");
  const [addingTo, setAddingTo] = useState(null);

  // Restore any scene draft saved before a reload/crash; persist while the form is open.
  useEffect(() => {
    const d = loadDraft("scenes:new");
    if (d && !sceneIsBlank(d)) { setForm(d); setHasDraft(true); }
  }, []);
  useDraft("scenes:new", form, { enabled: showForm, blank: sceneIsBlank });

  useEffect(() => {
    Promise.all([getSceneLogs(), getSceneFactionNames(), getInventoryForScene(), getStaffForScene(), getAttentionFactions(), auth.level >= 3 ? getTreasuryStats() : Promise.resolve({})])
      .then(([l, f, i, s, a, t]) => { setLogs(l || []); setFactions(f || []); setInventory(i || []); setStaffList(s || []); setAttention(a || []); setTreasury(t || {}); setLoading(false); });
  }, []);
  const refresh = async () => { setLogs(await getSceneLogs()); setAttention(await getAttentionFactions()); setInventory(await getInventoryForScene()); };

  if (loading) return <div className="empty">Loading scenes…</div>;

  const submit = async (e) => {
    e.preventDefault();
    const res = await submitScene(form);
    if (res.ok) { setShowForm(false); setForm(BLANK_SCENE); clearDraft("scenes:new"); setHasDraft(false); refresh(); }
    else window.alert("Error: " + (res.error || "Unknown"));
  };
  const toggleAssistant = (s) => setForm(f => {
    const exists = f.assistants.some(a => a.staff_id === s.discord_id);
    return { ...f, assistants: exists ? f.assistants.filter(a => a.staff_id !== s.discord_id) : [...f.assistants, { staff_id: s.discord_id, staff_name: s.display_name }] };
  });
  const addMyself = async (logId) => {
    setAddingTo(logId);
    const res = await addMyselfToScene(logId);
    setAddingTo(null);
    if (res.ok) refresh(); else window.alert(res.error || "Could not add yourself to this scene.");
  };

  const filtered = logs.filter(l => {
    const matchSearch = !search || l.faction?.toLowerCase().includes(search.toLowerCase()) || l.logged_by?.toLowerCase().includes(search.toLowerCase());
    const d = new Date(l.date);
    return matchSearch && (!dateFrom || d >= new Date(dateFrom)) && (!dateTo || d <= new Date(dateTo + "T23:59:59"));
  }).sort((a, b) => new Date(b.date) - new Date(a.date));
  const hasFilters = search || dateFrom || dateTo;
  const lbl = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--ink-3)", marginBottom: 4 };

  return (
    <>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>Record scene outcomes and distribute rewards.</span>
        <span style={{ flex: 1 }} />
        {auth.level >= 3 && <button className="act" style={{ color: "var(--amber)" }} onClick={async () => { setTreasury(await getTreasuryStats()); setShowTreasury(true); }}>Treasury</button>}
        <button className="btn" onClick={() => setShowForm(true)}>Log scene +</button>
      </div>

      {hasDraft && !showForm && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "10px 14px", borderRadius: 10, background: "var(--amber-bg)", marginBottom: 14 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--amber)" }}>You have an unsaved scene draft from a previous session.</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="act primary" onClick={() => { setShowForm(true); setHasDraft(false); }}>Resume</button>
            <button className="act" onClick={() => { clearDraft("scenes:new"); setForm(BLANK_SCENE); setHasDraft(false); }}>Discard</button>
          </div>
        </div>
      )}

      {attention.length > 0 && (
        <div className="card">
          <div className="hd"><div className="t" style={{ color: "var(--rose)" }}>Attention required</div><div className="meta">{attention.length} faction{attention.length !== 1 ? "s" : ""}</div></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 8, paddingTop: 8 }}>
            {attention.map(([fac, count], i) => (
              <div key={i} style={{ padding: "8px 12px", borderRadius: 8, background: "var(--rose-bg)" }}>
                <div style={{ fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--rose)" }}>{fac}</div>
                <div style={{ fontSize: 10, fontFamily: "var(--v2-mono)", color: "var(--rose)" }}>{count} scenes 30d</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <input className="filter-inp" style={{ flex: 1, minWidth: 180, maxWidth: 340 }} placeholder="Search by faction or staff…" value={search} onChange={e => setSearch(e.target.value)} />
        <input type="date" className="filter-inp" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="From" />
        <input type="date" className="filter-inp" value={dateTo} onChange={e => setDateTo(e.target.value)} title="To" />
        {hasFilters && <button className="act" onClick={() => { setSearch(""); setDateFrom(""); setDateTo(""); }}>Clear</button>}
        <span style={{ fontSize: 10.5, fontFamily: "var(--v2-mono)", color: "var(--ink-3)", marginLeft: "auto" }}>{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {filtered.length === 0 && <div className="empty">No scene logs match your search.</div>}
      {filtered.map(log => {
        const isAuthor = log.author_id === auth.id;
        return (
          <div key={log.id} className="card">
            <div className="hd"><div className="t" style={{ textTransform: "none", letterSpacing: 0 }}>{log.faction}</div><div className="meta">{log.date}</div></div>
            {editId === log.id ? (
              <div style={{ margin: "8px 0" }}>
                <textarea className="filter-inp" style={{ width: "100%", minHeight: 100 }} value={editText} onChange={e => setEditText(e.target.value)} />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="act primary" onClick={async () => { await editSceneNotes(editId, editText); setEditId(null); refresh(); }}>Save</button>
                  <button className="act" onClick={() => setEditId(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <p style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: "8px 0", color: "var(--ink-1)" }}>{log.notes}</p>
            )}
            <div style={{ display: "flex", gap: 18, padding: "8px 12px", borderRadius: 8, background: "var(--panel-2)", marginBottom: 8, flexWrap: "wrap" }}>
              <div><div style={lbl}>Staff</div><div style={{ fontSize: 12, fontWeight: 600 }}>{log.logged_by}</div></div>
              {log.assistants?.length > 0 && (
                <div><div style={lbl}>Also present</div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {log.assistants.map(a => (
                      <span key={a.id} className="chip role" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10 }}>
                        {a.staff_name}
                        {auth.level >= 2 && <button style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 11, lineHeight: 1, padding: 0 }} title="Remove"
                          onClick={async () => { if (window.confirm(`Remove ${a.staff_name} from this scene?`)) { await removeAssistantFromScene(a.id); refresh(); } }}>✕</button>}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div><div style={lbl}>Rewards</div><div style={{ fontSize: 12, fontFamily: "var(--v2-mono)", color: "var(--good)" }}>{log.rewards}</div></div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 6, borderTop: "1px solid var(--line)" }}>
              <div style={{ display: "flex", gap: 6 }}>
                {isAuthor && editId !== log.id && <button className="act" onClick={() => { setEditId(log.id); setEditText(log.notes); }}>Edit</button>}
                {isAuthor && <button className="act" style={{ color: "var(--amber)" }} onClick={async () => { if (window.confirm("Request deletion?")) { await requestSceneDeletion(log.id, log.notes); window.alert("Deletion requested."); } }}>Req. delete</button>}
                {!isAuthor && !log.assistants?.some(a => a.staff_id === auth.id) && (
                  <button className="act good" disabled={addingTo === log.id} onClick={() => addMyself(log.id)}>{addingTo === log.id ? "Adding…" : "+ Add myself"}</button>
                )}
              </div>
              {auth.level >= 3 && <button className="act" style={{ color: "var(--rose)" }} onClick={async () => { if (window.confirm("L3 DELETE: Permanently remove this scene log?")) { await deleteScene(log.id); refresh(); } }}>L3 delete</button>}
            </div>
          </div>
        );
      })}

      {showForm && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={() => setShowForm(false)} />
          <form onSubmit={submit} style={{ position: "relative", width: "100%", maxWidth: 720, maxHeight: "90vh", background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 12, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
              <span style={{ fontWeight: 700, color: "var(--ink-0)" }}>Log scene</span>
              <button type="button" className="act" style={{ padding: "2px 8px" }} onClick={() => setShowForm(false)}>✕</button>
            </div>
            <div style={{ padding: 18, overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
              <div><div style={lbl}>Target faction</div>
                <select required className="filter-inp" style={{ width: "100%" }} value={form.faction} onChange={e => setForm({ ...form, faction: e.target.value })}>
                  <option value="">Select…</option>
                  {factions.map(f => <option key={f} value={f}>{f}</option>)}
                </select></div>
              <div style={{ padding: 14, borderRadius: 10, background: "var(--panel-2)", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 6, borderBottom: "1px solid var(--line)" }}>
                  <span style={lbl}>Rewards & inventory</span>
                  <button type="button" className="act" style={{ padding: "2px 8px" }} onClick={() => setForm({ ...form, items: [...form.items, { name: "", qty: 1 }] })}>+ Add item</button>
                </div>
                <div><div style={lbl}>Cash reward ($)</div><input type="number" className="filter-inp" style={{ width: "100%" }} value={form.cash} onChange={e => setForm({ ...form, cash: e.target.value })} /></div>
                {form.items.map((item, idx) => (
                  <div key={idx} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                    <div style={{ flex: 1 }}><div style={lbl}>Item</div>
                      <input list={`v2inv-${idx}`} className="filter-inp" style={{ width: "100%" }} placeholder="Type to search…" value={item.name}
                        onChange={e => { const n = [...form.items]; n[idx] = { ...n[idx], name: e.target.value }; setForm({ ...form, items: n }); }} />
                      <datalist id={`v2inv-${idx}`}>{inventory.map((inv, i) => <option key={i} value={inv.name}>{`Stock: ${inv.current_stock}`}</option>)}</datalist>
                    </div>
                    <div style={{ width: 80 }}><div style={lbl}>Qty</div><input type="number" min="1" className="filter-inp" style={{ width: "100%", textAlign: "center" }} value={item.qty}
                      onChange={e => { const n = [...form.items]; n[idx] = { ...n[idx], qty: e.target.value }; setForm({ ...form, items: n }); }} /></div>
                    <button type="button" className="act" style={{ color: "var(--rose)" }} onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) })}>✕</button>
                  </div>
                ))}
                <div><div style={lbl}>Other rewards</div><input className="filter-inp" style={{ width: "100%" }} placeholder="e.g. 1x Declasse Tulip" value={form.otherRewards} onChange={e => setForm({ ...form, otherRewards: e.target.value })} /></div>
              </div>
              <div>
                <div style={{ ...lbl, display: "flex", justifyContent: "space-between" }}>
                  <span>Also present (optional)</span>
                  {form.assistants.length > 0 && <span style={{ color: "var(--accent)", textTransform: "none", letterSpacing: 0 }}>{form.assistants.length} selected</span>}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel-2)", maxHeight: 120, overflowY: "auto" }}>
                  {staffList.filter(s => s.discord_id !== auth.id).map(s => {
                    const sel = form.assistants.some(a => a.staff_id === s.discord_id);
                    return (
                      <button key={s.discord_id} type="button" className="pill" style={sel ? { background: "var(--accent-bg)", color: "var(--accent)", borderColor: "var(--accent)" } : {}} onClick={() => toggleAssistant(s)}>
                        {sel ? "✓ " : ""}{s.display_name}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div><div style={lbl}>Notes</div><textarea required rows={5} className="filter-inp" style={{ width: "100%", minHeight: 110 }} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <div style={{ padding: "12px 18px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
              <span style={{ fontSize: 10, fontFamily: "var(--v2-mono)", color: "var(--ink-3)" }}>● {auth.name} · draft auto-saved</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="act" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="act primary">Submit scene</button>
              </div>
            </div>
          </form>
        </div>
      )}

      {showTreasury && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={() => setShowTreasury(false)} />
          <div style={{ position: "relative", width: "100%", maxWidth: 720, maxHeight: "85vh", background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 12, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
              <span style={{ fontWeight: 700, color: "var(--ink-0)" }}>Treasury & distribution</span>
              <button className="act" style={{ padding: "2px 8px" }} onClick={() => setShowTreasury(false)}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
              {Object.entries(treasury).sort((a, b) => b[1].cash - a[1].cash).map(([name, data]) => (
                <div key={name} style={{ padding: 12, borderRadius: 10, background: "var(--panel-2)", display: "flex", gap: 14, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 160 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{name}</div>
                    <div style={{ fontSize: 17, fontFamily: "var(--v2-mono)", color: "var(--good)" }}>${data.cash.toLocaleString()}</div>
                  </div>
                  <div style={{ flex: 1, display: "flex", flexWrap: "wrap", gap: 5, alignContent: "flex-start" }}>
                    {Object.entries(data.items).sort((a, b) => b[1] - a[1]).map(([item, qty]) => (
                      <span key={item} className="chip role"><b style={{ color: "var(--accent)" }}>{qty}x</b>&nbsp;{item}</span>
                    ))}
                    {Object.keys(data.items).length === 0 && <span style={{ fontSize: 10.5, fontStyle: "italic", color: "var(--ink-3)" }}>No items distributed</span>}
                  </div>
                </div>
              ))}
              {Object.keys(treasury).length === 0 && <div className="empty">No distribution data.</div>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
