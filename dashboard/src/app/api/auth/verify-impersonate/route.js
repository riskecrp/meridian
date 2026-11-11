import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { validateSession } from '../../../../lib/session.js';
import { createVerifySession, VERIFY_COOKIE } from '../../../../lib/verifySession.js';
import { isOwner } from '../../../../lib/constants.js';

// An owner may open the verify portal as themselves without the Discord
// round-trip. The session is a real, revocable verify session like any other.
export async function GET(request) {
  const host  = request.headers.get('host');
  const proto = host?.includes('localhost') ? 'http' : 'https';
  const origin = `${proto}://${host}`;

  const cookieStore = await cookies();
  const token   = cookieStore.get('meridian_session')?.value;
  const session = validateSession(token);

  if (!session || !isOwner(session.discord_id)) {
    return NextResponse.redirect(new URL('/v2', origin));
  }

  let verifyToken;
  try {
    verifyToken = createVerifySession(session.discord_id, session.display_name || session.discord_name || 'Owner');
  } catch (e) {
    console.error('[Verify Auth]', e.message);
    return NextResponse.redirect(new URL('/verify/login?error=not_configured', origin));
  }
  cookieStore.set(VERIFY_COOKIE, verifyToken, {
    path: '/', maxAge: 3 * 86400, httpOnly: true,
    secure: proto === 'https', sameSite: 'lax',
  });

  return NextResponse.redirect(new URL('/verify', origin));
}
