"use server";
import { query, queryOne, run, transaction } from "../../../lib/db.js";
import { logAudit } from "../../../lib/audit.js";
import { sendDiscord, getChannel } from "../../../lib/discord.js";
import { requireActor } from "../../../lib/requireActor.js";
import { today } from "../../../lib/format.js";
import { GAME_AFFAIRS_ID } from "../../../lib/constants.js";

// ── HELPERS ──────────────────────────────────────────────────────────────────

async function resolveNames(ids) {
  const names = {};
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return names;
  await Promise.all([...ids].map(async (id) => {
    if (!id || id.length < 15) return;
    const staff = queryOne("SELECT display_name FROM staff WHERE discord_id = ?", [id]);
    if (staff?.display_name) { names[id] = staff.display_name; return; }
    try {
      const r = await fetch(`https://discord.com/api/v10/users/${id}`, { headers: { Authorization: `Bot ${token}` } });
      if (r.ok) { const u = await r.json(); names[id] = u.global_name || u.username; }
    } catch {}
  }));
  return names;
}

async function getLeadPing(factionId) {
  const fac = queryOne("SELECT lead_discord_id FROM factions WHERE id = ?", [factionId]);
  return fac?.lead_discord_id ? `<@${fac.lead_discord_id}> ` : '';
}

// ── FACTION LIST ──────────────────────────────────────────────────────────────

export async function getFactions() {
  try {
    await requireActor(1);
    const factions = query(`SELECT f.*,
      COALESCE((SELECT COUNT(*) FROM scene_logs sl WHERE sl.faction_id = f.id), 0) as allTime,
      COALESCE((SELECT COUNT(*) FROM scene_logs sl WHERE sl.faction_id = f.id AND sl.created_at >= datetime('now', '-30 days')), 0) as scenes30d
      FROM factions f WHERE f.archived = 0 ORDER BY f.name`);
    const staff = query("SELECT * FROM staff WHERE discord_id != '' ORDER BY team_id, rank");

    const teamMap = {};
    const leadTeam = {};
    staff.forEach(s => {
      if (!s.team_id) return;
      if (!teamMap[s.team_id]) teamMap[s.team_id] = { name: s.team_name || '', leads: [], guides: [] };
      if (s.rank.toLowerCase().includes('lead')) { teamMap[s.team_id].leads.push(s.discord_id); leadTeam[s.discord_id] = s.team_id; }
      else if (s.rank.toLowerCase().includes('guide')) teamMap[s.team_id].guides.push(s.discord_id);
    });

    const allIds = new Set();
    factions.forEach(f => { if (f.lead_discord_id) allIds.add(f.lead_discord_id); });
    staff.forEach(s => allIds.add(s.discord_id));
    const names = await resolveNames(allIds);

    // Authorized imports per faction (bulk) — lets the list show only the NEW
    // imports a staged promotion grants, not the faction's whole import set.
    const authByFaction = {};
    const fIds = factions.map(f => f.id);
    if (fIds.length) {
      const ph = fIds.map(() => '?').join(',');
      query(`SELECT fi.faction_id, i.name FROM faction_imports fi JOIN import_items i ON i.id = fi.item_id WHERE fi.faction_id IN (${ph}) AND fi.permitted = 1`, fIds)
        .forEach(r => { (authByFaction[r.faction_id] = authByFaction[r.faction_id] || []).push(r.name); });
    }

    return factions.map(f => {
      const tid = leadTeam[f.lead_discord_id] || '';
      const team = teamMap[tid] || { name: '', leads: [], guides: [] };
      return {
        id: f.id, name: f.name, tier: f.tier, lastPromoted: f.last_promoted || 'N/A',
        leadId: f.lead_discord_id, leadName: names[f.lead_discord_id] || f.lead_discord_id || 'Unassigned',
        teamId: tid, teamName: team.name,
        guidesText: team.guides.map(id => names[id] || id).join(' • ') || 'None',
        guideIds: team.guides,
        discord: f.discord_url, forum: f.forum_url, threadId: f.thread_id,
        pendingPromo: f.pending_promo, authorizedItems: authByFaction[f.id] || [],
        scenes30d: f.scenes30d, allTime: f.allTime,
        forumPosts: f.forum_posts_30d || 0,
      };
    });
  } catch (e) { console.error("getFactions:", e); return []; }
}

// ── FACTION DETAIL ────────────────────────────────────────────────────────────

