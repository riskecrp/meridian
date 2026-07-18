import { NextResponse } from 'next/server';
import { requireActor } from '../../../lib/requireActor.js';
import { query } from '../../../lib/db.js';

const RISK_ID = '738214924760907907';

export async function GET() {
  try {
    const actor = await requireActor(1);
    if (actor.id !== RISK_ID) return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
    const logs = query(
      `SELECT id, message_id, guild_id, guild_name, channel_id, channel_name,
              author_id, author_name, author_display_name, content_before, content_after, created_at
       FROM edited_message_logs ORDER BY id DESC LIMIT 2000`
    );
    return NextResponse.json(logs);
  } catch { return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 }); }
}
