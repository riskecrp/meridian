"use client";
import { useEffect, useState } from "react";
import { addFaction } from "../../fm/factions/actions.js";
import { getTeamList } from "../../fm/operations/staff/actions.js";
import { Modal, Field, useAction } from "../ui.js";

const BLANK = {
  name: "", teamId: "", tier: "1", forum: "", discord: "", aliases: "", hqAddress: "",
  guildId: "", guildName: "", accessRoleId: "", accessRoleName: "",
  commsChannelId: "", commsChannelName: "", factionChannelId: "", factionChannelName: "",
  guideRoleId: "", managementRoleId: "",
};

/* Faction onboarding (L3): dashboard info plus the optional portal (bot server)
   config that enables meridiandatabase.net login, comms, watch roles and ping
   backfill. Same payload as the v2 Add-faction form (addFaction contract). */
export default function NewFactionModal({ onClose, onCreated }) {
  const [form, setForm] = useState(BLANK);
  const [teams, setTeams] = useState([]);
  const { run, busy } = useAction();
  useEffect(() => { getTeamList().then(t => setTeams(t || [])).catch(() => {}); }, []);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  // Plain function, not a component: a nested component type would remount the
  // input on every render and drop focus each keystroke.
  const field = (k, label, { required, placeholder, help } = {}) => (
    <Field key={k} label={required ? `${label} *` : label} help={help}>
      <input className="inp" value={form[k]} placeholder={placeholder || ""} onChange={set(k)} />
    </Field>
  );
  const submit = () => {
    if (!form.name.trim()) return;
    run(() => addFaction(form), { success: `${form.name.trim()} created.`, onDone: (r) => onCreated(r?.name || form.name.trim()) });
  };
  return (
    <Modal title="New faction" maxWidth={680} onClose={onClose} onSave={submit} saveLabel="Create faction" saveDisabled={busy || !form.name.trim()}>
      <div className="lbl">Dashboard info</div>
      {field("name", "Faction name", { required: true })}
      <div className="form-grid">
        <Field label="Assigned team" help="Optional — the team's lead becomes the faction lead. Assign later on Settings › Staff & Teams.">
          <select value={form.teamId} onChange={set("teamId")}>
            <option value="">Unassigned</option>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        {field("tier", "Starting tier (0–9)", { required: true })}
      </div>
      <div className="form-grid">
        {field("forum", "Forum URL", { placeholder: "https://…" })}
        {field("discord", "Discord URL", { placeholder: "https://…" })}
      </div>
      {field("aliases", "Forum aliases", { placeholder: "Comma-separated alt names for forum post matching" })}
      {field("hqAddress", "Initial HQ address")}
      <div className="section">
        <div className="lbl">Meridian Database — faction portal</div>
        <div className="hint mb-s">Lets faction members log into the public portal and receive FM announcements. Watch roles auto-register and recent pings backfill. Leave blank to configure later in Settings › Discord &amp; Access.</div>
        <div className="form-grid">
          {field("guildId", "Discord server ID")}
          {field("guildName", "Discord server name")}
          {field("accessRoleId", "Access role ID")}
          {field("accessRoleName", "Access role name")}
          {field("commsChannelId", "Command channel ID", { placeholder: "Leadership announcements · right-click channel → Copy ID" })}
          {field("commsChannelName", "Command channel name", { placeholder: "e.g. #command" })}
          {field("factionChannelId", "Faction-wide channel ID", { placeholder: "Whole-faction announcements" })}
          {field("factionChannelName", "Faction-wide channel name", { placeholder: "e.g. #announcements" })}
          {field("guideRoleId", "Guide role ID")}
          {field("managementRoleId", "Management role ID")}
        </div>
      </div>
    </Modal>
  );
}
