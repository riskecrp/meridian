"use server";
import { query, queryOne, run } from "../../../lib/db.js";
import { logAudit } from "../../../lib/audit.js";
import { requireActor } from "../../../lib/requireActor.js";
import { sendDiscord } from "../../../lib/discord.js";

// ── KNOWLEDGE BASE — Get L1+, Mutate L2+ ──
export async function getLoreEntries() {
  await requireActor(1, {allowEventTeam: true});
  return query("SELECT * FROM knowledge_base WHERE entry_type = 'lore' ORDER BY category, title");
}
export async function getCommandEntries() {
  await requireActor(1, {allowEventTeam: true});
  return query("SELECT * FROM knowledge_base WHERE entry_type = 'command' ORDER BY category, title");
}
export async function addKBEntry(data, type) {
  const actor = await requireActor(2, {allowEventTeam: true});
  run("INSERT INTO knowledge_base (category, title, content, added_by, notes, entry_type) VALUES (?, ?, ?, ?, ?, ?)",
    [data.category, data.title, data.content, actor.name, data.notes || '', type]);
  logAudit(actor.id, actor.name, 'CREATE', 'knowledge_base', null, data.title, `Type: ${type}`);
  return { ok: true };
}
export async function editKBEntry(id, data) {
  const actor = await requireActor(2, {allowEventTeam: true});
  run("UPDATE knowledge_base SET category=?, title=?, content=?, notes=?, updated_at=datetime('now') WHERE id=?",
    [data.category, data.title, data.content, data.notes||'', id]);
  logAudit(actor.id, actor.name, 'EDIT', 'knowledge_base', id, data.title, '');
  return { ok: true };
}
export async function deleteKBEntry(id) {
  const actor = await requireActor(2, {allowEventTeam: true});
  run("DELETE FROM knowledge_base WHERE id=?", [id]);
  logAudit(actor.id, actor.name, 'DELETE', 'knowledge_base', id, '', '');
  return { ok: true };
}

