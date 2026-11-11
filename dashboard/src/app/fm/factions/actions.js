"use server";
// Faction actions, shared by the legacy /fm dossier and the /v2 faction hub.
//
// Every write follows the same shape: validate → requireActor → scope check
// (lib/access.js: L1/L2 may only touch factions led by their team, L3 is
// unscoped, archived factions refuse writes) → existence check → write (a
// transaction when more than one table moves) → audit row keyed by the real
// record id → ping through sendPing with a urls.* link. Faction names are never
// taken from the client: every denormalised faction_name column is filled from
// the row the id resolves to. Event Team and Lead Storyteller are read-only here.
import { query, queryOne, run, transaction } from "../../../lib/db.js";
import { logAudit } from "../../../lib/audit.js";
import { sendPing, sendDiscord, getPingRoute, rpComponents, urls } from "../../../lib/pings.js";
import { requireActor } from "../../../lib/requireActor.js";
import { assertFactionWrite, resolveFaction, canWriteFaction, writableFactionIds } from "../../../lib/access.js";
import { str, toInt, oneOf, isSnowflake, fail, RP_TYPES, PROPERTY_TYPES } from "../../../../../shared/validate.js";
import { todayIso, nowIso } from "../../../../../shared/dates.js";
import { sanitizeHtml, htmlToText } from "../leadership/_shared/sanitize.js";

// ── HELPERS ──────────────────────────────────────────────────────────────────

const RP_LABEL = { NPC: 'NPC change', HQ: 'HQ relocation', TURF: 'Turf change', PROPERTY: 'Property change', Other: 'Other' };

function history(factionId, factionName, actionType, details, by) {
  run("INSERT INTO faction_history (faction_id, faction_name, action_type, details, authorized_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [factionId, factionName, actionType, details, by, nowIso()]);
}

function leadMention(faction) {
  return faction?.lead_discord_id ? `<@${faction.lead_discord_id}> ` : '';
}

function factionLabel(id) { return queryOne("SELECT name FROM factions WHERE id = ?", [id])?.name || ''; }

// Discord display names for ids that are not on the staff roster. Looked up
// once per hour per id so a list render never fans out to the Discord API.
const nameCache = new Map();
const NAME_TTL = 60 * 60 * 1000;
async function resolveNames(ids) {
  const names = {};
  const missing = [];
  for (const id of ids) {
    if (!id || !isSnowflake(id)) continue;
    const staff = queryOne("SELECT display_name, discord_name FROM staff WHERE discord_id = ?", [id]);
    if (staff?.display_name || staff?.discord_name) { names[id] = staff.display_name || staff.discord_name; continue; }
    const hit = nameCache.get(id);
    if (hit && hit.until > Date.now()) { if (hit.name) names[id] = hit.name; continue; }
    missing.push(id);
  }
  const token = process.env.DISCORD_BOT_TOKEN;
  if (token && missing.length) {
    await Promise.all(missing.map(async (id) => {
      let name = '';
      try {
        const r = await fetch(`https://discord.com/api/v10/users/${id}`, { headers: { Authorization: `Bot ${token}` } });
        if (r.ok) { const u = await r.json(); name = u.global_name || u.username || ''; }
      } catch {}
      nameCache.set(id, { name, until: Date.now() + NAME_TTL });
      if (name) names[id] = name;
    }));
  }
  return names;
}

/** Team roster derived from staff.clearance (never from rank text). */
function teamRoster() {
  const staff = query("SELECT discord_id, display_name, discord_name, team_id, team_name, clearance FROM staff WHERE discord_id != '' AND discord_id NOT LIKE 'placeholder%' AND COALESCE(active, 1) = 1");
  const teams = {};
  const teamOf = {};
  for (const s of staff) {
    if (!s.team_id) continue;
    teamOf[s.discord_id] = s.team_id;
    const t = (teams[s.team_id] ||= { name: s.team_name || '', leads: [], guides: [] });
    if (Number(s.clearance) === 2) t.leads.push(s.discord_id);
    else if (Number(s.clearance) === 1) t.guides.push(s.discord_id);
  }
  return { teams, teamOf };
}

/**
 * Normalise factions.pending_promo. Accepts the JSON object the dashboard
 * writes ({tier, imports}), a bare tier ("4", 4, the Sheets-era value) and a
 * JSON number; returns { tier, imports } or null. A bare tier keeps the
 * faction's current import set.
 */
function parsePendingPromo(raw, currentImports = []) {
  if (raw == null || raw === '') return null;
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = raw; } }
  if (v && typeof v === 'object') {
    const tier = toInt(v.tier, { min: 0, max: 9 });
    if (tier == null) return null;
    const imports = Array.isArray(v.imports) ? v.imports.filter(x => typeof x === 'string') : [...currentImports];
    return { tier, imports };
  }
  const tier = toInt(v, { min: 0, max: 9 });
  return tier == null ? null : { tier, imports: [...currentImports] };
}

function permittedNames(factionId) {
  return query("SELECT i.name FROM faction_imports fi JOIN import_items i ON i.id = fi.item_id WHERE fi.faction_id = ? AND fi.permitted = 1 ORDER BY i.tier, i.name", [factionId]).map(r => r.name);
}

/** Set the faction's permitted import set to exactly `names` (inside a transaction). Returns { granted, revoked }. */
function applyImportSet(factionId, names) {
  const items = query("SELECT id, name FROM import_items");
  const want = new Set(names);
  const before = new Set(permittedNames(factionId));
  const granted = [], revoked = [];
  for (const item of items) {
    const permitted = want.has(item.name) ? 1 : 0;
    if (permitted && !before.has(item.name)) granted.push(item.name);
    if (!permitted && before.has(item.name)) revoked.push(item.name);
    run("INSERT INTO faction_imports (faction_id, item_id, permitted) VALUES (?, ?, ?) ON CONFLICT(faction_id, item_id) DO UPDATE SET permitted = excluded.permitted",
      [factionId, item.id, permitted]);
  }
  return { granted, revoked };
}

function propertyType(v) {
  const s = str(v);
  if (!s) return 'Property';
  return PROPERTY_TYPES.find(t => t.toLowerCase() === s.toLowerCase()) || null;
}

const ok = (extra = {}) => ({ ok: true, ...extra });

// ── FACTION LIST ──────────────────────────────────────────────────────────────

export async function getFactions() {
  let actor;
  try { actor = await requireActor(1, { allowEventTeam: true, allowLeadStoryteller: true }); }
  catch (e) { console.error("getFactions:", e.message); return []; }
  try {
    const factions = query(`SELECT f.*,
      COALESCE(sc.allTime, 0) AS allTime, COALESCE(sc.scenes30d, 0) AS scenes30d
      FROM factions f
      LEFT JOIN (SELECT faction_id, COUNT(*) AS allTime,
                        SUM(CASE WHEN created_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) AS scenes30d
                 FROM scene_logs GROUP BY faction_id) sc ON sc.faction_id = f.id
      WHERE f.archived = 0 ORDER BY f.name`);
    const { teams, teamOf } = teamRoster();
    const ids = new Set();
    factions.forEach(f => { if (f.lead_discord_id) ids.add(f.lead_discord_id); });
    Object.values(teams).forEach(t => { t.leads.forEach(id => ids.add(id)); t.guides.forEach(id => ids.add(id)); });
    const names = await resolveNames(ids);

    const authByFaction = {};
    query("SELECT fi.faction_id, i.name FROM faction_imports fi JOIN import_items i ON i.id = fi.item_id JOIN factions f ON f.id = fi.faction_id WHERE f.archived = 0 AND fi.permitted = 1 ORDER BY i.tier, i.name")
      .forEach(r => { (authByFaction[r.faction_id] ||= []).push(r.name); });
    const writable = writableFactionIds(actor);
    const canWrite = (id) => !actor.isLeadStoryteller && (writable === null || writable.has(id));

    return factions.map(f => {
      const tid = teamOf[f.lead_discord_id] || '';
      const team = teams[tid] || { name: '', leads: [], guides: [] };
      const promo = parsePendingPromo(f.pending_promo, authByFaction[f.id] || []);
      return {
        id: f.id, name: f.name, tier: f.tier, lastPromoted: f.last_promoted || 'N/A',
        leadId: f.lead_discord_id, leadName: names[f.lead_discord_id] || (f.lead_discord_id ? 'Unknown' : 'Unassigned'),
        teamId: tid, teamName: team.name,
        guidesText: team.guides.map(id => names[id] || id).join(' • ') || 'None',
        guideIds: team.guides,
        discord: f.discord_url, forum: f.forum_url, threadId: f.thread_id,
        pendingPromo: promo ? JSON.stringify(promo) : null, promo,
        authorizedItems: authByFaction[f.id] || [],
        scenes30d: f.scenes30d, allTime: f.allTime,
        forumPosts: f.forum_posts_30d || 0,
        writable: canWrite(f.id),
      };
    });
  } catch (e) { console.error("getFactions:", e); return []; }
}

