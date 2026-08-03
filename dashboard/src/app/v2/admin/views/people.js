"use client";
// Admin › People: Staff & Teams board (+COI/retire/promote), FM Hours (owner).
// Split out of admin/page.js — content unchanged; FormModal now comes from the shared Modal.
import { useEffect, useMemo, useState } from "react";
import { getStaffList, getStaffActivity, getTeamList, getFactionAssignments, addStaff, updateStaff, createTeam, renameTeam, deleteTeam, commitAllChanges, getAllStaffCOI, getMeridianFactions, addStaffCOI, removeStaffCOI, getStaffFactions, retireStaff, promoteToLead, takeoverTeam, getDashboardAccessList, grantDashboardAccess, revokeDashboardAccess } from "../../../fm/operations/staff/actions.js";
import { getFMStaffWithLinks, setCharacterLink, getFMHoursForPeriod, saveFMHours, getFMScenesForPeriod, getFMMeetingsForPeriod, postFMReport } from "../../../fm/operations/fmhours/actions.js";
import { FormModal } from "../../Modal.js";

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

export { StaffTeams, FMHours };
