"use server";
import { query, queryOne, run } from "../../../../lib/db.js";
import { logAudit } from "../../../../lib/audit.js";
import { requireActor } from "../../../../lib/requireActor.js";

export async function listCatalog() {
  // Read-only reference for every staff member (it lives in the Library now).
  // Creating/editing/deleting and pushing a vehicle into a faction garage below
  // are all still L3/Event Team.
  await requireActor(1, {allowEventTeam: true, allowLeadStoryteller: true});
  return query("SELECT id, vehicle_name, spawn_name, notes, use_count FROM fleet_vehicle_catalog ORDER BY vehicle_name");
}

export async function createCatalogEntry(data) {
  const actor = await requireActor(3, {allowEventTeam: true});
  if (!data.vehicle_name || !data.vehicle_name.trim()) return { ok: false, error: "Vehicle name required" };
  const existing = queryOne("SELECT id FROM fleet_vehicle_catalog WHERE vehicle_name = ?", [data.vehicle_name.trim()]);
  if (existing) return { ok: false, error: "A vehicle with that name already exists in the catalog" };
  run("INSERT INTO fleet_vehicle_catalog (vehicle_name, spawn_name, notes, use_count) VALUES (?, ?, ?, 0)",
    [data.vehicle_name.trim(), (data.spawn_name || '').trim(), (data.notes || '').trim()]);
  logAudit(actor.id, actor.name, 'CREATE', 'fleet_vehicle_catalog', null, data.vehicle_name.trim(), '');
  return { ok: true };
}

export async function updateCatalogEntry(id, data) {
  const actor = await requireActor(3, {allowEventTeam: true});
  const existing = queryOne("SELECT * FROM fleet_vehicle_catalog WHERE id = ?", [id]);
  if (!existing) return { ok: false, error: "Not found" };
  if (!data.vehicle_name || !data.vehicle_name.trim()) return { ok: false, error: "Vehicle name required" };
  // Check name collision (other entry with same name)
  const dupe = queryOne("SELECT id FROM fleet_vehicle_catalog WHERE vehicle_name = ? AND id != ?", [data.vehicle_name.trim(), id]);
  if (dupe) return { ok: false, error: "Another vehicle already uses that name" };
  run("UPDATE fleet_vehicle_catalog SET vehicle_name = ?, spawn_name = ?, notes = ? WHERE id = ?",
    [data.vehicle_name.trim(), (data.spawn_name || '').trim(), (data.notes || '').trim(), id]);
  // If the vehicle name changed, update faction_fleet_vehicles to keep them in sync.
  if (existing.vehicle_name !== data.vehicle_name.trim()) {
    run("UPDATE faction_fleet_vehicles SET vehicle_name = ? WHERE vehicle_name = ?", [data.vehicle_name.trim(), existing.vehicle_name]);
  }
  // If spawn_name changed, propagate to all faction rows that don't have one set yet — and overwrite any matching the old value
  if (existing.spawn_name !== (data.spawn_name || '').trim()) {
    run("UPDATE faction_fleet_vehicles SET spawn_name = ? WHERE vehicle_name = ?", [(data.spawn_name || '').trim(), data.vehicle_name.trim()]);
  }
  logAudit(actor.id, actor.name, 'EDIT', 'fleet_vehicle_catalog', id, data.vehicle_name.trim(), '');
  return { ok: true };
}

export async function deleteCatalogEntry(id) {
  const actor = await requireActor(3, {allowEventTeam: true});
  const existing = queryOne("SELECT * FROM fleet_vehicle_catalog WHERE id = ?", [id]);
  if (!existing) return { ok: false, error: "Not found" };
  // Check if any faction is currently using this vehicle
  const inUse = queryOne("SELECT COUNT(*) AS c FROM faction_fleet_vehicles WHERE vehicle_name = ?", [existing.vehicle_name]);
  if (inUse && inUse.c > 0) {
    return { ok: false, error: `Cannot delete — ${inUse.c} faction(s) are using this vehicle` };
  }
  run("DELETE FROM fleet_vehicle_catalog WHERE id = ?", [id]);
  logAudit(actor.id, actor.name, 'DELETE', 'fleet_vehicle_catalog', id, existing.vehicle_name, '');
  return { ok: true };
}

// Returns active factions for the dropdown
export async function listFactionsForAdd() {
  await requireActor(3, {allowEventTeam: true});
  return query("SELECT id, name, tier FROM factions WHERE archived = 0 ORDER BY name");
}

