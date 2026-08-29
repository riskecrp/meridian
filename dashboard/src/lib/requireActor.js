import { cookies } from 'next/headers';
import { validateSession, getRoleFlags } from './session.js';
import { queryOne } from './db.js';
import { isOwner } from './constants.js';

// Returns the effective clearance for a discord_id, boosted by any
// individual dashboard_access grant on top of the base role-derived level.
function _effectiveLevel(discordId, baseLevel) {
  const override = queryOne("SELECT level FROM dashboard_access WHERE discord_id = ?", [discordId]);
  return override ? Math.max(baseLevel, override.level) : baseLevel;
}

export async function requireActor(minLevel = 1, { allowEventTeam = false, allowLeadStoryteller = false } = {}) {
  const cookieStore = await cookies();
  const token = cookieStore.get('meridian_session')?.value;
  const session = validateSession(token);

  if (!session) {
    const e = new Error('Not authenticated');
    e.code = 'AUTH_REQUIRED';
    throw e;
  }

  const viewAsId = cookieStore.get('meridian_viewas')?.value;
  if (viewAsId && isOwner(session.discord_id)) {
    const target = queryOne(
      "SELECT discord_id, display_name, discord_name, clearance, team_id, team_name, rank FROM staff WHERE discord_id = ?",
      [viewAsId]
    );
    if (target) {
      // Recover the target's ET/LST status so impersonation matches their real
      // access — same level boost / LST grant rules as a normal session below.
      const { isEventTeam, isLeadStoryteller } = getRoleFlags(target.discord_id);
      let level = _effectiveLevel(target.discord_id, target.clearance || 1);
      if (allowEventTeam && isEventTeam) level = Math.max(level, 3);
      const lstGranted = allowLeadStoryteller && isLeadStoryteller;
      if (level < minLevel && !lstGranted) {
        const e = new Error(`Insufficient clearance (need L${minLevel}, have L${level})`);
        e.code = 'AUTH_INSUFFICIENT';
        throw e;
      }
      return {
        id: target.discord_id,
        name: target.display_name || target.discord_name,
        displayName: target.display_name || '',
        discordName: target.discord_name || '',
        level,
        isEventTeam,
        isLeadStoryteller,
        teamId: target.team_id || '',
        teamName: target.team_name || '',
        rank: target.rank || '',
        _impersonating: true,
        _realId: session.discord_id,
      };
    }
  }

  const isEventTeam = !!session.event_team;
  // staff.lead_storyteller (admin-managed via staff page) is authoritative;
  // session.lead_storyteller is the Discord-role-derived fallback. Either grants it.
  const isLeadStoryteller = !!session.lead_storyteller || !!session.staff_lead_storyteller;
  let level = _effectiveLevel(session.discord_id, session.clearance);

  // Event Team members get effective L3 on pages that explicitly allow it
  if (allowEventTeam && isEventTeam) level = Math.max(level, 3);

  // Lead Storytellers get read access on pages that explicitly allow it,
  // WITHOUT inflating their clearance — so edit controls (gated on level>=3)
  // stay hidden and write actions (which don't pass this flag) still reject them.
  const lstGranted = allowLeadStoryteller && isLeadStoryteller;

  if (level < minLevel && !lstGranted) {
    const e = new Error(`Insufficient clearance (need L${minLevel}, have L${level})`);
    e.code = 'AUTH_INSUFFICIENT';
    throw e;
  }

  return {
    id: session.discord_id,
    name: session.display_name || session.discord_name,
    displayName: session.display_name || '',
    discordName: session.discord_name || '',
    level,
    isEventTeam,
    isLeadStoryteller,
    teamId: session.team_id || '',
    teamName: session.team_name || '',
    rank: session.rank || '',
  };
}

export async function getActor() {
  try { return await requireActor(0); } catch { return null; }
}

export async function requireEventTeam() {
  const cookieStore = await cookies();
  const token = cookieStore.get('meridian_session')?.value;
  const session = validateSession(token);
  if (!session) {
    const e = new Error('Not authenticated');
    e.code = 'AUTH_REQUIRED';
    throw e;
  }
  if (!session.event_team) {
    const e = new Error('Event Team access required');
    e.code = 'AUTH_INSUFFICIENT';
    throw e;
  }
  return {
    id: session.discord_id,
    name: session.display_name || session.discord_name,
    displayName: session.display_name || '',
    discordName: session.discord_name || '',
    level: session.clearance,
    isEventTeam: true,
    isLeadStoryteller: !!session.lead_storyteller,
    teamId: session.team_id || '',
    teamName: session.team_name || '',
    rank: session.rank || '',
  };
}

export async function requireLeadStoryteller() {
  const cookieStore = await cookies();
  const token = cookieStore.get('meridian_session')?.value;
  const session = validateSession(token);
  if (!session) {
    const e = new Error('Not authenticated');
    e.code = 'AUTH_REQUIRED';
    throw e;
  }
  if (!session.lead_storyteller) {
    const e = new Error('Lead Storyteller access required');
    e.code = 'AUTH_INSUFFICIENT';
    throw e;
  }
  return {
    id: session.discord_id,
    name: session.display_name || session.discord_name,
    displayName: session.display_name || '',
    discordName: session.discord_name || '',
    level: session.clearance,
    isEventTeam: !!session.event_team,
    isLeadStoryteller: true,
    teamId: session.team_id || '',
    teamName: session.team_name || '',
    rank: session.rank || '',
  };
}
