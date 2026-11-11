"use server";
import { revalidatePath } from "next/cache";
import { query, queryOne, run, transaction } from "../../../lib/db.js";
import { logAudit } from "../../../lib/audit.js";
import { sendPing, pingChannel, urls, BASE_URL } from "../../../lib/pings.js";
import { getRole } from "../../../lib/discord.js";
import { requireActor } from "../../../lib/requireActor.js";
import { isOwner } from "../../../lib/constants.js";
import { resolveFaction, writableFactionIds } from "../../../lib/access.js";
import { TIER_DEFAULTS, getEffectiveLimits, fleetState, checkFleetAdd } from "../../../lib/fleet.js";
import * as rp from "../../../../../shared/rpChanges.js";
import * as tasks from "../../../../../shared/tasks.js";
import { str, toInt, toNum, isSnowflake, fail, PROPERTY_TYPES } from "../../../../../shared/validate.js";
import { todayIso, nowIso, monthKey, parseDate, toIso } from "../../../../../shared/dates.js";

// All Operations actions are L3-only unless explicitly noted otherwise.
// Mutations validate first and return { ok:false, error } — SQLite never throws
// into the browser from here.

function bump(...paths) {
  for (const p of ['/fm/operations', '/fm/dashboard', '/v2/leadership', '/v2/admin', ...paths]) {
    try { revalidatePath(p); } catch {}
  }
}

/**
 * A faction by id, or by name (exact, then case-insensitive). The global
 * property / bot-config pickers still send names, and a typo must become an
 * error rather than a silent unassign. Archived factions are refused unless
 * `allowArchived`.
 */
function findFaction(idOrName, { allowArchived = false } = {}) {
  const v = idOrName == null ? '' : String(idOrName).trim();
  if (!v) return { error: 'Faction not found.' };
  let r = resolveFaction(v, { allowArchived: true });
  let f = r.faction || queryOne("SELECT * FROM factions WHERE LOWER(name) = LOWER(?)", [v]);
  if (!f) return { error: `No faction called "${v}".` };
  if (f.archived && !allowArchived) return { error: `${f.name} is archived; restore it before making changes.`, faction: f };
  return { faction: f };
}

// ── ANALYTICS ──
export async function getAnalytics() {
  await requireActor(3);
  const stats = queryOne("SELECT * FROM v_server_analytics") || {};
  const activity = query("SELECT * FROM v_staff_activity_30d");
  return { ...stats, activity };
}

// ── PROPERTIES ──
// Reads stay global (L2+, Event Team and Lead Storytellers may look). Writes are
// L3: policy 4 makes Event Team read-only here, and policy 16 sends a faction's
// own property changes through the RP-change queue (change_type PROPERTY).
export async function getGlobalProperties() {
  await requireActor(2, {allowEventTeam: true, allowLeadStoryteller: true});
  return query(`SELECT p.id, p.date_given, COALESCE(f.name,'') AS faction, p.faction_id, COALESCE(f.archived, 0) AS faction_archived,
                       p.address, p.property_type AS type, p.is_hq, p.confiscated, p.date_confiscated, p.confiscated_by, p.current_owner, p.notes,
                       CASE WHEN p.confiscated = 1 THEN 'CONFISCATED' WHEN p.faction_id IS NULL THEN 'UNASSIGNED' WHEN COALESCE(f.archived,0) = 1 THEN 'ARCHIVED' ELSE 'ACTIVE' END AS status
                FROM properties p LEFT JOIN factions f ON p.faction_id = f.id ORDER BY p.address`);
}

function propertyType(v, isHQ) {
  const t = str(v);
  if (isHQ) return 'HQ';
  if (!t || t === 'HQ') return 'Property';
  return PROPERTY_TYPES.includes(t) ? t : t.slice(0, 40);
}

/** One HQ per faction: flag `propId` and un-flag the faction's others (HQ type follows the flag). */
function makeSoleHQ(factionId, propId) {
  if (!factionId) return;
  run("UPDATE properties SET is_hq = 0, property_type = CASE WHEN property_type = 'HQ' THEN 'Property' ELSE property_type END, updated_at = ? WHERE faction_id = ? AND id != ? AND is_hq = 1", [nowIso(), factionId, propId]);
}

