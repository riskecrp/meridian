// Faction lookup for slash commands: exact name first, then a single
// case-insensitive LIKE match, with an ambiguity error rather than a guess.
// Writes refuse archived factions and go through the dashboard's scope rules
// (shared/access.js) so a guide cannot log against another team's
// faction from Discord when the site would refuse it.
import { query, queryOne } from './db.js';
import { canWriteFaction } from '../../shared/access.js';

const esc = (s) => String(s).replace(/[%_\\]/g, '\\$&');

/**
 * Resolve a faction by id or name. Returns { faction } or { error }.
 * `allowArchived` lets read-only commands look at archived factions.
 */
export function findFaction(input, { allowArchived = false } = {}) {
  const raw = String(input ?? '').trim();
  if (!raw) return { error: 'A faction is required.' };
  let f = null;
  if (/^\d+$/.test(raw)) f = queryOne('SELECT * FROM factions WHERE id = ?', [Number(raw)]);
  if (!f) f = queryOne('SELECT * FROM factions WHERE name = ? COLLATE NOCASE', [raw]);
  if (!f) {
    const like = query("SELECT * FROM factions WHERE name LIKE ? ESCAPE '\\' COLLATE NOCASE ORDER BY archived, name", [`%${esc(raw)}%`]);
    if (like.length > 1) {
      const live = like.filter(x => !x.archived);
      if (live.length === 1 && !allowArchived) f = live[0];
      else return { error: `"${raw}" matches several factions: ${like.slice(0, 5).map(x => x.name + (x.archived ? ' (archived)' : '')).join(', ')}. Pick one from the list.` };
    } else if (like.length === 1) f = like[0];
  }
  if (!f) return { error: `Faction "${raw}" not found.` };
  if (f.archived && !allowArchived) return { error: `${f.name} is archived; restore it on the dashboard before adding to it.`, faction: f };
  return { faction: f };
}

/** { faction } when the actor may write this (active) faction, else { error }. */
export function assertFactionWrite(actor, input) {
  const r = findFaction(input);
  if (r.error) return r;
  if (!canWriteFaction(actor, r.faction.id)) {
    return { error: `${r.faction.name} is outside your team; ask its team lead or leadership.`, faction: r.faction };
  }
  return r;
}

/**
 * Autocomplete choices. Writes list only live factions; reads list archived
 * ones too, labelled so nobody picks one by accident.
 */
export function factionChoices(focused, { includeArchived = false } = {}) {
  const needle = String(focused || '').toLowerCase();
  const rows = query(includeArchived ? 'SELECT id, name, archived FROM factions ORDER BY archived, name' : 'SELECT id, name, archived FROM factions WHERE archived = 0 ORDER BY name');
  return rows
    .filter(r => !needle || r.name.toLowerCase().includes(needle))
    .slice(0, 25)
    .map(r => ({ name: r.archived ? `${r.name} (archived)` : r.name, value: String(r.id) }));
}

export async function respondFactions(interaction, opts) {
  try { await interaction.respond(factionChoices(interaction.options.getFocused(), opts)); } catch (e) { console.error('[AUTOCOMPLETE]', e.message); }
}
