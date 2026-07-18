"use client";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../lib/useAuth";
import { getAuditLog, deleteAuditLogEntry, getArchivedFactions, restoreFaction } from "../../fm/operations/actions.js";
import { getInventory, addInventoryItem, updateStock, deleteInventoryItem, getDistributionStats } from "../../fm/inventory/actions.js";
import { getLinks, saveLinks, publishLinks } from "../../fm/operations/links/actions.js";

const GROUPS = [
  { id: "people", label: "People", items: [["staff", "Staff & Teams", true], ["hours", "FM Hours", true], ["dbaccess", "DB Access", true]] },
  { id: "catalogs", label: "Catalogs", items: [["inventory", "Inventory", false], ["vehicles", "Vehicle Catalog", true], ["imports", "Import Catalog", true]] },
  { id: "config", label: "Config", items: [["links", "Important Links", false], ["reminders", "Recurring Reminders", true], ["docs", "Documents", true], ["channels", "Faction Channels", true]] },
  { id: "records", label: "Records", items: [["audit", "Audit Log", false], ["archive", "Archive", false], ["memberlog", "Member Log", true], ["convos", "Conversations", true]] },
];

export default function V2Admin() {
  const auth = useAuth();
  const can = (auth?.level || 0) >= 3 || auth?.isEventTeam;
  const [group, setGroup] = useState("records");
  const [view, setView] = useState("audit");

  if (auth?.loading) return <div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>;
  if (!auth?.ok || !can) return <div className="view" style={{ color: "var(--ink-3)" }}>Management (L3) access required.</div>;

  const activeGroup = GROUPS.find(g => g.id === group);
  const soon = activeGroup.items.find(i => i[0] === view)?.[2];

  return (
    <div className="view">
      <div className="page-head"><div><p className="eyebrow">Admin</p><h1>Administration</h1><div className="sub">People, catalogs, configuration and records.</div></div></div>
      <div className="hub-tabs">
        {GROUPS.map(g => <button key={g.id} className={`hub-tab${group === g.id ? " on" : ""}`} onClick={() => { setGroup(g.id); setView(g.items[0][0]); }}>{g.label}</button>)}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
        {activeGroup.items.map(([id, label, isSoon]) => (
          <button key={id} className={`pill${view === id ? " on" : ""}`} onClick={() => setView(id)}>{label}{isSoon && <span className="ct">soon</span>}</button>
        ))}
      </div>

      {soon ? <div className="empty">“{activeGroup.items.find(i => i[0] === view)?.[1]}” — porting in the fine-tune pass. Still live at the old dashboard meanwhile.</div>
        : view === "audit" ? <Audit />
        : view === "archive" ? <Archive />
        : view === "inventory" ? <Inventory auth={auth} />
        : view === "links" ? <Links />
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
