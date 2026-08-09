"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/useAuth";
import { useDialog } from "../../../lib/useDialog";
import { getFactions, addFaction, completePromotion } from "./actions";
import { getTeamList } from "../operations/staff/actions";
import { s, tierColor } from "./_shared/styles";
import RowMenu from "./_shared/RowMenu";
import TableSkeleton from "../../../lib/TableSkeleton";

const th = { padding: "9px 12px", fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--fg-4)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap", userSelect: "none", cursor: "pointer", borderBottom: "1px solid var(--border)" };
const td = { padding: "10px 12px", fontSize: 13, color: "var(--fg-2)", whiteSpace: "nowrap", borderBottom: "1px solid var(--border)" };

export default function FactionsPage() {
  const auth = useAuth();
  const router = useRouter();
  const { showConfirm } = useDialog();
  const [factions, setFactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState({ key: "name", dir: "asc" });
  const [showAddFaction, setShowAddFaction] = useState(false);
  const [teams, setTeams] = useState([]);
  const [addForm, setAddForm] = useState({
    name: "", teamId: "", tier: "0", threadId: "", forum: "", discord: "", aliases: "",
    hqAddress: "",
    guildId: "", guildName: "",
    accessRoleId: "", accessRoleName: "",
    commsChannelId: "", commsChannelName: "",
    guideRoleId: "", managementRoleId: "",
  });

  const refresh = useCallback(async () => { setFactions(await getFactions()); }, []);
  useEffect(() => { if (!auth.loading) refresh().then(() => setLoading(false)); }, [auth.loading, refresh]);

  // Team list only loads when the modal opens — getTeamList is L3-gated.
  useEffect(() => {
    if (showAddFaction && !teams.length) getTeamList().then(setTeams).catch(() => {});
  }, [showAddFaction, teams.length]);

  // Preserve old deep links (?detail=Name from the dashboard) → new detail route.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const detailName = new URLSearchParams(window.location.search).get("detail");
    if (detailName) router.replace(`/fm/factions/${encodeURIComponent(detailName)}`);
  }, [router]);

  const open = (name, tab) => router.push(`/fm/factions/${encodeURIComponent(name)}${tab ? `?tab=${tab}` : ""}`);

  const handleAddFaction = async () => {
    if (!addForm.name.trim()) return;
    await addFaction(addForm);
    setShowAddFaction(false);
    setAddForm({
      name: "", teamId: "", tier: "0", threadId: "", forum: "", discord: "", aliases: "",
      hqAddress: "",
      guildId: "", guildName: "",
      accessRoleId: "", accessRoleName: "",
      commsChannelId: "", commsChannelName: "",
      guideRoleId: "", managementRoleId: "",
    });
    refresh();
  };

  const handleCompletePromo = async (fac) => {
    if (!(await showConfirm(`Complete promotion for ${fac.name}?`))) return;
    await completePromotion(fac.id, fac.name);
    refresh();
  };

  const toggleSort = (key) => setSort((s) => (s.key === key
    ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
    : { key, dir: key === "name" || key === "leadName" ? "asc" : "desc" }));

  const sortVal = (f, key) => {
    if (key === "name") return (f.name || "").toLowerCase();
    if (key === "leadName") return (f.leadName || "").toLowerCase();
    if (key === "lastPromoted") { const t = Date.parse((f.lastPromoted || "").replace(/\//g, " ")); return isNaN(t) ? 0 : t; }
    return f[key] ?? 0; // tier, scenes30d, allTime, forumPosts
  };

  if (auth.loading || loading) return <TableSkeleton cols={['1.4fr','0.5fr','1fr','1fr','0.8fr']} rows={8} />;

  const filtered = factions.filter((f) => f.name.toLowerCase().includes(search.toLowerCase()) || f.leadName.toLowerCase().includes(search.toLowerCase()) || f.guidesText.toLowerCase().includes(search.toLowerCase()));
  const sorted = [...filtered].sort((a, b) => {
    const av = sortVal(a, sort.key), bv = sortVal(b, sort.key);
    if (av < bv) return sort.dir === "asc" ? -1 : 1;
    if (av > bv) return sort.dir === "asc" ? 1 : -1;
    return 0;
  });
  const arrow = (key) => (sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "");

  return (
    <div className="w-full max-w-[1400px] mx-auto p-4 lg:p-6 space-y-5">
      {/* HEADER */}
      <div className="flex flex-col gap-4 pb-4" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-3">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight" style={{ fontFamily: "var(--font-display)", letterSpacing: "-0.03em" }}>Factions</h1>
            <p className="text-sm mt-1" style={{ color: "var(--fg-3)" }}>Live organizational database. Click a faction to open its dossier.</p>
          </div>
          <div className="flex items-center gap-3">
            <a href="/fm/documents?sop=Faction+Pages+%26+Reviews" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 600, padding: "3px 10px", borderRadius: 5, border: "1px solid rgba(99,102,241,0.3)", background: "rgba(99,102,241,0.08)", color: "#818cf8", textDecoration: "none" }}>📄 Faction Page Guide</a>
            <span className="text-[10px] font-mono uppercase" style={{ color: "var(--fg-4)" }}>{auth.name} · L{auth.level}</span>
            {auth.level >= 3 && <button onClick={() => setShowAddFaction(true)} style={s.btn}>Add Faction +</button>}
          </div>
        </div>
        <input type="text" placeholder="Search by faction, lead, or guide..." style={s.input} className="max-w-xl" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {/* FACTION TABLE */}
      <div style={{ ...s.card, overflow: "hidden" }}>
        <div className="overflow-x-auto scr">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left" }} onClick={() => toggleSort("name")}>Faction{arrow("name")}</th>
                <th style={{ ...th, textAlign: "center" }} onClick={() => toggleSort("tier")}>Tier{arrow("tier")}</th>
                <th style={{ ...th, textAlign: "left" }} onClick={() => toggleSort("leadName")}>Team Lead{arrow("leadName")}</th>
                <th style={{ ...th, textAlign: "center" }} onClick={() => toggleSort("scenes30d")}>30d{arrow("scenes30d")}</th>
                <th style={{ ...th, textAlign: "center" }} onClick={() => toggleSort("allTime")}>All{arrow("allTime")}</th>
                <th style={{ ...th, textAlign: "center" }} onClick={() => toggleSort("forumPosts")}>Forum{arrow("forumPosts")}</th>
                <th style={{ ...th, textAlign: "left" }} onClick={() => toggleSort("lastPromoted")}>Last Promoted{arrow("lastPromoted")}</th>
                <th style={{ ...th, textAlign: "right", cursor: "default" }}></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((fac) => {
                let promo = null;
                try { if (fac.pendingPromo) promo = JSON.parse(fac.pendingPromo); } catch (e) {}
                const canPromo = promo && (auth.level >= 2 || auth.isLeadStoryteller);
                const newImports = promo ? (promo.imports || []).filter((n) => !(fac.authorizedItems || []).includes(n)) : [];
                const actions = [
                  fac.discord && { label: "Open Discord ↗", onClick: () => window.open(fac.discord, "_blank") },
                  fac.forum && { label: "Open Forum ↗", onClick: () => window.open(fac.forum, "_blank") },
                  { label: "Open Portal ↗", onClick: () => window.open(`https://meridiandatabase.net/faction/${encodeURIComponent(fac.name)}`, "_blank") },
                  canPromo && { label: `Complete promotion (T${promo.tier}, ${newImports.length} new imports)`, onClick: () => handleCompletePromo(fac) },
                ];
                return (
                  <tr key={fac.id} onClick={() => open(fac.name)} className="cursor-pointer hover:bg-[var(--bg-2)]">
                    <td style={{ ...td, fontWeight: 700, color: "var(--fg-0)", fontFamily: "var(--font-display)" }}>{fac.name}</td>
                    <td style={{ ...td, textAlign: "center" }}>
                      <span style={{ fontWeight: 700, color: tierColor(fac.tier) }}>T{fac.tier}</span>
                      {canPromo && <span title={`Staged → T${promo.tier} · New imports: ${newImports.join(", ") || "none"}`} style={{ marginLeft: 5, color: "var(--green)", fontSize: 11 }}>▲</span>}
                    </td>
                    <td style={{ ...td, color: "var(--accent)" }}>{fac.leadName}</td>
                    <td style={{ ...td, textAlign: "center", fontFamily: "var(--font-mono)", color: "var(--fg-0)" }}>{fac.scenes30d}</td>
                    <td style={{ ...td, textAlign: "center", fontFamily: "var(--font-mono)", color: "var(--fg-4)" }}>{fac.allTime}</td>
                    <td style={{ ...td, textAlign: "center", fontFamily: "var(--font-mono)", color: "var(--amber)" }}>{fac.forumPosts}</td>
                    <td style={{ ...td, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-4)" }}>{fac.lastPromoted}</td>
                    <td style={{ ...td, textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end"><RowMenu actions={actions} /></div>
                    </td>
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr><td colSpan={8} className="py-10 text-center text-sm" style={{ color: "var(--fg-4)" }}>No factions match your search.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ADD FACTION MODAL */}
      {showAddFaction && (
        <div style={s.modal}><div style={s.modalBg} onClick={() => setShowAddFaction(false)} />
          <div style={{ ...s.modalContent, maxWidth: 560 }}>
            <div className="p-6 flex justify-between items-center" style={{ borderBottom: "1px solid var(--border)" }}>
              <h2 className="text-lg font-bold uppercase tracking-tight">Create Faction</h2>
              <button onClick={() => setShowAddFaction(false)} style={{ color: "var(--fg-4)", fontSize: 20, background: "none", border: "none", cursor: "pointer" }}>✕</button>
            </div>
            <div className="p-6 overflow-y-auto scr" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {/* Dashboard info */}
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "var(--accent)", fontFamily: "var(--font-mono)", marginBottom: 12 }}>Dashboard Info</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {[
                    { k: "name", l: "Faction Name", required: true },
                    { k: "teamId", l: "Assigned Team (optional — assign later on Staff & Teams)", select: true },
                    { k: "tier", l: "Starting Tier", required: true },
                    { k: "threadId", l: "Feedback Thread ID", required: false },
                    { k: "forum", l: "Forum URL", required: false },
                    { k: "discord", l: "Discord URL", required: false },
                    { k: "aliases", l: "Forum Aliases (comma-separated alt names for post matching)", required: false },
                    { k: "hqAddress", l: "Initial HQ Address", required: false },
                  ].map((f) => (
                    <div key={f.k}>
                      <div style={s.label}>{f.l}{f.required && <span style={{ color: "var(--red)", marginLeft: 4 }}>*</span>}</div>
                      {f.select ? (
                        <select style={s.input} value={addForm[f.k]} onChange={(e) => setAddForm({ ...addForm, [f.k]: e.target.value })}>
                          <option value="">Unassigned</option>
                          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      ) : (
                        <input style={s.input} value={addForm[f.k]} onChange={(e) => setAddForm({ ...addForm, [f.k]: e.target.value })} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
              {/* Meridian Database (faction portal) */}
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "var(--green)", fontFamily: "var(--font-mono)", marginBottom: 4 }}>Meridian Database — Faction Portal</div>
                <div style={{ fontSize: 11, color: "var(--fg-4)", marginBottom: 12 }}>Enables faction members to log into meridiandatabase.net and receive FM announcements. Leave blank to configure later via Operations → Bot Servers.</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {[
                    { k: "guildId", l: "Discord Server ID" },
                    { k: "guildName", l: "Discord Server Name" },
                    { k: "accessRoleId", l: "Access Role ID" },
                    { k: "accessRoleName", l: "Access Role Name" },
                    { k: "commsChannelId", l: "Comms Channel ID" },
                    { k: "commsChannelName", l: "Comms Channel Name" },
                  ].map((f) => (
                    <div key={f.k}>
                      <div style={s.label}>{f.l}</div>
                      <input style={s.input} value={addForm[f.k]} onChange={(e) => setAddForm({ ...addForm, [f.k]: e.target.value })} />
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--fg-3)", fontFamily: "var(--font-mono)", marginBottom: 8 }}>Watch Roles (auto-registered for ping monitoring)</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {[
                      { k: "guideRoleId", l: "ECRP Guide Role ID" },
                      { k: "managementRoleId", l: "ECRP Management Role ID" },
                    ].map((f) => (
                      <div key={f.k}>
                        <div style={s.label}>{f.l}</div>
                        <input style={s.input} value={addForm[f.k]} onChange={(e) => setAddForm({ ...addForm, [f.k]: e.target.value })} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="p-6 flex justify-end gap-3" style={{ borderTop: "1px solid var(--border)" }}>
              <button style={s.btnGhost} onClick={() => setShowAddFaction(false)}>Cancel</button>
              <button style={s.btn} onClick={handleAddFaction}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
