-- 006_sync_status.sql
-- Health of the bot's background jobs, somewhere a person can see it.
--
-- Until now a failing job printed to journald and nothing else. forumSync and
-- conversationSync both swallow their errors in an outer catch, so if the forum
-- feed stopped updating, the first sign was somebody noticing the numbers looked
-- stale — days later, with no idea when it broke.
--
-- One row per job, upserted on every run. `expected_every_minutes` is what makes
-- this useful rather than decorative: a job that has not succeeded in several
-- times its own interval is broken whether or not it ever reported an error, and
-- a silent stall is the failure mode journald cannot show you.
CREATE TABLE IF NOT EXISTS sync_status (
  job                   TEXT PRIMARY KEY,
  label                 TEXT    NOT NULL DEFAULT '',
  expected_every_minutes INTEGER NOT NULL DEFAULT 0,   -- 0 = no cadence to judge against
  last_run_at           TEXT,
  last_ok_at            TEXT,
  last_detail           TEXT    NOT NULL DEFAULT '',   -- what the last good run did
  last_error            TEXT    NOT NULL DEFAULT '',
  last_error_at         TEXT,
  consecutive_failures  INTEGER NOT NULL DEFAULT 0,
  runs                  INTEGER NOT NULL DEFAULT 0,
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Seeded rather than created on first run, so a job that has never once
-- succeeded still appears — "never ran" is exactly the state worth seeing, and a
-- table that only lists jobs that already worked would hide it.
INSERT OR IGNORE INTO sync_status (job, label, expected_every_minutes) VALUES
  ('forum_sync',          'Forum post sync',          60),
  ('conversation_sync',   'Conversation sync',        60),
  ('recurring_reminders', 'Recurring reminders',       1),
  ('feedback_poll',       'Faction feedback intake',  15),
  ('feedback_nudge',      'Faction feedback nudges',  30);
