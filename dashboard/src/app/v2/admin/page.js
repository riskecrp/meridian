"use client";
import React, { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "../../../lib/useAuth";
import { visibleAdminGroups } from "../adminNav.js";
import { getAuditLog, deleteAuditLogEntry, getArchivedFactions, restoreFaction } from "../../fm/operations/actions.js";
import { getInventory, addInventoryItem, updateStock, deleteInventoryItem, getDistributionStats } from "../../fm/inventory/actions.js";
import { getLinks, saveLinks, publishLinks } from "../../fm/operations/links/actions.js";
import { listCatalog, createCatalogEntry, updateCatalogEntry, deleteCatalogEntry, listFactionsForAdd, addCatalogVehicleToFaction } from "../../fm/operations/vehicles/actions.js";
import { getGlobalImports, addImportItem, editImportItem, deleteImportItem, getConversationStats, generateConversationSummary, getMemberSuggestions, getAvailableChannels, getBotServerConfigs, addBotServerConfig, updateBotServerConfig, deleteBotServerConfig, addBotWatchRole, deleteBotWatchRole, getMdbAccessRoles, addMdbAccessRole, deleteMdbAccessRole } from "../../fm/operations/actions.js";
import { listReminders, listChannels, getTargetOptions, createReminder, updateReminder, deleteReminder, getReminderProgress, adminCompleteInstance, forceSendRecurringReminder } from "../../fm/operations/reminders/actions.js";
import { getDocuments, createDocument, updateDocument, deleteDocument } from "../../fm/documents/actions.js";
import { getFactionNames } from "../../fm/factions/actions.js";
import QuillEditor from "../../../lib/QuillEditor";
import { getStaffList, getStaffActivity, getTeamList, getFactionAssignments, addStaff, updateStaff, createTeam, renameTeam, deleteTeam, commitAllChanges, getAllStaffCOI, getMeridianFactions, addStaffCOI, removeStaffCOI, getStaffFactions, retireStaff, promoteToLead, takeoverTeam, getDashboardAccessList, grantDashboardAccess, revokeDashboardAccess } from "../../fm/operations/staff/actions.js";
import { getFMStaffWithLinks, setCharacterLink, getFMHoursForPeriod, saveFMHours, getFMScenesForPeriod, getFMMeetingsForPeriod, postFMReport } from "../../fm/operations/fmhours/actions.js";
export default function V2AdminPage() {
  return <Suspense fallback={<div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>}><V2Admin /></Suspense>;
}

function V2Admin() {
  const auth = useAuth();
  // Section comes from the Admin nav dropdown via ?tab= (no in-page tab rows).
  const sp = useSearchParams();
  const canEditCatalogs = (auth?.level || 0) >= 3 || auth?.isEventTeam;

  if (auth?.loading) return <div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>;

  const visible = visibleAdminGroups({ level: auth?.level || 0, isET: auth?.isEventTeam, isLST: auth?.isLeadStoryteller, id: auth?.id });
  if (!auth?.ok || !visible.length) return <div className="view" style={{ color: "var(--ink-3)" }}>Team Lead (L2) access required.</div>;

  const tabParam = sp.get("tab");
  let activeGroup = visible.find(g => g.items.some(i => i[0] === tabParam));
  let viewId = tabParam;
  if (!activeGroup) {
    activeGroup = visible.find(g => g.items.some(i => i[0] === "audit")) || visible[0];
    viewId = (activeGroup.items.find(i => i[0] === "audit") || activeGroup.items[0])[0];
  }
  const viewLabel = activeGroup.items.find(i => i[0] === viewId)[1];

  return (
    <div className="view">
      <div className="page-head"><div><p className="eyebrow">Admin · {activeGroup.label}</p><h1>{viewLabel}</h1><div className="sub">Switch sections from the Admin menu in the top bar.</div></div></div>

      {viewId === "audit" ? <Audit />
        : viewId === "archive" ? <Archive />
        : viewId === "inventory" ? <Inventory auth={auth} />
        : viewId === "vehicles" ? <Vehicles canEdit={canEditCatalogs} />
        : viewId === "imports" ? <Imports canEdit={canEditCatalogs} />
        : viewId === "links" ? <Links />
        : viewId === "memberlog" ? <ServerLogs />
        : viewId === "convos" ? <Conversations />
        : viewId === "reminders" ? <RecurringReminders auth={auth} />
        : viewId === "docs" ? <DocumentsView auth={auth} />
        : viewId === "channels" ? <FactionChannels />
        : viewId === "staff" ? <StaffTeams />
        : viewId === "hours" ? <FMHours />
        : viewId === "dbaccess" ? <DbSiteAccess />
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

/* ── Server Logs (owner-only): member events / deleted / edited / keyword alerts ── */
const fmtTs = (ts) => ts ? new Date(ts + "Z").toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
function UserCell({ displayName, username, userId }) {
  if (!displayName && !username) return <span style={{ color: "var(--ink-3)", fontStyle: "italic" }}>unknown</span>;
  return (
    <div>
      <div style={{ fontWeight: 600 }}>{displayName || username}</div>
      {displayName && displayName !== username && <div style={{ color: "var(--ink-3)", fontSize: 10, fontFamily: "var(--v2-mono)" }}>@{username}</div>}
      {userId && <div style={{ color: "var(--ink-3)", fontSize: 10, fontFamily: "var(--v2-mono)" }}>{userId}</div>}
    </div>
  );
}
function LogStats({ items }) {
  return <div className="metrics" style={{ marginBottom: 14, paddingBottom: 12 }}>{items.map(({ label, value, color }) => <div className="metric" key={label}><div className="l">{label}</div><div className="v" style={color ? { color } : undefined}>{value}</div></div>)}</div>;
}
function LogFilters({ search, setSearch, guild, setGuild, guilds, children }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
      <input className="filter-inp" style={{ maxWidth: 240 }} placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
      <select className="filter-inp" style={{ maxWidth: 200 }} value={guild} onChange={e => setGuild(e.target.value)}>{guilds.map(g => <option key={g}>{g}</option>)}</select>
      {children}
    </div>
  );
}

function ServerLogs() {
  const [tab, setTab] = useState("members");
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div className="sub-tabs" style={{ padding: 0 }}>
          {[["members", "Member Events"], ["deleted", "Deleted Messages"], ["edited", "Edited Messages"], ["alerts", "⚠ Keyword Alerts"]].map(([id, l]) => (
            <button key={id} className={`tab${tab === id ? " on" : ""}`} onClick={() => setTab(id)}>{l}</button>
          ))}
        </div>
        <span style={{ fontSize: 11, color: "var(--ink-3)" }}>All servers the bot is in · visible only to you</span>
      </div>
      {tab === "members" && <MemberEvents />}
      {tab === "deleted" && <DeletedMessages />}
      {tab === "edited" && <EditedMessages />}
      {tab === "alerts" && <KeywordAlerts />}
    </>
  );
}

function MemberEvents() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [guild, setGuild] = useState("All");
  const [event, setEvent] = useState("All");
  useEffect(() => { fetch("/api/memberlog").then(r => r.ok ? r.json() : []).then(d => { setLogs(d); setLoading(false); }).catch(() => setLoading(false)); }, []);
  const guilds = useMemo(() => ["All", ...new Set(logs.map(l => l.guild_name))].sort(), [logs]);
  const filtered = useMemo(() => logs.filter(l => {
    if (guild !== "All" && l.guild_name !== guild) return false;
    if (event !== "All" && l.event !== event) return false;
    const q = search.toLowerCase();
    return !q || l.username.toLowerCase().includes(q) || l.display_name.toLowerCase().includes(q);
  }), [logs, guild, event, search]);
  return (
    <>
      <LogStats items={[{ label: "Showing", value: filtered.length }, { label: "Joins", value: filtered.filter(l => l.event === "join").length, color: "var(--good)" }, { label: "Leaves", value: filtered.filter(l => l.event === "leave").length, color: "var(--rose)" }]} />
      <LogFilters search={search} setSearch={setSearch} guild={guild} setGuild={setGuild} guilds={guilds}>
        <select className="filter-inp" style={{ maxWidth: 140 }} value={event} onChange={e => setEvent(e.target.value)}>
          <option>All</option><option value="join">Joins only</option><option value="leave">Leaves only</option>
        </select>
      </LogFilters>
      <div className="card"><div style={{ overflowX: "auto" }}>
        {loading ? <div className="empty">Loading…</div> : filtered.length === 0 ? <div className="empty">No events yet.</div> : (
          <table className="dtable" style={{ minWidth: 640 }}>
            <thead><tr><th>Event</th><th>Username</th><th>Display name</th><th>Server</th><th>Time</th></tr></thead>
            <tbody>{filtered.map(l => (
              <tr key={l.id}>
                <td><span className="chip" style={{ background: l.event === "join" ? "var(--good-bg)" : "var(--rose-bg)", color: l.event === "join" ? "var(--good)" : "var(--rose)" }}>{l.event === "join" ? "↗ JOIN" : "↙ LEAVE"}</span></td>
                <td style={{ fontFamily: "var(--v2-mono)", fontSize: 11.5 }}>{l.username}</td>
                <td style={{ color: "var(--ink-2)" }}>{l.display_name !== l.username ? l.display_name : "—"}</td>
                <td style={{ color: "var(--ink-2)", whiteSpace: "nowrap" }}>{l.guild_name}</td>
                <td style={{ fontFamily: "var(--v2-mono)", fontSize: 10.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{fmtTs(l.created_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div></div>
    </>
  );
}

function DeletedMessages() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [guild, setGuild] = useState("All");
  const [cached, setCached] = useState("All");
  useEffect(() => { fetch("/api/deletedmessages").then(r => r.ok ? r.json() : []).then(d => { setLogs(d); setLoading(false); }).catch(() => setLoading(false)); }, []);
  const guilds = useMemo(() => ["All", ...new Set(logs.map(l => l.guild_name))].sort(), [logs]);
  const filtered = useMemo(() => logs.filter(l => {
    if (guild !== "All" && l.guild_name !== guild) return false;
    if (cached === "cached" && !l.had_content) return false;
    if (cached === "uncached" && l.had_content) return false;
    const q = search.toLowerCase();
    return !q || l.author_name.toLowerCase().includes(q) || l.content.toLowerCase().includes(q) || l.channel_name.toLowerCase().includes(q);
  }), [logs, guild, cached, search]);
  return (
    <>
      <div style={{ padding: "8px 12px", borderRadius: 8, background: "var(--amber-bg)", fontSize: 12, color: "var(--amber)", marginBottom: 14 }}>⚠ Content only available for messages the bot cached since last restart.</div>
      <LogStats items={[{ label: "Showing", value: filtered.length }, { label: "With content", value: logs.filter(l => l.had_content).length, color: "var(--good)" }, { label: "No content", value: logs.filter(l => !l.had_content).length }]} />
      <LogFilters search={search} setSearch={setSearch} guild={guild} setGuild={setGuild} guilds={guilds}>
        <select className="filter-inp" style={{ maxWidth: 180 }} value={cached} onChange={e => setCached(e.target.value)}>
          <option value="All">All messages</option><option value="cached">With content</option><option value="uncached">No content</option>
        </select>
      </LogFilters>
      <div className="card"><div style={{ overflowX: "auto" }}>
        {loading ? <div className="empty">Loading…</div> : filtered.length === 0 ? <div className="empty">No deleted messages logged yet.</div> : (
          <table className="dtable" style={{ minWidth: 820 }}>
            <thead><tr><th>Author</th><th>Deleted by</th><th>Channel</th><th>Server</th><th>Content</th><th>Time</th></tr></thead>
            <tbody>{filtered.map(l => {
              const selfDel = !l.deleter_id || l.deleter_id === l.author_id;
              return (
                <tr key={l.id}>
                  <td><UserCell displayName={l.author_display_name} username={l.author_name} userId={l.author_id} /></td>
                  <td>{selfDel ? <span style={{ color: "var(--ink-3)", fontStyle: "italic", fontSize: 11 }}>Self / unknown</span> : <div><div style={{ color: "var(--rose)", fontWeight: 600 }}>{l.deleter_name}</div><div style={{ color: "var(--ink-3)", fontSize: 10, fontFamily: "var(--v2-mono)" }}>{l.deleter_id}</div></div>}</td>
                  <td style={{ color: "var(--ink-2)", whiteSpace: "nowrap" }}>#{l.channel_name || l.channel_id}</td>
                  <td style={{ color: "var(--ink-2)", whiteSpace: "nowrap" }}>{l.guild_name}</td>
                  <td style={{ maxWidth: 360 }}>{l.had_content ? <span style={{ lineHeight: 1.5, wordBreak: "break-word" }}>{l.content}</span> : <span style={{ color: "var(--ink-3)", fontStyle: "italic", fontSize: 11 }}>Not cached · ID {l.message_id}</span>}</td>
                  <td style={{ fontFamily: "var(--v2-mono)", fontSize: 10.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{fmtTs(l.created_at)}</td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div></div>
    </>
  );
}

function EditedMessages() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [guild, setGuild] = useState("All");
  useEffect(() => { fetch("/api/editedmessages").then(r => r.ok ? r.json() : []).then(d => { setLogs(d); setLoading(false); }).catch(() => setLoading(false)); }, []);
  const guilds = useMemo(() => ["All", ...new Set(logs.map(l => l.guild_name))].sort(), [logs]);
  const filtered = useMemo(() => logs.filter(l => {
    if (guild !== "All" && l.guild_name !== guild) return false;
    const q = search.toLowerCase();
    return !q || l.author_name.toLowerCase().includes(q) || l.author_display_name.toLowerCase().includes(q) || l.content_before.toLowerCase().includes(q) || l.content_after.toLowerCase().includes(q);
  }), [logs, guild, search]);
  return (
    <>
      <LogStats items={[{ label: "Showing", value: filtered.length }, { label: "Total edits", value: logs.length }, { label: "Servers", value: new Set(logs.map(l => l.guild_id)).size }]} />
      <LogFilters search={search} setSearch={setSearch} guild={guild} setGuild={setGuild} guilds={guilds} />
      <div className="card"><div style={{ overflowX: "auto" }}>
        {loading ? <div className="empty">Loading…</div> : filtered.length === 0 ? <div className="empty">No edited messages logged yet.</div> : (
          <table className="dtable" style={{ minWidth: 820 }}>
            <thead><tr><th>Author</th><th>Channel</th><th>Server</th><th>Before</th><th>After</th><th>Time</th></tr></thead>
            <tbody>{filtered.map(l => (
              <tr key={l.id}>
                <td><UserCell displayName={l.author_display_name} username={l.author_name} userId={l.author_id} /></td>
                <td style={{ color: "var(--ink-2)", whiteSpace: "nowrap" }}>#{l.channel_name || l.channel_id}</td>
                <td style={{ color: "var(--ink-2)", whiteSpace: "nowrap" }}>{l.guild_name}</td>
                <td style={{ maxWidth: 280, color: "var(--ink-3)", lineHeight: 1.5, wordBreak: "break-word" }}>{l.content_before}</td>
                <td style={{ maxWidth: 280, lineHeight: 1.5, wordBreak: "break-word" }}>{l.content_after}</td>
                <td style={{ fontFamily: "var(--v2-mono)", fontSize: 10.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{fmtTs(l.created_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div></div>
    </>
  );
}

function KeywordAlerts() {
  const [keywords, setKeywords] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loadingKw, setLoadingKw] = useState(true);
  const [loadingAl, setLoadingAl] = useState(true);
  const [newPhrase, setNewPhrase] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [guild, setGuild] = useState("All");
  const loadKeywords = () => fetch("/api/keywords").then(r => r.ok ? r.json() : []).then(d => { setKeywords(d); setLoadingKw(false); }).catch(() => setLoadingKw(false));
  const loadAlerts = () => fetch("/api/keywordalerts").then(r => r.ok ? r.json() : []).then(d => { setAlerts(d); setLoadingAl(false); }).catch(() => setLoadingAl(false));
  useEffect(() => { loadKeywords(); loadAlerts(); }, []);
  const addKeyword = async () => {
    const phrase = newPhrase.trim();
    if (!phrase) return;
    setSaving(true);
    await fetch("/api/keywords", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phrase }) });
    setNewPhrase(""); setSaving(false); loadKeywords();
  };
  const removeKeyword = async (id) => { await fetch("/api/keywords", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }); loadKeywords(); };
  const guilds = useMemo(() => ["All", ...new Set(alerts.map(a => a.guild_name))].sort(), [alerts]);
  const filtered = useMemo(() => alerts.filter(a => {
    if (guild !== "All" && a.guild_name !== guild) return false;
    const q = search.toLowerCase();
    return !q || a.keyword.toLowerCase().includes(q) || a.author_name.toLowerCase().includes(q) || a.content.toLowerCase().includes(q);
  }), [alerts, guild, search]);
  return (
    <>
      <div className="card">
        <div className="hd"><div className="t">Monitored phrases</div><div className="meta">{keywords.length} active</div></div>
        <div style={{ display: "flex", gap: 8, margin: "8px 0 10px" }}>
          <input className="filter-inp" style={{ flex: 1, maxWidth: 380 }} placeholder="Add keyword or phrase…" value={newPhrase} onChange={e => setNewPhrase(e.target.value)} onKeyDown={e => e.key === "Enter" && addKeyword()} />
          <button className="btn" disabled={saving || !newPhrase.trim()} onClick={addKeyword}>{saving ? "…" : "Add"}</button>
        </div>
        {loadingKw ? <div style={{ fontSize: 12, color: "var(--ink-3)" }}>Loading…</div> : keywords.length === 0 ? <div style={{ fontSize: 12, fontStyle: "italic", color: "var(--ink-3)" }}>No keywords set. Add one above.</div> : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {keywords.map(kw => (
              <span key={kw.id} className="chip" style={{ background: "var(--accent-bg)", color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11 }}>
                {kw.phrase}
                <button onClick={() => removeKeyword(kw.id)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
              </span>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "4px 0 10px" }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>Alert log</span>
        <button className="act" onClick={() => { setLoadingAl(true); loadAlerts(); }}>Refresh</button>
      </div>
      <LogStats items={[{ label: "Total alerts", value: alerts.length, color: "var(--rose)" }, { label: "Showing", value: filtered.length }, { label: "Unique keywords", value: new Set(alerts.map(a => a.keyword)).size }]} />
      <LogFilters search={search} setSearch={setSearch} guild={guild} setGuild={setGuild} guilds={guilds} />
      <div className="card"><div style={{ overflowX: "auto" }}>
        {loadingAl ? <div className="empty">Loading…</div> : filtered.length === 0 ? <div className="empty">No alerts triggered yet.</div> : (
          <table className="dtable" style={{ minWidth: 860 }}>
            <thead><tr><th>Keyword</th><th>Type</th><th>Author</th><th>Channel</th><th>Server</th><th>Content</th><th>Time</th></tr></thead>
            <tbody>{filtered.map(a => (
              <tr key={a.id}>
                <td><span className="chip" style={{ background: "var(--rose-bg)", color: "var(--rose)" }}>{a.keyword}</span></td>
                <td style={{ color: "var(--ink-3)", fontSize: 11 }}>{a.event_type}</td>
                <td><UserCell displayName={a.author_name} username={a.author_name} userId={a.author_id} /></td>
                <td style={{ color: "var(--ink-2)", whiteSpace: "nowrap" }}>#{a.channel_name || a.channel_id}</td>
                <td style={{ color: "var(--ink-2)", whiteSpace: "nowrap" }}>{a.guild_name}</td>
                <td style={{ maxWidth: 340, lineHeight: 1.5, wordBreak: "break-word" }}>{a.content}</td>
                <td style={{ fontFamily: "var(--v2-mono)", fontSize: 10.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{fmtTs(a.created_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div></div>
    </>
  );
}

/* ── Conversations (L3): team activity stats + AI summaries ── */
function Conversations() {
  const [fromDate, setFromDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().substring(0, 10); });
  const [toDate, setToDate] = useState(() => new Date().toISOString().substring(0, 10));
  const [member, setMember] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [stats, setStats] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [channel, setChannel] = useState("");
  const [channels, setChannels] = useState([]);
  useEffect(() => { getAvailableChannels().then(c => setChannels(c || [])); }, []);
  const lbl = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--ink-3)", marginBottom: 4 };
  const run = async () => {
    setLoading(true);
    const s = await getConversationStats(fromDate, toDate, member, channel);
    setStats(s);
    const sum = await generateConversationSummary(fromDate, toDate, member, channel);
    setSummary(sum);
    setLoading(false);
  };
  return (
    <>
      <div className="card">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 200, position: "relative" }}>
            <div style={lbl}>Member (optional)</div>
            <input className="filter-inp" style={{ width: "100%" }} value={member} placeholder="Search by member name…" onChange={async e => {
              const v = e.target.value; setMember(v);
              if (v.length >= 1) setSuggestions(await getMemberSuggestions(v)); else setSuggestions([]);
            }} />
            {suggestions.length > 0 && member && (
              <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, borderRadius: 8, maxHeight: 200, overflowY: "auto", zIndex: 50, background: "var(--panel)", border: "1px solid var(--line-2)" }}>
                {suggestions.map(s => (
                  <div key={s.author_id} style={{ padding: "7px 10px", cursor: "pointer", fontSize: 12.5 }} onClick={() => { setMember(s.author_name); setSuggestions([]); }}>
                    {s.author_name} <span style={{ fontSize: 10, color: "var(--ink-3)" }}>{s.c} msgs</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ minWidth: 170 }}>
            <div style={lbl}>Channel</div>
            <select className="filter-inp" style={{ width: "100%" }} value={channel} onChange={e => setChannel(e.target.value)}>
              <option value="">All channels</option>
              {channels.map(ch => <option key={ch.channel_id} value={ch.channel_id}>#{ch.channel_name}</option>)}
            </select>
          </div>
          <div><div style={lbl}>From</div><input type="date" className="filter-inp" value={fromDate} onChange={e => setFromDate(e.target.value)} /></div>
          <div><div style={lbl}>To</div><input type="date" className="filter-inp" value={toDate} onChange={e => setToDate(e.target.value)} /></div>
          <div style={{ display: "flex", gap: 4 }}>
            {[[7, "7d"], [30, "30d"], [90, "90d"]].map(([d, l]) => (
              <button key={l} className="act" onClick={() => { const to = new Date(); const from = new Date(); from.setDate(from.getDate() - d); setFromDate(from.toISOString().substring(0, 10)); setToDate(to.toISOString().substring(0, 10)); }}>{l}</button>
            ))}
          </div>
          <button className="btn" disabled={loading} onClick={run}>{loading ? "Loading…" : "Fetch stats"}</button>
        </div>
      </div>
      {stats && (
        <>
          <div className="card">
            <div className="hd"><div className="t">Results</div><div className="meta">{stats.members.length} member{stats.members.length !== 1 ? "s" : ""} · {stats.channelsScanned} channels scanned · {stats.totalMessages} messages</div></div>
            <div style={{ overflowX: "auto" }}>
              <table className="dtable" style={{ minWidth: 640 }}>
                <thead><tr><th>Member</th><th style={{ textAlign: "right" }}>Messages ▼</th><th style={{ textAlign: "right" }}>Open tasks</th><th style={{ textAlign: "right" }}>Completed</th><th style={{ textAlign: "right" }}>Total activity</th></tr></thead>
                <tbody>
                  {stats.members.map(m => (
                    <tr key={m.author_id}>
                      <td style={{ fontWeight: 700 }}>{m.author_name}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--v2-mono)" }}>{m.message_count}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--v2-mono)", color: m.openTasks > 0 ? "var(--amber)" : "var(--ink-3)" }}>{m.openTasks}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--v2-mono)", color: m.completed > 0 ? "var(--good)" : "var(--ink-3)" }}>{m.completed}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--v2-mono)", fontWeight: 700 }}>{m.totalActivity}</td>
                    </tr>
                  ))}
                  {stats.members.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--ink-3)" }}>No activity in date range.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card">
            <div className="hd"><div className="t">Channels</div><div className="meta">{stats.channels.length}</div></div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 6, paddingTop: 6 }}>
              {stats.channels.map(ch => (
                <div key={ch.channel_id} style={{ padding: "8px 10px", borderRadius: 8, background: "var(--panel-2)" }}>
                  <div style={{ fontFamily: "var(--v2-mono)", fontSize: 11, color: "var(--accent)" }}>#{ch.channel_name}</div>
                  <div style={{ fontSize: 10, color: "var(--ink-3)" }}>{ch.message_count} msgs · {ch.unique_members} members</div>
                </div>
              ))}
            </div>
          </div>
          {summary && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12 }}>
              <div className="card" style={{ marginBottom: 0 }}><div className="hd"><div className="t">Team themes</div></div>
                <div className="quill-content" style={{ fontSize: 13, color: "var(--ink-1)" }} dangerouslySetInnerHTML={{ __html: summary.teamThemes }} />
              </div>
              <div className="card" style={{ marginBottom: 0 }}><div className="hd"><div className="t">Summary: {member || "All members"}</div></div>
                {member
                  ? <div className="quill-content" style={{ fontSize: 13, color: "var(--ink-1)" }} dangerouslySetInnerHTML={{ __html: summary.memberSummary || '<em style="color:var(--ink-3)">Select a member to see their individual summary.</em>' }} />
                  : <div style={{ fontSize: 13, color: "var(--ink-3)" }}><em>Select a member above to see their individual activity summary.</em></div>}
              </div>
              <div className="card" style={{ marginBottom: 0 }}><div className="hd"><div className="t">By channel</div></div>
                <div className="quill-content" style={{ fontSize: 13, color: "var(--ink-1)" }} dangerouslySetInnerHTML={{ __html: summary.channelSummaries }} />
              </div>
            </div>
          )}
        </>
      )}
      {!stats && !loading && <div className="empty">Set a date range and click <strong>Fetch stats</strong> to load conversation data and AI summaries.</div>}
    </>
  );
}

/* ── Recurring Reminders (L2+; Progress + Force Send = L3) ── */
const CHANNEL_LABELS = {
  global_ping_channel: "#meridian-database (global)",
  event_announce_channel: "#up-and-coming",
  leadership_channel: "#management-board",
  team_lead_channel: "#team-leads",
};
const ord = (n) => (n >= 11 && n <= 13) ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";
const labelForTarget = (type, id, targets) =>
  type === "User" ? (targets.staff.find(s => s.discord_id === id)?.display_name || id)
  : type === "Team" ? (targets.teams.find(t => t.team_id === id)?.team_name || id)
  : (targets.roles.find(r => r.role_id === id)?.key || id);

function RecurringReminders({ auth }) {
  const [reminders, setReminders] = useState([]);
  const [channels, setChannels] = useState([]);
  const [targets, setTargets] = useState({ teams: [], staff: [], roles: [] });
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [progressFor, setProgressFor] = useState(null);
  const [progressRows, setProgressRows] = useState([]);
  const refresh = async () => {
    const [r, c, t] = await Promise.all([listReminders(), listChannels(), getTargetOptions()]);
    setReminders(r || []); setChannels(c || []); setTargets(t || { teams: [], staff: [], roles: [] }); setLoading(false);
  };
  useEffect(() => { refresh(); }, []);
  if (loading) return <div className="empty">Loading…</div>;
  const openProgress = async (rem) => {
    const now = new Date();
    const rows = await getReminderProgress(rem.id, now.getUTCFullYear(), now.getUTCMonth() + 1);
    setProgressFor(rem); setProgressRows(rows || []);
  };
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>Monthly tasks that ping a target on a set day.</span>
        <button className="btn" onClick={() => { setEditing(null); setShowForm(true); }}>New reminder +</button>
      </div>
      {reminders.length === 0 && <div className="empty">No reminders yet. Create one to get started.</div>}
      <div className="card">
        {reminders.map(r => {
          const chKey = channels.find(c => c.channel_id === r.channel_id)?.key || r.channel_id;
          const canEdit = auth.level >= 3 || r.created_by_id === auth.id;
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
                    <span><b>Channel:</b> {CHANNEL_LABELS[chKey] || chKey}</span>
                    <span><b>Ping:</b> {r.ping_day}{ord(r.ping_day)} / <b>Due:</b> {r.due_day}{ord(r.due_day)}</span>
                  </div>
                  {r.body && <p style={{ fontSize: 12, marginTop: 6, whiteSpace: "pre-wrap", color: "var(--ink-1)" }}>{r.body.substring(0, 200)}{r.body.length > 200 ? "…" : ""}</p>}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {auth.level >= 3 && r.active && <button className="act" onClick={() => openProgress(r)}>Progress</button>}
                  {auth.level >= 3 && r.active && <button className="act" style={{ color: "var(--accent)" }} onClick={async () => {
                    if (window.confirm(`Force-send "${r.title}" now? Pings the channel and creates this month's instances if missing.`)) {
                      const res = await forceSendRecurringReminder(r.id);
                      if (!res.ok) { window.alert(res.error || "Failed"); return; }
                      window.alert(`Sent. ${res.recipientsCount || 0} recipient(s) notified.`);
                      refresh();
                    }
                  }}>Force send</button>}
                  {canEdit && <button className="act" onClick={() => { setEditing(r); setShowForm(true); }}>Edit</button>}
                  {canEdit && r.active && <button className="act" style={{ color: "var(--rose)" }} onClick={async () => { if (window.confirm("Deactivate this reminder? Past instances stay in the DB.")) { await deleteReminder(r.id); refresh(); } }}>Delete</button>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {showForm && <ReminderForm editing={editing} channels={channels} targets={targets} onClose={() => { setShowForm(false); setEditing(null); }} onSaved={() => { setShowForm(false); setEditing(null); refresh(); }} />}
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
                  <button className="act" style={{ padding: "2px 8px" }} onClick={async () => { await adminCompleteInstance(p.id); openProgress(progressFor); }}>Mark done</button>
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

function ReminderForm({ editing, channels, targets, onClose, onSaved }) {
  const [form, setForm] = useState({
    title: editing?.title || "", body: editing?.body || "", links: editing?.links || "",
    target_type: editing?.target_type || "Role", target_id: editing?.target_id || "",
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
    setSubmitting(true);
    const res = editing ? await updateReminder(editing.id, form) : await createReminder(form);
    setSubmitting(false);
    if (!res.ok) { setErr(res.error || "Failed"); return; }
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
          <div><div style={lbl}>Reference links (one per line)</div><textarea className="filter-inp" style={{ width: "100%" }} rows={2} value={form.links} onChange={e => setForm({ ...form, links: e.target.value })} placeholder={"https://ecrpfm.com/fm/leadership/reviews\nhttps://ecrpfm.com/fm/factions"} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><div style={lbl}>Target type *</div>
              <select className="filter-inp" style={{ width: "100%" }} value={form.target_type} onChange={e => setForm({ ...form, target_type: e.target.value, target_id: "" })}>
                <option value="Role">Role</option><option value="Team">Team</option><option value="User">User</option>
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
              {channels.map(c => <option key={c.key} value={c.channel_id}>{CHANNEL_LABELS[c.key] || c.key}</option>)}
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

/* ── Documents (all staff; L3 CRUD) ── */
function DocumentsView({ auth }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editDoc, setEditDoc] = useState(null);
  const [form, setForm] = useState({ title: "", category: "General", content: "", level_required: 1 });
  const [showArchived, setShowArchived] = useState(false);
  useEffect(() => {
    getDocuments().then(d => {
      // Client-side guard: never display a doc above the viewer's level
      const safe = (d || []).filter(doc => (doc.level_required || 1) <= auth.level);
      setDocs(safe); setLoading(false);
      const sop = new URLSearchParams(window.location.search).get("sop");
      if (sop) {
        const match = safe.find(doc => doc.title === decodeURIComponent(sop));
        if (match) {
          setExpandedId(match.id);
          setTimeout(() => document.querySelector(`[data-doc-id="${match.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
        }
      }
    });
  }, []);
  const refresh = async () => {
    const d = await getDocuments();
    setDocs((d || []).filter(doc => (doc.level_required || 1) <= auth.level));
  };
  const handleSave = async () => {
    if (!form.title.trim()) return;
    if (editDoc) await updateDocument(editDoc.id, form); else await createDocument(form);
    setShowForm(false); setEditDoc(null); setForm({ title: "", category: "General", content: "", level_required: 1 });
    refresh();
  };
  if (loading) return <div className="empty">Loading documents…</div>;
  const q = search.toLowerCase();
  const filtered = docs.filter(d => {
    if (!showArchived && d.category === "z. Archived") return false;
    return !q || d.title?.toLowerCase().includes(q) || d.category?.toLowerCase().includes(q);
  });
  const grouped = filtered.reduce((a, d) => { const c = d.category || "General"; (a[c] = a[c] || []).push(d); return a; }, {});
  const archivedCount = docs.filter(d => d.category === "z. Archived").length;
  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
        <input className="filter-inp" style={{ maxWidth: 340 }} placeholder="Search documents…" value={search} onChange={e => setSearch(e.target.value)} />
        <span style={{ flex: 1 }} />
        {auth.level >= 3 && <button className="btn" onClick={() => { setEditDoc(null); setForm({ title: "", category: "General", content: "", level_required: 1 }); setShowForm(true); }}>Create +</button>}
      </div>
      {Object.keys(grouped).sort().map(cat => (
        <div className="card" key={cat}>
          <div className="hd"><div className="t">{cat}</div><div className="meta">{grouped[cat].length}</div></div>
          {grouped[cat].map(doc => {
            const open = expandedId === doc.id;
            return (
              <div key={doc.id} data-doc-id={doc.id} style={{ borderBottom: "1px solid var(--line)" }}>
                <div className="row" onClick={() => setExpandedId(open ? null : doc.id)}>
                  <span className="desc">{doc.title}</span>
                  <span className="chip role">{doc.created_by}</span>
                  {doc.level_required > 1 && <span className="chip lock">L{doc.level_required}+</span>}
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
                            setExpandedId(targetDoc.id);
                            setTimeout(() => document.querySelector(`[data-doc-id="${targetDoc.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
                          } else {
                            window.alert("Document not found or above your access level: " + title);
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
      {filtered.length === 0 && !showArchived && <div className="empty">No documents found.</div>}
      {archivedCount > 0 && (
        <button className="act" style={{ marginTop: 4 }} onClick={() => setShowArchived(v => !v)}>
          {showArchived ? "▲ Hide archived" : `▼ Show archived (${archivedCount})`}
        </button>
      )}
      {showForm && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={() => { setShowForm(false); setEditDoc(null); }} />
          <div style={{ position: "relative", width: "100%", maxWidth: 750, maxHeight: "90vh", background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 12, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
              <span style={{ fontWeight: 700, color: "var(--ink-0)" }}>{editDoc ? "Edit" : "Create"} document</span>
              <button className="act" style={{ padding: "2px 8px" }} onClick={() => { setShowForm(false); setEditDoc(null); }}>✕</button>
            </div>
            <div style={{ padding: 18, overflowY: "auto", flex: 1 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
                <input className="filter-inp" placeholder="Title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
                <input className="filter-inp" placeholder="Category" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} />
                <select className="filter-inp" value={form.level_required} onChange={e => setForm({ ...form, level_required: parseInt(e.target.value) })}>
                  <option value={1}>All FM Staff (L1+)</option>
                  <option value={2}>Team Leads & Leadership (L2+)</option>
                  <option value={3}>FM Leadership Only (L3)</option>
                </select>
              </div>
              <QuillEditor value={form.content} onChange={v => setForm({ ...form, content: v })} placeholder="Start writing…" />
            </div>
            <div style={{ padding: "12px 18px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "flex-end", gap: 8, flexShrink: 0 }}>
              <button className="act" onClick={() => { setShowForm(false); setEditDoc(null); }}>Cancel</button>
              <button className="act primary" onClick={handleSave}>Save</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ── Faction Channels / Bot Server Config (L3) ── */
function FactionChannels() {
  const [servers, setServers] = useState([]);
  const [factions, setFactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addForm, setAddForm] = useState(null);
  useEffect(() => { Promise.all([getBotServerConfigs(), getFactionNames()]).then(([s, f]) => { setServers(s || []); setFactions(f || []); setLoading(false); }); }, []);
  const refresh = () => getBotServerConfigs().then(s => setServers(s || []));
  if (loading) return <div className="empty">Loading…</div>;
  const F_EMPTY = { guild_id: "", guild_name: "", faction: "", access_role_id: "", access_role_name: "", comms_channel_id: "", comms_channel_name: "", faction_channel_id: "", faction_channel_name: "" };
  const submitAdd = async () => {
    if (!addForm.guild_id) return;
    const result = await addBotServerConfig(addForm);
    if (result?.error) { window.alert(result.error); return; }
    setAddForm(null); refresh();
  };
  const lbl = { fontSize: 10, color: "var(--ink-3)", marginBottom: 3 };
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--v2-mono)", maxWidth: 640 }}>
          Access Role — login gate for meridiandatabase.net · Command Channel — leadership target for announcements · Faction-Wide Channel — whole-faction target · Monitored Roles — pings shown on the dashboard
        </div>
        <button className="btn" onClick={() => setAddForm({ ...F_EMPTY })}>Add server +</button>
      </div>
      {servers.length === 0 && <div className="empty">No servers configured yet.</div>}
      {servers.map(server => <ServerRow key={server.id} server={server} factions={factions} onRefresh={refresh} />)}
      {addForm && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={() => setAddForm(null)} />
          <div style={{ position: "relative", width: "100%", maxWidth: 560, maxHeight: "88vh", overflowY: "auto", background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 12, padding: 18 }}>
            <div style={{ fontWeight: 700, color: "var(--ink-0)", marginBottom: 14 }}>Add bot server</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div><div style={lbl}>Discord Server ID *</div><input className="filter-inp" style={{ width: "100%" }} value={addForm.guild_id} onChange={e => setAddForm({ ...addForm, guild_id: e.target.value })} placeholder="Right-click server → Copy ID" /></div>
              <div><div style={lbl}>Server Name</div><input className="filter-inp" style={{ width: "100%" }} value={addForm.guild_name} onChange={e => setAddForm({ ...addForm, guild_name: e.target.value })} placeholder="e.g. Alliance Discord" /></div>
              <div style={{ gridColumn: "1 / -1" }}><div style={lbl}>Linked Faction</div>
                <select className="filter-inp" style={{ width: "100%" }} value={addForm.faction} onChange={e => setAddForm({ ...addForm, faction: e.target.value })}>
                  <option value="">— None —</option>
                  {factions.map(n => <option key={n} value={n}>{n}</option>)}
                </select></div>
              <div><div style={lbl}>Access Role ID</div><input className="filter-inp" style={{ width: "100%" }} value={addForm.access_role_id} onChange={e => setAddForm({ ...addForm, access_role_id: e.target.value })} placeholder="Role required to log into DB site" /></div>
              <div><div style={lbl}>Access Role Name</div><input className="filter-inp" style={{ width: "100%" }} value={addForm.access_role_name} onChange={e => setAddForm({ ...addForm, access_role_name: e.target.value })} placeholder="e.g. Ally Member" /></div>
              <div><div style={lbl}>Command Channel ID</div><input className="filter-inp" style={{ width: "100%" }} value={addForm.comms_channel_id} onChange={e => setAddForm({ ...addForm, comms_channel_id: e.target.value })} placeholder="Right-click channel → Copy ID" /></div>
              <div><div style={lbl}>Command Channel Name</div><input className="filter-inp" style={{ width: "100%" }} value={addForm.comms_channel_name} onChange={e => setAddForm({ ...addForm, comms_channel_name: e.target.value })} placeholder="e.g. #command" /></div>
              <div><div style={lbl}>Faction-Wide Channel ID</div><input className="filter-inp" style={{ width: "100%" }} value={addForm.faction_channel_id} onChange={e => setAddForm({ ...addForm, faction_channel_id: e.target.value })} placeholder="Right-click channel → Copy ID" /></div>
              <div><div style={lbl}>Faction-Wide Channel Name</div><input className="filter-inp" style={{ width: "100%" }} value={addForm.faction_channel_name} onChange={e => setAddForm({ ...addForm, faction_channel_name: e.target.value })} placeholder="e.g. #announcements" /></div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button className="act" onClick={() => setAddForm(null)}>Cancel</button>
              <button className="act primary" disabled={!addForm.guild_id.trim()} onClick={submitAdd}>Add</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ServerRow({ server, factions, onRefresh }) {
  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [addingWatch, setAddingWatch] = useState(false);
  const [watchForm, setWatchForm] = useState({ role_id: "", role_name: "" });
  const startEdit = () => {
    setForm({
      guild_name: server.guild_name || "", access_role_id: server.access_role_id || "", access_role_name: server.access_role_name || "",
      comms_channel_id: server.comms_channel_id || "", comms_channel_name: server.comms_channel_name || "",
      faction_channel_id: server.faction_channel_id || "", faction_channel_name: server.faction_channel_name || "",
      faction: server.faction_name || "",
    });
    setEditing(true); setCollapsed(false);
  };
  const saveEdit = async () => { setSaving(true); await updateBotServerConfig(server.id, form); setSaving(false); setEditing(false); onRefresh(); };
  const f = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));
  const submitWatch = async () => {
    if (!watchForm.role_id.trim()) return;
    await addBotWatchRole({ config_id: server.id, ...watchForm });
    setAddingWatch(false); setWatchForm({ role_id: "", role_name: "" });
    onRefresh();
  };
  const lbl = { fontSize: 10, color: "var(--ink-3)", marginBottom: 3 };
  const KV = ({ label, name, id, missing }) => (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--ink-3)", marginBottom: 3 }}>{label}</div>
      {id ? <><div style={{ fontSize: 13, fontWeight: 500 }}>{name || <span style={{ color: "var(--ink-3)", fontStyle: "italic" }}>Unnamed</span>}</div><div style={{ fontSize: 10, fontFamily: "var(--v2-mono)", color: "var(--ink-3)" }}>{id}</div></>
        : <div style={{ fontSize: 11, fontStyle: "italic", color: missing ? "var(--rose)" : "var(--ink-3)" }}>Not set</div>}
    </div>
  );
  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none" }} onClick={() => { if (!editing) setCollapsed(c => !c); }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{collapsed ? "▶" : "▼"}</span>
          <div>
            <span style={{ fontWeight: 700 }}>{server.guild_name || "Unnamed Server"}</span>
            <span style={{ fontSize: 10, fontFamily: "var(--v2-mono)", color: "var(--ink-3)", marginLeft: 8 }}>{server.guild_id}</span>
          </div>
          {server.faction_name && <span className="chip" style={{ background: "var(--accent-bg)", color: "var(--accent)" }}>{server.faction_name}</span>}
        </div>
        <div style={{ display: "flex", gap: 6 }} onClick={e => e.stopPropagation()}>
          {!editing && <button className="act" onClick={startEdit}>Edit</button>}
          <button className="act" style={{ color: "var(--rose)" }} onClick={async () => { if (window.confirm(`Remove ${server.guild_name || server.guild_id} and all its roles?`)) { await deleteBotServerConfig(server.id); onRefresh(); } }}>Remove</button>
        </div>
      </div>
      {!collapsed && (editing ? (
        <div style={{ paddingTop: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--ink-3)", marginBottom: 8 }}>Editing — {server.guild_id}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><div style={lbl}>Server Name</div><input className="filter-inp" style={{ width: "100%" }} value={form.guild_name} onChange={f("guild_name")} placeholder="e.g. Alliance Discord" /></div>
            <div><div style={lbl}>Linked Faction</div>
              <select className="filter-inp" style={{ width: "100%" }} value={form.faction} onChange={f("faction")}>
                <option value="">— None —</option>
                {factions.map(n => <option key={n} value={n}>{n}</option>)}
              </select></div>
            <div><div style={lbl}>Access Role ID</div><input className="filter-inp" style={{ width: "100%" }} value={form.access_role_id} onChange={f("access_role_id")} placeholder="Role required to log into DB site" /></div>
            <div><div style={lbl}>Access Role Name</div><input className="filter-inp" style={{ width: "100%" }} value={form.access_role_name} onChange={f("access_role_name")} placeholder="e.g. Ally Member" /></div>
            <div><div style={lbl}>Command Channel ID</div><input className="filter-inp" style={{ width: "100%" }} value={form.comms_channel_id} onChange={f("comms_channel_id")} placeholder="Right-click channel → Copy ID" /></div>
            <div><div style={lbl}>Command Channel Name</div><input className="filter-inp" style={{ width: "100%" }} value={form.comms_channel_name} onChange={f("comms_channel_name")} placeholder="e.g. #command" /></div>
            <div><div style={lbl}>Faction-Wide Channel ID</div><input className="filter-inp" style={{ width: "100%" }} value={form.faction_channel_id} onChange={f("faction_channel_id")} placeholder="Right-click channel → Copy ID" /></div>
            <div><div style={lbl}>Faction-Wide Channel Name</div><input className="filter-inp" style={{ width: "100%" }} value={form.faction_channel_name} onChange={f("faction_channel_name")} placeholder="e.g. #announcements" /></div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="act primary" disabled={saving} onClick={saveEdit}>{saving ? "Saving…" : "Save changes"}</button>
            <button className="act" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
            <KV label="Access Role" name={server.access_role_name} id={server.access_role_id} missing />
            <KV label="Command Channel" name={server.comms_channel_name} id={server.comms_channel_id} />
            <KV label="Faction-Wide Channel" name={server.faction_channel_name} id={server.faction_channel_id} />
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--ink-3)", marginBottom: 3 }}>Linked Faction</div>
              <div style={{ fontSize: 13, color: server.faction_name ? "var(--accent)" : "var(--ink-3)", fontStyle: server.faction_name ? "normal" : "italic" }}>{server.faction_name || "None"}</div>
            </div>
          </div>
          <div style={{ paddingTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--ink-3)" }}>Monitored roles <span style={{ fontWeight: 400 }}>— pings tracked on the dashboard</span></span>
              <button className="act" style={{ padding: "2px 8px" }} onClick={() => setAddingWatch(v => !v)}>{addingWatch ? "Cancel" : "+ Add role"}</button>
            </div>
            {addingWatch && (
              <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                <input className="filter-inp" style={{ maxWidth: 220 }} placeholder="Role ID the bot watches for pings" value={watchForm.role_id} onChange={e => setWatchForm({ ...watchForm, role_id: e.target.value })} />
                <input className="filter-inp" style={{ maxWidth: 180 }} placeholder="Role name, e.g. @leadership" value={watchForm.role_name} onChange={e => setWatchForm({ ...watchForm, role_name: e.target.value })} />
                <button className="act primary" disabled={!watchForm.role_id.trim()} onClick={submitWatch}>Add</button>
              </div>
            )}
            {server.watchRoles.length === 0 ? <div style={{ fontSize: 11, fontStyle: "italic", color: "var(--ink-3)", padding: "4px 0" }}>No roles monitored.</div> : (
              server.watchRoles.map(r => (
                <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 10px", borderRadius: 8, background: "var(--panel-2)", marginBottom: 4 }}>
                  <span><span style={{ fontSize: 13, fontWeight: 500 }}>{r.role_name || <span style={{ color: "var(--ink-3)", fontStyle: "italic" }}>Unnamed</span>}</span><span style={{ fontSize: 10, fontFamily: "var(--v2-mono)", color: "var(--ink-3)", marginLeft: 10 }}>{r.role_id}</span></span>
                  <button className="act" style={{ color: "var(--rose)", padding: "2px 8px" }} onClick={async () => { if (window.confirm(`Remove monitored role ${r.role_name || r.role_id}?`)) { await deleteBotWatchRole(r.id); onRefresh(); } }}>Remove</button>
                </div>
              ))
            )}
          </div>
        </>
      ))}
    </div>
  );
}

/* ── shared mini form modal (replaces /fm useDialog showForm) ── */
function FormModal({ title, fields, onCancel, onSubmit }) {
  const [vals, setVals] = useState(() => Object.fromEntries(fields.map(f => [f.name, f.default ?? (f.type === "checkbox" ? false : "")])));
  const lbl = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--ink-3)", marginBottom: 4 };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={onCancel} />
      <div style={{ position: "relative", width: "100%", maxWidth: 440, background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 12, padding: 18 }}>
        <div style={{ fontWeight: 700, color: "var(--ink-0)", marginBottom: 14 }}>{title}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {fields.map(f => (
            <div key={f.name}>
              {f.type === "checkbox"
                ? <label style={{ fontSize: 12.5, color: "var(--ink-1)", display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={!!vals[f.name]} onChange={e => setVals({ ...vals, [f.name]: e.target.checked })} /> {f.label}</label>
                : <>
                  <div style={lbl}>{f.label}</div>
                  {f.type === "select"
                    ? <select className="filter-inp" style={{ width: "100%" }} value={vals[f.name]} onChange={e => setVals({ ...vals, [f.name]: e.target.value })}>
                      {f.placeholder !== undefined && <option value="">{f.placeholder}</option>}
                      {(f.options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    : <input className="filter-inp" style={{ width: "100%" }} value={vals[f.name]} placeholder={f.placeholder || ""} onChange={e => setVals({ ...vals, [f.name]: e.target.value })} />}
                </>}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button className="act" onClick={onCancel}>Cancel</button>
          <button className="act primary" onClick={() => onSubmit(vals)}>Save</button>
        </div>
      </div>
    </div>
  );
}

/* ── DB Site Access (L3): meridiandatabase.net login roles ── */
function DbSiteAccess() {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  useEffect(() => { getMdbAccessRoles().then(r => { setRoles(r || []); setLoading(false); }); }, []);
  if (loading) return <div className="empty">Loading…</div>;
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 12.5, color: "var(--ink-1)" }}>Control which Discord roles can log in to <b>meridiandatabase.net</b>.</div>
          <div style={{ fontSize: 10.5, fontFamily: "var(--v2-mono)", color: "var(--ink-3)", marginTop: 2 }}>Members must have at least one of these roles. If the list is empty, all guild members are permitted.</div>
        </div>
        <button className="btn" onClick={() => setAdding(true)}>Add role +</button>
      </div>
      {roles.length === 0 ? <div className="empty">No roles configured — all guild members can currently access the site.</div> : (
        <div className="card"><div style={{ overflowX: "auto" }}>
          <table className="dtable" style={{ minWidth: 480 }}>
            <thead><tr><th>Role name</th><th>Role ID</th><th>Added</th><th></th></tr></thead>
            <tbody>
              {roles.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.role_name || <span style={{ color: "var(--ink-3)", fontStyle: "italic" }}>Unnamed</span>}</td>
                  <td style={{ fontFamily: "var(--v2-mono)", fontSize: 11, color: "var(--ink-3)" }}>{r.role_id}</td>
                  <td style={{ fontSize: 11, color: "var(--ink-3)" }}>{r.created_at?.substring(0, 10)}</td>
                  <td style={{ textAlign: "right" }}><button className="act" style={{ color: "var(--rose)", padding: "2px 8px" }} onClick={async () => { if (window.confirm("Remove this role?")) { await deleteMdbAccessRole(r.id); getMdbAccessRoles().then(x => setRoles(x || [])); } }}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      )}
      {adding && <FormModal title="Add access role" fields={[
        { name: "role_id", label: "Discord Role ID", type: "text", placeholder: "Right-click role → Copy ID" },
        { name: "role_name", label: "Role Name (label)", type: "text", placeholder: "e.g. Alliance Member" },
      ]} onCancel={() => setAdding(false)} onSubmit={async (v) => { if (v.role_id) { await addMdbAccessRole(v); getMdbAccessRoles().then(x => setRoles(x || [])); } setAdding(false); }} />}
    </>
  );
}

/* ── Staff & Teams (L3): kanban board, drag to reassign, COI, promote/retire, dashboard access ── */
function StaffTeams() {
  const [staff, setStaff] = useState([]);
  const [activity, setActivity] = useState([]);
  const [teams, setTeams] = useState([]);
  const [factions, setFactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [staffMoves, setStaffMoves] = useState([]);
  const [factionMoves, setFactionMoves] = useState([]);
  const [committing, setCommitting] = useState(false);
  const [dragOver, setDragOver] = useState(null);
  const [coiEntries, setCoiEntries] = useState([]);
  const [meridianFactions, setMeridianFactions] = useState([]);
  const [coiModalStaff, setCoiModalStaff] = useState(null);
  const [showCOIManager, setShowCOIManager] = useState(false);
  const [retireMember, setRetireMember] = useState(null);
  const [promoteMember, setPromoteMember] = useState(null);
  const [accessList, setAccessList] = useState([]);
  const [accessForm, setAccessForm] = useState({ discordId: "", displayName: "" });
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessError, setAccessError] = useState("");
  const [addingStaff, setAddingStaff] = useState(false);
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [editMember, setEditMember] = useState(null);

  const refresh = async () => {
    const [st, ac, te, fa, coi, mf, al] = await Promise.all([
      getStaffList(), getStaffActivity(), getTeamList(), getFactionAssignments(),
      getAllStaffCOI(), getMeridianFactions(), getDashboardAccessList(),
    ]);
    setStaff(st); setActivity(ac); setTeams(te); setFactions(fa);
    setCoiEntries(coi); setMeridianFactions(mf); setAccessList(al);
    setStaffMoves([]); setFactionMoves([]); setLoading(false);
  };
  useEffect(() => { refresh(); }, []);
  const refreshCOI = async () => setCoiEntries(await getAllStaffCOI());

  const coiMap = useMemo(() => {
    const m = {};
    coiEntries.forEach(e => { (m[e.discord_id] = m[e.discord_id] || []).push(e.faction_name.toLowerCase()); });
    return m;
  }, [coiEntries]);

  const getScenes = (name) => activity.find(a => a.name === name)?.scene_count || 0;
  const totalPending = staffMoves.length + factionMoves.length;

  const boardState = useMemo(() => {
    const board = {};
    const sMoveMap = {}; staffMoves.forEach(m => { sMoveMap[m.staffId] = m; });
    const fMoveMap = {}; factionMoves.forEach(m => { fMoveMap[m.factionId] = m; });
    teams.forEach(t => { board[t.id] = { id: t.id, name: t.name, members: [], factions: [] }; });
    if (!board[""]) board[""] = { id: "", name: "Unassigned", members: [], factions: [] };
    staff.forEach(st => {
      const move = sMoveMap[st.id];
      const effectiveTeam = move ? move.newTeamId : st.team_id;
      const effectiveName = move ? move.newTeamName : st.team_name;
      if (!board[effectiveTeam]) board[effectiveTeam] = { id: effectiveTeam, name: effectiveName, members: [], factions: [] };
      board[effectiveTeam].members.push({ ...st, scenes30d: getScenes(st.display_name), isPending: !!move, originalTeamId: st.team_id, originalTeamName: st.team_name });
    });
    factions.forEach(f => {
      const move = fMoveMap[f.id];
      const effectiveTeam = move ? move.newTeamId : f.teamId;
      const effectiveName = move ? move.newTeamName : f.teamName;
      if (!board[effectiveTeam]) board[effectiveTeam] = { id: effectiveTeam, name: effectiveName, members: [], factions: [] };
      board[effectiveTeam].factions.push({ ...f, isPending: !!move, originalTeamId: f.teamId, originalTeamName: f.teamName });
    });
    Object.values(board).forEach(col => {
      col.members.sort((a, b) => {
        const al = a.rank?.toLowerCase().includes("lead") ? 0 : 1;
        const bl = b.rank?.toLowerCase().includes("lead") ? 0 : 1;
        return al !== bl ? al - bl : a.display_name.localeCompare(b.display_name);
      });
      col.factions.sort((a, b) => a.name.localeCompare(b.name));
    });
    return Object.values(board).sort((a, b) => {
      if (a.id === "") return 1; if (b.id === "") return -1;
      return a.name.localeCompare(b.name);
    });
  }, [staff, teams, factions, staffMoves, factionMoves, activity]);

  const handleDragStart = (e, type, data) => {
    e.dataTransfer.setData("text/plain", JSON.stringify({ type, ...data }));
    e.dataTransfer.effectAllowed = "move";
  };
  const handleDrop = async (e, targetTeamId, targetTeamName) => {
    e.preventDefault();
    setDragOver(null);
    try {
      const data = JSON.parse(e.dataTransfer.getData("text/plain"));
      if (data.type === "staff") {
        const origTeamId = data.originalTeamId || data.teamId;
        if (origTeamId === targetTeamId) {
          setStaffMoves(prev => prev.filter(m => m.staffId !== data.staffId));
        } else {
          const targetFactions = boardState.find(col => col.id === targetTeamId)?.factions || [];
          const staffCOI = coiMap[data.discordId] || [];
          const conflicts = targetFactions.filter(f => staffCOI.includes(f.name.toLowerCase()));
          if (conflicts.length > 0) {
            const proceed = window.confirm(`⚠️ COI Alert — ${data.name}\n\nThis guide has a declared conflict of interest with:\n${conflicts.map(f => f.name).join(", ")}\n\n"${targetTeamName}" oversees these factions. Proceed anyway?`);
            if (!proceed) return;
          }
          setStaffMoves(prev => [...prev.filter(m => m.staffId !== data.staffId), { staffId: data.staffId, staffName: data.name, discordId: data.discordId, oldTeamId: origTeamId, oldTeamName: data.originalTeamName || data.teamName, newTeamId: targetTeamId, newTeamName: targetTeamName }]);
        }
      } else if (data.type === "faction") {
        const origTeamId = data.originalTeamId || data.teamId;
        if (origTeamId === targetTeamId) {
          setFactionMoves(prev => prev.filter(m => m.factionId !== data.factionId));
        } else {
          setFactionMoves(prev => [...prev.filter(m => m.factionId !== data.factionId), { factionId: data.factionId, factionName: data.name, oldTeamId: origTeamId, oldTeamName: data.originalTeamName || data.teamName, newTeamId: targetTeamId, newTeamName: targetTeamName }]);
        }
      }
    } catch (err) { }
  };

  const handleCommit = async () => {
    if (totalPending === 0) return;
    const lines = [];
    if (staffMoves.length) lines.push(`${staffMoves.length} staff move(s)`);
    if (factionMoves.length) lines.push(`${factionMoves.length} faction reassignment(s)`);
    if (!window.confirm(`Commit ${lines.join(" + ")}?\n\nDiscord roles will sync automatically.`)) return;
    setCommitting(true);
    const result = await commitAllChanges(staffMoves, factionMoves);
    setCommitting(false);
    window.alert(`Done!\nStaff moved: ${result.staffMoves}\nFactions reassigned: ${result.factionMoves}\nRoles synced: ${result.rolesSynced} | Failed: ${result.rolesFailed}`);
    refresh();
  };

  if (loading) return <div className="empty">Loading…</div>;
  const micro = { padding: "1px 5px", fontSize: 9 };
  return (
    <>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>Drag to reassign · Commit to sync Discord roles</span>
        <span style={{ flex: 1 }} />
        {totalPending > 0 && <>
          <button className="btn" disabled={committing} onClick={handleCommit}>{committing ? "Syncing…" : `Commit ${totalPending} change${totalPending !== 1 ? "s" : ""}`}</button>
          <button className="act" style={{ color: "var(--rose)" }} onClick={() => { setStaffMoves([]); setFactionMoves([]); }}>Discard</button>
        </>}
        <button className="act" style={{ color: "var(--amber)" }} onClick={() => setShowCOIManager(true)}>⚠ Manage COI</button>
        <button className="act" onClick={() => setCreatingTeam(true)}>+ Team</button>
        <button className="btn" onClick={() => setAddingStaff(true)}>+ Staff</button>
      </div>

      <div style={{ overflowX: "auto", display: "flex", gap: 10, alignItems: "stretch", paddingBottom: 10, minHeight: 380, maxHeight: "68vh" }}>
        {boardState.filter(col => col.name !== "Game Affairs Management" && !col.name?.toLowerCase().includes("game affairs")).map(col => {
          const isOver = dragOver === col.id;
          const hasPending = col.members.some(m => m.isPending) || col.factions.some(f => f.isPending);
          const isUnassigned = col.id === "";
          return (
            <div key={col.id}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOver(col.id); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => handleDrop(e, col.id, col.name)}
              style={{
                width: 240, minWidth: 240, display: "flex", flexDirection: "column", borderRadius: 10, overflow: "hidden",
                background: isOver ? "var(--accent-bg)" : "var(--panel)",
                border: isOver ? "2px dashed var(--accent)" : hasPending ? "1px solid var(--good)" : "1px solid var(--line-2)",
                transition: "border .15s, background .15s",
              }}>
              <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexShrink: 0 }}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: isUnassigned ? "var(--ink-3)" : "var(--ink-0)" }}>{col.name}</div>
                  <div style={{ fontSize: 9.5, fontFamily: "var(--v2-mono)", color: "var(--ink-3)", marginTop: 2 }}>{col.members.length} staff · {col.factions.length} faction{col.factions.length !== 1 ? "s" : ""}</div>
                </div>
                {col.id && (
                  <div style={{ display: "flex", gap: 2 }}>
                    <button className="act" style={micro} onClick={async () => { const n = window.prompt("Rename:", col.name); if (n && n !== col.name) { await renameTeam(col.id, n); refresh(); } }}>Ren</button>
                    <button className="act" style={{ ...micro, color: "var(--rose)" }} onClick={async () => { if (window.confirm(`Dissolve "${col.name}"?`)) { await deleteTeam(col.id, col.name); refresh(); } }}>Del</button>
                  </div>
                )}
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: 6 }}>
                {col.members.map(m => {
                  const hasCOI = coiMap[m.discord_id]?.length > 0;
                  return (
                    <div key={m.id} draggable
                      onDragStart={(e) => handleDragStart(e, "staff", { staffId: m.id, name: m.display_name, discordId: m.discord_id, teamId: col.id, teamName: col.name, originalTeamId: m.originalTeamId, originalTeamName: m.originalTeamName })}
                      style={{
                        display: "flex", alignItems: "center", gap: 6, padding: "5px 7px", borderRadius: 8, marginBottom: 3,
                        background: m.isPending ? "var(--good-bg)" : "var(--panel-2)",
                        border: m.isPending ? "1px solid var(--good)" : "1px solid var(--line)",
                        cursor: "grab", userSelect: "none",
                      }}>
                      <span style={{ fontSize: 10, color: "var(--ink-3)", flexShrink: 0 }}>⠿</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: m.isPending ? "var(--good)" : "var(--ink-0)", lineHeight: 1.3, wordBreak: "break-word" }}>
                          {m.display_name}
                          {m.rank?.toLowerCase().includes("lead") && <span className="chip role" style={{ marginLeft: 5, fontSize: 8 }}>LEAD</span>}
                        </div>
                        {m.isPending && <div style={{ fontSize: 8, color: "var(--good)", fontFamily: "var(--v2-mono)", marginTop: 1 }}>← {m.originalTeamName || "Unassigned"}</div>}
                      </div>
                      {hasCOI && (
                        <button className="act" title={`COI: ${coiEntries.filter(e => e.discord_id === m.discord_id).map(e => e.faction_name).join(", ")}`}
                          style={{ ...micro, color: "var(--amber)", background: "var(--amber-bg)", flexShrink: 0 }}
                          onClick={(ev) => { ev.stopPropagation(); setCoiModalStaff(m); }}>⚠</button>
                      )}
                      <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                        {m.rank?.toLowerCase() === "guide" && <button className="act" style={{ ...micro, color: "var(--good)" }} title="Promote to Lead" onClick={() => setPromoteMember(m)}>↑</button>}
                        <button className="act" style={micro} title="Edit" onClick={() => setEditMember(m)}>✎</button>
                        <button className="act" style={{ ...micro, color: "var(--rose)" }} title="Retire staff member" onClick={() => setRetireMember(m)}>✕</button>
                      </div>
                    </div>
                  );
                })}
                {col.members.length > 0 && col.factions.length > 0 && <div style={{ height: 1, background: "var(--line)", margin: "6px 2px" }} />}
                {col.factions.map(f => (
                  <div key={`f-${f.id}`} draggable
                    onDragStart={(e) => handleDragStart(e, "faction", { factionId: f.id, name: f.name, teamId: col.id, teamName: col.name, originalTeamId: f.originalTeamId, originalTeamName: f.originalTeamName })}
                    style={{
                      display: "flex", alignItems: "center", gap: 7, padding: "4px 7px 4px 9px", borderRadius: 8, marginBottom: 3,
                      background: f.isPending ? "var(--good-bg)" : "var(--panel-2)",
                      border: f.isPending ? "1px solid var(--good)" : "1px solid var(--line)",
                      borderLeft: `2px solid ${f.isPending ? "var(--good)" : "var(--amber)"}`,
                      cursor: "grab", userSelect: "none",
                    }}>
                    <span style={{ fontSize: 10, color: "var(--ink-3)", flexShrink: 0 }}>⠿</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 500, color: f.isPending ? "var(--good)" : "var(--ink-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                      {f.isPending && <div style={{ fontSize: 8, color: "var(--good)", fontFamily: "var(--v2-mono)", marginTop: 1 }}>← {f.originalTeamName || "Unassigned"}</div>}
                    </div>
                    <span className="chip role" style={{ fontSize: 8 }}>T{f.tier}</span>
                  </div>
                ))}
                {col.members.length === 0 && col.factions.length === 0 && <div style={{ padding: "20px 8px", textAlign: "center", fontSize: 10, color: "var(--ink-3)", fontStyle: "italic", fontFamily: "var(--v2-mono)" }}>Drop here</div>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Individual dashboard access */}
      <div className="card" style={{ marginTop: 18 }}>
        <div className="hd"><div className="t">Individual dashboard access</div><div className="meta">{accessList.length} grant{accessList.length !== 1 ? "s" : ""} active</div></div>
        {accessList.map(entry => (
          <div key={entry.discord_id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
            <span className="chip" style={{ background: "var(--accent-bg)", color: "var(--accent)" }}>L{entry.level}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{entry.display_name}</div>
              <div style={{ fontSize: 10, fontFamily: "var(--v2-mono)", color: "var(--ink-3)" }}>
                {entry.discord_id}
                {entry.granted_by_name && <span style={{ marginLeft: 8 }}>· Granted by {entry.granted_by_name}</span>}
                {entry.granted_at && <span style={{ marginLeft: 8 }}>· {entry.granted_at.substring(0, 10)}</span>}
              </div>
            </div>
            <button className="act" style={{ color: "var(--rose)" }} onClick={async () => {
              if (!window.confirm(`Revoke dashboard access for ${entry.display_name}? They will be logged out immediately.`)) return;
              await revokeDashboardAccess(entry.discord_id);
              setAccessList(al => al.filter(e => e.discord_id !== entry.discord_id));
            }}>Revoke</button>
          </div>
        ))}
        {accessList.length === 0 && <div style={{ padding: "10px 0", fontSize: 12, fontStyle: "italic", color: "var(--ink-3)" }}>No individual grants yet.</div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", paddingTop: 12 }}>
          <input className="filter-inp" style={{ width: 220 }} placeholder="Discord ID, e.g. 2254293604…" value={accessForm.discordId} onChange={e => setAccessForm(f => ({ ...f, discordId: e.target.value }))} />
          <input className="filter-inp" style={{ width: 180 }} placeholder="Display name for reference" value={accessForm.displayName} onChange={e => setAccessForm(f => ({ ...f, displayName: e.target.value }))} />
          <button className="btn" disabled={accessBusy || !accessForm.discordId.trim()} onClick={async () => {
            setAccessError(""); setAccessBusy(true);
            const res = await grantDashboardAccess(accessForm.discordId.trim(), accessForm.displayName.trim());
            setAccessBusy(false);
            if (!res.ok) { setAccessError(res.error || "Failed."); return; }
            setAccessForm({ discordId: "", displayName: "" });
            setAccessList(await getDashboardAccessList());
          }}>{accessBusy ? "Granting…" : "Grant L3 access"}</button>
          {accessError && <span style={{ fontSize: 11, color: "var(--rose)" }}>{accessError}</span>}
        </div>
      </div>

      {/* modals */}
      {addingStaff && <FormModal title="Add staff" fields={[
        { name: "discordId", label: "Discord ID", type: "text", placeholder: "Right-click user → Copy User ID" },
        { name: "name", label: "Display Name", type: "text" },
        { name: "teamId", label: "Team", type: "select", options: teams.map(t => ({ label: t.name, value: t.id })), placeholder: "Select…" },
        { name: "rank", label: "Rank", type: "select", options: [{ label: "Guide", value: "Guide" }, { label: "Team Lead", value: "Team Lead" }], default: "Guide" },
      ]} onCancel={() => setAddingStaff(false)} onSubmit={async (v) => {
        if (!v.name?.trim()) { window.alert("Display name is required."); return; }
        if (!v.discordId?.trim()) { window.alert("Discord ID is required. Right-click the user in Discord → Copy User ID."); return; }
        const tname = teams.find(t => t.id === v.teamId)?.name || "";
        await addStaff({ discordId: v.discordId.trim(), name: v.name.trim(), teamId: v.teamId || "", teamName: tname, rank: v.rank || "Guide" });
        setAddingStaff(false); refresh();
      }} />}
      {creatingTeam && <FormModal title="Create team" fields={[
        { name: "teamId", label: "Discord Role ID", type: "text" },
        { name: "teamName", label: "Team Name", type: "text" },
        { name: "channelId", label: "Team Channel ID", type: "text" },
      ]} onCancel={() => setCreatingTeam(false)} onSubmit={async (v) => {
        if (v.teamId && v.teamName) { await createTeam(v.teamId, v.teamName, v.channelId || ""); refresh(); }
        setCreatingTeam(false);
      }} />}
      {editMember && <FormModal title={`Edit: ${editMember.display_name}`} fields={[
        { name: "name", label: "Name", type: "text", default: editMember.display_name },
        { name: "rank", label: "Rank", type: "select", options: [{ label: "Guide", value: "Guide" }, { label: "Team Lead", value: "Team Lead" }, { label: "Management", value: "Management" }], default: editMember.rank },
        { name: "lst", label: "Lead Storyteller (full access to all factions)", type: "checkbox", default: !!editMember.lead_storyteller },
      ]} onCancel={() => setEditMember(null)} onSubmit={async (v) => {
        if (v.name !== editMember.display_name) await updateStaff(editMember.id, "display_name", v.name);
        if (v.rank !== editMember.rank) await updateStaff(editMember.id, "rank", v.rank);
        if (!!v.lst !== !!editMember.lead_storyteller) await updateStaff(editMember.id, "lead_storyteller", v.lst ? 1 : 0);
        setEditMember(null); refresh();
      }} />}
      {retireMember && <RetireModal member={retireMember} allStaff={staff}
        onConfirm={async (reassignments) => {
          await retireStaff(retireMember.id, retireMember.display_name, retireMember.discord_id, reassignments);
          const nm = retireMember.display_name;
          setRetireMember(null);
          window.alert(`${nm} has been retired. All historical data is preserved.`);
          refresh();
        }}
        onClose={() => setRetireMember(null)} />}
      {promoteMember && <PromoteModal member={promoteMember} teams={teams} staff={staff}
        onConfirm={async (newTeamName) => {
          await promoteToLead(promoteMember.id, promoteMember.display_name, promoteMember.team_id, newTeamName);
          const cap = promoteMember;
          setPromoteMember(null);
          window.alert(`${cap.display_name} promoted to Team Lead.${newTeamName !== cap.team_name ? `\nTeam renamed to "${newTeamName}".` : ""}`);
          refresh();
        }}
        onTakeover={async ({ existingTeamId, oldLeadStaffId, oldLeadDiscordId, oldLeadStaffName, disposition, newTeamName }) => {
          const result = await takeoverTeam(promoteMember.id, promoteMember.display_name, existingTeamId, oldLeadStaffId, oldLeadDiscordId, oldLeadStaffName, disposition, newTeamName);
          const cap = promoteMember;
          setPromoteMember(null);
          window.alert([
            `${cap.display_name} promoted to Team Lead on "${newTeamName}".`,
            oldLeadStaffName ? `${oldLeadStaffName} ${disposition === "retire" ? "retired" : "returned to Guide"}.` : "",
            `${result.factionsTransferred} faction(s) transferred.`,
            `Discord role synced: ${result.rolesSynced} | Failed: ${result.rolesFailed}`,
          ].filter(Boolean).join("\n"));
          refresh();
        }}
        onClose={() => setPromoteMember(null)} />}
      {showCOIManager && (
        <div style={{ position: "fixed", inset: 0, zIndex: 150, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={() => setShowCOIManager(false)} />
          <div style={{ position: "relative", width: "100%", maxWidth: 680, maxHeight: "85vh", background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 12, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
              <div><div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--amber)" }}>Conflict of interest</div><div style={{ fontWeight: 700, color: "var(--ink-0)" }}>Manage COI — all staff</div></div>
              <button className="act" style={{ padding: "2px 8px" }} onClick={() => setShowCOIManager(false)}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 6 }}>
              {staff.filter(s => !s.rank?.toLowerCase().includes("management")).sort((a, b) => a.display_name.localeCompare(b.display_name)).map(s => {
                const sCOI = coiEntries.filter(e => e.discord_id === s.discord_id);
                return (
                  <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "8px 12px", borderRadius: 10, background: "var(--panel-2)", border: "1px solid var(--line)" }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{s.display_name}</div>
                      <div style={{ fontSize: 10, color: "var(--ink-3)", marginTop: 1 }}>{s.team_name || "Unassigned"} · {s.rank}</div>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, flex: 2, justifyContent: "flex-end" }}>
                      {sCOI.length === 0 && <span style={{ fontSize: 11, fontStyle: "italic", color: "var(--ink-3)" }}>No COI set</span>}
                      {sCOI.map(e => (
                        <span key={e.id} className="chip" style={{ background: "var(--amber-bg)", color: "var(--amber)", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11 }}>
                          {e.faction_name}
                          <button style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 0 }} onClick={async () => { await removeStaffCOI(e.id); await refreshCOI(); }}>×</button>
                        </span>
                      ))}
                    </div>
                    <button className="act" style={{ flexShrink: 0 }} onClick={() => { setShowCOIManager(false); setCoiModalStaff(s); }}>Edit</button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {coiModalStaff && <COIModal staff={coiModalStaff} coiEntries={coiEntries} meridianFactions={meridianFactions}
        onAdd={async (discordId, name, source) => { await addStaffCOI(discordId, name, source); await refreshCOI(); }}
        onRemove={async (id) => { await removeStaffCOI(id); await refreshCOI(); }}
        onClose={() => setCoiModalStaff(null)} />}
    </>
  );
}

function COIModal({ staff, coiEntries, meridianFactions, onAdd, onRemove, onClose }) {
  const [selectedMeridian, setSelectedMeridian] = useState("");
  const [manualEntry, setManualEntry] = useState("");
  const [adding, setAdding] = useState(false);
  const entries = coiEntries.filter(e => e.discord_id === staff.discord_id);
  const handleAdd = async (name, source) => {
    if (!name?.trim()) return;
    setAdding(true);
    await onAdd(staff.discord_id, name.trim(), source);
    setSelectedMeridian(""); setManualEntry("");
    setAdding(false);
  };
  const lbl = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--ink-3)", marginBottom: 6 };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={onClose} />
      <div style={{ position: "relative", width: "100%", maxWidth: 480, background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 12, padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div><div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--amber)" }}>⚠ Conflict of interest</div><div style={{ fontWeight: 700, color: "var(--ink-0)" }}>{staff.display_name}</div></div>
          <button className="act" style={{ padding: "2px 8px" }} onClick={onClose}>✕</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style={lbl}>Flagged factions</div>
            {entries.length === 0 ? <div style={{ fontSize: 12, fontStyle: "italic", color: "var(--ink-3)" }}>None set.</div> : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {entries.map(e => (
                  <span key={e.id} className="chip" style={{ background: "var(--amber-bg)", color: "var(--amber)", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11 }}>
                    {e.faction_name}
                    {e.source === "manual" && <span style={{ fontSize: 9, opacity: 0.7 }}>manual</span>}
                    <button style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 0 }} onClick={() => onRemove(e.id)}>×</button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div>
            <div style={lbl}>Add from Meridian factions</div>
            <div style={{ display: "flex", gap: 8 }}>
              <select className="filter-inp" style={{ flex: 1 }} value={selectedMeridian} onChange={e => setSelectedMeridian(e.target.value)}>
                <option value="">Select faction…</option>
                {meridianFactions.filter(f => !entries.some(e => e.faction_name.toLowerCase() === f.name.toLowerCase())).map(f => <option key={f.id} value={f.name}>{f.name} (T{f.tier})</option>)}
              </select>
              <button className="act primary" disabled={!selectedMeridian || adding} onClick={() => handleAdd(selectedMeridian, "meridian")}>Add</button>
            </div>
          </div>
          <div>
            <div style={lbl}>Add other faction (manual)</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="filter-inp" style={{ flex: 1 }} placeholder="Faction name…" value={manualEntry} onChange={e => setManualEntry(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAdd(manualEntry, "manual")} />
              <button className="act" style={{ color: "var(--amber)" }} disabled={!manualEntry.trim() || adding} onClick={() => handleAdd(manualEntry, "manual")}>Add</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RetireModal({ member, allStaff, onConfirm, onClose }) {
  const [factions, setFactions] = useState(null);
  const [assignments, setAssignments] = useState({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    getStaffFactions(member.discord_id).then(f => {
      setFactions(f);
      setAssignments(Object.fromEntries((f || []).map(x => [x.id, ""])));
    });
  }, [member.discord_id]);
  const otherStaff = allStaff.filter(s => s.discord_id !== member.discord_id);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)" }} onClick={onClose} />
      <div style={{ position: "relative", width: "100%", maxWidth: 520, background: "var(--panel)", border: "1px solid var(--rose)", borderRadius: 12, padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--rose)" }}>Retire staff</div>
            <div style={{ fontWeight: 700, fontSize: 15, color: "var(--ink-0)" }}>{member.display_name}</div>
            <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{member.rank} · {member.team_name}</div>
          </div>
          <button className="act" style={{ padding: "2px 8px" }} onClick={onClose}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-1)", lineHeight: 1.6, padding: "8px 12px", borderRadius: 8, background: "var(--rose-bg)", marginBottom: 12 }}>
          Removing <b>{member.display_name}</b> from active staff. All historical data (scenes, notes, logs) remains attributed to them.
        </div>
        {factions === null ? <div style={{ fontSize: 12, fontStyle: "italic", color: "var(--ink-3)" }}>Loading factions…</div>
          : factions.length === 0 ? <div style={{ fontSize: 12, fontStyle: "italic", color: "var(--ink-3)" }}>No active factions to reassign.</div>
            : <>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--amber)", marginBottom: 8 }}>Reassign factions ({factions.length})</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {factions.map(f => (
                  <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, background: "var(--panel-2)", border: "1px solid var(--line)" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{f.name}</div>
                      <div style={{ fontSize: 9, fontFamily: "var(--v2-mono)", color: "var(--ink-3)" }}>Tier {f.tier}</div>
                    </div>
                    <select className="filter-inp" style={{ minWidth: 150 }} value={assignments[f.id] || ""} onChange={e => setAssignments(prev => ({ ...prev, [f.id]: e.target.value }))}>
                      <option value="">Leave unassigned</option>
                      {otherStaff.map(s => <option key={s.discord_id} value={s.discord_id}>{s.display_name} ({s.rank})</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button className="act" onClick={onClose}>Cancel</button>
          <button className="act" style={{ color: "var(--rose)", fontWeight: 700 }} disabled={saving || factions === null}
            onClick={async () => { setSaving(true); await onConfirm((factions || []).map(f => ({ factionId: f.id, newLeadId: assignments[f.id] || "" }))); setSaving(false); }}>
            {saving ? "Retiring…" : "Confirm retirement"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PromoteModal({ member, teams, staff, onConfirm, onTakeover, onClose }) {
  const [mode, setMode] = useState(null); // null | 'create' | 'takeover'
  const [newTeamName, setNewTeamName] = useState(`Team ${member.display_name}`);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [disposition, setDisposition] = useState("guide");
  const [takeoverTeamName, setTakeoverTeamName] = useState("");
  const [saving, setSaving] = useState(false);
  const currentLead = staff.find(s => s.team_id === selectedTeamId && s.rank?.toLowerCase().includes("lead"));
  useEffect(() => {
    if (!selectedTeamId) { setTakeoverTeamName(""); return; }
    setTakeoverTeamName(teams.find(t => t.id === selectedTeamId)?.name || "");
    setDisposition("guide");
  }, [selectedTeamId]);
  const canTakeover = selectedTeamId && takeoverTeamName.trim() && !saving;
  const lbl = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--ink-3)", marginBottom: 6 };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)" }} onClick={onClose} />
      <div style={{ position: "relative", width: "100%", maxWidth: mode === "takeover" ? 520 : 440, maxHeight: "85vh", overflowY: "auto", background: "var(--panel)", border: "1px solid var(--good)", borderRadius: 12, padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--good)" }}>Promote to Lead</div>
            <div style={{ fontWeight: 700, fontSize: 15, color: "var(--ink-0)" }}>{member.display_name}</div>
            <div style={{ fontSize: 11, color: "var(--ink-3)" }}>Guide → Team Lead · Clearance L1 → L2</div>
          </div>
          <button className="act" style={{ padding: "2px 8px" }} onClick={onClose}>✕</button>
        </div>
        {!mode && <>
          <div style={{ fontSize: 12, color: "var(--ink-1)", lineHeight: 1.6, marginBottom: 12 }}>Is <b>{member.display_name}</b> starting a brand-new team, or taking over an existing one?</div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="act" style={{ flex: 1, padding: "14px 10px", color: "var(--good)", fontWeight: 700 }} onClick={() => setMode("create")}>+ Create new team</button>
            <button className="act" style={{ flex: 1, padding: "14px 10px", color: "var(--accent)", fontWeight: 700 }} onClick={() => setMode("takeover")}>↗ Take over existing team</button>
          </div>
        </>}
        {mode === "create" && <>
          <div style={lbl}>Team name</div>
          <input className="filter-inp" style={{ width: "100%" }} autoFocus value={newTeamName} onChange={e => setNewTeamName(e.target.value)} placeholder="Team name…" />
          <div style={{ fontSize: 10, color: "var(--ink-3)", marginTop: 4 }}>This renames their current team — leave as-is if the name isn't changing.</div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
            <button className="act" onClick={() => setMode(null)}>← Back</button>
            <button className="act" onClick={onClose}>Cancel</button>
            <button className="act primary" disabled={saving || !newTeamName.trim()} onClick={async () => { setSaving(true); await onConfirm(newTeamName); setSaving(false); }}>{saving ? "Promoting…" : "Promote ✓"}</button>
          </div>
        </>}
        {mode === "takeover" && <>
          <div style={lbl}>Team to take over</div>
          <select className="filter-inp" style={{ width: "100%" }} value={selectedTeamId} onChange={e => setSelectedTeamId(e.target.value)}>
            <option value="">Select a team…</option>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {selectedTeamId && <>
            {currentLead ? (
              <div style={{ padding: 12, borderRadius: 10, background: "var(--rose-bg)", margin: "12px 0", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--rose)" }}>Current lead — {currentLead.display_name}</div>
                <div style={{ fontSize: 11, color: "var(--ink-1)", lineHeight: 1.5 }}>All their factions and the team Discord role will be automatically transferred to <b>{member.display_name}</b>. What happens to {currentLead.display_name}?</div>
                {[{ value: "guide", label: "Return to Guide", desc: "Stays on roster · moved to Unassigned" }, { value: "retire", label: "Leaving FM", desc: "Fully retired from the staff roster" }].map(opt => (
                  <label key={opt.value} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "6px 8px", borderRadius: 8, background: disposition === opt.value ? "var(--panel-2)" : "transparent", cursor: "pointer" }}>
                    <input type="radio" name="v2disposition" value={opt.value} checked={disposition === opt.value} onChange={() => setDisposition(opt.value)} style={{ marginTop: 3, flexShrink: 0 }} />
                    <span><span style={{ fontSize: 12, fontWeight: 600, display: "block" }}>{opt.label}</span><span style={{ fontSize: 10, color: "var(--ink-3)" }}>{opt.desc}</span></span>
                  </label>
                ))}
              </div>
            ) : <div style={{ fontSize: 11, fontStyle: "italic", color: "var(--ink-3)", padding: "8px 12px", borderRadius: 8, background: "var(--panel-2)", margin: "12px 0" }}>No current lead on this team.</div>}
            <div style={lbl}>Team name</div>
            <input className="filter-inp" style={{ width: "100%" }} value={takeoverTeamName} onChange={e => setTakeoverTeamName(e.target.value)} placeholder="Team name…" />
            <div style={{ fontSize: 10, color: "var(--ink-3)", marginTop: 4 }}>Edit to rename the team, or leave as-is.</div>
          </>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
            <button className="act" onClick={() => { setMode(null); setSelectedTeamId(""); }}>← Back</button>
            <button className="act" onClick={onClose}>Cancel</button>
            <button className="act primary" disabled={!canTakeover} onClick={async () => {
              setSaving(true);
              await onTakeover({ existingTeamId: selectedTeamId, oldLeadStaffId: currentLead?.id || null, oldLeadDiscordId: currentLead?.discord_id || null, oldLeadStaffName: currentLead?.display_name || null, disposition: currentLead ? disposition : null, newTeamName: takeoverTeamName });
              setSaving(false);
            }}>{saving ? "Processing…" : "Take over ✓"}</button>
          </div>
        </>}
      </div>
    </div>
  );
}

/* ── FM Hours (owner-only): character links, CSV import, monthly report ── */
function parseHoursCSV(raw) {
  const lines = raw.trim().split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headerIdx = lines.findIndex(l => l.toLowerCase().startsWith("name,"));
  if (headerIdx === -1) return [];
  const headers = lines[headerIdx].split(",").map(h => h.trim().toLowerCase());
  const nameCol = headers.indexOf("name");
  const hoursCol = headers.findIndex(h => h.includes("duty hours") || h === "on duty hours");
  if (nameCol === -1 || hoursCol === -1) return [];
  const result = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const rawName = (cols[nameCol] || "").trim().replace(/_/g, " ");
    if (!rawName) continue;
    result.push({ rawName, hours: parseFloat(cols[hoursCol]) || 0 });
  }
  return result;
}
const defaultPeriod = () => {
  const d = new Date();
  const p = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, "0")}`;
};

function FMHours() {
  const [tab, setTab] = useState("links");
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const loadStaff = async () => { setStaff(await getFMStaffWithLinks()); setLoading(false); };
  useEffect(() => { loadStaff(); }, []);
  if (loading) return <div className="empty">Loading…</div>;
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div className="sub-tabs" style={{ padding: 0 }}>
          {[["links", "Character Links"], ["hours", "Import Hours"], ["report", "Post Report"]].map(([id, l]) => (
            <button key={id} className={`tab${tab === id ? " on" : ""}`} onClick={() => setTab(id)}>{l}</button>
          ))}
        </div>
        <span style={{ fontSize: 11, color: "var(--ink-3)" }}>Monthly activity tracking for Faction Management · visible only to you</span>
      </div>
      {tab === "links" && <CharacterLinks staff={staff} onSaved={loadStaff} />}
      {tab === "hours" && <ImportHours staff={staff} />}
      {tab === "report" && <PostReport staff={staff} />}
    </>
  );
}

function CharacterLinks({ staff, onSaved }) {
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState({});
  const get = (id, field, fallback) => edits[id]?.[field] !== undefined ? edits[id][field] : fallback;
  const set = (id, field, value) => setEdits(p => ({ ...p, [id]: { ...p[id], [field]: value } }));
  const isDirty = (m) => {
    const e = edits[m.discord_id];
    if (!e) return false;
    return (e.character_name !== undefined && e.character_name !== m.character_name) || (e.category !== undefined && e.category !== m.category);
  };
  const save = async (m) => {
    if (!isDirty(m)) return;
    setSaving(p => ({ ...p, [m.discord_id]: true }));
    await setCharacterLink(m.discord_id, get(m.discord_id, "character_name", m.character_name), get(m.discord_id, "category", m.category));
    setSaving(p => ({ ...p, [m.discord_id]: false }));
    onSaved();
  };
  return (
    <>
      <p style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 14 }}>Link each FM member to their in-game character name and mark whether they are Support or Moderator — this determines which group they appear in on the monthly report.</p>
      <div className="card"><div style={{ overflowX: "auto" }}>
        <table className="dtable" style={{ minWidth: 640 }}>
          <thead><tr><th>Display name</th><th>Team</th><th>Character name</th><th style={{ width: 150 }}>Group</th><th style={{ width: 70 }}></th></tr></thead>
          <tbody>
            {staff.map(m => {
              const charVal = get(m.discord_id, "character_name", m.character_name);
              const catVal = get(m.discord_id, "category", m.category);
              const dirty = isDirty(m);
              return (
                <tr key={m.discord_id}>
                  <td style={{ fontWeight: 600 }}>{m.display_name}</td>
                  <td style={{ color: "var(--ink-2)" }}>{m.team_name || "Unassigned"}</td>
                  <td><input className="filter-inp" style={{ width: "100%", borderColor: dirty ? "var(--accent)" : undefined }} value={charVal} placeholder="In-game character name…" onChange={e => set(m.discord_id, "character_name", e.target.value)} onKeyDown={e => e.key === "Enter" && save(m)} /></td>
                  <td>
                    <select className="filter-inp" style={{ width: "100%", fontWeight: 700, color: catVal === "moderator" ? "var(--amber)" : catVal === "non-fm" ? "var(--ink-3)" : "var(--accent)" }} value={catVal} onChange={e => set(m.discord_id, "category", e.target.value)}>
                      <option value="support">Support</option>
                      <option value="moderator">Moderator</option>
                      <option value="non-fm">Non-FM (exclude)</option>
                    </select>
                  </td>
                  <td>{dirty && <button className="act primary" disabled={saving[m.discord_id]} onClick={() => save(m)}>Save</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div></div>
    </>
  );
}

function ImportHours({ staff }) {
  const [csv, setCsv] = useState("");
  const [parsed, setParsed] = useState(null);
  const [period, setPeriod] = useState(defaultPeriod());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const charMap = useMemo(() => {
    const m = {};
    staff.forEach(s => { if (s.character_name) m[s.character_name.toLowerCase()] = s; });
    return m;
  }, [staff]);
  const handleParse = () => {
    setError(""); setParsed(null); setSaved(false);
    const rows = parseHoursCSV(csv);
    if (!rows.length) { setError('Could not parse — paste the full export including the header row (must start with "Name," and include an "On Duty Hours" column).'); return; }
    setParsed(rows.map(r => ({ ...r, staff: charMap[r.rawName.toLowerCase()] || null })));
  };
  const handleSave = async () => {
    if (!parsed) return;
    setSaving(true);
    const res = await saveFMHours(period, parsed.filter(r => r.staff).map(r => ({ discord_id: r.staff.discord_id, hours: r.hours })));
    setSaving(false);
    if (res.ok) setSaved(true); else setError(res.error);
  };
  const matched = parsed?.filter(r => r.staff).length ?? 0;
  const unmatched = parsed?.filter(r => !r.staff).length ?? 0;
  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--ink-3)", marginBottom: 4 }}>Period</div>
        <input type="month" className="filter-inp" style={{ maxWidth: 170 }} value={period} onChange={e => setPeriod(e.target.value)} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--ink-3)", marginBottom: 4 }}>Paste hours data (CSV)</div>
        <textarea className="filter-inp" style={{ width: "100%", fontFamily: "var(--v2-mono)", fontSize: 11, minHeight: 170 }} placeholder={"Name,Branch,Group,On Duty Hours,Pay Amount\nJohn Character,Branch,Group,12.50,0\n…"} value={csv} onChange={e => { setCsv(e.target.value); setParsed(null); setSaved(false); }} />
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
        <button className="btn" disabled={!csv.trim()} onClick={handleParse}>Parse & preview</button>
        {parsed && <button className="act primary" disabled={saving || matched === 0} onClick={handleSave}>{saving ? "Saving…" : `Save ${matched} matched`}</button>}
        {saved && <span style={{ fontSize: 12, fontWeight: 600, color: "var(--good)" }}>✓ Saved</span>}
      </div>
      {error && <div style={{ padding: "8px 12px", borderRadius: 8, background: "var(--rose-bg)", fontSize: 12, color: "var(--rose)", marginBottom: 12 }}>{error}</div>}
      {parsed && (
        <div className="card">
          <div className="hd"><div className="t" style={{ color: "var(--good)" }}>✓ {matched} matched</div>{unmatched > 0 && <div className="meta" style={{ color: "var(--amber)" }}>⚠ {unmatched} unmatched (no character link)</div>}</div>
          <div style={{ overflowX: "auto" }}>
            <table className="dtable" style={{ minWidth: 480 }}>
              <thead><tr><th>Character name (CSV)</th><th>FM member</th><th style={{ textAlign: "right" }}>Hours</th></tr></thead>
              <tbody>
                {parsed.map((r, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: "var(--v2-mono)" }}>{r.rawName}</td>
                    <td>{r.staff ? <span style={{ color: "var(--good)" }}>{r.staff.display_name}</span> : <span style={{ color: "var(--amber)", fontStyle: "italic" }}>No match — set character link</span>}</td>
                    <td style={{ textAlign: "right", fontFamily: "var(--v2-mono)", fontWeight: 600 }}>{r.hours.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function PostReport({ staff }) {
  const [period, setPeriod] = useState(defaultPeriod());
  const [testMode, setTest] = useState(true);
  const [hours, setHours] = useState({});
  const [scenes, setScenes] = useState({});
  const [meetings, setMeetings] = useState({});
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [result, setResult] = useState(null);
  const loadData = async () => {
    if (!period) return;
    setLoading(true); setResult(null);
    const [y, m] = period.split("-").map(Number);
    const [h, sc, mt] = await Promise.all([getFMHoursForPeriod(period), getFMScenesForPeriod(y, m), getFMMeetingsForPeriod(y, m)]);
    const hm = {}; h.forEach(r => { hm[r.discord_id] = r.hours; });
    setHours(hm); setScenes(sc); setMeetings(mt);
    setLoading(false);
  };
  const handlePost = async () => { setPosting(true); setResult(null); const res = await postFMReport({ period, testMode }); setPosting(false); setResult(res); };
  const monthName = period ? new Date(+period.split("-")[0], +period.split("-")[1] - 1, 1).toLocaleString("en-GB", { month: "long", year: "numeric" }) : "";
  const hasData = Object.keys(hours).length > 0 || Object.keys(scenes).length > 0;
  const Section = ({ title, color, list }) => (
    <div className="card">
      <div className="hd"><div className="t" style={{ color }}>{title} — {monthName}</div></div>
      <div style={{ overflowX: "auto" }}>
        <table className="dtable" style={{ minWidth: 480 }}>
          <thead><tr><th>Name</th><th style={{ textAlign: "right" }}>Hours</th><th style={{ textAlign: "right" }}>Scenes</th><th style={{ textAlign: "right" }}>Meetings</th></tr></thead>
          <tbody>
            {list.map(m => (
              <tr key={m.discord_id}>
                <td style={{ fontWeight: 600 }}>{m.display_name}</td>
                <td style={{ textAlign: "right", fontFamily: "var(--v2-mono)", color: hours[m.discord_id] ? "var(--ink-0)" : "var(--ink-3)" }}>{(hours[m.discord_id] || 0).toFixed(1)}h</td>
                <td style={{ textAlign: "right", fontFamily: "var(--v2-mono)", color: scenes[m.discord_id] ? "var(--accent)" : "var(--ink-3)" }}>{scenes[m.discord_id] || 0}</td>
                <td style={{ textAlign: "right", fontFamily: "var(--v2-mono)", color: meetings[m.discord_id] ? "var(--good)" : "var(--ink-3)" }}>{meetings[m.discord_id] || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
  return (
    <>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {[["Clocked On Hours", "Meridian RP"], ["Avg Scene", "≈ 2 hours"], ["Avg Meeting", "≈ 1 hour"]].map(([label, desc]) => (
          <span key={label} className="chip role" style={{ fontSize: 11, padding: "4px 10px" }}><b>{label}:</b>&nbsp;{desc}</span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--ink-3)", marginBottom: 4 }}>Period</div>
          <input type="month" className="filter-inp" style={{ maxWidth: 170 }} value={period} onChange={e => setPeriod(e.target.value)} />
        </div>
        <button className="act" disabled={loading} onClick={loadData}>{loading ? "Loading…" : "Load data"}</button>
      </div>
      {hasData ? <>
        <Section title="Support Staff" color="var(--accent)" list={staff.filter(s => s.category === "support")} />
        <Section title="Moderator+" color="var(--amber)" list={staff.filter(s => s.category === "moderator")} />
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "12px 16px", borderRadius: 10, background: testMode ? "var(--amber-bg)" : "var(--rose-bg)" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, color: testMode ? "var(--amber)" : "var(--rose)" }}>
            <input type="checkbox" checked={testMode} onChange={e => setTest(e.target.checked)} />
            {testMode ? "Test mode (posts to test server)" : "LIVE mode (posts to production)"}
          </label>
          <button className="act" style={{ fontWeight: 700, color: testMode ? "var(--amber)" : "var(--rose)" }} disabled={posting} onClick={handlePost}>
            {posting ? "Posting…" : testMode ? "Post to test server" : "Post LIVE report"}
          </button>
          {result && <span style={{ fontSize: 12, fontWeight: 600, color: result.ok ? "var(--good)" : "var(--rose)" }}>{result.ok ? `✓ Posted${result.testMode ? " to test server" : " live"}` : `✗ ${result.error}`}</span>}
        </div>
      </> : <div className="empty">Select a period and click Load data to preview the report.</div>}
    </>
  );
}
