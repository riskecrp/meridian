"use server";
import { revalidatePath } from "next/cache";
import { query, queryOne, run, transaction } from "../../../../lib/db.js";
import { logAudit } from "../../../../lib/audit.js";
import { requireActor } from "../../../../lib/requireActor.js";
import { GUILD_ID } from "../../../../../../shared/config.js";
import { clearanceForRank, RANKS } from "../../../../../../shared/clearance.js";
import { str, toInt, isSnowflake, fail } from "../../../../../../shared/validate.js";
import { nowIso } from "../../../../../../shared/dates.js";

// All staff management actions are L3-only (getTeamList is the one read every
// level needs for pickers). These actions change clearance levels — policy 15:
// clearance is EXPLICIT (chosen in the form; clearanceForRank is only the
// suggestion), re-adding a Discord id updates the existing row, and retiring
// is soft (staff.active = 0) so sessions, attributions and ids survive.

function bump() {
  for (const p of ['/fm/operations/staff', '/fm/factions', '/fm/teams', '/v2/admin', '/v2/factions']) {
    try { revalidatePath(p); } catch {}
  }
}

const ACTIVE = "discord_id != '' AND discord_id NOT LIKE 'placeholder%' AND discord_id NOT LIKE 'Unassigned%'";

function staffById(id) {
  return queryOne("SELECT * FROM staff WHERE id = ?", [toInt(id)]) || null;
}
function teamById(teamId) {
  const t = str(teamId);
  return t ? (queryOne("SELECT * FROM teams WHERE team_id = ?", [t]) || null) : null;
}
/** Explicit clearance from a form value, or the rank-derived suggestion when blank. */
function pickClearance(value, rank, fallback = null) {
  const n = toInt(value, { min: 1, max: 3 });
  if (n) return n;
  return fallback ?? clearanceForRank(rank);
}
const isSelf = (actor, row) => !!row && (row.discord_id === actor.id || (actor._realId && row.discord_id === actor._realId));

export async function getStaffList() {
  await requireActor(3);
  return query(`SELECT * FROM staff WHERE ${ACTIVE} AND active = 1 ORDER BY team_name, clearance DESC, display_name`);
}

/** Soft-retired staff, for the Restore control. */
export async function getRetiredStaff() {
  await requireActor(3);
  return query(`SELECT id, discord_id, display_name, rank, clearance, team_name, updated_at FROM staff WHERE ${ACTIVE} AND active = 0 ORDER BY updated_at DESC`);
}

export async function getStaffActivity() {
  await requireActor(3);
  return query("SELECT * FROM v_staff_activity_30d");
}

/** Every team, including ones with nobody in them yet. Readable at every level (pickers). */
export async function getTeamList() {
  await requireActor(1, { allowEventTeam: true, allowLeadStoryteller: true });
  return query("SELECT team_id AS id, team_name AS name, channel_id FROM teams ORDER BY team_name");
}

export async function getFactionAssignments() {
  await requireActor(3);
  const factions = query("SELECT f.id, f.name, f.tier, f.lead_discord_id FROM factions f WHERE f.archived = 0 ORDER BY f.name");
  const staff = query("SELECT discord_id, team_id, team_name, display_name FROM staff WHERE discord_id != '' AND active = 1");
  const staffMap = {};
  staff.forEach(s => { staffMap[s.discord_id] = s; });
  return factions.map(f => {
    const lead = staffMap[f.lead_discord_id];
    return {
      id: f.id, name: f.name, tier: f.tier,
      leadId: f.lead_discord_id,
      leadName: lead?.display_name || 'Unassigned',
      teamId: lead?.team_id || '',
      teamName: lead?.team_name || 'Unassigned',
    };
  });
}

/**
 * Add a staffer, or update the roster row an existing Discord id already has.
 * `data`: { discordId, name, teamId, teamName?, rank, clearance? }.
 */
