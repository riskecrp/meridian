import { NextResponse } from 'next/server';
import { requireActor } from '../../../lib/requireActor.js';
import { query } from '../../../lib/db.js';

const RISK_ID = '738214924760907907';

export async function GET() {
  try {
    const actor = await requireActor(1);
    if (actor.id !== RISK_ID) {
      return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
    }
    const logs = query(
      `SELECT id, guild_id, guild_name, user_id, username, display_name, event, created_at
       FROM member_join_leave_logs
       ORDER BY id DESC
       LIMIT 2000`
    );
    return NextResponse.json(logs);
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
}
