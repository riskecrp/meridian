"use server";
import { query, queryOne, run } from "../../../lib/db.js";
import { logAudit } from "../../../lib/audit.js";
import { requireActor } from "../../../lib/requireActor.js";

export async function getInventory() {
  await requireActor(1, {allowLeadStoryteller: true});
  return query("SELECT * FROM inventory_stock ORDER BY category, name");
}

export async function addInventoryItem(data) {
  const actor = await requireActor(3);
  run("INSERT INTO inventory_stock (name, category, starting_stock, current_stock, threshold, purchaseable) VALUES (?, ?, ?, ?, ?, ?)",
    [data.name, data.category, parseInt(data.stock)||0, parseInt(data.stock)||0, parseInt(data.threshold)||0, data.purchaseable?1:0]);
  logAudit(actor.id, actor.name, 'CREATE', 'inventory', null, data.name, `Stock: ${data.stock}`);
  return { ok: true };
}

export async function updateStock(itemId, newStock) {
  const actor = await requireActor(2);
  run("UPDATE inventory_stock SET current_stock=?, updated_at=datetime('now') WHERE id=?", [newStock, itemId]);
  logAudit(actor.id, actor.name, 'EDIT', 'inventory', itemId, '', `Stock set to ${newStock}`);
  return { ok: true };
}

export async function deleteInventoryItem(itemId) {
  const actor = await requireActor(3);
  run("DELETE FROM inventory_stock WHERE id=?", [itemId]);
  logAudit(actor.id, actor.name, 'DELETE', 'inventory', itemId, '', '');
  return { ok: true };
}

export async function getDistributionStats() {
  await requireActor(2);
  const stats = {};
  const inv = query("SELECT * FROM inventory_logs");
  const treas = query("SELECT * FROM treasury_logs");
  inv.forEach(r => { if (!stats[r.distributed_by]) stats[r.distributed_by]={cash:0,items:{}}; stats[r.distributed_by].items[r.item_name]=(stats[r.distributed_by].items[r.item_name]||0)+r.quantity; });
  treas.forEach(r => { if (!stats[r.distributed_by]) stats[r.distributed_by]={cash:0,items:{}}; stats[r.distributed_by].cash+=r.amount; });
  return stats;
}
