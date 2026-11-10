"use server";
// Scene logs: the activity record leadership reviews, and the source of the
// treasury / inventory ledgers. Event Team has full rights here (policy 4).
// Dates are stored ISO (YYYY-MM-DD) via shared/dates; display is the UI's job.
import { query, queryOne, run, transaction } from "../../../lib/db.js";
import { logAudit } from "../../../lib/audit.js";
import { requireActor } from "../../../lib/requireActor.js";
import { sendPing } from "../../../lib/pings.js";
import { resolveFaction } from "../../../lib/access.js";
import { todayIso, nowIso, legacyDate, parseDate } from "../../../../../shared/dates.js";
import { str, toInt, fail } from "../../../../../shared/validate.js";

const ET = { allowEventTeam: true };

export async function getSceneLogs() {
  await requireActor(1, ET);
  const logs = query(`SELECT sl.id, sl.date, f.name as faction, sl.faction_id, sl.rewards, sl.logged_by, sl.notes, sl.author_id, sl.created_at
    FROM scene_logs sl JOIN factions f ON sl.faction_id = f.id ORDER BY sl.date DESC, sl.created_at DESC`);
  const assistants = query(`SELECT sa.id, sa.scene_id, sa.staff_id, sa.staff_name FROM scene_assistants sa ORDER BY sa.added_at ASC`);
  const byScene = {};
  for (const a of assistants) (byScene[a.scene_id] ||= []).push(a);
  // Legacy rows (pre-migration DD/MON/YYYY) still parse; sort on the parsed value so the order is right whatever the stored shape.
  return logs
    .map(l => ({ ...l, dateLabel: legacyDate(l.date), dateMs: parseDate(l.date)?.getTime() || 0, assistants: byScene[l.id] || [] }))
    .sort((a, b) => b.dateMs - a.dateMs || String(b.created_at).localeCompare(String(a.created_at)));
}

export async function getFactionNames() {
  await requireActor(1, ET);
  return query("SELECT name FROM factions WHERE archived = 0 ORDER BY name").map(r => r.name);
}

export async function getInventoryForScene() {
  await requireActor(1, ET);
  // Every item in the catalogue, whatever it is. This used to filter on
  // current_stock > 0; with stock counts retired that test would hide the whole
  // list. What is handed out is still recorded — see the inventory_logs write in
  // submitScene — it is only the running total that has gone.
  return query("SELECT id, name, category FROM inventory_stock ORDER BY category, name");
}

export async function getStaffForScene() {
  await requireActor(1, ET);
  return query("SELECT discord_id, display_name FROM staff WHERE discord_id != '' AND discord_id NOT LIKE 'placeholder%' AND COALESCE(active, 1) = 1 ORDER BY display_name");
}

/**
 * Log a scene. `data`: { faction, cash, items:[{name,qty}], otherRewards, notes, assistants:[{staff_id,staff_name}] }.
 * Validation errors come back as { ok:false, error }; nothing is written until every input is checked.
 */
