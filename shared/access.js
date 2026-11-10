// Faction-level access rules, in one place.
//
// Reads are global: every staff member may look at every faction. Writes are
// scoped: a guide or team lead may change factions led by someone on their
// team (or that they lead themselves); leadership and Event Team are unscoped.
// Archived factions accept no writes until restored.
import { query, queryOne } from './db.js';

/** null = unscoped (L3 / Event Team); otherwise the set of faction ids the actor may write. */
export function writableFactionIds(actor) {
  if (!actor) return new Set();
  if (actor.level >= 3 || actor.isEventTeam) return null;
  const ids = new Set();
  const led = query("SELECT id FROM factions WHERE lead_discord_id = ?", [actor.id]);
  for (const f of led) ids.add(f.id);
  if (actor.teamId) {
    const team = query("SELECT f.id FROM factions f JOIN staff s ON s.discord_id = f.lead_discord_id WHERE s.team_id = ?", [actor.teamId]);
    for (const f of team) ids.add(f.id);
  }
  return ids;
}

export function canWriteFaction(actor, factionId) {
  const ids = writableFactionIds(actor);
  return ids === null || ids.has(Number(factionId));
}

/** Factions the actor may write, as rows (used by pickers and review scoping). */
export function writableFactions(actor) {
  const ids = writableFactionIds(actor);
  const rows = query("SELECT * FROM factions WHERE archived = 0 ORDER BY name");
  return ids === null ? rows : rows.filter(f => ids.has(f.id));
}

/**
 * Resolve a faction by id or exact name. Returns { faction } or { error }.
 * `allowArchived` lets read paths look at archived factions.
 */
export function resolveFaction(idOrName, { allowArchived = false } = {}) {
  let f = null;
  if (idOrName != null && idOrName !== '') {
    if (Number.isInteger(Number(idOrName)) && String(idOrName).trim() !== '') f = queryOne("SELECT * FROM factions WHERE id = ?", [Number(idOrName)]);
    if (!f) f = queryOne("SELECT * FROM factions WHERE name = ?", [String(idOrName)]);
  }
  if (!f) return { error: 'Faction not found.' };
  if (f.archived && !allowArchived) return { error: `${f.name} is archived; restore it before making changes.`, faction: f };
  return { faction: f };
}

/** { faction } when the actor may write this (active) faction, else { error }. */
export function assertFactionWrite(actor, idOrName) {
  const r = resolveFaction(idOrName);
  if (r.error) return r;
  if (!canWriteFaction(actor, r.faction.id)) return { error: `${r.faction.name} is outside your team; ask its team lead or leadership.`, faction: r.faction };
  return r;
}