export async function addStaff(data) {
  const actor = await requireActor(3);
  data = data && typeof data === 'object' ? data : {};
  const discordId = str(data.discordId);
  if (!isSnowflake(discordId)) return fail('A Discord user id is required (right-click the user in Discord → Copy User ID).');
  const name = str(data.name, { max: 100 });
  if (!name) return fail('A display name is required.');
  const rank = str(data.rank, { max: 50 }) || 'Guide';
  const team = teamById(data.teamId);
  if (str(data.teamId) && !team) return fail('Unknown team.');
  const teamId = team ? team.team_id : '';
  const teamName = team ? team.team_name : '';
  const existing = queryOne("SELECT * FROM staff WHERE discord_id = ?", [discordId]);
  const now = nowIso();
  if (existing) {
    const clearance = pickClearance(data.clearance, rank, existing.clearance);
    if (isSelf(actor, existing) && clearance < existing.clearance) return fail('You cannot lower your own clearance.');
    run("UPDATE staff SET display_name = ?, team_id = ?, team_name = ?, rank = ?, clearance = ?, active = 1, updated_at = ? WHERE id = ?",
      [name, teamId, teamName, rank, clearance, now, existing.id]);
    logAudit(actor.id, actor.name, 'EDIT', 'staff', existing.id, name,
      `${existing.active ? 'Re-added' : 'Restored'} — Team: ${teamName || 'Unassigned'}, Rank: ${rank}, L${clearance}${clearance !== existing.clearance ? ` (was L${existing.clearance})` : ''}`);
    bump();
    return { ok: true, id: existing.id, updated: true };
  }
  const clearance = pickClearance(data.clearance, rank);
  const ins = run("INSERT INTO staff (discord_id, team_id, rank, team_name, display_name, discord_name, clearance, active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
    [discordId, teamId, rank, teamName, name, name, clearance]);
  const id = Number(ins.lastInsertRowid);
  logAudit(actor.id, actor.name, 'CREATE', 'staff', id, name, `Team: ${teamName || 'Unassigned'}, Rank: ${rank}, L${clearance}`);
  bump();
  return { ok: true, id };
}

/**
 * One field at a time, as both UIs send it. `team_id` also sets team_name;
 * `clearance` is explicit (1–3) and never lowered on yourself. Changing `rank`
 * leaves clearance alone — send `clearance` to change it.
 */
export async function updateStaff(staffId, field, value) {
  const actor = await requireActor(3);
  const row = staffById(staffId);
  if (!row) return fail('Staff member not found.');
  const now = nowIso();
  let details;
  switch (field) {
    case 'display_name': {
      const v = str(value, { max: 100 });
      if (!v) return fail('A display name is required.');
      run("UPDATE staff SET display_name = ?, updated_at = ? WHERE id = ?", [v, now, row.id]);
      details = `Name: ${row.display_name} → ${v}`;
      break;
    }
    case 'rank': {
      const v = str(value, { max: 50 });
      if (!v) return fail('A rank is required.');
      run("UPDATE staff SET rank = ?, updated_at = ? WHERE id = ?", [v, now, row.id]);
      details = `Rank: ${row.rank} → ${v} (clearance stays L${row.clearance}${clearanceForRank(v) !== row.clearance ? `; suggested L${clearanceForRank(v)}` : ''})`;
      break;
    }
    case 'clearance': {
      const v = toInt(value, { min: 1, max: 3 });
      if (!v) return fail('Clearance must be 1, 2 or 3.');
      if (isSelf(actor, row) && v < row.clearance) return fail('You cannot lower your own clearance.');
      run("UPDATE staff SET clearance = ?, updated_at = ? WHERE id = ?", [v, now, row.id]);
      details = `Clearance: L${row.clearance} → L${v}`;
      break;
    }
    case 'team_id':
    case 'team_name': {
      // Either spelling moves the person; the pair is always written together.
      const team = field === 'team_id' ? teamById(value) : queryOne("SELECT * FROM teams WHERE LOWER(team_name) = LOWER(?)", [str(value)]);
      if (str(value) && !team) return fail('Unknown team.');
      const teamId = team ? team.team_id : '';
      const teamName = team ? team.team_name : 'Unassigned';
      run("UPDATE staff SET team_id = ?, team_name = ?, updated_at = ? WHERE id = ?", [teamId, teamName, now, row.id]);
      details = `Team: ${row.team_name || 'Unassigned'} → ${teamName}`;
      break;
    }
    case 'lead_storyteller': {
      const v = value ? 1 : 0;
      run("UPDATE staff SET lead_storyteller = ?, updated_at = ? WHERE id = ?", [v, now, row.id]);
      details = `Lead Storyteller: ${v ? 'on' : 'off'}`;
      break;
    }
    default:
      return fail('That field cannot be edited here.');
  }
  logAudit(actor.id, actor.name, 'EDIT', 'staff', row.id, row.display_name, details);
  bump();
  return { ok: true };
}

