import { NextResponse } from 'next/server';
import { UI_COOKIE, translatePath } from '../../../lib/uiRoutes.js';

// POST { ui: 'v2' | 'v3', from?: '/v3/...' } — remember the shell this person
// wants and answer with the equivalent page in it. One year, not httpOnly so the
// shells can read it to label the switch.
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const ui = body.ui === 'v2' ? 'v2' : 'v3';
  const to = body.from ? translatePath(String(body.from), ui) : `/${ui}`;
  const res = NextResponse.json({ ok: true, ui, to });
  res.cookies.set(UI_COOKIE, ui, { path: '/', sameSite: 'lax', maxAge: 365 * 86400 });
  return res;
}
