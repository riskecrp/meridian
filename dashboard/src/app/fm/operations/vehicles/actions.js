"use server";
import { query, queryOne, run, transaction } from "../../../../lib/db.js";
import { logAudit } from "../../../../lib/audit.js";
import { requireActor } from "../../../../lib/requireActor.js";
import { checkFleetAdd } from "../../../../lib/fleet.js";
import { resolveFaction } from "../../../../lib/access.js";
import { str, toInt, fail } from "../../../../../../shared/validate.js";

// Vehicle catalog (Library › Vehicle Catalog, legacy /fm/operations/vehicles).
//
// Reads are for every staff member. Mutations are leadership (L3) only: the
// catalog is faction-facing policy, not a scene asset, so Event Team is
// read-only here (policy 4).
//
// `use_count` means "times a catalog vehicle was pushed into a garage" (the
// quantity added, summed over every add). It never goes down — deleting a
// vehicle from a garage is not an un-add. The live picture ("how many factions
// have it right now / how many are in circulation") is computed from
// faction_fleet_vehicles in listCatalog as `factions_using` / `in_circulation`.

function cleanEntry(data) {
  const d = data && typeof data === "object" ? data : {};
  return {
    vehicle_name: str(d.vehicle_name, { max: 120 }),
    spawn_name: str(d.spawn_name, { max: 120 }),
    notes: str(d.notes, { max: 2000 }),
  };
}

export async function listCatalog() {
  await requireActor(1, { allowEventTeam: true, allowLeadStoryteller: true });
  return query(`SELECT c.id, c.vehicle_name, c.spawn_name, c.notes, c.use_count,
      (SELECT COUNT(DISTINCT v.faction_id) FROM faction_fleet_vehicles v JOIN factions f ON f.id = v.faction_id
         WHERE v.vehicle_name = c.vehicle_name COLLATE NOCASE AND f.archived = 0) AS factions_using,
      (SELECT COALESCE(SUM(v.quantity), 0) FROM faction_fleet_vehicles v JOIN factions f ON f.id = v.faction_id
         WHERE v.vehicle_name = c.vehicle_name COLLATE NOCASE AND f.archived = 0) AS in_circulation
    FROM fleet_vehicle_catalog c ORDER BY c.vehicle_name COLLATE NOCASE`);
}

export async function createCatalogEntry(data) {
  const actor = await requireActor(3);
  const e = cleanEntry(data);
  if (!e.vehicle_name) return fail("Vehicle name required");
  const existing = queryOne("SELECT id, vehicle_name FROM fleet_vehicle_catalog WHERE vehicle_name = ? COLLATE NOCASE", [e.vehicle_name]);
  if (existing) return fail(`"${existing.vehicle_name}" is already in the catalog`);
  const r = run("INSERT INTO fleet_vehicle_catalog (vehicle_name, spawn_name, notes, use_count) VALUES (?, ?, ?, 0)",
    [e.vehicle_name, e.spawn_name, e.notes]);
  logAudit(actor.id, actor.name, 'CREATE', 'fleet_vehicle_catalog', r.lastInsertRowid, e.vehicle_name, e.spawn_name ? `spawn ${e.spawn_name}` : '');
  return { ok: true, id: Number(r.lastInsertRowid) };
}

export async function updateCatalogEntry(id, data) {
  const actor = await requireActor(3);
  const cid = toInt(id, { min: 1 });
  if (!cid) return fail("Not found");
  const existing = queryOne("SELECT * FROM fleet_vehicle_catalog WHERE id = ?", [cid]);
  if (!existing) return fail("Not found");
  const e = cleanEntry(data);
  if (!e.vehicle_name) return fail("Vehicle name required");
  const dupe = queryOne("SELECT id, vehicle_name FROM fleet_vehicle_catalog WHERE vehicle_name = ? COLLATE NOCASE AND id != ?", [e.vehicle_name, cid]);
  if (dupe) return fail(`Another vehicle already uses the name "${dupe.vehicle_name}"`);

  const nameChanged = existing.vehicle_name !== e.vehicle_name;
  const spawnChanged = (existing.spawn_name || '') !== e.spawn_name;
  let renamedRows = 0, respawnedRows = 0;
  transaction(() => {
    run("UPDATE fleet_vehicle_catalog SET vehicle_name = ?, spawn_name = ?, notes = ? WHERE id = ?",
      [e.vehicle_name, e.spawn_name, e.notes, cid]);
    // Garage rows follow the catalog name so the two never drift apart.
    if (nameChanged) {
      renamedRows = run("UPDATE faction_fleet_vehicles SET vehicle_name = ? WHERE vehicle_name = ? COLLATE NOCASE", [e.vehicle_name, existing.vehicle_name]).changes;
    }
    // A spawn change only follows into garage rows that still carry the OLD
    // catalog spawn (or none). A faction given a custom spawn keeps it.
    if (spawnChanged) {
      respawnedRows = run("UPDATE faction_fleet_vehicles SET spawn_name = ? WHERE vehicle_name = ? COLLATE NOCASE AND (spawn_name = '' OR spawn_name = ?)",
        [e.spawn_name, e.vehicle_name, existing.spawn_name || '']).changes;
    }
  });
  const details = [];
  if (nameChanged) details.push(`renamed from "${existing.vehicle_name}" (${renamedRows} garage row${renamedRows === 1 ? '' : 's'})`);
  if (spawnChanged) details.push(`spawn "${existing.spawn_name || '—'}" → "${e.spawn_name || '—'}" (${respawnedRows} garage row${respawnedRows === 1 ? '' : 's'})`);
  logAudit(actor.id, actor.name, 'EDIT', 'fleet_vehicle_catalog', cid, e.vehicle_name, details.join('; ') || 'Notes updated');
  return { ok: true, renamedRows, respawnedRows };
}

