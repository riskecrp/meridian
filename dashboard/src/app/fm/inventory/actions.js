"use server";
import { query, run } from "../../../lib/db.js";
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
  await requireActor(1, {allowLeadStoryteller: true});
  return query("SELECT id, name, category FROM inventory_stock ORDER BY category, name");
}

export async function addInventoryItem(data) {
  const actor = await requireActor(3);
  const name = String(data?.name || '').trim();
  const category = String(data?.category || '').trim();
  if (!name) return { ok: false, error: 'An item needs a name.' };
  // The stock columns take their schema defaults; nothing reads them.
  run("INSERT INTO inventory_stock (name, category) VALUES (?, ?)", [name, category]);
  logAudit(actor.id, actor.name, 'CREATE', 'inventory', null, name, category ? `Category: ${category}` : '');
  return { ok: true };
}

export async function deleteInventoryItem(itemId) {
  const actor = await requireActor(3);
  // Only the catalogue entry goes. inventory_logs keeps its own copy of the item
  // name, so removing an item never rewrites the history of it being given out.
  const item = query("SELECT name FROM inventory_stock WHERE id = ?", [itemId])[0];
  run("DELETE FROM inventory_stock WHERE id=?", [itemId]);
  logAudit(actor.id, actor.name, 'DELETE', 'inventory', itemId, item?.name || '', 'removed from the item list');
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
