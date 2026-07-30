"use server";
import { query, queryOne, run, transaction } from "../../../lib/db.js";
import { logAudit } from "../../../lib/audit.js";
import { sendPing, pingChannel } from "../../../lib/pings.js";
import { requireActor } from "../../../lib/requireActor.js";
import { today } from "../../../lib/format.js";
import { GAME_AFFAIRS_ID } from "../../../lib/constants.js";

// All Operations actions are L3-only unless explicitly noted otherwise.

// ── ANALYTICS ──
export async function getAnalytics() {
  await requireActor(3);
  const stats = queryOne("SELECT * FROM v_server_analytics") || {};
  const activity = query("SELECT * FROM v_staff_activity_30d");
  return { ...stats, activity };
}

// ── PROPERTIES ──
export async function getGlobalProperties() {
  await requireActor(2, {allowEventTeam: true, allowLeadStoryteller: true});
  return query("SELECT p.id, p.date_given, COALESCE(f.name,'') as faction, p.address, p.property_type as type, p.is_hq, p.confiscated, p.date_confiscated, p.confiscated_by, p.current_owner, p.notes FROM properties p LEFT JOIN factions f ON p.faction_id=f.id ORDER BY p.address");
}
export async function addGlobalProperty(data) {
  const actor = await requireActor(3, {allowEventTeam: true});
  const fac = data.faction ? queryOne("SELECT id FROM factions WHERE name=?", [data.faction]) : null;
  run("INSERT INTO properties (date_given, faction_id, address, property_type, is_hq, current_owner, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [new Date().toISOString().split('T')[0], fac?.id||null, data.address, data.type||'Property', data.isHQ?1:0, data.owner||'', data.notes||'']);
  logAudit(actor.id, actor.name, 'CREATE', 'property', null, data.address, '');
  return { ok: true };
}
export async function editPropertyDetail(propId, data) {
  const actor = await requireActor(3, {allowEventTeam: true});
  run("UPDATE properties SET address=?, property_type=?, is_hq=?, current_owner=?, notes=?, updated_at=datetime('now') WHERE id=?",
    [data.address, data.type || 'Property', data.isHQ ? 1 : 0, data.owner ?? '', data.notes ?? '', propId]);
  logAudit(actor.id, actor.name, 'EDIT', 'property', propId, data.address || '', 'Updated property');
  return { ok: true };
}
export async function assignProperty(propId, factionName) {
  const actor = await requireActor(3, {allowEventTeam: true});
  const fac = queryOne("SELECT id FROM factions WHERE name=?", [factionName]);
  run("UPDATE properties SET faction_id=?, date_given=?, confiscated=0, date_confiscated=NULL, confiscated_by=NULL, updated_at=datetime('now') WHERE id=?",
    [fac?.id, new Date().toISOString().split('T')[0], propId]);
  logAudit(actor.id, actor.name, 'EDIT', 'property', propId, '', 'Assigned to '+factionName);
  return { ok: true };
}
export async function confiscateProperty(propId) {
  const actor = await requireActor(3, {allowEventTeam: true});
  run("UPDATE properties SET faction_id=NULL, confiscated=1, date_confiscated=?, confiscated_by=?, updated_at=datetime('now') WHERE id=?",
    [new Date().toISOString().split('T')[0], actor.name, propId]);
  logAudit(actor.id, actor.name, 'EDIT', 'property', propId, '', 'Confiscated');
  return { ok: true };
}
export async function deleteProperty(propId) {
  const actor = await requireActor(3, {allowEventTeam: true});
  run("DELETE FROM properties WHERE id=?", [propId]);
  logAudit(actor.id, actor.name, 'DELETE', 'property', propId, '', '');
  return { ok: true };
}

// ── MERIDIANDATABASE.NET ACCESS ROLES ──
export async function getMdbAccessRoles() {
  await requireActor(3);
  return query("SELECT * FROM mdb_access_roles ORDER BY role_name");
}
export async function addMdbAccessRole(data) {
  const actor = await requireActor(3);
  run("INSERT OR IGNORE INTO mdb_access_roles (role_id, role_name) VALUES (?,?)", [data.role_id.trim(), data.role_name?.trim()||'']);
  logAudit(actor.id, actor.name, 'CREATE', 'mdb_role', null, data.role_name||data.role_id, '');
  return { ok: true };
}
export async function deleteMdbAccessRole(id) {
  const actor = await requireActor(3);
  run("DELETE FROM mdb_access_roles WHERE id=?", [id]);
  logAudit(actor.id, actor.name, 'DELETE', 'mdb_role', id, '', '');
  return { ok: true };
}

// ── BOT SERVER CONFIG ──
import { backfillGuildPings } from '../../../lib/backfillPings.js';
export async function getBotServerConfigs() {
  await requireActor(3);
  const servers = query(`SELECT b.*, f.name as faction_name FROM bot_server_configs b LEFT JOIN factions f ON b.faction_id = f.id ORDER BY b.guild_name`);
  const watchRoles = query(`SELECT * FROM bot_watch_roles ORDER BY role_name`);
  return servers.map(s => ({ ...s, watchRoles: watchRoles.filter(r => r.config_id === s.id) }));
}
export async function addBotServerConfig(data) {
  const actor = await requireActor(3);
  const existing = queryOne("SELECT id FROM bot_server_configs WHERE guild_id=?", [data.guild_id.trim()]);
  if (existing) return { ok: false, error: 'Server already configured.' };
  const fac = data.faction ? queryOne("SELECT id FROM factions WHERE name=?", [data.faction]) : null;
  const result = run(
    "INSERT INTO bot_server_configs (guild_id, guild_name, faction_id, access_role_id, access_role_name, comms_channel_id, comms_channel_name, faction_channel_id, faction_channel_name) VALUES (?,?,?,?,?,?,?,?,?)",
    [data.guild_id.trim(), data.guild_name?.trim()||'', fac?.id||null,
     data.access_role_id?.trim()||'', data.access_role_name?.trim()||'',
     data.comms_channel_id?.trim()||'', data.comms_channel_name?.trim()||'',
     data.faction_channel_id?.trim()||'', data.faction_channel_name?.trim()||'']);
  logAudit(actor.id, actor.name, 'CREATE', 'bot_config', null, data.guild_name||data.guild_id, '');
  const newId = result.lastInsertRowid;
  const guildId = data.guild_id.trim();
  const guildName = data.guild_name?.trim() || guildId;
  backfillGuildPings(guildId, guildName, newId, []).catch(e => console.error('[BACKFILL]', e.message));
  return { ok: true };
}
export async function updateBotServerConfig(id, data) {
  const actor = await requireActor(3);
  const fac = data.faction ? queryOne("SELECT id FROM factions WHERE name=?", [data.faction]) : null;
  const facId = data.faction ? (fac?.id || null) : null;
  run(`UPDATE bot_server_configs SET guild_name=?, faction_id=?, access_role_id=?, access_role_name=?,
       comms_channel_id=?, comms_channel_name=?, faction_channel_id=?, faction_channel_name=? WHERE id=?`,
    [data.guild_name?.trim()||'', facId, data.access_role_id?.trim()||'', data.access_role_name?.trim()||'',
     data.comms_channel_id?.trim()||'', data.comms_channel_name?.trim()||'',
     data.faction_channel_id?.trim()||'', data.faction_channel_name?.trim()||'', id]);
  logAudit(actor.id, actor.name, 'EDIT', 'bot_config', id, data.guild_name||'', '');
  return { ok: true };
}
export async function deleteBotServerConfig(id) {
  const actor = await requireActor(3);
  run("DELETE FROM bot_watch_roles WHERE config_id=?", [id]);
  run("DELETE FROM bot_server_configs WHERE id=?", [id]);
  logAudit(actor.id, actor.name, 'DELETE', 'bot_config', id, '', '');
  return { ok: true };
}
export async function addBotWatchRole(data) {
  const actor = await requireActor(3);
  run("INSERT INTO bot_watch_roles (config_id, role_id, role_name) VALUES (?,?,?)",
    [data.config_id, data.role_id.trim(), data.role_name?.trim()||'']);
  logAudit(actor.id, actor.name, 'CREATE', 'bot_watch_role', null, data.role_name||data.role_id, '');
  // Backfill last 150 messages for this specific new role in the background
  const cfg = queryOne("SELECT guild_id, guild_name FROM bot_server_configs WHERE id = ?", [data.config_id]);
  if (cfg) {
    const newRole = [{ role_id: data.role_id.trim(), role_name: data.role_name?.trim() || '' }];
    backfillGuildPings(cfg.guild_id, cfg.guild_name, data.config_id, newRole)
      .catch(e => console.error('[BACKFILL]', e.message));
  }
  return { ok: true };
}
export async function deleteBotWatchRole(id) {
  const actor = await requireActor(3);
  run("DELETE FROM bot_watch_roles WHERE id=?", [id]);
  logAudit(actor.id, actor.name, 'DELETE', 'bot_watch_role', id, '', '');
  return { ok: true };
}
// ── IMPORTS ──
export async function getGlobalImports() {
  await requireActor(2, {allowEventTeam: true, allowLeadStoryteller: true});
  const factions = query("SELECT id, name FROM factions ORDER BY name");
  const items = query("SELECT * FROM import_items ORDER BY tier, category, name");
  const perms = query("SELECT * FROM faction_imports");
  const permMap = {};
  perms.forEach(p => { permMap[`${p.item_id}_${p.faction_id}`] = p.permitted === 1; });
  return {
    factions: factions.map(f => f.name),
    items: items.map(item => {
      const which = factions.filter(f => permMap[`${item.id}_${f.id}`]).map(f => f.name);
      return { id: item.id, name: item.name, tier: item.tier, category: item.category, price: item.price||'', importTime: item.import_time||'', shipmentPower: item.shipment_power||'', count: which.length, authorizedFactions: which };
    })
  };
}
export async function addImportItem(data) {
  const actor = await requireActor(3, {allowEventTeam: true});
  run("INSERT INTO import_items (name, category, tier, price, import_time, shipment_power) VALUES (?, ?, ?, ?, ?, ?)",
    [data.name, data.category||'General', data.tier||'1', data.price||'', data.importTime||'', data.shipmentPower||'']);
  logAudit(actor.id, actor.name, 'CREATE', 'import_item', null, data.name, '');
  return { ok: true };
}
export async function editImportItem(id, data) {
  const actor = await requireActor(3, {allowEventTeam: true});
  run("UPDATE import_items SET name=?, category=?, tier=?, price=?, import_time=?, shipment_power=? WHERE id=?",
    [data.name, data.category, data.tier, data.price||'', data.importTime||'', data.shipmentPower||'', id]);
  logAudit(actor.id, actor.name, 'EDIT', 'import_item', id, data.name, '');
  return { ok: true };
}
export async function deleteImportItem(itemId) {
  const actor = await requireActor(3, {allowEventTeam: true});
  run("DELETE FROM import_items WHERE id=?", [itemId]);
  logAudit(actor.id, actor.name, 'DELETE', 'import_item', itemId, '', '');
  return { ok: true };
}

// ── DELETION REQUESTS ──
export async function getPendingDeletions() {
  await requireActor(3);
  return query("SELECT * FROM deletion_requests WHERE status='PENDING' ORDER BY created_at DESC");
}
export async function resolveDeletion(reqId, approve) {
  const actor = await requireActor(3);
  const req = queryOne("SELECT * FROM deletion_requests WHERE id=?", [reqId]);
  if (!req) return { ok: false };
  if (approve && req.target_row_id) {
    const tables = { scene_log:'scene_logs', intel_note:'intel_notes', ooc_note:'ooc_notes', task:'tasks', member:'faction_members' };
    const tbl = tables[req.content_type];
    if (tbl) run(`DELETE FROM ${tbl} WHERE id=?`, [req.target_row_id]);
  }
  run("UPDATE deletion_requests SET status=?, resolved_by=?, resolved_at=datetime('now') WHERE id=?",
    [approve?'APPROVED':'REJECTED', actor.name, reqId]);
  logAudit(actor.id, actor.name, approve?'APPROVE':'REJECT', 'deletion_request', reqId, req.content_type, '');
  return { ok: true };
}

// ── PENDING RP CHANGES ──
export async function getPendingExecutions() {
  await requireActor(3);
  return query("SELECT pe.id, pe.date, pe.status, f.name as faction, pe.execution_type as type, pe.turf, pe.old_value, pe.new_value, pe.requested_by, pe.deny_reason, pe.rp_note, (SELECT GROUP_CONCAT(n.name || ' (' || n.npc_type || ')', ', ') FROM npcs n WHERE n.turf=pe.turf AND n.npc_type=pe.old_value) as npcDetails FROM pending_executions pe JOIN factions f ON pe.faction_id=f.id WHERE pe.status IN ('PENDING','APPROVED','RP_DONE') ORDER BY pe.created_at DESC");
}
export async function deleteRPChange(execId) {
  const actor = await requireActor(3);
  const exec = queryOne("SELECT pe.*, f.name as faction_name FROM pending_executions pe JOIN factions f ON pe.faction_id=f.id WHERE pe.id=?", [execId]);
  if (!exec) return { ok: false, error: 'Not found' };
  run("DELETE FROM pending_executions WHERE id=?", [execId]);
  logAudit(actor.id, actor.name, 'DELETE', 'rp_change', execId, exec.faction_name, `Deleted ${exec.execution_type} request`);
  return { ok: true };
}

export async function approveRPChange(execId) {
  const actor = await requireActor(3);
  const exec = queryOne("SELECT pe.*, f.name as faction_name FROM pending_executions pe JOIN factions f ON pe.faction_id=f.id WHERE pe.id=?", [execId]);
  if (!exec) return { ok: false };
  run("UPDATE pending_executions SET status='APPROVED', approver_id=? WHERE id=?", [actor.id, execId]);
  run("INSERT INTO faction_history (faction_id, faction_name, action_type, details, authorized_by) VALUES (?,?,'RP_CHANGE_APPROVED',?,?)",
    [exec.faction_id, exec.faction_name, `${exec.execution_type}: ${exec.old_value} → ${exec.new_value}`, actor.name]);
  logAudit(actor.id, actor.name, 'APPROVE', 'rp_change', execId, exec.faction_name, `Approved ${exec.execution_type}`);
  if (exec.requester_id) {
    await sendPing('rp.approved.requester',
      `<@${exec.requester_id}> ✅ Your RP change request for **${exec.faction_name}** has been approved — **${exec.old_value} → ${exec.new_value}**. Schedule the scene, then click **Mark RP Done** on your dashboard when it's complete.`);
  }
  return { ok: true };
}

export async function denyRPChange(execId, reason) {
  const actor = await requireActor(3);
  const exec = queryOne("SELECT pe.*, f.name as faction_name FROM pending_executions pe JOIN factions f ON pe.faction_id=f.id WHERE pe.id=?", [execId]);
  if (!exec) return { ok: false };
  run("UPDATE pending_executions SET status='DENIED', deny_reason=? WHERE id=?", [reason || '', execId]);
  logAudit(actor.id, actor.name, 'REJECT', 'rp_change', execId, exec.faction_name, reason || '');
  if (exec.requester_id) {
    await sendPing('rp.denied.requester',
      `<@${exec.requester_id}> ❌ Your RP change request for **${exec.faction_name}** was denied.\n**Reason:** ${reason || 'No reason provided.'}\nPlease respond with additional context and resubmit via your dashboard.`);
  }
  return { ok: true };
}

export async function resubmitRPChange(execId, note) {
  const actor = await requireActor(1);
  const exec = queryOne("SELECT pe.*, f.name as faction_name FROM pending_executions pe JOIN factions f ON pe.faction_id=f.id WHERE pe.id=?", [execId]);
  if (!exec) return { ok: false };
  if (exec.requester_id !== actor.id) return { ok: false, error: 'Not your request.' };
  run("UPDATE pending_executions SET status='PENDING', rp_note=?, deny_reason='' WHERE id=?", [note || '', execId]);
  logAudit(actor.id, actor.name, 'EDIT', 'rp_change', execId, exec.faction_name, 'Resubmitted');
  await sendPing('rp.resubmitted',
    `🔄 **RP Change Resubmitted** — **${exec.faction_name}**\n**Type:** ${exec.execution_type}\n**Change:** ${exec.old_value} → ${exec.new_value}\n**Requested By:** ${exec.requested_by}${note ? `\n**Additional Context:** ${note}` : ''}`);
  return { ok: true };
}

export async function markRPDone(execId, note) {
  const actor = await requireActor(1);
  const exec = queryOne("SELECT pe.*, f.name as faction_name FROM pending_executions pe JOIN factions f ON pe.faction_id=f.id WHERE pe.id=?", [execId]);
  if (!exec) return { ok: false };
  if (exec.requester_id !== actor.id && actor.level < 3) return { ok: false, error: 'Not your request.' };
  run("UPDATE pending_executions SET status='RP_DONE', rp_note=? WHERE id=?", [note || '', execId]);
  logAudit(actor.id, actor.name, 'EDIT', 'rp_change', execId, exec.faction_name, 'RP marked done');
  await sendPing('rp.done',
    `🎬 **RP Scene Complete** — **${exec.faction_name}**\n**Change:** ${exec.old_value} → ${exec.new_value}\n**Confirmed By:** ${actor.name}${note ? `\n**Note:** ${note}` : ''}\n\nReady to execute the ${exec.execution_type} change on the dashboard.`);
  return { ok: true };
}

export async function getMyRPRequests() {
  const actor = await requireActor(1);
  return query(
    `SELECT pe.*, f.name as faction_name FROM pending_executions pe
     JOIN factions f ON pe.faction_id=f.id
     WHERE pe.requester_id=? AND pe.status NOT IN ('EXECUTED')
     ORDER BY pe.created_at DESC`,
    [actor.id]
  );
}

export async function executeRPChange(execId, data) {
  const actor = await requireActor(3);
  const exec = queryOne("SELECT pe.*, f.name as faction_name FROM pending_executions pe JOIN factions f ON pe.faction_id=f.id WHERE pe.id=?", [execId]);
  if (!exec) return { ok: false };
  if (exec.execution_type === 'NPC' && data.npcName && data.npcPos) {
    const npc = queryOne("SELECT id FROM npcs WHERE turf=? AND npc_type=?", [exec.turf, exec.old_value]);
    if (npc) run("UPDATE npcs SET name=?, position=?, npc_type=?, updated_at=datetime('now') WHERE id=?",
      [data.npcName, data.npcPos, exec.new_value, npc.id]);
  } else if (exec.execution_type === 'HQ') {
    // Clear HQ flag on old address, update/insert new address as HQ
    run("UPDATE properties SET is_hq=0, updated_at=datetime('now') WHERE faction_id=? AND address=?", [exec.faction_id, exec.old_value]);
    const existing = queryOne("SELECT id FROM properties WHERE faction_id=? AND address=?", [exec.faction_id, exec.new_value]);
    if (existing) {
      run("UPDATE properties SET is_hq=1, updated_at=datetime('now') WHERE id=?", [existing.id]);
    } else {
      run("INSERT INTO properties (address, faction_id, property_type, is_hq) VALUES (?, ?, 'Property', 1)", [exec.new_value, exec.faction_id]);
    }
  }
  run("UPDATE pending_executions SET status='EXECUTED' WHERE id=?", [execId]);
  run("INSERT INTO faction_history (faction_id, faction_name, action_type, details, authorized_by) VALUES (?,?,'RP_CHANGE_EXECUTED',?,?)",
    [exec.faction_id, exec.faction_name, `${exec.execution_type}: ${exec.old_value} → ${exec.new_value}`, actor.name]);
  logAudit(actor.id, actor.name, 'APPROVE', 'rp_change', execId, exec.faction_name, exec.execution_type);
  await sendPing('rp.executed',
    `✅ **RP Change Executed** — **${exec.faction_name}**\n**Type:** ${exec.execution_type}\n**Change:** ${exec.old_value} → ${exec.new_value}\n**Executed By:** ${actor.name}${exec.execution_type === 'NPC' && data.npcName ? `\n**New NPC:** ${data.npcName}` : ''}`);
  if (exec.requester_id) {
    await sendPing('rp.executed.requester',
      `<@${exec.requester_id}> ✅ Your RP change for **${exec.faction_name}** has been executed — **${exec.old_value} → ${exec.new_value}**.`);
  }
  return { ok: true };
}

// ── AUDIT LOG ──
/**
 * Health of the bot's background jobs (bot/lib/syncStatus.js writes it).
 *
 * Shown above the audit log because that is where someone lands when something
 * looks wrong. Before this, a job that stopped working said so only in journald,
 * so the first sign of a broken sync was stale numbers days later.
 */
export async function getSyncStatus() {
  await requireActor(3, {allowEventTeam: true});
  return query("SELECT * FROM sync_status ORDER BY label, job");
}

export async function getAuditLog(limit) {
  await requireActor(3, {allowEventTeam: true});
  return query("SELECT * FROM site_audit_log ORDER BY timestamp DESC LIMIT ?", [limit || 200]);
}
export async function deleteAuditLogEntry(entryId) {
  const actor = await requireActor(3, {allowEventTeam: true});
  run("DELETE FROM site_audit_log WHERE id = ?", [entryId]);
  logAudit(actor.id, actor.name, 'DELETE', 'audit_log', entryId, '', 'Audit entry pruned');
  return { ok: true };
}

// ── FACTION NAMES (used by other pages too — L1+) ──
export async function getFactionNames() {
  await requireActor(1);
  return query("SELECT name FROM factions ORDER BY name").map(r=>r.name);
}

// ══════════════════════════════════════════════
// LEADERSHIP WORKSPACE
// ══════════════════════════════════════════════
export async function getLeadershipTasks() {
  const actor = await requireActor(3);
  const discordId = actor.id;
  const leadershipRoleId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_leadership'")?.role_id || '';
  const gameAffairsRoleId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'game_affairs'")?.role_id || '';
  const leadRoleId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_team_lead'")?.role_id || '';
  const staff = queryOne("SELECT team_id FROM staff WHERE discord_id = ?", [discordId]);
  const teamId = staff?.team_id || '';

  const allTasks = query("SELECT * FROM tasks ORDER BY created_at DESC");
  return allTasks.filter(t => {
    if (t.target_id === discordId) return true;
    if (t.claimed_by === discordId) return true;
    if (t.target_type === 'Role' && (t.target_id === leadershipRoleId || t.target_id === gameAffairsRoleId || t.target_id === leadRoleId || t.target_id === teamId)) return true;
    return false;
  }).map(t => {
    const claimer = t.claimed_by !== 'None' ? (queryOne("SELECT display_name FROM staff WHERE discord_id = ?", [t.claimed_by])?.display_name || t.claimed_by) : 'Unclaimed';
    return { ...t, claimerName: claimer };
  });
}

export async function getLeadershipReminders() {
  const actor = await requireActor(3);
  const discordId = actor.id;
  const leadershipRoleId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_leadership'")?.role_id || '';
  const gameAffairsRoleId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'game_affairs'")?.role_id || '';
  const leadRoleId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_team_lead'")?.role_id || '';
  const staff = queryOne("SELECT team_id FROM staff WHERE discord_id = ?", [discordId]);
  const teamId = staff?.team_id || '';

  const all = query("SELECT * FROM reminders WHERE status IN ('ACTIVE','WARNED') ORDER BY epoch_ms");
  return all.filter(r => {
    if (r.author_id === discordId) return true;
    const roleMatch = r.target_tag?.match(/<@&(\d+)>/);
    const userMatch = r.target_tag?.match(/<@(\d+)>/);
    if (userMatch && userMatch[1] === discordId) return true;
    if (roleMatch && (roleMatch[1] === leadershipRoleId || roleMatch[1] === gameAffairsRoleId || roleMatch[1] === leadRoleId || roleMatch[1] === teamId)) return true;
    return false;
  }).map(r => {
    const authorStaff = queryOne("SELECT display_name FROM staff WHERE discord_id = ?", [r.author_id]);
    return { ...r, authorName: authorStaff?.display_name || r.author_id, epochMs: parseInt(r.epoch_ms) };
  });
}

export async function createLeadershipTask(data) {
  const actor = await requireActor(3);
  const uid = Date.now().toString();
  const dt = new Date().toISOString();
  const nextReminder = data.enableDM ? (Date.now() + 86400000).toString() : null;
  run("INSERT INTO tasks (task_uid, description, target_id, target_type, claimed_by, created_by_id, created_by_name, next_reminder, created_at) VALUES (?, ?, ?, ?, 'None', ?, ?, ?, ?)",
    [uid, data.desc, data.targetId, data.targetType, actor.id, actor.name, nextReminder, dt]);
  run("INSERT INTO task_log (action, actor, task_uid, description, target, created_at) VALUES ('CREATED', ?, ?, ?, ?, ?)",
    [actor.name, uid, data.desc, data.targetType + ': ' + data.targetId, dt]);
  logAudit(actor.id, actor.name, 'CREATE', 'task', null, data.desc.substring(0,50), 'Leadership task');
  const leadershipRoleId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_leadership'")?.role_id || '';
  const gameAffairsId = GAME_AFFAIRS_ID;
  const isLeadershipRank = (id) => !!queryOne("SELECT discord_id FROM staff WHERE discord_id = ? AND (LOWER(rank) LIKE '%leadership%' OR LOWER(rank) LIKE '%management%')", [id]);
  const creatorIsLeadership = isLeadershipRank(actor.id);
  const assigneeIsLeadership = (data.targetType === 'Role' && (data.targetId === leadershipRoleId || data.targetId === gameAffairsId))
    || (data.targetType === 'User' && isLeadershipRank(data.targetId));
  const tag = data.targetType === 'Role' ? '<@&' + data.targetId + '>' : '<@' + data.targetId + '>';
  await sendPing('task.assigned', '📋 **NEW TASK ASSIGNED** | ' + tag + '\n**Assigned By:** ' + actor.name, { alt: creatorIsLeadership && assigneeIsLeadership });
  return { ok: true };
}

export async function createLeadershipReminder(data) {
  const actor = await requireActor(3);
  const uuid = Math.random().toString(36).substring(2, 8);
  const targetTag = data.targetType === 'Role' ? '<@&' + data.targetId + '>' : '<@' + data.targetId + '>';
  const leadershipRoleId2 = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_leadership'")?.role_id || '';
  const gameAffairsId2 = GAME_AFFAIRS_ID;
  const routeToLeadership2 = data.targetType === 'Role' && (data.targetId === leadershipRoleId2 || data.targetId === gameAffairsId2);
  const ch = pingChannel('event.created', { alt: routeToLeadership2, ignoreEnabled: true });
  run("INSERT INTO reminders (uuid, author_id, channel_id, message, epoch_ms, readable_time, repeat_rule, target_tag, status) VALUES (?, ?, ?, ?, ?, ?, 'None', ?, 'ACTIVE')",
    [uuid, actor.id, ch, data.message, data.epochMs.toString(), new Date(data.epochMs).toISOString(), targetTag]);
  logAudit(actor.id, actor.name, 'CREATE', 'reminder', null, data.message.substring(0,50), '');
  const epoch = Math.floor(data.epochMs / 1000);
  const embeds = [{ title: '📌 ' + (data.eventType || 'Event') + ' Scheduled', description: '**Time:** <t:' + epoch + ':F> (<t:' + epoch + ':R>)' + (data.note ? '\n**Details:** ' + data.note : '') + '\n\n*Via Meridian Dashboard*', color: 0x5865F2 }];
  await sendPing('event.created', targetTag, { alt: routeToLeadership2, embeds });
  return { ok: true };
}

export async function claimLeadershipTask(taskUid, enableDM) {
  const actor = await requireActor(3);
  run("UPDATE tasks SET claimed_by = ? WHERE task_uid = ?", [actor.id, taskUid]);
  if (enableDM) run("UPDATE tasks SET next_reminder = ? WHERE task_uid = ?", [(Date.now() + 86400000).toString(), taskUid]);
  run("INSERT INTO task_log (action, actor, task_uid, description, target, created_at) VALUES ('CLAIMED', ?, ?, '', 'Claimed', ?)",
    [actor.name + ' (' + actor.id + ')', taskUid, new Date().toISOString()]);
  logAudit(actor.id, actor.name, 'EDIT', 'task', null, taskUid, 'Claimed');
  return { ok: true };
}

export async function completeLeadershipTask(taskUid) {
  const actor = await requireActor(3);
  const task = queryOne("SELECT description, target_id, target_type, created_by_id FROM tasks WHERE task_uid = ?", [taskUid]);
  run("DELETE FROM tasks WHERE task_uid = ?", [taskUid]);
  run("INSERT INTO task_log (action, actor, task_uid, description, target, created_at) VALUES ('COMPLETED', ?, ?, ?, 'Done', ?)",
    [actor.name, taskUid, task?.description || '', new Date().toISOString()]);
  logAudit(actor.id, actor.name, 'DELETE', 'task', null, taskUid, 'Completed');

  if (task?.created_by_id === 'promotion-bot') {
    // Promotion bot tasks go to the team lead channel, not the global channel.
    const factionName = task.description.split(' — ')[0].trim();
    const fac = factionName ? queryOne("SELECT lead_discord_id, pending_promo FROM factions WHERE name = ?", [factionName]) : null;
    const leadPing = fac?.lead_discord_id ? `<@${fac.lead_discord_id}> ` : '';

    let importsLine = '';
    if (fac?.pending_promo) {
      try {
        const payload = JSON.parse(fac.pending_promo);
        const tier = payload.tier;
        const imports = Array.isArray(payload.imports) ? payload.imports : [];
        importsLine = imports.length > 0
          ? `\n**Approved imports (${imports.length}):** ${imports.join(', ')}`
          : '\nNo weapon imports were approved.';
        await sendPing('promo.staged', `${leadPing}📋 **Pending Promotion** — **${factionName}** → Tier ${tier}\nStaged by: ${actor.name}${importsLine}`);
      } catch {
        await sendPing('promo.staged', `${leadPing}📋 **Pending Promotion** — **${factionName}**\nStaged by: ${actor.name}`);
      }
    } else {
      await sendPing('promo.staged', `${leadPing}📋 **Pending Promotion** — **${factionName}**\nReviewed by: ${actor.name}`);
    }
  } else if (task && task.created_by_id && task.created_by_id !== actor.id) {
    const leadershipRoleId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_leadership'")?.role_id || '';
    const gameAffairsId = GAME_AFFAIRS_ID;
    const isLeadershipRank = (id) => !!queryOne("SELECT discord_id FROM staff WHERE discord_id = ? AND (LOWER(rank) LIKE '%leadership%' OR LOWER(rank) LIKE '%management%')", [id]);
    const creatorIsLeadership = isLeadershipRank(task.created_by_id);
    const assigneeIsLeadership = (task.target_type === 'Role' && (task.target_id === leadershipRoleId || task.target_id === gameAffairsId))
      || (task.target_type === 'User' && isLeadershipRank(task.target_id));
    await sendPing('task.completed.creator', `✅ <@${task.created_by_id}> — your task "${task.description}" has been completed by **${actor.name}**.`, { alt: creatorIsLeadership && assigneeIsLeadership });
  }
  return { ok: true };
}

export async function editLeadershipTask(taskUid, newDesc) {
  const actor = await requireActor(3);
  run("UPDATE tasks SET description = ? WHERE task_uid = ?", [newDesc, taskUid]);
  logAudit(actor.id, actor.name, 'EDIT', 'task', null, taskUid, newDesc.substring(0,100));
  return { ok: true };
}

export async function deleteLeadershipReminder(uuid) {
  const actor = await requireActor(3);
  run("DELETE FROM reminders WHERE uuid = ?", [uuid]);
  logAudit(actor.id, actor.name, 'DELETE', 'reminder', null, uuid, '');
  return { ok: true };
}

export async function snoozeLeadershipReminder(uuid) {
  await requireActor(3);
  const r = queryOne("SELECT * FROM reminders WHERE uuid = ?", [uuid]);
  if (!r) return { ok: false };
  const newTime = parseInt(r.epoch_ms) + 3600000;
  run("UPDATE reminders SET epoch_ms = ?, readable_time = ?, status = 'ACTIVE' WHERE uuid = ?",
    [newTime.toString(), new Date(newTime).toISOString(), uuid]);
  return { ok: true };
}

export async function getStaffForWorkspace() {
  await requireActor(3);
  return query("SELECT discord_id, display_name, team_id, team_name, rank FROM staff WHERE discord_id != '' AND discord_id NOT LIKE 'placeholder%' ORDER BY display_name");
}

export async function getRoleTargetsForWorkspace() {
  await requireActor(3);
  const leadershipId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_leadership'")?.role_id || '';
  const leadId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_team_lead'")?.role_id || '';
  const allFmId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_team_guide'")?.role_id || '';
  const teams = query("SELECT DISTINCT team_id, team_name FROM staff WHERE team_id != '' AND team_name != 'Game Affairs Management'");
  return { leadershipId, leadId, allFmId, teams };
}

// Loadouts/Arsenal CRUD lives in storytelling/actions.js — the Arsenal page
// (storytelling/loadouts) imports it from there. A duplicate copy that used to
// live here was unused and has been removed.

// ══════════════════════════════════════════════
// ARCHIVED FACTIONS
// ══════════════════════════════════════════════
export async function getArchivedFactions() {
  await requireActor(3);
  const factions = query("SELECT * FROM factions WHERE archived = 1 ORDER BY archived_at DESC");
  return factions.map(f => {
    const members = query("SELECT character_name, phone, residence, is_leader FROM faction_members WHERE faction_id = ? ORDER BY is_leader DESC, character_name", [f.id]);
    const scenesAll = queryOne("SELECT COUNT(*) as c FROM scene_logs WHERE faction_id = ?", [f.id]);
    const history = query("SELECT action_type, details, authorized_by, created_at FROM faction_history WHERE faction_id = ? ORDER BY created_at DESC LIMIT 20", [f.id]);
    const notes = query("SELECT text, author, date FROM intel_notes WHERE faction_id = ? ORDER BY created_at DESC LIMIT 10", [f.id]);
    const props = query("SELECT address, is_hq FROM properties WHERE faction_id = ?", [f.id]);
    const imports = query("SELECT i.name, i.tier FROM import_items i JOIN faction_imports fi ON fi.item_id = i.id WHERE fi.faction_id = ? AND fi.permitted = 1 ORDER BY i.tier, i.name", [f.id]);
    const lead = queryOne("SELECT display_name, team_name FROM staff WHERE discord_id = ?", [f.lead_discord_id]);
    return {
      ...f,
      memberCount: members.length,
      members,
      sceneCount: scenesAll?.c || 0,
      history, notes, properties: props, imports,
      leadName: lead?.display_name || 'Unknown',
      teamName: lead?.team_name || 'Unknown',
    };
  });
}

export async function restoreFaction(id) {
  const actor = await requireActor(3);
  run("UPDATE factions SET archived=0, archived_at='' WHERE id=?", [id]);
  const f = queryOne("SELECT name FROM factions WHERE id=?", [id]);
  logAudit(actor.id, actor.name, 'RESTORE', 'faction', id, f?.name || '', 'Restored from archive');
  return { ok: true };
}

// ══════════════════════════════════════════════
// CONVERSATIONS TAB
// ══════════════════════════════════════════════
export async function getConversationStats(fromDate, toDate, memberFilter, channelFilter) {
  await requireActor(3);
  try {
    const from = fromDate + 'T00:00:00.000Z';
    const to = toDate + 'T23:59:59.999Z';

    const channelClause = channelFilter ? ' AND channel_id = ?' : '';
    const channelParam = channelFilter ? [channelFilter] : [];
    const totalMessages = queryOne(`SELECT COUNT(*) as c FROM discord_messages WHERE created_at >= ? AND created_at <= ?${channelClause}`, [from, to, ...channelParam])?.c || 0;
    const channelsScanned = queryOne(`SELECT COUNT(DISTINCT channel_id) as c FROM discord_messages WHERE created_at >= ? AND created_at <= ?${channelClause}`, [from, to, ...channelParam])?.c || 0;

    let memberClause = '';
    let params = [from, to];
    if (channelFilter) { memberClause += ' AND channel_id = ?'; params.push(channelFilter); }
    if (memberFilter) {
      memberClause += ' AND (LOWER(author_name) LIKE ? OR author_id = ?)';
      params.push('%' + memberFilter.toLowerCase() + '%');
      params.push(memberFilter);
    }

    const members = query(`SELECT author_id, author_name, COUNT(*) as message_count
      FROM discord_messages
      WHERE created_at >= ? AND created_at <= ?${memberClause}
      GROUP BY author_id, author_name
      ORDER BY message_count DESC
      LIMIT 50`, params);

    const membersWithTasks = members.map(m => {
      const openTasks = queryOne("SELECT COUNT(*) as c FROM tasks t WHERE (t.claimed_by = ? OR t.target_id = ?) AND NOT EXISTS (SELECT 1 FROM task_log tl WHERE tl.task_uid = t.task_uid AND tl.action = 'COMPLETED')", [m.author_id, m.author_id])?.c || 0;
      const completed = queryOne("SELECT COUNT(*) as c FROM task_log WHERE action = 'COMPLETED' AND actor IN (SELECT display_name FROM staff WHERE discord_id = ?) AND created_at >= ?", [m.author_id, from])?.c || 0;
      return { ...m, openTasks, completed, totalActivity: m.message_count + openTasks + completed };
    });

    const channels = query(`SELECT channel_id, channel_name, COUNT(*) as message_count, COUNT(DISTINCT author_id) as unique_members
      FROM discord_messages
      WHERE created_at >= ? AND created_at <= ?${channelClause}
      GROUP BY channel_id, channel_name
      ORDER BY message_count DESC`, [from, to, ...channelParam]);

    return { totalMessages, channelsScanned, members: membersWithTasks, channels };
  } catch (e) {
    console.error("getConversationStats:", e);
    return { totalMessages: 0, channelsScanned: 0, members: [], channels: [] };
  }
}

export async function generateConversationSummary(fromDate, toDate, memberFilter, channelFilter) {
  await requireActor(3);
  const from = fromDate + 'T00:00:00.000Z';
  const to = toDate + 'T23:59:59.999Z';
  const cacheKey = `${fromDate}_${toDate}_${memberFilter || 'all'}_${channelFilter || 'allch'}`;

  const cached = queryOne("SELECT content FROM conversation_summaries WHERE cache_key = ? AND created_at > datetime('now', '-1 hour')", [cacheKey]);
  if (cached) {
    try { return JSON.parse(cached.content); } catch (e) {}
  }

  try {
    const channelClause2 = channelFilter ? ' AND channel_id = ?' : '';
    const channelParam2 = channelFilter ? [channelFilter] : [];
    const messages = query(`SELECT channel_name, author_name, content, created_at
      FROM discord_messages
      WHERE created_at >= ? AND created_at <= ?${channelClause2}
      ORDER BY created_at ASC
      LIMIT 2000`, [from, to, ...channelParam2]);

    if (messages.length === 0) {
      return { teamThemes: 'No messages in the selected date range.', memberSummary: '', channelSummaries: [] };
    }

    const byChannel = {};
    messages.forEach(m => { if (!byChannel[m.channel_name]) byChannel[m.channel_name] = []; byChannel[m.channel_name].push(m); });

    const transcript = messages.map(m => `[#${m.channel_name}] ${m.author_name}: ${m.content.substring(0, 400)}`).join('\n').substring(0, 25000);
    const memberTranscript = memberFilter
      ? messages.filter(m => m.author_name.toLowerCase().includes(memberFilter.toLowerCase()))
          .map(m => `[#${m.channel_name}] ${m.content.substring(0, 400)}`)
          .join('\n').substring(0, 18000)
      : '';

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { teamThemes: '[AI summary unavailable: OPENAI_API_KEY not set]', memberSummary: '', channelSummaries: [] };
    }

    const prompts = [
      {
        type: 'team_themes',
        system: 'You are analyzing Discord conversations for a gaming faction management (FM) team running a GTA RP server. Your job is to produce a detailed operational summary of what has been discussed.\n\nOUTPUT: Raw HTML only (no markdown, no code fences). Format: <ul> containing <li> items. Each <li> starts with <strong>Theme Name</strong>: followed by a rich, multi-sentence explanation.\n\nFOCUS ON (in priority order):\n- Concerns or problems raised (about factions, staff, game mechanics, policy)\n- Decisions made and who made them\n- Action items and things that need to be done\n- Faction-specific discussions (activity, behavior, tier concerns, promotions, demotions, removals)\n- Staff matters (performance, assignments, team changes, guide activity)\n- Event planning, scheduling, OOC meetings\n- Policy or rule interpretations\n- Bug reports, game mechanic issues, balance discussions\n- Requests awaiting action or approval\n\nIGNORE COMPLETELY:\n- Jokes, memes, banter, camaraderie, humor\n- Personal check-ins, greetings, small talk\n- Off-topic chatter about non-FM topics\n- Team culture or interpersonal warmth\n\nREQUIREMENTS:\n- Produce 8-15 themed bullets covering the significant operational discussions\n- Each theme description should be 2-4 sentences, not just a label\n- Name specific factions, staff members, tiers, imports, events, or incidents referenced\n- Include concrete details: who raised the concern, what decisions were made, what outcomes occurred, what still needs resolution\n- Group related conversations under one theme instead of splitting them\n- If a topic spans multiple days or channels, mention that continuity\n\nAvoid: vague summaries, single-sentence bullets, generic descriptions without names.',
        user: `Summarize the key themes discussed across these Discord channels. Focus on operational topics, factions, and team activity.\n\n${transcript}`,
      },
    ];

    if (memberFilter && memberTranscript) {
      prompts.push({
        type: 'member_summary',
        system: `You are producing a detailed operational activity summary for one specific team member on a GTA RP faction management (FM) team.\n\nOUTPUT: Raw HTML only (no markdown, no code fences). Format: <ul> containing <li> items.\n\nFOCUS ON (in priority order):\n- Concerns or problems they raised\n- Decisions they made or contributed to\n- Action items they took on or delegated\n- Faction-specific work they did (scenes, feedback, reviews, promotions they discussed)\n- Staff/team matters they weighed in on\n- Events they scheduled, attended, or planned\n- Questions they asked and what they were investigating\n- Requests they made or received\n\nIGNORE COMPLETELY:\n- Jokes, banter, memes, casual humor\n- Greetings, small talk, personal check-ins\n- Off-topic chatter\n- Supportive or friendly messages without operational substance\n\nREQUIREMENTS:\n- Produce 8-15 bullets summarizing what ${memberFilter} has been working on\n- Each bullet should be 2-3 sentences with specific detail\n- Reference factions, other staff, events, and topics by name using <strong>\n- Describe WHAT they discussed and, where evident, WHY or WHAT the outcome was\n- Highlight any conflicts, concerns raised, questions asked, or decisions they made\n- Note which channels they focused on operationally\n- If they posted in threads (format: 'channel-name / thread-name'), describe what those threads addressed\n\nAvoid: vague bullets without names, generic activity labels, social/cultural observations, raw message counts.`,
        user: `Summarize what ${memberFilter} has been doing based on their messages:\n\n${memberTranscript}`,
      });
    }

    const channelList = Object.keys(byChannel).map(ch => {
      const msgs = byChannel[ch].slice(-100).map(m => `${m.author_name}: ${m.content.substring(0, 200)}`).join('\n');
      return `=== #${ch} ===\n${msgs}`;
    }).join('\n\n').substring(0, 20000);

    prompts.push({
      type: 'channel_summaries',
      system: `You are generating one-sentence summaries per Discord channel. Output ONLY raw HTML: <ul><li><strong>#channel-name</strong>: summary</li></ul>. One li per channel. 1-2 sentences each. Do NOT use markdown or code fences. Start directly with <ul>.`,
      user: `Generate a summary for each channel:\n\n${channelList}`,
    });

    const responses = {};
    for (const p of prompts) {
      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: 'gpt-4o',
            max_tokens: 3000,
            messages: [{ role: 'system', content: p.system }, { role: 'user', content: p.user }],
          }),
        });
        const data = await res.json();
        let aiOutput = data.choices?.[0]?.message?.content || '';
        aiOutput = aiOutput.replace(/^```[a-z]*\n?/gim, '').replace(/```\s*$/gim, '').trim();
        aiOutput = aiOutput.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        responses[p.type] = aiOutput;
      } catch (e) {
        console.error(`AI summary error (${p.type}):`, e.message);
        responses[p.type] = '[Error generating summary]';
      }
    }

    const result = {
      teamThemes: responses.team_themes || '',
      memberSummary: responses.member_summary || '',
      channelSummaries: responses.channel_summaries || '',
    };

    run("INSERT OR REPLACE INTO conversation_summaries (cache_key, summary_type, target, content, from_date, to_date) VALUES (?, 'combined', ?, ?, ?, ?)",
      [cacheKey, memberFilter || '', JSON.stringify(result), fromDate, toDate]);

    return result;
  } catch (e) {
    console.error("generateConversationSummary:", e);
    return { teamThemes: `[Error: ${e.message}]`, memberSummary: '', channelSummaries: '' };
  }
}

