import { NextResponse } from 'next/server';
export function middleware(request) {
  const { pathname } = request.nextUrl;
  const fmSession     = request.cookies.get('meridian_session');
  const verifySession = request.cookies.get('meridian_verify_session');

  if (pathname.startsWith('/fm')) {
    if (!fmSession) return NextResponse.redirect(new URL('/login', request.url));
  }
  if (pathname === '/login') {
    if (fmSession) return NextResponse.redirect(new URL('/fm/dashboard', request.url));
  }
  if (pathname === '/verify') {
    if (!verifySession) return NextResponse.redirect(new URL('/verify/login', request.url));
  }
  if (pathname === '/verify/login') {
    if (verifySession) return NextResponse.redirect(new URL('/verify', request.url));
  }
  return NextResponse.next();
}
export const config = { matcher: ['/fm/:path*', '/login', '/verify', '/verify/login'] };