export async function addGlobalProperty(data) {
  const actor = await requireActor(3);
  data = data && typeof data === 'object' ? data : {};
  const address = str(data.address, { max: 200 });
  if (!address) return fail('An address is required.');
  let faction = null;
  if (str(data.faction) || data.factionId) {
    const r = findFaction(data.factionId || data.faction);
    if (r.error) return fail(r.error);
    faction = r.faction;
  }
  const isHQ = !!data.isHQ && !!faction;
  const type = propertyType(data.type, isHQ);
  const id = Number(run("INSERT INTO properties (date_given, faction_id, address, property_type, is_hq, current_owner, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [faction ? todayIso() : null, faction?.id || null, address, type, isHQ ? 1 : 0, str(data.owner, { max: 100 }), str(data.notes, { max: 2000 })]).lastInsertRowid);
  if (isHQ) makeSoleHQ(faction.id, id);
  if (faction) {
    run("INSERT INTO faction_history (faction_id, faction_name, action_type, details, authorized_by) VALUES (?, ?, 'PROPERTY_ADDED', ?, ?)",
      [faction.id, faction.name, `${isHQ ? 'HQ' : type}: ${address}`, actor.name]);
  }
  logAudit(actor.id, actor.name, 'CREATE', 'property', id, address, faction ? `Assigned to ${faction.name}${isHQ ? ' (HQ)' : ''}` : 'Unassigned');
  bump('/fm/operations/properties');
  return { ok: true, id };
}

export async function editPropertyDetail(propId, data) {
  const actor = await requireActor(3);
  data = data && typeof data === 'object' ? data : {};
  const row = queryOne("SELECT * FROM properties WHERE id = ?", [toInt(propId)]);
  if (!row) return fail('Property not found.');
  // Partial objects keep the other fields.
  const address = data.address === undefined ? row.address : str(data.address, { max: 200 });
  if (!address) return fail('An address is required.');
  const isHQ = data.isHQ === undefined ? !!row.is_hq : !!data.isHQ;
  if (isHQ && !row.faction_id) return fail('Assign the property to a faction before making it the HQ.');
  const type = data.type === undefined && data.isHQ === undefined ? row.property_type : propertyType(data.type === undefined ? row.property_type : data.type, isHQ);
  const owner = data.owner === undefined ? row.current_owner : str(data.owner, { max: 100 });
  const notes = data.notes === undefined ? row.notes : str(data.notes, { max: 2000 });
  run("UPDATE properties SET address = ?, property_type = ?, is_hq = ?, current_owner = ?, notes = ?, updated_at = ? WHERE id = ?",
    [address, type, isHQ ? 1 : 0, owner, notes, nowIso(), row.id]);
  if (isHQ) makeSoleHQ(row.faction_id, row.id);
  logAudit(actor.id, actor.name, 'EDIT', 'property', row.id, address, `Updated property${isHQ && !row.is_hq ? ' — now the HQ' : ''}`);
  bump('/fm/operations/properties');
  return { ok: true };
}

/** `factionRef` may be an id or a name; a miss is an error, never an unassign. */
export async function assignProperty(propId, factionRef) {
  const actor = await requireActor(3);
  const row = queryOne("SELECT * FROM properties WHERE id = ?", [toInt(propId)]);
  if (!row) return fail('Property not found.');
  const r = findFaction(factionRef);
  if (r.error) return fail(r.error);
  const faction = r.faction;
  run("UPDATE properties SET faction_id = ?, date_given = ?, confiscated = 0, date_confiscated = NULL, confiscated_by = NULL, is_hq = 0, property_type = CASE WHEN property_type = 'HQ' THEN 'Property' ELSE property_type END, updated_at = ? WHERE id = ?",
    [faction.id, todayIso(), nowIso(), row.id]);
  run("INSERT INTO faction_history (faction_id, faction_name, action_type, details, authorized_by) VALUES (?, ?, 'PROPERTY_ADDED', ?, ?)",
    [faction.id, faction.name, `Assigned: ${row.address}`, actor.name]);
  logAudit(actor.id, actor.name, 'EDIT', 'property', row.id, row.address, `Assigned to ${faction.name}`);
  bump('/fm/operations/properties');
  return { ok: true };
}

export async function confiscateProperty(propId) {
  const actor = await requireActor(3);
  const row = queryOne("SELECT p.*, f.name AS faction_name FROM properties p LEFT JOIN factions f ON f.id = p.faction_id WHERE p.id = ?", [toInt(propId)]);
  if (!row) return fail('Property not found.');
  if (row.confiscated) return fail('Already confiscated.');
  run("UPDATE properties SET faction_id = NULL, is_hq = 0, property_type = CASE WHEN property_type = 'HQ' THEN 'Property' ELSE property_type END, confiscated = 1, date_confiscated = ?, confiscated_by = ?, updated_at = ? WHERE id = ?",
    [todayIso(), actor.name, nowIso(), row.id]);
  if (row.faction_id) {
    run("INSERT INTO faction_history (faction_id, faction_name, action_type, details, authorized_by) VALUES (?, ?, 'PROPERTY_CONFISCATED', ?, ?)",
      [row.faction_id, row.faction_name || '', row.address, actor.name]);
  }
  logAudit(actor.id, actor.name, 'EDIT', 'property', row.id, row.address, `Confiscated${row.faction_name ? ` from ${row.faction_name}` : ''}`);
  bump('/fm/operations/properties');
  return { ok: true };
}

export async function deleteProperty(propId) {
  const actor = await requireActor(3);
  const row = queryOne("SELECT id, address FROM properties WHERE id = ?", [toInt(propId)]);
  if (!row) return fail('Property not found.');
  run("DELETE FROM properties WHERE id = ?", [row.id]);
  logAudit(actor.id, actor.name, 'DELETE', 'property', row.id, row.address, '');
  bump('/fm/operations/properties');
  return { ok: true };
}

// ── MERIDIANDATABASE.NET ACCESS ROLES ──
export async function getMdbAccessRoles() {
  await requireActor(3);
  return query("SELECT * FROM mdb_access_roles ORDER BY role_name");
}
export async function addMdbAccessRole(data) {
  const actor = await requireActor(3);
  data = data && typeof data === 'object' ? data : {};
  const roleId = str(data.role_id);
  if (!isSnowflake(roleId)) return fail('That is not a Discord role id.');
  const r = run("INSERT OR IGNORE INTO mdb_access_roles (role_id, role_name) VALUES (?, ?)", [roleId, str(data.role_name, { max: 100 })]);
  if (!r.changes) return fail('That role is already on the list.');
  logAudit(actor.id, actor.name, 'CREATE', 'mdb_role', Number(r.lastInsertRowid), str(data.role_name) || roleId, roleId);
  return { ok: true };
}
export async function deleteMdbAccessRole(id) {
  const actor = await requireActor(3);
  const row = queryOne("SELECT * FROM mdb_access_roles WHERE id = ?", [toInt(id)]);
  if (!row) return fail('Not found.');
  run("DELETE FROM mdb_access_roles WHERE id = ?", [row.id]);
  logAudit(actor.id, actor.name, 'DELETE', 'mdb_role', row.id, row.role_name || row.role_id, '');
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
// Optional snowflake field: '' when blank, error text when malformed.
function optSnowflake(v, label) {
  const s = str(v);
  if (!s) return { value: '' };
  return isSnowflake(s) ? { value: s } : { error: `${label} is not a Discord id.` };
}
function botConfigFields(data) {
  const out = {};
  for (const [k, label] of [['access_role_id', 'Access role'], ['comms_channel_id', 'Comms channel'], ['faction_channel_id', 'Faction channel']]) {
    const r = optSnowflake(data[k], label);
    if (r.error) return { error: r.error };
    out[k] = r.value;
  }
  out.guild_name = str(data.guild_name, { max: 100 });
  out.access_role_name = str(data.access_role_name, { max: 100 });
  out.comms_channel_name = str(data.comms_channel_name, { max: 100 });
  out.faction_channel_name = str(data.faction_channel_name, { max: 100 });
  out.faction_id = null;
  if (str(data.faction) || data.faction_id) {
    const f = findFaction(data.faction_id || data.faction, { allowArchived: true });
    if (f.error) return { error: f.error };
    out.faction_id = f.faction.id;
  }
  return { fields: out };
}
export async function addBotServerConfig(data) {
  const actor = await requireActor(3);
  data = data && typeof data === 'object' ? data : {};
  const guildId = str(data.guild_id);
  if (!isSnowflake(guildId)) return fail('A Discord server id is required.');
  const existing = queryOne("SELECT id FROM bot_server_configs WHERE guild_id=?", [guildId]);
  if (existing) return { ok: false, error: 'Server already configured.' };
  const v = botConfigFields(data);
  if (v.error) return fail(v.error);
  const f = v.fields;
  const result = run(
    "INSERT INTO bot_server_configs (guild_id, guild_name, faction_id, access_role_id, access_role_name, comms_channel_id, comms_channel_name, faction_channel_id, faction_channel_name) VALUES (?,?,?,?,?,?,?,?,?)",
    [guildId, f.guild_name, f.faction_id, f.access_role_id, f.access_role_name, f.comms_channel_id, f.comms_channel_name, f.faction_channel_id, f.faction_channel_name]);
  const newId = Number(result.lastInsertRowid);
  logAudit(actor.id, actor.name, 'CREATE', 'bot_config', newId, f.guild_name || guildId, '');
  const guildName = f.guild_name || guildId;
  backfillGuildPings(guildId, guildName, newId, []).catch(e => console.error('[BACKFILL]', e.message));
  return { ok: true, id: newId };
}
export async function updateBotServerConfig(id, data) {
  const actor = await requireActor(3);
  data = data && typeof data === 'object' ? data : {};
  const row = queryOne("SELECT * FROM bot_server_configs WHERE id = ?", [toInt(id)]);
  if (!row) return fail('Server config not found.');
  const v = botConfigFields(data);
  if (v.error) return fail(v.error);
  const f = v.fields;
  run(`UPDATE bot_server_configs SET guild_name=?, faction_id=?, access_role_id=?, access_role_name=?,
       comms_channel_id=?, comms_channel_name=?, faction_channel_id=?, faction_channel_name=? WHERE id=?`,
    [f.guild_name, f.faction_id, f.access_role_id, f.access_role_name, f.comms_channel_id, f.comms_channel_name, f.faction_channel_id, f.faction_channel_name, row.id]);
  logAudit(actor.id, actor.name, 'EDIT', 'bot_config', row.id, f.guild_name || row.guild_id, '');
  return { ok: true };
}
export async function deleteBotServerConfig(id) {
  const actor = await requireActor(3);
  const row = queryOne("SELECT * FROM bot_server_configs WHERE id = ?", [toInt(id)]);
  if (!row) return fail('Server config not found.');
  transaction(() => {
    run("DELETE FROM bot_watch_roles WHERE config_id=?", [row.id]);
    run("DELETE FROM bot_server_configs WHERE id=?", [row.id]);
  });
  logAudit(actor.id, actor.name, 'DELETE', 'bot_config', row.id, row.guild_name || row.guild_id, '');
  return { ok: true };
}
export async function addBotWatchRole(data) {
  const actor = await requireActor(3);
  data = data && typeof data === 'object' ? data : {};
  const roleId = str(data.role_id);
  if (!isSnowflake(roleId)) return fail('That is not a Discord role id.');
  const cfg = queryOne("SELECT id, guild_id, guild_name FROM bot_server_configs WHERE id = ?", [toInt(data.config_id)]);
  if (!cfg) return fail('Server config not found.');
  if (queryOne("SELECT 1 FROM bot_watch_roles WHERE config_id = ? AND role_id = ?", [cfg.id, roleId])) return fail('That role is already monitored.');
  const roleName = str(data.role_name, { max: 100 });
  const ins = run("INSERT INTO bot_watch_roles (config_id, role_id, role_name) VALUES (?,?,?)", [cfg.id, roleId, roleName]);
  logAudit(actor.id, actor.name, 'CREATE', 'bot_watch_role', Number(ins.lastInsertRowid), roleName || roleId, `Server ${cfg.guild_name || cfg.guild_id}`);
  // Backfill last 150 messages for this specific new role in the background
  backfillGuildPings(cfg.guild_id, cfg.guild_name, cfg.id, [{ role_id: roleId, role_name: roleName }])
    .catch(e => console.error('[BACKFILL]', e.message));
  return { ok: true };
}
export async function deleteBotWatchRole(id) {
  const actor = await requireActor(3);
  const row = queryOne("SELECT * FROM bot_watch_roles WHERE id = ?", [toInt(id)]);
  if (!row) return fail('Watch role not found.');
  run("DELETE FROM bot_watch_roles WHERE id=?", [row.id]);
  logAudit(actor.id, actor.name, 'DELETE', 'bot_watch_role', row.id, row.role_name || row.role_id, '');
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
function importFields(data, row = {}) {
  const name = data.name === undefined ? row.name : str(data.name, { max: 100 });
  if (!name) return { error: 'A name is required.' };
  return { fields: {
    name,
    category: data.category === undefined ? (row.category || 'General') : (str(data.category, { max: 50 }) || 'General'),
    tier: data.tier === undefined ? (row.tier ?? '1') : String(toInt(data.tier, { min: 0, max: 9, def: toInt(row.tier, { def: 1 }) })),
    price: data.price === undefined ? (row.price || '') : str(data.price, { max: 50 }),
    import_time: data.importTime === undefined ? (row.import_time || '') : str(data.importTime, { max: 50 }),
    shipment_power: data.shipmentPower === undefined ? (row.shipment_power || '') : str(data.shipmentPower, { max: 50 }),
  } };
}
export async function addImportItem(data) {
  const actor = await requireActor(3);
  const v = importFields(data && typeof data === 'object' ? data : {});
  if (v.error) return fail(v.error);
  const f = v.fields;
  const ins = run("INSERT INTO import_items (name, category, tier, price, import_time, shipment_power) VALUES (?, ?, ?, ?, ?, ?)",
    [f.name, f.category, f.tier, f.price, f.import_time, f.shipment_power]);
  logAudit(actor.id, actor.name, 'CREATE', 'import_item', Number(ins.lastInsertRowid), f.name, `T${f.tier} ${f.category}`);
  return { ok: true, id: Number(ins.lastInsertRowid) };
}
export async function editImportItem(id, data) {
  const actor = await requireActor(3);
  const row = queryOne("SELECT * FROM import_items WHERE id = ?", [toInt(id)]);
  if (!row) return fail('Import item not found.');
  const v = importFields(data && typeof data === 'object' ? data : {}, row);
  if (v.error) return fail(v.error);
  const f = v.fields;
  run("UPDATE import_items SET name=?, category=?, tier=?, price=?, import_time=?, shipment_power=? WHERE id=?",
    [f.name, f.category, f.tier, f.price, f.import_time, f.shipment_power, row.id]);
  logAudit(actor.id, actor.name, 'EDIT', 'import_item', row.id, f.name, '');
  return { ok: true };
}
export async function deleteImportItem(itemId, opts) {
  const actor = await requireActor(3);
  const row = queryOne("SELECT * FROM import_items WHERE id = ?", [toInt(itemId)]);
  if (!row) return fail('Import item not found.');
  const losing = query(`SELECT f.id, f.name FROM faction_imports fi JOIN factions f ON f.id = fi.faction_id
                        WHERE fi.item_id = ? AND fi.permitted = 1 ORDER BY f.name`, [row.id]);
  if (losing.length && !(opts && opts.confirmRevoke === true)) {
    return fail(`"${row.name}" is permitted to ${losing.length} faction${losing.length === 1 ? '' : 's'} (${losing.map(f => f.name).join(', ')}). Confirm that you want to revoke it from all of them.`, { needsConfirm: true, factions: losing.map(f => f.name) });
  }
  transaction(() => {
    for (const f of losing) {
      run("INSERT INTO faction_history (faction_id, faction_name, action_type, details, authorized_by, created_at) VALUES (?, ?, 'IMPORT_REVOKED', ?, ?, ?)",
        [f.id, f.name, `Import "${row.name}" (T${row.tier}) removed from the catalog — permission revoked`, actor.name, nowIso()]);
    }
    run("DELETE FROM faction_imports WHERE item_id = ?", [row.id]);
    run("DELETE FROM import_items WHERE id = ?", [row.id]);
  });
  logAudit(actor.id, actor.name, 'DELETE', 'import_item', row.id, row.name,
    losing.length ? `Revoked from ${losing.length} faction(s): ${losing.map(f => f.name).join(', ')}` : 'No faction had it');
  return { ok: true, revoked: losing.map(f => f.name) };
}

// ── DELETION REQUESTS ──
export async function getPendingDeletions() {
  await requireActor(3);
  return query("SELECT * FROM deletion_requests WHERE status='PENDING' ORDER BY created_at DESC");
}
const DELETION_TABLES = { scene_log: 'scene_logs', intel_note: 'intel_notes', ooc_note: 'ooc_notes', member: 'faction_members' };
export async function resolveDeletion(reqId, approve) {
  const actor = await requireActor(3);
  const req = queryOne("SELECT * FROM deletion_requests WHERE id=?", [toInt(reqId)]);
  if (!req) return fail('Deletion request not found.');
  if (req.status !== 'PENDING') return fail(`Already ${String(req.status).toLowerCase()}.`);
  let detail = '';
  if (approve) {
    if (req.content_type === 'task') {
      // Tasks are never hard-deleted (policy 10): a deletion request removes it from view.
      const r = run("UPDATE tasks SET status = 'removed', updated_at = ? WHERE task_uid = ? OR id = ?", [nowIso(), String(req.target_row_id || ''), toInt(req.target_row_id, { def: -1 })]);
      detail = r.changes ? 'Task removed from view' : 'Task was already gone';
    } else {
      const tbl = DELETION_TABLES[req.content_type];
      if (!tbl) return fail(`Deletion requests for "${req.content_type}" cannot be approved from here.`);
      if (!req.target_row_id) return fail('This request names no record to delete.');
      const r = run(`DELETE FROM ${tbl} WHERE id=?`, [req.target_row_id]);
      detail = r.changes ? `Deleted ${tbl} #${req.target_row_id}` : `${tbl} #${req.target_row_id} was already gone`;
    }
  }
  run("UPDATE deletion_requests SET status=?, resolved_by=?, resolved_at=? WHERE id=?",
    [approve ? 'APPROVED' : 'REJECTED', actor.name, nowIso(), req.id]);
  logAudit(actor.id, actor.name, approve ? 'APPROVE' : 'REJECT', 'deletion_request', req.id, req.content_type, detail);
  bump();
  return { ok: true };
}

// ── PENDING RP CHANGES ──
// The pipeline itself lives in shared/rpChanges.js (the bot's rpc:* buttons call
// the same functions). These are thin wrappers: gate → shared → revalidate.
export async function getPendingExecutions() {
  await requireActor(3);
  return rp.pendingExecutions();
}
export async function deleteRPChange(execId, reason) {
  const actor = await requireActor(3);
  const r = await rp.deleteRPChange(actor, execId, reason);
  if (r.ok) bump('/fm/operations/analytics');
  return r;
}

export async function approveRPChange(execId) {
  const actor = await requireActor(3);
  const r = await rp.approveRPChange(actor, execId);
  if (r.ok) bump('/fm/operations/analytics');
  return r;
}

export async function denyRPChange(execId, reason) {
  const actor = await requireActor(3);
  const r = await rp.denyRPChange(actor, execId, reason);
  if (r.ok) bump('/fm/operations/analytics');
  return r;
}

// Level 0 = any signed-in staffer: the shared function checks requester identity.
export async function resubmitRPChange(execId, note) {
  const actor = await requireActor(0);
  const r = await rp.resubmitRPChange(actor, execId, note);
  if (r.ok) bump('/fm/operations/analytics');
  return r;
}

export async function markRPDone(execId, note) {
  const actor = await requireActor(0);
  const r = await rp.markRPDone(actor, execId, note);
  if (r.ok) bump('/fm/operations/analytics');
  return r;
}

// Requesters include Event Team / Lead Storytellers (requestRPChange allows them),
// so they must be able to see and act on their own requests.
export async function getMyRPRequests() {
  const actor = await requireActor(0);
  return rp.myRequests(actor.id);
}

/** What Execute would rewrite — shown before the commit on both surfaces. */
export async function getRPExecutionPreview(execId, data) {
  await requireActor(3);
  return rp.executionPreview(execId, data || {});
}

export async function executeRPChange(execId, data) {
  const actor = await requireActor(3);
  const r = await rp.executeRPChange(actor, execId, data || {});
  if (r.ok) bump('/fm/operations/analytics', '/fm/operations/properties', '/fm/storytelling/network', '/v2/story');
  return r;
}

// Level 0 = any signed-in staffer: the shared function only lets the requester
// or L3 verify, and only an EXECUTED, not-yet-verified row.
export async function verifyRPChange(execId, note) {
  const actor = await requireActor(0);
  const r = await rp.verifyRPChange(actor, execId, note);
  if (r.ok) bump('/fm/operations/analytics');
  return r;
}

/**
 * Executed RP changes nobody has confirmed in game yet. L3 sees all; L2 sees
 * the ones for factions their team leads plus the ones they requested
 * themselves. Rows older than 48h carry overdue: true.
 */
export async function getUnverifiedExecutions() {
  const actor = await requireActor(2);
  const scope = writableFactionIds(actor);
  return rp.unverifiedExecutions()
    .filter(r => scope === null || scope.has(r.faction_id) || r.requester_id === actor.id)
    .map(r => ({ ...r, overdue: r.hours_since_executed >= VERIFY_OVERDUE_HOURS }));
}

// ── LEADERSHIP QUEUE ──
// One list of everything waiting on leadership, grouped by kind, for the v2
// Leadership › Queue tab (and the Home counts). Reads only; every action an
// item offers is the existing gated mutation for that record.
const VERIFY_OVERDUE_HOURS = 48;
const QUEUE_KINDS = ['approval', 'execute', 'verify', 'feedback', 'deletion', 'question', 'task', 'promotion'];
// Hrefs are paths into /v2 (the shared urls.* are absolute; the dashboard links relatively).
const v2Path = (abs) => String(abs || '').replace(BASE_URL, '') || '/v2';
function queueItem(kind, id, title, { faction = '', factionId = null, since = null, href = '/v2', actor = '', ...extra } = {}) {
  const sinceIso = since ? toIso(since) : null;
  const ageDays = sinceIso ? Math.max(0, Math.floor((Date.now() - parseDate(sinceIso).getTime()) / 86400000)) : 0;
  return { kind, id, title, faction, factionId, ageDays, since: sinceIso, href, actor, ...extra };
}

/**
 * { items: [{ kind, id, title, faction, factionId, ageDays, since, href, actor, ... }], counts }
 * kind ∈ approval | execute | verify | feedback | deletion | question | task | promotion.
 * L3 sees everything. L2 sees items for the factions their team leads (lib/
 * access.js writableFactionIds) plus verifications they requested and questions
 * on tasks they created; deletion requests and leadership-role tasks are L3 only.
 */
export async function getLeadershipQueue() {
  const actor = await requireActor(2);
  const isL3 = actor.level >= 3;
  const scope = writableFactionIds(actor);            // null = unscoped (L3 / Event Team)
  const inScope = (factionId) => scope === null || scope.has(Number(factionId));
  const items = [];

  // RP changes: PENDING → approval, RP_DONE → execute, EXECUTED+unverified → verify.
  const rpRows = query(`SELECT pe.*, f.name AS faction_name, f.archived AS faction_archived FROM pending_executions pe JOIN factions f ON f.id = pe.faction_id
    WHERE pe.status IN ('PENDING', 'RP_DONE') OR (pe.status = 'EXECUTED' AND pe.verified_at IS NULL) ORDER BY pe.created_at ASC`);
  for (const r of rpRows) {
    const title = `${r.execution_type}: ${r.old_value} → ${r.new_value}`;
    const base = { faction: r.faction_name, factionId: r.faction_id, href: v2Path(urls.approvals()), actor: r.requested_by, status: r.status, requesterId: r.requester_id, executionType: r.execution_type };
    if (r.status === 'PENDING' && inScope(r.faction_id)) items.push(queueItem('approval', r.id, title, { ...base, since: r.created_at }));
    else if (r.status === 'RP_DONE' && inScope(r.faction_id)) items.push(queueItem('execute', r.id, title, { ...base, since: r.created_at, note: r.rp_note || '' }));
    else if (r.status === 'EXECUTED' && (inScope(r.faction_id) || r.requester_id === actor.id)) {
      const executedAt = r.resolved_at || r.created_at;
      const hours = Math.max(0, Math.floor((Date.now() - (parseDate(executedAt)?.getTime() || Date.now())) / 3600000));
      items.push(queueItem('verify', r.id, title, { ...base, since: executedAt, overdue: hours >= VERIFY_OVERDUE_HOURS, hoursSinceExecuted: hours, canVerify: isL3 || r.requester_id === actor.id }));
    }
  }

  // Feedback: this month's confirmed reviews whose feedback has not gone out.
  const month = monthKey();
  for (const r of query(`SELECT fr.*, f.name AS fname FROM faction_reviews fr JOIN factions f ON f.id = fr.faction_id
      WHERE fr.review_month = ? AND fr.status LIKE 'Confirmed %' AND fr.feedback_sent_at IS NULL AND f.archived = 0 ORDER BY fr.updated_at ASC`, [month])) {
    if (!inScope(r.faction_id)) continue;
    items.push(queueItem('feedback', r.id, `Send ${month} feedback — ${r.status}`, { faction: r.fname, factionId: r.faction_id, since: r.updated_at || r.created_at, href: v2Path(urls.faction(r.fname, 'review')), actor: r.reviewer_name || r.submitted_by, reviewMonth: month, status: r.status }));
  }

  // Deletion requests (resolving is L3 only).
  if (isL3) {
    for (const d of query("SELECT * FROM deletion_requests WHERE status = 'PENDING' ORDER BY created_at ASC")) {
      items.push(queueItem('deletion', d.id, `Delete ${d.content_type}: ${(d.original_text || '').slice(0, 90)}`, { since: d.created_at, href: v2Path(urls.approvals()), actor: d.requested_by, contentType: d.content_type }));
    }
  }

  // Unanswered questions on open tasks (the creator answers; L3 may too).
  for (const q of query(`SELECT q.*, t.description, t.created_by_id, t.created_by_name, t.target_type, t.target_id FROM task_questions q JOIN tasks t ON t.task_uid = q.task_uid
      WHERE q.answer IS NULL AND t.status = 'open' ORDER BY q.asked_at ASC`)) {
    if (!isL3 && q.created_by_id !== actor.id) continue;
    items.push(queueItem('question', q.id, q.question, { since: q.asked_at, href: v2Path(urls.task(q.task_uid)), actor: q.asked_by_name, taskUid: q.task_uid, taskDescription: q.description, creator: q.created_by_name }));
  }

  // Unclaimed tasks addressed to the leadership roles.
  if (isL3) {
    const r = tasks.roleIds();
    const roles = [r.leadership, r.gameAffairs].filter(Boolean);
    if (roles.length) {
      const ph = roles.map(() => '?').join(',');
      for (const t of query(`SELECT * FROM tasks WHERE status = 'open' AND target_type = 'Role' AND target_id IN (${ph}) AND (claimed_by = 'None' OR claimed_by = '') ORDER BY created_at ASC`, roles)) {
        items.push(queueItem('task', t.task_uid, t.description, { since: t.created_at, href: v2Path(urls.task(t.task_uid)), actor: t.created_by_name, targetLabel: t.target_id === r.gameAffairs ? 'Game Affairs' : 'FM Leadership' }));
      }
    }
  }

  // Staged promotions waiting to be completed after the RP.
  for (const f of query("SELECT id, name, tier, pending_promo, updated_at FROM factions WHERE pending_promo IS NOT NULL AND archived = 0 ORDER BY name")) {
    if (!inScope(f.id)) continue;
    let p = null; try { p = JSON.parse(f.pending_promo); } catch { p = f.pending_promo; }
    const tier = toInt(p && typeof p === 'object' ? p.tier : p, { min: 0, max: 9 });
    const staged = queryOne("SELECT created_at FROM faction_history WHERE faction_id = ? AND action_type = 'PROMO_STAGED' ORDER BY created_at DESC, id DESC LIMIT 1", [f.id]);
    items.push(queueItem('promotion', f.id, `Promotion staged: T${f.tier} → T${tier ?? '?'}`, { faction: f.name, factionId: f.id, since: staged?.created_at || f.updated_at, href: v2Path(urls.faction(f.name, 'review')), actor: '', currentTier: f.tier, targetTier: tier }));
  }

  const order = Object.fromEntries(QUEUE_KINDS.map((k, i) => [k, i]));
  items.sort((a, b) => (order[a.kind] - order[b.kind]) || (b.ageDays - a.ageDays));
  const counts = Object.fromEntries(QUEUE_KINDS.map(k => [k, 0]));
  for (const it of items) counts[it.kind]++;
  counts.total = items.length;
  counts.stale = items.filter(it => it.ageDays >= 7).length;
  return { items, counts };
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
  await requireActor(3);
  return query("SELECT * FROM sync_status ORDER BY label, job");
}

export async function getAuditLog(limit) {
  await requireActor(3);
  return query("SELECT * FROM site_audit_log ORDER BY timestamp DESC LIMIT ?", [toInt(limit, { min: 1, max: 1000, def: 200 })]);
}
export async function deleteAuditLogEntry(entryId) {
  const actor = await requireActor(3);
  // An audit trail you can prune isn't an audit trail — owner only (2026-08-04).
  if (!isOwner(actor.id) && !isOwner(actor._realId)) return fail('Owner only');
  const id = toInt(entryId);
  if (!id) return fail('Audit entry not found.');
  const res = run("DELETE FROM site_audit_log WHERE id = ?", [id]);
  if (!res.changes) return fail('Audit entry not found.');
  logAudit(actor.id, actor.name, 'DELETE', 'audit_log', id, '', 'Audit entry pruned');
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
// Tasks delegate to shared/tasks.js (the one lifecycle, also used by the bot);
// the workspace list keeps its "addressed to me / my team / leadership" filter
// on top of the shared visibility rule.
export async function getLeadershipTasks() {
  const actor = await requireActor(3);
  const r = tasks.roleIds();
  const mine = new Set([actor.id, actor.teamId, r.leadership, r.gameAffairs, r.lead].filter(Boolean));
  return tasks.visibleTasks(actor)
    .filter(t => mine.has(t.target_id) || t.claimed_by === actor.id)
    .map(t => tasks.decorate(t));
}

export async function getLeadershipReminders() {
  const actor = await requireActor(3);
  const discordId = actor.id;
  const ids = new Set([getRole('fm_leadership'), getRole('game_affairs'), getRole('fm_team_lead'), actor.teamId].filter(Boolean));
  const all = query("SELECT * FROM reminders WHERE status IN ('ACTIVE','WARNED') ORDER BY epoch_ms");
  const names = new Map(query("SELECT discord_id, display_name FROM staff").map(s => [s.discord_id, s.display_name]));
  return all.filter(r => {
    if (r.author_id === discordId) return true;
    const roleMatch = r.target_tag?.match(/<@&(\d+)>/);
    const userMatch = r.target_tag?.match(/<@(\d+)>/);
    if (userMatch && userMatch[1] === discordId) return true;
    if (roleMatch && ids.has(roleMatch[1])) return true;
    return false;
  }).map(r => ({ ...r, authorName: names.get(r.author_id) || r.author_id, epochMs: parseInt(r.epoch_ms) }));
}

export async function createLeadershipTask(data) {
  const actor = await requireActor(3);
  data = data && typeof data === 'object' ? data : {};
  const r = await tasks.createTask(actor, { desc: data.desc, targetType: data.targetType, targetId: data.targetId, enableDM: !!data.enableDM }, { via: 'Leadership workspace' });
  if (r.ok) bump('/fm/leadership', '/v2/tasks');
  return r;
}

export async function createLeadershipReminder(data) {
  const actor = await requireActor(3);
  data = data && typeof data === 'object' ? data : {};
  const message = str(data.message, { max: 1000 });
  if (!message) return fail('A message is required.');
  const epochMs = toInt(data.epochMs);
  if (!epochMs || epochMs < Date.now() - 60000) return fail('Pick a time in the future.');
  const targetType = data.targetType === 'User' ? 'User' : 'Role';
  const targetId = str(data.targetId);
  if (!isSnowflake(targetId) && !queryOne("SELECT 1 FROM teams WHERE team_id = ?", [targetId])) return fail('Pick a target.');
  if (targetType === 'User' && !queryOne("SELECT 1 FROM staff WHERE discord_id = ?", [targetId])) return fail('That person is not on the staff roster.');
  const uuid = Math.random().toString(36).substring(2, 8);
  const targetTag = targetType === 'Role' ? `<@&${targetId}>` : `<@${targetId}>`;
  const routeToLeadership = targetType === 'Role' && (targetId === getRole('fm_leadership') || targetId === getRole('game_affairs'));
  const ch = pingChannel('event.created', { alt: routeToLeadership, ignoreEnabled: true });
  run("INSERT INTO reminders (uuid, author_id, channel_id, message, epoch_ms, readable_time, repeat_rule, target_tag, status) VALUES (?, ?, ?, ?, ?, ?, 'None', ?, 'ACTIVE')",
    [uuid, actor.id, ch, message, String(epochMs), new Date(epochMs).toISOString(), targetTag]);
  logAudit(actor.id, actor.name, 'CREATE', 'reminder', uuid, message.substring(0, 50), `${targetType} ${targetId} at ${new Date(epochMs).toISOString()}`);
  const epoch = Math.floor(epochMs / 1000);
  const note = str(data.note, { max: 500 });
  const embeds = [{ title: '📌 ' + (str(data.eventType, { max: 50 }) || 'Event') + ' Scheduled', description: '**Time:** <t:' + epoch + ':F> (<t:' + epoch + ':R>)' + (note ? '\n**Details:** ' + note : '') + '\n\n*Via Meridian Dashboard*', color: 0x5865F2 }];
  await sendPing('event.created', targetTag, { alt: routeToLeadership, embeds });
  bump('/fm/leadership');
  return { ok: true, uuid };
}

export async function claimLeadershipTask(taskUid, enableDM) {
  const actor = await requireActor(3);
  const r = await tasks.claimTask(actor, taskUid, { via: 'Leadership workspace' });
  if (r.ok && enableDM) run("UPDATE tasks SET next_reminder = ? WHERE task_uid = ?", [String(Date.now() + 86400000), taskUid]);
  if (r.ok) bump('/fm/leadership', '/v2/tasks');
  return r;
}

export async function completeLeadershipTask(taskUid, note) {
  const actor = await requireActor(3);
  const task = tasks.getTask(taskUid);
  const r = await tasks.completeTask(actor, taskUid, note, { via: 'Leadership workspace' });
  if (!r.ok) return r;
  bump('/fm/leadership', '/v2/tasks');
  if (task?.created_by_id === 'promotion-bot') {
    // Promotion bot tasks go to the team lead channel, not the global channel.
    const factionName = task.description.split(' — ')[0].trim();
    const fac = factionName ? queryOne("SELECT lead_discord_id, pending_promo FROM factions WHERE name = ?", [factionName]) : null;
    const leadPing = fac?.lead_discord_id ? `<@${fac.lead_discord_id}> ` : '';
    let payload = null;
    if (fac?.pending_promo) {
      try { payload = JSON.parse(fac.pending_promo); } catch { payload = null; }
      // Older rows stored just the tier number, not an object.
      if (payload !== null && typeof payload !== 'object') payload = { tier: payload };
    }
    if (payload) {
      const tierLine = payload.tier != null ? ` → Tier ${payload.tier}` : '';
      const imports = Array.isArray(payload.imports) ? payload.imports : [];
      const importsLine = imports.length > 0 ? `\n**Approved imports (${imports.length}):** ${imports.join(', ')}` : '\nNo weapon imports were approved.';
      await sendPing('promo.staged', `${leadPing}📋 **Pending Promotion** — **${factionName}**${tierLine}\nStaged by: ${actor.name}${importsLine}`);
    } else {
      await sendPing('promo.staged', `${leadPing}📋 **Pending Promotion** — **${factionName}**\nReviewed by: ${actor.name}`);
    }
  }
  return r;
}

export async function editLeadershipTask(taskUid, newDesc) {
  const actor = await requireActor(3);
  const r = await tasks.editTask(actor, taskUid, newDesc);
  if (r.ok) bump('/fm/leadership', '/v2/tasks');
  return r;
}

export async function deleteLeadershipReminder(uuid) {
  const actor = await requireActor(3);
  const r = queryOne("SELECT * FROM reminders WHERE uuid = ?", [str(uuid)]);
  if (!r) return fail('Reminder not found.');
  run("DELETE FROM reminders WHERE uuid = ?", [r.uuid]);
  logAudit(actor.id, actor.name, 'DELETE', 'reminder', r.uuid, (r.message || '').slice(0, 50), '');
  bump('/fm/leadership');
  return { ok: true };
}

export async function snoozeLeadershipReminder(uuid) {
  const actor = await requireActor(3);
  const r = queryOne("SELECT * FROM reminders WHERE uuid = ?", [str(uuid)]);
  if (!r) return fail('Reminder not found.');
  const newTime = (parseInt(r.epoch_ms) || Date.now()) + 3600000;
  run("UPDATE reminders SET epoch_ms = ?, readable_time = ?, status = 'ACTIVE' WHERE uuid = ?",
    [newTime.toString(), new Date(newTime).toISOString(), r.uuid]);
  logAudit(actor.id, actor.name, 'EDIT', 'reminder', r.uuid, (r.message || '').slice(0, 50), `Snoozed 1h → ${new Date(newTime).toISOString()}`);
  bump('/fm/leadership');
  return { ok: true, epochMs: newTime };
}

export async function getStaffForWorkspace() {
  await requireActor(3);
  return query("SELECT discord_id, display_name, team_id, team_name, rank, clearance FROM staff WHERE discord_id != '' AND discord_id NOT LIKE 'placeholder%' AND active = 1 ORDER BY display_name");
}

export async function getRoleTargetsForWorkspace() {
  await requireActor(3);
  const leadershipId = getRole('fm_leadership');
  const leadId = getRole('fm_team_lead');
  const allFmId = getRole('fm_team_guide');
  const teams = query("SELECT team_id, team_name FROM teams WHERE team_name != 'Game Affairs Management' ORDER BY team_name");
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
  const f = queryOne("SELECT id, name, archived FROM factions WHERE id=?", [toInt(id)]);
  if (!f) return fail('Faction not found.');
  if (!f.archived) return fail(`${f.name} is not archived.`);
  run("UPDATE factions SET archived=0, archived_at='', updated_at=? WHERE id=?", [nowIso(), f.id]);
  run("INSERT INTO faction_history (faction_id, faction_name, action_type, details, authorized_by) VALUES (?, ?, 'RESTORED', 'Restored from archive', ?)", [f.id, f.name, actor.name]);
  logAudit(actor.id, actor.name, 'RESTORE', 'faction', f.id, f.name, 'Restored from archive');
  bump('/fm/factions', '/v2/factions');
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
// Limits, the tier table and the "can I add this" check live in lib/fleet.js
// (shared with the vehicle catalog and v2). A type is a distinct vehicle name;
// adding a name the faction already has merges into that row.

function activeFaction(factionId) {
  const f = queryOne("SELECT id, name, tier, archived FROM factions WHERE id = ?", [toInt(factionId)]);
  if (!f) return { error: 'Faction not found.' };
  if (f.archived) return { error: `${f.name} is archived; restore it before changing its fleet.` };
  return { faction: f };
}

function fleetHistory(factionId, details, actor) {
  run("INSERT INTO faction_history (faction_id, action_type, details, authorized_by, created_at) VALUES (?, 'FLEET', ?, ?, ?)", [factionId, details, actor.name, nowIso()]);
}

export async function getFleetOverview() {
  await requireActor(3);
  const factions = query("SELECT id, name, tier FROM factions WHERE archived = 0 ORDER BY name");
  return factions.map(f => {
    const limits = getEffectiveLimits(f.id, f.tier);
    const { vehicles, typeCount, total } = fleetState(f.id);
    const garages = query("SELECT * FROM faction_fleet_garages WHERE faction_id = ? ORDER BY name", [f.id]);
    const defaults = TIER_DEFAULTS[f.tier] || TIER_DEFAULTS[1];
    return {
      id: f.id, name: f.name, tier: f.tier,
      vehicles, garages, totalQuantity: total,
      typeCount,
      limits,
      defaults: { types: defaults.types, total: defaults.total, garages: defaults.garages, stipend: defaults.stipend },
    };
  });
}

export async function getVehicleCatalog(query_str) {
  await requireActor(3);
  const q = str(query_str).toLowerCase();
  if (!q) {
    return query("SELECT vehicle_name FROM fleet_vehicle_catalog ORDER BY use_count DESC, vehicle_name LIMIT 30").map(r => r.vehicle_name);
  }
  return query("SELECT vehicle_name FROM fleet_vehicle_catalog WHERE LOWER(vehicle_name) LIKE ? ORDER BY use_count DESC, vehicle_name LIMIT 20", [`%${q}%`]).map(r => r.vehicle_name);
}

export async function addFleetVehicle(factionId, vehicleName, quantity, notes) {
  const actor = await requireActor(3);
  const a = activeFaction(factionId);
  if (a.error) return fail(a.error);
  const faction = a.faction;
  const name = str(vehicleName, { max: 80 });
  const qty = toInt(quantity, { min: 1, max: 999 });
  if (!name) return fail('A vehicle name is required.');
  if (!qty) return fail('Quantity must be a whole number of at least 1.');
  const check = checkFleetAdd(faction.id, faction.tier, name, qty);
  if (!check.ok) return check;
  const noteText = str(notes, { max: 500 });
  let id;
  transaction(() => {
    if (check.existing) {
      run("UPDATE faction_fleet_vehicles SET quantity = quantity + ?, notes = CASE WHEN ? != '' THEN ? ELSE notes END WHERE id = ?", [qty, noteText, noteText, check.existing.id]);
      id = check.existing.id;
    } else {
      const spawn = queryOne("SELECT spawn_name FROM fleet_vehicle_catalog WHERE LOWER(vehicle_name) = LOWER(?)", [name])?.spawn_name || '';
      id = Number(run("INSERT INTO faction_fleet_vehicles (faction_id, vehicle_name, quantity, notes, created_by, spawn_name) VALUES (?, ?, ?, ?, ?, ?)",
        [faction.id, check.existing?.vehicle_name || name, qty, noteText, actor.name, spawn]).lastInsertRowid);
    }
    run("INSERT OR IGNORE INTO fleet_vehicle_catalog (vehicle_name) VALUES (?)", [name]);
    run("UPDATE fleet_vehicle_catalog SET use_count = use_count + ? WHERE LOWER(vehicle_name) = LOWER(?)", [qty, name]);
    fleetHistory(faction.id, `Added ${qty}x ${name} to fleet${check.existing ? ` (now ${check.existing.quantity + qty})` : ''}`, actor);
  });
  logAudit(actor.id, actor.name, check.existing ? 'EDIT' : 'CREATE', 'fleet_vehicle', id, faction.name, `${name} +${qty}${check.existing ? ` → ${check.existing.quantity + qty}` : ''}`);
  bump('/fm/operations/fleet', '/v2/factions');
  return { ok: true, id, merged: !!check.existing };
}

export async function editFleetVehicle(vehicleId, quantity, notes) {
  const actor = await requireActor(3);
  const vehicle = queryOne("SELECT * FROM faction_fleet_vehicles WHERE id = ?", [toInt(vehicleId)]);
  if (!vehicle) return fail('Vehicle not found.');
  const a = activeFaction(vehicle.faction_id);
  if (a.error) return fail(a.error);
  const faction = a.faction;
  const qty = toInt(quantity, { min: 1, max: 999 });
  if (!qty) return fail('Quantity must be a whole number of at least 1 — remove the vehicle instead of setting 0.');
  const check = checkFleetAdd(faction.id, faction.tier, vehicle.vehicle_name, qty, { excludeId: vehicle.id });
  if (!check.ok) return check;
  const noteText = notes === undefined ? vehicle.notes : str(notes, { max: 500 });
  run("UPDATE faction_fleet_vehicles SET quantity = ?, notes = ? WHERE id = ?", [qty, noteText, vehicle.id]);
  if (qty !== vehicle.quantity) fleetHistory(faction.id, `Updated ${vehicle.vehicle_name} quantity: ${vehicle.quantity} → ${qty}`, actor);
  logAudit(actor.id, actor.name, 'EDIT', 'fleet_vehicle', vehicle.id, faction.name, `${vehicle.vehicle_name} ${vehicle.quantity}→${qty}`);
  bump('/fm/operations/fleet', '/v2/factions');
  return { ok: true };
}

export async function deleteFleetVehicle(vehicleId) {
  const actor = await requireActor(3);
  const vehicle = queryOne("SELECT v.*, f.name as faction_name FROM faction_fleet_vehicles v JOIN factions f ON v.faction_id = f.id WHERE v.id = ?", [toInt(vehicleId)]);
  if (!vehicle) return fail('Vehicle not found.');
  run("DELETE FROM faction_fleet_vehicles WHERE id = ?", [vehicle.id]);
  fleetHistory(vehicle.faction_id, `Removed ${vehicle.vehicle_name} (was ${vehicle.quantity}x)`, actor);
  logAudit(actor.id, actor.name, 'DELETE', 'fleet_vehicle', vehicle.id, vehicle.faction_name, vehicle.vehicle_name);
  bump('/fm/operations/fleet', '/v2/factions');
  return { ok: true };
}

function coords(x, y, z) {
  const out = [x, y, z].map(v => toNum(v));
  if (out.some(v => v === null)) return { error: 'Garage coordinates must be numbers (x, y, z).' };
  return { x: out[0], y: out[1], z: out[2] };
}

export async function addFleetGarage(factionId, name, x, y, z, notes) {
  const actor = await requireActor(3);
  const a = activeFaction(factionId);
  if (a.error) return fail(a.error);
  const faction = a.faction;
  const gname = str(name, { max: 80 });
  if (!gname) return fail('A garage name is required.');
  const c = coords(x, y, z);
  if (c.error) return fail(c.error);
  const limits = getEffectiveLimits(faction.id, faction.tier);
  const existing = queryOne("SELECT COUNT(*) as c FROM faction_fleet_garages WHERE faction_id = ?", [faction.id])?.c || 0;
  if (existing >= limits.maxGarages) return fail(`Faction is at max garages (${limits.maxGarages}).`);
  const id = Number(run("INSERT INTO faction_fleet_garages (faction_id, name, x, y, z, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [faction.id, gname, c.x, c.y, c.z, str(notes, { max: 500 }), actor.name]).lastInsertRowid);
  fleetHistory(faction.id, `Added garage: ${gname} (${c.x}, ${c.y}, ${c.z})`, actor);
  logAudit(actor.id, actor.name, 'CREATE', 'fleet_garage', id, faction.name, gname);
  bump('/fm/operations/fleet', '/v2/factions');
  return { ok: true, id };
}

export async function editFleetGarage(garageId, name, x, y, z, notes) {
  const actor = await requireActor(3);
  const garage = queryOne("SELECT g.*, f.name as faction_name, f.archived FROM faction_fleet_garages g JOIN factions f ON g.faction_id = f.id WHERE g.id = ?", [toInt(garageId)]);
  if (!garage) return fail('Garage not found.');
  if (garage.archived) return fail(`${garage.faction_name} is archived; restore it before changing its fleet.`);
  const gname = name === undefined ? garage.name : str(name, { max: 80 });
  if (!gname) return fail('A garage name is required.');
  const c = coords(x === undefined ? garage.x : x, y === undefined ? garage.y : y, z === undefined ? garage.z : z);
  if (c.error) return fail(c.error);
  const noteText = notes === undefined ? garage.notes : str(notes, { max: 500 });
  run("UPDATE faction_fleet_garages SET name=?, x=?, y=?, z=?, notes=? WHERE id=?", [gname, c.x, c.y, c.z, noteText, garage.id]);
  fleetHistory(garage.faction_id, `Updated garage: ${gname} (${c.x}, ${c.y}, ${c.z})`, actor);
  logAudit(actor.id, actor.name, 'EDIT', 'fleet_garage', garage.id, garage.faction_name, gname);
  bump('/fm/operations/fleet', '/v2/factions');
  return { ok: true };
}

export async function deleteFleetGarage(garageId) {
  const actor = await requireActor(3);
  const garage = queryOne("SELECT g.*, f.name as faction_name FROM faction_fleet_garages g JOIN factions f ON g.faction_id = f.id WHERE g.id = ?", [toInt(garageId)]);
  if (!garage) return fail('Garage not found.');
  run("DELETE FROM faction_fleet_garages WHERE id = ?", [garage.id]);
  fleetHistory(garage.faction_id, `Removed garage: ${garage.name}`, actor);
  logAudit(actor.id, actor.name, 'DELETE', 'fleet_garage', garage.id, garage.faction_name, garage.name);
  bump('/fm/operations/fleet', '/v2/factions');
  return { ok: true };
}

export async function setFleetOverride(factionId, maxTypes, maxTotal, maxGarages, reason) {
  const actor = await requireActor(3);
  const a = activeFaction(factionId);
  if (a.error) return fail(a.error);
  const faction = a.faction;
  const t = toInt(maxTypes, { min: 0, max: 99 }), tot = toInt(maxTotal, { min: 0, max: 999 }), g = toInt(maxGarages, { min: 0, max: 99 });
  if (t === null || tot === null || g === null) return fail('Types, total and garages must be whole numbers of 0 or more.');
  const why = str(reason, { max: 300 });
  if (!why) return fail('A reason for the override is required.');
  const existing = queryOne("SELECT id FROM faction_fleet_config WHERE faction_id = ?", [faction.id]);
  const now = nowIso();
  transaction(() => {
    if (existing) {
      run("UPDATE faction_fleet_config SET max_types=?, max_total=?, max_garages=?, override_reason=?, overridden_by=?, overridden_at=?, updated_at=? WHERE faction_id=?",
        [t, tot, g, why, actor.name, now, now, faction.id]);
    } else {
      run("INSERT INTO faction_fleet_config (faction_id, max_types, max_total, max_garages, override_reason, overridden_by, overridden_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [faction.id, t, tot, g, why, actor.name, now]);
    }
    fleetHistory(faction.id, `Fleet limits overridden: ${t} types, ${tot} total, ${g} garages. Reason: ${why}`, actor);
  });
  logAudit(actor.id, actor.name, 'OVERRIDE', 'fleet_config', faction.id, faction.name, `${t}/${tot}/${g} — ${why}`);
  bump('/fm/operations/fleet', '/v2/factions');
  return { ok: true };
}

export async function clearFleetOverride(factionId) {
  const actor = await requireActor(3);
  const faction = queryOne("SELECT id, name FROM factions WHERE id = ?", [toInt(factionId)]);
  if (!faction) return fail('Faction not found.');
  const r = run("DELETE FROM faction_fleet_config WHERE faction_id = ?", [faction.id]);
  if (!r.changes) return fail(`${faction.name} has no override to clear.`);
  fleetHistory(faction.id, 'Fleet override cleared — reverted to tier defaults', actor);
  logAudit(actor.id, actor.name, 'REVOKE', 'fleet_config', faction.id, faction.name, 'Override cleared');
  bump('/fm/operations/fleet', '/v2/factions');
  return { ok: true };
}

export async function getFleetTierDefaults() {
  await requireActor(1, { allowEventTeam: true, allowLeadStoryteller: true });
  return TIER_DEFAULTS;
}
