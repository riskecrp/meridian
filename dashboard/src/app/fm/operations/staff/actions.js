"use server";
import { query, queryOne, run } from "../../../../lib/db.js";
import { logAudit } from "../../../../lib/audit.js";
import { requireActor } from "../../../../lib/requireActor.js";

const GUILD_ID = process.env.GUILD_ID || '1457188814916423855';

// All staff management actions are L3-only.
// These actions can change clearance levels — must be tightly controlled.

export async function getStaffList() {
  await requireActor(3);
  return query("SELECT * FROM staff WHERE discord_id != '' AND discord_id NOT LIKE 'placeholder%' AND discord_id NOT LIKE 'Unassigned%' ORDER BY team_name, rank");
}

export async function getStaffActivity() {
  await requireActor(3);
  return query("SELECT * FROM v_staff_activity_30d");
}

export async function getTeamList() {
  await requireActor(3);
  const rows = query("SELECT DISTINCT team_id, team_name FROM staff WHERE team_id != '' AND team_id IS NOT NULL");
  return rows.map(r => ({ id: r.team_id, name: r.team_name }));
}

export async function getFactionAssignments() {
  await requireActor(3);
  const factions = query("SELECT f.id, f.name, f.tier, f.lead_discord_id FROM factions f WHERE f.archived = 0 ORDER BY f.name");
  const staff = query("SELECT discord_id, team_id, team_name, display_name FROM staff WHERE discord_id != ''");
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

export async function addStaff(data) {
  const actor = await requireActor(3);
  const clearance = data.rank?.toLowerCase().includes('lead') ? 2 : 1;
  run("INSERT OR REPLACE INTO staff (discord_id, team_id, rank, team_name, display_name, discord_name, clearance) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [data.discordId, data.teamId || '', data.rank || 'Guide', data.teamName || '', data.name, data.name, clearance]);
  logAudit(actor.id, actor.name, 'CREATE', 'staff', null, data.name, `Team: ${data.teamName}, Rank: ${data.rank}`);
  return { ok: true };
}

export async function updateStaff(staffId, field, value) {
  const actor = await requireActor(3);
  const cols = { display_name:'display_name', team_id:'team_id', team_name:'team_name', rank:'rank', lead_storyteller:'lead_storyteller' };
  const col = cols[field];
  if (!col) return { ok: false };
  run(`UPDATE staff SET ${col}=?, updated_at=datetime('now') WHERE id=?`, [value, staffId]);
  if (field === 'rank') {
    const cl = value.toLowerCase().includes('lead') ? 2 : value.toLowerCase().includes('management') ? 3 : 1;
    run("UPDATE staff SET clearance=? WHERE id=?", [cl, staffId]);
  }
  logAudit(actor.id, actor.name, 'EDIT', 'staff', staffId, field, `Set to: ${value}`);
  return { ok: true };
}

export async function removeStaff(staffId, staffName) {
  const actor = await requireActor(3);
  run("DELETE FROM staff WHERE id=?", [staffId]);
  logAudit(actor.id, actor.name, 'DELETE', 'staff', staffId, staffName, '');
  return { ok: true };
}

export async function createTeam(teamId, teamName, channelId = '') {
  const actor = await requireActor(3);
  run("INSERT OR REPLACE INTO teams (team_id, team_name, channel_id) VALUES (?, ?, ?)", [teamId, teamName, channelId]);
  logAudit(actor.id, actor.name, 'CREATE', 'team', null, teamName, `ID: ${teamId}`);
  return { ok: true };
}

export async function renameTeam(teamId, newName) {
  const actor = await requireActor(3);
  run("UPDATE staff SET team_name=?, updated_at=datetime('now') WHERE team_id=?", [newName, teamId]);
  run("UPDATE teams SET team_name=? WHERE team_id=?", [newName, teamId]);
  logAudit(actor.id, actor.name, 'EDIT', 'team', null, newName, `Renamed team ${teamId}`);
  return { ok: true };
}

export async function updateTeamChannel(teamId, channelId) {
  const actor = await requireActor(3);
  run("INSERT OR IGNORE INTO teams (team_id, team_name, channel_id) SELECT ?, team_name, ? FROM staff WHERE team_id=? LIMIT 1", [teamId, channelId, teamId]);
  run("UPDATE teams SET channel_id=? WHERE team_id=?", [channelId, teamId]);
  logAudit(actor.id, actor.name, 'EDIT', 'team', null, teamId, `Channel updated: ${channelId}`);
  return { ok: true };
}

export async function deleteTeam(teamId, teamName) {
  const actor = await requireActor(3);
  run("UPDATE staff SET team_id='', team_name='Unassigned', updated_at=datetime('now') WHERE team_id=?", [teamId]);
  run("DELETE FROM teams WHERE team_id=?", [teamId]);
  logAudit(actor.id, actor.name, 'DELETE', 'team', null, teamName, 'Dissolved');
  return { ok: true };
}

// ── Retire & Promote ──────────────────────────────────────────────────────

export async function getStaffFactions(discordId) {
  await requireActor(3);
  return query(
    "SELECT id, name, tier FROM factions WHERE lead_discord_id = ? AND archived = 0 ORDER BY name",
    [discordId]
  );
}

export async function retireStaff(staffId, staffName, discordId, factionReassignments = []) {
  const actor = await requireActor(3);

  // Reassign or clear each faction this lead owned
  for (const { factionId, newLeadId } of factionReassignments) {
    run(
      "UPDATE factions SET lead_discord_id=?, updated_at=datetime('now') WHERE id=?",
      [newLeadId || '', factionId]
    );
    logAudit(actor.id, actor.name, 'EDIT', 'faction', factionId, '',
      `Lead reassigned — ${staffName} retired. New lead: ${newLeadId || 'Unassigned'}`);
  }

  // Clear any remaining factions that weren't in the reassignment list
  run(
    "UPDATE factions SET lead_discord_id='', updated_at=datetime('now') WHERE lead_discord_id=?",
    [discordId]
  );

  run("DELETE FROM staff WHERE id=?", [staffId]);
  logAudit(actor.id, actor.name, 'RETIRE', 'staff', staffId, staffName,
    `Retired. ${factionReassignments.length} faction(s) reassigned.`);

  return { ok: true };
}

export async function promoteToLead(staffId, staffName, teamId, newTeamName) {
  const actor = await requireActor(3);

  // Promote rank and clearance
  run("UPDATE staff SET rank='Team Lead', clearance=2, updated_at=datetime('now') WHERE id=?", [staffId]);
  logAudit(actor.id, actor.name, 'PROMOTE', 'staff', staffId, staffName, 'Guide → Team Lead');

  // Rename team everywhere if a new name was provided
  if (newTeamName?.trim()) {
    run("UPDATE staff SET team_name=?, updated_at=datetime('now') WHERE team_id=?", [newTeamName.trim(), teamId]);
    run("UPDATE teams SET team_name=? WHERE team_id=?", [newTeamName.trim(), teamId]);
    logAudit(actor.id, actor.name, 'EDIT', 'team', null, newTeamName.trim(),
      `Renamed for new lead ${staffName}`);
  }

  return { ok: true };
}

export async function takeoverTeam(
  newStaffId, newStaffName,
  existingTeamId,
  oldLeadStaffId, oldLeadDiscordId, oldLeadStaffName,
  disposition,
  newTeamName
) {
  const actor = await requireActor(3);

  // Resolve final team name
  const teamRow = queryOne("SELECT team_name FROM teams WHERE team_id=?", [existingTeamId]);
  const finalTeamName = newTeamName?.trim() || teamRow?.team_name || '';

  // Look up new lead's Discord ID and their current team role (for Discord sync)
  const newLeadRow = queryOne("SELECT discord_id, team_id FROM staff WHERE id=?", [newStaffId]);
  const newLeadDiscordId = newLeadRow?.discord_id || '';
  const newLeadOldTeamId = newLeadRow?.team_id || '';

  // Snapshot old lead's factions before removing them so we can transfer them
  const oldFactions = oldLeadDiscordId
    ? query("SELECT id, name FROM factions WHERE lead_discord_id=? AND archived=0", [oldLeadDiscordId])
    : [];

  // Handle old lead
  if (oldLeadStaffId && disposition === 'retire') {
    run("DELETE FROM staff WHERE id=?", [oldLeadStaffId]);
    logAudit(actor.id, actor.name, 'RETIRE', 'staff', oldLeadStaffId, oldLeadStaffName,
      `Retired — team taken over by ${newStaffName}`);
  } else if (oldLeadStaffId && disposition === 'guide') {
    run("UPDATE staff SET rank='Guide', clearance=1, team_id='', team_name='Unassigned', updated_at=datetime('now') WHERE id=?", [oldLeadStaffId]);
    logAudit(actor.id, actor.name, 'DEMOTE', 'staff', oldLeadStaffId, oldLeadStaffName,
      `Returned to Guide — team taken over by ${newStaffName}`);
  }

  // Rename team if a new name was given
  if (newTeamName?.trim() && newTeamName.trim() !== teamRow?.team_name) {
    run("UPDATE staff SET team_name=?, updated_at=datetime('now') WHERE team_id=?", [finalTeamName, existingTeamId]);
    run("UPDATE teams SET team_name=? WHERE team_id=?", [finalTeamName, existingTeamId]);
    logAudit(actor.id, actor.name, 'EDIT', 'team', null, finalTeamName,
      `Renamed — new lead ${newStaffName}`);
  }

  // Promote new guide to Team Lead and move them to the existing team
  run("UPDATE staff SET rank='Team Lead', clearance=2, team_id=?, team_name=?, updated_at=datetime('now') WHERE id=?",
    [existingTeamId, finalTeamName, newStaffId]);
  logAudit(actor.id, actor.name, 'PROMOTE', 'staff', newStaffId, newStaffName,
    `Guide → Team Lead. Took over: ${finalTeamName}`);

  // Auto-transfer all old lead's factions to the new lead
  let factionsTransferred = 0;
  if (newLeadDiscordId && oldFactions.length > 0) {
    for (const f of oldFactions) {
      run("UPDATE factions SET lead_discord_id=?, updated_at=datetime('now') WHERE id=?", [newLeadDiscordId, f.id]);
      logAudit(actor.id, actor.name, 'EDIT', 'faction', f.id, f.name,
        `Lead transferred: ${oldLeadStaffName || 'previous lead'} → ${newStaffName}`);
    }
    factionsTransferred = oldFactions.length;
  }

  // Sync Discord roles
  const token = process.env.DISCORD_BOT_TOKEN;
  let rolesSynced = 0, rolesFailed = 0;
  if (token) {
    // Strip team role from old lead
    if (oldLeadDiscordId && oldLeadDiscordId.length > 15 && existingTeamId) {
      await fetch(
        `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${oldLeadDiscordId}/roles/${existingTeamId}`,
        { method: 'DELETE', headers: { Authorization: `Bot ${token}` } }
      ).catch(() => {});
    }
    // Swap team role on new lead: remove old, add new
    if (newLeadDiscordId && newLeadDiscordId.length > 15) {
      if (newLeadOldTeamId && newLeadOldTeamId !== existingTeamId) {
        await fetch(
          `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${newLeadDiscordId}/roles/${newLeadOldTeamId}`,
          { method: 'DELETE', headers: { Authorization: `Bot ${token}` } }
        ).catch(() => {});
      }
      if (existingTeamId) {
        try {
          const r = await fetch(
            `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${newLeadDiscordId}/roles/${existingTeamId}`,
            { method: 'PUT', headers: { Authorization: `Bot ${token}` } }
          );
          if (r.ok) rolesSynced++; else rolesFailed++;
        } catch (e) { rolesFailed++; }
      }
    }
  }

  return { ok: true, factionsTransferred, rolesSynced, rolesFailed };
}

// ── COI (Conflict of Interest) ────────────────────────────────────────────

export async function getAllStaffCOI() {
  await requireActor(3);
  return query("SELECT id, discord_id, faction_name, source FROM staff_coi ORDER BY discord_id, faction_name");
}

export async function getMeridianFactions() {
  await requireActor(3);
  return query("SELECT id, name, tier FROM factions WHERE archived = 0 ORDER BY name");
}

export async function addStaffCOI(discordId, factionName, source) {
  const actor = await requireActor(3);
  if (!discordId || !factionName?.trim()) return { ok: false, error: 'Missing fields.' };
  run("INSERT OR IGNORE INTO staff_coi (discord_id, faction_name, source) VALUES (?, ?, ?)",
    [discordId, factionName.trim(), source || 'manual']);
  logAudit(actor.id, actor.name, 'CREATE', 'staff_coi', null, factionName.trim(), `Discord: ${discordId}`);
  return { ok: true };
}

export async function removeStaffCOI(coiId) {
  const actor = await requireActor(3);
  run("DELETE FROM staff_coi WHERE id = ?", [coiId]);
  logAudit(actor.id, actor.name, 'DELETE', 'staff_coi', coiId, '', '');
  return { ok: true };
}

// ── Individual Dashboard Access ───────────────────────────────────────────

export async function getDashboardAccessList() {
  await requireActor(3);
  return query("SELECT discord_id, display_name, level, granted_by_name, granted_at FROM dashboard_access ORDER BY granted_at DESC");
}

export async function grantDashboardAccess(discordId, displayName) {
  const actor = await requireActor(3);
  if (!discordId?.trim()) return { ok: false, error: 'Discord ID required.' };
  const name = (displayName || discordId).trim();
  run("INSERT OR REPLACE INTO dashboard_access (discord_id, display_name, level, granted_by_id, granted_by_name, granted_at) VALUES (?, ?, 3, ?, ?, datetime('now'))",
    [discordId.trim(), name, actor.id, actor.name]);
  logAudit(actor.id, actor.name, 'CREATE', 'dashboard_access', null, name, `Discord ID: ${discordId.trim()}`);
  return { ok: true };
}

export async function revokeDashboardAccess(discordId) {
  const actor = await requireActor(3);
  run("DELETE FROM dashboard_access WHERE discord_id = ?", [discordId]);
  // Invalidate all active sessions for this user so access ends immediately
  run("DELETE FROM sessions WHERE discord_id = ?", [discordId]);
  logAudit(actor.id, actor.name, 'DELETE', 'dashboard_access', null, discordId, 'Access revoked');
  return { ok: true };
}

// Batch commit staff moves + faction reassignments
export async function commitAllChanges(staffMoves, factionMoves) {
  const actor = await requireActor(3);
  const token = process.env.DISCORD_BOT_TOKEN;
  let rolesSynced = 0, rolesFailed = 0;
  for (const m of staffMoves) {
    run("UPDATE staff SET team_id=?, team_name=?, updated_at=datetime('now') WHERE id=?", [m.newTeamId, m.newTeamName, m.staffId]);
    if (token && m.discordId && m.discordId.length > 15) {
      try {
        if (m.oldTeamId) await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${m.discordId}/roles/${m.oldTeamId}`, { method:'DELETE', headers:{Authorization:`Bot ${token}`} }).catch(()=>{});
        if (m.newTeamId) {
          const r = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${m.discordId}/roles/${m.newTeamId}`, { method:'PUT', headers:{Authorization:`Bot ${token}`} });
          if(r.ok) rolesSynced++; else rolesFailed++;
        }
      } catch(e) { rolesFailed++; }
    }
    logAudit(actor.id, actor.name, 'MOVE', 'staff', m.staffId, m.staffName, `${m.oldTeamName||'Unassigned'} → ${m.newTeamName}`);
  }
  for (const fm of factionMoves) {
    const lead = query("SELECT discord_id FROM staff WHERE team_id=? AND rank LIKE '%Lead%' LIMIT 1", [fm.newTeamId]);
    const newLeadId = lead[0]?.discord_id || '';
    run("UPDATE factions SET lead_discord_id=?, updated_at=datetime('now') WHERE id=?", [newLeadId, fm.factionId]);
    logAudit(actor.id, actor.name, 'MOVE', 'faction', fm.factionId, fm.factionName, `${fm.oldTeamName||'Unassigned'} → ${fm.newTeamName}`);
  }
  return { ok:true, staffMoves:staffMoves.length, factionMoves:factionMoves.length, rolesSynced, rolesFailed };
}