export async function getMemberSuggestions(prefix) {
  await requireActor(3);
  if (!prefix || prefix.length < 1) return [];
  return query(`SELECT DISTINCT author_name, author_id, COUNT(*) as c
    FROM discord_messages
    WHERE LOWER(author_name) LIKE ?
    GROUP BY author_id, author_name
    ORDER BY c DESC
    LIMIT 10`, ['%' + prefix.toLowerCase() + '%']);
}

export async function getAvailableChannels() {
  await requireActor(3);
  return query("SELECT DISTINCT channel_id, channel_name FROM discord_messages ORDER BY channel_name");
}

// ══════════════════════════════════════════════
// FLEET TRACKING
// ══════════════════════════════════════════════
const TIER_DEFAULTS = {
  1: { types: 0, total: 0, garages: 1, stipend: 0 },
  2: { types: 1, total: 5, garages: 1, stipend: 4000 },
  3: { types: 2, total: 10, garages: 1, stipend: 8000 },
  4: { types: 4, total: 15, garages: 2, stipend: 12000 },
  5: { types: 5, total: 18, garages: 2, stipend: 14400 },
  6: { types: 6, total: 21, garages: 2, stipend: 16800 },
  7: { types: 8, total: 24, garages: 3, stipend: 19200 },
  8: { types: 9, total: 27, garages: 3, stipend: 21600 },
  9: { types: 10, total: 30, garages: 3, stipend: 24000 },
};

