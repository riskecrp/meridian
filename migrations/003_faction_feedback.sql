-- 003_faction_feedback.sql
-- Player feedback about FM factions, taken from the ECRP roleplay feedback form
-- and worked as a thread per submission in #fm-feedback.
--
-- The form is shared with LFM: one response sheet, one column naming the
-- division, and a row belongs to us when that column reads
-- "Criminal Faction Management (FM)". The bot polls the sheet rather than being
-- pushed to, because the push (api/notify, formType 'faction_feedback') only
-- carries the faction name — the answers themselves are only in the sheet, and
-- they are the whole point.
--
-- Not to be confused with the /feedback command, which logs a staff member's
-- notes on a scene into scene_logs. This is a player writing in about a faction.

-- One row per submission we have taken in. `payload` is the whole submission as
-- JSON {question: answer} so the dashboard can show it without going back to the
-- sheet, and so a later change to the form's questions cannot rewrite history.
--
-- `sheet_row` is UNIQUE and is what makes posting idempotent: the row is claimed
-- here BEFORE Discord is touched, so a retry after a half-finished post finds
-- this record and resumes instead of opening a second thread.
-- `ack_message_id` is written last and checked first, so it doubles as the
-- "this one posted in full" marker.
CREATE TABLE IF NOT EXISTS faction_feedback (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  sheet_row         INTEGER NOT NULL UNIQUE,
  faction           TEXT    NOT NULL DEFAULT '',
  character_name    TEXT    NOT NULL DEFAULT '',
  discord_username  TEXT    NOT NULL DEFAULT '',
  occurred          TEXT    NOT NULL DEFAULT '',
  submitted_at      TEXT    NOT NULL DEFAULT '',
  payload           TEXT    NOT NULL DEFAULT '{}',
  thread_id         TEXT,
  ack_message_id    TEXT,
  -- new -> claimed (the submitter has been contacted) -> completed / cancelled
  status            TEXT    NOT NULL DEFAULT 'new',
  claimed_by_id     TEXT,
  claimed_by_name   TEXT,
  claimed_at        TEXT,
  -- When the next nudge is due. Rolled forward on every nudge so an item that
  -- stays open keeps being chased instead of going quiet after one message.
  due_at            TEXT,
  last_reminder_at  TEXT,
  concluded_by_name TEXT,
  concluded_at      TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_faction_feedback_status ON faction_feedback(status);

-- How far down the sheet the poller has read. `initialized` exists so the first
-- run can mark the sheet's current end as history: the rows already sitting
-- there predate this feature and must not arrive as a wall of threads.
CREATE TABLE IF NOT EXISTS faction_feedback_state (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  last_row    INTEGER NOT NULL DEFAULT 0,
  initialized INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO faction_feedback_state (id, last_row, initialized) VALUES (1, 0, 0);

-- Rows the poller could not post. Kept after a skip so a dropped submission is
-- visible rather than silently lost — if someone says they submitted feedback
-- and no thread exists, this is the table to look in.
CREATE TABLE IF NOT EXISTS faction_feedback_failures (
  sheet_row       INTEGER PRIMARY KEY,
  attempts        INTEGER NOT NULL DEFAULT 0,
  skipped         INTEGER NOT NULL DEFAULT 0,
  first_failed_at TEXT,
  last_failed_at  TEXT,
  last_error      TEXT
);

-- Where the threads are opened and who is pinged. In the registry rather than
-- in the bot so the channel and the roles can be retargeted from
-- Discord & Access without a redeploy.
--
-- feedback.new    — kind 'channel': the thread is created in channel_id, and the
--                   opening message mentions these roles.
-- feedback.nudge  — kind 'per_item': a nudge is posted inside the item's own
--                   thread, so there is no channel to configure. Switching it
--                   off stops the chasing without stopping intake.
INSERT OR IGNORE INTO ping_routes
  (key, group_key, label, description, source_hint, kind, channel_id, mention_roles, sort)
VALUES
  ('feedback.new', 'forms', 'Faction feedback received',
   'Opens a thread for a new submission and pings for acknowledgement.',
   'bot/factionFeedback.js', 'channel', '1532107776724172810',
   '["1457670376745074730","1457215385139941456","1457189093594239147"]', 70),
  ('feedback.nudge', 'forms', 'Faction feedback still open',
   'Chases an item that has not been completed or cancelled yet. Posted in the item''s own thread every 48 hours.',
   'bot/factionFeedback.js', 'per_item', '',
   '["1457670376745074730","1457215385139941456","1457189093594239147"]', 80);

-- The thread supersedes the old notice for FM: before this, a submission posted
-- a bare "view the response sheet" embed to #form-submissions and auto-created a
-- Leadership task. Both came off this one route — pingMentions() returns nothing
-- for a disabled route, which is what api/notify tests before raising the task —
-- so switching it off retires the pair. Re-enable it in Discord & Access to get
-- the old behaviour back.
UPDATE ping_routes SET enabled = 0 WHERE key = 'form.faction_feedback.fm';
