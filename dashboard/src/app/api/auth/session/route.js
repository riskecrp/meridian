import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { resolveActor } from '../../../../lib/session.js';

// The client-side view of the current actor (lib/useAuth.js). Same resolver as
// requireActor, so what the UI shows and what the server allows always agree.
export async function GET() {
  const cookieStore = await cookies();
  const actor = resolveActor(cookieStore.get('meridian_session')?.value, cookieStore.get('meridian_viewas')?.value);
  if (!actor) return NextResponse.json({ authenticated: false }, { status: 401 });
  return NextResponse.json({
    authenticated: true,
    discordId: actor.id, discordName: actor.discordName, displayName: actor.displayName || actor.name,
    clearance: actor.level, teamId: actor.teamId, teamName: actor.teamName, rank: actor.rank,
    isEventTeam: actor.isEventTeam, isLeadStoryteller: actor.isLeadStoryteller, isOwner: actor.isOwner || !!actor._impersonating,
    _impersonating: !!actor._impersonating, _realId: actor._realId || null, _realName: actor._realName || null,
  });
}