function getEffectiveLimits(factionId, tier) {
  const override = queryOne("SELECT max_types, max_total, max_garages, override_reason, overridden_by, overridden_at FROM faction_fleet_config WHERE faction_id = ?", [factionId]);
  const defaults = TIER_DEFAULTS[tier] || TIER_DEFAULTS[1];
  if (override) {
    return {
      maxTypes: override.max_types ?? defaults.types,
      maxTotal: override.max_total ?? defaults.total,
      maxGarages: override.max_garages ?? defaults.garages,
      isOverridden: true,
      overrideReason: override.override_reason,
      overriddenBy: override.overridden_by,
      overriddenAt: override.overridden_at,
    };
  }
  return {
    maxTypes: defaults.types,
    maxTotal: defaults.total,
    maxGarages: defaults.garages,
    isOverridden: false,
  };
}

export async function getFleetOverview() {
  await requireActor(3);
  const factions = query("SELECT id, name, tier FROM factions WHERE archived = 0 ORDER BY name");
  return factions.map(f => {
    const limits = getEffectiveLimits(f.id, f.tier);
    const vehicles = query("SELECT * FROM faction_fleet_vehicles WHERE faction_id = ? ORDER BY vehicle_name", [f.id]);
    const garages = query("SELECT * FROM faction_fleet_garages WHERE faction_id = ? ORDER BY name", [f.id]);
    const totalQuantity = vehicles.reduce((sum, v) => sum + v.quantity, 0);
    const defaults = TIER_DEFAULTS[f.tier] || TIER_DEFAULTS[1];
    return {
      id: f.id, name: f.name, tier: f.tier,
      vehicles, garages, totalQuantity,
      typeCount: vehicles.length,
      limits,
      defaults: { types: defaults.types, total: defaults.total, garages: defaults.garages, stipend: defaults.stipend },
    };
  });
}

