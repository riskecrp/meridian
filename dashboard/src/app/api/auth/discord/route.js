import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';

// Start the Discord OAuth flow. The random `state` is stored in a short-lived
// cookie and checked by the callback so a login cannot be completed with a
// code minted for someone else's browser.
export async function GET(request) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) return NextResponse.redirect(new URL('/login?error=not_configured', request.url));
  const host = request.headers.get('host');
  const proto = host?.includes('localhost') ? 'http' : 'https';
  const redirect = `${proto}://${host}/api/auth/callback/discord`;
  const state = randomBytes(16).toString('hex');
  const res = NextResponse.redirect(`https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirect)}&response_type=code&scope=identify&state=${state}`);
  res.cookies.set('meridian_oauth_state', state, { path: '/', httpOnly: true, sameSite: 'lax', secure: proto === 'https', maxAge: 600 });
  return res;
}