export async function deleteCatalogEntry(id) {
  const actor = await requireActor(3);
  const cid = toInt(id, { min: 1 });
  if (!cid) return fail("Not found");
  const existing = queryOne("SELECT * FROM fleet_vehicle_catalog WHERE id = ?", [cid]);
  if (!existing) return fail("Not found");
  const inUse = queryOne(`SELECT COUNT(DISTINCT v.faction_id) AS factions, COALESCE(SUM(v.quantity), 0) AS qty
    FROM faction_fleet_vehicles v WHERE v.vehicle_name = ? COLLATE NOCASE`, [existing.vehicle_name]);
  if (inUse && inUse.factions > 0) {
    return fail(`Cannot delete — ${inUse.factions} faction${inUse.factions === 1 ? '' : 's'} still ${inUse.factions === 1 ? 'has' : 'have'} ${inUse.qty} of this vehicle in their garage. Remove it from those garages first.`);
  }
  run("DELETE FROM fleet_vehicle_catalog WHERE id = ?", [cid]);
  logAudit(actor.id, actor.name, 'DELETE', 'fleet_vehicle_catalog', cid, existing.vehicle_name, '');
  return { ok: true };
}

// Active factions for the "+ Faction" picker (L3 — the add itself is L3).
export async function listFactionsForAdd() {
  await requireActor(3);
  return query("SELECT id, name, tier FROM factions WHERE archived = 0 ORDER BY name");
}

// Add `quantity` of a catalog vehicle to a faction's garage, inside the
// faction's effective limits (lib/fleet.js — the same check the Fleet page
// uses). An existing row for that vehicle is topped up; otherwise a row is
// inserted with the catalog spawn copied in. use_count += quantity.
export async function addCatalogVehicleToFaction(catalogId, factionId, quantity) {
  const actor = await requireActor(3);
  const qty = toInt(quantity, { min: 1, max: 500 });
  if (!qty) return fail("Quantity must be a whole number between 1 and 500");
  const cid = toInt(catalogId, { min: 1 });
  const entry = cid ? queryOne("SELECT * FROM fleet_vehicle_catalog WHERE id = ?", [cid]) : null;
  if (!entry) return fail("Catalog entry not found");
  const rf = resolveFaction(factionId);
  if (rf.error) return fail(rf.error);
  const faction = rf.faction;

  const check = checkFleetAdd(faction.id, faction.tier, entry.vehicle_name, qty);
  if (!check.ok) return fail(check.error);
  const { limits, existing } = check;

  let rowId;
  transaction(() => {
    if (existing) {
      run("UPDATE faction_fleet_vehicles SET quantity = quantity + ? WHERE id = ?", [qty, existing.id]);
      rowId = existing.id;
    } else {
      rowId = Number(run("INSERT INTO faction_fleet_vehicles (faction_id, vehicle_name, spawn_name, quantity, notes, created_by) VALUES (?, ?, ?, ?, '', ?)",
        [faction.id, entry.vehicle_name, entry.spawn_name || '', qty, actor.name]).lastInsertRowid);
    }
    run("INSERT INTO faction_history (faction_id, faction_name, action_type, details, authorized_by) VALUES (?, ?, 'FLEET', ?, ?)",
      [faction.id, faction.name, `Added ${qty}x ${entry.vehicle_name} to fleet (from catalog)`, actor.name]);
    run("UPDATE fleet_vehicle_catalog SET use_count = use_count + ? WHERE id = ?", [qty, cid]);
  });
  logAudit(actor.id, actor.name, existing ? 'EDIT' : 'CREATE', 'fleet_vehicle', rowId, `${faction.name} fleet`, `+${qty} ${entry.vehicle_name}`);

  const total = queryOne("SELECT COALESCE(SUM(quantity),0) AS t FROM faction_fleet_vehicles WHERE faction_id = ?", [faction.id])?.t ?? qty;
  return {
    ok: true, faction: faction.name, vehicle: entry.vehicle_name, added: qty, rowId, newTotal: total,
    // camelCase is the lib/fleet.js shape; snake_case kept for the Library page.
    limits: { ...limits, max_types: limits.maxTypes, max_total: limits.maxTotal, max_garages: limits.maxGarages },
  };
}
