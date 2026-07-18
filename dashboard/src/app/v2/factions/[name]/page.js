"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "../../../../lib/useAuth";
import {
  getFactions, getFactionDetail, getFactionContacts, getFactionImports,
  toggleFactionImport, stagePromotion, completePromotion, cancelPromotion, demoteFaction,
} from "../../../fm/factions/actions.js";
import { getReviewHistory } from "../../../fm/leadership/actions.js";
import {
  getFleetOverview, getFleetTierDefaults,
  addFleetVehicle, deleteFleetVehicle, addFleetGarage, deleteFleetGarage,
  setFleetOverride, clearFleetOverride,
} from "../../../fm/operations/actions.js";

const tierBand = (t) => (t >= 7 ? "hi" : t >= 4 ? "mid" : "lo");
const IC_STATUS = {
  pending_discussion: { c: "disc", l: "Pending Discussion" },
  pending_roleplay: { c: "rp", l: "Pending Roleplay" },
  completed: { c: "done", l: "Completed" },
};
const money = (n) => "$" + (n || 0).toLocaleString();

function CapBar({ label, used, max }) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return (
    <div className="cap">
      <span className="lbl">{label}</span>
      <span className="bar"><span className={`fill${used >= max && max > 0 ? " full" : ""}`} style={{ width: `${pct}%` }} /></span>
      <span className="num"><b>{used}</b> / {max}</span>
    </div>
  );
}

