import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { validateSession } from '../../../../lib/session.js';
import { query, queryOne } from '../../../../lib/db.js';
import { isOwner } from '../../../../lib/constants.js';

function isRisk(cookieStore) {
  const token = cookieStore.get('meridian_session')?.value;
  const s = validateSession(token);
  return isOwner(s?.discord_id) ? s : null;
}

// GET — return staff list for dropdown
export async function GET() {
  const cookieStore = await cookies();
  if (!isRisk(cookieStore)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const staff = query(
    "SELECT discord_id, display_name, discord_name, clearance, team_name FROM staff WHERE discord_id != '' AND discord_id NOT LIKE 'placeholder%' ORDER BY display_name"
  );
  return NextResponse.json(staff);
}

// POST — start impersonating a user
export async function POST(req) {
  const cookieStore = await cookies();
  if (!isRisk(cookieStore)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { discordId } = await req.json();
  if (!discordId) return NextResponse.json({ error: 'Missing discordId' }, { status: 400 });
  const target = queryOne("SELECT discord_id FROM staff WHERE discord_id = ?", [discordId]);
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set('meridian_viewas', discordId, { path: '/', httpOnly: true, sameSite: 'lax' });
  return res;
}

// DELETE — exit impersonation
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set('meridian_viewas', '', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 0 });
  return res;
}
