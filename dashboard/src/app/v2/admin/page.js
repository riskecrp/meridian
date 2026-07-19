"use client";
import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../lib/useAuth";
import { getAuditLog, deleteAuditLogEntry, getArchivedFactions, restoreFaction } from "../../fm/operations/actions.js";
import { getInventory, addInventoryItem, updateStock, deleteInventoryItem, getDistributionStats } from "../../fm/inventory/actions.js";
import { getLinks, saveLinks, publishLinks } from "../../fm/operations/links/actions.js";
import { listCatalog, createCatalogEntry, updateCatalogEntry, deleteCatalogEntry, listFactionsForAdd, addCatalogVehicleToFaction } from "../../fm/operations/vehicles/actions.js";
import { getGlobalImports, addImportItem, editImportItem, deleteImportItem } from "../../fm/operations/actions.js";

// access: "l2" = viewable by L2 / Event Team / Lead Storyteller (matches old /fm nav minView:2 + lst), default = L3/ET only
const GROUPS = [
  { id: "people", label: "People", items: [["staff", "Staff & Teams", true], ["hours", "FM Hours", true], ["dbaccess", "DB Access", true]] },
  { id: "catalogs", label: "Catalogs", items: [["inventory", "Inventory", false, "l2"], ["vehicles", "Vehicle Catalog", false, "l2"], ["imports", "Import Catalog", false, "l2"]] },
  { id: "config", label: "Config", items: [["links", "Important Links", false], ["reminders", "Recurring Reminders", true], ["docs", "Documents", true], ["channels", "Faction Channels", true]] },
  { id: "records", label: "Records", items: [["audit", "Audit Log", false], ["archive", "Archive", false], ["memberlog", "Member Log", true], ["convos", "Conversations", true]] },
];

export default function V2Admin() {
  const auth = useAuth();
  const isL3 = (auth?.level || 0) >= 3 || auth?.isEventTeam;
  const canL2 = (auth?.level || 0) >= 2 || auth?.isEventTeam || auth?.isLeadStoryteller;
  const canEditCatalogs = (auth?.level || 0) >= 3 || auth?.isEventTeam;
  const [group, setGroup] = useState(null);
  const [view, setView] = useState(null);

  if (auth?.loading) return <div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>;

  const visible = GROUPS.map(g => ({ ...g, items: g.items.filter(it => it[3] === "l2" ? canL2 : isL3) })).filter(g => g.items.length);
  if (!auth?.ok || !visible.length) return <div className="view" style={{ color: "var(--ink-3)" }}>Team Lead (L2) access required.</div>;

  const activeGroup = visible.find(g => g.id === group) || visible.find(g => g.id === "records") || visible[0];
  const activeItem = activeGroup.items.find(i => i[0] === view) || activeGroup.items[0];
  const [viewId, , soon] = activeItem;

  return (
    <div className="view">
      <div className="page-head"><div><p className="eyebrow">Admin</p><h1>Administration</h1><div className="sub">People, catalogs, configuration and records.</div></div></div>
      <div className="hub-tabs">
        {visible.map(g => <button key={g.id} className={`hub-tab${activeGroup.id === g.id ? " on" : ""}`} onClick={() => { setGroup(g.id); setView(g.items[0][0]); }}>{g.label}</button>)}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
        {activeGroup.items.map(([id, label, isSoon]) => (
          <button key={id} className={`pill${viewId === id ? " on" : ""}`} onClick={() => setView(id)}>{label}{isSoon && <span className="ct">soon</span>}</button>
        ))}
      </div>

      {soon ? <div className="empty">“{activeItem[1]}” — porting in the fine-tune pass. Still live at the old dashboard meanwhile.</div>
        : viewId === "audit" ? <Audit />
        : viewId === "archive" ? <Archive />
        : viewId === "inventory" ? <Inventory auth={auth} />
        : viewId === "vehicles" ? <Vehicles canEdit={canEditCatalogs} />
        : viewId === "imports" ? <Imports canEdit={canEditCatalogs} />
        : viewId === "links" ? <Links />
        : null}
    </div>
  );
}

