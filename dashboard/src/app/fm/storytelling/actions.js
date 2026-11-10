"use server";
// Storytelling / Library actions — Knowledge Base, NPC Ecosystem, Arsenal
// (loadouts + spawn commands), Change Log and the Scene Library idea workflow.
// Shared by the legacy /fm/storytelling pages and /v2/story.
//
// Gates (policy 3 + 4):
//   • Lead Storyteller reads the whole Library (every L1 read below passes
//     allowLeadStoryteller) and may only APPROVE scene ideas (setSceneLibraryStatus).
//   • Event Team has full rights on the scene library, spawn commands and the
//     change log; everywhere else it is read-only, so no other mutation passes
//     allowEventTeam.
//   • "Management" KB commands and spawn commands are L3 (or Event Team) content
//     and are filtered server-side, not just hidden in the UI.
//   • Weapons, ammo/attachment compatibility and KB entries are L2.
//   • NPCs and turfs are L3.
// Every mutation validates first and returns { ok:false, error } instead of
// letting SQLite throw; unknown ids never produce an audit row.
import { query, queryOne, run, transaction } from "../../../lib/db.js";
import { logAudit } from "../../../lib/audit.js";
import { requireActor } from "../../../lib/requireActor.js";
import { sendPing, urls } from "../../../lib/pings.js";
import { str, toInt, oneOf, fail, KB_ENTRY_TYPES, CHANGE_TYPES, CHANGE_ACTIONS, SCENE_LIBRARY_STATUSES, SPAWN_ITEM_TYPES } from "../../../../../shared/validate.js";

// Reads that every Library visitor (incl. Event Team and Lead Storytellers) may call.
const READ = { allowEventTeam: true, allowLeadStoryteller: true };
// Event-Team-only boost, for the areas policy 4 gives it full rights on.
const ET = { allowEventTeam: true };

// The one spelling of "no turf". npcs.turf is never '' or 'Unaffiliated' any
// more (migration 021 normalised old rows); claimable is derived from it.
const NO_TURF = 'Neutral';
const isNoTurf = (t) => str(t).toLowerCase() === NO_TURF.toLowerCase();
const claimableFor = (turf) => (isNoTurf(turf) ? 0 : 1);

// Ammo types a compatibility row may carry; classification is by whole token
// ("9mm AP Rounds" → AP, "SHAPED charge" → Standard), never by substring.
const AMMO_TYPES = ['Standard', 'FMJ', 'HP', 'AP', 'Tracer'];
function ammoTypeFor(name, explicit) {
  const e = oneOf(str(explicit), AMMO_TYPES);
  if (e) return e;
  const tokens = str(name).toUpperCase().split(/[^A-Z0-9]+/);
  for (const t of ['FMJ', 'HP', 'AP', 'TRACER']) if (tokens.includes(t)) return t === 'TRACER' ? 'Tracer' : t;
  return 'Standard';
}

// Pick-lists for the Arsenal. Keyed by spawn_items.item_type (SPAWN_ITEM_TYPES)
// and by an explicit import_items category list — not by "category LIKE 'Ammo%'".
const AMMO_SPAWN_TYPES = ['ammo'];
const ATTACHMENT_SPAWN_TYPES = ['component', 'attachment'];
const AMMO_IMPORT_CATEGORIES = ['Ammo', 'Ammo (HP)', 'Ammo (Non-HP)', 'Ammo (AP)', 'Ammo (FMJ)', 'Ammo (Tracer)'];
const ATTACHMENT_IMPORT_CATEGORIES = ['Attachment', 'Attachment Clip', 'Attachment Flashlight', 'Attachment Muzzle', 'Attachment Sight', 'Attachment Supressor', 'Attachment Suppressor', 'Attachment Scope', 'Attachment Grip'];

const idOf = (v) => toInt(v, { min: 1 });
const marks = (n) => Array(n).fill('?').join(',');

