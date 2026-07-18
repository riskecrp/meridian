import { NextResponse } from "next/server";
import { query } from "../../../lib/db.js";
import { RISK_DISCORD_ID } from "../../../lib/constants.js";

// Read-only agenda for the owner (risk) + FM Leadership role.
// Guarded by AGENDA_SECRET (via "x-agenda-secret" header or "?token=").
export const dynamic = "force-dynamic";

function authorized(req) {
  const expected = process.env.AGENDA_SECRET;
  if (!expected) return false; // fail closed if unset
  const fromHeader = req.headers.get("x-agenda-secret");
  const fromQuery = new URL(req.url).searchParams.get("token");
  return (fromHeader || fromQuery) === expected;
}

export async function GET(req) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const discordId = RISK_DISCORD_ID;

  // Tasks assigned to you personally (claimed by you, or targeted at you as a User).
  const myTasks = query(
    `SELECT task_uid, description, target_id, target_type, next_reminder, created_at
       FROM tasks
      WHERE claimed_by = ?
         OR (target_type = 'User' AND target_id = ?)
      ORDER BY (next_reminder IS NULL), next_reminder ASC, created_at DESC`,
    [discordId, discordId]
  );

  // Tasks assigned to the FM Leadership role.
  const leadershipTasks = query(
    `SELECT task_uid, description, claimed_by, next_reminder, created_at
       FROM tasks
      WHERE target_type = 'Role'
        AND target_id = (SELECT role_id FROM discord_roles WHERE key = 'fm_leadership')
      ORDER BY (next_reminder IS NULL), next_reminder ASC, created_at DESC`
  );

  // Your active reminders, soonest first.
  const reminders = query(
    `SELECT uuid, message, epoch_ms, readable_time, repeat_rule, target_tag, status
       FROM reminders
      WHERE author_id = ? AND status = 'ACTIVE'
      ORDER BY CAST(epoch_ms AS INTEGER) ASC`,
    [discordId]
  );

  return NextResponse.json({
    discordId,
    generatedAt: new Date().toISOString(),
    counts: {
      myTasks: myTasks.length,
      leadershipTasks: leadershipTasks.length,
      reminders: reminders.length,
    },
    myTasks,
    leadershipTasks,
    reminders,
  });
}
