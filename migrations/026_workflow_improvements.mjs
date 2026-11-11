// 026_workflow_improvements.mjs
// Columns and routes for the workflow improvements that follow the repair:
//   - pending_executions.verified_at / verified_by / verify_nudged_at:
//     the requesting lead confirms an executed change landed in game
//   - form_submissions.source / faction_feedback.source: 'sheet' (Google Forms
//     polling) or 'web' (the dashboard's hosted forms); web rows carry a
//     negative sheet_row so the UNIQUE constraints keep holding
//   - three ping routes: the weekly leadership digest, review vote nudges and
//     job-health alerts, seeded on the leadership channel the task routes use
export default function migrate(db) {
  const has = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some(x => x.name === c);
  const add = (t, c, ddl) => { if (!has(t, c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${ddl}`); };
  add('pending_executions', 'verified_at', 'TEXT');
  add('pending_executions', 'verified_by', "TEXT NOT NULL DEFAULT ''");
  add('pending_executions', 'verify_nudged_at', 'TEXT');
  add('form_submissions', 'source', "TEXT NOT NULL DEFAULT 'sheet'");
  add('faction_feedback', 'source', "TEXT NOT NULL DEFAULT 'sheet'");
  add('form_submissions', 'submitter_ip_hash', "TEXT NOT NULL DEFAULT ''");
  add('faction_feedback', 'submitter_ip_hash', "TEXT NOT NULL DEFAULT ''");
  db.exec("CREATE INDEX IF NOT EXISTS idx_pe_status ON pending_executions(status, resolved_at)");

  const lead = db.prepare("SELECT alt_channel_id, channel_id FROM ping_routes WHERE key = 'task.assigned'").get();
  const ch = (lead?.alt_channel_id || lead?.channel_id || '');
  const ins = db.prepare(`INSERT OR IGNORE INTO ping_routes (key, group_key, label, description, source_hint, kind, channel_id, alt_channel_id, alt_label, mention_roles, dynamic_mentions, sort) VALUES (?, ?, ?, ?, ?, 'channel', ?, '', '', '[]', '', ?)`);
  ins.run('leadership.digest', 'leadership', 'Weekly leadership digest', 'Every Monday: everything waiting on leadership for more than seven days (approvals, executions, verifications, feedback, deletion requests, unanswered questions).', 'bot/scheduler.js', ch, 70);
  ins.run('review.vote_nudge', 'leadership', 'Review vote reminder', 'On the 12th: leaders who have not voted on this month\'s reviews are reminded before the tally on the 14th.', 'bot/scheduler.js', ch, 75);
  ins.run('rp.verify_nudge', 'rp', 'Verify-in-game reminder', 'An executed RP change the requesting lead has not confirmed in game after 48 hours.', 'bot/scheduler.js', ch, 80);
  ins.run('ops.health', 'records', 'Job health alert', 'A scheduled job missed its cadence or keeps failing (from sync_status).', 'bot/scheduler.js', ch, 90);
}