export async function getVehicleCatalog(query_str) {
  await requireActor(3);
  const q = (query_str || '').toLowerCase();
  if (!q) {
    return query("SELECT vehicle_name FROM fleet_vehicle_catalog ORDER BY use_count DESC, vehicle_name LIMIT 30").map(r => r.vehicle_name);
  }
  return query("SELECT vehicle_name FROM fleet_vehicle_catalog WHERE LOWER(vehicle_name) LIKE ? ORDER BY use_count DESC, vehicle_name LIMIT 20", [`%${q}%`]).map(r => r.vehicle_name);
}

export async function addFleetVehicle(factionId, vehicleName, quantity, notes) {
  const actor = await requireActor(3);
  const faction = queryOne("SELECT name, tier FROM factions WHERE id = ?", [factionId]);
  if (!faction) return { ok: false, error: "Faction not found" };
  const limits = getEffectiveLimits(factionId, faction.tier);
  const existing = query("SELECT * FROM faction_fleet_vehicles WHERE faction_id = ?", [factionId]);
  const currentTotal = existing.reduce((sum, v) => sum + v.quantity, 0);
  if (existing.length >= limits.maxTypes && !existing.find(v => v.vehicle_name === vehicleName)) {
    return { ok: false, error: `Faction is at max types (${limits.maxTypes})` };
  }
  if (currentTotal + quantity > limits.maxTotal) {
    return { ok: false, error: `Total ${currentTotal + quantity} exceeds max ${limits.maxTotal}` };
  }
  run("INSERT INTO faction_fleet_vehicles (faction_id, vehicle_name, quantity, notes, created_by) VALUES (?, ?, ?, ?, ?)",
    [factionId, vehicleName, quantity, notes || '', actor.name]);
  run("INSERT OR IGNORE INTO fleet_vehicle_catalog (vehicle_name) VALUES (?)", [vehicleName]);
  run("UPDATE fleet_vehicle_catalog SET use_count = use_count + 1 WHERE vehicle_name = ?", [vehicleName]);
  run("INSERT INTO faction_history (faction_id, action_type, details, authorized_by, created_at) VALUES (?, 'FLEET', ?, ?, datetime('now'))",
    [factionId, `Added ${quantity}x ${vehicleName} to fleet`, actor.name]);
  logAudit(actor.id, actor.name, 'CREATE', 'fleet_vehicle', null, faction.name, `${vehicleName} x${quantity}`);
  return { ok: true };
}

