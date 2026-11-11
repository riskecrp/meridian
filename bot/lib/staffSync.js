// Staff roster sync from FM-guild roles (BOT-13 / F18).
//
// The base FM role (fm_team_guide) is what makes someone staff; the rank roles
// set their rank, and clearance follows the rank through clearanceForRank so the
// rule lives in one place. Role removals and demotions are honoured too: a
// removed rank role lowers the clearance, a removed base role or leaving the
// guild retires the row (active = 0). Rows are never deleted and re-adding
// someone UPDATES their existing row (policy 15).
import { queryOne, run } from './db.js';
import { getRole } from './pings.js';
import { logAudit } from './audit.js';
import { clearanceForRank } from '../../shared/clearance.js';
import { nowIso } from '../../shared/dates.js';

const BOT_ID = 'bot', BOT_NAME = 'Meridian';

export const mainFmRole = () => getRole('fm_team_guide');

export function fmRankRoles() {
  const map = {};
  const put = (key, rank) => { const id = getRole(key); if (id) map[id] = rank; };
  put('fm_team_lead',    'Team Lead');
  put('fm_leadership',   'Management');
  put('game_affairs',    'Management');
  put('founder',         'Management');
  put('executive_admin', 'Management');
  return map;
}

export function deriveFMRank(roleIds) {
  const ranks = fmRankRoles();
  let rank = 'Guide';
  for (const r of roleIds) {
    if (ranks[r] === 'Management') return 'Management';
    if (ranks[r] === 'Team Lead')  rank = 'Team Lead';
  }
  return rank;
}

/**
 * Apply a member's current FM roles to their staff row.
 * `member` is a discord.js GuildMember (or anything with .user and .roles.cache).
 * Returns { changed, action? } — 'added' | 'updated' | 'reactivated' | 'retired'.
 */
export function syncStaffFromRoles(member, { addedRoles = [], removedRoles = [] } = {}) {
  const allRoles    = [...member.roles.cache.keys()];
  const displayName = member.nickname || member.user.globalName || member.user.username;
  const baseRole    = mainFmRole();
  const hasBase     = !!baseRole && allRoles.includes(baseRole);
  const rankRoleIds = new Set(Object.keys(fmRankRoles()));
  const touchedRank = [...addedRoles, ...removedRoles].some(r => rankRoleIds.has(r));
  const touchedBase = !!baseRole && (addedRoles.includes(baseRole) || removedRoles.includes(baseRole));
  if (!touchedRank && !touchedBase) return { changed: false };

  const existing = queryOne("SELECT id, rank, clearance, active FROM staff WHERE discord_id = ?", [member.user.id]);

  // Base role gone: retire (only when it was just removed — someone who never
  // held it and gains a rank role is not staff).
  if (!hasBase) {
    if (existing && existing.active !== 0 && removedRoles.includes(baseRole)) {
      run("UPDATE staff SET active = 0, updated_at = ? WHERE discord_id = ?", [nowIso(), member.user.id]);
      logAudit(BOT_ID, BOT_NAME, 'EDIT', 'staff', member.user.id, displayName, 'Retired: FM role removed in Discord');
      console.log(`[STAFF_SYNC] Retired ${displayName} (base FM role removed)`);
      return { changed: true, action: 'retired' };
    }
    return { changed: false };
  }

  const rank      = deriveFMRank(allRoles);
  const clearance = clearanceForRank(rank);
  if (!existing) {
    run("INSERT INTO staff (discord_id, display_name, discord_name, rank, team_id, team_name, clearance, active) VALUES (?, ?, ?, ?, '', '', ?, 1)",
      [member.user.id, displayName, member.user.username, rank, clearance]);
    logAudit(BOT_ID, BOT_NAME, 'CREATE', 'staff', member.user.id, displayName, `Auto-added as ${rank} (L${clearance}) from Discord roles`);
    console.log(`[STAFF_SYNC] Auto-added ${displayName} as ${rank}`);
    return { changed: true, action: 'added' };
  }
  if (existing.rank === rank && existing.clearance === clearance && existing.active !== 0) return { changed: false };
  run("UPDATE staff SET rank = ?, clearance = ?, active = 1, discord_name = ?, updated_at = ? WHERE discord_id = ?",
    [rank, clearance, member.user.username, nowIso(), member.user.id]);
  const what = existing.active === 0 ? `Reactivated as ${rank} (L${clearance})` : `${existing.rank} (L${existing.clearance}) → ${rank} (L${clearance})`;
  logAudit(BOT_ID, BOT_NAME, 'EDIT', 'staff', member.user.id, displayName, `${what} from Discord roles`);
  console.log(`[STAFF_SYNC] ${displayName}: ${what}`);
  return { changed: true, action: existing.active === 0 ? 'reactivated' : 'updated' };
}

/** Someone left the FM guild: retire their row. Returns true when a row changed. */
export function retireStaffOnLeave(discordId, displayName = '') {
  const r = run("UPDATE staff SET active = 0, updated_at = ? WHERE discord_id = ? AND COALESCE(active, 1) = 1", [nowIso(), discordId]);
  if (r.changes) logAudit(BOT_ID, BOT_NAME, 'EDIT', 'staff', discordId, displayName, 'Retired: left the FM Discord');
  return r.changes > 0;
}
