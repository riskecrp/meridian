"use client";
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import QuillEditor from "../../../../lib/QuillEditor";
import { useAuth } from "../../../../lib/useAuth";
import { useDialog } from "../../../../lib/useDialog";
import { s, tierColor } from "../_shared/styles";
import RowMenu from "../_shared/RowMenu";
import {
  getFactions, getFactionDetail, deleteFaction, updateFactionLinks,
  addMember, updateMember, deleteMember, addFactionProperty, editFactionProperty, deleteFactionProperty,
  addNote, editNote, addOOCNote, editOOCNote,
  editSceneLog, editFactionSceneRewards, requestDeletion, directDelete, aiSummarize,
  completePromotion, cancelPromotion, requestRPChange,
  editAuditEntry, deleteAuditEntry,
  getStaffForTeam, getNPCsForRP, getFactionProperties,
  renameFaction, toggleFactionImport, getFactionImports,
  getFactionPortalMessages, postPortalMessage, deletePortalMessage, togglePortalMessagePin,
  getFactionContacts, markContactRead,
} from "../actions";

const MAIN_TABS = ["overview", "activity", "portal", "admin"];

export default function FactionDetailPage() {
  const auth = useAuth();
  const router = useRouter();
  const params = useParams();
  const { showConfirm, showPrompt, showAlert, showForm } = useDialog();

  const name = params?.name ? decodeURIComponent(params.name) : "";

  const [detail, setDetail] = useState(null);
  const [info, setInfo] = useState({});          // summary fields from getFactions (lead name, guides, stats)
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState("overview");
  const [activitySub, setActivitySub] = useState("intel");
  const [summary, setSummary] = useState("");
  const [summarizing, setSummarizing] = useState(false);

  // Member modal
  const [showAddMember, setShowAddMember] = useState(false);
  const [memberForm, setMemberForm] = useState({ name: "", phone: "N/A", residence: "N/A", role: 0 });
  const [editMemberId, setEditMemberId] = useState(null);
  // OOC editor
  const [showOOCEditor, setShowOOCEditor] = useState(false);
  const [oocText, setOocText] = useState("");
  const [oocAttendance, setOocAttendance] = useState({});
  const [oocStaff, setOocStaff] = useState([]);
  // Inline note editing
  const [editNoteId, setEditNoteId] = useState(null);
  const [editNoteText, setEditNoteText] = useState("");
  // Link editing
  const [showLinkEdit, setShowLinkEdit] = useState(null);
  const [linkValue, setLinkValue] = useState("");
  // Imports
  const [factionImports, setFactionImports] = useState([]);
  const [importSearch, setImportSearch] = useState("");
  const [importTierFilter, setImportTierFilter] = useState(null);
  // Portal
  const [portalMessages, setPortalMessages] = useState([]);
  const [portalContacts, setPortalContacts] = useState([]);
  const [portalMsgText, setPortalMsgText] = useState("");
  const [portalMsgPin, setPortalMsgPin] = useState(false);
  const [portalPosting, setPortalPosting] = useState(false);

  const canEdit = (authorId) => authorId === auth.id;
  const showAdminTab = auth.level >= 2; // Audit is L2+, Imports/Config gated to L3 inside

  // ── Data ──
  const load = useCallback(async () => {
    const [d, all] = await Promise.all([getFactionDetail(name), getFactions()]);
    setDetail(d);
    if (!d) { setNotFound(true); return null; }
    setInfo(all.find((f) => f.name === name) || {});
    return d;
  }, [name]);

  useEffect(() => {
    if (auth.loading || !name) return;
    (async () => { setLoading(true); await load(); setLoading(false); })();
  }, [auth.loading, name, load]);

  // Honour ?tab= deep links (e.g. card → Activity)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && MAIN_TABS.includes(t)) setTab(t);
  }, []);

  // Lazy-load Portal data when that tab is opened
  useEffect(() => {
    if (tab === "portal" && detail) {
      getFactionPortalMessages(detail.id).then(setPortalMessages);
      getFactionContacts(detail.id).then(setPortalContacts);
    }
  }, [tab, detail?.id]);

  // ── Handlers (ported 1:1 from the old dossier) ──
  const handleSaveMember = async () => {
    if (!memberForm.name.trim() || !detail) return;
    if (editMemberId) await updateMember(editMemberId, memberForm);
    else await addMember(detail.id, detail.name, memberForm);
    setShowAddMember(false); setEditMemberId(null); setMemberForm({ name: "", phone: "N/A", residence: "N/A", role: 0 });
    load();
  };
  const handleDeleteMember = async (m) => {
    if (!(await showConfirm(`Remove ${m.character_name}?`))) return;
    await deleteMember(m.id, m.character_name, detail.id, detail.name);
    load();
  };
  const handleSaveLink = async () => {
    if (!detail || !showLinkEdit) return;
    await updateFactionLinks(detail.id, showLinkEdit, linkValue);
    setShowLinkEdit(null);
    load();
  };
  const handleSubmitOOC = async () => {
    if (!oocText.trim() || !detail) return;
    const presentMembers = oocStaff.filter((m) => oocAttendance[m.discord_id]);
    const absentMembers = oocStaff.filter((m) => !oocAttendance[m.discord_id]);
    const present = presentMembers.map((m) => m.display_name);
    const absent = absentMembers.map((m) => m.display_name);
    const finalText = `<h3>Attendance</h3><p><strong>Present:</strong> ${present.join(", ") || "None"}</p><p><strong>Absent:</strong> ${absent.join(", ") || "None"}</p><hr/>${oocText}`;
    const attendeeIds = presentMembers.map((m) => m.discord_id);
    await addOOCNote(detail.id, detail.name, finalText, attendeeIds);
    setShowOOCEditor(false); setOocText("");
    setActivitySub("ooc");
    load();
  };
  const openOOCEditor = async () => {
    const staff = await getStaffForTeam(detail.name);
    setOocStaff(staff);
    const att = {}; staff.forEach((m) => (att[m.discord_id] = false));
    setOocAttendance(att); setOocText(""); setShowOOCEditor(true);
  };
  const handleEditNote = (type, id, text) => { setEditNoteId(id); setEditNoteText(text); };
  const handleSaveEditNote = async (type) => {
    try {
      if (type === "intel") await editNote(editNoteId, editNoteText);
      else if (type === "ooc") await editOOCNote(editNoteId, editNoteText);
      else if (type === "scene") await editSceneLog(editNoteId, editNoteText);
      setEditNoteId(null);
      load();
    } catch (e) { await showAlert(`Failed to save: ${e.message}`); }
  };
  const handleReqDelete = async (type, text, id) => {
    if (!(await showConfirm(`Request deletion of this ${type}?`))) return;
    await requestDeletion(type, text, id);
    await showAlert("Deletion request submitted.");
  };
  const handleDirectDelete = async (type, id) => {
    if (!(await showConfirm("L3 OVERRIDE: Permanently delete this entry?"))) return;
    await directDelete(type, id);
    load();
  };
  const handleSummarize = async () => {
    setSummarizing(true);
    const r = await aiSummarize(detail.name);
    setSummary(r.ok ? r.summary : `Error: ${r.error}`);
    setSummarizing(false);
  };
  const handleCompletePromo = async () => {
    if (!(await showConfirm(`Complete promotion for ${detail.name}?`))) return;
    await completePromotion(detail.id, detail.name);
    load();
  };
  const handleCancelPromo = async () => {
    if (!(await showConfirm("Cancel this staged promotion?"))) return;
    await cancelPromotion(detail.id, detail.name);
    load();
  };
  const handleDeleteFaction = async () => {
    if (!(await showConfirm(`Archive ${detail.name}? It will be moved to Operations > Archive and can be restored later.`, "Delete Faction"))) return;
    await deleteFaction(detail.id, detail.name);
    router.push("/fm/factions");
  };
  const handleRename = async () => {
    const n = await showPrompt("Rename faction:", detail.name);
    if (n && n !== detail.name) {
      await renameFaction(detail.id, detail.name, n);
      router.replace(`/fm/factions/${encodeURIComponent(n)}`);
    }
  };
  const handleStageRP = async () => {
    const [npcData, propData] = await Promise.all([getNPCsForRP(), getFactionProperties(detail.id)]);
    const npcOpts = npcData.map((n) => ({ label: n.name + " (" + n.npc_type + ") — " + n.turf, value: n.name + "|" + n.npc_type + "|" + n.turf }));
    const npcTypeOpts = [...new Set(npcData.map((n) => n.npc_type))].sort().map((t) => ({ label: t, value: t }));
    const propOpts = propData.map((p) => ({ label: (p.is_hq ? "HQ: " : "") + p.address, value: p.address }));
    const typeRes = await showForm("Stage RP Change — Step 1", [
      { name: "type", label: "Change Type", type: "select", options: [{ label: "NPC Change", value: "NPC" }, { label: "HQ Relocation", value: "HQ" }, { label: "Other", value: "Other" }], placeholder: "Select type..." },
    ]);
    if (!typeRes || !typeRes.type) return;
    let res;
    if (typeRes.type === "NPC") {
      res = await showForm("Stage NPC Change", [
        { name: "oldVal", label: "Current NPC", type: "select", options: npcOpts, placeholder: "Select NPC..." },
        { name: "newVal", label: "New NPC Type", type: "select", options: npcTypeOpts, placeholder: "Select new type..." },
      ]);
      if (res) { const parts = res.oldVal.split("|"); res.turf = parts[2] || ""; res.type = "NPC"; res.oldVal = parts[1] || res.oldVal; }
    } else if (typeRes.type === "HQ") {
      res = await showForm("Stage HQ Relocation", [
        { name: "oldVal", label: "Current Address", type: "select", options: propOpts, placeholder: "Select property..." },
        { name: "newVal", label: "New Address", type: "text", placeholder: "New HQ address" },
      ]);
      if (res) { res.type = "HQ"; res.turf = "N/A"; }
    } else {
      res = await showForm("Stage RP Change", [
        { name: "oldVal", label: "Current State", type: "text" },
        { name: "newVal", label: "New State", type: "text" },
      ]);
      if (res) { res.type = "Other"; res.turf = "N/A"; }
    }
    if (res && res.newVal) {
      await requestRPChange({ faction: detail.name, type: res.type || "Other", oldValue: res.oldVal || "N/A", newValue: res.newVal, turf: res.turf || "N/A" });
      await showAlert("RP change staged. FM Leadership notified.");
    }
  };

  // ── Render guards ──
  if (auth.loading || loading) return <div className="p-10 text-sm animate-pulse" style={{ color: "var(--accent)" }}>Loading dossier...</div>;
  if (notFound || !detail) return (
    <div className="w-full max-w-[1400px] mx-auto p-6">
      <a href="/fm/factions" style={s.link}>← Factions</a>
      <div className="mt-6 text-sm" style={{ color: "var(--fg-4)" }}>Faction “{name}” not found.</div>
    </div>
  );

  let promo = null;
  try { if (detail.pendingPromo) promo = JSON.parse(detail.pendingPromo); } catch (e) {}
  // Only the NEW imports this promotion grants — staged set minus what the faction already has.
  const newImports = promo ? (promo.imports || []).filter((n) => !(detail.authorizedItems || []).includes(n)) : [];
  const portalUrl = `https://meridiandatabase.net/faction/${encodeURIComponent(detail.name)}`;

  return (
    <div className="w-full max-w-[1400px] mx-auto p-4 lg:p-6 space-y-5">
      {/* HEADER */}
      <div className="flex flex-col gap-3 pb-4" style={{ borderBottom: "1px solid var(--border)" }}>
        <a href="/fm/factions" style={{ ...s.link, color: "var(--fg-4)" }}>← Factions</a>
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black uppercase italic tracking-tighter" style={{ fontFamily: "var(--font-display)" }}>{detail.name}</h1>
            <span style={{ ...s.badge, color: tierColor(detail.tier) }}>TIER {detail.tier}</span>
            {auth.level >= 3 && <button onClick={handleRename} style={{ fontSize: 12, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>✏️</button>}
          </div>
          <div className="flex items-center gap-2">
            {(auth.level >= 2 || auth.isLeadStoryteller) && <button onClick={handleStageRP} style={{ ...s.btnGhost, color: "var(--amber)" }}>Stage RP Change</button>}
            <a href={portalUrl} target="_blank" rel="noreferrer" style={s.btnGhost}>Portal ↗</a>
          </div>
        </div>
        {/* Pending promotion banner */}
        {promo && (auth.level >= 2 || auth.isLeadStoryteller) && (
          <div style={{ padding: "10px 14px", borderRadius: 10, background: "var(--green-bg)", border: "1px solid var(--green)" }}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--green)" }}>Promotion staged → Tier {promo.tier}</span>
              <div className="flex gap-2">
                <button onClick={handleCompletePromo} style={{ ...s.btn, background: "var(--green)" }}>Complete (T{promo.tier})</button>
                {auth.level >= 3 && <a href={`/fm/factions/promote?name=${encodeURIComponent(detail.name)}`} style={{ ...s.btnGhost, textDecoration: "none" }}>Adjust</a>}
                {auth.level >= 3 && <button onClick={handleCancelPromo} style={{ ...s.btnGhost, color: "var(--red)" }}>Cancel</button>}
              </div>
            </div>
            {/* NEW imports this promotion grants — visible to leads (L2+) and LST who complete it */}
            <div style={{ marginTop: 9 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--fg-4)", marginBottom: 5 }}>
                New imports being granted ({newImports.length})
              </div>
              {newImports.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--fg-4)", fontStyle: "italic" }}>No new imports — tier change only.</div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {newImports.map((n) => (
                    <span key={n} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "var(--bg-2)", color: "var(--fg-2)", border: "1px solid var(--border)" }}>{n}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* MAIN TABS */}
      <div className="flex overflow-x-auto scr" style={{ borderBottom: "1px solid var(--border)" }}>
        {[
          { id: "overview", label: "Overview" },
          { id: "activity", label: "Activity" },
          { id: "portal", label: "🌐 Portal" },
          ...(showAdminTab ? [{ id: "admin", label: "⚙ Admin" }] : []),
        ].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={s.tab(tab === t.id)}>{t.label}</button>
        ))}
      </div>

      {/* ════════════ OVERVIEW ════════════ */}
      {tab === "overview" && (
        <div className="space-y-5">
          {/* Summary bar — meta · activity · links in one compact strip */}
          <div style={{ ...s.section, padding: "16px 18px" }} className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <div>
              <div style={s.label}>Team Lead</div>
              <div className="text-sm font-semibold" style={{ color: "var(--accent)" }}>{info.leadName || "Unassigned"}</div>
            </div>
            <div className="min-w-0">
              <div style={s.label}>Guides</div>
              <div className="text-sm" style={{ color: "var(--fg-2)" }}>{info.guidesText || "None"}</div>
            </div>
            <div>
              <div style={s.label}>Last Promoted</div>
              <div className="text-sm font-mono" style={{ color: "var(--fg-3)" }}>{detail.lastPromoted || info.lastPromoted || "Never"}</div>
            </div>

            <div className="hidden lg:block self-stretch" style={{ width: 1, background: "var(--border)" }} />

            <div className="flex gap-6">
              {[["30 Days", info.scenes30d, "var(--fg-0)"], ["All Time", info.allTime, "var(--fg-4)"], ["Forum 30d", info.forumPosts, "var(--amber)"]].map(([lbl, val, col]) => (
                <div key={lbl} className="text-center">
                  <div className="text-2xl font-light leading-none" style={{ color: col, fontFamily: "var(--font-mono)" }}>{val ?? "—"}</div>
                  <div className="text-[9px] uppercase mt-1" style={{ color: "var(--fg-4)" }}>{lbl}</div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
              {["discord", "forum"].map((field) => {
                const val = detail[field];
                const isUrl = !!val;
                return (
                  <div key={field} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg" style={{ background: "var(--bg-1)", border: "1px solid var(--border)" }}>
                    <span className="text-[9px] font-bold uppercase" style={{ color: "var(--fg-4)" }}>{field}</span>
                    {isUrl
                      ? <a href={val} target="_blank" rel="noreferrer" style={s.link}>Open ↗</a>
                      : <span className="text-xs font-mono" style={{ color: val ? "var(--accent)" : "var(--fg-4)" }}>{val || "—"}</span>}
                    {auth.level >= 3 && <button title="Edit" style={{ fontSize: 11, color: "var(--fg-3)", background: "none", border: "none", cursor: "pointer", padding: 0 }} onClick={() => { setShowLinkEdit(field); setLinkValue(val || ""); }}>✎</button>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Command + properties */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
            <div style={s.section}>
              <div className="flex justify-between items-center mb-4">
                <div className="font-bold text-xs uppercase tracking-widest">Known Command</div>
                {auth.level >= 1 && <button style={s.btnGhost} onClick={() => { setEditMemberId(null); setMemberForm({ name: "", phone: "N/A", residence: "N/A", role: 0 }); setShowAddMember(true); }}>Add +</button>}
              </div>
              <div className="space-y-3">
                {detail.members?.map((m) => (
                  <div key={m.id} className="p-3 rounded-lg flex justify-between items-start gap-2" style={{ background: "var(--bg-1)", borderLeft: "3px solid var(--accent)" }}>
                    <div>
                      <div className="font-bold text-sm">{m.character_name} {m.is_leader >= 2 ? <span style={{ color: "var(--accent)", fontSize: 11 }}>(Leader)</span> : m.is_leader === 1 ? <span style={{ color: "var(--fg-3)", fontSize: 11 }}>(Command)</span> : null}</div>
                      <div className="text-xs font-mono mt-1" style={{ color: "var(--fg-3)" }}>📞 {m.phone} · 🏠 {m.residence}</div>
                    </div>
                    {auth.level >= 1 && <RowMenu actions={[
                      { label: "Edit", onClick: () => { setEditMemberId(m.id); setMemberForm({ name: m.character_name, phone: m.phone, residence: m.residence, role: m.is_leader }); setShowAddMember(true); } },
                      { label: "Delete", danger: true, onClick: () => handleDeleteMember(m) },
                    ]} />}
                  </div>
                ))}
                {(!detail.members || detail.members.length === 0) && <div className="text-xs italic" style={{ color: "var(--fg-4)" }}>No members on file.</div>}
              </div>
            </div>
            <div style={s.section}>
              <div className="flex justify-between items-center mb-4">
                <div className="font-bold text-xs uppercase tracking-widest">Registered Properties</div>
                {auth.level >= 1 && <button style={s.btnGhost} onClick={async () => { const res = await showForm("Add Property", [{ name: "address", label: "Address", type: "text" }, { name: "type", label: "Type", type: "text", placeholder: "e.g. HQ, Warehouse, Property" }, { name: "isHQ", label: "Mark as HQ?", type: "checkbox" }]); if (res?.address) { await addFactionProperty(detail.id, detail.name, { address: res.address, type: res.type || "Property", isHQ: !!res.isHQ }); load(); } }}>Add +</button>}
              </div>
              <div className="space-y-2">
                {detail.properties?.map((p) => (
                  <div key={p.id} className="flex justify-between items-center p-2.5 rounded" style={{ background: "var(--bg-1)" }}>
                    <span className="text-xs font-mono" style={{ color: p.isHQ ? "var(--accent)" : "var(--fg-2)" }}>{p.isHQ ? "🏰 HQ:" : "📍"} {p.address}</span>
                    {auth.level >= 1 && <RowMenu actions={[
                      { label: "Edit", onClick: async () => { const res = await showForm("Edit Property", [{ name: "address", label: "Address", type: "text", default: p.address }, { name: "type", label: "Type", type: "text", default: p.property_type || "Property", placeholder: "e.g. HQ, Warehouse, Property" }, { name: "isHQ", label: "Mark as HQ?", type: "checkbox", default: p.isHQ }]); if (res) { await editFactionProperty(p.id, { address: res.address, type: res.type || "Property", isHQ: res.isHQ }); load(); } } },
                      { label: "Delete", danger: true, onClick: async () => { if (await showConfirm("Remove this property?")) { await deleteFactionProperty(p.id, detail.name); load(); } } },
                    ]} />}
                  </div>
                ))}
                {(!detail.properties || detail.properties.length === 0) && <div className="text-xs italic" style={{ color: "var(--fg-4)" }}>No properties registered.</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════ ACTIVITY ════════════ */}
      {tab === "activity" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center gap-3 flex-wrap">
            <div className="flex gap-2">
              {[["intel", "Intel"], ["scenes", "Scenes"], ["ooc", "OOC"]].map(([id, lbl]) => (
                <button key={id} onClick={() => setActivitySub(id)} style={s.subtab(activitySub === id)}>{lbl}</button>
              ))}
            </div>
            <div className="flex gap-2">
              {activitySub === "intel" && <button style={s.btnGhost} onClick={async () => { const t = await showPrompt("Add Intelligence Note", "", { multiline: true, placeholder: "Enter your observation..." }); if (t) { try { const res = await addNote(detail.id, detail.name, t); if (res?.ok) load(); else await showAlert("Failed to save note."); } catch (e) { await showAlert(`Failed to save note: ${e.message}`); } } }}>Add Note +</button>}
              {activitySub === "ooc" && auth.level >= 1 && <button style={s.btn} onClick={openOOCEditor}>Document Meeting +</button>}
              {activitySub === "intel" && auth.level >= 2 && (
                <button onClick={handleSummarize} disabled={summarizing} style={{ ...s.btn, opacity: summarizing ? 0.5 : 1 }}>{summarizing ? "Generating..." : "AI Summarize ✨"}</button>
              )}
            </div>
          </div>

          {/* Intel */}
          {activitySub === "intel" && (
            <div className="space-y-3">
              {summary && <div className="p-5 rounded-xl whitespace-pre-wrap text-sm leading-relaxed" style={{ background: "var(--accent-bg)", border: "1px solid var(--accent-bg)", color: "var(--fg-1)" }}>{summary}</div>}
              {detail.notes?.map((n) => (
                <div key={n.id} className="p-4 rounded-lg" style={{ background: "var(--bg-2)", border: "1px solid var(--border)" }}>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-bold" style={{ color: "var(--accent)" }}>{n.author}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono" style={{ color: "var(--fg-4)" }}>{n.date}</span>
                      <RowMenu actions={[
                        canEdit(n.author_id) && { label: "Edit", onClick: () => handleEditNote("intel", n.id, n.text) },
                        canEdit(n.author_id) && { label: "Request deletion", onClick: () => handleReqDelete("intel_note", n.text, n.id) },
                        auth.level >= 3 && { label: "Delete", danger: true, onClick: () => handleDirectDelete("intel_note", n.id) },
                      ]} />
                    </div>
                  </div>
                  {editNoteId === n.id ? (
                    <div><textarea style={{ ...s.input, minHeight: 80 }} value={editNoteText} onChange={(e) => setEditNoteText(e.target.value)} /><div className="flex gap-2 mt-2"><button style={s.btn} onClick={() => handleSaveEditNote("intel")}>Save</button><button style={s.btnGhost} onClick={() => setEditNoteId(null)}>Cancel</button></div></div>
                  ) : (
                    <p className="text-sm leading-relaxed" style={{ color: "var(--fg-2)" }}>{n.text}</p>
                  )}
                </div>
              ))}
              {(!detail.notes || detail.notes.length === 0) && <div className="text-xs italic" style={{ color: "var(--fg-4)" }}>No intelligence notes.</div>}
            </div>
          )}

          {/* Scenes */}
          {activitySub === "scenes" && (
            <div className="space-y-3">
              {detail.sceneLogs?.map((l) => (
                <div key={l.id} className="p-4 rounded-lg" style={{ background: "var(--bg-2)", border: "1px solid var(--border)" }}>
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2"><span className="text-[10px] font-mono" style={{ color: "var(--fg-4)" }}>{l.date}</span><span className="text-[10px] font-bold" style={{ color: "var(--fg-3)" }}>{l.logged_by}</span></div>
                    <div className="flex items-center gap-2">
                      {l.rewards !== "None" && <span className="text-[9px] font-bold px-2 py-0.5 rounded" style={{ background: "var(--green-bg)", color: "var(--green)" }}>Rewards</span>}
                      <RowMenu actions={[
                        canEdit(l.author_id) && { label: "Edit", onClick: () => handleEditNote("scene", l.id, l.notes) },
                        canEdit(l.author_id) && { label: "Request deletion", onClick: () => handleReqDelete("scene_log", l.notes, l.id) },
                        auth.level >= 3 && { label: "Edit rewards", onClick: async () => { const v = await showPrompt("Edit rewards:", l.rewards); if (v !== null) { await editFactionSceneRewards(l.id, v); load(); } } },
                        auth.level >= 3 && { label: "Delete", danger: true, onClick: () => handleDirectDelete("scene_log", l.id) },
                      ]} />
                    </div>
                  </div>
                  {editNoteId === l.id ? (
                    <div><textarea style={{ ...s.input, minHeight: 80 }} value={editNoteText} onChange={(e) => setEditNoteText(e.target.value)} /><div className="flex gap-2 mt-2"><button style={s.btn} onClick={() => handleSaveEditNote("scene")}>Save</button><button style={s.btnGhost} onClick={() => setEditNoteId(null)}>Cancel</button></div></div>
                  ) : (
                    <p className="text-sm leading-relaxed" style={{ color: "var(--fg-2)" }}>{l.notes}</p>
                  )}
                  {l.rewards !== "None" && (
                    <div className="text-[10px] font-mono mt-2 p-2 rounded" style={{ background: "var(--green-bg)", color: "var(--green)" }}>{l.rewards}</div>
                  )}
                </div>
              ))}
              {(!detail.sceneLogs || detail.sceneLogs.length === 0) && <div className="text-xs italic" style={{ color: "var(--fg-4)" }}>No scene logs.</div>}
            </div>
          )}

          {/* OOC */}
          {activitySub === "ooc" && (
            <div className="space-y-3">
              {detail.oocNotes?.map((n) => (
                <div key={n.id} className="rounded-xl overflow-hidden" style={{ background: "var(--bg-2)", border: "1px solid var(--border)" }}>
                  <div className="p-4 flex justify-between items-center">
                    <div className="flex items-center gap-3"><span className="text-[10px] font-mono" style={{ color: "var(--accent)" }}>{n.date}</span><span className="text-xs font-bold">By: {n.author}</span></div>
                    <RowMenu actions={[
                      (canEdit(n.author_id) || auth.level >= 2) && { label: "Edit", onClick: () => { setActivitySub("ooc"); setEditNoteId(n.id); setEditNoteText(n.text); } },
                      auth.level >= 3 && { label: "Delete", danger: true, onClick: () => handleDirectDelete("ooc_note", n.id) },
                    ]} />
                  </div>
                  <div className="px-4 pb-4 pt-2" style={{ borderTop: "1px solid var(--border)" }}>
                    {editNoteId === n.id ? (
                      <div>
                        <QuillEditor value={editNoteText} onChange={setEditNoteText} placeholder="Meeting notes..." />
                        <div className="flex gap-2 mt-2"><button style={s.btn} onClick={() => handleSaveEditNote("ooc")}>Save</button><button style={s.btnGhost} onClick={() => setEditNoteId(null)}>Cancel</button></div>
                      </div>
                    ) : (
                      <div className="text-sm prose prose-sm max-w-none leading-relaxed quill-content" style={{ color: "var(--fg-2)" }} dangerouslySetInnerHTML={{ __html: n.text }} />
                    )}
                  </div>
                </div>
              ))}
              {(!detail.oocNotes || detail.oocNotes.length === 0) && <div className="text-xs italic" style={{ color: "var(--fg-4)" }}>No OOC meeting notes.</div>}
            </div>
          )}
        </div>
      )}

      {/* ════════════ PORTAL ════════════ */}
      {tab === "portal" && (
        <div className="space-y-6">
          <div style={{ padding: "10px 14px", background: "rgba(160,126,245,0.07)", border: "1px solid rgba(160,126,245,0.2)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 11, color: "var(--fg-3)" }}>Public page:</span>
            <a href={portalUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--accent)", fontWeight: 700 }}>meridiandatabase.net/faction/{detail.name} ↗</a>
          </div>
          <div style={s.section}>
            <div className="font-bold text-xs uppercase tracking-widest mb-3">Post to Faction Page</div>
            <textarea rows={4} style={{ ...s.input, fontFamily: "inherit", resize: "vertical", marginBottom: 10 }} placeholder="Write a message for the faction to see on their public page..." value={portalMsgText} onChange={(e) => setPortalMsgText(e.target.value)} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer", color: "var(--fg-3)" }}>
                <input type="checkbox" checked={portalMsgPin} onChange={(e) => setPortalMsgPin(e.target.checked)} /> Pin to top
              </label>
              <button style={s.btn} disabled={portalPosting || !portalMsgText.trim()} onClick={async () => { setPortalPosting(true); await postPortalMessage(detail.id, detail.name, portalMsgText, portalMsgPin); setPortalMsgText(""); setPortalMsgPin(false); setPortalPosting(false); getFactionPortalMessages(detail.id).then(setPortalMessages); }}>{portalPosting ? "Posting…" : "Post Message"}</button>
            </div>
          </div>
          {portalMessages.length > 0 && (
            <div style={s.section}>
              <div className="font-bold text-xs uppercase tracking-widest mb-3">Posted Messages</div>
              <div className="space-y-2">
                {portalMessages.map((m) => (
                  <div key={m.id} style={{ padding: "10px 12px", background: "var(--bg-1)", borderRadius: 8, border: `1px solid ${m.is_pinned ? "rgba(160,126,245,0.3)" : "var(--border)"}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)" }}>{m.author_name}</span>
                        {m.is_pinned === 1 && <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: "rgba(160,126,245,0.15)", color: "var(--accent)" }}>PINNED</span>}
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 10, color: "var(--fg-4)", fontFamily: "var(--font-mono)" }}>{m.created_at?.substring(0, 16)}</span>
                        <RowMenu actions={[
                          { label: m.is_pinned ? "Unpin" : "Pin", onClick: async () => { await togglePortalMessagePin(m.id); getFactionPortalMessages(detail.id).then(setPortalMessages); } },
                          { label: "Delete", danger: true, onClick: async () => { await deletePortalMessage(m.id); getFactionPortalMessages(detail.id).then(setPortalMessages); } },
                        ]} />
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--fg-2)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{m.message}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={s.section}>
            <div className="font-bold text-xs uppercase tracking-widest mb-3" style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Incoming Contacts</span>
              <span style={{ color: "var(--fg-4)", fontWeight: 400 }}>{portalContacts.filter((c) => !c.is_read).length} unread</span>
            </div>
            {portalContacts.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--fg-4)", fontStyle: "italic" }}>No messages received yet.</div>
            ) : portalContacts.map((c) => (
              <div key={c.id} style={{ padding: "10px 12px", marginBottom: 8, background: "var(--bg-1)", borderRadius: 8, border: "1px solid var(--border)", opacity: c.is_read ? 0.6 : 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--fg-1)" }}>{c.sender_name}</span>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 3, background: c.contact_type === "IC" ? "rgba(160,126,245,0.15)" : "rgba(251,191,36,0.15)", color: c.contact_type === "IC" ? "var(--accent)" : "var(--amber)" }}>{c.contact_type}</span>
                    {!c.is_read && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", display: "inline-block" }} />}
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 10, color: "var(--fg-4)", fontFamily: "var(--font-mono)" }}>{c.submitted_at?.substring(0, 16)}</span>
                    {!c.is_read && <button onClick={async () => { await markContactRead(c.id); getFactionContacts(detail.id).then(setPortalContacts); }} style={{ fontSize: 10, color: "var(--fg-4)", background: "none", border: "none", cursor: "pointer" }}>Mark read</button>}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "var(--fg-2)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{c.message}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ════════════ ADMIN ════════════ */}
      {tab === "admin" && showAdminTab && (
        <div className="space-y-6">
          {/* Audit (L2+) */}
          <div style={s.section}>
            <div className="font-bold text-xs uppercase tracking-widest mb-4">Audit Trail</div>
            <div className="space-y-2">
              {detail.history?.map((h) => (
                <div key={h.id} className="flex flex-col md:flex-row gap-3 py-3 px-4 rounded-lg text-[11px]" style={{ background: "var(--bg-1)", border: "1px solid var(--border)" }}>
                  <span className="min-w-[130px] font-mono" style={{ color: "var(--fg-4)" }}>{h.created_at}</span>
                  <span className="min-w-[120px] font-bold" style={{ color: h.action_type.includes("PROMO") ? "var(--green)" : "var(--accent)" }}>{h.action_type}</span>
                  <span className="flex-1" style={{ color: "var(--fg-2)" }}>{h.details}</span>
                  <span style={{ color: "var(--fg-4)" }}>Auth: {h.authorized_by}</span>
                  {auth.level >= 3 && <RowMenu actions={[
                    { label: "Edit", onClick: async () => { const v = await showPrompt("Edit details:", h.details); if (v !== null) { await editAuditEntry(h.id, v); load(); } } },
                    { label: "Delete", danger: true, onClick: async () => { if (await showConfirm("Delete this audit entry?")) { await deleteAuditEntry(h.id); load(); } } },
                  ]} />}
                </div>
              ))}
              {(!detail.history || detail.history.length === 0) && <div className="text-xs italic" style={{ color: "var(--fg-4)" }}>No history recorded.</div>}
            </div>
          </div>

          {/* Imports (L3) */}
          {auth.level >= 3 && (
            <div style={s.section}>
              <div className="flex justify-between items-center">
                <div><div className="font-bold text-xs uppercase tracking-widest">Authorized Imports</div><div className="text-[10px] mt-1" style={{ color: "var(--fg-4)" }}>Toggle current permissions. To promote and modify imports together, use Stage Promotion.</div></div>
                <div className="flex items-center gap-3">
                  <a href={`/fm/factions/promote?name=${encodeURIComponent(detail.name)}`} style={s.btn}>Stage Promotion →</a>
                  <button style={{ ...s.btnGhost, color: "var(--accent)" }} onClick={async () => { const items = await getFactionImports(detail.id); setFactionImports(items); setImportSearch(""); setImportTierFilter(null); }}>Manage Imports</button>
                </div>
              </div>
              {factionImports.length > 0 && (
                <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
                  <div className="flex justify-between items-center mb-3">
                    <h4 className="text-sm font-bold uppercase" style={{ color: "var(--fg-3)" }}>Import Permissions</h4>
                    <div className="flex gap-2 items-center">
                      <input style={{ ...s.input, maxWidth: 200, padding: "5px 10px", fontSize: 12 }} placeholder="Search items..." value={importSearch} onChange={(e) => setImportSearch(e.target.value)} />
                      <button onClick={() => setFactionImports([])} style={{ fontSize: 10, color: "var(--fg-4)", background: "none", border: "none", cursor: "pointer" }}>Close</button>
                    </div>
                  </div>
                  <div className="flex gap-1.5 mb-3">
                    <button onClick={() => setImportTierFilter(null)} className="px-2.5 py-1 rounded text-[10px] font-bold" style={{ background: !importTierFilter ? "var(--accent)" : "var(--bg-2)", color: !importTierFilter ? "white" : "var(--fg-3)", border: "none", cursor: "pointer" }}>All</button>
                    {[...new Set(factionImports.map((i) => i.tier))].sort((a, b) => a - b).map((t) => (
                      <button key={t} onClick={() => setImportTierFilter(t)} className="px-2.5 py-1 rounded text-[10px] font-bold" style={{ background: importTierFilter === t ? "var(--accent)" : "var(--bg-2)", color: importTierFilter === t ? "white" : "var(--fg-3)", border: "none", cursor: "pointer" }}>T{t}</button>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-1 max-h-[400px] overflow-y-auto scr">
                    {factionImports
                      .filter((i) => !importTierFilter || i.tier === importTierFilter)
                      .filter((i) => !importSearch || i.name.toLowerCase().includes(importSearch.toLowerCase()))
                      .map((item) => (
                        <div key={item.id} className="flex items-center gap-2 px-3 py-2 rounded cursor-pointer" style={{ background: item.permitted ? "var(--green-bg)" : "var(--bg-2)", border: item.permitted ? "1px solid var(--green)" : "1px solid var(--border)" }}
                          onClick={async () => { await toggleFactionImport(detail.id, item.id, !item.permitted); setFactionImports((prev) => prev.map((p) => (p.id === item.id ? { ...p, permitted: !p.permitted } : p))); }}>
                          <span style={{ fontSize: 14 }}>{item.permitted ? "✅" : "⬜"}</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0" style={{ background: "var(--bg-3)", color: "var(--fg-4)" }}>T{item.tier}</span>
                          <span className="text-sm flex-1 truncate" style={{ color: item.permitted ? "var(--green)" : "var(--fg-2)" }}>{item.name}</span>
                          <span className="text-[10px]" style={{ color: "var(--fg-4)" }}>{item.category}</span>
                        </div>
                      ))}
                  </div>
                  <div className="mt-2 text-[10px] text-right" style={{ color: "var(--fg-4)" }}>{factionImports.filter((i) => i.permitted).length} / {factionImports.length} items authorized</div>
                </div>
              )}
            </div>
          )}

          {/* Configuration (L3) — legacy fields kept out of the Overview */}
          {auth.level >= 3 && (
            <div style={s.section}>
              <div className="flex flex-wrap justify-between items-center gap-3">
                <div>
                  <div className="font-bold text-xs uppercase tracking-widest">Configuration</div>
                  <div className="text-[10px] mt-1" style={{ color: "var(--fg-4)" }}>Feedback thread — no longer part of the workflow, retained for reference.</div>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg" style={{ background: "var(--bg-1)", border: "1px solid var(--border)" }}>
                  <span className="text-[9px] font-bold uppercase" style={{ color: "var(--fg-4)" }}>Thread</span>
                  <span className="text-xs font-mono" style={{ color: detail.threadId ? "var(--accent)" : "var(--fg-4)" }}>{detail.threadId || "—"}</span>
                  <button title="Edit" style={{ fontSize: 11, color: "var(--fg-3)", background: "none", border: "none", cursor: "pointer", padding: 0 }} onClick={() => { setShowLinkEdit("thread"); setLinkValue(detail.threadId || ""); }}>✎</button>
                </div>
              </div>
            </div>
          )}

          {/* Danger zone (L3) */}
          {auth.level >= 3 && (
            <div style={{ ...s.section, borderColor: "var(--red-bg)" }}>
              <div className="flex justify-between items-center">
                <div><div className="font-bold text-xs uppercase tracking-widest" style={{ color: "var(--red)" }}>Danger Zone</div><div className="text-[10px] mt-1" style={{ color: "var(--fg-4)" }}>Archive removes the faction from active lists (restorable from Operations → Archive).</div></div>
                <button style={s.btnDanger} onClick={handleDeleteFaction}>Delete Faction</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ ADD/EDIT MEMBER MODAL ═══ */}
      {showAddMember && (
        <div style={s.modal}><div style={s.modalBg} onClick={() => setShowAddMember(false)} />
          <div style={{ ...s.modalContent, maxWidth: 450 }}>
            <div className="p-5 flex justify-between items-center" style={{ borderBottom: "1px solid var(--border)" }}>
              <h3 className="font-bold uppercase">{editMemberId ? "Edit" : "Add"} Member</h3>
              <button onClick={() => setShowAddMember(false)} style={{ color: "var(--fg-4)", fontSize: 18, background: "none", border: "none", cursor: "pointer" }}>✕</button>
            </div>
            <div className="p-5 space-y-3">
              <div><div style={s.label}>Character Name</div><input style={s.input} value={memberForm.name} onChange={(e) => setMemberForm({ ...memberForm, name: e.target.value })} /></div>
              <div><div style={s.label}>Phone</div><input style={s.input} value={memberForm.phone} onChange={(e) => setMemberForm({ ...memberForm, phone: e.target.value })} /></div>
              <div><div style={s.label}>Residence</div><input style={s.input} value={memberForm.residence} onChange={(e) => setMemberForm({ ...memberForm, residence: e.target.value })} /></div>
              <div><div style={s.label}>Role</div><select style={s.input} value={memberForm.role} onChange={(e) => setMemberForm({ ...memberForm, role: parseInt(e.target.value) })}><option value={0}>Member</option><option value={1}>Command</option><option value={2}>Leader</option></select></div>
            </div>
            <div className="p-5 flex justify-end gap-3" style={{ borderTop: "1px solid var(--border)" }}>
              <button style={s.btnGhost} onClick={() => setShowAddMember(false)}>Cancel</button>
              <button style={s.btn} onClick={handleSaveMember}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ OOC NOTE EDITOR ═══ */}
      {showOOCEditor && (
        <div style={s.modal}><div style={s.modalBg} onClick={() => setShowOOCEditor(false)} />
          <div style={{ ...s.modalContent, maxWidth: 900 }}>
            <div className="p-5 flex justify-between items-center" style={{ borderBottom: "1px solid var(--border)" }}>
              <h3 className="font-bold uppercase">OOC Meeting: {detail?.name}</h3>
              <button onClick={() => setShowOOCEditor(false)} style={{ color: "var(--fg-4)", fontSize: 18, background: "none", border: "none", cursor: "pointer" }}>✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 lg:grid-cols-3 gap-6 scr">
              <div>
                <div style={s.label}>Attendance</div>
                <div className="space-y-2 mt-2">
                  {oocStaff.map((m) => (
                    <label key={m.discord_id} className="flex items-center justify-between p-3 rounded-lg cursor-pointer" style={{ background: oocAttendance[m.discord_id] ? "var(--accent-bg)" : "var(--bg-2)", border: `1px solid ${oocAttendance[m.discord_id] ? "var(--accent)" : "var(--border)"}` }}>
                      <div><div className="text-xs font-bold">{m.display_name}</div><div className="text-[9px]" style={{ color: "var(--fg-4)" }}>{m.rank}</div></div>
                      <input type="checkbox" checked={oocAttendance[m.discord_id] || false} onChange={() => setOocAttendance({ ...oocAttendance, [m.discord_id]: !oocAttendance[m.discord_id] })} />
                    </label>
                  ))}
                  {oocStaff.length === 0 && <div className="text-xs italic" style={{ color: "var(--fg-4)" }}>No team members found.</div>}
                </div>
              </div>
              <div className="lg:col-span-2">
                <div style={s.label}>Meeting Notes</div>
                <div className="mt-2"><QuillEditor value={oocText} onChange={setOocText} placeholder="Meeting notes..." /></div>
              </div>
            </div>
            <div className="p-5 flex justify-end gap-3" style={{ borderTop: "1px solid var(--border)" }}>
              <button style={s.btnGhost} onClick={() => setShowOOCEditor(false)}>Cancel</button>
              <button style={s.btn} onClick={handleSubmitOOC}>Save Note</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ LINK EDIT MODAL ═══ */}
      {showLinkEdit && (
        <div style={s.modal}><div style={s.modalBg} onClick={() => setShowLinkEdit(null)} />
          <div style={{ ...s.modalContent, maxWidth: 450 }}>
            <div className="p-5" style={{ borderBottom: "1px solid var(--border)" }}><h3 className="font-bold uppercase">Edit {showLinkEdit}</h3></div>
            <div className="p-5"><input style={s.input} value={linkValue} onChange={(e) => setLinkValue(e.target.value)} /></div>
            <div className="p-5 flex justify-end gap-3" style={{ borderTop: "1px solid var(--border)" }}>
              <button style={s.btnGhost} onClick={() => setShowLinkEdit(null)}>Cancel</button>
              <button style={s.btn} onClick={handleSaveLink}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