// ── FACTION DETAIL ────────────────────────────────────────────────────────────

/**
 * Dossier by name or id. Archived factions are returned with `archived: true`
 * (and `writable: false`) so the hubs can render a read-only view with a banner
 * instead of a 404; every write action refuses them regardless.
 */
export async function getFactionDetail(factionName) {
  let actor;
  try { actor = await requireActor(1, { allowEventTeam: true, allowLeadStoryteller: true }); }
  catch (e) { console.error("getFactionDetail:", e.message); return null; }
  try {
    const r = resolveFaction(factionName, { allowArchived: true });
    if (r.error && !r.faction) return null;
    const f = r.faction;
    const members    = query("SELECT id, character_name, phone, residence, is_leader FROM faction_members WHERE faction_id = ? ORDER BY is_leader DESC, character_name", [f.id]);
    const properties = query("SELECT id, address, is_hq, property_type FROM properties WHERE faction_id = ? ORDER BY is_hq DESC, address", [f.id]);
    const sceneLogs  = query("SELECT id, date, rewards, logged_by, notes, author_id FROM scene_logs WHERE faction_id = ? ORDER BY created_at DESC LIMIT 50", [f.id]);
    const notes      = query("SELECT id, text, author, author_id, date FROM intel_notes WHERE faction_id = ? ORDER BY created_at DESC LIMIT 50", [f.id]);
    const oocNotes   = query("SELECT id, date, author, author_id, text FROM ooc_notes WHERE faction_id = ? ORDER BY created_at DESC LIMIT 50", [f.id])
      .map(n => ({ ...n, text: sanitizeHtml(n.text) }));
    const histRows   = query("SELECT id, action_type, details, authorized_by, created_at FROM faction_history WHERE faction_id = ? ORDER BY created_at DESC, id DESC LIMIT 50", [f.id]);
    const allItems   = query("SELECT * FROM import_items ORDER BY CAST(tier AS INTEGER), category, name");
    const permSet    = new Set(query("SELECT item_id FROM faction_imports WHERE faction_id = ? AND permitted = 1", [f.id]).map(p => p.item_id));
    const authorizedItems = allItems.filter(i => permSet.has(i.id)).map(i => i.name);
    const counts = queryOne("SELECT COUNT(*) AS allTime, SUM(CASE WHEN created_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) AS scenes30d FROM scene_logs WHERE faction_id = ?", [f.id]) || {};

    const { teams, teamOf } = teamRoster();
    const tid = teamOf[f.lead_discord_id] || '';
    const team = teams[tid] || { name: '', leads: [], guides: [] };
    const names = await resolveNames(new Set([f.lead_discord_id, ...team.guides].filter(Boolean)));
    const promo = parsePendingPromo(f.pending_promo, authorizedItems);
    const writable = !f.archived && !actor.isLeadStoryteller && canWriteFaction(actor, f.id);

    return {
      id: f.id, name: f.name, tier: f.tier, lastPromoted: f.last_promoted,
      archived: !!f.archived, archivedAt: f.archived_at || '',
      discord: f.discord_url, forum: f.forum_url, threadId: f.thread_id, aliases: f.aliases || '',
      pendingPromo: promo ? JSON.stringify(promo) : null, promo, leadId: f.lead_discord_id,
      leadName: names[f.lead_discord_id] || (f.lead_discord_id ? 'Unknown' : 'Unassigned'),
      teamId: tid, teamName: team.name,
      guidesText: team.guides.map(id => names[id] || id).join(' • ') || 'None',
      scenes30d: counts.scenes30d || 0, allTime: counts.allTime || 0, forumPosts: f.forum_posts_30d || 0,
      writable,
      members: members.map(m => ({ ...m, isLeader: m.is_leader >= 1 })),
      properties: properties.map(p => ({ ...p, isHQ: p.is_hq === 1 })),
      sceneLogs, notes, oocNotes, history: histRows,
      allItems, authorizedItems,
    };
  } catch (e) { console.error("getFactionDetail:", e); return null; }
}

// ── FACTION CRUD ──────────────────────────────────────────────────────────────

