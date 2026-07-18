import crypto from 'crypto';
import { queryOne, run } from './db.js';
const DAYS = 3;
export function createSession(staffId, discordId, discordName, clearance, eventTeam = 0, leadStoryteller = 0) {
  const token = crypto.randomBytes(32).toString('hex');
  const exp = new Date(Date.now() + DAYS * 86400000).toISOString();
  run("INSERT INTO sessions (staff_id, token, discord_id, discord_name, clearance, event_team, lead_storyteller, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [staffId, token, discordId, discordName, clearance, eventTeam, leadStoryteller, exp]);
  return { token, expiresAt: exp };
}
export function validateSession(token) {
  if (!token) return null;
  return queryOne("SELECT s.*, st.display_name, st.team_id, st.team_name, st.rank, st.lead_storyteller AS staff_lead_storyteller FROM sessions s JOIN staff st ON st.id = s.staff_id WHERE s.token = ? AND s.expires_at > datetime('now')", [token]) || null;
}
export function destroySession(token) { run('DELETE FROM sessions WHERE token = ?', [token]); }

// Recover a user's Event Team / Lead Storyteller status from their most recent
// login session. These flags are derived from Discord roles at login and stored
// on the session (not on the staff record), so this is the only persisted source.
// Used by impersonation so viewing-as a target reflects their real ET/LST view.
// Falls back to false/false if the target has never logged into the dashboard.
export function getRoleFlags(discordId) {
  const row = queryOne(
    "SELECT event_team, lead_storyteller FROM sessions WHERE discord_id = ? ORDER BY id DESC LIMIT 1",
    [discordId]
  );
  // staff.lead_storyteller is the authoritative, admin-managed flag (staff page);
  // the session flag is the Discord-role-derived fallback. Either grants LST.
  const staff = queryOne("SELECT lead_storyteller FROM staff WHERE discord_id = ?", [discordId]);
  return {
    isEventTeam: !!row?.event_team,
    isLeadStoryteller: !!row?.lead_storyteller || !!staff?.lead_storyteller,
  };
}
