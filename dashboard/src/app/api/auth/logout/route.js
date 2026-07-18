import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { destroySession } from '../../../../lib/session.js';
export async function GET(request) {
  const cookieStore = await cookies();
  const token = cookieStore.get('meridian_session')?.value;
  if (token) destroySession(token);
  cookieStore.delete('meridian_session');
  const host = request.headers.get('host');
  const proto = host?.includes('localhost') ? 'http' : 'https';
  return NextResponse.redirect(new URL('/login', `${proto}://${host}`));
}
