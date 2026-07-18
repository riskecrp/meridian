"use client";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../lib/useAuth";
import {
  getLoreEntries, getCommandEntries, addKBEntry, editKBEntry, deleteKBEntry,
  getChangeLogs, addChangeLog, editChangeLog, deleteChangeLog,
  getSceneLibrary, getLoadouts, getNPCs, getTurfs,
} from "../../fm/storytelling/actions.js";

function useCopy() {
  const [copied, setCopied] = useState(null);
  const copy = (text, id) => { navigator.clipboard?.writeText(text); setCopied(id); setTimeout(() => setCopied(null), 1500); };
  return [copied, copy];
}

export default function V2Story() {
  const auth = useAuth();
  const level = auth?.level || 0;
  const isET = auth?.isEventTeam;
  const canNPC = level >= 2 || isET || auth?.isLeadStoryteller;
  const canMgmt = level >= 3 || isET;

  const [tab, setTab] = useState("kb");
  const [data, setData] = useState({});
  const [loaded, setLoaded] = useState({});
  const [busy, setBusy] = useState(false);

  const loaders = {
    kb: async () => ({ lore: await getLoreEntries().catch(() => []), command: canMgmt ? await getCommandEntries().catch(() => []) : [] }),
    changelog: () => getChangeLogs().catch(() => []),
    scenes: () => getSceneLibrary().catch(() => []),
    arsenal: () => getLoadouts().catch(() => []),
    npcs: async () => ({ npcs: await getNPCs().catch(() => []), turfs: await getTurfs().catch(() => []) }),
  };
  const ensure = async (t) => {
    if (loaded[t]) return;
    setBusy(true);
    const rows = await loaders[t]();
    setData(d => ({ ...d, [t]: rows })); setLoaded(l => ({ ...l, [t]: true })); setBusy(false);
  };
  const reload = async (t) => { const rows = await loaders[t](); setData(d => ({ ...d, [t]: rows })); };

  useEffect(() => { if (!auth?.loading && auth?.id) ensure("kb"); }, [auth?.id, auth?.loading]);
  useEffect(() => { if (!auth?.loading && auth?.id) ensure(tab); }, [tab]);

  if (auth?.loading) return <div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>;
  if (!auth?.ok) return <div className="view" style={{ color: "var(--ink-3)" }}>Not authorized.</div>;

  const TABS = [
    { id: "kb", label: "Knowledge Base" },
    { id: "scenes", label: "Scene Library" },
    { id: "arsenal", label: "Arsenal" },
    ...(canNPC ? [{ id: "npcs", label: "NPC Ecosystem" }] : []),
    { id: "changelog", label: "Change Log" },
  ];

  return (
    <div className="view">
      <div className="page-head">
        <div>
          <p className="eyebrow">Storytelling</p>
          <h1>Reference library</h1>
          <div className="sub">Lore, scenes, arsenal and the world — the material you consult and copy while running the server.</div>
        </div>
      </div>
      <div className="hub-tabs">
        {TABS.map(t => <button key={t.id} className={`hub-tab${tab === t.id ? " on" : ""}`} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      {busy && !loaded[tab] && <div className="empty">Loading…</div>}

      {tab === "kb" && loaded.kb && <KB auth={auth} canMgmt={canMgmt} lore={data.kb.lore} cmds={data.kb.command} reload={() => reload("kb")} />}
      {tab === "changelog" && loaded.changelog && <ChangeLog auth={auth} rows={data.changelog} reload={() => reload("changelog")} />}
      {tab === "scenes" && loaded.scenes && <Scenes rows={data.scenes} />}
      {tab === "arsenal" && loaded.arsenal && <Arsenal rows={data.arsenal} />}
      {tab === "npcs" && loaded.npcs && <NPCs auth={auth} npcs={data.npcs.npcs} turfs={data.npcs.turfs} />}
    </div>
  );
}

/* ── Knowledge Base — copy, favorites, filters, CRUD ── */
function KB({ auth, canMgmt, lore, cmds, reload }) {
  const canEdit = auth.level >= 2 || auth.isEventTeam;
  const [copied, copy] = useCopy();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState(null); // null=all, cat, '__fav', '__mgmt'
  const [favs, setFavs] = useState([]);
  const [form, setForm] = useState(null); // { id?, type, category, title, content, notes }

  useEffect(() => { try { setFavs(JSON.parse(localStorage.getItem("meridian_kb_favs_" + auth.id) || "[]")); } catch {} }, [auth.id]);
  const toggleFav = (uid) => { const next = favs.includes(uid) ? favs.filter(f => f !== uid) : [...favs, uid]; setFavs(next); localStorage.setItem("meridian_kb_favs_" + auth.id, JSON.stringify(next)); };

  const allItems = useMemo(() => [
    ...lore.map(i => ({ ...i, dtype: "lore", uid: `l-${i.id}` })),
    ...(canMgmt ? cmds.map(i => ({ ...i, dtype: "command", uid: `c-${i.id}` })) : []),
  ], [lore, cmds, canMgmt]);
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

  const save = async () => {
    if (!form.title.trim()) return;
    if (form.id) await editKBEntry(form.id, form); else await addKBEntry(form, form.type);
    setForm(null); reload();
  };

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
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {item.category && <span className="chip role">{item.category}</span>}
                    {isCmd && <span className="chip lock" style={{ background: "var(--good-bg)", color: "var(--good)" }}>MGMT</span>}
                  </div>
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
      {form && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={() => setForm(null)} />
          <div style={{ position: "relative", width: "100%", maxWidth: 520, background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 12, padding: 18 }}>
            <div style={{ fontWeight: 700, color: "var(--ink-0)", marginBottom: 14 }}>{form.id ? "Edit" : "Add"} {form.type === "command" ? "Management" : "KB"} entry</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input className="filter-inp" placeholder="Category" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} />
              <input className="filter-inp" placeholder="Title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
              <textarea className="filter-inp" rows={4} placeholder="Content (the value that gets copied)" value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} />
              <input className="filter-inp" placeholder="Notes (optional)" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button className="act" onClick={() => setForm(null)}>Cancel</button>
              <button className="act primary" disabled={!form.title.trim()} onClick={save}>Save</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ── Change Log — typed entries (doctors/drops) + CRUD ── */
function ChangeLog({ auth, rows, reload }) {
  const isL3 = auth.level >= 3;
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(null); // { id?, change_type, name, position, action, blocked_off, notes }

  const shown = rows.filter(c => filter === "all" || c.change_type === filter)
    .filter(c => !search || [c.name, c.position, c.notes].some(x => (x || "").toLowerCase().includes(search.toLowerCase())));

  const save = async () => {
    if (!form.name.trim()) return;
    const payload = { name: form.name, position: form.position, changeType: form.change_type, action: form.action, blockedOff: form.blocked_off, notes: form.notes };
    if (form.id) await editChangeLog(form.id, payload); else await addChangeLog(payload);
    setForm(null); reload();
  };

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <input className="filter-inp" style={{ flex: 1, minWidth: 200 }} placeholder="Search by name or location…" value={search} onChange={e => setSearch(e.target.value)} />
        {[["all", "All"], ["black_market_doctor", "Doctors"], ["drop_location", "Drops"]].map(([v, l]) =>
          <button key={v} className={`pill${filter === v ? " on" : ""}`} onClick={() => setFilter(v)}>{l}</button>)}
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
      {form && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={() => setForm(null)} />
          <div style={{ position: "relative", width: "100%", maxWidth: 460, background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 12, padding: 18 }}>
            <div style={{ fontWeight: 700, color: "var(--ink-0)", marginBottom: 14 }}>{form.id ? "Edit" : "New"} change-log entry</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <select className="filter-inp" value={form.change_type} onChange={e => setForm({ ...form, change_type: e.target.value })}>
                <option value="black_market_doctor">Black Market Doctor</option>
                <option value="drop_location">Drop Location</option>
              </select>
              <input className="filter-inp" placeholder="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              <input className="filter-inp" placeholder="/tppos location" value={form.position} onChange={e => setForm({ ...form, position: e.target.value })} />
              {form.change_type === "black_market_doctor" && <>
                <select className="filter-inp" value={form.action} onChange={e => setForm({ ...form, action: e.target.value })}>
                  {["Added", "Moved", "Removed"].map(a => <option key={a} value={a}>{a}</option>)}
                </select>
                {form.action === "Removed" && <label style={{ fontSize: 12.5, display: "flex", gap: 8, alignItems: "center", color: "var(--ink-1)" }}><input type="checkbox" checked={form.blocked_off} onChange={e => setForm({ ...form, blocked_off: e.target.checked })} /> Location blocked off?</label>}
                <input className="filter-inp" placeholder="Notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
              </>}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button className="act" onClick={() => setForm(null)}>Cancel</button>
              <button className="act primary" disabled={!form.name.trim()} onClick={save}>Save</button>
            </div>
          </div>
        </div>
      )}
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
              {s.status && <span className="chip role">{s.status}</span>}
              {s.category && <span className="chip role">{s.category}</span>}
              {s.proposed_rewards && <span className="chip lock">{s.proposed_rewards}</span>}
            </div>
            <div style={{ whiteSpace: "pre-wrap", color: "var(--ink-1)" }}>{s.description}</div>
            {(s.staff_required || s.spawning_required || s.ped_required) && <div className="by">{[s.staff_required && `Staff: ${s.staff_required}`, s.spawning_required && `Spawning: ${s.spawning_required}`, s.ped_required && `Peds: ${s.ped_required}`].filter(Boolean).join(" · ")}</div>}
          </div>
        ))}
      </div>
    </>
  );
}