// ── KNOWLEDGE BASE — read L1+ (lore) / L3 (management commands); write L2+ ──
export async function getLoreEntries() {
  await requireActor(1, READ);
  return query("SELECT * FROM knowledge_base WHERE entry_type = 'lore' ORDER BY category, title");
}
export async function getCommandEntries() {
  // "Management" entries are admin command syntax: level-gated on the server.
  await requireActor(3, ET);
  return query("SELECT * FROM knowledge_base WHERE entry_type = 'command' ORDER BY category, title");
}
function kbFields(data) {
  const d = data && typeof data === 'object' ? data : {};
  const title = str(d.title, { max: 200 });
  if (!title) return { error: 'Title is required' };
  return { title, category: str(d.category, { max: 80 }) || 'General', content: str(d.content, { max: 10000 }), notes: str(d.notes, { max: 2000 }) };
}
export async function addKBEntry(data, type) {
  const actor = await requireActor(2);
  const entryType = oneOf(str(type) || 'lore', KB_ENTRY_TYPES);
  if (!entryType) return fail('Unknown entry type');
  if (entryType === 'command' && actor.level < 3) return fail('Management entries need L3');
  const f = kbFields(data);
  if (f.error) return fail(f.error);
  const r = run("INSERT INTO knowledge_base (category, title, content, added_by, notes, entry_type) VALUES (?, ?, ?, ?, ?, ?)",
    [f.category, f.title, f.content, actor.name, f.notes, entryType]);
  logAudit(actor.id, actor.name, 'CREATE', 'knowledge_base', r.lastInsertRowid, f.title, `Type: ${entryType}`);
  return { ok: true, id: r.lastInsertRowid };
}
export async function editKBEntry(id, data) {
  const actor = await requireActor(2);
  const kid = idOf(id);
  const row = kid ? queryOne("SELECT id, entry_type FROM knowledge_base WHERE id = ?", [kid]) : null;
  if (!row) return fail('Entry not found');
  if (row.entry_type === 'command' && actor.level < 3) return fail('Management entries need L3');
  const f = kbFields(data);
  if (f.error) return fail(f.error);
  run("UPDATE knowledge_base SET category=?, title=?, content=?, notes=?, updated_at=datetime('now') WHERE id=?",
    [f.category, f.title, f.content, f.notes, kid]);
  logAudit(actor.id, actor.name, 'EDIT', 'knowledge_base', kid, f.title, '');
  return { ok: true };
}
export async function deleteKBEntry(id) {
  const actor = await requireActor(2);
  const kid = idOf(id);
  const row = kid ? queryOne("SELECT id, title, entry_type FROM knowledge_base WHERE id = ?", [kid]) : null;
  if (!row) return fail('Entry not found');
  if (row.entry_type === 'command' && actor.level < 3) return fail('Management entries need L3');
  run("DELETE FROM knowledge_base WHERE id=?", [kid]);
  logAudit(actor.id, actor.name, 'DELETE', 'knowledge_base', kid, row.title, `Type: ${row.entry_type}`);
  return { ok: true };
}

// ── NPCs / TURFS — read L2+ (and LST / Event Team), write L3 ──
export async function getNPCs() {
  await requireActor(2, READ);
  return query("SELECT * FROM npcs ORDER BY turf, name");
}
export async function getTurfs() {
  await requireActor(2, READ);
  return query("SELECT * FROM turfs ORDER BY name");
}
const findTurf = (name) => queryOne("SELECT id, name, shipment_power FROM turfs WHERE LOWER(TRIM(name))=LOWER(TRIM(?))", [str(name)]);
const turfHasNpcs = (name) => !!queryOne("SELECT 1 FROM npcs WHERE LOWER(TRIM(turf))=LOWER(TRIM(?)) LIMIT 1", [str(name)]);
// Materialize a turf as a first-class row so it persists even with no NPCs.
function ensureTurf(name, power) {
  const t = str(name);
  if (!t || isNoTurf(t)) return;
  if (!findTurf(t)) run("INSERT INTO turfs (name, shipment_power) VALUES (?, ?)", [t, str(power)]);
}
function npcFields(data) {
  const d = data && typeof data === 'object' ? data : {};
  const name = str(d.name, { max: 120 });
  const position = str(d.position, { max: 120 });
  const type = str(d.type ?? d.npc_type, { max: 60 });
  if (!name) return { error: 'NPC name is required' };
  if (!position) return { error: 'TP position is required' };
  if (!type) return { error: 'NPC type is required' };
  const rawTurf = str(d.turf, { max: 120 });
  const turf = rawTurf && !isNoTurf(rawTurf) ? rawTurf : NO_TURF;
  const shipmentPower = turf === NO_TURF ? '' : str(d.shipmentPower ?? d.shipment_power, { max: 40 });
  return { name, position, type, turf, shipmentPower, claimable: claimableFor(turf) };
}
export async function addNPC(data) {
  const actor = await requireActor(3);
  const f = npcFields(data);
  if (f.error) return fail(f.error);
  const id = transaction(() => {
    const r = run("INSERT INTO npcs (name, position, npc_type, turf, shipment_power, claimable) VALUES (?, ?, ?, ?, ?, ?)",
      [f.name, f.position, f.type, f.turf, f.shipmentPower, f.claimable]);
    ensureTurf(f.turf, f.shipmentPower);
    return r.lastInsertRowid;
  });
  logAudit(actor.id, actor.name, 'CREATE', 'npc', id, f.name, `Type: ${f.type}, Turf: ${f.turf}`);
  return { ok: true, id };
}
export async function editNPC(id, data) {
  const actor = await requireActor(3);
  const nid = idOf(id);
  if (!nid || !queryOne("SELECT id FROM npcs WHERE id = ?", [nid])) return fail('NPC not found');
  const f = npcFields(data);
  if (f.error) return fail(f.error);
  transaction(() => {
    run("UPDATE npcs SET name=?, position=?, npc_type=?, turf=?, shipment_power=?, claimable=?, updated_at=datetime('now') WHERE id=?",
      [f.name, f.position, f.type, f.turf, f.shipmentPower, f.claimable, nid]);
    ensureTurf(f.turf, f.shipmentPower);
  });
  logAudit(actor.id, actor.name, 'EDIT', 'npc', nid, f.name, `Type: ${f.type}, Turf: ${f.turf}`);
  return { ok: true };
}
export async function deleteNPC(id) {
  const actor = await requireActor(3);
  const nid = idOf(id);
  const row = nid ? queryOne("SELECT id, name, turf FROM npcs WHERE id = ?", [nid]) : null;
  if (!row) return fail('NPC not found');
  run("DELETE FROM npcs WHERE id=?", [nid]);
  logAudit(actor.id, actor.name, 'DELETE', 'npc', nid, row.name, `Turf: ${row.turf}`);
  return { ok: true };
}
/**
 * Create (oldTurf empty) or rename/re-power a turf. Atomic; renaming a turf
 * that does not exist is an error, and creating one that already exists (any
 * case) is an error rather than a silent overwrite. Renaming onto an existing
 * turf merges into it.
 */
