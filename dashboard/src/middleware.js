import { NextResponse } from 'next/server';

// The legacy /fm shell is retired and its pages deleted: every /fm link,
// bookmark or old ping lands on its /v2 equivalent. The fm/**/actions.js
// server actions remain; the v2 pages are built on them.

const FM_TO_V2 = {
  '/fm': '/v2',
  '/fm/dashboard': '/v2',
  '/fm/teams': '/v2/teams',
  '/fm/scenes': '/v2/story?tab=scenelogs',
  '/fm/inventory': '/v2/admin?tab=inventory',
  '/fm/feedback': '/v2/feedback',
  '/fm/documents': '/v2/story?tab=docs',
  '/fm/handover': '/v2/admin?tab=handover',
  '/fm/communications': '/v2/comms?tab=announce',
  '/fm/communications/ic': '/v2/comms?tab=ic',
  '/fm/factions': '/v2/factions',
  '/fm/factions/promote': '/v2/leadership?tab=approvals',
  '/fm/leadership': '/v2/leadership',
  '/fm/leadership/contacts': '/v2/leadership?tab=contacts',
  '/fm/leadership/guides': '/v2/leadership?tab=performance',
  '/fm/leadership/notes': '/v2/notes',
  '/fm/leadership/performance': '/v2/leadership?tab=performance',
  '/fm/leadership/reviews': '/v2/leadership?tab=reviews',
  '/fm/operations': '/v2/admin',
  '/fm/operations/analytics': '/v2/admin?tab=analytics',
  '/fm/operations/audit': '/v2/admin?tab=audit',
  '/fm/operations/botconfig': '/v2/admin?tab=discord',
  '/fm/operations/conversations': '/v2/admin?tab=convos',
  '/fm/operations/discord': '/v2/admin?tab=discord',
  '/fm/operations/fleet': '/v2/admin?tab=fleet',
  '/fm/operations/fmhours': '/v2/admin?tab=hours',
  '/fm/operations/imports': '/v2/admin?tab=imports',
  '/fm/operations/links': '/v2/admin?tab=links',
  '/fm/operations/mdbaccess': '/v2/admin?tab=discord',
  '/fm/operations/memberlog': '/v2/admin?tab=memberlog',
  '/fm/operations/pings': '/v2/admin?tab=discord',
  '/fm/operations/properties': '/v2/admin?tab=properties',
  '/fm/operations/reminders': '/v2/admin?tab=reminders',
  '/fm/operations/staff': '/v2/admin?tab=staff',
  '/fm/operations/vehicles': '/v2/story?tab=vehicles',
  '/fm/storytelling': '/v2/story',
  '/fm/storytelling/changelog': '/v2/story?tab=changelog',
  '/fm/storytelling/kb': '/v2/story?tab=kb',
  '/fm/storytelling/library': '/v2/story?tab=scenes',
  '/fm/storytelling/loadouts': '/v2/story?tab=arsenal',
  '/fm/storytelling/network': '/v2/story?tab=npcs',
  '/fm/storytelling/spawner': '/v2/story?tab=spawner',
};

function v2Target(pathname) {
  const clean = pathname.replace(/\/+$/, '') || '/fm';
  if (FM_TO_V2[clean]) return FM_TO_V2[clean];
  let m;
  if ((m = clean.match(/^\/fm\/factions\/([^/]+)$/))) return `/v2/factions/${m[1]}`;
  if ((m = clean.match(/^\/fm\/tasks\/([^/]+)$/))) return `/v2/tasks/${m[1]}`;
  if ((m = clean.match(/^\/fm\/feedback\/([^/]+)$/))) return `/v2/feedback/${m[1]}`;
  return '/v2';
}

export function middleware(request) {
  const { pathname } = request.nextUrl;
  const fmSession     = request.cookies.get('meridian_session');
  const verifySession = request.cookies.get('meridian_verify_session');

  if (pathname.startsWith('/fm') || pathname.startsWith('/v2')) {
    if (!fmSession) return NextResponse.redirect(new URL('/login', request.url));
  }
  if (pathname.startsWith('/fm')) {
    const target = new URL(v2Target(pathname), request.url);
    // Keep any query the legacy link carried (?tab= on the hub pages, ?sop=, …) unless the target sets its own.
    request.nextUrl.searchParams.forEach((v, k) => { if (!target.searchParams.has(k)) target.searchParams.set(k, v); });
    return NextResponse.redirect(target, 308);
  }
  if (pathname === '/login') {
    if (fmSession) return NextResponse.redirect(new URL('/v2', request.url));
  }
  if (pathname === '/verify') {
    if (!verifySession) return NextResponse.redirect(new URL('/verify/login', request.url));
  }
  if (pathname === '/verify/login') {
    if (verifySession) return NextResponse.redirect(new URL('/verify', request.url));
  }
  return NextResponse.next();
}
export const config = { matcher: ['/fm/:path*', '/v2/:path*', '/login', '/verify', '/verify/login'] };