/** Kept for older callers; staff are never hard-deleted. Same as retireStaff without reassignment. */
export async function removeStaff(staffId, staffName) {
  const row = staffById(staffId);
  return retireStaff(staffId, staffName || row?.display_name || '', row?.discord_id || '', [], { confirm: true });
}

export async function createTeam(teamId, teamName, channelId = '') {
  const actor = await requireActor(3);
  const id = str(teamId);
  const name = str(teamName, { max: 80 });
  const ch = str(channelId);
  if (!isSnowflake(id)) return fail('The team id must be the Discord role id (17–20 digits).');
  if (!name) return fail('A team name is required.');
  if (ch && !isSnowflake(ch)) return fail('The team channel must be a Discord channel id.');
  if (teamById(id)) return fail('That team already exists.');
  if (queryOne("SELECT 1 FROM teams WHERE LOWER(team_name) = LOWER(?)", [name])) return fail('A team with that name already exists.');
  run("INSERT INTO teams (team_id, team_name, channel_id) VALUES (?, ?, ?)", [id, name, ch]);
  logAudit(actor.id, actor.name, 'CREATE', 'team', id, name, `ID: ${id}${ch ? `, channel ${ch}` : ''}`);
  bump();
  return { ok: true };
}

export async function renameTeam(teamId, newName) {
  const actor = await requireActor(3);
  const team = teamById(teamId);
  if (!team) return fail('Unknown team.');
  const name = str(newName, { max: 80 });
  if (!name) return fail('A team name is required.');
  transaction(() => {
    run("UPDATE staff SET team_name=?, updated_at=? WHERE team_id=?", [name, nowIso(), team.team_id]);
    run("UPDATE teams SET team_name=? WHERE team_id=?", [name, team.team_id]);
  });
  logAudit(actor.id, actor.name, 'EDIT', 'team', team.team_id, name, `Renamed from ${team.team_name}`);
  bump();
  return { ok: true };
}

export async function updateTeamChannel(teamId, channelId) {
  const actor = await requireActor(3);
  const team = teamById(teamId);
  if (!team) return fail('Unknown team.');
  const ch = str(channelId);
  if (ch && !isSnowflake(ch)) return fail('That is not a Discord channel id.');
  run("UPDATE teams SET channel_id=? WHERE team_id=?", [ch, team.team_id]);
  logAudit(actor.id, actor.name, 'EDIT', 'team', team.team_id, team.team_name, `Channel: ${team.channel_id || '—'} → ${ch || '—'}`);
  bump();
  return { ok: true };
}

export async function deleteTeam(teamId, teamName) {
  const actor = await requireActor(3);
  const team = teamById(teamId);
  if (!team) return fail('Unknown team.');
  const moved = transaction(() => {
    const n = run("UPDATE staff SET team_id='', team_name='Unassigned', updated_at=? WHERE team_id=?", [nowIso(), team.team_id]).changes;
    run("DELETE FROM teams WHERE team_id=?", [team.team_id]);
    return n;
  });
  logAudit(actor.id, actor.name, 'DELETE', 'team', team.team_id, teamName || team.team_name, `Dissolved; ${moved} member(s) → Unassigned`);
  bump();
  return { ok: true, moved };
}