export async function updateTurf(oldTurf, newTurf, power) {
  const actor = await requireActor(3);
  const name = str(newTurf, { max: 120 });
  const old = str(oldTurf, { max: 120 });
  const pwr = str(power, { max: 40 });
  if (!name) return fail('Turf name required');
  if (isNoTurf(name) || name.toLowerCase() === 'unaffiliated') return fail(`"${name}" is reserved for NPCs with no turf`);

  if (!old) {
    const existing = findTurf(name);
    if (existing) return fail(`A turf named "${existing.name}" already exists`);
    const r = run("INSERT INTO turfs (name, shipment_power) VALUES (?, ?)", [name, pwr]);
    logAudit(actor.id, actor.name, 'CREATE', 'turf', r.lastInsertRowid, name, `Power: ${pwr}`);
    return { ok: true, id: r.lastInsertRowid };
  }

  const oldRow = findTurf(old);
  if (!oldRow && !turfHasNpcs(old)) return fail('Turf not found');
  const renamed = old.toLowerCase() !== name.toLowerCase();
  const clash = renamed ? findTurf(name) : null;
  const targetId = transaction(() => {
    let id;
    if (clash) {
      // Merge: the old row goes away, the surviving row takes the new power.
      if (oldRow) run("DELETE FROM turfs WHERE id = ?", [oldRow.id]);
      run("UPDATE turfs SET shipment_power=? WHERE id=?", [pwr, clash.id]);
      id = clash.id;
    } else if (oldRow) {
      run("UPDATE turfs SET name=?, shipment_power=? WHERE id=?", [name, pwr, oldRow.id]);
      id = oldRow.id;
    } else {
      // The turf existed only on NPC rows (pre-turfs-table data): materialise it.
      id = run("INSERT INTO turfs (name, shipment_power) VALUES (?, ?)", [name, pwr]).lastInsertRowid;
    }
    run("UPDATE npcs SET turf=?, shipment_power=?, updated_at=datetime('now') WHERE LOWER(TRIM(turf))=LOWER(TRIM(?))", [name, pwr, old]);
    return id;
  });
  logAudit(actor.id, actor.name, 'EDIT', 'turf', targetId, name,
    clash ? `Merged "${old}" into "${clash.name}" (power ${pwr})` : renamed ? `Renamed from "${old}" (power ${pwr})` : `Power: ${pwr}`);
  return { ok: true, id: targetId };
}
export async function disbandTurf(turfName) {
  const actor = await requireActor(3);
  const name = str(turfName, { max: 120 });
  if (!name || isNoTurf(name)) return fail('Turf name required');
  const row = findTurf(name);
  if (!row && !turfHasNpcs(name)) return fail('Turf not found');
  const moved = transaction(() => {
    if (row) run("DELETE FROM turfs WHERE id = ?", [row.id]);
    return run("UPDATE npcs SET turf=?, shipment_power='', claimable=?, updated_at=datetime('now') WHERE LOWER(TRIM(turf))=LOWER(TRIM(?))",
      [NO_TURF, claimableFor(NO_TURF), name]).changes;
  });
  logAudit(actor.id, actor.name, 'DELETE', 'turf', row?.id ?? null, row?.name || name, `Turf disbanded; ${moved} NPC(s) now ${NO_TURF}`);
  return { ok: true, moved };
}

