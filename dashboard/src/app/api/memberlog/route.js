import { query } from '../../../lib/db.js';
import { requireLeadership, safeJson } from '../_shared/logsApi.js';

export const dynamic = 'force-dynamic';

// Join/leave events the bot records in every server it sits in (bot/index.js).
export async function GET() {
  const g = await requireLeadership();
  if (g.response) return g.response;
  return safeJson(() => query(
    `SELECT id, guild_id, guild_name, user_id, username, display_name, event, created_at
     FROM member_join_leave_logs
     ORDER BY id DESC
     LIMIT 2000`
  ));
}
