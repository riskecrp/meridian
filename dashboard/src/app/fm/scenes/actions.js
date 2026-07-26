"use server";
import { query, queryOne, run } from "../../../lib/db.js";
import { logAudit } from "../../../lib/audit.js";
import { requireActor } from "../../../lib/requireActor.js";
import { pingChannel } from "../../../lib/pings.js";

function today() { return new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}).replace(/ /g,'/').toUpperCase(); }

export async function getSceneLogs() {
  await requireActor(1, {allowEventTeam: true});
  const logs = query(`SELECT sl.id, sl.date, f.name as faction, sl.rewards, sl.logged_by, sl.notes, sl.author_id
    FROM scene_logs sl JOIN factions f ON sl.faction_id = f.id ORDER BY sl.date DESC, sl.created_at DESC`);
  const assistants = query(`SELECT sa.id, sa.scene_id, sa.staff_id, sa.staff_name FROM scene_assistants sa ORDER BY sa.added_at ASC`);
  const byScene = {};
  assistants.forEach(a => { if (!byScene[a.scene_id]) byScene[a.scene_id] = []; byScene[a.scene_id].push(a); });
  return logs.map(l => ({ ...l, assistants: byScene[l.id] || [] }));
}

export async function getFactionNames() {
  await requireActor(1, {allowEventTeam: true});
  return query("SELECT name FROM factions WHERE archived = 0 ORDER BY name").map(r => r.name);
}

export async function getInventoryForScene() {
  await requireActor(1, {allowEventTeam: true});
  return query("SELECT id, name, category, current_stock FROM inventory_stock WHERE current_stock > 0 ORDER BY category, name");
}

export async function getStaffForScene() {
  await requireActor(1, {allowEventTeam: true});
  return query("SELECT discord_id, display_name FROM staff WHERE discord_id != '' AND discord_id NOT LIKE 'placeholder%' ORDER BY display_name");
}

export async function submitScene(data) {
  const actor = await requireActor(1, {allowEventTeam: true});
  try {
    const fac = queryOne("SELECT id FROM factions WHERE name = ?", [data.faction]);
    if (!fac) return { ok: false, error: "Faction not found" };
    const dt = today();

    let parts = [];
    if (data.cash && parseInt(data.cash) > 0) parts.push(`$${data.cash}`);
    if (data.items?.length > 0) data.items.forEach(i => { if (i.name && parseInt(i.qty) > 0) parts.push(`${i.qty}x ${i.name}`); });
    if (data.otherRewards?.trim()) parts.push(data.otherRewards.trim());
    const rewards = parts.length > 0 ? parts.join(', ') : 'None';

    const result = run("INSERT INTO scene_logs (date, faction_id, rewards, logged_by, notes, author_id) VALUES (?, ?, ?, ?, ?, ?)",
      [dt, fac.id, rewards, actor.name, data.notes, actor.id]);
    const sceneId = result.lastInsertRowid;

    // Insert assistants
    const assistants = (data.assistants || []).filter(a => a.staff_id && a.staff_id !== actor.id);
    for (const a of assistants) {
      run("INSERT INTO scene_assistants (scene_id, staff_id, staff_name, added_by_id, added_by_name) VALUES (?,?,?,?,?)",
        [sceneId, a.staff_id, a.staff_name, actor.id, actor.name]);
    }

    if (data.cash && parseInt(data.cash) > 0) {
      run("INSERT INTO treasury_logs (date, faction_name, amount, distributed_by) VALUES (?, ?, ?, ?)",
        [dt, data.faction, parseInt(data.cash), actor.name]);
    }

    if (data.items?.length > 0) {
      for (const sel of data.items) {
        const item = queryOne("SELECT id, current_stock FROM inventory_stock WHERE name = ?", [sel.name]);
        const qty = parseInt(sel.qty);
        if (item && qty > 0) {
          const newStock = item.current_stock - qty;
          run("UPDATE inventory_stock SET current_stock = ?, updated_at = datetime('now') WHERE id = ?", [newStock, item.id]);
          run("INSERT INTO inventory_logs (date, item_name, quantity, distributed_by) VALUES (?, ?, ?, ?)", [dt, sel.name, qty, actor.name]);
        }
      }
    }

    logAudit(actor.id, actor.name, 'CREATE', 'scene_log', null, data.faction, `Rewards: ${rewards}`);
    return { ok: true };
  } catch (e) { console.error("submitScene:", e); return { ok: false, error: e.message }; }
}

