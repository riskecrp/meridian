import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { validateSession } from '../../../../lib/session.js';
import { createVerifySession } from '../../../../lib/verifySession.js';

const RISK_ID = '738214924760907907';

export async function GET(request) {
  const host  = request.headers.get('host');
  const proto = host?.includes('localhost') ? 'http' : 'https';
  const origin = `${proto}://${host}`;

  const cookieStore = await cookies();
  const token   = cookieStore.get('meridian_session')?.value;
  const session = validateSession(token);

  if (!session || session.discord_id !== RISK_ID) {
    return NextResponse.redirect(new URL('/fm/dashboard', origin));
  }

  const verifyToken = createVerifySession(session.discord_id, session.discord_name || 'Risk');
  cookieStore.set('meridian_verify_session', verifyToken, {
    path: '/', maxAge: 3 * 86400, httpOnly: true,
    secure: proto === 'https', sameSite: 'lax',
  });

  return NextResponse.redirect(new URL('/verify', origin));
}