export async function submitScene(data) {
  const actor = await requireActor(1, ET);
  const d = data && typeof data === 'object' ? data : {};
  const r = resolveFaction(str(d.faction));
  if (r.error) return fail(r.error === 'Faction not found.' ? 'Faction not found.' : r.error);
  const fac = r.faction;
  const notes = str(d.notes, { max: 8000 });
  if (!notes) return fail('Scene notes are required.');
  const cashRaw = str(d.cash);
  const cash = cashRaw ? toInt(cashRaw, { min: 0 }) : 0;
  if (cash === null || (cashRaw && !/^\d+$/.test(cashRaw))) return fail('Cash reward must be a whole number of dollars (or blank).');
  const items = [];
  for (const sel of Array.isArray(d.items) ? d.items : []) {
    const name = str(sel?.name, { max: 120 });
    if (!name) continue;
    const qty = toInt(sel?.qty, { min: 1, max: 100000 });
    if (!qty) return fail(`Quantity for "${name}" must be a whole number of at least 1.`);
    items.push({ name, qty });
  }
  const other = str(d.otherRewards, { max: 500 });
  const staffIds = new Set(query("SELECT discord_id FROM staff WHERE discord_id NOT LIKE 'placeholder%'").map(s => s.discord_id));
  const assistants = [];
  const seen = new Set();
  for (const a of Array.isArray(d.assistants) ? d.assistants : []) {
    const id = str(a?.staff_id);
    if (!id || id === actor.id || seen.has(id)) continue;
    if (!staffIds.has(id)) return fail('An assistant is not on the staff roster.');
    seen.add(id);
    assistants.push({ id, name: queryOne("SELECT display_name FROM staff WHERE discord_id = ?", [id])?.display_name || str(a?.staff_name) || id });
  }

  const parts = [];
  if (cash > 0) parts.push(`$${cash}`);
  for (const i of items) parts.push(`${i.qty}x ${i.name}`);
  if (other) parts.push(other);
  const rewards = parts.length ? parts.join(', ') : 'None';
  const dt = todayIso();

  const sceneId = transaction(() => {
    const ins = run("INSERT INTO scene_logs (date, faction_id, rewards, logged_by, notes, author_id) VALUES (?, ?, ?, ?, ?, ?)",
      [dt, fac.id, rewards, actor.name, notes, actor.id]);
    const id = Number(ins.lastInsertRowid);
    for (const a of assistants) {
      run("INSERT INTO scene_assistants (scene_id, staff_id, staff_name, added_by_id, added_by_name) VALUES (?,?,?,?,?)", [id, a.id, a.name, actor.id, actor.name]);
    }
    if (cash > 0) run("INSERT INTO treasury_logs (date, faction_name, faction_id, amount, distributed_by) VALUES (?, ?, ?, ?, ?)", [dt, fac.name, fac.id, cash, actor.name]);
    // The log is the point: who gave out what, and how much of it. The stock
    // balance this used to decrement is no longer kept, so an item that has
    // been removed from the catalogue can still be logged against a scene.
    for (const i of items) run("INSERT INTO inventory_logs (date, item_name, quantity, distributed_by) VALUES (?, ?, ?, ?)", [dt, i.name, i.qty, actor.name]);
    return id;
  });
  logAudit(actor.id, actor.name, 'CREATE', 'scene_log', sceneId, fac.name, `Rewards: ${rewards}${assistants.length ? ` · with ${assistants.map(a => a.name).join(', ')}` : ''}`);
  return { ok: true, id: sceneId };
}

function loadScene(sceneId) {
  const id = toInt(sceneId, { min: 1 });
  const scene = id ? queryOne("SELECT sl.*, f.name AS faction FROM scene_logs sl JOIN factions f ON sl.faction_id = f.id WHERE sl.id = ?", [id]) : null;
  return scene ? { scene } : { error: 'Scene not found.' };
}

export async function addMyselfToScene(sceneId) {
  const actor = await requireActor(1, ET);
  const { scene, error } = loadScene(sceneId);
  if (error) return fail(error);
  if (scene.author_id === actor.id) return fail('You are the scene creator.');
  if (queryOne("SELECT id FROM scene_assistants WHERE scene_id = ? AND staff_id = ?", [scene.id, actor.id])) return fail('You are already listed on this scene.');

  run("INSERT INTO scene_assistants (scene_id, staff_id, staff_name, added_by_id, added_by_name) VALUES (?,?,?,?,?)", [scene.id, actor.id, actor.name, actor.id, actor.name]);
  logAudit(actor.id, actor.name, 'EDIT', 'scene_log', scene.id, scene.faction, 'Self-added as assistant');

  if (scene.author_id) {
    const snippet = (scene.notes || '').slice(0, 150) + (scene.notes?.length > 150 ? '…' : '');
    await sendPing('scene.assistant_added',
      `📋 <@${scene.author_id}> — **${actor.name}** has added themselves to your scene log for **${scene.faction}** (${legacyDate(scene.date)}).\n> ${snippet}`);
  }
  return { ok: true };
}

export async function removeAssistantFromScene(assistantId) {
  const actor = await requireActor(2, ET);
  const id = toInt(assistantId, { min: 1 });
  const row = id ? queryOne("SELECT sa.id, sa.staff_name, sa.scene_id, f.name AS faction FROM scene_assistants sa JOIN scene_logs sl ON sa.scene_id = sl.id JOIN factions f ON f.id = sl.faction_id WHERE sa.id = ?", [id]) : null;
  if (!row) return fail('Assistant record not found.');
  run("DELETE FROM scene_assistants WHERE id = ?", [row.id]);
  logAudit(actor.id, actor.name, 'DELETE', 'scene_assistant', row.id, row.staff_name, `Removed from scene #${row.scene_id} (${row.faction})`);
  return { ok: true };
}