// ── NPCs / TURFS — All L2+ (visibility) and L3 (mutation) ──
export async function getNPCs() {
  await requireActor(2, {allowEventTeam: true, allowLeadStoryteller: true});
  return query("SELECT * FROM npcs ORDER BY turf, name");
}
export async function getNpcTypes() {
  await requireActor(2, {allowEventTeam: true});
  return query("SELECT DISTINCT npc_type FROM npcs WHERE npc_type IS NOT NULL AND npc_type != '' ORDER BY npc_type").map(r => r.npc_type);
}
export async function getTurfs() {
  await requireActor(2, {allowEventTeam: true, allowLeadStoryteller: true});
  return query("SELECT * FROM turfs ORDER BY name");
}
// Materialize a turf as a first-class row so it persists even with no NPCs.
function _ensureTurf(name, power) {
  const t = (name || '').trim();
  if (!t || t === 'Neutral' || t === 'Unaffiliated') return;
  const ex = queryOne("SELECT id FROM turfs WHERE LOWER(TRIM(name))=LOWER(TRIM(?))", [t]);
  if (!ex) run("INSERT INTO turfs (name, shipment_power) VALUES (?, ?)", [t, power || '']);
}
export async function addNPC(data) {
  const actor = await requireActor(3, {allowEventTeam: true});
  const claimable = (!data.turf || data.turf === 'Neutral') ? 0 : 1;
  run("INSERT INTO npcs (name, position, npc_type, turf, shipment_power, claimable) VALUES (?, ?, ?, ?, ?, ?)",
    [data.name, data.position, data.type, data.turf || 'Unaffiliated', data.shipmentPower || '', claimable]);
  _ensureTurf(data.turf, data.shipmentPower);
  logAudit(actor.id, actor.name, 'CREATE', 'npc', null, data.name, `Type: ${data.type}, Turf: ${data.turf}`);
  return { ok: true };
}
export async function editNPC(id, data) {
  const actor = await requireActor(3, {allowEventTeam: true});
  const claimable = (!data.turf || data.turf === 'Neutral') ? 0 : 1;
  run("UPDATE npcs SET name=?, position=?, npc_type=?, turf=?, shipment_power=?, claimable=?, updated_at=datetime('now') WHERE id=?",
    [data.name, data.position, data.type, data.turf, data.shipmentPower||'', claimable, id]);
  _ensureTurf(data.turf, data.shipmentPower);
  logAudit(actor.id, actor.name, 'EDIT', 'npc', id, data.name, `Type: ${data.type}`);
  return { ok: true };
}
export async function deleteNPC(id) {
  const actor = await requireActor(3, {allowEventTeam: true});
  run("DELETE FROM npcs WHERE id=?", [id]);
  logAudit(actor.id, actor.name, 'DELETE', 'npc', id, '', '');
  return { ok: true };
}
export async function updateTurf(oldTurf, newTurf, power) {
  const actor = await requireActor(3, {allowEventTeam: true});
  const name = (newTurf || '').trim();
  if (!name) return { ok: false, error: 'Turf name required' };
  const pwr = power || '';

  // Create path: no oldTurf means the "+ Turf" button — insert a new standalone turf.
  if (!(oldTurf || '').trim()) {
    const existing = queryOne("SELECT id FROM turfs WHERE LOWER(TRIM(name))=LOWER(TRIM(?))", [name]);
    if (existing) run("UPDATE turfs SET shipment_power=? WHERE id=?", [pwr, existing.id]);
    else run("INSERT INTO turfs (name, shipment_power) VALUES (?, ?)", [name, pwr]);
    logAudit(actor.id, actor.name, 'CREATE', 'turf', null, name, `Power: ${pwr}`);
    return { ok: true };
  }

  // Edit/rename path. Guard against renaming onto an existing turf (merge instead of UNIQUE error).
  if (oldTurf.trim().toLowerCase() !== name.toLowerCase()) {
    const clash = queryOne("SELECT id FROM turfs WHERE LOWER(TRIM(name))=LOWER(TRIM(?))", [name]);
    if (clash) {
      run("DELETE FROM turfs WHERE LOWER(TRIM(name))=LOWER(TRIM(?))", [oldTurf]);
      run("UPDATE turfs SET shipment_power=? WHERE id=?", [pwr, clash.id]);
    } else {
      run("UPDATE turfs SET name=?, shipment_power=? WHERE LOWER(TRIM(name))=LOWER(TRIM(?))", [name, pwr, oldTurf]);
    }
  } else {
    run("UPDATE turfs SET shipment_power=? WHERE LOWER(TRIM(name))=LOWER(TRIM(?))", [pwr, oldTurf]);
  }
  // Ensure a row exists even if the turf previously lived only on NPC rows.
  if (!queryOne("SELECT id FROM turfs WHERE LOWER(TRIM(name))=LOWER(TRIM(?))", [name]))
    run("INSERT INTO turfs (name, shipment_power) VALUES (?, ?)", [name, pwr]);
  run("UPDATE npcs SET turf=?, shipment_power=?, updated_at=datetime('now') WHERE LOWER(TRIM(turf))=LOWER(TRIM(?))",
    [name, pwr, oldTurf]);
  logAudit(actor.id, actor.name, 'EDIT', 'turf', null, name, `Renamed/updated from ${oldTurf}`);
  return { ok: true };
}
export async function disbandTurf(turfName) {
  const actor = await requireActor(3, {allowEventTeam: true});
  run("DELETE FROM turfs WHERE LOWER(TRIM(name))=LOWER(TRIM(?))", [turfName]);
  run("UPDATE npcs SET turf='Unaffiliated', shipment_power='', claimable=1, updated_at=datetime('now') WHERE LOWER(TRIM(turf))=LOWER(TRIM(?))",
    [turfName]);
  logAudit(actor.id, actor.name, 'DELETE', 'turf', null, turfName, 'Turf disbanded');
  return { ok: true };
}

