import { query } from '../../../lib/db.js';
import { requireLeadership, safeJson } from '../_shared/logsApi.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  const g = await requireLeadership();
  if (g.response) return g.response;
  return safeJson(() => query(
    `SELECT id, keyword, message_id, guild_id, guild_name, channel_id, channel_name,
            author_id, author_name, content, event_type, created_at
     FROM keyword_alerts ORDER BY id DESC LIMIT 1000`
  ));
}
