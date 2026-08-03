"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../../../lib/useAuth";
import QuillEditor from "../../../../lib/QuillEditor";
import {
  getFactions, getFactionDetail, getFactionContacts, getFactionImports, toggleFactionImport,
  stagePromotion, completePromotion, cancelPromotion, demoteFaction,
  addMember, updateMember, deleteMember,
  addFactionProperty, editFactionProperty, deleteFactionProperty,
  updateFactionLinks, renameFaction, deleteFaction,
  addNote, editNote, addOOCNote, editOOCNote, editSceneLog, editFactionSceneRewards,
  requestDeletion, directDelete, aiSummarize, getNPCsForRP, getFactionProperties, requestRPChange,
  getFactionPortalMessages, postPortalMessage, deletePortalMessage, togglePortalMessagePin, markContactRead,
  editAuditEntry, deleteAuditEntry, getStaffForTeam,
} from "../../../fm/factions/actions.js";
import {
  getReviewHistory, getReviewData, submitReview, setReviewStatus,
  getFactionLeadershipSummary, getMyPersonalNotes, submitPersonalNote,
  generateFeedbackDraft, adjustFeedbackDraft, sendFeedbackToFaction, markFeedbackSent,
} from "../../../fm/leadership/actions.js";
import {
  getFleetOverview, getFleetTierDefaults, addFleetVehicle, deleteFleetVehicle,
  addFleetGarage, deleteFleetGarage, setFleetOverride, clearFleetOverride,
} from "../../../fm/operations/actions.js";
import { assignIcContact, setIcContactStatus, stageRoleplay, completeIcContact, getThreadMessages } from "../../../fm/teams/actions.js";
import { getFactionFleetSummary, getFeedbackSentThisMonth } from "../../actions.js";
import { FM_GUILD_ID } from "../../../../lib/constants";

const tierBand = (t) => (t >= 7 ? "hi" : t >= 4 ? "mid" : "lo");
const money = (n) => "$" + (n || 0).toLocaleString();
const IC_STATUS = { pending_discussion: ["disc", "Pending Discussion"], pending_roleplay: ["rp", "Pending Roleplay"], completed: ["done", "Completed"] };

import Modal from "../../Modal.js";

function CapBar({ label, used, max }) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return <div className="cap"><span className="lbl">{label}</span><span className="bar"><span className={`fill${used >= max && max > 0 ? " full" : ""}`} style={{ width: `${pct}%` }} /></span><span className="num"><b>{used}</b> / {max}</span></div>;
}

export default function FactionHubPage() {
  return <Suspense fallback={<div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>}><FactionHub /></Suspense>;
}

// All hub tabs are URL-addressable (?tab=) so other areas — Leadership Reviews,
// Home, Discord pings — can land on the exact tab.
const HUB_TAB_IDS = ["overview", "roster", "activity", "assets", "imports", "comms", "review", "admin"];

