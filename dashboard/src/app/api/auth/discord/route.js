import { NextResponse } from 'next/server';
export async function GET(request) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const host = request.headers.get('host');
  const proto = host?.includes('localhost') ? 'http' : 'https';
  const redirect = `${proto}://${host}/api/auth/callback/discord`;
  return NextResponse.redirect(`https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirect)}&response_type=code&scope=identify`);
}