// ── SPAWN ITEMS — L3 and Event Team (policy 4: ET owns spawn commands) ──
export async function getSpawnItems() {
  await requireActor(3, ET);
  return query("SELECT id, category, name, game_id, item_type, extra FROM spawn_items ORDER BY category, name");
}
function spawnFields(data) {
  const d = data && typeof data === 'object' ? data : {};
  const name = str(d.name, { max: 120 });
  if (!name) return { error: 'Item name is required' };
  const itemType = oneOf(str(d.itemType ?? d.item_type) || 'item', SPAWN_ITEM_TYPES);
  if (!itemType) return { error: `Item type must be one of ${SPAWN_ITEM_TYPES.join(', ')}` };
  return { name, itemType, category: str(d.category, { max: 80 }), gameId: str(d.gameId ?? d.game_id, { max: 120 }), extra: str(d.extra, { max: 500 }) };
}
export async function addSpawnItem(data) {
  const actor = await requireActor(3, ET);
  const f = spawnFields(data);
  if (f.error) return fail(f.error);
  const r = run("INSERT INTO spawn_items (category, name, game_id, item_type, extra) VALUES (?, ?, ?, ?, ?)",
    [f.category, f.name, f.gameId, f.itemType, f.extra]);
  logAudit(actor.id, actor.name, 'CREATE', 'spawn_item', r.lastInsertRowid, f.name, `Type: ${f.itemType}`);
  return { ok: true, id: r.lastInsertRowid };
}
export async function editSpawnItem(id, data) {
  const actor = await requireActor(3, ET);
  const sid = idOf(id);
  if (!sid || !queryOne("SELECT id FROM spawn_items WHERE id = ?", [sid])) return fail('Spawn item not found');
  const f = spawnFields(data);
  if (f.error) return fail(f.error);
  // created_at is left alone (it used to be rewritten on every edit).
  run("UPDATE spawn_items SET category=?, name=?, game_id=?, item_type=?, extra=? WHERE id=?",
    [f.category, f.name, f.gameId, f.itemType, f.extra, sid]);
  logAudit(actor.id, actor.name, 'EDIT', 'spawn_item', sid, f.name, `Type: ${f.itemType}`);
  return { ok: true };
}
export async function deleteSpawnItem(id) {
  const actor = await requireActor(3, ET);
  const sid = idOf(id);
  const row = sid ? queryOne("SELECT id, name FROM spawn_items WHERE id = ?", [sid]) : null;
  if (!row) return fail('Spawn item not found');
  run("DELETE FROM spawn_items WHERE id=?", [sid]);
  logAudit(actor.id, actor.name, 'DELETE', 'spawn_item', sid, row.name, '');
  return { ok: true };
}