export default function FactionHub() {
  const auth = useAuth();
  const params = useParams();
  const name = params?.name ? decodeURIComponent(params.name) : "";
  const level = auth?.level || 0;
  const isL3 = level >= 3;
  const isLeader = level >= 2 || auth?.isLeadStoryteller;

  const [summary, setSummary] = useState(null);
  const [detail, setDetail] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [imports, setImports] = useState([]);
  const [fleet, setFleet] = useState(null);
  const [tierDefaults, setTierDefaults] = useState({});
  const [reviews, setReviews] = useState([]);
  const [tab, setTab] = useState("overview");
  const [actSub, setActSub] = useState("scenes");
  const [capSub, setCapSub] = useState("imports");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [form, setForm] = useState(null); // { kind, ...fields }

  const load = async () => {
    const facs = await getFactions().catch(() => []);
    const s = (facs || []).find(f => f.name === name);
    setSummary(s || null);
    const d = await getFactionDetail(name).catch(() => null);
    if (!d) { setNotFound(true); setLoading(false); return; }
    setDetail(d);
    getFactionContacts(d.id).then(c => setContacts(c || [])).catch(() => {});
    getFactionImports(d.id).then(i => setImports(i || [])).catch(() => {});
    getFleetTierDefaults().then(setTierDefaults).catch(() => {});
    if (isL3) getFleetOverview().then(all => setFleet((all || []).find(f => f.id === d.id) || null)).catch(() => {});
    if (isLeader) getReviewHistory(d.id).then(r => setReviews(r || [])).catch(() => {});
    setLoading(false);
  };

  useEffect(() => {
    if (auth?.loading || !auth?.id || !name) return;
    load();
  }, [auth?.id, auth?.loading, name]);

  const run = async (fn) => {
    setBusy(true); setErr("");
    try { const r = await fn(); if (r && r.ok === false) { setErr(r.error || "Action failed."); setBusy(false); return false; } }
    catch (e) { setErr("Action failed."); setBusy(false); return false; }
    setBusy(false); setForm(null); await load(); return true;
  };

  if (auth?.loading || loading) return <div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>;
  if (!auth?.ok) return <div className="view" style={{ color: "var(--ink-3)" }}>Not authorized.</div>;
  if (notFound) return <div className="view"><Link className="hub-back" href="/v2/factions">← Factions</Link><div className="empty">Faction “{name}” not found.</div></div>;

  const activeIC = contacts.filter(c => c.status !== "completed").length;
  const permittedCount = imports.filter(i => i.permitted).length;
  const td = tierDefaults[detail.tier] || {};
  const staged = detail.pendingPromo ? (() => { try { return JSON.parse(detail.pendingPromo); } catch { return null; } })() : null;

  const TABS = [
    { id: "overview", label: "Overview" },
    { id: "roster", label: "Roster" },
    { id: "activity", label: "Activity" },
    { id: "capabilities", label: "Capabilities" },
    { id: "comms", label: `Comms${activeIC ? ` · ${activeIC}` : ""}` },
    ...(isLeader ? [{ id: "review", label: "Review", lock: true }] : []),
  ];

  return (
    <div className="view">
      <Link className="hub-back" href="/v2/factions">← Factions</Link>
      <div className="page-head" style={{ marginBottom: 4 }}>
        <div className="hub-title">
          <h1>{detail.name}</h1>
          <span className={`tier ${tierBand(detail.tier)}`} style={{ fontSize: 11, padding: "3px 8px" }}>Tier {detail.tier}</span>
          {summary?.teamName && <span className="chip role">{summary.teamName}</span>}
          {staged && <span className="chip lock">🔒 Promo staged → T{staged.tier}</span>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {detail.forum && <a className="btn ghost" href={detail.forum} target="_blank" rel="noreferrer">Forum ↗</a>}
          <a className="btn ghost" href={`https://meridiandatabase.net/faction/${encodeURIComponent(detail.name)}`} target="_blank" rel="noreferrer">Portal ↗</a>
        </div>
      </div>

      <div className="hub-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`hub-tab${tab === t.id ? " on" : ""}`} onClick={() => { setTab(t.id); setForm(null); setErr(""); }}>
            {t.lock && <span className="lk">🔒</span>}{t.label}
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {tab === "overview" && (
        <div className="hub-body">
          <div className="stack">
            <div className="card">
              <div className="hd"><div className="t">Standing</div><div className="meta">Tier {detail.tier}</div></div>
              <div className="kv">
                <div><div className="k">Imports allowed</div><div className="v">{permittedCount}</div></div>
                <div><div className="k">Fleet cap</div><div className="v">{td.total ?? "—"} <span style={{ fontSize: 11, color: "var(--ink-3)" }}>({td.types ?? "—"} types)</span></div></div>
                <div><div className="k">Garages</div><div className="v">{td.garages ?? "—"}</div></div>
                <div><div className="k">Monthly stipend</div><div className="v">{td.stipend != null ? money(td.stipend) : "—"}</div></div>
                <div><div className="k">Scenes · 30d</div><div className="v">{summary?.scenes30d ?? "—"}</div></div>
                <div><div className="k">Last promoted</div><div className="v">{detail.lastPromoted || "N/A"}</div></div>
              </div>
            </div>
            <div className="card">
              <div className="hd"><div className="t">This month</div></div>
              <div className="kv">
                <div><div className="k">Scenes · 30d</div><div className="v">{summary?.scenes30d ?? 0}</div></div>
                <div><div className="k">Forum · 30d</div><div className="v">{summary?.forumPosts ?? 0}</div></div>
                <div><div className="k">Lead</div><div className="v">{summary?.leadName || "—"}</div></div>
              </div>
            </div>
          </div>
          <div className="stack">
            <div className="card">
              <div className="hd"><div className="t">Needs attention</div></div>
              <div style={{ padding: "12px 16px" }}>
                <div className="alerts">
                  {staged && <span className="alert promo">📋 Promotion staged → T{staged.tier}</span>}
                  {activeIC > 0 && <span className="alert rp">📨 {activeIC} open IC contact{activeIC > 1 ? "s" : ""}</span>}
                  {!staged && activeIC === 0 && <span style={{ color: "var(--ink-3)", fontSize: 12.5 }}>Nothing pending.</span>}
                </div>
                {isLeader && (
                  <div className="qa">
                    <button className="act" onClick={() => setTab("review")}>Open review</button>
                    <button className="act" onClick={() => setTab("comms")}>IC contacts</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Roster ── */}
      {tab === "roster" && (
        <div className="card">
          <div className="hd"><div className="t">Dossier</div><div className="meta">{detail.members.length} known · lead {summary?.leadName || "—"}</div></div>
          {detail.members.length === 0 ? <div className="empty">No members recorded.</div> : (
            <table className="dtable">
              <thead><tr><th>Character</th><th>Phone</th><th>Residence</th><th>Role</th></tr></thead>
              <tbody>
                {detail.members.map(m => (
                  <tr key={m.id}><td><b>{m.character_name}</b></td><td>{m.phone && m.phone !== "N/A" ? m.phone : "—"}</td><td>{m.residence && m.residence !== "N/A" ? m.residence : "—"}</td><td>{m.isLeader ? <span className="chip lock">Leader</span> : <span className="chip role">Member</span>}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Activity ── */}
      {tab === "activity" && (
        <div className="card">
          <div className="sub-tabs">
            <button className={`tab${actSub === "scenes" ? " on" : ""}`} onClick={() => setActSub("scenes")}>Scenes ({detail.sceneLogs.length})</button>
            <button className={`tab${actSub === "intel" ? " on" : ""}`} onClick={() => setActSub("intel")}>Intel ({detail.notes.length})</button>
            <button className={`tab${actSub === "ooc" ? " on" : ""}`} onClick={() => setActSub("ooc")}>OOC ({detail.oocNotes.length})</button>
          </div>
          <div style={{ borderTop: "1px solid var(--line)", marginTop: 10 }}>
            {actSub === "scenes" && (detail.sceneLogs.length === 0 ? <div className="empty">No scenes.</div> :
              <table className="dtable"><thead><tr><th>Date</th><th>By</th><th>Rewards</th><th>Notes</th></tr></thead><tbody>
                {detail.sceneLogs.map(s => <tr key={s.id}><td>{s.date}</td><td><b>{s.logged_by}</b></td><td>{s.rewards}</td><td style={{ color: "var(--ink-2)" }}>{(s.notes || "").slice(0, 80)}</td></tr>)}
              </tbody></table>)}
            {actSub === "intel" && (detail.notes.length === 0 ? <div className="empty">No intel notes.</div> :
              detail.notes.map(n => <div className="note" key={n.id}>{n.text}<div className="by">— {n.author} · {n.date}</div></div>))}
            {actSub === "ooc" && (detail.oocNotes.length === 0 ? <div className="empty">No OOC notes.</div> :
              detail.oocNotes.map(n => <div className="note" key={n.id}>{n.text}<div className="by">— {n.author} · {n.date}</div></div>))}
          </div>
        </div>
      )}

      {/* ── Capabilities: Imports + Fleet ── */}
      {tab === "capabilities" && (
        <div className="card">
          <div className="sub-tabs">
            <button className={`tab${capSub === "imports" ? " on" : ""}`} onClick={() => setCapSub("imports")}>Imports ({permittedCount})</button>
            <button className={`tab${capSub === "fleet" ? " on" : ""}`} onClick={() => setCapSub("fleet")}>Fleet</button>
          </div>
          <div style={{ borderTop: "1px solid var(--line)", marginTop: 10 }}>
            {capSub === "imports" && (
              <>
                <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--ink-2)" }}>
                  {permittedCount} authorized · {isL3 ? "toggle to change" : "L3 manages authorizations"}
                </div>
                {Object.entries(imports.reduce((acc, i) => { (acc[i.tier] = acc[i.tier] || []).push(i); return acc; }, {}))
                  .sort((a, b) => a[0] - b[0]).map(([tier, items]) => (
                    <div key={tier}>
                      <div className="imp-grp">Tier {tier}</div>
                      {items.map(i => (
                        <div className="imp-row" key={i.id}>
                          <span className="nm">{i.name}{i.category ? <span style={{ color: "var(--ink-3)", marginLeft: 6, fontSize: 11 }}>{i.category}</span> : null}</span>
                          <button className={`tg${i.permitted ? " on" : ""}`} disabled={!isL3 || busy}
                            onClick={() => run(() => toggleFactionImport(detail.id, i.id, !i.permitted))}>
                            {i.permitted ? "Authorized" : "Off"}
                          </button>
                        </div>
                      ))}
                    </div>
                  ))}
              </>
            )}
            {capSub === "fleet" && (
              <div style={{ padding: "4px 0" }}>
                <div className="imp-grp">Tier {detail.tier} allowance</div>
                {fleet ? (
                  <>
                    <CapBar label="Vehicle types" used={fleet.typeCount} max={fleet.limits.maxTypes} />
                    <CapBar label="Total vehicles" used={fleet.totalQuantity} max={fleet.limits.maxTotal} />
                    <CapBar label="Garages" used={fleet.garages.length} max={fleet.limits.maxGarages} />
                    <div className="cap"><span className="lbl">Stipend</span><span className="num" style={{ width: "auto" }}><b>{money(fleet.defaults.stipend)}</b>/mo</span>
                      {fleet.limits.isOverridden && <span className="chip lock" style={{ marginLeft: 8 }}>Override</span>}</div>
                    <div className="imp-grp">Vehicles</div>
                    {fleet.vehicles.length === 0 ? <div className="empty">No vehicles.</div> : fleet.vehicles.map(v => (
                      <div className="imp-row" key={v.id}>
                        <span className="nm"><b style={{ color: "var(--ink-0)" }}>{v.quantity}×</b> {v.vehicle_name}{v.notes ? <span style={{ color: "var(--ink-3)", marginLeft: 6, fontSize: 11 }}>{v.notes}</span> : null}</span>
                        {isL3 && <button className="tg" disabled={busy} onClick={() => run(() => deleteFleetVehicle(v.id))}>Remove</button>}
                      </div>
                    ))}
                    <div className="imp-grp">Garages</div>
                    {fleet.garages.length === 0 ? <div className="empty">No garages.</div> : fleet.garages.map(g => (
                      <div className="imp-row" key={g.id}>
                        <span className="nm"><b style={{ color: "var(--ink-0)" }}>{g.name}</b> <span style={{ color: "var(--ink-3)", fontSize: 11 }}>({g.x}, {g.y}, {g.z})</span></span>
                        {isL3 && <button className="tg" disabled={busy} onClick={() => run(() => deleteFleetGarage(g.id))}>Remove</button>}
                      </div>
                    ))}
                    {isL3 && (
                      <div style={{ padding: "12px 16px", display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button className="act primary" onClick={() => setForm({ kind: "addVehicle", vname: "", qty: "1", notes: "" })}>+ Vehicle</button>
                        <button className="act" onClick={() => setForm({ kind: "addGarage", gname: "", x: "", y: "", z: "", notes: "" })}>+ Garage</button>
                        {fleet.limits.isOverridden
                          ? <button className="act warn" disabled={busy} onClick={() => run(() => clearFleetOverride(detail.id))}>Clear override</button>
                          : <button className="act" onClick={() => setForm({ kind: "override", mt: fleet.limits.maxTypes, mtot: fleet.limits.maxTotal, mg: fleet.limits.maxGarages, reason: "" })}>Override caps</button>}
                      </div>
                    )}
                    {form?.kind === "addVehicle" && (
                      <div className="inline-form" style={{ margin: "0 16px 14px" }}>
                        <div className="lbl">Add vehicle</div>
                        <input className="filter-inp" placeholder="Vehicle name" value={form.vname} onChange={e => setForm({ ...form, vname: e.target.value })} />
                        <input className="filter-inp" placeholder="Quantity" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} />
                        {err && <div className="err">{err}</div>}
                        <div className="row-btns">
                          <button className="act primary" disabled={busy || !form.vname.trim()} onClick={() => run(() => addFleetVehicle(detail.id, form.vname.trim(), parseInt(form.qty) || 1, form.notes))}>Add</button>
                          <button className="act" onClick={() => { setForm(null); setErr(""); }}>Cancel</button>
                        </div>
                      </div>
                    )}
                    {form?.kind === "addGarage" && (
                      <div className="inline-form" style={{ margin: "0 16px 14px" }}>
                        <div className="lbl">Add garage</div>
                        <input className="filter-inp" placeholder="Garage name" value={form.gname} onChange={e => setForm({ ...form, gname: e.target.value })} />
                        <div style={{ display: "flex", gap: 6 }}>
                          {["x", "y", "z"].map(ax => <input key={ax} className="filter-inp" placeholder={ax.toUpperCase()} value={form[ax]} onChange={e => setForm({ ...form, [ax]: e.target.value })} />)}
                        </div>
                        {err && <div className="err">{err}</div>}
                        <div className="row-btns">
                          <button className="act primary" disabled={busy || !form.gname.trim()} onClick={() => run(() => addFleetGarage(detail.id, form.gname.trim(), form.x, form.y, form.z, form.notes))}>Add</button>
                          <button className="act" onClick={() => { setForm(null); setErr(""); }}>Cancel</button>
                        </div>
                      </div>
                    )}
                    {form?.kind === "override" && (
                      <div className="inline-form" style={{ margin: "0 16px 14px" }}>
                        <div className="lbl">Override caps (types / total / garages)</div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <input className="filter-inp" value={form.mt} onChange={e => setForm({ ...form, mt: e.target.value })} />
                          <input className="filter-inp" value={form.mtot} onChange={e => setForm({ ...form, mtot: e.target.value })} />
                          <input className="filter-inp" value={form.mg} onChange={e => setForm({ ...form, mg: e.target.value })} />
                        </div>
                        <input className="filter-inp" placeholder="Reason" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} />
                        {err && <div className="err">{err}</div>}
                        <div className="row-btns">
                          <button className="act primary" disabled={busy} onClick={() => run(() => setFleetOverride(detail.id, parseInt(form.mt), parseInt(form.mtot), parseInt(form.mg), form.reason))}>Set</button>
                          <button className="act" onClick={() => { setForm(null); setErr(""); }}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ padding: "6px 0" }}>
                    <CapBar label="Vehicle types" used={0} max={td.types ?? 0} />
                    <CapBar label="Total vehicles" used={0} max={td.total ?? 0} />
                    <CapBar label="Garages" used={0} max={td.garages ?? 0} />
                    <div className="cap"><span className="lbl">Stipend</span><span className="num" style={{ width: "auto" }}><b>{money(td.stipend)}</b>/mo</span></div>
                    <div className="empty">Fleet inventory is managed by L3.</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Comms: IC Contacts ── */}
      {tab === "comms" && (
        <div className="card">
          <div className="hd"><div className="t">IC Contacts</div><div className="meta">{activeIC} active</div></div>
          {contacts.length === 0 ? <div className="empty">No IC contacts.</div> : contacts.map(c => {
            const st = IC_STATUS[c.status] || IC_STATUS.pending_discussion;
            return (
              <div className="contact" key={c.id}>
                <div className="ch"><span className="from">{c.sender_name || "Unknown"}</span><span className={`status-pill ${st.c}`}>{st.l}</span>{c.assigned_name && <span className="chip role">{c.assigned_name}</span>}</div>
                <div className="msg">{c.message}</div>
              </div>
            );
          })}
          <div style={{ padding: "10px 16px", fontFamily: "var(--v2-mono)", fontSize: 10.5, color: "var(--ink-3)", borderTop: "1px solid var(--line)" }}>Portal messages &amp; monthly feedback land here next.</div>
        </div>
      )}

      {/* ── Review (L2+) ── */}
      {tab === "review" && isLeader && (
        <div className="hub-body">
          <div className="stack">
            <div className="card">
              <div className="hd"><div className="t">Monthly decision</div><div className="meta">Tier {detail.tier}</div></div>
              <div className="restricted">Confidential to Leadership</div>
              {staged ? (
                <div style={{ padding: "4px 16px 14px" }}>
                  <div className="alert promo" style={{ marginBottom: 10 }}>📋 Staged → Tier {staged.tier} · {(staged.imports || []).length} imports</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="act good" disabled={busy} onClick={() => run(() => completePromotion(detail.id, detail.name))}>Complete promotion</button>
                    <button className="act warn" disabled={busy} onClick={() => run(() => cancelPromotion(detail.id, detail.name))}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ padding: "4px 16px 14px" }}>
                  <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginBottom: 10 }}>This month’s decision:</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {isL3 && <button className="act primary" onClick={() => setForm({ kind: "promote", tier: String(detail.tier + 1), picks: new Set(imports.filter(i => i.permitted).map(i => i.name)) })}>Promote ↑</button>}
                    {isL3 && <button className="act warn" onClick={() => setForm({ kind: "demote", tier: String(Math.max(1, detail.tier - 1)) })}>Demote ↓</button>}
                    <span className="act" style={{ cursor: "default", opacity: 0.7 }}>Stay = no change</span>
                  </div>
                  {!isL3 && <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 8 }}>Promotion/demotion is executed by L3.</div>}

                  {form?.kind === "promote" && (
                    <div className="inline-form" style={{ marginTop: 12 }}>
                      <div className="lbl">Promote to tier</div>
                      <select value={form.tier} onChange={e => setForm({ ...form, tier: e.target.value })}>
                        {[...Array(9)].map((_, i) => <option key={i + 1} value={i + 1}>Tier {i + 1}</option>)}
                      </select>
                      <div className="lbl" style={{ marginTop: 4 }}>Imports this tier grants ({form.picks.size} selected)</div>
                      <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>
                        {imports.map(i => (
                          <div className="imp-row" key={i.id}>
                            <span className="nm">{i.name} <span style={{ color: "var(--ink-3)", fontSize: 10 }}>T{i.tier}</span></span>
                            <button className={`tg${form.picks.has(i.name) ? " on" : ""}`} onClick={() => {
                              const p = new Set(form.picks); p.has(i.name) ? p.delete(i.name) : p.add(i.name); setForm({ ...form, picks: p });
                            }}>{form.picks.has(i.name) ? "Granted" : "Off"}</button>
                          </div>
                        ))}
                      </div>
                      {err && <div className="err">{err}</div>}
                      <div className="row-btns">
                        <button className="act primary" disabled={busy} onClick={() => run(() => stagePromotion(detail.id, detail.name, parseInt(form.tier), [...form.picks]))}>Stage promotion</button>
                        <button className="act" onClick={() => { setForm(null); setErr(""); }}>Cancel</button>
                      </div>
                    </div>
                  )}
                  {form?.kind === "demote" && (
                    <div className="inline-form" style={{ marginTop: 12 }}>
                      <div className="lbl">Demote to tier</div>
                      <select value={form.tier} onChange={e => setForm({ ...form, tier: e.target.value })}>
                        {[...Array(detail.tier)].map((_, i) => <option key={i + 1} value={i + 1}>Tier {i + 1}</option>)}
                      </select>
                      {err && <div className="err">{err}</div>}
                      <div className="row-btns">
                        <button className="act warn" disabled={busy} onClick={() => run(() => demoteFaction(detail.id, detail.name, parseInt(form.tier)))}>Confirm demotion</button>
                        <button className="act" onClick={() => { setForm(null); setErr(""); }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="stack">
            <div className="card">
              <div className="hd"><div className="t">Review history</div><div className="meta">{reviews.length}</div></div>
              {reviews.length === 0 ? <div className="empty">No reviews on record.</div> : (
                <table className="dtable"><thead><tr><th>Month</th><th>Rating</th><th>Summary</th></tr></thead><tbody>
                  {reviews.map((r, i) => <tr key={i}><td><b>{r.review_month}</b></td><td>{r.rating || r.overall_rating || r.status || "—"}</td><td style={{ color: "var(--ink-2)" }}>{(r.summary || r.notes || r.feedback || "").slice(0, 80) || "—"}</td></tr>)}
                </tbody></table>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="disclaimer">Faction hub · review → tier → imports/fleet, all in one place</div>
    </div>
  );
}
