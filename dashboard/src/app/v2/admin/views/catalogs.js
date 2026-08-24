"use client";
// Admin › Catalogs: Inventory, Import Catalog, Properties.
// Split out of admin/page.js — content unchanged. (The Vehicle Catalog moved
// to the Library on 2026-08-05; it lives in v2/story/VehicleCatalog.js.)
import React, { useEffect, useState } from "react";
import { getInventory, addInventoryItem, deleteInventoryItem, getDistributionStats } from "../../../fm/inventory/actions.js";
import { getGlobalImports, addImportItem, editImportItem, deleteImportItem, getGlobalProperties, addGlobalProperty, assignProperty, confiscateProperty, deleteProperty, editPropertyDetail } from "../../../fm/operations/actions.js";

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
  const cats = items.reduce((a, i) => { (a[i.category] = a[i.category] || []).push(i); return a; }, {});
  const remove = async (i) => { if (window.confirm(`Remove "${i.name}" from the item list?`)) { await deleteInventoryItem(i.id); load(); } };
  const saveAdd = async () => { if (!add.name.trim()) return; await addInventoryItem({ name: add.name, category: add.category }); setAdd(null); load(); };
  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
        {isL3 && <div className="sub-tabs" style={{ padding: 0 }}><button className={`tab${tab === "stock" ? " on" : ""}`} onClick={() => setTab("stock")}>Items</button><button className={`tab${tab === "analytics" ? " on" : ""}`} onClick={() => setTab("analytics")}>Given out</button></div>}
        <span style={{ flex: 1 }} />
        {isL3 && <button className="btn" onClick={() => setAdd({ name: "", category: "" })}>Add item +</button>}
      </div>
      {tab === "stock" ? <>
        {Object.entries(cats).sort((a, b) => a[0].localeCompare(b[0])).map(([cat, list]) => (
          <div className="card" key={cat}><div className="hd"><div className="t">{cat}</div><div className="meta">{list.length}</div></div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 6, paddingTop: 6 }}>
              {list.map(i => <div key={i.id} style={{ display: "flex", justifyContent: "space-between", gap: 6, padding: "8px 10px", borderRadius: 8, background: "var(--panel-2)" }}><span style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-1)" }}>{i.name}</span>{isL3 && <button onClick={() => remove(i)} title={`Remove ${i.name}`} style={{ background: "none", border: 0, cursor: "pointer", color: "var(--ink-3)", fontSize: 11, padding: 0 }}>✕</button>}</div>)}
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
            <div style={{ fontWeight: 700, color: "var(--ink-0)", marginBottom: 14 }}>Add item</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input className="filter-inp" placeholder="Name" value={add.name} onChange={e => setAdd({ ...add, name: e.target.value })} />
              <input className="filter-inp" placeholder="Category" value={add.category} onChange={e => setAdd({ ...add, category: e.target.value })} />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}><button className="act" onClick={() => setAdd(null)}>Cancel</button><button className="act primary" disabled={!add.name.trim()} onClick={saveAdd}>Save</button></div>
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

/* ── Properties (global list — port of /fm/operations/properties) ── */
const P_EMPTY = { address: "", faction: "", type: "Property", isHQ: false, owner: "", notes: "" };
function Properties({ canEdit }) {
  const [props, setProps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [form, setForm] = useState(null);     // {id?, ...P_EMPTY} — modal for add + edit (faction only on add; Assign moves it)
  const [assign, setAssign] = useState(null); // {id, address, faction}
  const load = () => getGlobalProperties().then(p => { setProps(p || []); setLoading(false); });
  useEffect(() => { load(); }, []);
  if (loading) return <div className="empty">Loading…</div>;
  const isUnassigned = f => !f || !f.trim() || f.toLowerCase() === "none";
  const filtered = props.filter(p => {
    const s = q.toLowerCase();
    if (q && !p.address?.toLowerCase().includes(s) && !p.faction?.toLowerCase().includes(s) && !p.current_owner?.toLowerCase().includes(s)) return false;
    if (filter === "active") return !p.confiscated && !isUnassigned(p.faction);
    if (filter === "confiscated") return p.confiscated;
    if (filter === "unassigned") return !p.confiscated && isUnassigned(p.faction);
    return true;
  });
  const submit = async () => {
    if (!form.address.trim()) return;
    if (form.id) await editPropertyDetail(form.id, { address: form.address, type: form.type, isHQ: form.isHQ, owner: form.owner, notes: form.notes });
    else await addGlobalProperty({ address: form.address, faction: form.faction || "", type: form.type || "Property", isHQ: !!form.isHQ, owner: form.owner || "", notes: form.notes || "" });
    setForm(null); load();
  };
  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
        <div className="sub-tabs" style={{ padding: 0 }}>
          {["all", "active", "confiscated", "unassigned"].map(f => (
            <button key={f} className={`tab${filter === f ? " on" : ""}`} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
        <input className="filter-inp" placeholder="Search address, faction, owner…" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 300 }} />
        <span style={{ flex: 1 }} />
        {canEdit && <button className="btn" onClick={() => setForm({ ...P_EMPTY })}>Add property +</button>}
      </div>
      <div className="card">
        <div style={{ overflowX: "auto" }}>
          <table className="dtable" style={{ minWidth: 760 }}>
            <thead><tr><th>Status</th><th>Faction</th><th>Address</th><th>Type</th><th>Owner</th>{canEdit && <th></th>}</tr></thead>
            <tbody>
              {filtered.map(p => {
                const none = isUnassigned(p.faction);
                const status = p.confiscated ? "CONF" : none ? "NONE" : "ACTIVE";
                const col = p.confiscated ? "var(--rose)" : none ? "var(--ink-3)" : "var(--good)";
                return (
                  <tr key={p.id}>
                    <td><span style={{ fontFamily: "var(--v2-mono)", fontSize: 10, fontWeight: 700, color: col }}>{status}</span></td>
                    <td style={{ fontWeight: 600 }}>{none ? <span style={{ color: "var(--ink-3)" }}>—</span> : p.faction}</td>
                    <td>
                      <div style={{ fontFamily: "var(--v2-mono)", fontSize: 12, color: "var(--ink-1)" }}>{p.address}</div>
                      {p.notes && <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2, lineHeight: 1.4 }}>{p.notes}</div>}
                    </td>
                    <td>{p.type || "Property"}{p.is_hq ? <> <span className="chip lock">HQ</span></> : null}</td>
                    <td style={{ color: p.current_owner ? "var(--ink-1)" : "var(--ink-3)" }}>{p.current_owner || <span style={{ fontStyle: "italic", fontSize: 11 }}>—</span>}</td>
                    {canEdit && (
                      <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                        <button className="act" style={{ padding: "2px 7px" }} onClick={() => setForm({ id: p.id, address: p.address, type: p.type || "Property", isHQ: !!p.is_hq, owner: p.current_owner || "", notes: p.notes || "" })}>Edit</button>{" "}
                        <button className="act" style={{ padding: "2px 7px" }} onClick={() => setAssign({ id: p.id, address: p.address, faction: p.faction || "" })}>Assign</button>{" "}
                        {!p.confiscated && !none && <><button className="act" style={{ padding: "2px 7px", color: "var(--amber)" }} onClick={async () => { if (window.confirm(`Confiscate ${p.address}? This unassigns it from ${p.faction}.`)) { await confiscateProperty(p.id); load(); } }}>Conf.</button>{" "}</>}
                        <button className="act" style={{ padding: "2px 7px", color: "var(--rose)" }} onClick={async () => { if (window.confirm("Delete this property?")) { await deleteProperty(p.id); load(); } }}>Del</button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && <div className="empty">No properties found.</div>}
      </div>
      {form && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={() => setForm(null)} />
          <div style={{ position: "relative", width: "100%", maxWidth: 480, background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 12, padding: 18 }}>
            <div style={{ fontWeight: 700, color: "var(--ink-0)", marginBottom: 14 }}>{form.id ? `Edit "${form.address}"` : "Add property"}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input className="filter-inp" placeholder="Address *" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
              {!form.id && <input className="filter-inp" placeholder="Faction (blank = unassigned)" value={form.faction} onChange={e => setForm({ ...form, faction: e.target.value })} />}
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input className="filter-inp" placeholder="Type (e.g. HQ, Warehouse, Property)" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} />
                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", whiteSpace: "nowrap", fontSize: 12, color: "var(--ink-1)" }}>
                  <input type="checkbox" checked={form.isHQ} onChange={e => setForm({ ...form, isHQ: e.target.checked })} /> Mark as HQ
                </label>
              </div>
              <input className="filter-inp" placeholder="Current owner (character name)" value={form.owner} onChange={e => setForm({ ...form, owner: e.target.value })} />
              <textarea className="filter-inp" rows={2} style={{ resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }} placeholder="Notes — any relevant details…" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button className="act" onClick={() => setForm(null)}>Cancel</button>
              <button className="act primary" disabled={!form.address.trim()} onClick={submit}>{form.id ? "Save" : "Add"}</button>
            </div>
          </div>
        </div>
      )}
      {assign && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={() => setAssign(null)} />
          <div style={{ position: "relative", width: "100%", maxWidth: 420, background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 12, padding: 18 }}>
            <div style={{ fontWeight: 700, color: "var(--ink-0)", marginBottom: 6 }}>Assign property</div>
            <div style={{ fontSize: 12, color: "var(--ink-2)", marginBottom: 12, fontFamily: "var(--v2-mono)" }}>{assign.address}</div>
            <input className="filter-inp" placeholder="Faction name (exact)" value={assign.faction} onChange={e => setAssign({ ...assign, faction: e.target.value })} />
            <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 6 }}>Assigning also clears any confiscation and resets the given-date to today.</div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button className="act" onClick={() => setAssign(null)}>Cancel</button>
              <button className="act primary" disabled={!assign.faction.trim()} onClick={async () => { await assignProperty(assign.id, assign.faction.trim()); setAssign(null); load(); }}>Assign</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export { Inventory, Imports, Properties };