export async function getFactionDetail(factionName) {
  try {
    await requireActor(1);
    const f = queryOne("SELECT * FROM factions WHERE name = ?", [factionName]);
    if (!f) return null;
    const members    = query("SELECT id, character_name, phone, residence, is_leader FROM faction_members WHERE faction_id = ?", [f.id]);
    const properties = query("SELECT id, address, is_hq, property_type FROM properties WHERE faction_id = ?", [f.id]);
    const sceneLogs  = query("SELECT id, date, rewards, logged_by, notes, author_id FROM scene_logs WHERE faction_id = ? ORDER BY created_at DESC LIMIT 50", [f.id]);
    const notes      = query("SELECT id, text, author, author_id, date FROM intel_notes WHERE faction_id = ? ORDER BY created_at DESC LIMIT 50", [f.id]);
    const oocNotes   = query("SELECT id, date, author, author_id, text FROM ooc_notes WHERE faction_id = ? ORDER BY created_at DESC LIMIT 50", [f.id]);
    const history    = query("SELECT id, action_type, details, authorized_by, created_at FROM faction_history WHERE faction_id = ? ORDER BY created_at DESC LIMIT 50", [f.id]);
    const allItems   = query("SELECT * FROM import_items ORDER BY tier, category, name");
    const perms      = query("SELECT item_id, permitted FROM faction_imports WHERE faction_id = ?", [f.id]);
    const permMap    = {};
    perms.forEach(p => { permMap[p.item_id] = p.permitted === 1; });
    const authorizedItems = allItems.filter(i => permMap[i.id]).map(i => i.name);

    return {
      id: f.id, name: f.name, tier: f.tier, lastPromoted: f.last_promoted,
      discord: f.discord_url, forum: f.forum_url, threadId: f.thread_id,
      pendingPromo: f.pending_promo, leadId: f.lead_discord_id,
      members: members.map(m => ({ ...m, isLeader: m.is_leader >= 1 })),
      properties: properties.map(p => ({ ...p, isHQ: p.is_hq === 1 })),
      sceneLogs, notes, oocNotes, history,
      allItems, authorizedItems,
    };
  } catch (e) { console.error("getFactionDetail:", e); return null; }
}

// ── FACTION CRUD ──────────────────────────────────────────────────────────────

