"use client";
import { GAME_AFFAIRS_ID } from "../../lib/constants";

// Single source for "who can this be aimed at" options, replacing the four
// hand-built copies (Home create, task reassign, inbox task-from-ping,
// reminder form). Gating flags preserve each surface's existing behavior.
export function targetOptions(roleTargets, { level = 0, gateLeadership = false, includeGameAffairs = false } = {}) {
  const rt = roleTargets || {};
  const out = [];
  if ((!gateLeadership || level >= 3) && rt.leadershipId) out.push({ type: "Role", id: rt.leadershipId, label: "FM Leadership" });
  if (includeGameAffairs && level >= 3) out.push({ type: "Role", id: GAME_AFFAIRS_ID, label: "Game Affairs" });
  if (rt.leadId) out.push({ type: "Role", id: rt.leadId, label: "FM Team Leads" });
  if (rt.allFmId) out.push({ type: "Role", id: rt.allFmId, label: "All Faction Management" });
  (rt.teams || []).forEach(t => out.push({ type: "Role", id: t.team_id, label: `Team ${t.team_name}` }));
  return out;
}

// Grouped single-select over roles/teams + staff. Emits "Role:<id>" / "User:<id>".
export function TargetSelect({ value, onChange, roleTargets, staffList, level = 0, gateLeadership = false, includeGameAffairs = false, placeholder = "Select target…", className = "filter-inp", style }) {
  const roles = targetOptions(roleTargets, { level, gateLeadership, includeGameAffairs });
  return (
    <select className={className} style={style} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      <optgroup label="Roles & Teams">
        {roles.map(o => <option key={`${o.type}:${o.id}`} value={`${o.type}:${o.id}`}>{o.label}</option>)}
      </optgroup>
      <optgroup label="Staff">
        {(staffList || []).map(s => <option key={s.discord_id} value={`User:${s.discord_id}`}>{s.display_name}{s.team_name ? ` (${s.team_name})` : ""}</option>)}
      </optgroup>
    </select>
  );
}

// Parse a TargetSelect value back into { targetType, targetId }.
export function parseTarget(v) {
  const [type, ...rest] = (v || "").split(":");
  return { targetType: type, targetId: rest.join(":") };
}