// ── Retire & Promote ──────────────────────────────────────────────────────

export async function getStaffFactions(discordId) {
  await requireActor(3);
  return query(
    "SELECT id, name, tier FROM factions WHERE lead_discord_id = ? AND archived = 0 ORDER BY name",
    [str(discordId)]
  );
}

/**
 * Soft-retire: active = 0, team cleared, sessions ended, factions reassigned or
 * left unassigned. Retiring a leadership member (L3) needs `opts.confirm`.
 */
export async function retireStaff(staffId, staffName, discordId, factionReassignments = [], opts = {}) {
  const actor = await requireActor(3);
  const row = staffById(staffId);
  if (!row) return fail('Staff member not found.');
  if (!row.active) return fail(`${row.display_name} is already retired.`);
  if (isSelf(actor, row)) return fail('You cannot retire yourself — ask another member of Leadership.');
  if (row.clearance >= 3 && !opts?.confirm) return fail(`${row.display_name} is Leadership (L3); confirm the retirement explicitly.`, { needsConfirm: true });
  const reassignments = Array.isArray(factionReassignments) ? factionReassignments : [];
  const led = new Set(query("SELECT id FROM factions WHERE lead_discord_id = ?", [row.discord_id]).map(f => f.id));
  for (const r of reassignments) {
    const fid = toInt(r?.factionId);
    if (!led.has(fid)) return fail(`Faction ${r?.factionId} is not led by ${row.display_name}.`);
    const newLead = str(r?.newLeadId);
    if (newLead && !queryOne(`SELECT 1 FROM staff WHERE discord_id = ? AND active = 1 AND ${ACTIVE}`, [newLead])) return fail('The new lead is not an active staff member.');
  }
  const name = row.display_name || str(staffName);
  transaction(() => {
    const now = nowIso();
    for (const r of reassignments) {
      const newLead = str(r.newLeadId);
      const f = queryOne("SELECT id, name FROM factions WHERE id = ?", [toInt(r.factionId)]);
      run("UPDATE factions SET lead_discord_id=?, updated_at=? WHERE id=?", [newLead, now, f.id]);
      const leadName = newLead ? (queryOne("SELECT display_name FROM staff WHERE discord_id = ?", [newLead])?.display_name || newLead) : 'Unassigned';
      run("INSERT INTO faction_history (faction_id, faction_name, action_type, details, authorized_by) VALUES (?, ?, 'LEAD_CHANGED', ?, ?)", [f.id, f.name, `${name} retired; new lead: ${leadName}`, actor.name]);
      logAudit(actor.id, actor.name, 'EDIT', 'faction', f.id, f.name, `Lead reassigned — ${name} retired. New lead: ${leadName}`);
    }
    // Anything not in the list loses its lead rather than keeping a retired one.
    run("UPDATE factions SET lead_discord_id='', updated_at=? WHERE lead_discord_id=?", [now, row.discord_id]);
    run("UPDATE staff SET active = 0, team_id = '', team_name = 'Unassigned', updated_at = ? WHERE id = ?", [now, row.id]);
    run("DELETE FROM sessions WHERE staff_id = ? OR discord_id = ?", [row.id, row.discord_id]);
    logAudit(actor.id, actor.name, 'RETIRE', 'staff', row.id, name, `Retired (soft). ${reassignments.length} faction(s) reassigned; sessions ended.`);
  });
  bump();
  return { ok: true };
}

/** Undo a soft retirement. The person comes back Unassigned with the clearance they had. */
export async function restoreStaff(staffId) {
  const actor = await requireActor(3);
  const row = staffById(staffId);
  if (!row) return fail('Staff member not found.');
  if (row.active) return fail(`${row.display_name} is already active.`);
  run("UPDATE staff SET active = 1, updated_at = ? WHERE id = ?", [nowIso(), row.id]);
  logAudit(actor.id, actor.name, 'RESTORE', 'staff', row.id, row.display_name, `Restored to the roster as ${row.rank} (L${row.clearance})`);
  bump();
  return { ok: true };
}

