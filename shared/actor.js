// Who is acting, resolved the same way on both surfaces.
//
// The dashboard resolves an actor from the session cookie (dashboard/src/lib/
// requireActor.js); the bot resolves it from a Discord user id. Both produce
// this shape, so shared modules (tasks, RP changes) can gate on `level` and
// flags without caring where the call came from:
//   { id, name, level, rank, teamId, teamName, isEventTeam, isLeadStoryteller, isOwner, source }
import { queryOne } from './db.js';
import { isOwner } from './owners.js';

/** Clearance boosted by an individual dashboard_access grant. */
export function effectiveLevel(discordId, baseLevel) {
  const grant = queryOne("SELECT level FROM dashboard_access WHERE discord_id = ?", [discordId]);
  return grant ? Math.max(Number(baseLevel) || 0, Number(grant.level) || 0) : (Number(baseLevel) || 0);
}

/** True when a Discord id is leadership for routing purposes (L3 by clearance or grant). */
export function isLeadershipStaff(discordId) {
  if (!discordId) return false;
  const s = queryOne("SELECT clearance FROM staff WHERE discord_id = ?", [discordId]);
  return effectiveLevel(discordId, s?.clearance || 0) >= 3;
}

/**
 * Event Team / Lead Storyteller flags. staff.lead_storyteller is the admin-
 * managed source; the most recent login session carries the Discord-role-
 * derived fallback for both flags.
 */
export function roleFlags(discordId) {
  const row = queryOne("SELECT event_team, lead_storyteller FROM sessions WHERE discord_id = ? ORDER BY id DESC LIMIT 1", [discordId]);
  const staff = queryOne("SELECT lead_storyteller FROM staff WHERE discord_id = ?", [discordId]);
  return { isEventTeam: !!row?.event_team, isLeadStoryteller: !!row?.lead_storyteller || !!staff?.lead_storyteller };
}

/**
 * Bot side: an actor from a Discord user id, or null when they are not on the
 * staff roster (placeholder rows from the Sheets import never count).
 * `fallbackName` is the Discord display name for logs and pings.
 */
export function actorFromDiscord(discordId, fallbackName = '') {
  const s = queryOne("SELECT discord_id, display_name, discord_name, clearance, rank, team_id, team_name, active FROM staff WHERE discord_id = ? AND discord_id NOT LIKE 'placeholder%'", [discordId]);
  if (!s || s.active === 0) return null;
  const flags = roleFlags(discordId);
  return {
    id: s.discord_id,
    name: s.display_name || s.discord_name || fallbackName || discordId,
    displayName: s.display_name || '',
    level: effectiveLevel(discordId, s.clearance),
    rank: s.rank || '',
    teamId: s.team_id || '',
    teamName: s.team_name || '',
    isEventTeam: flags.isEventTeam,
    isLeadStoryteller: flags.isLeadStoryteller,
    isOwner: isOwner(discordId),
    source: 'bot',
  };
}

/** Audit-log name for an actor: shows the real person behind an impersonation. */
export function auditName(actor) {
  if (!actor) return '';
  if (actor._impersonating && actor._realId) return `${actor.name} (as ${actor._realName || actor._realId})`;
  return actor.name;
}