// Tier defaults — same logic visible on the Fleet page screenshot
const TIER_DEFAULTS = {
  1: { max_types: 0, max_total: 0, max_garages: 1 },
  2: { max_types: 1, max_total: 5, max_garages: 1 },
  3: { max_types: 2, max_total: 10, max_garages: 1 },
  4: { max_types: 4, max_total: 15, max_garages: 2 },
  5: { max_types: 5, max_total: 18, max_garages: 2 },
  6: { max_types: 6, max_total: 21, max_garages: 2 },
  7: { max_types: 8, max_total: 24, max_garages: 3 },
  8: { max_types: 9, max_total: 27, max_garages: 3 },
  9: { max_types: 10, max_total: 30, max_garages: 3 },
};

function getEffectiveLimits(factionId, tier) {
  const cfg = queryOne("SELECT max_types, max_total, max_garages FROM faction_fleet_config WHERE faction_id = ?", [factionId]);
  const def = TIER_DEFAULTS[tier] || { max_types: 0, max_total: 0, max_garages: 0 };
  return {
    max_types: (cfg?.max_types ?? null) !== null ? cfg.max_types : def.max_types,
    max_total: (cfg?.max_total ?? null) !== null ? cfg.max_total : def.max_total,
    max_garages: (cfg?.max_garages ?? null) !== null ? cfg.max_garages : def.max_garages,
  };
}

// Add `quantity` of `vehicle_name` to a faction's garage. Validates against
// active limits before inserting. If vehicle already exists for that faction,
// increments its quantity. Else creates a new row.
export async function addCatalogVehicleToFaction(catalogId, factionId, quantity) {
  const actor = await requireActor(3, {allowEventTeam: true});
  const qty = parseInt(quantity);
  if (!qty || qty < 1) return { ok: false, error: "Quantity must be at least 1" };
  const entry = queryOne("SELECT * FROM fleet_vehicle_catalog WHERE id = ?", [catalogId]);
  if (!entry) return { ok: false, error: "Catalog entry not found" };
  const faction = queryOne("SELECT id, name, tier FROM factions WHERE id = ?", [factionId]);
  if (!faction) return { ok: false, error: "Faction not found" };

  const limits = getEffectiveLimits(factionId, faction.tier);

  // Check existing fleet for this faction
  const existing = query("SELECT * FROM faction_fleet_vehicles WHERE faction_id = ?", [factionId]);
  const existingRow = existing.find(r => r.vehicle_name === entry.vehicle_name);

  // Type count: number of distinct vehicle_names. If we're adding a NEW name, this becomes existing.length + 1
  const newTypeCount = existingRow ? existing.length : existing.length + 1;
  if (newTypeCount > limits.max_types) {
    return { ok: false, error: `Adding "${entry.vehicle_name}" would exceed max types limit (${newTypeCount} > ${limits.max_types}). Either pick a vehicle the faction already has, or override their limits first.` };
  }

  // Total count: sum of quantities + new qty
  const currentTotal = existing.reduce((sum, r) => sum + (r.quantity || 0), 0);
  const newTotal = currentTotal + qty;
  if (newTotal > limits.max_total) {
    return { ok: false, error: `Adding ${qty}x "${entry.vehicle_name}" would exceed max total limit (${newTotal} > ${limits.max_total}). Reduce quantity or override their limits first.` };
  }

  if (existingRow) {
    run("UPDATE faction_fleet_vehicles SET quantity = quantity + ? WHERE id = ?", [qty, existingRow.id]);
    logAudit(actor.id, actor.name, 'EDIT', 'faction_fleet_vehicles', existingRow.id, `${faction.name} fleet`, `+${qty} ${entry.vehicle_name}`);
  } else {
    run("INSERT INTO faction_fleet_vehicles (faction_id, vehicle_name, spawn_name, quantity, notes, created_by) VALUES (?, ?, ?, ?, '', ?)",
      [factionId, entry.vehicle_name, entry.spawn_name || '', qty, actor.name]);
    logAudit(actor.id, actor.name, 'CREATE', 'faction_fleet_vehicles', null, `${faction.name} fleet`, `+${qty} ${entry.vehicle_name}`);
  }
  run("INSERT INTO faction_history (faction_id, action_type, details, authorized_by, created_at) VALUES (?, 'FLEET', ?, ?, datetime('now'))",
    [factionId, `Added ${qty}x ${entry.vehicle_name} to fleet`, actor.name]);
  // Bump catalog use_count
  run("UPDATE fleet_vehicle_catalog SET use_count = use_count + ? WHERE id = ?", [qty, catalogId]);

  return { ok: true, faction: faction.name, vehicle: entry.vehicle_name, added: qty, newTotal, limits };
}