export async function addFaction(data) {
  const actor = await requireActor(3);
  const d = data && typeof data === 'object' ? data : {};
  const name = str(d.name, { max: 80 });
  if (!name) return fail('Faction name is required.');
  if (queryOne("SELECT id FROM factions WHERE name = ? COLLATE NOCASE", [name])) return fail(`A faction called "${name}" already exists.`);
  const tier = toInt(d.tier, { min: 0, max: 9 });
  if (tier == null) return fail('Tier must be a whole number from 0 to 9.');
  let leadId = str(d.leadId);
  if (leadId && !isSnowflake(leadId)) return fail('Lead must be a Discord id.');
  const teamId = str(d.teamId);
  if (!leadId && teamId) {
    // A chosen team resolves to its Lead's Discord id — the same rule the Staff & Teams board applies.
    if (!queryOne("SELECT team_id FROM teams WHERE team_id = ?", [teamId])) return fail('Unknown team.');
    leadId = queryOne("SELECT discord_id FROM staff WHERE team_id = ? AND clearance = 2 AND discord_id NOT LIKE 'placeholder%' ORDER BY id LIMIT 1", [teamId])?.discord_id || '';
  }
  const forum = str(d.forum, { max: 500 }), discord = str(d.discord, { max: 500 }), threadId = str(d.threadId);
  if (forum && !/^https?:\/\//i.test(forum)) return fail('Forum URL must start with http(s)://');
  if (discord && !/^https?:\/\//i.test(discord)) return fail('Discord URL must start with http(s)://');
  if (threadId && !isSnowflake(threadId)) return fail('Thread id must be a Discord id.');
  const guildId = str(d.guildId);
  if (guildId && !isSnowflake(guildId)) return fail('Discord server id must be a Discord id.');
  const aliases = str(d.aliases, { max: 500 }).split(',').map(s => s.trim()).filter(Boolean).join(',');
  const hq = str(d.hqAddress, { max: 200 });

  let factionId, configId = null;
  const watchRoles = [];
  try {
    transaction(() => {
      const result = run(
        "INSERT INTO factions (name, lead_discord_id, tier, last_promoted, thread_id, forum_url, discord_url, aliases, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)",
        [name, leadId, tier, threadId, forum, discord, aliases, nowIso(), nowIso()]);
      factionId = Number(result.lastInsertRowid);
      history(factionId, name, 'CREATED', `Created at Tier ${tier}${teamId ? ` (team ${teamId})` : ''}`, actor.name);
      if (hq) {
        run("INSERT INTO properties (address, faction_id, property_type, is_hq, date_given) VALUES (?, ?, 'HQ', 1, ?)", [hq, factionId, todayIso()]);
        history(factionId, name, 'PROPERTY_ADDED', `Added HQ: ${hq}`, actor.name);
      }
      if (guildId && !queryOne("SELECT id FROM bot_server_configs WHERE guild_id = ?", [guildId])) {
        const cfg = run(
          "INSERT INTO bot_server_configs (guild_id, guild_name, faction_id, access_role_id, access_role_name, comms_channel_id, comms_channel_name, faction_channel_id, faction_channel_name) VALUES (?,?,?,?,?,?,?,?,?)",
          [guildId, str(d.guildName, { max: 100 }), factionId,
           str(d.accessRoleId), str(d.accessRoleName, { max: 100 }),
           str(d.commsChannelId), str(d.commsChannelName, { max: 100 }),
           str(d.factionChannelId), str(d.factionChannelName, { max: 100 })]);
        configId = Number(cfg.lastInsertRowid);
        for (const role of [{ id: str(d.guideRoleId), name: 'ECRP Guide' }, { id: str(d.managementRoleId), name: 'ECRP Management' }]) {
          if (role.id && isSnowflake(role.id)) {
            run("INSERT INTO bot_watch_roles (config_id, role_id, role_name) VALUES (?,?,?)", [configId, role.id, role.name]);
            watchRoles.push({ role_id: role.id, role_name: role.name });
          }
        }
      }
    });
  } catch (e) { return fail(`Could not create the faction: ${e.message}`); }
  logAudit(actor.id, actor.name, 'CREATE', 'faction', factionId, name, `Created faction tier ${tier}`);
  if (configId) {
    try {
      const { backfillGuildPings } = await import('../../../lib/backfillPings.js');
      backfillGuildPings(guildId, str(d.guildName) || guildId, configId, watchRoles).catch(e => console.error('[BACKFILL]', e.message));
    } catch {}
  }
  return ok({ id: factionId, name });
}

/** Archive (soft-delete). Clears the staged promotion and denies open RP requests so nothing lingers in a queue. */
export async function deleteFaction(factionId) {
  const actor = await requireActor(3);
  const r = resolveFaction(factionId, { allowArchived: true });
  if (!r.faction) return fail(r.error);
  const f = r.faction;
  if (f.archived) return fail(`${f.name} is already archived.`);
  const open = query("SELECT id FROM pending_executions WHERE faction_id = ? AND status IN ('PENDING','APPROVED','RP_DONE')", [f.id]);
  try {
    transaction(() => {
      run("UPDATE factions SET archived = 1, archived_at = ?, pending_promo = NULL, updated_at = ? WHERE id = ?", [nowIso(), nowIso(), f.id]);
      if (open.length) run(`UPDATE pending_executions SET status = 'DENIED', deny_reason = 'Faction archived', resolved_at = ? WHERE id IN (${open.map(() => '?').join(',')})`, [nowIso(), ...open.map(o => o.id)]);
      history(f.id, f.name, 'ARCHIVED', `Archived${f.pending_promo ? ' · staged promotion cleared' : ''}${open.length ? ` · ${open.length} open RP request(s) denied` : ''}`, actor.name);
    });
  } catch (e) { return fail(`Archive failed: ${e.message}`); }
  logAudit(actor.id, actor.name, 'ARCHIVE', 'faction', f.id, f.name, 'Faction archived');
  return ok({ id: f.id, name: f.name });
}

export async function restoreFaction(factionId) {
  const actor = await requireActor(3);
  const r = resolveFaction(factionId, { allowArchived: true });
  if (!r.faction) return fail(r.error);
  const f = r.faction;
  if (!f.archived) return fail(`${f.name} is not archived.`);
  transaction(() => {
    run("UPDATE factions SET archived = 0, archived_at = '', updated_at = ? WHERE id = ?", [nowIso(), f.id]);
    history(f.id, f.name, 'RESTORED', 'Restored from archive', actor.name);
  });
  logAudit(actor.id, actor.name, 'RESTORE', 'faction', f.id, f.name, 'Restored from archive');
  return ok({ id: f.id, name: f.name });
}

export async function updateFactionLinks(factionId, field, value) {
  const actor = await requireActor(2);
  const cols = { discord: 'discord_url', forum: 'forum_url', thread: 'thread_id' };
  const col = cols[field];
  if (!col) return fail('Unknown field.');
  const v = str(value, { max: 500 });
  if (field === 'thread' && v && !isSnowflake(v)) return fail('Thread id must be a Discord id.');
  if (field !== 'thread' && v && !/^https?:\/\//i.test(v)) return fail('Links must start with http(s)://');
  const r = assertFactionWrite(actor, factionId);
  if (r.error) return fail(r.error);
  const f = r.faction;
  transaction(() => {
    run(`UPDATE factions SET ${col} = ?, updated_at = ? WHERE id = ?`, [v, nowIso(), f.id]);
    history(f.id, f.name, 'LINK_UPDATED', `${field}: ${f[col] || '—'} → ${v || '—'}`, actor.name);
  });
  logAudit(actor.id, actor.name, 'EDIT', 'faction', f.id, f.name, `Set ${field} to ${v || '(cleared)'}`);
  return ok();
}

/**
 * Rename everywhere. factions.name plus every denormalised copy move in one
 * transaction; the old name becomes an alias so forum matching and bot
 * commands keep resolving it. `oldName` is accepted for callers that still
 * pass it but the stored name is what gets rewritten.
 */
export async function renameFaction(factionId, oldName, newName) {
  const actor = await requireActor(3);
  const name = str(newName, { max: 80 });
  if (!name) return fail('New name is required.');
  const r = resolveFaction(factionId);
  if (r.error) return fail(r.error);
  const f = r.faction;
  if (name === f.name) return fail('That is already the faction’s name.');
  const clash = queryOne("SELECT id FROM factions WHERE name = ? COLLATE NOCASE AND id != ?", [name, f.id]);
  if (clash) return fail(`A faction called "${name}" already exists.`);
  const previous = f.name;
  const aliases = (f.aliases || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!aliases.some(a => a.toLowerCase() === previous.toLowerCase())) aliases.push(previous);
  try {
    transaction(() => {
      run("UPDATE factions SET name = ?, aliases = ?, updated_at = ? WHERE id = ?", [name, aliases.join(','), nowIso(), f.id]);
      run("UPDATE faction_history SET faction_name = ? WHERE faction_id = ? AND action_type != 'RENAME'", [name, f.id]);
      run("UPDATE faction_reviews SET faction_name = ? WHERE faction_id = ?", [name, f.id]);
      run("UPDATE leadership_personal_notes SET faction_name = ? WHERE faction_id = ?", [name, f.id]);
      run("UPDATE faction_public_messages SET faction_name = ? WHERE faction_id = ?", [name, f.id]);
      run("UPDATE faction_ic_contacts SET faction_name = ? WHERE faction_id = ?", [name, f.id]);
      run("UPDATE faction_ic_messages SET faction_name = ? WHERE faction_id = ?", [name, f.id]);
      run("UPDATE promotion_polls SET faction_name = ? WHERE faction_id = ?", [name, f.id]);
      run("UPDATE treasury_logs SET faction_name = ? WHERE faction_id = ? OR (faction_id IS NULL AND faction_name = ?)", [name, f.id, previous]);
      run("UPDATE staff_coi SET faction_name = ? WHERE faction_id = ? OR (faction_id IS NULL AND faction_name = ?)", [name, f.id, previous]);
      run("UPDATE ooc_notes SET target_label = ? WHERE target_type = 'faction' AND faction_id = ?", [name, f.id]);
      history(f.id, name, 'RENAME', `${previous} → ${name}`, actor.name);
    });
  } catch (e) { return fail(`Rename failed: ${e.message}`); }
  logAudit(actor.id, actor.name, 'EDIT', 'faction', f.id, name, `Renamed from ${previous}`);
  return ok({ id: f.id, name, oldName: previous });
}

export async function editFactionTier(factionId, tier) {
  const actor = await requireActor(3);
  const t = toInt(tier, { min: 0, max: 9 });
  if (t == null) return fail('Tier must be a whole number from 0 to 9.');
  const r = resolveFaction(factionId);
  if (r.error) return fail(r.error);
  const f = r.faction;
  if (t === f.tier) return ok();
  transaction(() => {
    run("UPDATE factions SET tier = ?, updated_at = ? WHERE id = ?", [t, nowIso(), f.id]);
    history(f.id, f.name, 'TIER_SET', `Tier ${f.tier} → ${t}`, actor.name);
  });
  logAudit(actor.id, actor.name, 'EDIT', 'faction', f.id, f.name, `Tier set to ${t}`);
  return ok();
}

export async function editFactionLead(factionId, leadId) {
  const actor = await requireActor(3);
  const id = str(leadId);
  if (id && !isSnowflake(id)) return fail('Lead must be a Discord id.');
  const r = resolveFaction(factionId);
  if (r.error) return fail(r.error);
  const f = r.faction;
  transaction(() => {
    run("UPDATE factions SET lead_discord_id = ?, updated_at = ? WHERE id = ?", [id, nowIso(), f.id]);
    history(f.id, f.name, 'LEAD_SET', `Lead ${f.lead_discord_id || '—'} → ${id || '—'}`, actor.name);
  });
  logAudit(actor.id, actor.name, 'EDIT', 'faction', f.id, f.name, 'Lead set to ' + (id || '(none)'));
  return ok();
}

export async function setFactionAliases(factionId, aliases) {
  const actor = await requireActor(3);
  const list = (Array.isArray(aliases) ? aliases : str(aliases, { max: 1000 }).split(',')).map(s => str(s)).filter(Boolean);
  const r = resolveFaction(factionId);
  if (r.error) return fail(r.error);
  run("UPDATE factions SET aliases = ?, updated_at = ? WHERE id = ?", [list.join(','), nowIso(), r.faction.id]);
  logAudit(actor.id, actor.name, 'EDIT', 'faction', r.faction.id, r.faction.name, `Aliases: ${list.join(', ') || '(none)'}`);
  return ok();
}

// ── MEMBERS ───────────────────────────────────────────────────────────────────

function memberFields(data, existing = null) {
  const d = data && typeof data === 'object' ? data : {};
  const name = d.name !== undefined || !existing ? str(d.name, { max: 100 }) : existing.character_name;
  const phone = d.phone !== undefined || !existing ? (str(d.phone, { max: 50 }) || 'N/A') : existing.phone;
  const residence = d.residence !== undefined || !existing ? (str(d.residence, { max: 150 }) || 'N/A') : existing.residence;
  let role;
  if (d.role !== undefined) role = toInt(d.role, { min: 0, max: 2 });
  else if (d.isLeader !== undefined) role = d.isLeader ? 1 : 0;
  else role = existing ? existing.is_leader : 0;
  return { name, phone, residence, role };
}

export async function addMember(factionId, factionName, data) {
  const actor = await requireActor(1);
  const m = memberFields(data);
  if (!m.name) return fail('Character name is required.');
  if (m.role == null) return fail('Role must be Member, Command or Leader.');
  const r = assertFactionWrite(actor, factionId);
  if (r.error) return fail(r.error);
  const f = r.faction;
  let id;
  transaction(() => {
    id = Number(run("INSERT INTO faction_members (faction_id, character_name, phone, residence, is_leader) VALUES (?, ?, ?, ?, ?)",
      [f.id, m.name, m.phone, m.residence, m.role]).lastInsertRowid);
    history(f.id, f.name, 'MEMBER_ADDED', `Added ${m.name}`, actor.name);
  });
  logAudit(actor.id, actor.name, 'CREATE', 'member', id, m.name, `Added to ${f.name}`);
  return ok({ id });
}

export async function updateMember(memberId, data) {
  const actor = await requireActor(1);
  const existing = queryOne("SELECT * FROM faction_members WHERE id = ?", [toInt(memberId)]);
  if (!existing) return fail('Member not found.');
  const m = memberFields(data, existing);
  if (!m.name) return fail('Character name is required.');
  if (m.role == null) return fail('Role must be Member, Command or Leader.');
  const r = assertFactionWrite(actor, existing.faction_id);
  if (r.error) return fail(r.error);
  run("UPDATE faction_members SET character_name = ?, phone = ?, residence = ?, is_leader = ?, updated_at = ? WHERE id = ?",
    [m.name, m.phone, m.residence, m.role, nowIso(), existing.id]);
  logAudit(actor.id, actor.name, 'EDIT', 'member', existing.id, m.name, `Updated member of ${r.faction.name}`);
  return ok();
}

export async function deleteMember(memberId) {
  const actor = await requireActor(1);
  const existing = queryOne("SELECT * FROM faction_members WHERE id = ?", [toInt(memberId)]);
  if (!existing) return fail('Member not found.');
  const r = assertFactionWrite(actor, existing.faction_id);
  if (r.error) return fail(r.error);
  transaction(() => {
    run("DELETE FROM faction_members WHERE id = ?", [existing.id]);
    history(r.faction.id, r.faction.name, 'MEMBER_REMOVED', `Removed ${existing.character_name}`, actor.name);
  });
  logAudit(actor.id, actor.name, 'DELETE', 'member', existing.id, existing.character_name, `Removed from ${r.faction.name}`);
  return ok();
}

// ── PROPERTIES (L2+, team-scoped — one rule for every property write) ─────────

function currentHQ(factionId) {
  return queryOne("SELECT address FROM properties WHERE faction_id = ? AND is_hq = 1", [factionId])?.address || '';
}

/** Below leadership a property change becomes an RP-change request (policy 16). */
async function queueProperty(actor, f, type, oldValue, newValue, what) {
  const res = await requestRPChange({ factionId: f.id, type, oldValue, newValue, turf: 'N/A' });
  if (!res.ok) return res;
  return ok({ queued: true, requestId: res.id ?? res.execId ?? null, notice: `Sent to leadership for approval: ${what} (${f.name}). It takes effect when the request is approved and executed.` });
}

export async function addFactionProperty(factionId, factionName, data) {
  const actor = await requireActor(2);
  const d = data && typeof data === 'object' ? data : {};
  const address = str(d.address, { max: 200 });
  if (!address) return fail('Address is required.');
  const type = propertyType(d.type);
  if (!type) return fail(`Type must be one of ${PROPERTY_TYPES.join(', ')}.`);
  const r = assertFactionWrite(actor, factionId);
  if (r.error) return fail(r.error);
  const f = r.faction;
  if (queryOne("SELECT id FROM properties WHERE faction_id = ? AND address = ? COLLATE NOCASE", [f.id, address])) return fail(`${f.name} already has ${address} on file.`);
  const isHQ = !!d.isHQ || type === 'HQ';
  // Policy 16: below leadership, property changes go through the same approval
  // queue as HQ moves; leadership executes them directly.
  if (actor.level < 3) return queueProperty(actor, f, isHQ ? 'HQ' : 'PROPERTY', isHQ ? (currentHQ(f.id) || 'N/A') : 'N/A', address, `add ${isHQ ? 'HQ' : type.toLowerCase()} ${address}`);
  let id;
  transaction(() => {
    if (isHQ) run("UPDATE properties SET is_hq = 0, updated_at = ? WHERE faction_id = ? AND is_hq = 1", [nowIso(), f.id]);
    id = Number(run("INSERT INTO properties (faction_id, address, property_type, is_hq, date_given) VALUES (?, ?, ?, ?, ?)",
      [f.id, address, type, isHQ ? 1 : 0, todayIso()]).lastInsertRowid);
    history(f.id, f.name, 'PROPERTY_ADDED', `Added ${isHQ ? 'HQ' : type.toLowerCase()}: ${address}`, actor.name);
  });
  logAudit(actor.id, actor.name, 'CREATE', 'property', id, address, `Assigned to ${f.name}`);
  return ok({ id });
}

export async function editFactionProperty(propId, data) {
  const actor = await requireActor(2);
  const existing = queryOne("SELECT * FROM properties WHERE id = ?", [toInt(propId)]);
  if (!existing) return fail('Property not found.');
  if (!existing.faction_id) return fail('This property is not assigned to a faction; manage it from Admin → Properties.');
  const d = data && typeof data === 'object' ? data : {};
  const address = d.address !== undefined ? str(d.address, { max: 200 }) : existing.address;
  if (!address) return fail('Address is required.');
  const type = d.type !== undefined ? propertyType(d.type) : existing.property_type;
  if (!type) return fail(`Type must be one of ${PROPERTY_TYPES.join(', ')}.`);
  const isHQ = d.isHQ !== undefined ? !!d.isHQ : existing.is_hq === 1;
  const r = assertFactionWrite(actor, existing.faction_id);
  if (r.error) return fail(r.error);
  const f = r.faction;
  if (actor.level < 3) {
    if (address !== existing.address) return queueProperty(actor, f, 'PROPERTY', existing.address, address, `re-address ${existing.address} → ${address}`);
    if (isHQ && existing.is_hq !== 1) return queueProperty(actor, f, 'HQ', currentHQ(f.id) || 'N/A', existing.address, `make ${existing.address} the HQ`);
    if (!isHQ && existing.is_hq === 1) return fail('Un-marking the HQ is done by making another property the HQ; that goes through approval.');
    // Only the label changed: a cosmetic edit, applied directly.
  }
  transaction(() => {
    if (isHQ) run("UPDATE properties SET is_hq = 0, updated_at = ? WHERE faction_id = ? AND is_hq = 1 AND id != ?", [nowIso(), f.id, existing.id]);
    run("UPDATE properties SET address = ?, property_type = ?, is_hq = ?, updated_at = ? WHERE id = ?", [address, type, isHQ ? 1 : 0, nowIso(), existing.id]);
    const changes = [];
    if (address !== existing.address) changes.push(`${existing.address} → ${address}`);
    if (type !== existing.property_type) changes.push(`type ${existing.property_type} → ${type}`);
    if (isHQ !== (existing.is_hq === 1)) changes.push(isHQ ? 'now HQ' : 'no longer HQ');
    if (changes.length) history(f.id, f.name, 'PROPERTY_EDITED', `${address}: ${changes.join(', ')}`, actor.name);
  });
  logAudit(actor.id, actor.name, 'EDIT', 'property', existing.id, address, `Edited for ${f.name}`);
  return ok();
}

export async function deleteFactionProperty(propId) {
  const actor = await requireActor(2);
  const existing = queryOne("SELECT * FROM properties WHERE id = ?", [toInt(propId)]);
  if (!existing) return fail('Property not found.');
  if (!existing.faction_id) return fail('This property is not assigned to a faction; manage it from Admin → Properties.');
  const r = assertFactionWrite(actor, existing.faction_id);
  if (r.error) return fail(r.error);
  if (actor.level < 3) return queueProperty(actor, r.faction, 'PROPERTY', existing.address, 'REMOVED', `remove ${existing.address}`);
  transaction(() => {
    run("DELETE FROM properties WHERE id = ?", [existing.id]);
    history(r.faction.id, r.faction.name, 'PROPERTY_REMOVED', `Removed ${existing.is_hq ? 'HQ ' : ''}${existing.address}`, actor.name);
  });
  logAudit(actor.id, actor.name, 'DELETE', 'property', existing.id, existing.address, 'Removed from ' + r.faction.name);
  return ok();
}

// ── NOTES ─────────────────────────────────────────────────────────────────────

export async function addNote(factionId, factionName, text) {
  const actor = await requireActor(1);
  const body = str(text, { max: 4000 });
  if (!body) return fail('Note is empty.');
  const r = assertFactionWrite(actor, factionId);
  if (r.error) return fail(r.error);
  const f = r.faction;
  const id = Number(run("INSERT INTO intel_notes (faction_id, text, author, author_id, date, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [f.id, body, actor.name, actor.id, todayIso(), nowIso()]).lastInsertRowid);
  logAudit(actor.id, actor.name, 'CREATE', 'intel_note', id, f.name, body.substring(0, 100));
  return ok({ id });
}

export async function editNote(noteId, text) {
  const actor = await requireActor(1);
  const body = str(text, { max: 4000 });
  if (!body) return fail('Note is empty.');
  const note = queryOne("SELECT id, faction_id, author_id FROM intel_notes WHERE id = ?", [toInt(noteId)]);
  if (!note) return fail('Note not found.');
  if (note.author_id !== actor.id && actor.level < 3) return fail('Only the author or leadership can edit this note.');
  run("UPDATE intel_notes SET text = ? WHERE id = ?", [body, note.id]);
  logAudit(actor.id, actor.name, 'EDIT', 'intel_note', note.id, factionLabel(note.faction_id), body.substring(0, 100));
  return ok();
}

/** OOC meeting note on a faction (rich text). Same shape saveMeetingNote writes. */
export async function addOOCNote(factionId, factionName, text, attendeeIds) {
  const actor = await requireActor(1);
  const html = sanitizeHtml(text);
  if (!htmlToText(html)) return fail('Meeting note is empty.');
  const attendees = (Array.isArray(attendeeIds) ? attendeeIds : []).map(String).filter(isSnowflake);
  const r = assertFactionWrite(actor, factionId);
  if (r.error) return fail(r.error);
  const f = r.faction;
  const id = Number(run("INSERT INTO ooc_notes (faction_id, date, author, author_id, text, created_at, meeting_type, attendees_json, target_type, target_key, target_label) VALUES (?, ?, ?, ?, ?, ?, 'faction_meeting', ?, 'faction', '', ?)",
    [f.id, todayIso(), actor.name, actor.id, html, nowIso(), JSON.stringify(attendees), f.name]).lastInsertRowid);
  logAudit(actor.id, actor.name, 'CREATE', 'ooc_note', id, f.name, `OOC meeting note added (${attendees.length} attendees)`);
  return ok({ id });
}

export async function editOOCNote(noteId, text) {
  const actor = await requireActor(1);
  const html = sanitizeHtml(text);
  if (!htmlToText(html)) return fail('Meeting note is empty.');
  const note = queryOne("SELECT id, faction_id, author_id, target_type FROM ooc_notes WHERE id = ?", [toInt(noteId)]);
  if (!note) return fail('Note not found.');
  if (note.author_id !== actor.id && actor.level < 2) return fail('Only the author or a team lead can edit this note.');
  if (note.faction_id) {
    const r = assertFactionWrite(actor, note.faction_id);
    if (r.error && note.author_id !== actor.id) return fail(r.error);
  }
  run("UPDATE ooc_notes SET text = ? WHERE id = ?", [html, note.id]);
  logAudit(actor.id, actor.name, 'EDIT', 'ooc_note', note.id, note.faction_id ? factionLabel(note.faction_id) : '', 'OOC note edited');
  return ok();
}

export async function editSceneLog(logId, notes) {
  const actor = await requireActor(1);
  const body = str(notes, { max: 8000 });
  if (!body) return fail('Scene notes are empty.');
  const log = queryOne("SELECT id, faction_id, author_id FROM scene_logs WHERE id = ?", [toInt(logId)]);
  if (!log) return fail('Scene not found.');
  if (log.author_id !== actor.id && actor.level < 3) return fail('Only the author or leadership can edit this scene.');
  run("UPDATE scene_logs SET notes = ? WHERE id = ?", [body, log.id]);
  logAudit(actor.id, actor.name, 'EDIT', 'scene_log', log.id, factionLabel(log.faction_id), body.substring(0, 100));
  return ok();
}

export async function editFactionSceneRewards(logId, rewards) {
  const actor = await requireActor(3);
  const log = queryOne("SELECT id, faction_id FROM scene_logs WHERE id = ?", [toInt(logId)]);
  if (!log) return fail('Scene not found.');
  const value = str(rewards, { max: 500 }) || 'None';
  run("UPDATE scene_logs SET rewards = ? WHERE id = ?", [value, log.id]);
  logAudit(actor.id, actor.name, 'EDIT', 'scene_log', log.id, factionLabel(log.faction_id), `Rewards: ${value}`);
  return ok();
}

// ── AUDIT TRAIL (faction_history) ─────────────────────────────────────────────

export async function editAuditEntry(entryId, details) {
  const actor = await requireActor(3);
  const row = queryOne("SELECT id, faction_id, details FROM faction_history WHERE id = ?", [toInt(entryId)]);
  if (!row) return fail('History entry not found.');
  const text = str(details, { max: 1000 });
  if (!text) return fail('Details are empty.');
  run("UPDATE faction_history SET details = ? WHERE id = ?", [text, row.id]);
  logAudit(actor.id, actor.name, 'EDIT', 'faction_history', row.id, factionLabel(row.faction_id), `${row.details} → ${text}`.substring(0, 200));
  return ok();
}

export async function deleteAuditEntry(entryId) {
  const actor = await requireActor(3);
  const row = queryOne("SELECT id, faction_id, action_type, details FROM faction_history WHERE id = ?", [toInt(entryId)]);
  if (!row) return fail('History entry not found.');
  run("DELETE FROM faction_history WHERE id = ?", [row.id]);
  logAudit(actor.id, actor.name, 'DELETE', 'faction_history', row.id, factionLabel(row.faction_id), `${row.action_type}: ${row.details}`.substring(0, 200));
  return ok();
}

// ── DELETION REQUESTS ─────────────────────────────────────────────────────────

const DELETABLE = { intel_note: 'intel_notes', scene_log: 'scene_logs', ooc_note: 'ooc_notes' };

export async function requestDeletion(contentType, originalText, targetId) {
  const actor = await requireActor(1);
  const table = DELETABLE[contentType];
  if (!table) return fail('That content cannot be deleted through a request.');
  const id = toInt(targetId);
  const row = id ? queryOne(`SELECT id, faction_id, author_id FROM ${table} WHERE id = ?`, [id]) : null;
  if (!row) return fail('That entry no longer exists.');
  if (queryOne("SELECT id FROM deletion_requests WHERE content_type = ? AND target_row_id = ? AND status = 'PENDING'", [contentType, id])) return fail('A deletion request for this entry is already pending.');
  const text = str(originalText, { max: 2000 }) || queryOne(`SELECT ${table === 'scene_logs' ? 'notes' : 'text'} AS t FROM ${table} WHERE id = ?`, [id])?.t || '';
  const reqId = Number(run("INSERT INTO deletion_requests (requested_by, discord_id, content_type, original_text, target_row_id, target_table, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [actor.name, actor.id, contentType, text, id, table, nowIso()]).lastInsertRowid);
  const fname = factionLabel(row.faction_id);
  logAudit(actor.id, actor.name, 'DELETE_REQUEST', contentType, id, fname, text.substring(0, 100));
  if (getPingRoute('deletion.requested')) {
    await sendPing('deletion.requested', `🗑️ **Deletion requested** — ${contentType.replace('_', ' ')} on **${fname}** by ${actor.name}\n> ${text.substring(0, 200).replace(/\n/g, ' ')}\n${urls.approvals()}`);
  }
  return ok({ id: reqId });
}

export async function directDelete(type, id) {
  const actor = await requireActor(3);
  const table = DELETABLE[type];
  if (!table) return fail('Unknown content type.');
  const rowId = toInt(id);
  const row = rowId ? queryOne(`SELECT id, faction_id FROM ${table} WHERE id = ?`, [rowId]) : null;
  if (!row) return fail('That entry no longer exists.');
  transaction(() => {
    run(`DELETE FROM ${table} WHERE id = ?`, [row.id]);
    run("UPDATE deletion_requests SET status = 'APPROVED', resolved_by = ?, resolved_at = ? WHERE content_type = ? AND target_row_id = ? AND status = 'PENDING'", [actor.name, nowIso(), type, row.id]);
  });
  logAudit(actor.id, actor.name, 'DELETE', type, row.id, factionLabel(row.faction_id), 'L3 direct delete');
  return ok();
}

// ── IMPORTS ───────────────────────────────────────────────────────────────────

export async function getFactionImports(factionId) {
  await requireActor(1, { allowEventTeam: true, allowLeadStoryteller: true });
  const allItems = query("SELECT * FROM import_items ORDER BY CAST(tier AS INTEGER), name");
  const authSet = new Set(query("SELECT item_id FROM faction_imports WHERE faction_id = ? AND permitted = 1", [toInt(factionId)]).map(a => a.item_id));
  return allItems.map(item => ({ ...item, permitted: authSet.has(item.id) }));
}

export async function toggleFactionImport(factionId, itemId, permitted) {
  const actor = await requireActor(3);
  const r = resolveFaction(factionId);
  if (r.error) return fail(r.error);
  const f = r.faction;
  const item = queryOne("SELECT id, name, tier FROM import_items WHERE id = ?", [toInt(itemId)]);
  if (!item) return fail('Import item not found.');
  const on = permitted ? 1 : 0;
  const existing = queryOne("SELECT id, permitted FROM faction_imports WHERE faction_id = ? AND item_id = ?", [f.id, item.id]);
  if ((existing?.permitted || 0) === on) return ok({ unchanged: true });
  transaction(() => {
    run("INSERT INTO faction_imports (faction_id, item_id, permitted) VALUES (?, ?, ?) ON CONFLICT(faction_id, item_id) DO UPDATE SET permitted = excluded.permitted", [f.id, item.id, on]);
    history(f.id, f.name, on ? 'IMPORT_AUTHORIZED' : 'IMPORT_REVOKED', `${item.name} (T${item.tier})`, actor.name);
  });
  logAudit(actor.id, actor.name, on ? 'AUTHORIZE' : 'REVOKE', 'faction_import', f.id, f.name, (on ? 'Added: ' : 'Removed: ') + item.name);
  return ok();
}

// ── PORTAL ────────────────────────────────────────────────────────────────────

export async function getFactionPortalMessages(factionId) {
  await requireActor(1, { allowEventTeam: true, allowLeadStoryteller: true });
  return query("SELECT * FROM faction_public_messages WHERE faction_id = ? ORDER BY is_pinned DESC, created_at DESC LIMIT 20", [toInt(factionId)]);
}

export async function postPortalMessage(factionId, factionName, message, pin) {
  const actor = await requireActor(1);
  const body = str(message, { max: 2000 });
  if (!body) return fail('Message is empty.');
  const r = assertFactionWrite(actor, factionId);
  if (r.error) return fail(r.error);
  const f = r.faction;
  const id = Number(run("INSERT INTO faction_public_messages (faction_id, faction_name, author_name, author_id, message, is_pinned, created_at) VALUES (?,?,?,?,?,?,?)",
    [f.id, f.name, actor.name, actor.id, body, pin ? 1 : 0, nowIso()]).lastInsertRowid);
  logAudit(actor.id, actor.name, 'CREATE', 'portal_message', id, f.name, body.substring(0, 80));
  return ok({ id });
}

export async function deletePortalMessage(messageId) {
  const actor = await requireActor(1);
  const msg = queryOne("SELECT * FROM faction_public_messages WHERE id = ?", [toInt(messageId)]);
  if (!msg) return fail('Message not found.');
  if (msg.author_id !== actor.id && actor.level < 3) return fail('Only the author or leadership can delete this message.');
  run("DELETE FROM faction_public_messages WHERE id = ?", [msg.id]);
  logAudit(actor.id, actor.name, 'DELETE', 'portal_message', msg.id, msg.faction_name, msg.message.substring(0, 80));
  return ok();
}

export async function togglePortalMessagePin(messageId) {
  const actor = await requireActor(1);
  const msg = queryOne("SELECT id, faction_id, faction_name, is_pinned FROM faction_public_messages WHERE id = ?", [toInt(messageId)]);
  if (!msg) return fail('Message not found.');
  const r = assertFactionWrite(actor, msg.faction_id);
  if (r.error) return fail(r.error);
  const next = msg.is_pinned ? 0 : 1;
  run("UPDATE faction_public_messages SET is_pinned = ? WHERE id = ?", [next, msg.id]);
  logAudit(actor.id, actor.name, 'EDIT', 'portal_message', msg.id, msg.faction_name, next ? 'Pinned' : 'Unpinned');
  return ok({ pinned: !!next });
}

export async function getFactionContacts(factionId) {
  await requireActor(1, { allowEventTeam: true, allowLeadStoryteller: true });
  return query("SELECT * FROM faction_ic_contacts WHERE faction_id = ? ORDER BY submitted_at DESC LIMIT 50", [toInt(factionId)]);
}

export async function markContactRead(contactId) {
  const actor = await requireActor(1);
  const c = queryOne("SELECT id, faction_id, faction_name, is_read FROM faction_ic_contacts WHERE id = ?", [toInt(contactId)]);
  if (!c) return fail('Contact not found.');
  if (c.is_read) return ok({ unchanged: true });
  run("UPDATE faction_ic_contacts SET is_read = 1 WHERE id = ?", [c.id]);
  logAudit(actor.id, actor.name, 'EDIT', 'ic_contact', c.id, c.faction_name, 'Marked read');
  return ok();
}

// ── PROMOTION WORKFLOW ────────────────────────────────────────────────────────

/**
 * Stage a promotion: the target tier and the import set the faction will hold
 * once the RP is done. Items above the target tier are refused up front rather
 * than silently dropped on completion.
 */
export async function stagePromotion(factionId, factionName, tier, importNames) {
  const actor = await requireActor(3);
  const target = toInt(tier, { min: 1, max: 9 });
  if (target == null) return fail('Target tier must be a whole number from 1 to 9.');
  if (importNames != null && !Array.isArray(importNames)) return fail('Imports must be a list of item names.');
  const r = resolveFaction(factionId);
  if (r.error) return fail(r.error);
  const f = r.faction;
  if (target <= f.tier) return fail(`${f.name} is already Tier ${f.tier}; a promotion must go higher. Use Demote for a lower tier.`);
  const items = query("SELECT name, tier FROM import_items");
  const byName = new Map(items.map(i => [i.name, toInt(i.tier, { def: 1 })]));
  const names = [...new Set((importNames || []).map(n => str(n)).filter(Boolean))];
  const unknown = names.filter(n => !byName.has(n));
  if (unknown.length) return fail(`Unknown import item(s): ${unknown.join(', ')}.`);
  const tooHigh = names.filter(n => byName.get(n) > target);
  if (tooHigh.length) return fail(`Above Tier ${target}: ${tooHigh.join(', ')}. Remove them or pick a higher tier.`);
  const current = permittedNames(f.id);
  const added = names.filter(n => !current.includes(n));
  const removed = current.filter(n => !names.includes(n));
  const payload = JSON.stringify({ tier: target, imports: names });
  transaction(() => {
    run("UPDATE factions SET pending_promo = ?, updated_at = ? WHERE id = ?", [payload, nowIso(), f.id]);
    history(f.id, f.name, 'PROMO_STAGED', `Staged for Tier ${target} (+${added.length} / −${removed.length} imports)${f.pending_promo ? ' · replaces earlier stage' : ''}`, actor.name);
  });
  logAudit(actor.id, actor.name, 'PROMOTE', 'faction', f.id, f.name, `Staged promotion to T${target}; imports: ${names.join(', ') || 'none'}`);
  await sendPing('promo.staged', `${leadMention(f)}📋 **Pending Promotion** — **${f.name}** → Tier ${target}\nStaged by: ${actor.name}${added.length ? `\n**New imports:** ${added.join(', ')}` : ''}\nAwaiting RP confirmation — complete it from the hub once the scene has run.\n${urls.faction(f.name, 'review')}`);
  return ok({ tier: target, added, removed });
}

/**
 * Apply a staged promotion once the RP has happened. Tolerates the legacy
 * bare-tier pending_promo. The import set becomes current ∪ staged, minus
 * anything above the new tier (each change is written to the history).
 */
export async function completePromotion(factionId) {
  const actor = await requireActor(2);
  const r = assertFactionWrite(actor, factionId);
  if (r.error) return fail(r.error);
  const f = r.faction;
  const current = permittedNames(f.id);
  const promo = parsePendingPromo(f.pending_promo, current);
  if (!promo) return fail(f.pending_promo ? 'The staged promotion could not be read; cancel it and stage again.' : 'No pending promotion.');
  const newTier = promo.tier;
  if (newTier <= f.tier) return fail(`Staged tier ${newTier} is not above the current Tier ${f.tier}; cancel and stage again.`);
  const tiers = new Map(query("SELECT name, tier FROM import_items").map(i => [i.name, toInt(i.tier, { def: 1 })]));
  const wanted = [...new Set([...current, ...promo.imports])].filter(n => tiers.has(n));
  const final = wanted.filter(n => tiers.get(n) <= newTier);
  const dropped = wanted.filter(n => tiers.get(n) > newTier);
  let change;
  try {
    transaction(() => {
      run("UPDATE factions SET tier = ?, last_promoted = ?, pending_promo = NULL, updated_at = ? WHERE id = ?", [newTier, todayIso(), nowIso(), f.id]);
      change = applyImportSet(f.id, final);
      const parts = [`Promoted Tier ${f.tier} → ${newTier}`];
      if (change.granted.length) parts.push(`granted: ${change.granted.join(', ')}`);
      if (change.revoked.length) parts.push(`revoked: ${change.revoked.join(', ')}`);
      history(f.id, f.name, 'PROMOTED', parts.join(' · '), actor.name);
    });
  } catch (e) { return fail(`Promotion failed: ${e.message}`); }
  logAudit(actor.id, actor.name, 'PROMOTE', 'faction', f.id, f.name, `Completed promotion to T${newTier}${dropped.length ? ` (dropped above-tier: ${dropped.join(', ')})` : ''}`);
  await sendPing('promo.completed', `${leadMention(f)}✅ **Promotion Complete** — **${f.name}** is now Tier ${newTier}\nCompleted by: ${actor.name}${change.granted.length ? `\n**New imports:** ${change.granted.join(', ')}` : ''}${change.revoked.length ? `\n**Revoked:** ${change.revoked.join(', ')}` : ''}\n${urls.faction(f.name)}`);
  return ok({ tier: newTier, granted: change.granted, revoked: change.revoked });
}

export async function cancelPromotion(factionId) {
  const actor = await requireActor(2);
  const r = assertFactionWrite(actor, factionId);
  if (r.error) return fail(r.error);
  const f = r.faction;
  if (!f.pending_promo) return fail('Nothing is staged for this faction.');
  const promo = parsePendingPromo(f.pending_promo);
  transaction(() => {
    run("UPDATE factions SET pending_promo = NULL, updated_at = ? WHERE id = ?", [nowIso(), f.id]);
    history(f.id, f.name, 'PROMO_CANCELLED', `Staged promotion${promo ? ` to Tier ${promo.tier}` : ''} cancelled`, actor.name);
  });
  logAudit(actor.id, actor.name, 'EDIT', 'faction', f.id, f.name, 'Promotion cancelled');
  await sendPing('promo.cancelled', `${leadMention(f)}❌ **Promotion Cancelled** — **${f.name}**${promo ? ` (was → Tier ${promo.tier})` : ''}\nCancelled by: ${actor.name}\n${urls.faction(f.name, 'review')}`);
  return ok();
}

/** Demote: lower the tier, revoke imports above it, clear any staged promotion. Mirrors completePromotion. */
export async function demoteFaction(factionId, factionName, newTier) {
  const actor = await requireActor(3);
  const target = toInt(newTier, { min: 0, max: 9 });
  if (target == null) return fail('Tier must be a whole number from 0 to 9.');
  const r = resolveFaction(factionId);
  if (r.error) return fail(r.error);
  const f = r.faction;
  if (target >= f.tier) return fail(`${f.name} is Tier ${f.tier}; a demotion must go lower.`);
  const tiers = new Map(query("SELECT name, tier FROM import_items").map(i => [i.name, toInt(i.tier, { def: 1 })]));
  const current = permittedNames(f.id).filter(n => tiers.has(n));
  const keep = current.filter(n => tiers.get(n) <= target);
  let change;
  try {
    transaction(() => {
      run("UPDATE factions SET tier = ?, pending_promo = NULL, updated_at = ? WHERE id = ?", [target, nowIso(), f.id]);
      change = applyImportSet(f.id, keep);
      const parts = [`Demoted Tier ${f.tier} → ${target}`];
      if (change.revoked.length) parts.push(`revoked: ${change.revoked.join(', ')}`);
      if (f.pending_promo) parts.push('staged promotion cleared');
      history(f.id, f.name, 'DEMOTED', parts.join(' · '), actor.name);
    });
  } catch (e) { return fail(`Demotion failed: ${e.message}`); }
  logAudit(actor.id, actor.name, 'DEMOTE', 'faction', f.id, f.name, `Demoted to T${target}${change.revoked.length ? `; revoked: ${change.revoked.join(', ')}` : ''}`);
  await sendPing('promo.demoted', `${leadMention(f)}⬇️ **Demotion** — **${f.name}** → Tier ${target}\nBy: ${actor.name}${change.revoked.length ? `\n**Revoked imports:** ${change.revoked.join(', ')}` : ''}\n${urls.faction(f.name)}`);
  return ok({ tier: target, revoked: change.revoked });
}

// ── RP CHANGES ────────────────────────────────────────────────────────────────

/**
 * Open an RP-change request (the PENDING step of shared/rpState.js). `data`:
 * { factionId | faction, type: NPC|HQ|TURF|Other, oldValue, newValue, turf,
 *   npcId?, contactId? }. The NPC it will rewrite and the IC contact it came
 * from are recorded on the row so execution never has to guess. A duplicate
 * open request for the same change is refused.
 */
export async function requestRPChange(data) {
  const actor = await requireActor(2);
  const d = data && typeof data === 'object' ? data : {};
  const type = oneOf(str(d.type), RP_TYPES);
  if (!type) return fail(`Change type must be one of ${RP_TYPES.join(', ')}.`);
  const newValue = str(d.newValue, { max: 500 });
  if (!newValue) return fail('The new value is required.');
  let oldValue = str(d.oldValue, { max: 500 }) || 'N/A';
  let turf = str(d.turf, { max: 200 }) || 'N/A';
  const r = assertFactionWrite(actor, d.factionId ?? d.faction);
  if (r.error) return fail(r.error);
  const f = r.faction;

  let npcId = null;
  if (type === 'NPC') {
    const wanted = toInt(d.npcId);
    let npc = wanted ? queryOne("SELECT * FROM npcs WHERE id = ?", [wanted]) : null;
    if (wanted && !npc) return fail('That NPC no longer exists.');
    if (!npc) {
      const rows = query("SELECT * FROM npcs WHERE turf = ? AND npc_type = ? ORDER BY id", [turf, oldValue]);
      if (rows.length === 1) npc = rows[0];
    }
    if (npc) { npcId = npc.id; turf = npc.turf; oldValue = npc.npc_type; }
    if (turf === 'N/A') return fail('Pick the NPC (or its turf) that will change.');
    if (newValue === oldValue) return fail('The new NPC type is the same as the current one.');
  }
  if (type === 'TURF' && turf === 'N/A') turf = oldValue !== 'N/A' ? oldValue : newValue;
  if (type === 'PROPERTY' && oldValue === 'N/A' && /^(REMOVED|REMOVE|N\/A)$/i.test(newValue)) return fail('Name the property to add, or the property to remove.');

  let contact = null;
  if (d.contactId != null && d.contactId !== '') {
    contact = queryOne("SELECT * FROM faction_ic_contacts WHERE id = ?", [toInt(d.contactId)]);
    if (!contact) return fail('That IC contact no longer exists.');
    if (contact.faction_id !== f.id) return fail('That IC contact belongs to another faction.');
    if (contact.status === 'completed') return fail('That IC contact is already completed.');
  }

  const dupe = queryOne("SELECT id, status FROM pending_executions WHERE faction_id = ? AND execution_type = ? AND new_value = ? AND turf = ? AND status IN ('PENDING','APPROVED','RP_DONE')", [f.id, type, newValue, turf]);
  if (dupe) return fail(`An identical request (#${dupe.id}) is already ${dupe.status === 'PENDING' ? 'awaiting approval' : 'in progress'}.`);

  let execId;
  transaction(() => {
    execId = Number(run("INSERT INTO pending_executions (date, faction_id, execution_type, turf, old_value, new_value, requested_by, requester_id, status, npc_id, contact_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)",
      [todayIso(), f.id, type, turf, oldValue, newValue, actor.name, actor.id, npcId, contact ? contact.id : null, nowIso()]).lastInsertRowid);
    if (contact) run("UPDATE faction_ic_contacts SET status = 'pending_roleplay', rp_change_id = ? WHERE id = ?", [execId, contact.id]);
    history(f.id, f.name, 'RP_CHANGE_REQUESTED', `${type}: ${oldValue} → ${newValue}${turf !== 'N/A' ? ` (${turf})` : ''}`, actor.name);
  });
  logAudit(actor.id, actor.name, 'CREATE', 'rp_change', execId, f.name, `${type}: ${oldValue} → ${newValue}${contact ? ` (IC contact #${contact.id})` : ''}`);

  let msg = `🔔 **RP Change Request** #${execId}\n**Faction:** ${f.name}\n**Type:** ${RP_LABEL[type] || type}\n**Requested By:** ${actor.name}`;
  if (type === 'NPC') msg += `\n**Turf:** ${turf}\n**Current:** ${oldValue}\n**New:** ${newValue}`;
  else if (type === 'HQ') msg += `\n**Old Address:** ${oldValue}\n**New Address:** ${newValue}`;
  else if (type === 'TURF') msg += `\n**Turf:** ${turf}\n**Change:** ${oldValue} → ${newValue}`;
  else if (type === 'PROPERTY') msg += `\n**Current:** ${oldValue}\n**New:** ${newValue}`;
  else msg += `\n**Details:** ${newValue}`;
  if (contact) msg += `\n**From IC contact:** ${contact.sender_name}`;
  msg += `\n${urls.approvals()}`;
  await sendPing('rp.requested', msg, { components: rpComponents(execId, 'pending') });
  if (contact?.thread_id) {
    await sendDiscord(contact.thread_id, `**RP Staged** by ${actor.name} — ${RP_LABEL[type] || type}: ${oldValue} → ${newValue}\nAn RP change request (#${execId}) has been submitted and is pending Leadership approval.`);
  }
  return ok({ id: execId });
}

export async function getNPCsForRP() {
  await requireActor(2, { allowLeadStoryteller: true });
  return query("SELECT id, name, npc_type, turf, position FROM npcs ORDER BY turf, npc_type, name");
}

export async function getFactionProperties(factionId) {
  await requireActor(2, { allowLeadStoryteller: true });
  return query("SELECT id, address, is_hq, property_type FROM properties WHERE faction_id = ? ORDER BY is_hq DESC, address", [toInt(factionId)]);
}

// ── AI SUMMARY ────────────────────────────────────────────────────────────────

export async function aiSummarize(factionName) {
  const actor = await requireActor(2);
  const r = assertFactionWrite(actor, factionName);
  if (r.error) return fail(r.error);
  const f = r.faction;
  if (!process.env.OPENAI_API_KEY) return fail("No API key");
  const logs  = query("SELECT date, rewards, logged_by, notes FROM scene_logs WHERE faction_id = ? ORDER BY created_at DESC LIMIT 30", [f.id]);
  const notes = query("SELECT date, author, text FROM intel_notes WHERE faction_id = ? ORDER BY created_at DESC LIMIT 20", [f.id]);
  if (logs.length === 0 && notes.length === 0) return fail("No data to summarize");
  const input = `Faction: ${f.name}\n\n=== SCENE LOGS ===\n${logs.map(l => `[${l.date}] ${l.logged_by}: ${l.notes} | Rewards: ${l.rewards}`).join('\n')}\n\n=== NOTES ===\n${notes.map(n => `[${n.date}] ${n.author}: ${n.text}`).join('\n')}`;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [
        { role: "system", content: "You are a Faction Management analyst for a GTA RP server. Provide a concise intelligence brief: 1) Executive Summary, 2) Key Personnel, 3) Recent Activity, 4) Concerns, 5) Recommended Actions." },
        { role: "user", content: input }
      ] })
    });
    if (!res.ok) return fail(`OpenAI error ${res.status}`);
    const data = await res.json();
    logAudit(actor.id, actor.name, 'AI', 'faction', f.id, f.name, 'AI summary generated');
    return ok({ summary: data.choices?.[0]?.message?.content || "No response" });
  } catch (e) { return fail(e.message); }
}

// ── FACTION LIST HELPERS ──────────────────────────────────────────────────────

export async function getFactionNames() {
  await requireActor(1, { allowEventTeam: true, allowLeadStoryteller: true });
  return query("SELECT name FROM factions WHERE archived = 0 ORDER BY name").map(r => r.name);
}

/** Staff on the faction lead's team (OOC attendance, IC contact assignment). */
export async function getStaffForTeam(factionName) {
  await requireActor(1, { allowEventTeam: true, allowLeadStoryteller: true });
  const r = resolveFaction(factionName, { allowArchived: true });
  if (!r.faction) return [];
  const leadTeamId = queryOne("SELECT team_id FROM staff WHERE discord_id = ?", [r.faction.lead_discord_id])?.team_id;
  if (!leadTeamId) return [];
  return query("SELECT discord_id, display_name, rank, clearance FROM staff WHERE team_id = ? AND discord_id != '' AND discord_id NOT LIKE 'placeholder%' AND COALESCE(active, 1) = 1 ORDER BY clearance DESC, display_name", [leadTeamId]);
}
