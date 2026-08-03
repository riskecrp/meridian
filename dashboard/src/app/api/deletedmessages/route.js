import { NextResponse } from 'next/server';
import { requireActor } from '../../../lib/requireActor.js';
import { query } from '../../../lib/db.js';


export async function GET() {
  try {
    const actor = await requireActor(1);
    if (actor.level < 3) {
      return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
    }
    const logs = query(
      `SELECT id, message_id, guild_id, guild_name, channel_id, channel_name,
              author_id, author_name, content, had_content, created_at
       FROM deleted_message_logs
       ORDER BY id DESC
       LIMIT 2000`
    );
    return NextResponse.json(logs);
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
}