/** Guide → Team Lead (L2). Never lowers anyone who is already L2+. */
export async function promoteToLead(staffId, staffName, teamId, newTeamName) {
  const actor = await requireActor(3);
  const row = staffById(staffId);
  if (!row) return fail('Staff member not found.');
  if (!row.active) return fail(`${row.display_name} is retired; restore them first.`);
  if (row.clearance >= 3) return fail(`${row.display_name} is Leadership (L3) — promoting to Team Lead would lower them. Edit the rank instead.`);
  const team = teamById(teamId) || teamById(row.team_id);
  const name = str(newTeamName, { max: 80 });
  transaction(() => {
    const now = nowIso();
    const clearance = Math.max(row.clearance, 2);
    run("UPDATE staff SET rank='Team Lead', clearance=?, team_id=?, team_name=?, updated_at=? WHERE id=?",
      [clearance, team ? team.team_id : row.team_id, name || (team ? team.team_name : row.team_name), now, row.id]);
    logAudit(actor.id, actor.name, 'PROMOTE', 'staff', row.id, row.display_name, `${row.rank} (L${row.clearance}) → Team Lead (L${clearance})`);
    if (team && name && name !== team.team_name) {
      run("UPDATE staff SET team_name=?, updated_at=? WHERE team_id=?", [name, now, team.team_id]);
      run("UPDATE teams SET team_name=? WHERE team_id=?", [name, team.team_id]);
      logAudit(actor.id, actor.name, 'EDIT', 'team', team.team_id, name, `Renamed from ${team.team_name} for new lead ${row.display_name}`);
    }
  });
  bump();
  return { ok: true };
}