/* ── Arsenal — loadouts w/ ammo+attachment compat, copy ── */
function Arsenal({ rows }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState(null);
  const [exp, setExp] = useState(null);
  const cats = [...new Set(rows.map(w => w.weapon_category))].filter(Boolean).sort();
  const shown = rows.filter(w => !cat || w.weapon_category === cat)
    .filter(w => !q || [w.weapon_name, w.caliber].some(x => (x || "").toLowerCase().includes(q.toLowerCase())) || (w.ammo || []).some(a => a.ammo_name.toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <input className="filter-inp" placeholder="Search weapon, caliber, ammo…" value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 12, maxWidth: 380 }} />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        <button className={`pill${!cat ? " on" : ""}`} onClick={() => setCat(null)}>All</button>
        {cats.map(c => <button key={c} className={`pill${cat === c ? " on" : ""}`} onClick={() => setCat(cat === c ? null : c)}>{c}</button>)}
      </div>
      <div className="card">
        {shown.length === 0 ? <div className="empty">No weapons.</div> : shown.map(w => (
          <div key={w.id} style={{ borderBottom: "1px solid var(--line)" }}>
            <div className="row" onClick={() => setExp(exp === w.id ? null : w.id)}>
              <span className="desc">{w.weapon_name}</span>
              {w.caliber && <span className="chip role">{w.caliber}</span>}
              <span className="chip due">{(w.ammo || []).length} ammo · {(w.attachments || []).length} att</span>
              <span className="caret">▼</span>
            </div>
            {exp === w.id && (
              <div className="task-detail">
                <div style={{ fontFamily: "var(--v2-mono)", fontSize: 10, color: "var(--ink-3)", marginBottom: 5 }}>AMMO</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
                  {(w.ammo || []).length ? w.ammo.map(a => <span key={a.id} className="chip role">{a.ammo_name}{a.ammo_type ? ` · ${a.ammo_type}` : ""}</span>) : <span style={{ color: "var(--ink-3)", fontSize: 12 }}>None listed</span>}
                </div>
                <div style={{ fontFamily: "var(--v2-mono)", fontSize: 10, color: "var(--ink-3)", marginBottom: 5 }}>ATTACHMENTS</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {(w.attachments || []).length ? w.attachments.map(a => <span key={a.id} className="chip role">{a.attachment_name}</span>) : <span style={{ color: "var(--ink-3)", fontSize: 12 }}>None listed</span>}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="disclaimer">Weapon/ammo/attachment editing &amp; spawn commands (L3) — porting next.</div>
    </>
  );
}

/* ── NPC Ecosystem — turf grouping, type filters, TP copy ── */
function NPCs({ auth, npcs, turfs }) {
  const [copied, copy] = useCopy();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState(null); // type | '__neutral' | null

  const network = useMemo(() => {
    const net = {};
    turfs.forEach(t => { const nm = (t.name || "").trim(); if (!nm || nm === "Neutral" || nm === "Unaffiliated") return; net[nm] = { name: nm, power: t.shipment_power || "", npcs: [] }; });
    npcs.forEach(n => { let t = (n.turf || "").trim() || "Neutral"; if (t.toLowerCase() === "neutral") t = "Neutral"; if (!net[t]) net[t] = { name: t, power: n.shipment_power || "", npcs: [] }; net[t].npcs.push(n); });
    const q = search.toLowerCase();
    return Object.values(net).filter(t => t.name.toLowerCase().includes(q) || t.npcs.some(n => n.name.toLowerCase().includes(q) || (n.npc_type || "").toLowerCase().includes(q)))
      .sort((a, b) => a.name === "Neutral" ? 1 : b.name === "Neutral" ? -1 : a.name.localeCompare(b.name));
  }, [npcs, turfs, search]);
  const counts = useMemo(() => npcs.reduce((a, n) => { const t = (n.npc_type || "Unknown").trim(); a[t] = (a[t] || 0) + 1; return a; }, {}), [npcs]);
  const neutralCount = npcs.filter(n => (n.turf || "").trim().toLowerCase() === "neutral").length;
  const flat = filter ? (filter === "__neutral" ? npcs.filter(n => (n.turf || "").trim().toLowerCase() === "neutral") : npcs.filter(n => (n.npc_type || "").trim().toLowerCase() === filter.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name)) : [];

  const NpcRow = (n) => {
    const ic = copied === `npc-${n.id}`;
    return (
      <div className="clog" key={n.id}>
        <span style={{ minWidth: 90, fontFamily: "var(--v2-mono)", fontSize: 10, textTransform: "uppercase", color: "var(--ink-3)" }}>{n.npc_type}</span>
        <span style={{ fontWeight: 600, color: "var(--ink-0)" }}>{n.name}</span>
        {filter && <span className="chip role">{n.turf}</span>}
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--v2-mono)", fontSize: 10.5, color: "var(--ink-3)" }}>{n.position}</span>
        <button className={`copybtn${ic ? " done" : ""}`} style={{ padding: "3px 9px" }} onClick={() => copy(`/tppos ${n.position}`, `npc-${n.id}`)}>{ic ? "✓" : "TP"}</button>
      </div>
    );
  };

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <input className="filter-inp" style={{ maxWidth: 350 }} placeholder="Search turfs or NPCs…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {Object.entries(counts).map(([t, n]) => <button key={t} className={`pill${filter === t ? " on" : ""}`} onClick={() => setFilter(filter === t ? null : t)}>{n} {t}</button>)}
        {neutralCount > 0 && <button className={`pill${filter === "__neutral" ? " on amber" : ""}`} onClick={() => setFilter(filter === "__neutral" ? null : "__neutral")}>{neutralCount} Neutral</button>}
      </div>
      {filter ? (
        <div className="card">
          <div className="hd"><div className="t">{filter === "__neutral" ? "Neutral dealers" : filter}</div><div className="meta">{flat.length}</div></div>
          {flat.map(NpcRow)}
        </div>
      ) : network.map(turf => (
        <div className="card" key={turf.name}>
          <div className="hd">
            <div className="t">{turf.name}{turf.name !== "Neutral" && <span className="chip role" style={{ marginLeft: 8 }}>PWR {turf.power || "—"}</span>}</div>
            <div className="meta">{turf.npcs.length}</div>
          </div>
          {turf.npcs.map(NpcRow)}
        </div>
      ))}
      {auth.level >= 3 && <div className="disclaimer">NPC/turf editing &amp; the interactive map — porting next.</div>}
    </>
  );
}
