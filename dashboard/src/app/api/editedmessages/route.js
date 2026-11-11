import { query } from '../../../lib/db.js';
import { requireLeadership, safeJson } from '../memberlog/gate.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  const g = await requireLeadership();
  if (g.response) return g.response;
  return safeJson(() => query(
    `SELECT id, message_id, guild_id, guild_name, channel_id, channel_name,
            author_id, author_name, author_display_name, content_before, content_after, created_at
     FROM edited_message_logs ORDER BY id DESC LIMIT 2000`
  ));
}
