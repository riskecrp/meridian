import { query } from '../../../lib/db.js';
import { requireLeadership, safeJson } from '../memberlog/gate.js';

export const dynamic = 'force-dynamic';

// Deleted messages the bot saw. Both UIs render the author's display name and
// who deleted it (audit-log lookup by the bot), so those columns ship too.
export async function GET() {
  const g = await requireLeadership();
  if (g.response) return g.response;
  return safeJson(() => query(
    `SELECT id, message_id, guild_id, guild_name, channel_id, channel_name,
            author_id, author_name, author_display_name, deleter_id, deleter_name,
            content, had_content, created_at
     FROM deleted_message_logs
     ORDER BY id DESC
     LIMIT 2000`
  ));
}
