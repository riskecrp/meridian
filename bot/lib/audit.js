import { run } from './db.js';

/**
 * Bot-side twin of dashboard/src/lib/audit.js — same table, same argument order,
 * so a call reads identically in either half. The only difference is source,
 * which is stamped 'bot' here and left to default to 'site' there.
 *
 * What belongs in here: an action a person took. A task created with /todo, a
 * scene logged, feedback acknowledged from a thread. Those are the same kind of
 * event as the dashboard's own writes and belong in the same feed.
 *
 * What does NOT belong in here: the bot's own bookkeeping. Message edits and
 * deletions being mirrored, conversation sync, forum post counts, reminder
 * status ticks — thousands of rows a day that would bury everything a human
 * did. Background jobs report their health through sync_status instead.
 *
 * Never throws. An audit row failing to write must not take down the action it
 * was describing, exactly as on the dashboard side.
 */
export function logAudit(actorId, actorName, action, targetType, targetId, targetLabel, details) {
  try {
    run(
      "INSERT INTO site_audit_log (actor_id, actor_name, action, target_type, target_id, target_label, details, source) VALUES (?, ?, ?, ?, ?, ?, ?, 'bot')",
      [actorId || '', actorName || '', action, targetType || '',
       targetId != null ? String(targetId) : '', targetLabel || '', details || ''],
    );
  } catch (e) { console.error('[AUDIT]', e.message); }
}

/** The display name to record for whoever triggered an interaction. */
export function actorOf(interaction) {
  return interaction?.member?.displayName
    || interaction?.user?.globalName
    || interaction?.user?.username
    || 'Unknown';
}
