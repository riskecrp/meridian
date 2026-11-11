"use server";
import { query, queryOne, run } from "../../../lib/db.js";
import { logAudit } from "../../../lib/audit.js";
import { requireActor } from "../../../lib/requireActor.js";

/**
 * The catalogue of items that can be handed out in a scene, and the record of
 * what has actually been handed out.
 *
 * Stock levels were retired: nothing was keeping them true, so the numbers drifted
 * from reality and a shortage alert on an unmaintained number was noise. What
 * matters is kept — the list of items, so the scene form has something to offer,
 * and the log of everything given out, so distribution can be reviewed.
 *
 * inventory_stock still carries its starting_stock / current_stock / threshold /
 * purchaseable columns. Nothing reads or writes them any more; the table is an
 * item catalogue now. They are left in place rather than dropped so the historic
 * numbers survive in the handover export, and so this stays reversible.
 */

export async function getInventory() {
  // Reference data: every staff member reads it, Event Team and Lead Storytellers included (policy 3/4).
  await requireActor(1, { allowEventTeam: true, allowLeadStoryteller: true });
  return query("SELECT id, name, category FROM inventory_stock ORDER BY category, name");
}

export async function addInventoryItem(data) {
  const actor = await requireActor(3);
  const name = String(data?.name || '').trim().slice(0, 120);
  const category = String(data?.category || '').trim().slice(0, 60);
  if (!name) return { ok: false, error: 'An item needs a name.' };
  // Names are unique in the catalogue, case-insensitively, so a second "crowbar"
  // is refused with a message rather than a constraint error from SQLite.
  const dup = queryOne("SELECT id, name FROM inventory_stock WHERE LOWER(name) = LOWER(?)", [name]);
  if (dup) return { ok: false, error: `"${dup.name}" is already in the item list.` };
  // The stock columns take their schema defaults; nothing reads them.
  const ins = run("INSERT INTO inventory_stock (name, category) VALUES (?, ?)", [name, category]);
  const id = Number(ins.lastInsertRowid);
  logAudit(actor.id, actor.name, 'CREATE', 'inventory', id, name, category ? `Category: ${category}` : '');
  return { ok: true, id };
}

export async function deleteInventoryItem(itemId) {
  const actor = await requireActor(3);
  const id = Number.parseInt(itemId, 10);
  // Only the catalogue entry goes. inventory_logs keeps its own copy of the item
  // name, so removing an item never rewrites the history of it being given out.
  const item = Number.isInteger(id) ? queryOne("SELECT id, name FROM inventory_stock WHERE id = ?", [id]) : null;
  if (!item) return { ok: false, error: 'Item not found.' };
  run("DELETE FROM inventory_stock WHERE id = ?", [item.id]);
  logAudit(actor.id, actor.name, 'DELETE', 'inventory', item.id, item.name, 'removed from the item list');
  return { ok: true };
}

/** Who has handed out what: cash per person, and item quantities per person. */
export async function getDistributionStats() {
  await requireActor(2);
  const stats = {};
  const bucket = (who) => (stats[who] = stats[who] || { cash: 0, items: {} });
  for (const r of query("SELECT item_name, quantity, distributed_by FROM inventory_logs")) {
    const b = bucket(r.distributed_by);
    b.items[r.item_name] = (b.items[r.item_name] || 0) + r.quantity;
  }
  for (const r of query("SELECT amount, distributed_by FROM treasury_logs")) {
    bucket(r.distributed_by).cash += r.amount;
  }
  return stats;
}