// ── LOADOUTS — read L1+ (and LST / ET); weapons and compat L2+ ──
export async function getLoadouts() {
  await requireActor(1, READ);
  const weapons = query("SELECT * FROM weapon_ammo ORDER BY weapon_category, weapon_name");
  const compat = query("SELECT * FROM weapon_ammo_compat ORDER BY ammo_type, ammo_name");
  const attachments = query("SELECT * FROM weapon_attachments ORDER BY attachment_name");
  const compatMap = {};
  compat.forEach(c => { (compatMap[c.weapon_id] ||= []).push(c); });
  const attachMap = {};
  attachments.forEach(a => { (attachMap[a.weapon_id] ||= []).push(a); });
  return weapons.map(w => ({ ...w, ammo: compatMap[w.id] || [], attachments: attachMap[w.id] || [] }));
}
function weaponFields(data) {
  const d = data && typeof data === 'object' ? data : {};
  const name = str(d.name ?? d.weapon_name, { max: 120 });
  if (!name) return { error: 'Weapon name is required' };
  return { name, category: str(d.category ?? d.weapon_category, { max: 60 }), caliber: str(d.caliber, { max: 40 }) };
}
export async function addWeapon(data) {
  const actor = await requireActor(2);
  const f = weaponFields(data);
  if (f.error) return fail(f.error);
  const r = run("INSERT INTO weapon_ammo (weapon_name, weapon_category, caliber) VALUES (?, ?, ?)", [f.name, f.category, f.caliber]);
  logAudit(actor.id, actor.name, 'CREATE', 'weapon_ammo', r.lastInsertRowid, f.name, f.category);
  return { ok: true, id: r.lastInsertRowid };
}
export async function editWeapon(id, data) {
  const actor = await requireActor(2);
  const wid = idOf(id);
  if (!wid || !queryOne("SELECT id FROM weapon_ammo WHERE id = ?", [wid])) return fail('Weapon not found');
  const f = weaponFields(data);
  if (f.error) return fail(f.error);
  run("UPDATE weapon_ammo SET weapon_name=?, weapon_category=?, caliber=? WHERE id=?", [f.name, f.category, f.caliber, wid]);
  logAudit(actor.id, actor.name, 'EDIT', 'weapon_ammo', wid, f.name, f.category);
  return { ok: true };
}
export async function deleteWeapon(id) {
  const actor = await requireActor(2);
  const wid = idOf(id);
  const row = wid ? queryOne("SELECT id, weapon_name FROM weapon_ammo WHERE id = ?", [wid]) : null;
  if (!row) return fail('Weapon not found');
  run("DELETE FROM weapon_ammo WHERE id=?", [wid]); // compat + attachments cascade (schema FK)
  logAudit(actor.id, actor.name, 'DELETE', 'weapon_ammo', wid, row.weapon_name, '');
  return { ok: true };
}
export async function addAmmoCompat(weaponId, ammoName, ammoType) {
  const actor = await requireActor(2);
  const wid = idOf(weaponId);
  const weapon = wid ? queryOne("SELECT id, weapon_name FROM weapon_ammo WHERE id = ?", [wid]) : null;
  if (!weapon) return fail('Weapon not found');
  const name = str(ammoName, { max: 120 });
  if (!name) return fail('Ammo name is required');
  const atype = ammoTypeFor(name, ammoType);
  const r = run("INSERT OR IGNORE INTO weapon_ammo_compat (weapon_id, ammo_name, ammo_type) VALUES (?, ?, ?)", [wid, name, atype]);
  if (!r.changes) return fail(`"${name}" is already assigned to ${weapon.weapon_name}`);
  logAudit(actor.id, actor.name, 'CREATE', 'weapon_ammo_compat', r.lastInsertRowid, name, `${weapon.weapon_name} · ${atype}`);
  return { ok: true, id: r.lastInsertRowid, ammoType: atype };
}
export async function removeAmmoCompat(compatId) {
  const actor = await requireActor(2);
  const cid = idOf(compatId);
  const row = cid ? queryOne("SELECT c.id, c.ammo_name, w.weapon_name FROM weapon_ammo_compat c JOIN weapon_ammo w ON w.id = c.weapon_id WHERE c.id = ?", [cid]) : null;
  if (!row) return fail('Ammo assignment not found');
  run("DELETE FROM weapon_ammo_compat WHERE id=?", [cid]);
  logAudit(actor.id, actor.name, 'DELETE', 'weapon_ammo_compat', cid, row.ammo_name, row.weapon_name);
  return { ok: true };
}
export async function addAttachmentCompat(weaponId, attachmentName) {
  const actor = await requireActor(2);
  const wid = idOf(weaponId);
  const weapon = wid ? queryOne("SELECT id, weapon_name FROM weapon_ammo WHERE id = ?", [wid]) : null;
  if (!weapon) return fail('Weapon not found');
  const name = str(attachmentName, { max: 120 });
  if (!name) return fail('Attachment name is required');
  const r = run("INSERT OR IGNORE INTO weapon_attachments (weapon_id, attachment_name) VALUES (?, ?)", [wid, name]);
  if (!r.changes) return fail(`"${name}" is already assigned to ${weapon.weapon_name}`);
  logAudit(actor.id, actor.name, 'CREATE', 'weapon_attachment', r.lastInsertRowid, name, weapon.weapon_name);
  return { ok: true, id: r.lastInsertRowid };
}
export async function removeAttachmentCompat(attachId) {
  const actor = await requireActor(2);
  const aid = idOf(attachId);
  const row = aid ? queryOne("SELECT a.id, a.attachment_name, w.weapon_name FROM weapon_attachments a JOIN weapon_ammo w ON w.id = a.weapon_id WHERE a.id = ?", [aid]) : null;
  if (!row) return fail('Attachment assignment not found');
  run("DELETE FROM weapon_attachments WHERE id=?", [aid]);
  logAudit(actor.id, actor.name, 'DELETE', 'weapon_attachment', aid, row.attachment_name, row.weapon_name);
  return { ok: true };
}
function pickList(spawnTypes, importCategories) {
  const rows = query(
    `SELECT name FROM spawn_items WHERE item_type IN (${marks(spawnTypes.length)})
     UNION SELECT name FROM import_items WHERE category IN (${marks(importCategories.length)})
     ORDER BY name`, [...spawnTypes, ...importCategories]);
  return [...new Set(rows.map(r => str(r.name)).filter(Boolean))];
}
export async function getAmmoList() {
  await requireActor(1, READ);
  return pickList(AMMO_SPAWN_TYPES, AMMO_IMPORT_CATEGORIES);
}
export async function getAttachmentList() {
  await requireActor(1, READ);
  return pickList(ATTACHMENT_SPAWN_TYPES, ATTACHMENT_IMPORT_CATEGORIES);
}
export async function getWeaponCategories() {
  await requireActor(1, READ);
  return query("SELECT DISTINCT weapon_category FROM weapon_ammo WHERE weapon_category != '' ORDER BY weapon_category").map(r => r.weapon_category);
}

