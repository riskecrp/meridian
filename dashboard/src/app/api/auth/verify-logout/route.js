import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { revokeVerifySession, VERIFY_COOKIE } from '../../../../lib/verifySession.js';

// Logout revokes the session server-side (the cookie alone would stay valid
// until it expired) and then clears the cookie.
export async function GET(request) {
  const cookieStore = await cookies();
  try { revokeVerifySession(cookieStore.get(VERIFY_COOKIE)?.value); } catch (e) { console.error('[Verify Auth] revoke:', e.message); }
  cookieStore.delete(VERIFY_COOKIE);
  const host  = request.headers.get('host');
  const proto = host?.includes('localhost') ? 'http' : 'https';
  return NextResponse.redirect(new URL('/verify/login', `${proto}://${host}`));
}
