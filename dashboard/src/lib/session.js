import crypto from 'crypto';
import { queryOne, run } from './db.js';
import { isOwner } from '../../../shared/owners.js';
import { markImpersonation, clearImpersonation } from './auditContext.js';

const DAYS = 3;

export function createSession(staffId, discordId, discordName, clearance, eventTeam = 0, leadStoryteller = 0) {
  const token = crypto.randomBytes(32).toString('hex');
  const exp = new Date(Date.now() + DAYS * 86400000).toISOString();
  run("INSERT INTO sessions (staff_id, token, discord_id, discord_name, clearance, event_team, lead_storyteller, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [staffId, token, discordId, discordName, clearance, eventTeam, leadStoryteller, exp]);
  return { token, expiresAt: exp };
}

/** The session row joined to its staff row, or null when missing, expired or the staffer is retired. */
export function validateSession(token) {
  if (!token) return null;
  return queryOne(`SELECT s.*, st.display_name, st.team_id, st.team_name, st.rank, st.clearance AS staff_clearance,
      st.lead_storyteller AS staff_lead_storyteller, st.active AS staff_active
    FROM sessions s JOIN staff st ON st.id = s.staff_id
    WHERE s.token = ? AND s.expires_at > datetime('now') AND COALESCE(st.active, 1) = 1`, [token]) || null;
}

export function destroySession(token) { run('DELETE FROM sessions WHERE token = ?', [token]); }

/** Drop expired sessions; called on login and by the bot's housekeeping. */
export function pruneSessions() { run("DELETE FROM sessions WHERE expires_at < datetime('now')"); }

/** Clearance boosted by an individual dashboard_access grant. */
export function effectiveLevel(discordId, baseLevel) {
  const override = queryOne("SELECT level FROM dashboard_access WHERE discord_id = ?", [discordId]);
  const base = Number(baseLevel) || 0;
  return override ? Math.max(base, Number(override.level) || 0) : base;
}

// Event Team / Lead Storyteller flags. staff.lead_storyteller (admin-managed on
// the staff page) is authoritative; the most recent login session carries the
// Discord-role-derived value for both flags.
export function getRoleFlags(discordId) {
  const row = queryOne("SELECT event_team, lead_storyteller FROM sessions WHERE discord_id = ? ORDER BY id DESC LIMIT 1", [discordId]);
  const staff = queryOne("SELECT lead_storyteller FROM staff WHERE discord_id = ?", [discordId]);
  return { isEventTeam: !!row?.event_team, isLeadStoryteller: !!row?.lead_storyteller || !!staff?.lead_storyteller };
}

/**
 * The actor shape every server action receives, built from a staff-like row
 * ({discord_id, display_name, discord_name, clearance, team_id, team_name, rank})
 * and its flags. `level` is the effective clearance including grants; the
 * Event Team boost is applied by requireActor only where a page opts in.
 */
export function buildActor(row, flags, extra = {}) {
  return {
    id: row.discord_id,
    name: row.display_name || row.discord_name || row.discord_id,
    displayName: row.display_name || '',
    discordName: row.discord_name || '',
    level: effectiveLevel(row.discord_id, row.clearance),
    isEventTeam: !!flags.isEventTeam,
    isLeadStoryteller: !!flags.isLeadStoryteller,
    isOwner: isOwner(row.discord_id),
    teamId: row.team_id || '',
    teamName: row.team_name || '',
    rank: row.rank || '',
    source: 'site',
    ...extra,
  };
}

/**
 * Resolve the acting staffer for a session token, honouring an owner's
 * view-as cookie. Returns null when not authenticated. The returned actor is
 * the impersonated person; _impersonating/_realId/_realName record who really
 * acted, and lib/audit.js shows both in the audit log.
 */
export function resolveActor(token, viewAsId) {
  const session = validateSession(token);
  if (!session) return null;
  if (viewAsId && isOwner(session.discord_id)) {
    const target = queryOne("SELECT discord_id, display_name, discord_name, clearance, team_id, team_name, rank FROM staff WHERE discord_id = ? AND COALESCE(active, 1) = 1", [viewAsId]);
    if (target) {
      markImpersonation(target.discord_id, session.discord_id, session.display_name || session.discord_name);
      return buildActor(target, getRoleFlags(target.discord_id), {
        _impersonating: true,
        _realId: session.discord_id,
        _realName: session.display_name || session.discord_name,
      });
    }
  }
  clearImpersonation(session.discord_id);
  return buildActor(
    { discord_id: session.discord_id, display_name: session.display_name, discord_name: session.discord_name, clearance: session.staff_clearance ?? session.clearance, team_id: session.team_id, team_name: session.team_name, rank: session.rank },
    { isEventTeam: !!session.event_team, isLeadStoryteller: !!session.lead_storyteller || !!session.staff_lead_storyteller },
  );
}