function FactionHub() {
  const auth = useAuth();
  const router = useRouter();
  const params = useParams();
  const sp = useSearchParams();
  const name = params?.name ? decodeURIComponent(params.name) : "";
  const level = auth?.level || 0;
  const isL3 = level >= 3;
  const isLeader = level >= 2 || auth?.isLeadStoryteller;

  const [summary, setSummary] = useState(null);
  const [detail, setDetail] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [imports, setImports] = useState([]);
  const [fleet, setFleet] = useState(null);
  const [fleetSum, setFleetSum] = useState(null);
  const [fbSent, setFbSent] = useState(null);
  const [assignFor, setAssignFor] = useState(null); // { contactId, staff, sel }
  const [tierDefaults, setTierDefaults] = useState({});
  const [reviews, setReviews] = useState([]);
  const [reviewInfo, setReviewInfo] = useState(null);
  const [leadSummary, setLeadSummary] = useState({ notes: [], pending: [] });
  const [recForm, setRecForm] = useState({ recommendation: "", feedback: "" });
  const [noteTextLs, setNoteTextLs] = useState("");
  const [fbMsg, setFbMsg] = useState("");
  const [portal, setPortal] = useState([]);
  const tabParam = sp.get("tab");
  const tab = HUB_TAB_IDS.includes(tabParam) && (level >= 2 || auth?.isLeadStoryteller || (tabParam !== "review" && tabParam !== "admin"))
    ? tabParam : "overview";
  const setTab = (id) => router.replace(`/v2/factions/${encodeURIComponent(name)}${id === "overview" ? "" : `?tab=${id}`}`, { scroll: false });
  const [actSub, setActSub] = useState("scenes");
  const [capSub, setCapSub] = useState("imports");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [form, setForm] = useState(null);          // generic modal state
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [editNoteId, setEditNoteId] = useState(null);
  const [editText, setEditText] = useState("");
  const [portalText, setPortalText] = useState("");
  const [portalPin, setPortalPin] = useState(false);

  const load = async () => {
    const facs = await getFactions().catch(() => []);
    const s = (facs || []).find(f => f.name === name); setSummary(s || null);
    const d = await getFactionDetail(name).catch(() => null);
    if (!d) { setNotFound(true); setLoading(false); return; }
    setDetail(d);
    getFactionContacts(d.id).then(c => setContacts(c || [])).catch(() => {});
    getFactionImports(d.id).then(i => setImports(i || [])).catch(() => {});
    getFactionPortalMessages(d.id).then(p => setPortal(p || [])).catch(() => {});
    getFleetTierDefaults().then(setTierDefaults).catch(() => {});
    getFactionFleetSummary(d.id).then(setFleetSum).catch(() => {});
    if (isL3) getFleetOverview().then(all => setFleet((all || []).find(f => f.id === d.id) || null)).catch(() => {});
    if (isLeader) {
      getReviewHistory(d.id).then(r => setReviews(r || [])).catch(() => {});
      getReviewData().then(all => { const info = (all || []).find(f => f.id === d.id) || null; setReviewInfo(info); if (info?.currentReview) setRecForm({ recommendation: info.currentReview.recommendation || "", feedback: info.currentReview.feedback || "" }); }).catch(() => {});
      getFactionLeadershipSummary(d.id).then(x => setLeadSummary(x || { notes: [], pending: [] })).catch(() => {});
      getFeedbackSentThisMonth(d.name).then(setFbSent).catch(() => {});
    }
    setLoading(false);
  };
  useEffect(() => { if (!auth?.loading && auth?.id && name) load(); }, [auth?.id, auth?.loading, name]);

  const run = async (fn) => { setBusy(true); setErr(""); try { const r = await fn(); if (r && r.ok === false) { setErr(r.error || "Failed."); setBusy(false); return false; } } catch { setErr("Failed."); setBusy(false); return false; } setBusy(false); setForm(null); await load(); return true; };

  if (auth?.loading || loading) return <div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>;
  if (!auth?.ok) return <div className="view" style={{ color: "var(--ink-3)" }}>Not authorized.</div>;
  if (notFound) return <div className="view"><Link className="hub-back" href="/v2/factions">← Factions</Link><div className="empty">Faction “{name}” not found.</div></div>;

  const activeIC = contacts.filter(c => c.status !== "completed").length;
  const permittedCount = imports.filter(i => i.permitted).length;
  const td = tierDefaults[detail.tier] || {};
  let promo = null; try { if (detail.pendingPromo) promo = JSON.parse(detail.pendingPromo); } catch {}
  const newImports = promo ? (promo.imports || []).filter(n => !(detail.authorizedItems || []).includes(n)) : [];

  const TABS = [
    { id: "overview", label: "Overview" },
    { id: "roster", label: "Roster" },
    { id: "activity", label: "Activity" },
    { id: "assets", label: "Assets" },
    { id: "imports", label: "Imports" },
    { id: "comms", label: `Comms${activeIC ? ` · ${activeIC}` : ""}` },
    ...(isLeader ? [{ id: "review", label: "Review", lock: true }, { id: "admin", label: "Admin" }] : []),
  ];

  // ── Stage RP Change (multi-step modal). When opened from an incoming IC
  //    contact, the request goes through stageRoleplay so the contact advances
  //    to pending_roleplay and its Discord thread is notified. ──
  const openStageRP = async (contactId = null) => {
    const [npcs, props] = await Promise.all([getNPCsForRP().catch(() => []), getFactionProperties(detail.id).catch(() => [])]);
    setForm({ kind: "rp", step: "type", type: "", npcs, props, oldVal: "", newVal: "", turf: "", contactId });
  };
  const submitRP = async () => {
    const f = form; let payload;
    if (f.type === "NPC") { const parts = (f.oldVal || "").split("|"); payload = { faction: detail.name, type: "NPC", oldValue: parts[1] || f.oldVal, newValue: f.newVal, turf: parts[2] || "N/A" }; }
    else if (f.type === "HQ") payload = { faction: detail.name, type: "HQ", oldValue: f.oldVal, newValue: f.newVal, turf: "N/A" };
    else payload = { faction: detail.name, type: "Other", oldValue: f.oldVal || "N/A", newValue: f.newVal, turf: "N/A" };
    if (!payload.newValue?.trim()) return;
    if (f.contactId) await run(() => stageRoleplay(f.contactId, { type: payload.type, turf: payload.turf, oldValue: payload.oldValue, newValue: payload.newValue }));
    else await run(() => requestRPChange(payload));
  };

  // ── OOC editor ──
  const openOOC = async () => { const staff = await getStaffForTeam(detail.name).catch(() => []); const att = {}; staff.forEach(m => att[m.discord_id] = false); setForm({ kind: "ooc", staff, att, text: "" }); };
  const submitOOC = async () => {
    const present = form.staff.filter(m => form.att[m.discord_id]); const absent = form.staff.filter(m => !form.att[m.discord_id]);
    const html = `<h3>Attendance</h3><p><strong>Present:</strong> ${present.map(m => m.display_name).join(", ") || "None"}</p><p><strong>Absent:</strong> ${absent.map(m => m.display_name).join(", ") || "None"}</p><hr/>${form.text}`;
    await run(() => addOOCNote(detail.id, detail.name, html, present.map(m => m.discord_id)));
    setActSub("ooc");
  };

  return (
    <div className="view">
      <Link className="hub-back" href="/v2/factions">← Factions</Link>
      <div className="page-head" style={{ marginBottom: 4 }}>
        <div className="hub-title">
          <h1>{detail.name}</h1>
          <span className={`tier ${tierBand(detail.tier)}`} style={{ fontSize: 11, padding: "3px 8px" }}>Tier {detail.tier}</span>
          {summary?.teamName && <span className="chip role">{summary.teamName}</span>}
          {isL3 && <button className="act" style={{ padding: "2px 8px" }} onClick={() => setForm({ kind: "rename", value: detail.name })}>Rename</button>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {isLeader && <button className="btn ghost" style={{ color: "var(--amber)" }} onClick={openStageRP}>Stage RP change</button>}
          <a className="btn ghost" href={`https://meridiandatabase.net/faction/${encodeURIComponent(detail.name)}`} target="_blank" rel="noreferrer">Portal ↗</a>
        </div>
      </div>

      {/* Pending promo banner */}
      {promo && isLeader && (
        <div style={{ padding: "10px 14px", borderRadius: 10, background: "var(--good-bg)", border: "1px solid color-mix(in srgb,var(--good) 30%,transparent)", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--good)" }}>Promotion staged → Tier {promo.tier}</span>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="act good" disabled={busy} onClick={() => { if (window.confirm(`Complete promotion for ${detail.name}?`)) run(() => completePromotion(detail.id, detail.name)); }}>Complete (T{promo.tier})</button>
              {isL3 && <button className="act warn" disabled={busy} onClick={() => { if (window.confirm("Cancel this staged promotion?")) run(() => cancelPromotion(detail.id, detail.name)); }}>Cancel</button>}
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-3)", marginBottom: 4 }}>New imports being granted ({newImports.length})</div>
            {newImports.length === 0 ? <div style={{ fontSize: 12, color: "var(--ink-3)", fontStyle: "italic" }}>No new imports — tier change only.</div> : <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{newImports.map(n => <span key={n} className="chip role">{n}</span>)}</div>}
          </div>
        </div>
      )}

      <div className="hub-tabs">
        {TABS.map(t => <button key={t.id} className={`hub-tab${tab === t.id ? " on" : ""}`} onClick={() => { setTab(t.id); setErr(""); setEditNoteId(null); }}>{t.lock && <span className="lk">🔒</span>}{t.label}</button>)}
      </div>

      {/* ── Overview ── */}
      {tab === "overview" && (
        <div className="hub-body">
          <div className="stack">
            <div className="card">
              <div className="hd"><div className="t">Standing</div><div className="meta">Tier {detail.tier}</div></div>
              <div className="kv">
                <div><div className="k">Imports allowed</div><div className="v">{permittedCount}</div></div>
                <div><div className="k">Fleet</div><div className="v">{fleetSum ? <>{fleetSum.totalQuantity} / {fleetSum.limits.maxTotal}{fleetSum.limits.isOverridden && <span className="chip lock" style={{ marginLeft: 6, fontSize: 9 }}>OVR</span>}</> : (td.total ?? "—")} <span style={{ fontSize: 11, color: "var(--ink-3)" }}>({fleetSum ? `${fleetSum.typeCount}/${fleetSum.limits.maxTypes}` : (td.types ?? "—")} types)</span></div></div>
                <div><div className="k">Garages</div><div className="v">{fleetSum ? `${fleetSum.garageCount} / ${fleetSum.limits.maxGarages}` : (td.garages ?? "—")}</div></div>
                <div><div className="k">Stipend</div><div className="v">{fleetSum ? money(fleetSum.stipend) : td.stipend != null ? money(td.stipend) : "—"}</div></div>
                <div><div className="k">Scenes · 30d</div><div className="v">{summary?.scenes30d ?? "—"}</div></div>
                <div><div className="k">Last promoted</div><div className="v">{detail.lastPromoted || summary?.lastPromoted || "Never"}</div></div>
              </div>
            </div>
            <div className="card">
              <div className="hd"><div className="t">Team</div></div>
              <div className="kv"><div><div className="k">Lead</div><div className="v">{summary?.leadName || "—"}</div></div><div style={{ gridColumn: "span 2" }}><div className="k">Guides</div><div className="v" style={{ fontSize: 12.5 }}>{summary?.guidesText || "None"}</div></div></div>
            </div>
          </div>
          <div className="stack">
            <div className="card">
              <div className="hd"><div className="t">Links</div></div>
              {["discord", "forum"].map(field => (
                <div key={field} className="clog">
                  <span style={{ fontFamily: "var(--v2-mono)", fontSize: 10, textTransform: "uppercase", color: "var(--ink-3)", width: 60 }}>{field}</span>
                  {detail[field] ? <a href={detail[field]} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", fontSize: 12 }}>Open ↗</a> : <span style={{ color: "var(--ink-3)", fontSize: 12 }}>—</span>}
                  <span style={{ flex: 1 }} />
                  {isL3 && <button className="act" style={{ padding: "2px 8px" }} onClick={() => setForm({ kind: "link", field, value: detail[field] || "" })}>Edit</button>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Roster ── */}
      {tab === "roster" && (
        <div className="card">
          <div className="hd"><div className="t">Known command</div>{level >= 1 && <button className="btn" onClick={() => setForm({ kind: "member", name: "", phone: "N/A", residence: "N/A", role: 0 })}>Add +</button>}</div>
          {detail.members.length === 0 ? <div className="empty">No members on file.</div> : (
            <table className="dtable"><thead><tr><th>Character</th><th>Role</th><th>Phone</th><th>Residence</th><th></th></tr></thead><tbody>
              {detail.members.map(m => (
                <tr key={m.id}>
                  <td><b>{m.character_name}</b></td>
                  <td>{m.is_leader >= 2 ? <span className="chip lock">Leader</span> : m.is_leader === 1 ? <span className="chip role">Command</span> : <span style={{ color: "var(--ink-3)" }}>Member</span>}</td>
                  <td style={{ color: "var(--ink-2)" }}>{m.phone}</td><td style={{ color: "var(--ink-2)" }}>{m.residence}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{level >= 1 && <>
                    <button className="act" style={{ padding: "2px 7px" }} onClick={() => setForm({ kind: "member", id: m.id, name: m.character_name, phone: m.phone, residence: m.residence, role: m.is_leader })}>Edit</button>
                    <button className="act" style={{ padding: "2px 7px", marginLeft: 4, color: "var(--rose)" }} onClick={() => { if (window.confirm(`Remove ${m.character_name}?`)) run(() => deleteMember(m.id, m.character_name, detail.id, detail.name)); }}>Del</button>
                  </>}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div>
      )}

      {/* ── Activity ── */}
      {tab === "activity" && (
        <div className="card">
          <div className="sub-tabs" style={{ justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: 3 }}>
              {[["scenes", "Scenes"], ["intel", "Intel"], ["ooc", "OOC"]].map(([id, l]) => <button key={id} className={`tab${actSub === id ? " on" : ""}`} onClick={() => { setActSub(id); setEditNoteId(null); }}>{l}</button>)}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {actSub === "intel" && <button className="act" onClick={() => setForm({ kind: "intel", value: "" })}>Add note +</button>}
              {actSub === "intel" && level >= 2 && <button className="act primary" disabled={aiBusy} onClick={async () => { setAiBusy(true); const r = await aiSummarize(detail.name).catch(() => ({ ok: false })); setAiBusy(false); setAiText(r.ok ? r.summary : `Error: ${r.error || "failed"}`); }}>{aiBusy ? "Generating…" : "AI Summarize ✨"}</button>}
              {actSub === "ooc" && level >= 1 && <button className="act primary" onClick={openOOC}>Document meeting +</button>}
            </div>
          </div>
          <div style={{ borderTop: "1px solid var(--line)", marginTop: 10 }}>
            {actSub === "scenes" && (detail.sceneLogs.length === 0 ? <div className="empty">No scenes.</div> : detail.sceneLogs.map(l => (
              <div className="note" key={l.id}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontFamily: "var(--v2-mono)", fontSize: 10.5, color: "var(--ink-3)" }}>{l.date}</span><span style={{ fontWeight: 600, color: "var(--ink-1)", fontSize: 12 }}>{l.logged_by}</span>
                  <span style={{ flex: 1 }} />
                  {l.author_id === auth.id && <button className="act" style={{ padding: "2px 7px" }} onClick={() => { setEditNoteId(`s${l.id}`); setEditText(l.notes); }}>Edit</button>}
                  {l.author_id === auth.id && <button className="act" style={{ padding: "2px 7px" }} onClick={async () => { if (window.confirm("Request deletion of this scene?")) { await requestDeletion("scene_log", l.notes, l.id); window.alert("Deletion request submitted."); } }}>Req del</button>}
                  {isL3 && <button className="act" style={{ padding: "2px 7px" }} onClick={() => setForm({ kind: "rewards", id: l.id, value: l.rewards === "None" ? "" : (l.rewards || "") })}>Rewards</button>}
                  {isL3 && <button className="act" style={{ padding: "2px 7px", color: "var(--rose)" }} onClick={() => { if (window.confirm("Delete this scene?")) run(() => directDelete("scene_log", l.id)); }}>Del</button>}
                </div>
                {editNoteId === `s${l.id}` ? <div><textarea className="filter-inp" rows={3} value={editText} onChange={e => setEditText(e.target.value)} /><div style={{ display: "flex", gap: 6, marginTop: 6 }}><button className="act primary" onClick={() => run(() => editSceneLog(l.id, editText)).then(() => setEditNoteId(null))}>Save</button><button className="act" onClick={() => setEditNoteId(null)}>Cancel</button></div></div>
                  : <><div style={{ color: "var(--ink-1)", whiteSpace: "pre-wrap" }}>{l.notes}</div>{l.rewards && l.rewards !== "None" && <div style={{ marginTop: 6, fontFamily: "var(--v2-mono)", fontSize: 11, color: "var(--good)", background: "var(--good-bg)", padding: "4px 8px", borderRadius: 6, display: "inline-block" }}>{l.rewards}</div>}</>}
              </div>
            )))}
            {actSub === "intel" && <>
              {aiText && <div style={{ padding: "12px 14px", margin: "10px 0", borderRadius: 8, background: "var(--accent-bg)", color: "var(--ink-1)", whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.5 }}>{aiText}</div>}
              {detail.notes.length === 0 ? <div className="empty">No intel notes.</div> : detail.notes.map(n => (
                <div className="note" key={n.id}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}><span style={{ fontWeight: 700, color: "var(--accent)", fontSize: 12 }}>{n.author}</span><span style={{ fontFamily: "var(--v2-mono)", fontSize: 10.5, color: "var(--ink-3)" }}>{n.date}</span><span style={{ flex: 1 }} />
                    {n.author_id === auth.id && <button className="act" style={{ padding: "2px 7px" }} onClick={() => { setEditNoteId(`i${n.id}`); setEditText(n.text); }}>Edit</button>}
                    {n.author_id === auth.id && <button className="act" style={{ padding: "2px 7px" }} onClick={async () => { if (window.confirm("Request deletion?")) { await requestDeletion("intel_note", n.text, n.id); window.alert("Deletion request submitted."); } }}>Req del</button>}
                    {isL3 && <button className="act" style={{ padding: "2px 7px", color: "var(--rose)" }} onClick={() => { if (window.confirm("Delete this note?")) run(() => directDelete("intel_note", n.id)); }}>Del</button>}
                  </div>
                  {editNoteId === `i${n.id}` ? <div><textarea className="filter-inp" rows={3} value={editText} onChange={e => setEditText(e.target.value)} /><div style={{ display: "flex", gap: 6, marginTop: 6 }}><button className="act primary" onClick={() => run(() => editNote(n.id, editText)).then(() => setEditNoteId(null))}>Save</button><button className="act" onClick={() => setEditNoteId(null)}>Cancel</button></div></div>
                    : <div style={{ color: "var(--ink-1)", whiteSpace: "pre-wrap" }}>{n.text}</div>}
                </div>
              ))}
            </>}
            {actSub === "ooc" && (detail.oocNotes.length === 0 ? <div className="empty">No OOC notes.</div> : detail.oocNotes.map(n => (
              <div className="note" key={n.id}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}><span style={{ fontFamily: "var(--v2-mono)", fontSize: 10.5, color: "var(--accent)" }}>{n.date}</span><span style={{ fontWeight: 600, color: "var(--ink-1)", fontSize: 12 }}>By {n.author}</span><span style={{ flex: 1 }} />
                  {(n.author_id === auth.id || level >= 2) && <button className="act" style={{ padding: "2px 7px" }} onClick={() => { setEditNoteId(`o${n.id}`); setEditText(n.text); }}>Edit</button>}
                  {isL3 && <button className="act" style={{ padding: "2px 7px", color: "var(--rose)" }} onClick={() => { if (window.confirm("Delete this OOC note?")) run(() => directDelete("ooc_note", n.id)); }}>Del</button>}
                </div>
                {editNoteId === `o${n.id}` ? <div><QuillEditor value={editText} onChange={setEditText} placeholder="Meeting notes…" /><div style={{ display: "flex", gap: 6, marginTop: 6 }}><button className="act primary" onClick={() => run(() => editOOCNote(n.id, editText)).then(() => setEditNoteId(null))}>Save</button><button className="act" onClick={() => setEditNoteId(null)}>Cancel</button></div></div>
                  : <div className="quill-content" style={{ color: "var(--ink-1)" }} dangerouslySetInnerHTML={{ __html: n.text }} />}
              </div>
            )))}
          </div>
        </div>
      )}

      {/* ── Assets: properties + fleet ── */}
      {tab === "assets" && (
        <div className="stack">
          <div className="card">
            <div className="hd"><div className="t">Properties</div>{level >= 1 && <button className="btn" onClick={() => setForm({ kind: "prop", address: "", type: "Property", isHQ: false })}>Add +</button>}</div>
            {detail.properties.length === 0 ? <div className="empty">No properties.</div> : (
              <table className="dtable"><thead><tr><th>Address</th><th>Type</th><th></th><th></th></tr></thead><tbody>
                {detail.properties.map(p => (
                  <tr key={p.id}><td><b>{p.address}</b></td><td>{p.property_type || "Property"}</td><td>{p.isHQ ? <span className="chip lock">HQ</span> : ""}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{level >= 1 && <>
                      <button className="act" style={{ padding: "2px 7px" }} onClick={() => setForm({ kind: "prop", id: p.id, address: p.address, type: p.property_type || "Property", isHQ: p.isHQ })}>Edit</button>
                      <button className="act" style={{ padding: "2px 7px", marginLeft: 4, color: "var(--rose)" }} onClick={() => { if (window.confirm("Remove this property?")) run(() => deleteFactionProperty(p.id, detail.name)); }}>Del</button>
                    </>}</td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </div>
          <FleetCard fleet={fleet} fleetSum={fleetSum} td={td} tier={detail.tier} isL3={isL3} busy={busy} run={run} setForm={setForm} form={form} setErr={setErr} err={err} money={money} CapBar={CapBar} factionId={detail.id} />
        </div>
      )}

      {/* ── Imports ── */}
      {tab === "imports" && (
        <div className="card">
          <div className="hd"><div className="t">Authorized imports</div><div className="meta">{permittedCount} / {imports.length}{isL3 ? " · toggle to change" : " · L3 manages"}</div></div>
          {Object.entries(imports.reduce((a, i) => { (a[i.tier] = a[i.tier] || []).push(i); return a; }, {})).sort((a, b) => a[0] - b[0]).map(([tier, items]) => (
            <div key={tier}><div className="imp-grp">Tier {tier}</div>{items.map(i => (
              <div className="imp-row" key={i.id}><span className="nm">{i.name}{i.category ? <span style={{ color: "var(--ink-3)", marginLeft: 6, fontSize: 11 }}>{i.category}</span> : null}</span>
                <button className={`tg${i.permitted ? " on" : ""}`} disabled={!isL3 || busy} onClick={() => run(() => toggleFactionImport(detail.id, i.id, !i.permitted))}>{i.permitted ? "Authorized" : "Off"}</button>
              </div>
            ))}</div>
          ))}
        </div>
      )}

      {/* ── Comms: portal messages + incoming contacts ── */}
      {tab === "comms" && (
        <div className="stack">
          <div className="card">
            <div className="hd"><div className="t">Post to faction page</div></div>
            <textarea className="filter-inp" rows={3} placeholder="Write a message for the faction's public page…" value={portalText} onChange={e => setPortalText(e.target.value)} style={{ marginTop: 6 }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
              <label style={{ fontSize: 12.5, color: "var(--ink-1)", display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={portalPin} onChange={e => setPortalPin(e.target.checked)} /> Pin to top</label>
              <button className="act primary" disabled={busy || !portalText.trim()} onClick={async () => { const ok = await run(() => postPortalMessage(detail.id, detail.name, portalText, portalPin)); if (ok) { setPortalText(""); setPortalPin(false); } }}>Post message</button>
            </div>
            {err && tab === "comms" && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
          </div>
          {portal.length > 0 && <div className="card"><div className="hd"><div className="t">Posted messages</div></div>
            {portal.map(m => (
              <div className="note" key={m.id}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}><span style={{ fontWeight: 700, color: "var(--accent)", fontSize: 12 }}>{m.author_name}</span>{m.is_pinned === 1 && <span className="chip" style={{ background: "var(--accent-bg)", color: "var(--accent)" }}>PINNED</span>}<span style={{ fontFamily: "var(--v2-mono)", fontSize: 10.5, color: "var(--ink-3)" }}>{m.created_at?.slice(0, 16)}</span><span style={{ flex: 1 }} />
                  <button className="act" style={{ padding: "2px 7px" }} onClick={async () => { await togglePortalMessagePin(m.id); getFactionPortalMessages(detail.id).then(setPortal); }}>{m.is_pinned ? "Unpin" : "Pin"}</button>
                  <button className="act" style={{ padding: "2px 7px", color: "var(--rose)" }} onClick={async () => { if (window.confirm("Delete message?")) { await deletePortalMessage(m.id); getFactionPortalMessages(detail.id).then(setPortal); } }}>Del</button>
                </div>
                <div style={{ color: "var(--ink-1)", whiteSpace: "pre-wrap" }}>{m.message}</div>
              </div>
            ))}
          </div>}
          <div className="card">
            <div className="hd"><div className="t">Incoming contacts</div><div className="meta">{contacts.filter(c => !c.is_read).length} unread</div></div>
            {contacts.length === 0 ? <div className="empty">No messages received.</div> : contacts.map(c => {
              const st = IC_STATUS[c.status] || IC_STATUS.pending_discussion;
              const refreshContacts = () => getFactionContacts(detail.id).then(x => setContacts(x || []));
              return (
                <div className="contact" key={c.id} style={{ opacity: c.is_read && c.status === "completed" ? 0.65 : 1 }}>
                  <div className="ch">
                    <span className="from">{c.sender_name}</span>
                    {c.contact_type && <span className="chip" style={{ background: "var(--accent-bg)", color: "var(--accent)" }}>{c.contact_type}</span>}
                    {isLeader
                      ? <select disabled={busy} value={c.status || "pending_discussion"}
                        onChange={async e => { const v = e.target.value; if (v === "completed") { if (!window.confirm("Complete and archive this contact?")) return; await completeIcContact(c.id); } else await setIcContactStatus(c.id, v); refreshContacts(); }}
                        style={{ fontSize: 9.5, fontWeight: 700, padding: "2px 6px", borderRadius: 6, border: "1px solid var(--line)", cursor: "pointer", outline: "none", fontFamily: "var(--v2-mono)", textTransform: "uppercase", background: "var(--panel-2)", color: "var(--ink-1)" }}>
                        <option value="pending_discussion">Pending Discussion</option>
                        <option value="pending_roleplay">Pending Roleplay</option>
                        <option value="completed">Completed</option>
                      </select>
                      : <span className={`status-pill ${st[0]}`}>{st[1]}</span>}
                    {!c.is_read && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)" }} />}
                    <span style={{ flex: 1 }} />
                    <span style={{ fontFamily: "var(--v2-mono)", fontSize: 10, color: "var(--ink-3)" }}>{c.submitted_at?.slice(0, 16)}</span>
                    {!c.is_read && <button className="act" style={{ padding: "2px 7px" }} onClick={async () => { await markContactRead(c.id); refreshContacts(); }}>Mark read</button>}
                  </div>
                  <div className="msg">{c.message}</div>
                  {isLeader && (
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 8 }}>
                      <span style={{ fontSize: 10.5, color: "var(--ink-3)" }}>{c.assigned_name ? <><span style={{ color: "var(--accent)" }}>{c.assigned_name}</span> assigned</> : "Unassigned"}</span>
                      <span style={{ flex: 1 }} />
                      {c.thread_id && <a className="act" href={`https://discord.com/channels/${FM_GUILD_ID}/${c.thread_id}`} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>Thread ↗</a>}
                      <button className="act" onClick={async () => { const staff = await getStaffForTeam(detail.name).catch(() => []); setAssignFor({ contactId: c.id, staff: staff || [], sel: "" }); }}>Assign</button>
                      {c.status !== "completed" && <button className="act" style={{ color: "var(--sky)" }} onClick={() => openStageRP(c.id)}>Request RP change</button>}
                    </div>
                  )}
                  {assignFor?.contactId === c.id && (
                    <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                      <select className="filter-inp" style={{ flex: 1, minWidth: 200 }} value={assignFor.sel} onChange={e => setAssignFor({ ...assignFor, sel: e.target.value })}>
                        <option value="">Select member…</option>
                        {assignFor.staff.map(s => <option key={s.discord_id} value={s.discord_id}>{s.display_name}</option>)}
                      </select>
                      <button className="act primary" disabled={!assignFor.sel || busy} onClick={async () => { const m = assignFor.staff.find(s => s.discord_id === assignFor.sel); await assignIcContact(c.id, assignFor.sel, m?.display_name || assignFor.sel); setAssignFor(null); refreshContacts(); }}>Confirm</button>
                      <button className="act" onClick={() => setAssignFor(null)}>Cancel</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Review (L2+): the monthly cycle as a guided checklist ── */}
      {tab === "review" && isLeader && <Review {...{ detail, summary, reviewInfo, recForm, setRecForm, reviews, leadSummary, noteTextLs, setNoteTextLs, fbMsg, setFbMsg, fbSent, imports, isL3, busy, err, run, form, setForm, promo }} />}

      {/* ── Admin (L2+) ── */}
      {tab === "admin" && isLeader && (
        <div className="stack">
          <div className="card"><div className="hd"><div className="t">Audit trail</div><div className="meta">{detail.history.length}</div></div>
            {detail.history.length === 0 ? <div className="empty">No history.</div> : detail.history.map(h => (
              <div className="clog" key={h.id}>
                <span style={{ fontFamily: "var(--v2-mono)", fontSize: 10.5, color: "var(--ink-3)", minWidth: 130 }}>{h.created_at}</span>
                <span className="chip" style={{ background: h.action_type.includes("PROMO") ? "var(--good-bg)" : "var(--accent-bg)", color: h.action_type.includes("PROMO") ? "var(--good)" : "var(--accent)" }}>{h.action_type}</span>
                <span style={{ color: "var(--ink-1)" }}>{h.details}</span><span style={{ flex: 1 }} /><span style={{ fontSize: 10.5, color: "var(--ink-3)" }}>{h.authorized_by}</span>
                {isL3 && <><button className="act" style={{ padding: "2px 7px" }} onClick={() => setForm({ kind: "auditEdit", id: h.id, value: h.details || "" })}>Edit</button><button className="act" style={{ padding: "2px 7px", color: "var(--rose)" }} onClick={() => { if (window.confirm("Delete this audit entry?")) run(() => deleteAuditEntry(h.id)); }}>Del</button></>}
              </div>
            ))}
          </div>
          {isL3 && <div className="card"><div className="hd"><div className="t">Configuration</div></div>
            <div className="clog"><span style={{ fontFamily: "var(--v2-mono)", fontSize: 10, textTransform: "uppercase", color: "var(--ink-3)", width: 60 }}>Thread</span><span style={{ fontFamily: "var(--v2-mono)", fontSize: 12, color: detail.threadId ? "var(--accent)" : "var(--ink-3)" }}>{detail.threadId || "—"}</span><span style={{ flex: 1 }} /><button className="act" style={{ padding: "2px 8px" }} onClick={() => setForm({ kind: "link", field: "thread", value: detail.threadId || "" })}>Edit</button></div>
          </div>}
          {isL3 && <div className="card"><div className="hd"><div className="t" style={{ color: "var(--rose)" }}>Danger zone</div></div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0" }}><span style={{ fontSize: 12, color: "var(--ink-2)" }}>Archive removes the faction from active lists (restorable).</span><button className="act" style={{ color: "var(--rose)", borderColor: "color-mix(in srgb,var(--rose) 35%,transparent)" }} onClick={async () => { if (window.confirm(`Archive ${detail.name}?`)) { await deleteFaction(detail.id, detail.name); router.push("/v2/factions"); } }}>Delete faction</button></div>
          </div>}
        </div>
      )}

      {/* ── Modals ── */}
      {form?.kind === "member" && <Modal title={`${form.id ? "Edit" : "Add"} member`} onClose={() => setForm(null)} onSave={() => run(() => form.id ? updateMember(form.id, form) : addMember(detail.id, detail.name, form))} saveDisabled={!form.name.trim()}>
        <input className="filter-inp" placeholder="Character name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        <input className="filter-inp" placeholder="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
        <input className="filter-inp" placeholder="Residence" value={form.residence} onChange={e => setForm({ ...form, residence: e.target.value })} />
        <select className="filter-inp" value={form.role} onChange={e => setForm({ ...form, role: parseInt(e.target.value) })}><option value={0}>Member</option><option value={1}>Command</option><option value={2}>Leader</option></select>
      </Modal>}
      {form?.kind === "prop" && <Modal title={`${form.id ? "Edit" : "Add"} property`} onClose={() => setForm(null)} onSave={() => run(() => form.id ? editFactionProperty(form.id, { address: form.address, type: form.type, isHQ: form.isHQ }) : addFactionProperty(detail.id, detail.name, { address: form.address, type: form.type, isHQ: form.isHQ }))} saveDisabled={!form.address.trim()}>
        <input className="filter-inp" placeholder="Address" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
        <input className="filter-inp" placeholder="Type (HQ, Warehouse, Property…)" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} />
        <label style={{ fontSize: 12.5, color: "var(--ink-1)", display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={form.isHQ} onChange={e => setForm({ ...form, isHQ: e.target.checked })} /> Mark as HQ</label>
      </Modal>}
      {form?.kind === "link" && <Modal title={`Edit ${form.field}`} onClose={() => setForm(null)} onSave={() => run(() => updateFactionLinks(detail.id, form.field, form.value))} error={err}>
        <input className="filter-inp" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} />
      </Modal>}
      {form?.kind === "rename" && <Modal title="Rename faction" onClose={() => setForm(null)} saveLabel="Rename" saveDisabled={busy || !form.value.trim() || form.value.trim() === detail.name} error={err}
        onSave={async () => { const n = form.value.trim(); const ok = await run(() => renameFaction(detail.id, detail.name, n)); if (ok) router.replace(`/v2/factions/${encodeURIComponent(n)}?tab=${tab}`); }}>
        <input className="filter-inp" autoFocus value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} />
        <div style={{ fontSize: 11, color: "var(--ink-3)" }}>Renames the faction everywhere — portal, records, history.</div>
      </Modal>}
      {form?.kind === "intel" && <Modal title="Add intelligence note" onClose={() => setForm(null)} saveLabel="Add note" saveDisabled={busy || !form.value.trim()} error={err}
        onSave={() => run(() => addNote(detail.id, detail.name, form.value.trim()))}>
        <textarea className="filter-inp" rows={5} autoFocus placeholder="What was learned…" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} />
      </Modal>}
      {form?.kind === "rewards" && <Modal title="Edit scene rewards" onClose={() => setForm(null)} saveDisabled={busy} error={err}
        onSave={() => run(() => editFactionSceneRewards(form.id, form.value))}>
        <textarea className="filter-inp" rows={3} autoFocus placeholder="e.g. $5,000 + 2x Item" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} />
      </Modal>}
      {form?.kind === "auditEdit" && <Modal title="Edit audit entry" onClose={() => setForm(null)} saveDisabled={busy} error={err}
        onSave={() => run(() => editAuditEntry(form.id, form.value))}>
        <textarea className="filter-inp" rows={3} autoFocus value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} />
      </Modal>}
      {form?.kind === "ooc" && <Modal maxWidth={860} title={`OOC meeting: ${detail.name}`} onClose={() => setForm(null)} onSave={submitOOC} saveDisabled={busy || !form.text.trim()}>
        <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 16 }}>
          <div><div className="lbl" style={{ fontSize: 9, fontFamily: "var(--v2-mono)", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 6 }}>Attendance</div>
            <div style={{ maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
              {form.staff.length === 0 ? <span style={{ fontSize: 12, color: "var(--ink-3)" }}>No team members.</span> : form.staff.map(m => (
                <label key={m.discord_id} className="pill" style={{ display: "flex", justifyContent: "space-between", background: form.att[m.discord_id] ? "var(--accent-bg)" : "var(--panel)", color: form.att[m.discord_id] ? "var(--accent-hi)" : "var(--ink-1)" }}>
                  <span>{m.display_name}</span><input type="checkbox" checked={form.att[m.discord_id] || false} onChange={() => setForm({ ...form, att: { ...form.att, [m.discord_id]: !form.att[m.discord_id] } })} />
                </label>
              ))}
            </div>
          </div>
          <div><div className="lbl" style={{ fontSize: 9, fontFamily: "var(--v2-mono)", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 6 }}>Meeting notes</div><QuillEditor value={form.text} onChange={t => setForm({ ...form, text: t })} placeholder="Meeting notes…" /></div>
        </div>
      </Modal>}
      {form?.kind === "rp" && <Modal title="Stage RP change" onClose={() => setForm(null)} onSave={form.type ? submitRP : null} saveDisabled={busy || !form.type || !form.newVal.trim()}>
        <select className="filter-inp" value={form.type} onChange={e => setForm({ ...form, type: e.target.value, oldVal: "", newVal: "" })}>
          <option value="">Select change type…</option><option value="NPC">NPC change</option><option value="HQ">HQ relocation</option><option value="Other">Other</option>
        </select>
        {form.type === "NPC" && <>
          <select className="filter-inp" value={form.oldVal} onChange={e => setForm({ ...form, oldVal: e.target.value })}><option value="">Current NPC…</option>{form.npcs.map(n => <option key={n.name} value={`${n.name}|${n.npc_type}|${n.turf}`}>{n.name} ({n.npc_type}) — {n.turf}</option>)}</select>
          <select className="filter-inp" value={form.newVal} onChange={e => setForm({ ...form, newVal: e.target.value })}><option value="">New NPC type…</option>{[...new Set(form.npcs.map(n => n.npc_type))].sort().map(t => <option key={t} value={t}>{t}</option>)}</select>
        </>}
        {form.type === "HQ" && <>
          <select className="filter-inp" value={form.oldVal} onChange={e => setForm({ ...form, oldVal: e.target.value })}><option value="">Current address…</option>{form.props.map(p => <option key={p.id} value={p.address}>{p.is_hq ? "HQ: " : ""}{p.address}</option>)}</select>
          <input className="filter-inp" placeholder="New HQ address" value={form.newVal} onChange={e => setForm({ ...form, newVal: e.target.value })} />
        </>}
        {form.type === "Other" && <><input className="filter-inp" placeholder="Current state" value={form.oldVal} onChange={e => setForm({ ...form, oldVal: e.target.value })} /><input className="filter-inp" placeholder="New state" value={form.newVal} onChange={e => setForm({ ...form, newVal: e.target.value })} /></>}
        {err && <div className="err">{err}</div>}
      </Modal>}
    </div>
  );
}

/* Fleet card (Assets) */
function FleetCard({ fleet, fleetSum, td, tier, isL3, busy, run, setForm, form, money, CapBar, factionId }) {
  return (
    <div className="card">
      <div className="hd"><div className="t">Fleet</div><div className="meta">Tier {tier} allowance</div></div>
      {fleet ? <>
        <CapBar label="Vehicle types" used={fleet.typeCount} max={fleet.limits.maxTypes} />
        <CapBar label="Total vehicles" used={fleet.totalQuantity} max={fleet.limits.maxTotal} />
        <CapBar label="Garages" used={fleet.garages.length} max={fleet.limits.maxGarages} />
        <div className="cap"><span className="lbl">Stipend</span><span className="num" style={{ width: "auto" }}><b>{money(fleet.defaults.stipend)}</b>/mo</span>{fleet.limits.isOverridden && <span className="chip lock" style={{ marginLeft: 8 }}>Override</span>}</div>
        <div className="imp-grp">Vehicles</div>
        {fleet.vehicles.length === 0 ? <div className="empty">No vehicles.</div> : fleet.vehicles.map(v => <div className="imp-row" key={v.id}><span className="nm"><b style={{ color: "var(--ink-0)" }}>{v.quantity}×</b> {v.vehicle_name}</span>{isL3 && <button className="tg" disabled={busy} onClick={() => run(() => deleteFleetVehicle(v.id))}>Remove</button>}</div>)}
        <div className="imp-grp">Garages</div>
        {fleet.garages.length === 0 ? <div className="empty">No garages.</div> : fleet.garages.map(g => <div className="imp-row" key={g.id}><span className="nm"><b style={{ color: "var(--ink-0)" }}>{g.name}</b> <span style={{ color: "var(--ink-3)", fontSize: 11 }}>({g.x}, {g.y}, {g.z})</span></span>{isL3 && <button className="tg" disabled={busy} onClick={() => run(() => deleteFleetGarage(g.id))}>Remove</button>}</div>)}
        {isL3 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingTop: 10 }}>
          <button className="act primary" onClick={() => setForm({ kind: "veh", vname: "", qty: "1" })}>+ Vehicle</button>
          <button className="act" onClick={() => setForm({ kind: "gar", gname: "", x: "", y: "", z: "" })}>+ Garage</button>
          {fleet.limits.isOverridden ? <button className="act warn" disabled={busy} onClick={() => run(() => clearFleetOverride(factionId))}>Clear override</button> : <button className="act" onClick={() => setForm({ kind: "ovr", mt: fleet.limits.maxTypes, mtot: fleet.limits.maxTotal, mg: fleet.limits.maxGarages, reason: "" })}>Override caps</button>}
        </div>}
        {form?.kind === "veh" && <Modal title="Add vehicle" onClose={() => setForm(null)} onSave={() => run(() => addFleetVehicle(factionId, form.vname.trim(), parseInt(form.qty) || 1, ""))} saveDisabled={busy || !form.vname.trim()}><input className="filter-inp" placeholder="Vehicle name" value={form.vname} onChange={e => setForm({ ...form, vname: e.target.value })} /><input className="filter-inp" placeholder="Quantity" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} /></Modal>}
        {form?.kind === "gar" && <Modal title="Add garage" onClose={() => setForm(null)} onSave={() => run(() => addFleetGarage(factionId, form.gname.trim(), form.x, form.y, form.z, ""))} saveDisabled={busy || !form.gname.trim()}><input className="filter-inp" placeholder="Garage name" value={form.gname} onChange={e => setForm({ ...form, gname: e.target.value })} /><div style={{ display: "flex", gap: 6 }}>{["x", "y", "z"].map(a => <input key={a} className="filter-inp" placeholder={a.toUpperCase()} value={form[a]} onChange={e => setForm({ ...form, [a]: e.target.value })} />)}</div></Modal>}
        {form?.kind === "ovr" && <Modal title="Override caps" onClose={() => setForm(null)} onSave={() => run(() => setFleetOverride(factionId, parseInt(form.mt), parseInt(form.mtot), parseInt(form.mg), form.reason))} saveDisabled={busy}><div style={{ display: "flex", gap: 6 }}><input className="filter-inp" placeholder="Types" value={form.mt} onChange={e => setForm({ ...form, mt: e.target.value })} /><input className="filter-inp" placeholder="Total" value={form.mtot} onChange={e => setForm({ ...form, mtot: e.target.value })} /><input className="filter-inp" placeholder="Garages" value={form.mg} onChange={e => setForm({ ...form, mg: e.target.value })} /></div><input className="filter-inp" placeholder="Reason" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} /></Modal>}
      </> : <div style={{ paddingTop: 6 }}>
        <CapBar label="Vehicle types" used={fleetSum?.typeCount ?? 0} max={fleetSum?.limits.maxTypes ?? td.types ?? 0} />
        <CapBar label="Total vehicles" used={fleetSum?.totalQuantity ?? 0} max={fleetSum?.limits.maxTotal ?? td.total ?? 0} />
        <CapBar label="Garages" used={fleetSum?.garageCount ?? 0} max={fleetSum?.limits.maxGarages ?? td.garages ?? 0} />
        <div className="cap"><span className="lbl">Stipend</span><span className="num" style={{ width: "auto" }}><b>{money(fleetSum?.stipend ?? td.stipend)}</b>/mo</span>{fleetSum?.limits.isOverridden && <span className="chip lock" style={{ marginLeft: 8 }}>Override</span>}</div>
        <div className="empty">Fleet inventory is managed by L3.</div>
      </div>}
    </div>
  );
}

/* Review workspace (L2+): the monthly cycle as numbered steps. Staging
   machinery (tier + imports) stays behind the final step and only unlocks
   once the outcome is confirmed — or when a promo is already staged. */
function StepHead({ n, title, done, meta }) {
  return (
    <div className="hd" style={{ alignItems: "center" }}>
      <div className="t" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 18, height: 18, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, fontFamily: "var(--v2-mono)", flexShrink: 0, background: done ? "var(--good-bg)" : "var(--panel-2)", color: done ? "var(--good)" : "var(--ink-3)", border: `1px solid ${done ? "var(--good)" : "var(--line-2)"}` }}>{done ? "✓" : n}</span>
        {title}
      </div>
      {meta && <div className="meta">{meta}</div>}
    </div>
  );
}

function Review({ detail, summary, reviewInfo, recForm, setRecForm, reviews, leadSummary, noteTextLs, setNoteTextLs, fbMsg, setFbMsg, fbSent, imports, isL3, busy, err, run, form, setForm, promo }) {
  const cur = reviewInfo?.currentReview;
  const REC = [{ v: "Promote", cls: "good" }, { v: "Hold", cls: "" }, { v: "Demote", cls: "warn" }, { v: "Remove", cls: "warn" }];
  const canReview = reviewInfo?.mine || isL3;
  const staged = promo;
  const [adjText, setAdjText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState("");

  const outcomeConfirmed = !!cur?.status?.startsWith("Confirmed");
  const outcome = outcomeConfirmed ? cur.status.replace("Confirmed ", "") : null;
  const notesDone = (leadSummary.notes || []).length > 0 && (leadSummary.pending || []).length === 0;

  const genDraft = async () => {
    setAiBusy(true); setAiErr("");
    const r = await generateFeedbackDraft(detail.id).catch(() => ({ ok: false }));
    setAiBusy(false);
    if (r.ok) setFbMsg(r.draft || r.message || ""); else setAiErr(r.error || "Draft failed.");
  };
  const adjDraft = async () => {
    setAiBusy(true); setAiErr("");
    const r = await adjustFeedbackDraft(detail.id, fbMsg, adjText).catch(() => ({ ok: false }));
    setAiBusy(false);
    if (r.ok) { setFbMsg(r.draft || r.message || ""); setAdjText(""); } else setAiErr(r.error || "Adjust failed.");
  };

  // Steps in order; numbering adapts to what this viewer can see.
  let n = 0;
  return (
    <div className="hub-body">
      <div className="stack">
        <div className="card">
          <StepHead n={++n} title="Evidence" done meta="auto" />
          <div className="metrics" style={{ marginBottom: 0, borderBottom: "none", gap: 26, paddingTop: 6 }}>
            <div className="metric"><div className="l">Scenes · this mo</div><div className="v">{reviewInfo?.scenes30 ?? summary?.scenes30d ?? 0}</div></div>
            <div className="metric"><div className="l">Prev mo</div><div className="v">{reviewInfo?.scenes60 ?? 0}</div></div>
            <div className="metric"><div className="l">2 mo ago</div><div className="v">{reviewInfo?.scenes90 ?? 0}</div></div>
            <div className="metric"><div className="l">Forum · 30d</div><div className="v">{reviewInfo?.forumPosts ?? summary?.forumPosts ?? 0}</div></div>
          </div>
        </div>

        <div className="card">
          <StepHead n={++n} title="Recommendation" done={!!cur} meta={cur ? (cur.status || "Pending Discussion") : "not started"} />
          <div className="restricted">Confidential to Leadership · shared with the team lead for the 15th message</div>
          {!canReview ? <div className="empty">Only {reviewInfo?.teamName || "the owning team"}’s leads (or L3) edit this review.</div> : <div style={{ paddingTop: 6 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>{REC.map(r => <button key={r.v} className={`act${recForm.recommendation === r.v ? " primary" : ` ${r.cls}`}`} onClick={() => setRecForm({ ...recForm, recommendation: r.v })}>{r.v}</button>)}</div>
            <textarea className="filter-inp" rows={5} placeholder="Written feedback…" value={recForm.feedback} onChange={e => setRecForm({ ...recForm, feedback: e.target.value })} style={{ marginBottom: 8 }} />
            <button className="act primary" disabled={busy || !recForm.recommendation || !recForm.feedback.trim()} onClick={() => run(() => submitReview({ factionId: detail.id, factionName: detail.name, recommendation: recForm.recommendation, feedback: recForm.feedback }))}>{cur ? "Update review" : "Submit review"}</button>
          </div>}
        </div>

        {isL3 && (
          <div className="card">
            <StepHead n={++n} title="Leadership notes" done={notesDone} meta={`${(leadSummary.notes || []).length} recorded · ${(leadSummary.pending || []).length} pending`} />
            <textarea className="filter-inp" rows={3} placeholder="Private note this month…" value={noteTextLs} onChange={e => setNoteTextLs(e.target.value)} style={{ margin: "6px 0" }} />
            <button className="act primary" disabled={busy || !noteTextLs.trim()} onClick={async () => { const ok = await run(() => submitPersonalNote(detail.id, detail.name, noteTextLs, recForm.recommendation || "Hold")); if (ok) setNoteTextLs(""); }}>Save note</button>
            <div style={{ marginTop: 10 }}>
              {(leadSummary.notes || []).length === 0 ? <div className="empty">No notes yet.</div> : (leadSummary.notes || []).map((note, i) => <div className="note" key={i}>{note.note}{note.status ? <span className="chip role" style={{ marginLeft: 6 }}>{note.status}</span> : null}<div className="by">— {note.author_name || note.author_id}</div></div>)}
              {(leadSummary.pending || []).length > 0 && <div style={{ paddingTop: 8, fontFamily: "var(--v2-mono)", fontSize: 10.5, color: "var(--ink-3)" }}>Awaiting: {(leadSummary.pending || []).map(p => p.display_name).join(", ")}</div>}
            </div>
          </div>
        )}

        <div className="card">
          <StepHead n={++n} title="Feedback to the faction" done={!!fbSent?.sent} meta={fbSent?.sent ? `sent by ${fbSent.by}` : "the 15th message"} />
          <div style={{ paddingTop: 6 }}>
            {fbSent?.sent && <div style={{ fontSize: 12, color: "var(--good)", marginBottom: 8 }}>✓ Delivered this month by {fbSent.by} ({(fbSent.at || "").slice(0, 10)}).</div>}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button className="act" disabled={aiBusy || busy} onClick={genDraft}>{aiBusy ? "Working…" : "✦ Generate draft"}</button>
            </div>
            <textarea className="filter-inp" rows={5} placeholder="Message sent to the faction." value={fbMsg} onChange={e => setFbMsg(e.target.value)} style={{ margin: "8px 0" }} />
            {fbMsg.trim() && (
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                <input className="filter-inp" style={{ flex: 1 }} placeholder="Adjust the draft — e.g. “warmer tone, mention the new HQ”" value={adjText} onChange={e => setAdjText(e.target.value)} onKeyDown={e => e.key === "Enter" && adjText.trim() && adjDraft()} />
                <button className="act" disabled={aiBusy || !adjText.trim()} onClick={adjDraft}>Adjust ↺</button>
              </div>
            )}
            {aiErr && <div className="err" style={{ marginBottom: 8 }}>{aiErr}</div>}
            <div style={{ display: "flex", gap: 6 }}>
              <button className="act primary" disabled={busy || !fbMsg.trim()} onClick={() => { if (window.confirm(`Send this feedback to ${detail.name}'s Command channel?`)) run(() => sendFeedbackToFaction(detail.id, fbMsg)); }}>Send to faction</button>
              <button className="act" disabled={busy} onClick={() => run(() => markFeedbackSent(detail.id))}>Mark sent manually</button>
            </div>
          </div>
        </div>

        <div className="card">
          <StepHead n={++n} title="Confirm outcome" done={outcomeConfirmed} meta={outcomeConfirmed ? cur.status : cur ? "after discussion" : "needs a review first"} />
          {!cur ? <div className="empty">Submit the recommendation first.</div> : (
            <div style={{ paddingTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["Confirmed Promote", "Confirmed Hold", "Confirmed Demote", "Confirmed Remove"].map(st => <button key={st} className={`act${cur.status === st ? " primary" : ""}`} disabled={busy} onClick={() => run(() => setReviewStatus(cur.id, st))}>{st.replace("Confirmed ", "")}</button>)}
            </div>
          )}
        </div>

        <div className="card">
          <StepHead n={++n} title="Apply" done={false} meta={`Tier ${detail.tier}`} />
          {staged ? (
            <div style={{ paddingTop: 6 }}>
              <div className="alert promo" style={{ marginBottom: 10 }}>📋 Staged → Tier {staged.tier}</div>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="act good" disabled={busy} onClick={() => { if (window.confirm(`Complete promotion for ${detail.name}?`)) run(() => completePromotion(detail.id, detail.name)); }}>Complete promotion</button>
                {isL3 && <button className="act warn" disabled={busy} onClick={() => { if (window.confirm("Cancel this staged promotion?")) run(() => cancelPromotion(detail.id, detail.name)); }}>Cancel</button>}
              </div>
            </div>
          ) : !outcomeConfirmed ? (
            <div style={{ paddingTop: 6, fontSize: 12.5, color: "var(--ink-3)" }}>🔒 Confirm the outcome above — the tier &amp; import controls unlock here.</div>
          ) : !isL3 ? (
            <div style={{ paddingTop: 6, fontSize: 12.5, color: "var(--ink-3)" }}>Outcome confirmed — an L3 applies the {outcome.toLowerCase()} from here.</div>
          ) : outcome === "Promote" ? (
            <div style={{ paddingTop: 6 }}>
              {form?.kind !== "promote" && <button className="act primary" onClick={() => setForm({ kind: "promote", tier: String(Math.min(9, detail.tier + 1)), picks: new Set(imports.filter(i => i.permitted).map(i => i.name)) })}>Stage promotion ↑</button>}
              {form?.kind === "promote" && <div className="inline-form">
                <div className="lbl">Promote to tier</div>
                <select value={form.tier} onChange={e => setForm({ ...form, tier: e.target.value })}>{[...Array(9)].map((_, i) => <option key={i + 1} value={i + 1}>Tier {i + 1}</option>)}</select>
                <div className="lbl" style={{ marginTop: 4 }}>Imports granted ({form.picks.size})</div>
                <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8, padding: "0 10px" }}>{imports.map(i => <div className="imp-row" key={i.id}><span className="nm">{i.name} <span style={{ color: "var(--ink-3)", fontSize: 10 }}>T{i.tier}</span></span><button className={`tg${form.picks.has(i.name) ? " on" : ""}`} onClick={() => { const p = new Set(form.picks); p.has(i.name) ? p.delete(i.name) : p.add(i.name); setForm({ ...form, picks: p }); }}>{form.picks.has(i.name) ? "Granted" : "Off"}</button></div>)}</div>
                {err && <div className="err">{err}</div>}
                <div className="row-btns"><button className="act primary" disabled={busy} onClick={() => run(() => stagePromotion(detail.id, detail.name, parseInt(form.tier), [...form.picks]))}>Stage</button><button className="act" onClick={() => setForm(null)}>Cancel</button></div>
              </div>}
            </div>
          ) : outcome === "Demote" ? (
            <div style={{ paddingTop: 6 }}>
              {form?.kind !== "demote" && <button className="act warn" onClick={() => setForm({ kind: "demote", tier: String(Math.max(1, detail.tier - 1)) })}>Demote ↓</button>}
              {form?.kind === "demote" && <div className="inline-form"><div className="lbl">Demote to tier</div><select value={form.tier} onChange={e => setForm({ ...form, tier: e.target.value })}>{[...Array(detail.tier)].map((_, i) => <option key={i + 1} value={i + 1}>Tier {i + 1}</option>)}</select>{err && <div className="err">{err}</div>}<div className="row-btns"><button className="act warn" disabled={busy} onClick={() => { if (window.confirm(`Demote ${detail.name} to Tier ${form.tier}?`)) run(() => demoteFaction(detail.id, detail.name, parseInt(form.tier))); }}>Confirm demotion</button><button className="act" onClick={() => setForm(null)}>Cancel</button></div></div>}
            </div>
          ) : outcome === "Remove" ? (
            <div style={{ paddingTop: 6, fontSize: 12.5, color: "var(--ink-2)" }}>Removal confirmed — archive the faction from the <b>Admin tab → Danger zone</b> when ready.</div>
          ) : (
            <div style={{ paddingTop: 6, fontSize: 12.5, color: "var(--ink-2)" }}>Hold confirmed — no tier change this month. ✓</div>
          )}
        </div>
      </div>

      <div className="stack">
        <div className="card"><div className="hd"><div className="t">Review history</div><div className="meta">{reviews.length}</div></div>
          {reviews.length === 0 ? <div className="empty">No reviews.</div> : <table className="dtable"><thead><tr><th>Month</th><th>Rec</th></tr></thead><tbody>{reviews.map((r, i) => <tr key={i}><td><b>{r.review_month}</b></td><td>{r.recommendation || r.status || "—"}</td></tr>)}</tbody></table>}
        </div>
      </div>
    </div>
  );
}
