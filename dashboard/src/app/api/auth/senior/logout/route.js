import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET(request) {
  const cookieStore = await cookies();
  cookieStore.delete('meridian_senior_session');
  const host   = request.headers.get('host');
  const proto  = host?.includes('localhost') ? 'http' : 'https';
  return NextResponse.redirect(new URL('/senior/login', `${proto}://${host}`));
}
