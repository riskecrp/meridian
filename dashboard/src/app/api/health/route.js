import { NextResponse } from 'next/server';
import { requireActor } from '../../../lib/requireActor.js';
import { healthReport } from '../../../../../bot/lib/health.js';

// Job health for monitors and people: the bot's sync_status rows classified by
// the same code the bot's own alert uses (bot/lib/health.js; it depends on
// shared/db.js only). 200 when every job is ok, 503 when any is late or
// failing, so an uptime check needs nothing but the status code. The job
// details are leadership material (error text, cadence), so they are included
// only for an authenticated L3; everyone else gets { ok } and the status code.
export const dynamic = 'force-dynamic';

export async function GET() {
  const report = healthReport();
  const status = report.ok ? 200 : 503;
  let actor = null;
  try { actor = await requireActor(3); } catch { actor = null; }
  const body = actor ? { ok: report.ok, checkedAt: report.checkedAt, jobs: report.jobs } : { ok: report.ok };
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