// ── CHANGE LOG — read L1+ (and LST / ET); write L3 and Event Team ──
export async function getChangeLogs() {
  await requireActor(1, READ);
  return query("SELECT * FROM change_log ORDER BY created_at DESC");
}
function changeFields(data, fallbackType) {
  const d = data && typeof data === 'object' ? data : {};
  const changeType = oneOf(str(d.changeType ?? d.change_type) || fallbackType || '', CHANGE_TYPES);
  if (!changeType) return { error: 'Entry type must be a black-market doctor or a drop location' };
  const name = str(d.name, { max: 120 });
  if (!name) return { error: 'Name is required' };
  const action = oneOf(str(d.action), CHANGE_ACTIONS);
  if (action === null) return { error: `Action must be one of ${CHANGE_ACTIONS.filter(Boolean).join(', ')}` };
  if (changeType === 'black_market_doctor' && !action) return { error: 'Doctor entries need an action (Added, Moved or Removed)' };
  return {
    changeType, name, action,
    position: str(d.position, { max: 120 }),
    blockedOff: action === 'Removed' && !!(d.blockedOff ?? d.blocked_off) ? 1 : 0,
    notes: str(d.notes, { max: 2000 }),
  };
}
const changeLabel = (e) => (e.change_type === 'black_market_doctor' ? 'Black Market Doctor' : 'Drop Location');
// One formatter for every change-log post; delivery is sendPing so the route's
// channel, mute switch and mention_roles all apply.
function changeLogMessage(e, by, suffix = '') {
  const doctor = e.change_type === 'black_market_doctor';
  const lines = [`${doctor ? '🏥' : '📍'} **${changeLabel(e)} ${e.action || 'Added'}**${suffix}`,
    `**Name:** ${e.name}`,
    `**Location:** \`/tppos ${e.position || 'N/A'}\``];
  if (doctor && e.action === 'Removed') lines.push(e.blocked_off ? '✅ Location has been blocked off' : '⚠️ Location has NOT been blocked off');
  if (e.notes) lines.push(`**Notes:** ${e.notes}`);
  lines.push(`*By: ${by}*`);
  return lines.join('\n');
}
export async function addChangeLog(data) {
  const actor = await requireActor(3, ET);
  const f = changeFields(data);
  if (f.error) return fail(f.error);
  const r = run("INSERT INTO change_log (change_type, name, position, action, blocked_off, notes, created_by, created_by_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [f.changeType, f.name, f.position, f.action, f.blockedOff, f.notes, actor.name, actor.id]);
  logAudit(actor.id, actor.name, 'CREATE', 'change_log', r.lastInsertRowid, f.name, `${f.changeType}${f.action ? ` · ${f.action}` : ''}`);
  const entry = { change_type: f.changeType, name: f.name, position: f.position, action: f.action, blocked_off: f.blockedOff, notes: f.notes };
  await sendPing('story.changelog', changeLogMessage(entry, actor.name));
  return { ok: true, id: r.lastInsertRowid };
}
export async function editChangeLog(id, data) {
  const actor = await requireActor(3, ET);
  const cid = idOf(id);
  const row = cid ? queryOne("SELECT * FROM change_log WHERE id = ?", [cid]) : null;
  if (!row) return fail('Change log entry not found');
  const f = changeFields(data, row.change_type);
  if (f.error) return fail(f.error);
  run("UPDATE change_log SET name=?, position=?, action=?, blocked_off=?, notes=?, change_type=? WHERE id=?",
    [f.name, f.position, f.action, f.blockedOff, f.notes, f.changeType, cid]);
  logAudit(actor.id, actor.name, 'EDIT', 'change_log', cid, f.name, `${f.changeType}${f.action ? ` · ${f.action}` : ''}`);
  const entry = { change_type: f.changeType, name: f.name, position: f.position, action: f.action, blocked_off: f.blockedOff, notes: f.notes };
  await sendPing('story.changelog', changeLogMessage(entry, actor.name, ' *(edited)*'));
  return { ok: true };
}
export async function deleteChangeLog(id) {
  const actor = await requireActor(3, ET);
  const cid = idOf(id);
  const entry = cid ? queryOne("SELECT * FROM change_log WHERE id = ?", [cid]) : null;
  if (!entry) return fail('Change log entry not found');
  run("DELETE FROM change_log WHERE id=?", [cid]);
  logAudit(actor.id, actor.name, 'DELETE', 'change_log', cid, entry.name, `${entry.change_type}${entry.action ? ` · ${entry.action}` : ''}`);
  // Say what happened: the LOG ENTRY was deleted. Nothing about the in-game
  // doctor/drop changed — the old post read "Doctor Removed" for any deletion.
  const what = `${changeLabel(entry)}${entry.action ? ` · ${entry.action}` : ''}`;
  await sendPing('story.changelog',
    `🗑️ **Change log entry deleted** — ${what}\n**Name:** ${entry.name}\n**Location:** \`/tppos ${entry.position || 'N/A'}\`\n*Only the log entry was removed (by ${actor.name}); the in-game location is unchanged unless a separate entry says so.*`);
  return { ok: true };
}

// ── SCENE LIBRARY — the idea → review → approved → "log to faction" bridge ──
// Read: everyone in the Library. Submit: L1+ and Event Team. Approve: L2+,
// Event Team and Lead Storytellers. Edit/delete/feedback: L2+ and Event Team.
export async function getSceneLibrary() {
  await requireActor(1, READ);
  return query("SELECT * FROM scene_library ORDER BY created_at DESC");
}
function sceneFields(data) {
  const d = data && typeof data === 'object' ? data : {};
  const title = str(d.title, { max: 200 });
  if (!title) return { error: 'A title is required' };
  const spawning = !!d.spawning_required;
  const tags = [...new Set(str(d.tags, { max: 500 }).split(',').map(t => t.trim()).filter(Boolean))].join(', ');
  return {
    title,
    description: str(d.description, { max: 8000 }),
    staff_required: toInt(d.staff_required, { min: 1, max: 50, def: 1 }),
    spawning_required: spawning ? 1 : 0,
    spawning_details: spawning ? str(d.spawning_details, { max: 1000 }) : '',
    ped_required: d.ped_required ? 1 : 0,
    proposed_rewards: str(d.proposed_rewards, { max: 500 }),
    tags,
  };
}
const findScene = (id) => { const sid = idOf(id); return sid ? queryOne("SELECT * FROM scene_library WHERE id = ?", [sid]) : null; };
function notifyAuthor(scene, actor, text) {
  if (!scene.created_by_id || scene.created_by_id === actor.id) return Promise.resolve(false);
  return sendPing('story.scene_decision', `<@${scene.created_by_id}> — ${text}\n🔗 ${urls.library('scenes')}`);
}

export async function addSceneLibraryEntry(data) {
  const actor = await requireActor(1, ET);
  const f = sceneFields(data);
  if (f.error) return fail(f.error);
  const r = run(
    "INSERT INTO scene_library (title, status, description, staff_required, spawning_required, spawning_details, ped_required, proposed_rewards, tags, created_by, created_by_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [f.title, 'idea', f.description, f.staff_required, f.spawning_required, f.spawning_details, f.ped_required, f.proposed_rewards, f.tags, actor.name, actor.id]);
  logAudit(actor.id, actor.name, 'CREATE', 'scene_library', r.lastInsertRowid, f.title, 'idea');

  await sendPing('story.scene_idea', null, { embeds: [{
    title: 'New Scene Library Idea',
    description: `**${f.title}**${f.description ? `\n${f.description.substring(0, 200)}${f.description.length > 200 ? '…' : ''}` : ''}\n\n*Submitted by <@${actor.id}> — awaiting approval.*`,
    color: 0xc084fc,
    fields: [
      { name: 'Staff Required', value: String(f.staff_required), inline: true },
      ...(f.spawning_required ? [{ name: 'Spawning', value: f.spawning_details || 'Yes', inline: true }] : []),
      ...(f.ped_required ? [{ name: 'Peds', value: 'Required', inline: true }] : []),
      ...(f.proposed_rewards ? [{ name: 'Proposed Rewards', value: f.proposed_rewards, inline: false }] : []),
    ],
    url: urls.library('scenes'),
    footer: { text: 'Meridian FM · Scene Library' },
    timestamp: new Date().toISOString(),
  }] });
  return { ok: true, id: r.lastInsertRowid };
}

export async function editSceneLibraryEntry(id, data) {
  const actor = await requireActor(2, ET);
  const scene = findScene(id);
  if (!scene) return fail('Scene not found');
  const f = sceneFields(data);
  if (f.error) return fail(f.error);
  const requested = str(data?.status);
  const status = requested ? oneOf(requested, SCENE_LIBRARY_STATUSES) : scene.status;
  if (!status) return fail(`Status must be one of ${SCENE_LIBRARY_STATUSES.join(', ')}`);
  run(
    "UPDATE scene_library SET title=?, status=?, description=?, staff_required=?, spawning_required=?, spawning_details=?, ped_required=?, proposed_rewards=?, tags=?, updated_at=datetime('now') WHERE id=?",
    [f.title, status, f.description, f.staff_required, f.spawning_required, f.spawning_details, f.ped_required, f.proposed_rewards, f.tags, scene.id]);
  logAudit(actor.id, actor.name, 'EDIT', 'scene_library', scene.id, f.title, status !== scene.status ? `${scene.status} → ${status}` : status);
  if (status !== scene.status) {
    await notifyAuthor(scene, actor, status === 'approved'
      ? `✅ your scene idea **"${f.title}"** was approved by **${actor.name}** and is now in the Scene Library.`
      : `↩️ your scene **"${f.title}"** was moved back to *idea* by **${actor.name}**.`);
  }
  return { ok: true };
}

/** The one write a Lead Storyteller has: approve an idea (or move it back). */
export async function setSceneLibraryStatus(id, status) {
  const actor = await requireActor(2, READ);
  const next = oneOf(str(status), SCENE_LIBRARY_STATUSES);
  if (!next) return fail(`Status must be one of ${SCENE_LIBRARY_STATUSES.join(', ')}`);
  const scene = findScene(id);
  if (!scene) return fail('Scene not found');
  if (scene.status === next) return { ok: true, changed: false };
  run("UPDATE scene_library SET status=?, updated_at=datetime('now') WHERE id=?", [next, scene.id]);
  logAudit(actor.id, actor.name, next === 'approved' ? 'APPROVE' : 'EDIT', 'scene_library', scene.id, scene.title, `${scene.status} → ${next}`);
  await notifyAuthor(scene, actor, next === 'approved'
    ? `✅ your scene idea **"${scene.title}"** was approved by **${actor.name}** and is now in the Scene Library.`
    : `↩️ your scene **"${scene.title}"** was moved back to *idea* by **${actor.name}**.`);
  return { ok: true, changed: true };
}

export async function deleteSceneLibraryEntry(id) {
  const actor = await requireActor(2, ET);
  const scene = findScene(id);
  if (!scene) return fail('Scene not found');
  const feedbackRemoved = transaction(() => {
    const n = run("DELETE FROM scene_library_feedback WHERE scene_id = ?", [scene.id]).changes;
    run("DELETE FROM scene_library WHERE id = ?", [scene.id]);
    return n;
  });
  logAudit(actor.id, actor.name, 'DELETE', 'scene_library', scene.id, scene.title, `${scene.status}; ${feedbackRemoved} feedback row(s) removed`);
  if (scene.status !== 'approved') {
    await notifyAuthor(scene, actor, `🗑️ your scene idea **"${scene.title}"** was removed from the Scene Library by **${actor.name}**.`);
  }
  return { ok: true };
}

export async function getSceneLibraryFeedback(sceneId) {
  await requireActor(1, READ);
  const sid = idOf(sceneId);
  if (!sid) return [];
  return query("SELECT * FROM scene_library_feedback WHERE scene_id = ? ORDER BY created_at DESC", [sid]);
}

export async function addSceneLibraryFeedback(sceneId, feedbackText) {
  const actor = await requireActor(2, ET);
  const text = str(feedbackText, { max: 4000 });
  if (!text) return fail('Feedback text is required');
  const scene = findScene(sceneId);
  if (!scene) return fail('Scene not found');
  const r = run("INSERT INTO scene_library_feedback (scene_id, feedback, created_by, created_by_id) VALUES (?,?,?,?)",
    [scene.id, text, actor.name, actor.id]);
  logAudit(actor.id, actor.name, 'FEEDBACK', 'scene_library', scene.id, scene.title, text.substring(0, 120));
  if (scene.status !== 'approved' && scene.created_by_id && scene.created_by_id !== actor.id) {
    await sendPing('story.scene_feedback',
      `💬 <@${scene.created_by_id}> — **${actor.name}** left feedback on your scene idea **"${scene.title}"**:\n> ${text.substring(0, 350)}${text.length > 350 ? '…' : ''}\n\n🔗 ${urls.library('scenes')}`);
  }
  return { ok: true, id: r.lastInsertRowid };
}