// ── SPAWN ITEMS — L3 only ──
export async function getSpawnItems() {
  await requireActor(3, {allowEventTeam: true});
  return query("SELECT id, category, name, game_id, item_type, extra FROM spawn_items ORDER BY category, name");
}
export async function addSpawnItem(data) {
  const actor = await requireActor(3, {allowEventTeam: true});
  run("INSERT INTO spawn_items (category, name, game_id, item_type, extra) VALUES (?, ?, ?, ?, ?)",
    [data.category||'', data.name, data.gameId||'', data.itemType||'item', data.extra||'']);
  logAudit(actor.id, actor.name, 'CREATE', 'spawn_item', null, data.name, '');
  return { ok: true };
}
export async function editSpawnItem(id, data) {
  const actor = await requireActor(3, {allowEventTeam: true});
  run("UPDATE spawn_items SET category=?, name=?, game_id=?, item_type=?, extra=?, created_at=datetime('now') WHERE id=?",
    [data.category||'', data.name, data.gameId||'', data.itemType||'item', data.extra||'', id]);
  logAudit(actor.id, actor.name, 'EDIT', 'spawn_item', id, data.name, '');
  return { ok: true };
}
export async function deleteSpawnItem(id) {
  const actor = await requireActor(3, {allowEventTeam: true});
  run("DELETE FROM spawn_items WHERE id=?", [id]);
  logAudit(actor.id, actor.name, 'DELETE', 'spawn_item', id, '', '');
  return { ok: true };
}

// ── LOADOUTS — Get L1+, Weapons L3, Ammo/Attach compat L2+ ──
export async function getLoadouts() {
  await requireActor(1, {allowEventTeam: true});
  const weapons = query("SELECT * FROM weapon_ammo ORDER BY weapon_category, weapon_name");
  const compat = query("SELECT * FROM weapon_ammo_compat ORDER BY ammo_type, ammo_name");
  const attachments = query("SELECT * FROM weapon_attachments ORDER BY attachment_name");
  const compatMap = {};
  compat.forEach(c => { if (!compatMap[c.weapon_id]) compatMap[c.weapon_id] = []; compatMap[c.weapon_id].push(c); });
  const attachMap = {};
  attachments.forEach(a => { if (!attachMap[a.weapon_id]) attachMap[a.weapon_id] = []; attachMap[a.weapon_id].push(a); });
  return weapons.map(w => ({ ...w, ammo: compatMap[w.id] || [], attachments: attachMap[w.id] || [] }));
}
export async function addWeapon(data) {
  const actor = await requireActor(3, {allowEventTeam: true});
  const r = run("INSERT INTO weapon_ammo (weapon_name, weapon_category, caliber) VALUES (?, ?, ?)",
    [data.name, data.category, data.caliber || '']);
  if (data.ammoNames && data.ammoNames.length > 0) {
    data.ammoNames.forEach(a => {
      let atype = 'Standard';
      for (const t of ['FMJ','HP','AP','Tracer']) { if (a.includes(t)) { atype = t; break; } }
      run("INSERT OR IGNORE INTO weapon_ammo_compat (weapon_id, ammo_name, ammo_type) VALUES (?, ?, ?)", [r.lastInsertRowid, a, atype]);
    });
  }
  logAudit(actor.id, actor.name, 'CREATE', 'weapon_ammo', null, data.name, '');
  return { ok: true };
}
export async function editWeapon(id, data) {
  const actor = await requireActor(3, {allowEventTeam: true});
  run("UPDATE weapon_ammo SET weapon_name=?, weapon_category=?, caliber=? WHERE id=?",
    [data.name, data.category, data.caliber || '', id]);
  logAudit(actor.id, actor.name, 'EDIT', 'weapon_ammo', id, data.name, '');
  return { ok: true };
}
export async function deleteWeapon(id) {
  const actor = await requireActor(3, {allowEventTeam: true});
  run("DELETE FROM weapon_ammo WHERE id=?", [id]);
  logAudit(actor.id, actor.name, 'DELETE', 'weapon_ammo', id, '', '');
  return { ok: true };
}
export async function addAmmoCompat(weaponId, ammoName) {
  const actor = await requireActor(2, {allowEventTeam: true});
  let atype = 'Standard';
  for (const t of ['FMJ','HP','AP','Tracer']) { if (ammoName.includes(t)) { atype = t; break; } }
  run("INSERT OR IGNORE INTO weapon_ammo_compat (weapon_id, ammo_name, ammo_type) VALUES (?, ?, ?)", [weaponId, ammoName, atype]);
  logAudit(actor.id, actor.name, 'CREATE', 'weapon_ammo_compat', null, ammoName, '');
  return { ok: true };
}
export async function removeAmmoCompat(compatId) {
  const actor = await requireActor(2, {allowEventTeam: true});
  run("DELETE FROM weapon_ammo_compat WHERE id=?", [compatId]);
  logAudit(actor.id, actor.name, 'DELETE', 'weapon_ammo_compat', compatId, '', '');
  return { ok: true };
}
export async function addAttachmentCompat(weaponId, attachmentName) {
  const actor = await requireActor(2, {allowEventTeam: true});
  run("INSERT OR IGNORE INTO weapon_attachments (weapon_id, attachment_name) VALUES (?, ?)", [weaponId, attachmentName]);
  logAudit(actor.id, actor.name, 'CREATE', 'weapon_attachment', null, attachmentName, '');
  return { ok: true };
}
export async function removeAttachmentCompat(attachId) {
  const actor = await requireActor(2, {allowEventTeam: true});
  run("DELETE FROM weapon_attachments WHERE id=?", [attachId]);
  logAudit(actor.id, actor.name, 'DELETE', 'weapon_attachment', attachId, '', '');
  return { ok: true };
}
export async function getAmmoList() {
  await requireActor(1, {allowEventTeam: true});
  return query("SELECT DISTINCT name FROM import_items WHERE category LIKE 'Ammo%' ORDER BY name").map(r => r.name);
}
export async function getAttachmentList() {
  await requireActor(1, {allowEventTeam: true});
  return query("SELECT DISTINCT name FROM import_items WHERE category LIKE 'Attachment%' ORDER BY name").map(r => r.name);
}
export async function getWeaponCategories() {
  await requireActor(1, {allowEventTeam: true});
  return query("SELECT DISTINCT weapon_category FROM weapon_ammo WHERE weapon_category != '' ORDER BY weapon_category").map(r => r.weapon_category);
}

