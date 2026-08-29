import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { queryOne, run } from '../../../../../lib/db.js';
import { createSession } from '../../../../../lib/session.js';
import { logAudit } from '../../../../../lib/audit.js';
import { RISK_DISCORD_ID } from '../../../../../lib/constants.js';

export async function GET(request) {
  try {
    const code = request.nextUrl.searchParams.get('code');
    const host = request.headers.get('host');
    const proto = host?.includes('localhost') ? 'http' : 'https';
    const origin = `${proto}://${host}`;
    const redirectUri = `${origin}/api/auth/callback/discord`;
    if (!code) return NextResponse.redirect(new URL('/?error=no_code', origin));

    // Exchange code for token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID, client_secret: process.env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: redirectUri })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return NextResponse.redirect(new URL('/?error=oauth_failed', origin));

    // Get user
    const userRes = await fetch('https://discord.com/api/users/@me', { headers: { authorization: `Bearer ${tokenData.access_token}` } });
    const user = await userRes.json();

    // Check guild membership + roles
    const guildId = process.env.GUILD_ID || '1457188814916423855';
    const memberRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${user.id}`, { headers: { authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } });
    if (!memberRes.ok) return NextResponse.redirect(new URL('/?error=not_in_server', origin));
    const member = await memberRes.json();
    const roles = member.roles || [];

    // Determine clearance from roles
    const l3Roles = ['fm_leadership', 'game_affairs', 'founder', 'executive_admin']
      .map(k => queryOne("SELECT role_id FROM discord_roles WHERE key = ?", [k])?.role_id)
      .filter(Boolean);
    const roleL2 = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_team_lead'")?.role_id;
    const roleL1 = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_team_guide'")?.role_id;
    const roleEventTeam = queryOne("SELECT role_id FROM discord_roles WHERE key = 'event_team'")?.role_id;
    const roleLeadStoryteller = queryOne("SELECT role_id FROM discord_roles WHERE key = 'lead_storyteller'")?.role_id;
    const isEventTeam = !!(roleEventTeam && roles.includes(roleEventTeam));
    const isLeadStoryteller = !!(roleLeadStoryteller && roles.includes(roleLeadStoryteller));

    let clearance = 0;
    if (l3Roles.some(r => roles.includes(r))) clearance = 3;
    else if (roleL2 && roles.includes(roleL2)) clearance = 2;
    else if (roleL1 && roles.includes(roleL1)) clearance = 1;
    // Individual dashboard_access grants can elevate any user (including those with no FM roles)
    if (clearance === 0) {
      const override = queryOne("SELECT level FROM dashboard_access WHERE discord_id = ?", [user.id]);
      if (override) clearance = override.level;
    }
    // The owner always gets in: a fresh self-hosted copy has no matching roles
    // and no access grants yet, so RISK_DISCORD_ID in .env is the bootstrap.
    if (clearance === 0 && user.id === RISK_DISCORD_ID) clearance = 3;
    if (clearance === 0 && !isEventTeam && !isLeadStoryteller) return NextResponse.redirect(new URL('/?error=unauthorized', origin));

    // Upsert staff
    const displayName = member.nick || user.global_name || user.username;
    let staff = queryOne("SELECT id FROM staff WHERE discord_id = ?", [user.id]);
    if (!staff) {
      run("INSERT INTO staff (discord_id, discord_name, display_name, clearance) VALUES (?, ?, ?, ?)", [user.id, displayName, displayName, clearance]);
      staff = queryOne("SELECT id FROM staff WHERE discord_id = ?", [user.id]);
    } else {
      run("UPDATE staff SET discord_name = ?, clearance = ?, updated_at = datetime('now') WHERE discord_id = ?", [displayName, clearance, user.id]);
    }

    // Invalidate existing sessions for this user so clearance changes take immediate effect
    run("DELETE FROM sessions WHERE discord_id = ?", [user.id]);

    // Prune all globally expired sessions while we're here
    run("DELETE FROM sessions WHERE expires_at < datetime('now')");

    // Create session
    const session = createSession(staff.id, user.id, displayName, clearance, isEventTeam ? 1 : 0, isLeadStoryteller ? 1 : 0);
    const cookieStore = await cookies();
    cookieStore.set('meridian_session', session.token, { path: '/', maxAge: 3 * 86400, httpOnly: true, secure: proto === 'https', sameSite: 'lax' });

    // Audit log
    logAudit(user.id, displayName, 'LOGIN', 'session', null, displayName, 'Level ' + clearance + ' login');

    return NextResponse.redirect(new URL('/v2', origin));
  } catch (err) {
    console.error("Auth Error:", err);
    return NextResponse.redirect(new URL('/?error=server_error', request.url));
  }
}
