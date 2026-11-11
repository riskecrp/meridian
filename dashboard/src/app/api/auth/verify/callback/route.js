import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createVerifySession, VERIFY_COOKIE } from '../../../../../lib/verifySession.js';
let warnedNoRole = false;

// Who may use the /verify portal: members of the verification guild who hold
// the verification role. Both come from the environment; only the guild has a
// built-in default (the management server the portal was written for) and
// using it is logged so an unconfigured deployment is visible.
const DEFAULT_VERIFY_GUILD = '1371212587705958562';

function verifyGuildId() {
  const g = (process.env.VERIFY_GUILD_ID || '').trim();
  if (g) return g;
  console.warn('[Verify Auth] VERIFY_GUILD_ID is not set; falling back to the built-in management guild id.');
  return DEFAULT_VERIFY_GUILD;
}

export async function GET(request) {
  const host  = request.headers.get('host');
  const proto = host?.includes('localhost') ? 'http' : 'https';
  const origin = `${proto}://${host}`;
  const back = (error) => NextResponse.redirect(new URL(`/verify/login?error=${error}`, origin));
  try {
    const code = request.nextUrl.searchParams.get('code');
    if (!code) return back('no_code');

    // VERIFY_ROLE_ID narrows the portal to one role; unset, any member of the
    // verify guild may sign in (the original behaviour), with a warning in the log.
    const roleId = (process.env.VERIFY_ROLE_ID || '').trim();
    if (!roleId && !warnedNoRole) { warnedNoRole = true; console.warn('[Verify Auth] VERIFY_ROLE_ID is not set; any member of the verify guild may sign in.'); }
    const guildId = verifyGuildId();

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
    if (!tokenData.access_token) return back('oauth_failed');
    const auth = { authorization: `Bearer ${tokenData.access_token}` };

    const userRes = await fetch('https://discord.com/api/users/@me', { headers: auth });
    const user = await userRes.json();
    if (!user?.id) return back('oauth_failed');

    // Membership AND role, in one call (scope guilds.members.read). A non-member gets 404 here.
    const memberRes = await fetch(`https://discord.com/api/users/@me/guilds/${guildId}/member`, { headers: auth });
    if (!memberRes.ok) return back('unauthorized');
    const member = await memberRes.json();
    const roles = Array.isArray(member?.roles) ? member.roles.map(String) : [];
    if (roleId && !roles.includes(roleId)) return back('no_role');

    const displayName = member.nick || user.global_name || user.username;
    const token = createVerifySession(user.id, displayName);
    const cookieStore = await cookies();
    cookieStore.set(VERIFY_COOKIE, token, {
      path: '/', maxAge: 3 * 86400, httpOnly: true, secure: proto === 'https', sameSite: 'lax',
    });
    return NextResponse.redirect(new URL('/verify', origin));
  } catch (err) {
    console.error('[Verify Auth]', err);
    return back('server_error');
  }
}