async function syncTeamRole(discordId, roleId, method) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || !isSnowflake(discordId) || !isSnowflake(roleId)) return null;
  try {
    const r = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${discordId}/roles/${roleId}`, { method, headers: { Authorization: `Bot ${token}` } });
    return r.ok;
  } catch { return false; }
}

export async function takeoverTeam(
  newStaffId, newStaffName,
  existingTeamId,
  oldLeadStaffId, oldLeadDiscordId, oldLeadStaffName,
  disposition,
  newTeamName
) {
  const actor = await requireActor(3);
  const newLead = staffById(newStaffId);
  if (!newLead) return fail('Staff member not found.');
  if (!newLead.active) return fail(`${newLead.display_name} is retired; restore them first.`);
  const team = teamById(existingTeamId);
  if (!team) return fail('Unknown team.');
  const oldLead = oldLeadStaffId ? staffById(oldLeadStaffId) : null;
  if (oldLeadStaffId && !oldLead) return fail('The current lead could not be found.');
  if (oldLead && oldLead.id === newLead.id) return fail(`${newLead.display_name} already leads ${team.team_name}.`);
  if (oldLead && disposition && !['guide', 'retire'].includes(disposition)) return fail('Disposition must be "guide" or "retire".');
  if (oldLead && disposition === 'retire' && isSelf(actor, oldLead)) return fail('You cannot retire yourself — ask another member of Leadership.');

  const finalTeamName = str(newTeamName, { max: 80 }) || team.team_name;
  const newLeadOldTeamId = newLead.team_id || '';
  const oldFactions = oldLead ? query("SELECT id, name FROM factions WHERE lead_discord_id=? AND archived=0", [oldLead.discord_id]) : [];

  transaction(() => {
    const now = nowIso();
    if (oldLead && disposition === 'retire') {
      run("UPDATE staff SET active = 0, team_id = '', team_name = 'Unassigned', updated_at = ? WHERE id = ?", [now, oldLead.id]);
      run("DELETE FROM sessions WHERE staff_id = ? OR discord_id = ?", [oldLead.id, oldLead.discord_id]);
      logAudit(actor.id, actor.name, 'RETIRE', 'staff', oldLead.id, oldLead.display_name, `Retired (soft) — team taken over by ${newLead.display_name}`);
    } else if (oldLead && disposition === 'guide') {
      if (oldLead.clearance >= 3) {
        // Leadership keeps its rank and clearance; it only stops leading this team.
        run("UPDATE staff SET team_id='', team_name='Unassigned', updated_at=? WHERE id=?", [now, oldLead.id]);
        logAudit(actor.id, actor.name, 'EDIT', 'staff', oldLead.id, oldLead.display_name, `Left ${team.team_name} (keeps ${oldLead.rank}, L${oldLead.clearance}) — team taken over by ${newLead.display_name}`);
      } else {
        run("UPDATE staff SET rank='Guide', clearance=1, team_id='', team_name='Unassigned', updated_at=? WHERE id=?", [now, oldLead.id]);
        logAudit(actor.id, actor.name, 'DEMOTE', 'staff', oldLead.id, oldLead.display_name, `Returned to Guide — team taken over by ${newLead.display_name}`);
      }
    }
    if (finalTeamName !== team.team_name) {
      run("UPDATE staff SET team_name=?, updated_at=? WHERE team_id=?", [finalTeamName, now, team.team_id]);
      run("UPDATE teams SET team_name=? WHERE team_id=?", [finalTeamName, team.team_id]);
      logAudit(actor.id, actor.name, 'EDIT', 'team', team.team_id, finalTeamName, `Renamed from ${team.team_name} — new lead ${newLead.display_name}`);
    }
    const clearance = Math.max(newLead.clearance, 2);
    const rank = newLead.clearance >= 3 ? newLead.rank : 'Team Lead';
    run("UPDATE staff SET rank=?, clearance=?, team_id=?, team_name=?, updated_at=? WHERE id=?",
      [rank, clearance, team.team_id, finalTeamName, now, newLead.id]);
    logAudit(actor.id, actor.name, 'PROMOTE', 'staff', newLead.id, newLead.display_name, `${newLead.rank} (L${newLead.clearance}) → ${rank} (L${clearance}). Took over: ${finalTeamName}`);
    for (const f of oldFactions) {
      run("UPDATE factions SET lead_discord_id=?, updated_at=? WHERE id=?", [newLead.discord_id, now, f.id]);
      run("INSERT INTO faction_history (faction_id, faction_name, action_type, details, authorized_by) VALUES (?, ?, 'LEAD_CHANGED', ?, ?)", [f.id, f.name, `${oldLead?.display_name || 'previous lead'} → ${newLead.display_name}`, actor.name]);
      logAudit(actor.id, actor.name, 'EDIT', 'faction', f.id, f.name, `Lead transferred: ${oldLead?.display_name || 'previous lead'} → ${newLead.display_name}`);
    }
  });

  // Sync Discord team roles (best effort; the roster is already correct).
  let rolesSynced = 0, rolesFailed = 0;
  if (oldLead) await syncTeamRole(oldLead.discord_id, team.team_id, 'DELETE');
  if (newLeadOldTeamId && newLeadOldTeamId !== team.team_id) await syncTeamRole(newLead.discord_id, newLeadOldTeamId, 'DELETE');
  const r = await syncTeamRole(newLead.discord_id, team.team_id, 'PUT');
  if (r === true) rolesSynced++; else if (r === false) rolesFailed++;
  bump();
  return { ok: true, factionsTransferred: oldFactions.length, rolesSynced, rolesFailed };
}

// ── COI (Conflict of Interest) ────────────────────────────────────────────

export async function getAllStaffCOI() {
  await requireActor(3);
  return query("SELECT id, discord_id, faction_name, faction_id, source FROM staff_coi ORDER BY discord_id, faction_name");
}

export async function getMeridianFactions() {
  await requireActor(3);
  return query("SELECT id, name, tier FROM factions WHERE archived = 0 ORDER BY name");
}

export async function addStaffCOI(discordId, factionName, source) {
  const actor = await requireActor(3);
  const id = str(discordId);
  const name = str(factionName, { max: 100 });
  if (!id || !name) return fail('Missing fields.');
  if (!queryOne("SELECT 1 FROM staff WHERE discord_id = ?", [id])) return fail('That person is not on the staff roster.');
  const faction = queryOne("SELECT id FROM factions WHERE LOWER(name) = LOWER(?)", [name]);
  const r = run("INSERT OR IGNORE INTO staff_coi (discord_id, faction_name, faction_id, source) VALUES (?, ?, ?, ?)",
    [id, name, faction?.id || null, source === 'meridian' ? 'meridian' : 'manual']);
  if (!r.changes) return { ok: true, duplicate: true };
  logAudit(actor.id, actor.name, 'CREATE', 'staff_coi', Number(r.lastInsertRowid), name, `Discord: ${id}`);
  return { ok: true };
}

export async function removeStaffCOI(coiId) {
  const actor = await requireActor(3);
  const row = queryOne("SELECT * FROM staff_coi WHERE id = ?", [toInt(coiId)]);
  if (!row) return fail('Not found.');
  run("DELETE FROM staff_coi WHERE id = ?", [row.id]);
  logAudit(actor.id, actor.name, 'DELETE', 'staff_coi', row.id, row.faction_name, `Discord: ${row.discord_id}`);
  return { ok: true };
}

// ── Individual Dashboard Access ───────────────────────────────────────────

export async function getDashboardAccessList() {
  await requireActor(3);
  return query(`SELECT d.discord_id, d.display_name, d.level, d.granted_by_name, d.granted_at,
                       CASE WHEN s.id IS NULL THEN 0 ELSE 1 END AS on_roster
                FROM dashboard_access d LEFT JOIN staff s ON s.discord_id = d.discord_id
                ORDER BY d.granted_at DESC`);
}

/** Grant level 2 or 3 (default 3). Keeps the stored display name when none is supplied. */
export async function grantDashboardAccess(discordId, displayName, level = 3) {
  const actor = await requireActor(3);
  const id = str(discordId);
  if (!isSnowflake(id)) return fail('That is not a Discord user id.');
  const lvl = toInt(level, { min: 2, max: 3 });
  if (!lvl) return fail('Level must be 2 or 3.');
  const existing = queryOne("SELECT * FROM dashboard_access WHERE discord_id = ?", [id]);
  const staff = queryOne("SELECT display_name FROM staff WHERE discord_id = ?", [id]);
  const name = str(displayName, { max: 100 }) || existing?.display_name || staff?.display_name || id;
  run(`INSERT INTO dashboard_access (discord_id, display_name, level, granted_by_id, granted_by_name, granted_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(discord_id) DO UPDATE SET display_name = excluded.display_name, level = excluded.level, granted_by_id = excluded.granted_by_id, granted_by_name = excluded.granted_by_name, granted_at = excluded.granted_at`,
    [id, name, lvl, actor.id, actor.name, nowIso()]);
  logAudit(actor.id, actor.name, existing ? 'EDIT' : 'CREATE', 'dashboard_access', id, name, `L${lvl}${existing ? ` (was L${existing.level})` : ''}${staff ? '' : ' — not on the staff roster, cannot log in until added'}`);
  bump();
  return { ok: true, onRoster: !!staff };
}

export async function revokeDashboardAccess(discordId) {
  const actor = await requireActor(3);
  const id = str(discordId);
  const row = queryOne("SELECT * FROM dashboard_access WHERE discord_id = ?", [id]);
  if (!row) return fail('No grant for that id.');
  transaction(() => {
    run("DELETE FROM dashboard_access WHERE discord_id = ?", [id]);
    // Their session carried the boosted level; end it so the change is immediate.
    run("DELETE FROM sessions WHERE discord_id = ?", [id]);
  });
  logAudit(actor.id, actor.name, 'DELETE', 'dashboard_access', id, row.display_name || id, 'Access revoked; sessions ended');
  bump();
  return { ok: true };
}

/** The lead a faction gets when moved to a team: that team's Team Lead, else its leadership member. */
function teamLead(teamId) {
  return queryOne(`SELECT discord_id, display_name, clearance FROM staff WHERE team_id = ? AND active = 1 AND clearance >= 2 AND ${ACTIVE} ORDER BY CASE WHEN clearance = 2 THEN 0 ELSE 1 END, id LIMIT 1`, [teamId]) || null;
}

// Batch commit staff moves + faction reassignments. A faction move to a team
// with no lead is refused (reported in `errors`) rather than unassigning it.
export async function commitAllChanges(staffMoves, factionMoves) {
  const actor = await requireActor(3);
  const sMoves = Array.isArray(staffMoves) ? staffMoves : [];
  const fMoves = Array.isArray(factionMoves) ? factionMoves : [];
  if (!sMoves.length && !fMoves.length) return fail('Nothing to commit.');
  const errors = [];
  let rolesSynced = 0, rolesFailed = 0, staffDone = 0, factionsDone = 0;

  for (const m of sMoves) {
    const row = staffById(m?.staffId);
    if (!row || !row.active) { errors.push(`Staff ${m?.staffName || m?.staffId}: not found`); continue; }
    const team = teamById(m?.newTeamId);
    if (str(m?.newTeamId) && !team) { errors.push(`${row.display_name}: unknown team`); continue; }
    const teamId = team ? team.team_id : '';
    const teamName = team ? team.team_name : 'Unassigned';
    const oldTeamId = row.team_id;
    run("UPDATE staff SET team_id=?, team_name=?, updated_at=? WHERE id=?", [teamId, teamName, nowIso(), row.id]);
    staffDone++;
    if (oldTeamId && oldTeamId !== teamId) await syncTeamRole(row.discord_id, oldTeamId, 'DELETE');
    if (teamId) {
      const r = await syncTeamRole(row.discord_id, teamId, 'PUT');
      if (r === true) rolesSynced++; else if (r === false) rolesFailed++;
    }
    logAudit(actor.id, actor.name, 'MOVE', 'staff', row.id, row.display_name, `${row.team_name || 'Unassigned'} → ${teamName}`);
  }

  for (const fm of fMoves) {
    const f = queryOne("SELECT id, name, lead_discord_id, archived FROM factions WHERE id = ?", [toInt(fm?.factionId)]);
    if (!f) { errors.push(`Faction ${fm?.factionName || fm?.factionId}: not found`); continue; }
    if (f.archived) { errors.push(`${f.name}: archived`); continue; }
    const team = teamById(fm?.newTeamId);
    if (!team) { errors.push(`${f.name}: unknown team`); continue; }
    const lead = teamLead(team.team_id);
    if (!lead) { errors.push(`${f.name}: ${team.team_name} has no Team Lead or leadership member to lead it — the faction keeps its current lead`); continue; }
    if (lead.discord_id === f.lead_discord_id) { factionsDone++; continue; }
    run("UPDATE factions SET lead_discord_id=?, updated_at=? WHERE id=?", [lead.discord_id, nowIso(), f.id]);
    run("INSERT INTO faction_history (faction_id, faction_name, action_type, details, authorized_by) VALUES (?, ?, 'LEAD_CHANGED', ?, ?)", [f.id, f.name, `Moved to ${team.team_name}; lead → ${lead.display_name}`, actor.name]);
    logAudit(actor.id, actor.name, 'MOVE', 'faction', f.id, f.name, `${fm?.oldTeamName || 'Unassigned'} → ${team.team_name} (lead ${lead.display_name})`);
    factionsDone++;
  }
  bump();
  return { ok: true, staffMoves: staffDone, factionMoves: factionsDone, rolesSynced, rolesFailed, errors };
}

/** Rank vocabulary + the clearance each suggests, for the forms. */
export async function getRankOptions() {
  await requireActor(3);
  return RANKS.map(r => ({ rank: r, clearance: clearanceForRank(r) }));
}