// ── CHANGE LOG — Get L1+, Mutate L3 ──
export async function getChangeLogs() {
  await requireActor(1, {allowEventTeam: true});
  return query("SELECT * FROM change_log ORDER BY created_at DESC");
}
export async function addChangeLog(data) {
  const actor = await requireActor(3, {allowEventTeam: true});
  run("INSERT INTO change_log (change_type, name, position, action, blocked_off, notes, created_by, created_by_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [data.changeType, data.name, data.position || '', data.action || '', data.blockedOff ? 1 : 0, data.notes || '', actor.name, actor.id]);
  logAudit(actor.id, actor.name, 'CREATE', 'change_log', null, data.name, data.changeType);

  const token = process.env.DISCORD_BOT_TOKEN;
  const shouldPost = data.changeType === 'black_market_doctor' ? !!data.action : true;
  if (token && shouldPost) {
    let msg = '';
    if (data.changeType === 'black_market_doctor') {
      msg = '🏥 **Black Market Doctor ' + data.action + '**\n';
      msg += '**Name:** ' + data.name + '\n';
      msg += '**Location:** `/tppos ' + (data.position || 'N/A') + '`\n';
      if (data.action === 'Removed' && data.blockedOff) msg += '✅ Location has been blocked off\n';
      if (data.action === 'Removed' && !data.blockedOff) msg += '⚠️ Location has NOT been blocked off\n';
      if (data.notes) msg += '**Notes:** ' + data.notes;
    } else {
      msg = '📍 **Drop Location Added**\n';
      msg += '**Name:** ' + data.name + '\n';
      msg += '**Location:** `/tppos ' + (data.position || 'N/A') + '`';
    }
    msg += '\n*By: ' + actor.name + '*';
    try {
      await fetch('https://discord.com/api/v10/channels/1464415763577176208/messages', {
        method: 'POST',
        headers: { 'Authorization': 'Bot ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: msg, allowed_mentions: { parse: [] } })
      });
    } catch(e) { console.error('[ChangeLog Discord]', e.message); }
  }
  return { ok: true };
}
export async function editChangeLog(id, data) {
  const actor = await requireActor(3, {allowEventTeam: true});
  run("UPDATE change_log SET name=?, position=?, action=?, blocked_off=?, notes=?, change_type=? WHERE id=?",
    [data.name, data.position || '', data.action || '', data.blockedOff ? 1 : 0, data.notes || '', data.changeType || 'drop_location', id]);
  logAudit(actor.id, actor.name, 'EDIT', 'change_log', id, data.name, '');

  const token = process.env.DISCORD_BOT_TOKEN;
  if (token && data.changeType === 'black_market_doctor' && data.action) {
    let msg = '🏥 **Black Market Doctor ' + data.action + '** *(edited)*\n';
    msg += '**Name:** ' + data.name + '\n';
    msg += '**Location:** `/tppos ' + (data.position || 'N/A') + '`\n';
    if (data.action === 'Removed' && data.blockedOff) msg += '✅ Location has been blocked off\n';
    if (data.action === 'Removed' && !data.blockedOff) msg += '⚠️ Location has NOT been blocked off\n';
    if (data.notes) msg += '**Notes:** ' + data.notes;
    msg += '\n*By: ' + actor.name + '*';
    try {
      await fetch('https://discord.com/api/v10/channels/1464415763577176208/messages', {
        method: 'POST',
        headers: { 'Authorization': 'Bot ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: msg, allowed_mentions: { parse: [] } })
      });
    } catch(e) { console.error('[ChangeLog Discord]', e.message); }
  }
  return { ok: true };
}
export async function deleteChangeLog(id) {
  const actor = await requireActor(3, {allowEventTeam: true});
  const entry = queryOne("SELECT * FROM change_log WHERE id=?", [id]);
  run("DELETE FROM change_log WHERE id=?", [id]);
  logAudit(actor.id, actor.name, 'DELETE', 'change_log', id, entry?.name || '', '');

  const token = process.env.DISCORD_BOT_TOKEN;
  if (token && entry && entry.change_type === 'black_market_doctor') {
    let msg = '🏥 **Black Market Doctor Removed** *(deleted from log)*\n';
    msg += '**Name:** ' + entry.name + '\n';
    msg += '**Location:** `/tppos ' + (entry.position || 'N/A') + '`';
    msg += '\n*By: ' + actor.name + '*';
    try {
      await fetch('https://discord.com/api/v10/channels/1464415763577176208/messages', {
        method: 'POST',
        headers: { 'Authorization': 'Bot ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: msg, allowed_mentions: { parse: [] } })
      });
    } catch(e) { console.error('[ChangeLog Discord]', e.message); }
  }
  return { ok: true };
}

// ── SCENE LIBRARY ─────────────────────────────────────────────────────────────

export async function getSceneLibrary() {
  await requireActor(1, { allowEventTeam: true });
  return query("SELECT * FROM scene_library ORDER BY created_at DESC");
}

function _requireSceneWrite(actor, minLevel = 1) {
  if (actor.level < minLevel && !actor.isLeadStoryteller) {
    const e = new Error(`Insufficient clearance`);
    e.code = 'AUTH_INSUFFICIENT';
    throw e;
  }
}

export async function addSceneLibraryEntry(data) {
  // L1+, LST — not ET-only
  const actor = await requireActor(1);
  const result = run(
    "INSERT INTO scene_library (title, status, description, staff_required, spawning_required, spawning_details, ped_required, proposed_rewards, tags, created_by, created_by_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [data.title, 'idea', data.description || '',
     parseInt(data.staff_required) || 1, data.spawning_required ? 1 : 0, data.spawning_required ? (data.spawning_details || '') : '',
     data.ped_required ? 1 : 0, data.proposed_rewards || '', data.tags || '', actor.name, actor.id]
  );
  logAudit(actor.id, actor.name, 'CREATE', 'scene_library', result.lastInsertRowid, data.title, 'idea');

  const baseUrl = process.env.BASE_URL || 'https://ecrpfm.com';
  sendDiscord('1469503845095702692', null, [{
    title: 'New Scene Library Idea',
    description: `**${data.title}**${data.description ? `\n${data.description.substring(0, 200)}${data.description.length > 200 ? '…' : ''}` : ''}\n\n*Submitted by <@${actor.id}> — awaiting approval.*`,
    color: 0xc084fc,
    fields: [
      { name: 'Staff Required', value: String(parseInt(data.staff_required) || 1), inline: true },
      ...(data.spawning_required ? [{ name: 'Spawning', value: data.spawning_details || 'Yes', inline: true }] : []),
      ...(data.ped_required      ? [{ name: 'Peds', value: 'Required', inline: true }] : []),
      ...(data.proposed_rewards  ? [{ name: 'Proposed Rewards', value: data.proposed_rewards, inline: false }] : []),
    ],
    url: `${baseUrl}/fm/storytelling/library`,
    footer: { text: 'Meridian FM · Scene Library' },
    timestamp: new Date().toISOString(),
  }]);

  return { ok: true, id: result.lastInsertRowid };
}

export async function editSceneLibraryEntry(id, data) {
  // L2+, LST
  const actor = await requireActor(1);
  _requireSceneWrite(actor, 2);
  run(
    "UPDATE scene_library SET title=?, status=?, description=?, staff_required=?, spawning_required=?, spawning_details=?, ped_required=?, proposed_rewards=?, tags=?, updated_at=datetime('now') WHERE id=?",
    [data.title, data.status, data.description || '',
     parseInt(data.staff_required) || 1, data.spawning_required ? 1 : 0, data.spawning_required ? (data.spawning_details || '') : '',
     data.ped_required ? 1 : 0, data.proposed_rewards || '', data.tags || '', id]
  );
  logAudit(actor.id, actor.name, 'EDIT', 'scene_library', id, data.title, data.status);
  return { ok: true };
}

export async function deleteSceneLibraryEntry(id) {
  // L2+, LST
  const actor = await requireActor(1);
  _requireSceneWrite(actor, 2);
  const entry = queryOne("SELECT title FROM scene_library WHERE id = ?", [id]);
  run("DELETE FROM scene_library WHERE id = ?", [id]);
  logAudit(actor.id, actor.name, 'DELETE', 'scene_library', id, entry?.title || '', '');
  return { ok: true };
}

export async function getSceneLibraryFeedback(sceneId) {
  await requireActor(1, { allowEventTeam: true });
  return query("SELECT * FROM scene_library_feedback WHERE scene_id = ? ORDER BY created_at DESC", [sceneId]);
}

export async function addSceneLibraryFeedback(sceneId, feedbackText) {
  // L2+, LST — reviewers leave feedback on ideas awaiting approval
  const actor = await requireActor(1);
  _requireSceneWrite(actor, 2);

  const text = (feedbackText || '').trim();
  if (!text) {
    const e = new Error('Feedback text is required');
    e.code = 'VALIDATION';
    throw e;
  }

  const scene = queryOne("SELECT title, status, created_by_id FROM scene_library WHERE id = ?", [sceneId]);
  if (!scene) {
    const e = new Error('Scene not found');
    e.code = 'NOT_FOUND';
    throw e;
  }

  const result = run(
    "INSERT INTO scene_library_feedback (scene_id, feedback, created_by, created_by_id) VALUES (?,?,?,?)",
    [sceneId, text, actor.name, actor.id]
  );

  if (scene.status !== 'approved' && scene.created_by_id && scene.created_by_id !== actor.id) {
    const baseUrl = process.env.BASE_URL || 'https://ecrpfm.com';
    sendDiscord('1457201300583485491',
      `💬 <@${scene.created_by_id}> — **${actor.name}** left feedback on your scene idea **"${scene.title}"**:\n> ${text.substring(0, 350)}${text.length > 350 ? '…' : ''}\n\n🔗 ${baseUrl}/fm/storytelling/library`
    );
  }

  logAudit(actor.id, actor.name, 'FEEDBACK', 'scene_library', sceneId, scene.title, '');
  return { ok: true, id: result.lastInsertRowid };
}