export async function addMyselfToScene(sceneId) {
  const actor = await requireActor(1, {allowEventTeam: true});

  const scene = queryOne("SELECT sl.id, sl.author_id, sl.notes, sl.date, f.name as faction FROM scene_logs sl JOIN factions f ON sl.faction_id = f.id WHERE sl.id = ?", [sceneId]);
  if (!scene) return { ok: false, error: "Scene not found." };
  if (scene.author_id === actor.id) return { ok: false, error: "You are the scene creator." };

  // Check not already an assistant
  const existing = queryOne("SELECT id FROM scene_assistants WHERE scene_id = ? AND staff_id = ?", [sceneId, actor.id]);
  if (existing) return { ok: false, error: "You are already listed on this scene." };

  run("INSERT INTO scene_assistants (scene_id, staff_id, staff_name, added_by_id, added_by_name) VALUES (?,?,?,?,?)",
    [sceneId, actor.id, actor.name, actor.id, actor.name]);

  logAudit(actor.id, actor.name, 'EDIT', 'scene_log', sceneId, 'self-added as assistant', '');

  // Ping the original author in the Meridian DB channel
  if (scene.author_id) {
    const token = process.env.DISCORD_BOT_TOKEN;
    const chan = pingChannel('scene.assistant_added');
    if (token && chan) {
      const msg = `📋 <@${scene.author_id}> — **${actor.name}** has added themselves to your scene log for **${scene.faction}** (${scene.date}).\n> ${(scene.notes || '').substring(0, 150)}${scene.notes?.length > 150 ? '…' : ''}`;
      try {
        await fetch(`https://discord.com/api/v10/channels/${chan}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: msg }),
        });
      } catch (e) { console.error('[SCENE] ping failed:', e.message); }
    }
  }

  return { ok: true };
}

export async function removeAssistantFromScene(assistantId) {
  const actor = await requireActor(2, {allowEventTeam: true});
  const row = queryOne("SELECT sa.id, sa.staff_name, sa.scene_id, sl.author_id FROM scene_assistants sa JOIN scene_logs sl ON sa.scene_id = sl.id WHERE sa.id = ?", [assistantId]);
  if (!row) return { ok: false, error: "Assistant record not found." };
  run("DELETE FROM scene_assistants WHERE id = ?", [assistantId]);
  logAudit(actor.id, actor.name, 'DELETE', 'scene_assistant', assistantId, row.staff_name, 'L2+ removal');
  return { ok: true };
}

export async function editSceneNotes(logId, notes) {
  const actor = await requireActor(1, {allowEventTeam: true});
  const log = queryOne("SELECT author_id FROM scene_logs WHERE id = ?", [logId]);
  if (!log) return { ok: false, error: "Scene not found" };
  if (log.author_id !== actor.id && actor.level < 2) return { ok: false, error: "Only the author or L2+ can edit this scene" };
  run("UPDATE scene_logs SET notes = ? WHERE id = ?", [notes, logId]);
  logAudit(actor.id, actor.name, 'EDIT', 'scene_log', logId, '', notes.substring(0,100));
  return { ok: true };
}

export async function deleteScene(logId) {
  const actor = await requireActor(3, {allowEventTeam: true});
  run("DELETE FROM scene_logs WHERE id = ?", [logId]);
  logAudit(actor.id, actor.name, 'DELETE', 'scene_log', logId, '', 'L3 direct delete');
  return { ok: true };
}

export async function requestSceneDeletion(logId, text) {
  const actor = await requireActor(1, {allowEventTeam: true});
  run("INSERT INTO deletion_requests (requested_by, discord_id, content_type, original_text, target_row_id, target_table) VALUES (?, ?, 'scene_log', ?, ?, 'scene_logs')",
    [actor.name, actor.id, text, logId]);
  logAudit(actor.id, actor.name, 'DELETE_REQUEST', 'scene_log', logId, '', text.substring(0,100));
  return { ok: true };
}

export async function getAttentionFactions() {
  await requireActor(1, {allowEventTeam: true});
  const factions = query("SELECT name FROM factions WHERE archived = 0 ORDER BY name").map(r => r.name);
  const counts = {};
  factions.forEach(f => counts[f] = 0);
  const logs = query("SELECT f.name FROM scene_logs sl JOIN factions f ON sl.faction_id = f.id");
  logs.forEach(l => { if (counts[l.name] !== undefined) counts[l.name]++; });
  return Object.entries(counts).sort((a,b) => a[1] - b[1]).slice(0, 4);
}

export async function getTreasuryStats() {
  await requireActor(2, {allowEventTeam: true});
  const stats = {};
  const inv = query("SELECT * FROM inventory_logs");
  const treas = query("SELECT * FROM treasury_logs");
  inv.forEach(r => {
    if (!stats[r.distributed_by]) stats[r.distributed_by] = { cash: 0, items: {} };
    stats[r.distributed_by].items[r.item_name] = (stats[r.distributed_by].items[r.item_name] || 0) + r.quantity;
  });
  treas.forEach(r => {
    if (!stats[r.distributed_by]) stats[r.distributed_by] = { cash: 0, items: {} };
    stats[r.distributed_by].cash += r.amount;
  });
  return stats;
}
