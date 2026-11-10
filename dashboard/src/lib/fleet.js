// Fleet limits, in one place. The Fleet page (fm/operations/actions.js) and the
// vehicle catalog (fm/operations/vehicles/actions.js) used to carry their own
// copy of the tier table and their own limit check, and disagreed about what a
// "type" was. A type is a distinct vehicle name; the total is the sum of
// quantities; an override row replaces the tier defaults field by field.
import { query, queryOne } from './db.js';

export const TIER_DEFAULTS = {
  1: { types: 0,  total: 0,  garages: 1, stipend: 0 },
  2: { types: 1,  total: 5,  garages: 1, stipend: 4000 },
  3: { types: 2,  total: 10, garages: 1, stipend: 8000 },
  4: { types: 4,  total: 15, garages: 2, stipend: 12000 },
  5: { types: 5,  total: 18, garages: 2, stipend: 14400 },
  6: { types: 6,  total: 21, garages: 2, stipend: 16800 },
  7: { types: 8,  total: 24, garages: 3, stipend: 19200 },
  8: { types: 9,  total: 27, garages: 3, stipend: 21600 },
  9: { types: 10, total: 30, garages: 3, stipend: 24000 },
};

export function getEffectiveLimits(factionId, tier) {
  const defaults = TIER_DEFAULTS[tier] || TIER_DEFAULTS[1];
  const o = queryOne("SELECT max_types, max_total, max_garages, override_reason, overridden_by, overridden_at FROM faction_fleet_config WHERE faction_id = ?", [factionId]);
  return {
    maxTypes: o?.max_types ?? defaults.types,
    maxTotal: o?.max_total ?? defaults.total,
    maxGarages: o?.max_garages ?? defaults.garages,
    stipend: defaults.stipend,
    isOverridden: !!o,
    overrideReason: o?.override_reason || '',
    overriddenBy: o?.overridden_by || '',
    overriddenAt: o?.overridden_at || '',
  };
}

/** Current fleet state for a faction: rows, distinct names, total quantity. */
export function fleetState(factionId) {
  const vehicles = query("SELECT * FROM faction_fleet_vehicles WHERE faction_id = ? ORDER BY vehicle_name", [factionId]);
  const names = new Set(vehicles.map(v => v.vehicle_name.toLowerCase()));
  return { vehicles, typeCount: names.size, total: vehicles.reduce((s, v) => s + (Number(v.quantity) || 0), 0) };
}

/**
 * Can `quantity` more of `vehicleName` be added (or, with `excludeId`, can that
 * row be changed to `quantity`)? Returns { ok } or { ok:false, error }.
 */
export function checkFleetAdd(factionId, tier, vehicleName, quantity, { excludeId = null } = {}) {
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1) return { ok: false, error: 'Quantity must be a whole number of at least 1.' };
  const name = String(vehicleName || '').trim();
  if (!name) return { ok: false, error: 'A vehicle name is required.' };
  const limits = getEffectiveLimits(factionId, tier);
  const { vehicles } = fleetState(factionId);
  const others = excludeId ? vehicles.filter(v => v.id !== excludeId) : vehicles;
  const names = new Set(others.map(v => v.vehicle_name.toLowerCase()));
  const isNewType = !names.has(name.toLowerCase());
  if (isNewType && names.size + 1 > limits.maxTypes) {
    return { ok: false, error: `${name} would be vehicle type ${names.size + 1} of ${limits.maxTypes} allowed. Pick a type the faction already has, or override its limits first.` };
  }
  const total = others.reduce((s, v) => s + (Number(v.quantity) || 0), 0) + qty;
  if (total > limits.maxTotal) {
    return { ok: false, error: `That would bring the fleet to ${total} vehicles; the limit is ${limits.maxTotal}. Reduce the quantity or override the limits first.` };
  }
  return { ok: true, limits, existing: others.find(v => v.vehicle_name.toLowerCase() === name.toLowerCase()) || null };
}
