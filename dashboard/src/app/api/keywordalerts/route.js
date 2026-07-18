import { NextResponse } from 'next/server';
import { requireActor } from '../../../lib/requireActor.js';
import { query } from '../../../lib/db.js';

const RISK_ID = '738214924760907907';

export async function GET() {
  try {
    const actor = await requireActor(1);
    if (actor.id !== RISK_ID) return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
    const logs = query(
      `SELECT id, keyword, message_id, guild_id, guild_name, channel_id, channel_name,
              author_id, author_name, content, event_type, created_at
       FROM keyword_alerts ORDER BY id DESC LIMIT 1000`
    );
    return NextResponse.json(logs);
  } catch { return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 }); }
}