export async function addFaction(data) {
  const actor = await requireActor(3, {allowEventTeam: true});
  try {
    const aliases = (data.aliases || '').trim();
    const result = run(
      "INSERT INTO factions (name, lead_discord_id, tier, last_promoted, thread_id, forum_url, discord_url, aliases) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [data.name, data.leadId || '', parseInt(data.tier) || 0, today(),
       data.threadId || '', data.forum || '', data.discord || '', aliases]
    );
    const factionId = result.lastInsertRowid;
    logAudit(actor.id, actor.name, 'CREATE', 'faction', factionId, data.name, `Created faction tier ${data.tier || 0}`);

    if (data.hqAddress?.trim()) {
      run("INSERT INTO properties (address, faction_id, property_type, is_hq) VALUES (?, ?, 'Property', 1)", [data.hqAddress.trim(), factionId]);
    }

    if (data.guildId?.trim()) {
      const existing = queryOne("SELECT id FROM bot_server_configs WHERE guild_id=?", [data.guildId.trim()]);
      if (!existing) {
        const configResult = run(
          "INSERT INTO bot_server_configs (guild_id, guild_name, faction_id, access_role_id, access_role_name, comms_channel_id, comms_channel_name) VALUES (?,?,?,?,?,?,?)",
          [data.guildId.trim(), data.guildName?.trim() || '', factionId,
           data.accessRoleId?.trim() || '', data.accessRoleName?.trim() || '',
           data.commsChannelId?.trim() || '', data.commsChannelName?.trim() || '']
        );
        const configId = configResult.lastInsertRowid;
        const watchRoles = [];
        for (const role of [{ id: data.guideRoleId?.trim(), name: 'ECRP Guide' }, { id: data.managementRoleId?.trim(), name: 'ECRP Management' }]) {
          if (role.id) {
            run("INSERT INTO bot_watch_roles (config_id, role_id, role_name) VALUES (?,?,?)", [configId, role.id, role.name]);
            watchRoles.push({ role_id: role.id, role_name: role.name });
          }
        }
        try {
          const { backfillGuildPings } = await import('../../../lib/backfillPings.js');
          backfillGuildPings(data.guildId.trim(), data.guildName?.trim() || data.guildId.trim(), configId, watchRoles)
            .catch(e => console.error('[BACKFILL]', e.message));
        } catch {}
      }
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function deleteFaction(factionId, factionName) {
  const actor = await requireActor(3, {allowEventTeam: true});
  try {
    run("UPDATE factions SET archived=1, archived_at=datetime('now') WHERE id=?", [factionId]);
    logAudit(actor.id, actor.name, 'ARCHIVE', 'faction', factionId, factionName, 'Faction archived');
    return { ok: true };
  } catch (e) { return { ok: false }; }
}

export async function updateFactionLinks(factionId, field, value) {
  const actor = await requireActor(2, {allowEventTeam: true});
  const cols = { discord: 'discord_url', forum: 'forum_url', thread: 'thread_id' };
  const col = cols[field];
  if (!col) return { ok: false };
  run(`UPDATE factions SET ${col} = ?, updated_at = datetime('now') WHERE id = ?`, [value, factionId]);
  logAudit(actor.id, actor.name, 'EDIT', 'faction', factionId, field, `Set ${field} to ${value}`);
  return { ok: true };
}

export async function renameFaction(factionId, oldName, newName) {
  const actor = await requireActor(3, {allowEventTeam: true});
  run("UPDATE factions SET name=?, updated_at=datetime('now') WHERE id=?", [newName, factionId]);
  run("UPDATE faction_history SET faction_name=? WHERE faction_id=?", [newName, factionId]);
  run("INSERT INTO faction_history (faction_id, faction_name, action_type, details, authorized_by) VALUES (?, ?, 'RENAME', ?, ?)",
    [factionId, newName, oldName + ' → ' + newName, actor.name]);
  logAudit(actor.id, actor.name, 'EDIT', 'faction', factionId, newName, 'Renamed from ' + oldName);
  return { ok: true };
}

export async function editFactionTier(factionId, tier) {
  const actor = await requireActor(3, {allowEventTeam: true});
  try {
    run("UPDATE factions SET tier = ?, updated_at = datetime('now') WHERE id = ?", [tier, factionId]);
    logAudit(actor.id, actor.name, 'EDIT', 'faction', factionId, '', 'Tier set to ' + tier);
    return { ok: true };
  } catch (e) { return { ok: false }; }
}

export async function editFactionLead(factionId, leadId) {
  const actor = await requireActor(3, {allowEventTeam: true});
  try {
    run("UPDATE factions SET lead_discord_id = ?, updated_at = datetime('now') WHERE id = ?", [leadId, factionId]);
    logAudit(actor.id, actor.name, 'EDIT', 'faction', factionId, '', 'Lead set to ' + leadId);
    return { ok: true };
  } catch (e) { return { ok: false }; }
}

export async function setFactionAliases(factionId, aliases) {
  const actor = await requireActor(3, {allowEventTeam: true});
  run("UPDATE factions SET aliases=? WHERE id=?", [aliases, factionId]);
  logAudit(actor.id, actor.name, 'EDIT', 'faction_aliases', factionId, aliases, '');
  return { ok: true };
}

export async function restoreFaction(id) {
  const actor = await requireActor(3, {allowEventTeam: true});
  run("UPDATE factions SET archived=0, archived_at='' WHERE id=?", [id]);
  const f = queryOne("SELECT name FROM factions WHERE id=?", [id]);
  logAudit(actor.id, actor.name, 'RESTORE', 'faction', id, f?.name || '', 'Restored from archive');
  return { ok: true };
}

export async function getArchivedFactions() {
  await requireActor(1);
  const factions = query("SELECT * FROM factions WHERE archived = 1 ORDER BY archived_at DESC");
  if (factions.length === 0) return [];
  const ids = factions.map(f => f.id);
  const ph  = ids.map(() => '?').join(',');
  const leadIds = factions.map(f => f.lead_discord_id).filter(Boolean);
  const leadPh  = leadIds.length ? leadIds.map(() => '?').join(',') : "'__none__'";

  const members  = query(`SELECT faction_id, character_name, phone, residence, is_leader FROM faction_members WHERE faction_id IN (${ph}) ORDER BY is_leader DESC, character_name`, ids);
  const sceneCts = query(`SELECT faction_id, COUNT(*) as c FROM scene_logs WHERE faction_id IN (${ph}) GROUP BY faction_id`, ids);
  const history  = query(`SELECT * FROM faction_history WHERE faction_id IN (${ph}) ORDER BY created_at DESC`, ids);
  const notes    = query(`SELECT faction_id, text, author, date FROM intel_notes WHERE faction_id IN (${ph}) ORDER BY created_at DESC`, ids);
  const props    = query(`SELECT faction_id, address, is_hq FROM properties WHERE faction_id IN (${ph})`, ids);
  const imports  = query(`SELECT fi.faction_id, i.name, i.tier FROM import_items i JOIN faction_imports fi ON fi.item_id = i.id WHERE fi.faction_id IN (${ph}) AND fi.permitted = 1 ORDER BY i.tier, i.name`, ids);
  const leads    = leadIds.length ? query(`SELECT discord_id, display_name, team_name FROM staff WHERE discord_id IN (${leadPh})`, leadIds) : [];

  const groupBy = (arr, key) => arr.reduce((m, r) => { (m[r[key]] = m[r[key]] || []).push(r); return m; }, {});
  const memberMap  = groupBy(members, 'faction_id');
  const sceneMap   = Object.fromEntries(sceneCts.map(r => [r.faction_id, r.c]));
  const historyMap = groupBy(history, 'faction_id');
  const notesMap   = groupBy(notes, 'faction_id');
  const propsMap   = groupBy(props, 'faction_id');
  const importsMap = groupBy(imports, 'faction_id');
  const leadMap    = Object.fromEntries(leads.map(l => [l.discord_id, l]));

  return factions.map(f => ({
    ...f,
    memberCount: (memberMap[f.id] || []).length,
    members:     memberMap[f.id] || [],
    sceneCount:  sceneMap[f.id]  || 0,
    history:     (historyMap[f.id] || []).slice(0, 20),
    notes:       (notesMap[f.id]   || []).slice(0, 10),
    properties:  propsMap[f.id]   || [],
    imports:     importsMap[f.id] || [],
    leadName:    leadMap[f.lead_discord_id]?.display_name || 'Unknown',
    teamName:    leadMap[f.lead_discord_id]?.team_name    || 'Unknown',
  }));
}

// ── MEMBERS ───────────────────────────────────────────────────────────────────

export async function addMember(factionId, factionName, data) {
  const actor = await requireActor(1, {allowEventTeam: true});
  const level = data.role !== undefined ? parseInt(data.role) : (data.isLeader ? 1 : 0);
  run("INSERT INTO faction_members (faction_id, character_name, phone, residence, is_leader) VALUES (?, ?, ?, ?, ?)",
    [factionId, data.name, data.phone || 'N/A', data.residence || 'N/A', level]);
  logAudit(actor.id, actor.name, 'CREATE', 'member', null, data.name, `Added to ${factionName}`);
  run("INSERT INTO faction_history (faction_id, faction_name, action_type, details, authorized_by) VALUES (?, ?, 'MEMBER_ADDED', ?, ?)",
    [factionId, factionName, `Added ${data.name}`, actor.name]);
  return { ok: true };
}

export async function updateMember(memberId, data) {
  const actor = await requireActor(1, {allowEventTeam: true});
  const level = data.role !== undefined ? parseInt(data.role) : (data.isLeader ? 1 : 0);
  run("UPDATE faction_members SET character_name = ?, phone = ?, residence = ?, is_leader = ?, updated_at = datetime('now') WHERE id = ?",
    [data.name, data.phone, data.residence, level, memberId]);
  logAudit(actor.id, actor.name, 'EDIT', 'member', memberId, data.name, 'Updated member');
  return { ok: true };
}

export async function deleteMember(memberId, memberName, factionId, factionName) {
  const actor = await requireActor(1, {allowEventTeam: true});
  run("DELETE FROM faction_members WHERE id = ?", [memberId]);
  logAudit(actor.id, actor.name, 'DELETE', 'member', memberId, memberName, `Removed from ${factionName}`);
  run("INSERT INTO faction_history (faction_id, faction_name, action_type, details, authorized_by) VALUES (?, ?, 'MEMBER_REMOVED', ?, ?)",
    [factionId, factionName, `Removed ${memberName}`, actor.name]);
  return { ok: true };
}

// ── PROPERTIES ────────────────────────────────────────────────────────────────

export async function addFactionProperty(factionId, factionName, data) {
  const actor = await requireActor(1, {allowEventTeam: true});
  run("INSERT INTO properties (faction_id, address, property_type, is_hq, date_given) VALUES (?, ?, ?, ?, ?)",
    [factionId, data.address, data.type || 'Property', data.isHQ ? 1 : 0, today()]);
  logAudit(actor.id, actor.name, 'CREATE', 'property', null, data.address, `Assigned to ${factionName}`);
  run("INSERT INTO faction_history (faction_id, faction_name, action_type, details, authorized_by) VALUES (?, ?, 'PROPERTY_ADDED', ?, ?)",
    [factionId, factionName, `Added property: ${data.address}`, actor.name]);
  return { ok: true };
}

export async function editFactionProperty(propId, data) {
  const actor = await requireActor(1, {allowEventTeam: true});
  try {
    run("UPDATE properties SET address = ?, property_type = ?, is_hq = ?, updated_at = datetime('now') WHERE id = ?",
      [data.address, data.type || 'Property', data.isHQ ? 1 : 0, propId]);
    logAudit(actor.id, actor.name, 'EDIT', 'property', propId, data.address, '');
    return { ok: true };
  } catch (e) { return { ok: false }; }
}

export async function deleteFactionProperty(propId, factionName) {
  const actor = await requireActor(1, {allowEventTeam: true});
  try {
    run("DELETE FROM properties WHERE id = ?", [propId]);
    logAudit(actor.id, actor.name, 'DELETE', 'property', propId, '', 'Removed from ' + factionName);
    return { ok: true };
  } catch (e) { return { ok: false }; }
}

// ── NOTES ─────────────────────────────────────────────────────────────────────

export async function addNote(factionId, factionName, text) {
  const actor = await requireActor(1, {allowEventTeam: true});
  run("INSERT INTO intel_notes (faction_id, text, author, author_id, date) VALUES (?, ?, ?, ?, ?)",
    [factionId, text, actor.name, actor.id, today()]);
  logAudit(actor.id, actor.name, 'CREATE', 'intel_note', null, factionName, text.substring(0, 100));
  return { ok: true };
}

export async function editNote(noteId, text) {
  const actor = await requireActor(1, {allowEventTeam: true});
  run("UPDATE intel_notes SET text = ? WHERE id = ?", [text, noteId]);
  logAudit(actor.id, actor.name, 'EDIT', 'intel_note', noteId, '', text.substring(0, 100));
  return { ok: true };
}

export async function addOOCNote(factionId, factionName, text, attendeeIds) {
  const actor = await requireActor(2, {allowEventTeam: true});
  const attendees = JSON.stringify(Array.isArray(attendeeIds) ? attendeeIds : []);
  run("INSERT INTO ooc_notes (faction_id, date, author, author_id, text, attendees_json) VALUES (?, ?, ?, ?, ?, ?)",
    [factionId, today(), actor.name, actor.id, text, attendees]);
  logAudit(actor.id, actor.name, 'CREATE', 'ooc_note', null, factionName, `OOC meeting note added (${attendeeIds?.length || 0} attendees)`);
  return { ok: true };
}

export async function editOOCNote(noteId, text) {
  const actor = await requireActor(2, {allowEventTeam: true});
  run("UPDATE ooc_notes SET text = ? WHERE id = ?", [text, noteId]);
  logAudit(actor.id, actor.name, 'EDIT', 'ooc_note', noteId, '', 'OOC note edited');
  return { ok: true };
}

export async function editSceneLog(logId, notes) {
  const actor = await requireActor(2, {allowEventTeam: true});
  run("UPDATE scene_logs SET notes = ? WHERE id = ?", [notes, logId]);
  logAudit(actor.id, actor.name, 'EDIT', 'scene_log', logId, '', notes.substring(0, 100));
  return { ok: true };
}

export async function editFactionSceneRewards(logId, rewards) {
  const actor = await requireActor(3, {allowEventTeam: true});
  try {
    run("UPDATE scene_logs SET rewards = ? WHERE id = ?", [rewards, logId]);
    logAudit(actor.id, actor.name, 'EDIT', 'scene_log', logId, '', 'Rewards updated');
    return { ok: true };
  } catch (e) { return { ok: false }; }
}

// ── AUDIT TRAIL ───────────────────────────────────────────────────────────────

export async function editAuditEntry(entryId, details) {
  const actor = await requireActor(3, {allowEventTeam: true});
  try {
    run("UPDATE faction_history SET details = ? WHERE id = ?", [details, entryId]);
    logAudit(actor.id, actor.name, 'EDIT', 'faction_history', entryId, '', details.substring(0,100));
    return { ok: true };
  } catch (e) { return { ok: false }; }
}

export async function deleteAuditEntry(entryId) {
  const actor = await requireActor(3, {allowEventTeam: true});
  try {
    run("DELETE FROM faction_history WHERE id = ?", [entryId]);
    logAudit(actor.id, actor.name, 'DELETE', 'faction_history', entryId, '', '');
    return { ok: true };
  } catch (e) { return { ok: false }; }
}

// ── DELETION REQUESTS ─────────────────────────────────────────────────────────

export async function requestDeletion(contentType, originalText, targetId) {
  const actor = await requireActor(1, {allowEventTeam: true});
  run("INSERT INTO deletion_requests (requested_by, discord_id, content_type, original_text, target_row_id, target_table) VALUES (?, ?, ?, ?, ?, ?)",
    [actor.name, actor.id, contentType, originalText, targetId, contentType]);
  logAudit(actor.id, actor.name, 'DELETE_REQUEST', contentType, targetId, '', originalText.substring(0, 100));
  return { ok: true };
}

export async function directDelete(type, id) {
  const actor = await requireActor(3, {allowEventTeam: true});
  const tables = { intel_note: 'intel_notes', scene_log: 'scene_logs', ooc_note: 'ooc_notes' };
  const table = tables[type];
  if (!table) return { ok: false };
  run(`DELETE FROM ${table} WHERE id = ?`, [id]);
  logAudit(actor.id, actor.name, 'DELETE', type, id, '', 'L3 direct delete');
  return { ok: true };
}

// ── IMPORTS ───────────────────────────────────────────────────────────────────

export async function getFactionImports(factionId) {
  await requireActor(1);
  const allItems = query("SELECT * FROM import_items ORDER BY tier, name");
  const authorized = query("SELECT item_id FROM faction_imports WHERE faction_id = ? AND permitted = 1", [factionId]);
  const authSet = new Set(authorized.map(a => a.item_id));
  return allItems.map(item => ({ ...item, permitted: authSet.has(item.id) }));
}

export async function toggleFactionImport(factionId, itemId, permitted) {
  const actor = await requireActor(3, {allowEventTeam: true});
  const existing = queryOne("SELECT id FROM faction_imports WHERE faction_id = ? AND item_id = ?", [factionId, itemId]);
  if (existing) {
    run("UPDATE faction_imports SET permitted = ? WHERE id = ?", [permitted ? 1 : 0, existing.id]);
  } else {
    run("INSERT INTO faction_imports (faction_id, item_id, permitted) VALUES (?, ?, ?)", [factionId, itemId, permitted ? 1 : 0]);
  }
  const itemName = queryOne("SELECT name FROM import_items WHERE id = ?", [itemId])?.name || '';
  const factionName = queryOne("SELECT name FROM factions WHERE id = ?", [factionId])?.name || '';
  logAudit(actor.id, actor.name, permitted ? 'AUTHORIZE' : 'REVOKE', 'faction_import', factionId, factionName, (permitted ? 'Added: ' : 'Removed: ') + itemName);
  return { ok: true };
}

export async function bulkSetFactionImports(factionId, itemIds) {
  const actor = await requireActor(3, {allowEventTeam: true});
  transaction(() => {
    run("DELETE FROM faction_imports WHERE faction_id = ?", [factionId]);
    for (const itemId of itemIds) {
      run("INSERT INTO faction_imports (faction_id, item_id, permitted) VALUES (?, ?, 1)", [factionId, itemId]);
    }
  });
  const factionName = queryOne("SELECT name FROM factions WHERE id = ?", [factionId])?.name || '';
  logAudit(actor.id, actor.name, 'EDIT', 'faction_imports', factionId, factionName, itemIds.length + ' imports authorized');
  return { ok: true };
}

// ── PORTAL ────────────────────────────────────────────────────────────────────

export async function getFactionPortalMessages(factionId) {
  await requireActor(1, {allowEventTeam: true});
  return query("SELECT * FROM faction_public_messages WHERE faction_id=? ORDER BY is_pinned DESC, created_at DESC LIMIT 20", [factionId]);
}

export async function postPortalMessage(factionId, factionName, message, pin) {
  const actor = await requireActor(1, {allowEventTeam: true});
  run("INSERT INTO faction_public_messages (faction_id, faction_name, author_name, author_id, message, is_pinned) VALUES (?,?,?,?,?,?)",
    [factionId, factionName, actor.name, actor.id, message.trim(), pin ? 1 : 0]);
  logAudit(actor.id, actor.name, 'CREATE', 'portal_message', null, factionName, message.substring(0, 80));
  return { ok: true };
}

export async function deletePortalMessage(messageId) {
  const actor = await requireActor(1, {allowEventTeam: true});
  const msg = queryOne("SELECT * FROM faction_public_messages WHERE id=?", [messageId]);
  if (!msg) return { ok: false };
  if (msg.author_id !== actor.id && actor.level < 3) return { ok: false, error: 'Not yours.' };
  run("DELETE FROM faction_public_messages WHERE id=?", [messageId]);
  logAudit(actor.id, actor.name, 'DELETE', 'portal_message', messageId, msg.faction_name, '');
  return { ok: true };
}

export async function togglePortalMessagePin(messageId) {
  await requireActor(1, {allowEventTeam: true});
  const msg = queryOne("SELECT is_pinned FROM faction_public_messages WHERE id=?", [messageId]);
  if (!msg) return { ok: false };
  run("UPDATE faction_public_messages SET is_pinned=? WHERE id=?", [msg.is_pinned ? 0 : 1, messageId]);
  return { ok: true };
}

export async function getFactionContacts(factionId) {
  await requireActor(1, {allowEventTeam: true});
  return query("SELECT * FROM faction_ic_contacts WHERE faction_id=? ORDER BY submitted_at DESC LIMIT 50", [factionId]);
}

export async function markContactRead(contactId) {
  await requireActor(1, {allowEventTeam: true});
  run("UPDATE faction_ic_contacts SET is_read=1 WHERE id=?", [contactId]);
  return { ok: true };
}

// ── PROMOTION WORKFLOW ────────────────────────────────────────────────────────

export async function stagePromotion(factionId, factionName, tier, importNames) {
  const actor = await requireActor(3, {allowEventTeam: true});
  const payload = JSON.stringify({ tier, imports: importNames });
  run("UPDATE factions SET pending_promo = ?, updated_at = datetime('now') WHERE id = ?", [payload, factionId]);
  run("INSERT INTO faction_history (faction_id, faction_name, action_type, details, authorized_by) VALUES (?, ?, 'PROMO_STAGED', ?, ?)",
    [factionId, factionName, `Staged for Tier ${tier}`, actor.name]);
  logAudit(actor.id, actor.name, 'PROMOTE', 'faction', factionId, factionName, `Staged promotion to T${tier}`);
  const leadPing = await getLeadPing(factionId);
  const ch = getChannel('team_lead_channel');
  await sendDiscord(ch, `${leadPing}📋 **Pending Promotion** — **${factionName}** → Tier ${tier}\nStaged by: ${actor.name}\nAwaiting RP confirmation.`);
  return { ok: true };
}

export async function completePromotion(factionId, factionName) {
  const actor = await requireActor(2, {allowEventTeam: true, allowLeadStoryteller: true});
  const fac = queryOne("SELECT pending_promo FROM factions WHERE id = ?", [factionId]);
  if (!fac?.pending_promo) return { ok: false, error: "No pending promotion" };
  try {
    const payload  = JSON.parse(fac.pending_promo);
    const newTier  = parseInt(payload.tier);
    const items    = query("SELECT id, name FROM import_items");
    transaction(() => {
      run("UPDATE factions SET tier = ?, last_promoted = ?, pending_promo = NULL, updated_at = datetime('now') WHERE id = ?",
        [newTier, today(), factionId]);
      items.forEach(item => {
        const permitted = payload.imports.includes(item.name) ? 1 : 0;
        run("INSERT INTO faction_imports (faction_id, item_id, permitted) VALUES (?, ?, ?) ON CONFLICT(faction_id, item_id) DO UPDATE SET permitted = ?",
          [factionId, item.id, permitted, permitted]);
      });
      run("INSERT INTO faction_history (faction_id, faction_name, action_type, details, authorized_by) VALUES (?, ?, 'PROMOTED', ?, ?)",
        [factionId, factionName, `Promoted to Tier ${newTier}`, actor.name]);
    });
    logAudit(actor.id, actor.name, 'PROMOTE', 'faction', factionId, factionName, `Completed promotion to T${newTier}`);
    const leadPing = await getLeadPing(factionId);
    const ch = getChannel('team_lead_channel');
    const imports = Array.isArray(payload.imports) && payload.imports.length > 0
      ? `\n**Approved imports:** ${payload.imports.join(', ')}` : '';
    await sendDiscord(ch, `${leadPing}✅ **Promotion Complete** — **${factionName}** is now Tier ${newTier}\nCompleted by: ${actor.name}${imports}`);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function cancelPromotion(factionId, factionName) {
  const actor = await requireActor(2, {allowEventTeam: true});
  try {
    run("UPDATE factions SET pending_promo = NULL, updated_at = datetime('now') WHERE id = ?", [factionId]);
    run("INSERT INTO faction_history (faction_id, faction_name, action_type, details, authorized_by) VALUES (?, ?, 'PROMO_CANCELLED', 'Staged promotion cancelled', ?)",
      [factionId, factionName, actor.name]);
    logAudit(actor.id, actor.name, 'EDIT', 'faction', factionId, factionName, 'Promotion cancelled');
    const leadPing = await getLeadPing(factionId);
    const ch = getChannel('team_lead_channel');
    await sendDiscord(ch, `${leadPing}❌ **Promotion Cancelled** — **${factionName}**\nCancelled by: ${actor.name}`);
    return { ok: true };
  } catch (e) { return { ok: false }; }
}

export async function demoteFaction(factionId, factionName, newTier) {
  const actor = await requireActor(3, {allowEventTeam: true});
  run("UPDATE factions SET tier = ?, updated_at = datetime('now') WHERE id = ?", [newTier, factionId]);
  run("INSERT INTO faction_history (faction_id, faction_name, action_type, details, authorized_by) VALUES (?, ?, 'DEMOTED', ?, ?)",
    [factionId, factionName, `Demoted to Tier ${newTier}`, actor.name]);
  logAudit(actor.id, actor.name, 'DEMOTE', 'faction', factionId, factionName, `Demoted to T${newTier}`);
  const leadPing = await getLeadPing(factionId);
  const ch = getChannel('team_lead_channel');
  await sendDiscord(ch, `${leadPing}⬇️ **Demotion** — **${factionName}** → Tier ${newTier}\nBy: ${actor.name}`);
  return { ok: true };
}

// ── RP CHANGES ────────────────────────────────────────────────────────────────

export async function requestRPChange(data) {
  const actor = await requireActor(2, {allowEventTeam: true, allowLeadStoryteller: true});
  const fac = queryOne("SELECT id FROM factions WHERE name = ?", [data.faction]);
  if (!fac) return { ok: false };
  run("INSERT INTO pending_executions (date, faction_id, execution_type, turf, old_value, new_value, requested_by, requester_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [today(), fac.id, data.type, data.turf || 'N/A', data.oldValue || 'N/A', data.newValue, actor.name, actor.id]);
  logAudit(actor.id, actor.name, 'CREATE', 'rp_change', null, data.faction, `${data.type}: ${data.oldValue} → ${data.newValue}`);
  const ch = getChannel('leadership_channel');
  let msg = `🔔 **RP Change Request**\n**Faction:** ${data.faction}\n**Type:** ${data.type}\n**Requested By:** ${actor.name}`;
  if (data.type === 'NPC') msg += `\n**Turf:** ${data.turf}\n**Current:** ${data.oldValue}\n**New:** ${data.newValue}`;
  else if (data.type === 'HQ') msg += `\n**Old Address:** ${data.oldValue}\n**New Address:** ${data.newValue}`;
  else msg += `\n**Details:** ${data.newValue}`;
  await sendDiscord(ch, msg);
  return { ok: true };
}

export async function getNPCsForRP() {
  await requireActor(2, {allowEventTeam: true, allowLeadStoryteller: true});
  return query("SELECT id, name, npc_type, turf, position FROM npcs ORDER BY turf, npc_type, name");
}

export async function getFactionProperties(factionId) {
  await requireActor(2, {allowEventTeam: true, allowLeadStoryteller: true});
  return query("SELECT id, address, is_hq, property_type FROM properties WHERE faction_id = ? ORDER BY address", [factionId]);
}

// ── AI SUMMARY ────────────────────────────────────────────────────────────────

export async function aiSummarize(factionName) {
  await requireActor(3, {allowEventTeam: true});
  if (!process.env.OPENAI_API_KEY) return { ok: false, error: "No API key" };
  const fac = queryOne("SELECT id FROM factions WHERE name = ?", [factionName]);
  if (!fac) return { ok: false, error: "Faction not found" };
  const logs  = query("SELECT date, rewards, logged_by, notes FROM scene_logs WHERE faction_id = ? ORDER BY created_at DESC LIMIT 30", [fac.id]);
  const notes = query("SELECT date, author, text FROM intel_notes WHERE faction_id = ? ORDER BY created_at DESC LIMIT 20", [fac.id]);
  if (logs.length === 0 && notes.length === 0) return { ok: false, error: "No data to summarize" };
  const input = `Faction: ${factionName}\n\n=== SCENE LOGS ===\n${logs.map(l => `[${l.date}] ${l.logged_by}: ${l.notes} | Rewards: ${l.rewards}`).join('\n')}\n\n=== NOTES ===\n${notes.map(n => `[${n.date}] ${n.author}: ${n.text}`).join('\n')}`;
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [
        { role: "system", content: "You are a Faction Management analyst for a GTA RP server. Provide a concise intelligence brief: 1) Executive Summary, 2) Key Personnel, 3) Recent Activity, 4) Concerns, 5) Recommended Actions." },
        { role: "user", content: input }
      ] })
    });
    const data = await r.json();
    return { ok: true, summary: data.choices?.[0]?.message?.content || "No response" };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ── FACTION LIST HELPERS ──────────────────────────────────────────────────────

export async function getFactionNames() {
  await requireActor(1);
  return query("SELECT name FROM factions WHERE archived = 0 ORDER BY name").map(r => r.name);
}

export async function getStaffForTeam(factionName) {
  await requireActor(1);
  const fac = queryOne("SELECT lead_discord_id FROM factions WHERE name = ?", [factionName]);
  if (!fac) return [];
  const leadTeamId = queryOne("SELECT team_id FROM staff WHERE discord_id = ?", [fac.lead_discord_id])?.team_id;
  if (!leadTeamId) return [];
  return query("SELECT discord_id, display_name, rank FROM staff WHERE team_id = ? AND discord_id != ''", [leadTeamId]);
}
