"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/useAuth";
import { getFactions, addFaction } from "../../fm/factions/actions.js";
import Modal from "../Modal.js";
import { useRun } from "../hooks.js";

const tierBand = (t) => (t >= 7 ? "hi" : t >= 4 ? "mid" : "lo");

const BLANK_FACTION = {
  name: "", leadId: "", tier: "1", threadId: "", forum: "", discord: "", aliases: "", hqAddress: "",
  guildId: "", guildName: "", accessRoleId: "", accessRoleName: "",
  commsChannelId: "", commsChannelName: "", guideRoleId: "", managementRoleId: "",
};

/* Faction onboarding (L3) — full port of the /fm Add Faction form: dashboard
   info plus the optional portal (bot server) config that enables
   meridiandatabase.net login, comms, watch roles and ping backfill. */
function AddFactionModal({ onClose, onCreated }) {
  const [form, setForm] = useState(BLANK_FACTION);
  const { busy, err, setErr, run } = useRun();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const lbl = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--ink-3)", marginBottom: 3 };
  const grp = { fontFamily: "var(--v2-mono)", fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", margin: "4px 0 2px" };
  // Plain function, not a component — a nested component type would remount
  // its input on every render and drop focus each keystroke.
  const field = (k, l, required = false, placeholder = "") => (
    <div key={k}>
      <div style={lbl}>{l}{required && <span style={{ color: "var(--rose)", marginLeft: 3 }}>*</span>}</div>
      <input className="filter-inp" style={{ width: "100%" }} value={form[k]} placeholder={placeholder} onChange={set(k)} />
    </div>
  );
  const submit = () => {
    if (!form.name.trim() || !form.leadId.trim()) { setErr("Faction name and Team Lead Discord ID are required."); return; }
    run(() => addFaction(form), () => onCreated(form.name.trim()));
  };
  return (
    <Modal title="Add faction" maxWidth={640} onClose={onClose} onSave={submit} saveLabel="Create faction" saveDisabled={busy || !form.name.trim() || !form.leadId.trim()} error={err}>
      <div style={{ ...grp, color: "var(--accent)" }}>Dashboard info</div>
      {field("name", "Faction name", true)}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: 8 }}>
        {field("leadId", "Team Lead Discord ID", true, "Right-click user → Copy User ID")}
        {field("tier", "Starting tier", true)}
      </div>
      {field("threadId", "Feedback thread ID", false, "Thread in #fm-faction-scenes, named after the faction")}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {field("forum", "Forum URL")}
        {field("discord", "Discord URL")}
      </div>
      {field("aliases", "Forum aliases", false, "Comma-separated alt names for forum post matching")}
      {field("hqAddress", "Initial HQ address")}
      <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10, marginTop: 4 }}>
        <div style={{ ...grp, color: "var(--good)" }}>Meridian Database — faction portal</div>
        <div style={{ fontSize: 11, color: "var(--ink-3)", marginBottom: 8 }}>
          Enables faction members to log into meridiandatabase.net and receive FM announcements. Watch roles auto-register and recent pings backfill. Leave blank to configure later in Admin → Discord &amp; Access.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {field("guildId", "Discord server ID")}
          {field("guildName", "Discord server name")}
          {field("accessRoleId", "Access role ID")}
          {field("accessRoleName", "Access role name")}
          {field("commsChannelId", "Comms channel ID")}
          {field("commsChannelName", "Comms channel name")}
          {field("guideRoleId", "ECRP Guide role ID")}
          {field("managementRoleId", "ECRP Management role ID")}
        </div>
      </div>
    </Modal>
  );
}

export default function V2Factions() {
  const auth = useAuth();
  const router = useRouter();
  const [facs, setFacs] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const isL3 = (auth?.level || 0) >= 3;

  useEffect(() => {
    if (auth?.loading || !auth?.id) return;
    getFactions().then(f => { setFacs(f || []); setLoading(false); }).catch(() => setLoading(false));
  }, [auth?.id, auth?.loading]);

  if (auth?.loading || loading) return <div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>;
  if (!auth?.ok) return <div className="view" style={{ color: "var(--ink-3)" }}>Not authorized.</div>;

  const needle = q.trim().toLowerCase();
  const shown = [...facs]
    .filter(f => !needle || `${f.name} ${f.teamName} ${f.leadName}`.toLowerCase().includes(needle))
    .sort((a, b) => (b.tier || 0) - (a.tier || 0) || a.name.localeCompare(b.name));

  const linkStyle = { fontFamily: "var(--v2-mono)", fontSize: 10.5, color: "var(--accent)", padding: "1px 6px", borderRadius: 5 };
  const dim = { color: "var(--ink-3)", opacity: 0.5, fontFamily: "var(--v2-mono)", fontSize: 10.5, padding: "1px 6px" };

  return (
    <div className="view">
      <div className="page-head">
        <div>
          <p className="eyebrow">Faction Management</p>
          <h1>Factions</h1>
          <div className="sub">{facs.length} active · open one to manage everything about it</div>
        </div>
        {isL3 && <button className="btn" onClick={() => setAdding(true)}>+ Add faction</button>}
      </div>

      <input className="filter-inp" value={q} onChange={e => setQ(e.target.value)}
        placeholder="Filter by faction, team, or lead…" style={{ marginBottom: 14, maxWidth: 420 }} />

      {shown.length === 0 ? <div className="empty">No factions match.</div> : (
        <div style={{ overflowX: "auto" }}>
          <table className="dtable" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th>Faction</th><th>Tier</th><th>Team</th><th style={{ textAlign: "right" }}>Scenes 30d</th><th style={{ textAlign: "right" }}>Forum 30d</th><th>Links</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(f => (
                <tr key={f.id} style={{ cursor: "pointer" }}
                  onClick={() => router.push(`/v2/factions/${encodeURIComponent(f.name)}`)}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--panel-2)"}
                  onMouseLeave={e => e.currentTarget.style.background = ""}>
                  <td><b>{f.name}</b>{f.pendingPromo ? <span className="chip lock" style={{ marginLeft: 8 }}>promo</span> : null}</td>
                  <td><span className={`tier ${tierBand(f.tier)}`}>T{f.tier}</span></td>
                  <td style={{ color: "var(--ink-2)" }}>{f.teamName || "—"}</td>
                  <td style={{ textAlign: "right", fontFamily: "var(--v2-mono)" }}>{f.scenes30d ?? 0}</td>
                  <td style={{ textAlign: "right", fontFamily: "var(--v2-mono)" }}>{f.forumPosts ?? 0}</td>
                  <td onClick={e => e.stopPropagation()} style={{ whiteSpace: "nowrap" }}>
                    {f.discord ? <a href={f.discord} target="_blank" rel="noreferrer" style={linkStyle}>Discord ↗</a> : <span style={dim}>Discord</span>}
                    {f.forum ? <a href={f.forum} target="_blank" rel="noreferrer" style={linkStyle}>Forum ↗</a> : <span style={dim}>Forum</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && <AddFactionModal onClose={() => setAdding(false)}
        onCreated={(name) => { setAdding(false); router.push(`/v2/factions/${encodeURIComponent(name)}`); }} />}
    </div>
  );
}