export async function editSceneNotes(logId, notes) {
  const actor = await requireActor(1, ET);
  const { scene, error } = loadScene(logId);
  if (error) return fail(error);
  if (scene.author_id !== actor.id && actor.level < 2) return fail('Only the author or a team lead can edit this scene.');
  const text = str(notes, { max: 8000 });
  if (!text) return fail('Scene notes are required.');
  run("UPDATE scene_logs SET notes = ? WHERE id = ?", [text, scene.id]);
  logAudit(actor.id, actor.name, 'EDIT', 'scene_log', scene.id, scene.faction, text.slice(0, 100));
  return { ok: true };
}

/** L3 (or Event Team) hard delete. Assistants go with it and any pending deletion request for it is resolved. */
export async function deleteScene(logId) {
  const actor = await requireActor(3, ET);
  const { scene, error } = loadScene(logId);
  if (error) return fail(error);
  const now = nowIso();
  transaction(() => {
    run("DELETE FROM scene_assistants WHERE scene_id = ?", [scene.id]);
    run("UPDATE deletion_requests SET status = 'APPROVED', resolved_by = ?, resolved_at = ? WHERE target_table = 'scene_logs' AND target_row_id = ? AND status = 'PENDING'", [actor.name, now, scene.id]);
    run("DELETE FROM scene_logs WHERE id = ?", [scene.id]);
  });
  logAudit(actor.id, actor.name, 'DELETE', 'scene_log', scene.id, scene.faction, `Direct delete · ${legacyDate(scene.date)} by ${scene.logged_by}`);
  return { ok: true };
}

/** The author asks leadership to delete their scene. One open request per scene. */
export async function requestSceneDeletion(logId, text) {
  const actor = await requireActor(1, ET);
  const { scene, error } = loadScene(logId);
  if (error) return fail(error);
  if (scene.author_id !== actor.id && actor.level < 2) return fail('Only the author or a team lead can request deletion of this scene.');
  if (queryOne("SELECT id FROM deletion_requests WHERE target_table = 'scene_logs' AND target_row_id = ? AND status = 'PENDING'", [scene.id])) return fail('A deletion request for this scene is already pending.');
  const original = str(text, { max: 8000 }) || scene.notes || '';
  const ins = run("INSERT INTO deletion_requests (requested_by, discord_id, content_type, original_text, target_row_id, target_table) VALUES (?, ?, 'scene_log', ?, ?, 'scene_logs')",
    [actor.name, actor.id, original, scene.id]);
  logAudit(actor.id, actor.name, 'DELETE_REQUEST', 'scene_log', scene.id, scene.faction, `Request #${Number(ins.lastInsertRowid)} · ${original.slice(0, 100)}`);
  return { ok: true, id: Number(ins.lastInsertRowid) };
}

// Active factions with fewer than this many scenes in the last 30 days need attention.
const ATTENTION_THRESHOLD = 2;

/** [[factionName, scenes30d], …] for active factions under the 30-day threshold, fewest first. */
export async function getAttentionFactions() {
  await requireActor(1, ET);
  const rows = query(`SELECT f.name, COALESCE((SELECT COUNT(*) FROM scene_logs sl WHERE sl.faction_id = f.id AND sl.created_at >= datetime('now','-30 days')), 0) AS n
    FROM factions f WHERE f.archived = 0 ORDER BY n ASC, f.name ASC`);
  return rows.filter(r => r.n < ATTENTION_THRESHOLD).map(r => [r.name, r.n]);
}

/** Cash and items handed out, per distributor (same figures as inventory/getDistributionStats). */
export async function getTreasuryStats() {
  await requireActor(2, ET);
  const stats = {};
  const bucket = (who) => (stats[who] = stats[who] || { cash: 0, items: {} });
  for (const r of query("SELECT item_name, quantity, distributed_by FROM inventory_logs")) {
    const b = bucket(r.distributed_by);
    b.items[r.item_name] = (b.items[r.item_name] || 0) + r.quantity;
  }
  for (const r of query("SELECT amount, distributed_by FROM treasury_logs")) bucket(r.distributed_by).cash += r.amount;
  return stats;
}
