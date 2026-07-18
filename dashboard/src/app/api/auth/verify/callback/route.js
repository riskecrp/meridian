import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createVerifySession } from '../../../../../lib/verifySession.js';

const VERIFY_GUILD = '1371212587705958562';

export async function GET(request) {
  const host  = request.headers.get('host');
  const proto = host?.includes('localhost') ? 'http' : 'https';
  const origin = `${proto}://${host}`;
  try {
    const code = request.nextUrl.searchParams.get('code');
    if (!code) return NextResponse.redirect(new URL('/verify/login?error=no_code', origin));

    const redirectUri = `${origin}/api/auth/verify/callback`;
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  redirectUri,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return NextResponse.redirect(new URL('/verify/login?error=oauth_failed', origin));

    const [userRes, guildsRes] = await Promise.all([
      fetch('https://discord.com/api/users/@me',        { headers: { authorization: `Bearer ${tokenData.access_token}` } }),
      fetch('https://discord.com/api/users/@me/guilds', { headers: { authorization: `Bearer ${tokenData.access_token}` } }),
    ]);
    const user   = await userRes.json();
    const guilds = await guildsRes.json();

    if (!Array.isArray(guilds) || !guilds.some(g => g.id === VERIFY_GUILD)) {
      return NextResponse.redirect(new URL('/verify/login?error=unauthorized', origin));
    }

    const displayName = user.global_name || user.username;
    const token = createVerifySession(user.id, displayName);
    const cookieStore = await cookies();
    cookieStore.set('meridian_verify_session', token, {
      path: '/', maxAge: 3 * 86400, httpOnly: true, secure: proto === 'https', sameSite: 'lax',
    });
    return NextResponse.redirect(new URL('/verify', origin));
  } catch (err) {
    console.error('[Verify Auth]', err);
    return NextResponse.redirect(new URL('/verify/login?error=server_error', origin));
  }
}
