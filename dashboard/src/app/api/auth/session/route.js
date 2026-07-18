import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { validateSession, getRoleFlags } from '../../../../lib/session.js';
import { queryOne } from '../../../../lib/db.js';
import { RISK_DISCORD_ID } from '../../../../lib/constants.js';

function _effectiveLevel(discordId, baseLevel) {
  const override = queryOne("SELECT level FROM dashboard_access WHERE discord_id = ?", [discordId]);
  return override ? Math.max(baseLevel, override.level) : baseLevel;
}

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get('meridian_session')?.value;
  const s = validateSession(token);
  if (!s) return NextResponse.json({ authenticated: false }, { status: 401 });

  const viewAsId = cookieStore.get('meridian_viewas')?.value;
  if (viewAsId && s.discord_id === RISK_DISCORD_ID) {
    const t = queryOne(
      "SELECT discord_id, display_name, discord_name, clearance, team_id, team_name, rank FROM staff WHERE discord_id = ?",
      [viewAsId]
    );
    if (t) {
      // Reflect the target's real Event Team / Lead Storyteller view while impersonating.
      const { isEventTeam, isLeadStoryteller } = getRoleFlags(t.discord_id);
      return NextResponse.json({
        authenticated: true,
        discordId: t.discord_id, discordName: t.discord_name,
        clearance: _effectiveLevel(t.discord_id, t.clearance || 0), displayName: t.display_name,
        teamId: t.team_id || '', teamName: t.team_name || '', rank: t.rank || '',
        isEventTeam, isLeadStoryteller,
        _impersonating: true, _realId: RISK_DISCORD_ID,
      });
    }
  }

  const effectiveClearance = _effectiveLevel(s.discord_id, s.clearance);

  return NextResponse.json({
    authenticated: true,
    discordId: s.discord_id, discordName: s.discord_name,
    clearance: effectiveClearance, displayName: s.display_name,
    teamId: s.team_id || '', teamName: s.team_name || '', rank: s.rank || '',
    isEventTeam: !!s.event_team,
    isLeadStoryteller: !!s.lead_storyteller || !!s.staff_lead_storyteller,
  });
}