export async function editFleetVehicle(vehicleId, quantity, notes) {
  const actor = await requireActor(3);
  const vehicle = queryOne("SELECT * FROM faction_fleet_vehicles WHERE id = ?", [vehicleId]);
  if (!vehicle) return { ok: false, error: "Vehicle not found" };
  const faction = queryOne("SELECT name, tier FROM factions WHERE id = ?", [vehicle.faction_id]);
  const limits = getEffectiveLimits(vehicle.faction_id, faction.tier);
  const others = query("SELECT * FROM faction_fleet_vehicles WHERE faction_id = ? AND id != ?", [vehicle.faction_id, vehicleId]);
  const otherTotal = others.reduce((sum, v) => sum + v.quantity, 0);
  if (otherTotal + quantity > limits.maxTotal) {
    return { ok: false, error: `Total would exceed max ${limits.maxTotal}` };
  }
  run("UPDATE faction_fleet_vehicles SET quantity = ?, notes = ? WHERE id = ?", [quantity, notes || '', vehicleId]);
  run("INSERT INTO faction_history (faction_id, action_type, details, authorized_by, created_at) VALUES (?, 'FLEET', ?, ?, datetime('now'))",
    [vehicle.faction_id, `Updated ${vehicle.vehicle_name} quantity: ${vehicle.quantity} → ${quantity}`, actor.name]);
  logAudit(actor.id, actor.name, 'EDIT', 'fleet_vehicle', vehicleId, faction.name, `${vehicle.vehicle_name} ${vehicle.quantity}→${quantity}`);
  return { ok: true };
}

