import { NextResponse } from 'next/server';
import { requireActor } from '../../../lib/requireActor.js';

// One gate for the Server Logs routes (member events, deleted/edited messages,
// keyword alerts, keyword list). Leadership (L3) only, no Event Team boost:
// these are bot-captured records from every server the bot sits in.
//
// Returns { actor } or { response } so a route reads:
//   const g = await requireLeadership(); if (g.response) return g.response;
export async function requireLeadership() {
  try {
    const actor = await requireActor(3);
    return { actor };
  } catch (e) {
    if (e?.code === 'AUTH_INSUFFICIENT') return { response: NextResponse.json({ error: 'Leadership (L3) access required.' }, { status: 403 }) };
    return { response: NextResponse.json({ error: 'Unauthorized.' }, { status: 401 }) };
  }
}

/** Run `fn` (a read) and turn any throw into a 500 without leaking the SQL. */
export function safeJson(fn) {
  try { return NextResponse.json(fn()); }
  catch (e) { console.error('[api/logs]', e.message); return NextResponse.json({ error: 'Could not read the log.' }, { status: 500 }); }
}