/* ── Audit Log ── */
function Audit() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const load = () => getAuditLog(200).then(r => { setRows(r || []); setLoading(false); });
  useEffect(() => { load(); }, []);
  if (loading) return <div className="empty">Loading…</div>;
  const shown = rows.filter(l => !q || [l.actor_name, l.action, l.target_type, l.target_label, l.details].some(x => (x || "").toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <input className="filter-inp" placeholder="Search actor, action, target…" value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 14, maxWidth: 340 }} />
      <div className="card"><div style={{ overflowX: "auto" }}>
        <table className="dtable" style={{ minWidth: 720 }}>
          <thead><tr><th>Timestamp</th><th>Action</th><th>Target</th><th>Details</th><th>Actor</th><th></th></tr></thead>
          <tbody>
            {shown.map(l => (
              <tr key={l.id}>
                <td style={{ fontFamily: "var(--v2-mono)", fontSize: 10.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{l.timestamp}</td>
                <td style={{ fontWeight: 700, whiteSpace: "nowrap", color: (l.action.includes("DELETE") || l.action === "REJECT") ? "var(--rose)" : l.action.includes("CREATE") ? "var(--good)" : "var(--accent)" }}>{l.action}</td>
                <td style={{ color: "var(--ink-2)", whiteSpace: "nowrap" }}>{l.target_type}</td>
                <td style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.target_label || l.details}</td>
                <td style={{ color: "var(--ink-3)", whiteSpace: "nowrap" }}>{l.actor_name}</td>
                <td><button className="act" style={{ padding: "2px 7px", color: "var(--rose)" }} onClick={async () => { if (window.confirm("Delete this audit entry?")) { await deleteAuditLogEntry(l.id); load(); } }}>Del</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div></div>
    </>
  );
}

/* ── Archive ── */
function Archive() {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState("");
  const [exp, setExp] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async () => { setBusy(true); const r = await getArchivedFactions().catch(() => []); setRows(r || []); setBusy(false); };
  const shown = (rows || []).filter(f => !q || [f.name, f.leadName].some(x => (x || "").toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
        <input className="filter-inp" placeholder="Search archived factions…" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 320 }} />
        {rows === null && <button className="btn" disabled={busy} onClick={load}>{busy ? "Loading…" : "Load archive"}</button>}
      </div>
      {rows === null ? <div className="empty">Click “Load archive” to view historical factions.</div>
        : shown.length === 0 ? <div className="empty">No archived factions.</div> : (
          <div className="card">
            {shown.map(f => {
              const open = exp === f.id;
              return (
                <div key={f.id} style={{ borderBottom: "1px solid var(--line)" }}>
                  <div className="row" onClick={() => setExp(open ? null : f.id)}>
                    <span className="chip" style={{ background: "var(--rose-bg)", color: "var(--rose)" }}>ARCHIVED</span>
                    <span className="desc">{f.name}</span>
                    <span className="tier lo">T{f.tier}</span>
                    <span style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--v2-mono)" }}>{f.memberCount}m · {f.sceneCount}sc · {f.archived_at?.slice(0, 10)}</span>
                    <button className="act good" style={{ padding: "2px 8px" }} onClick={async e => { e.stopPropagation(); if (window.confirm(`Restore "${f.name}"?`)) { await restoreFaction(f.id); load(); } }}>Restore</button>
                    <span className="caret">▼</span>
                  </div>
                  {open && (
                    <div className="task-detail">
                      <div className="kv" style={{ paddingTop: 0 }}>
                        <div><div className="k">Last team</div><div className="v">{f.teamName || "—"}</div></div>
                        <div><div className="k">Last lead</div><div className="v">{f.leadName || "—"}</div></div>
                        <div><div className="k">Final tier</div><div className="v">T{f.tier}</div></div>
                      </div>
                      {f.members?.length > 0 && <><div className="imp-grp">Known command ({f.members.length})</div><div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>{f.members.map((m, i) => <span key={i} className="chip role">{m.is_leader ? "👑 " : ""}{m.character_name}</span>)}</div></>}
                      {f.properties?.length > 0 && <><div className="imp-grp">Properties</div><div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>{f.properties.map((p, i) => <span key={i} className="chip role">{p.is_hq ? "🏰 " : "📍 "}{p.address}</span>)}</div></>}
                      {f.imports?.length > 0 && <><div className="imp-grp">Authorized imports ({f.imports.length})</div><div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>{f.imports.map((im, i) => <span key={i} className="chip role">T{im.tier} {im.name}</span>)}</div></>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
    </>
  );
}

/* ── Inventory ── */
function Inventory({ auth }) {
  const isL3 = auth.level >= 3;
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("stock");
  const [add, setAdd] = useState(null);
  const load = () => getInventory().then(i => { setItems(i || []); setLoading(false); });
  useEffect(() => { Promise.all([getInventory(), isL3 ? getDistributionStats() : Promise.resolve({})]).then(([i, s]) => { setItems(i || []); setStats(s || {}); setLoading(false); }); }, []);
  if (loading) return <div className="empty">Loading…</div>;
  const critical = items.filter(i => i.current_stock <= i.threshold && i.purchaseable === 0);
  const cats = items.reduce((a, i) => { (a[i.category] = a[i.category] || []).push(i); return a; }, {});
  const adjust = async (i) => { const v = window.prompt(`Set stock for ${i.name}:`, i.current_stock); if (v !== null && !isNaN(parseInt(v))) { await updateStock(i.id, parseInt(v)); load(); } };
  const saveAdd = async () => { if (!add.name.trim()) return; await addInventoryItem({ name: add.name, category: add.category, stock: parseInt(add.stock) || 0, threshold: parseInt(add.threshold) || 0, purchaseable: add.purchaseable }); setAdd(null); load(); };
  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
        {isL3 && <div className="sub-tabs" style={{ padding: 0 }}><button className={`tab${tab === "stock" ? " on" : ""}`} onClick={() => setTab("stock")}>Stock</button><button className={`tab${tab === "analytics" ? " on" : ""}`} onClick={() => setTab("analytics")}>Analytics</button></div>}
        <span style={{ flex: 1 }} />
        {isL3 && <button className="btn" onClick={() => setAdd({ name: "", category: "", stock: "", threshold: "", purchaseable: true })}>Register +</button>}
      </div>
      {tab === "stock" ? <>
        {critical.length > 0 && <div className="card"><div className="hd"><div className="t" style={{ color: "var(--rose)" }}>Active shortages</div><div className="meta">{critical.length}</div></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 6, paddingTop: 8 }}>
            {critical.map(i => <div key={i.id} onClick={() => isL3 && adjust(i)} style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", borderRadius: 8, background: "var(--rose-bg)", cursor: isL3 ? "pointer" : "default" }}><span style={{ fontSize: 11, fontWeight: 700, color: "var(--rose)" }}>{i.name}</span><span style={{ fontFamily: "var(--v2-mono)", fontWeight: 700, color: "var(--rose)" }}>{i.current_stock}</span></div>)}
          </div>
        </div>}
        {Object.entries(cats).sort((a, b) => a[0].localeCompare(b[0])).map(([cat, list]) => (
          <div className="card" key={cat}><div className="hd"><div className="t">{cat}</div><div className="meta">{list.length}</div></div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 6, paddingTop: 6 }}>
              {list.map(i => <div key={i.id} onClick={() => isL3 && adjust(i)} style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", borderRadius: 8, background: "var(--panel-2)", cursor: isL3 ? "pointer" : "default" }}><span style={{ fontSize: 11, fontWeight: 600, color: (i.current_stock <= i.threshold && i.purchaseable === 0) ? "var(--rose)" : "var(--ink-1)" }}>{i.name}</span><span style={{ fontFamily: "var(--v2-mono)", color: "var(--good)" }}>{i.current_stock}</span></div>)}
            </div>
          </div>
        ))}
      </> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12 }}>
          {Object.entries(stats).sort((a, b) => b[1].cash - a[1].cash).map(([nm, d]) => (
            <div className="card" key={nm} style={{ padding: 14 }}>
              <div style={{ fontWeight: 700, color: "var(--ink-0)" }}>{nm}</div>
              <div style={{ fontFamily: "var(--v2-mono)", fontSize: 18, color: "var(--good)", margin: "4px 0 8px" }}>${(d.cash || 0).toLocaleString()}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>{Object.entries(d.items).sort((a, b) => b[1] - a[1]).map(([it, qty]) => <span key={it} className="chip role"><b style={{ color: "var(--accent)" }}>{qty}x</b> {it}</span>)}{Object.keys(d.items).length === 0 && <span style={{ fontSize: 11, color: "var(--ink-3)" }}>No items</span>}</div>
            </div>
          ))}
          {Object.keys(stats).length === 0 && <div className="empty">No distribution data.</div>}
        </div>
      )}
      {add && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={() => setAdd(null)} />
          <div style={{ position: "relative", width: "100%", maxWidth: 460, background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 12, padding: 18 }}>
            <div style={{ fontWeight: 700, color: "var(--ink-0)", marginBottom: 14 }}>Register item</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input className="filter-inp" placeholder="Name" value={add.name} onChange={e => setAdd({ ...add, name: e.target.value })} />
              <input className="filter-inp" placeholder="Category" value={add.category} onChange={e => setAdd({ ...add, category: e.target.value })} />
              <div style={{ display: "flex", gap: 6 }}><input className="filter-inp" placeholder="Starting stock" value={add.stock} onChange={e => setAdd({ ...add, stock: e.target.value })} /><input className="filter-inp" placeholder="Threshold" value={add.threshold} onChange={e => setAdd({ ...add, threshold: e.target.value })} /></div>
              <label style={{ fontSize: 12.5, color: "var(--ink-1)", display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={add.purchaseable} onChange={e => setAdd({ ...add, purchaseable: e.target.checked })} /> Purchasable in-store</label>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}><button className="act" onClick={() => setAdd(null)}>Cancel</button><button className="act primary" disabled={!add.name.trim()} onClick={saveAdd}>Save</button></div>
          </div>
        </div>
      )}
    </>
  );
}

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

/* ── Vehicle Catalog ── */
const V_EMPTY = { vehicle_name: "", spawn_name: "", notes: "" };
function Vehicles({ canEdit }) {
  const [rows, setRows] = useState([]);
  const [factions, setFactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(V_EMPTY);
  const [copied, setCopied] = useState(null);
  const [addTo, setAddTo] = useState(null);
  const [addFaction, setAddFaction] = useState("");
  const [addQty, setAddQty] = useState(1);
  const [busy, setBusy] = useState(false);
  // listFactionsForAdd is L3/ET-only — read-only viewers skip it so they don't trip the clearance check
  const load = () => Promise.all([listCatalog(), canEdit ? listFactionsForAdd() : Promise.resolve([])]).then(([c, f]) => { setRows(c || []); setFactions(f || []); setLoading(false); });
  useEffect(() => { load(); }, []);
  if (loading) return <div className="empty">Loading…</div>;
  const shown = rows.filter(r => !q || (r.vehicle_name || "").toLowerCase().includes(q.toLowerCase()) || (r.spawn_name || "").toLowerCase().includes(q.toLowerCase()));
  const submit = async () => {
    const res = editing ? await updateCatalogEntry(editing.id, form) : await createCatalogEntry(form);
    if (!res.ok) { window.alert(res.error || "Failed"); return; }
    setShowNew(false); setEditing(null); setForm(V_EMPTY); load();
  };
  const remove = async (r) => {
    if (!window.confirm(`Delete "${r.vehicle_name}" from the catalog?`)) return;
    const res = await deleteCatalogEntry(r.id);
    if (!res.ok) { window.alert(res.error || "Failed"); return; }
    load();
  };
  const submitAdd = async () => {
    if (!addFaction) { window.alert("Pick a faction"); return; }
    setBusy(true);
    const res = await addCatalogVehicleToFaction(addTo.id, parseInt(addFaction), parseInt(addQty));
    setBusy(false);
    if (!res.ok) { window.alert(res.error || "Failed"); return; }
    window.alert(`Added ${res.added}x "${res.vehicle}" to ${res.faction}. New total: ${res.newTotal}/${res.limits.max_total}.`);
    setAddTo(null); load();
  };
  const fields = (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <input className="filter-inp" placeholder="Display name * (e.g. Caracara)" value={form.vehicle_name} onChange={e => setForm({ ...form, vehicle_name: e.target.value })} />
      <input className="filter-inp" placeholder="Spawn name (e.g. caracara)" value={form.spawn_name} onChange={e => setForm({ ...form, spawn_name: e.target.value })} style={{ fontFamily: "var(--v2-mono)" }} />
      <textarea className="filter-inp" rows={2} placeholder="Notes (optional)" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
    </div>
  );
  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
        <input className="filter-inp" placeholder="Search by vehicle or spawn name…" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 340 }} />
        <span style={{ flex: 1 }} />
        {canEdit && <button className="btn" onClick={() => { setEditing(null); setForm(V_EMPTY); setShowNew(true); }}>New vehicle +</button>}
      </div>
      {showNew && !editing && (
        <div className="card" style={{ border: "1px solid var(--line-2)", borderRadius: 10, padding: 14, marginBottom: 14 }}>
          <div style={{ fontWeight: 700, color: "var(--ink-0)", marginBottom: 10 }}>New vehicle</div>
          {fields}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
            <button className="act" onClick={() => { setShowNew(false); setForm(V_EMPTY); }}>Cancel</button>
            <button className="act primary" disabled={!form.vehicle_name.trim()} onClick={submit}>Create</button>
          </div>
        </div>
      )}
      <div className="card"><div style={{ overflowX: "auto" }}>
        <table className="dtable" style={{ minWidth: 560 }}>
          <thead><tr><th>Name</th><th>Spawn</th><th style={{ textAlign: "right" }}>Used</th>{canEdit && <th></th>}</tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={canEdit ? 4 : 3} style={{ color: "var(--ink-3)", fontStyle: "italic", textAlign: "center" }}>No vehicles match.</td></tr>}
            {shown.map(r => (
              <React.Fragment key={r.id}>
                <tr>
                  <td style={{ fontWeight: 700 }} title={r.notes || r.vehicle_name}>{r.vehicle_name}</td>
                  <td>
                    {r.spawn_name ? (
                      <button className="act" style={{ padding: "1px 6px", fontFamily: "var(--v2-mono)", fontSize: 11, color: copied === r.id ? "var(--good)" : "var(--ink-2)" }} title="Click to copy spawn name"
                        onClick={() => { navigator.clipboard.writeText(r.spawn_name); setCopied(r.id); setTimeout(() => setCopied(null), 1500); }}>
                        {copied === r.id ? "✓ copied" : r.spawn_name}
                      </button>
                    ) : <span style={{ color: "var(--ink-3)" }}>—</span>}
                  </td>
                  <td style={{ textAlign: "right", fontFamily: "var(--v2-mono)", color: r.use_count > 0 ? "var(--ink-1)" : "var(--ink-3)" }}>{r.use_count || 0}</td>
                  {canEdit && (
                    <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                      <button className="act" style={{ padding: "2px 7px", color: "var(--accent)" }} title="Add to faction garage" onClick={() => { setAddTo(r); setAddFaction(""); setAddQty(1); }}>+ Faction</button>{" "}
                      <button className="act" style={{ padding: "2px 7px" }} onClick={() => { setShowNew(false); setEditing(r); setForm({ vehicle_name: r.vehicle_name, spawn_name: r.spawn_name || "", notes: r.notes || "" }); }}>Edit</button>{" "}
                      <button className="act" style={{ padding: "2px 7px", color: "var(--rose)" }} onClick={() => remove(r)}>×</button>
                    </td>
                  )}
                </tr>
                {editing?.id === r.id && (
                  <tr><td colSpan={4} style={{ background: "var(--panel-2)", borderLeft: "2px solid var(--accent)", padding: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", marginBottom: 8 }}>Editing #{r.id}</div>
                    {fields}
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                      <button className="act" onClick={() => { setEditing(null); setForm(V_EMPTY); }}>Cancel</button>
                      <button className="act primary" disabled={!form.vehicle_name.trim()} onClick={submit}>Save</button>
                    </div>
                  </td></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div></div>
      {addTo && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={() => !busy && setAddTo(null)} />
          <div style={{ position: "relative", width: "100%", maxWidth: 460, background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 12, padding: 18 }}>
            <div style={{ fontWeight: 700, color: "var(--ink-0)" }}>Add to faction garage</div>
            <div style={{ margin: "2px 0 14px" }}><span style={{ fontWeight: 700 }}>{addTo.vehicle_name}</span> <span style={{ fontFamily: "var(--v2-mono)", fontSize: 11, color: "var(--ink-3)" }}>{addTo.spawn_name || "(no spawn name set)"}</span></div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <select className="filter-inp" value={addFaction} onChange={e => setAddFaction(e.target.value)}>
                <option value="">Select faction…</option>
                {factions.map(f => <option key={f.id} value={f.id}>T{f.tier} · {f.name}</option>)}
              </select>
              <input className="filter-inp" type="number" min="1" max="50" value={addQty} onChange={e => setAddQty(parseInt(e.target.value) || 1)} />
              <div style={{ fontSize: 11, color: "var(--ink-3)" }}>Will be rejected if it would exceed the faction's tier limits (or override).</div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button className="act" disabled={busy} onClick={() => setAddTo(null)}>Cancel</button>
              <button className="act primary" disabled={busy || !addFaction} onClick={submitAdd}>{busy ? "Adding…" : "Add to faction"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ── Import Catalog ── */
const I_EMPTY = { name: "", category: "General", tier: "1", price: "", importTime: "", shipmentPower: "" };
function Imports({ canEdit }) {
  const [data, setData] = useState({ factions: [], items: [] });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [form, setForm] = useState(null); // {id?, ...fields} — modal for add + edit
  const [viewItem, setViewItem] = useState(null);
  const load = () => getGlobalImports().then(d => { setData(d || { factions: [], items: [] }); setLoading(false); });
  useEffect(() => { load(); }, []);
  if (loading) return <div className="empty">Loading…</div>;
  const filtered = data.items.filter(i => !q || i.name.toLowerCase().includes(q.toLowerCase()) || i.category.toLowerCase().includes(q.toLowerCase()));
  const byTier = filtered.reduce((a, i) => { const t = i.tier || "1"; (a[t] = a[t] || []).push(i); return a; }, {});
  const submit = async () => {
    if (!form.name.trim()) return;
    if (form.id) await editImportItem(form.id, form); else await addImportItem(form);
    setForm(null); load();
  };
  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
        <input className="filter-inp" placeholder="Search by item or category…" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 340 }} />
        <span style={{ flex: 1 }} />
        {canEdit && <button className="btn" onClick={() => setForm({ ...I_EMPTY })}>Add item +</button>}
      </div>
      {Object.keys(byTier).sort((a, b) => parseInt(a) - parseInt(b)).map(tier => (
        <div className="card" key={tier}>
          <div className="hd"><div className="t">Tier {tier}</div><div className="meta">{byTier[tier].length}</div></div>
          <div style={{ overflowX: "auto" }}>
            <table className="dtable" style={{ minWidth: 720 }}>
              <thead><tr><th>Item</th><th>Class</th><th>Price</th><th>Time</th><th>Power</th><th style={{ textAlign: "center" }}>Factions</th>{canEdit && <th></th>}</tr></thead>
              <tbody>
                {byTier[tier].sort((a, b) => a.category.localeCompare(b.category)).map(item => (
                  <tr key={item.id}>
                    <td style={{ fontWeight: 700 }}>{item.name}</td>
                    <td><span className="chip role" style={{ fontFamily: "var(--v2-mono)" }}>{item.category}</span></td>
                    <td style={{ fontFamily: "var(--v2-mono)", color: "var(--good)" }}>{item.price || "—"}</td>
                    <td style={{ fontFamily: "var(--v2-mono)", color: "var(--ink-2)" }}>{item.importTime || "—"}</td>
                    <td style={{ fontFamily: "var(--v2-mono)", color: "var(--accent)" }}>{item.shipmentPower || "—"}</td>
                    <td style={{ textAlign: "center" }}>
                      <button className="act" style={{ padding: "1px 8px", color: "var(--accent)", fontWeight: 700, borderBottom: "1px dotted var(--accent)" }} title="Authorized factions" onClick={() => setViewItem(item)}>{item.count}</button>
                    </td>
                    {canEdit && (
                      <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                        <button className="act" style={{ padding: "2px 7px" }} onClick={() => setForm({ id: item.id, name: item.name, category: item.category, tier: item.tier, price: item.price || "", importTime: item.importTime || "", shipmentPower: item.shipmentPower || "" })}>Edit</button>{" "}
                        <button className="act" style={{ padding: "2px 7px", color: "var(--rose)" }} onClick={async () => { if (window.confirm(`Delete "${item.name}"?`)) { await deleteImportItem(item.id); load(); } }}>Del</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {filtered.length === 0 && <div className="empty">No import items match.</div>}
      {form && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={() => setForm(null)} />
          <div style={{ position: "relative", width: "100%", maxWidth: 460, background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 12, padding: 18 }}>
            <div style={{ fontWeight: 700, color: "var(--ink-0)", marginBottom: 14 }}>{form.id ? `Edit "${form.name}"` : "Add import item"}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input className="filter-inp" placeholder="Name *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              <div style={{ display: "flex", gap: 6 }}>
                <input className="filter-inp" placeholder="Category" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} />
                <input className="filter-inp" placeholder="Tier" style={{ flex: "0 0 80px" }} value={form.tier} onChange={e => setForm({ ...form, tier: e.target.value })} />
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <input className="filter-inp" placeholder="Price (e.g. $5,000)" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} />
                <input className="filter-inp" placeholder="Import time (e.g. 48 hours)" value={form.importTime} onChange={e => setForm({ ...form, importTime: e.target.value })} />
                <input className="filter-inp" placeholder="Power (e.g. 500)" value={form.shipmentPower} onChange={e => setForm({ ...form, shipmentPower: e.target.value })} />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button className="act" onClick={() => setForm(null)}>Cancel</button>
              <button className="act primary" disabled={!form.name.trim()} onClick={submit}>{form.id ? "Save" : "Add"}</button>
            </div>
          </div>
        </div>
      )}
      {viewItem && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={() => setViewItem(null)} />
          <div style={{ position: "relative", width: "100%", maxWidth: 400, background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 12, padding: 18, maxHeight: "70vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontWeight: 700, color: "var(--ink-0)" }}>{viewItem.name}</span>
              <button className="act" style={{ padding: "2px 8px" }} onClick={() => setViewItem(null)}>✕</button>
            </div>
            <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--ink-3)", marginBottom: 8 }}>Authorized factions</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {viewItem.authorizedFactions.map(f => <span key={f} className="chip role" style={{ justifyContent: "flex-start" }}>{f}</span>)}
              {viewItem.authorizedFactions.length === 0 && <span style={{ fontSize: 12, fontStyle: "italic", color: "var(--ink-3)" }}>None assigned.</span>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