export async function deleteFleetVehicle(vehicleId) {
  const actor = await requireActor(3);
  const vehicle = queryOne("SELECT v.*, f.name as faction_name FROM faction_fleet_vehicles v JOIN factions f ON v.faction_id = f.id WHERE v.id = ?", [vehicleId]);
  if (!vehicle) return { ok: false };
  run("DELETE FROM faction_fleet_vehicles WHERE id = ?", [vehicleId]);
  run("INSERT INTO faction_history (faction_id, action_type, details, authorized_by, created_at) VALUES (?, 'FLEET', ?, ?, datetime('now'))",
    [vehicle.faction_id, `Removed ${vehicle.vehicle_name} (was ${vehicle.quantity}x)`, actor.name]);
  logAudit(actor.id, actor.name, 'DELETE', 'fleet_vehicle', vehicleId, vehicle.faction_name, vehicle.vehicle_name);
  return { ok: true };
}

export async function addFleetGarage(factionId, name, x, y, z, notes) {
  const actor = await requireActor(3);
  const faction = queryOne("SELECT name, tier FROM factions WHERE id = ?", [factionId]);
  if (!faction) return { ok: false, error: "Faction not found" };
  const limits = getEffectiveLimits(factionId, faction.tier);
  const existing = query("SELECT COUNT(*) as c FROM faction_fleet_garages WHERE faction_id = ?", [factionId])[0];
  if (existing.c >= limits.maxGarages) {
    return { ok: false, error: `Faction is at max garages (${limits.maxGarages})` };
  }
  run("INSERT INTO faction_fleet_garages (faction_id, name, x, y, z, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [factionId, name, x, y, z, notes || '', actor.name]);
  run("INSERT INTO faction_history (faction_id, action_type, details, authorized_by, created_at) VALUES (?, 'FLEET', ?, ?, datetime('now'))",
    [factionId, `Added garage: ${name} (${x}, ${y}, ${z})`, actor.name]);
  logAudit(actor.id, actor.name, 'CREATE', 'fleet_garage', null, faction.name, name);
  return { ok: true };
}

export async function editFleetGarage(garageId, name, x, y, z, notes) {
  const actor = await requireActor(3);
  const garage = queryOne("SELECT g.*, f.name as faction_name FROM faction_fleet_garages g JOIN factions f ON g.faction_id = f.id WHERE g.id = ?", [garageId]);
  if (!garage) return { ok: false };
  run("UPDATE faction_fleet_garages SET name=?, x=?, y=?, z=?, notes=? WHERE id=?",
    [name, x, y, z, notes || '', garageId]);
  run("INSERT INTO faction_history (faction_id, action_type, details, authorized_by, created_at) VALUES (?, 'FLEET', ?, ?, datetime('now'))",
    [garage.faction_id, `Updated garage: ${name} (${x}, ${y}, ${z})`, actor.name]);
  logAudit(actor.id, actor.name, 'EDIT', 'fleet_garage', garageId, garage.faction_name, name);
  return { ok: true };
}

export async function deleteFleetGarage(garageId) {
  const actor = await requireActor(3);
  const garage = queryOne("SELECT g.*, f.name as faction_name FROM faction_fleet_garages g JOIN factions f ON g.faction_id = f.id WHERE g.id = ?", [garageId]);
  if (!garage) return { ok: false };
  run("DELETE FROM faction_fleet_garages WHERE id = ?", [garageId]);
  run("INSERT INTO faction_history (faction_id, action_type, details, authorized_by, created_at) VALUES (?, 'FLEET', ?, ?, datetime('now'))",
    [garage.faction_id, `Removed garage: ${garage.name}`, actor.name]);
  logAudit(actor.id, actor.name, 'DELETE', 'fleet_garage', garageId, garage.faction_name, garage.name);
  return { ok: true };
}

export async function setFleetOverride(factionId, maxTypes, maxTotal, maxGarages, reason) {
  const actor = await requireActor(3);
  const faction = queryOne("SELECT name, tier FROM factions WHERE id = ?", [factionId]);
  if (!faction) return { ok: false };
  const existing = queryOne("SELECT id FROM faction_fleet_config WHERE faction_id = ?", [factionId]);
  if (existing) {
    run("UPDATE faction_fleet_config SET max_types=?, max_total=?, max_garages=?, override_reason=?, overridden_by=?, overridden_at=datetime('now'), updated_at=datetime('now') WHERE faction_id=?",
      [maxTypes, maxTotal, maxGarages, reason || '', actor.name, factionId]);
  } else {
    run("INSERT INTO faction_fleet_config (faction_id, max_types, max_total, max_garages, override_reason, overridden_by, overridden_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
      [factionId, maxTypes, maxTotal, maxGarages, reason || '', actor.name]);
  }
  run("INSERT INTO faction_history (faction_id, action_type, details, authorized_by, created_at) VALUES (?, 'FLEET', ?, ?, datetime('now'))",
    [factionId, `Fleet limits overridden: ${maxTypes} types, ${maxTotal} total, ${maxGarages} garages. Reason: ${reason || 'n/a'}`, actor.name]);
  logAudit(actor.id, actor.name, 'OVERRIDE', 'fleet_config', factionId, faction.name, `${maxTypes}/${maxTotal}/${maxGarages} — ${reason}`);
  return { ok: true };
}

export async function clearFleetOverride(factionId) {
  const actor = await requireActor(3);
  const faction = queryOne("SELECT name FROM factions WHERE id = ?", [factionId]);
  if (!faction) return { ok: false };
  run("DELETE FROM faction_fleet_config WHERE faction_id = ?", [factionId]);
  run("INSERT INTO faction_history (faction_id, action_type, details, authorized_by, created_at) VALUES (?, 'FLEET', 'Fleet override cleared — reverted to tier defaults', ?, datetime('now'))",
    [factionId, actor.name]);
  logAudit(actor.id, actor.name, 'REVOKE', 'fleet_config', factionId, faction.name, 'Override cleared');
  return { ok: true };
}

export async function getFleetTierDefaults() {
  await requireActor(1);
  return TIER_DEFAULTS;
}
