-- 007_form_submissions.sql
-- The four FM intake forms — CI application, staff application, Recognized
-- Criminal Faction application and garage request — worked as a thread per
-- submission, the same way faction feedback already is.
--
-- What this replaces: each form's Apps Script POSTs to api/notify, which posted
-- a bare "view the response sheet here" embed and auto-created a Leadership
-- task. The answers never reached Discord or this database, so every submission
-- began with someone opening a spreadsheet and scrolling to the bottom.
--
-- Why polling rather than that push: the push has no reconciliation. A dropped
-- request is simply lost, which is not hypothetical — the RCF sheet holds ten
-- rows and only eight ever reached Discord. Reading the sheet each cycle means a
-- missed submission is picked up on the next pass instead of vanishing.
--
-- Generalised from 003_faction_feedback.sql: same lifecycle, same idempotency,
-- one set of tables keyed by form_key instead of a copy per form.

-- One row per submission taken in, across all forms. `payload` is the whole
-- submission as JSON {question: answer} so a later edit to the form's questions
-- cannot rewrite what was already received.
--
-- (form_key, sheet_row) is UNIQUE and is what makes posting idempotent: the row
-- is claimed here BEFORE Discord is touched, so a retry after a half-finished
-- post resumes instead of opening a second thread. `ack_message_id` is written
-- last and checked first, so it doubles as the "posted in full" marker.
CREATE TABLE IF NOT EXISTS form_submissions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  form_key          TEXT    NOT NULL,
  sheet_row         INTEGER NOT NULL,
  -- Display identity, resolved from the sheet headers at post time: `title` is
  -- what the thread is named after, `contact` is who to reach for follow-up.
  title             TEXT    NOT NULL DEFAULT '',
  contact           TEXT    NOT NULL DEFAULT '',
  submitted_at      TEXT    NOT NULL DEFAULT '',
  payload           TEXT    NOT NULL DEFAULT '{}',
  thread_id         TEXT,
  ack_message_id    TEXT,
  -- new -> claimed (acknowledged) -> completed / cancelled
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
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (form_key, sheet_row)
);
CREATE INDEX IF NOT EXISTS idx_form_submissions_status ON form_submissions(form_key, status);

-- How far down each form's sheet the poller has read. `initialized` exists so the
-- first run can mark the sheet's current end as history: the rows already sitting
-- there predate this feature and must not arrive as a wall of threads, each with
-- its own ping and its own nudge cycle.
CREATE TABLE IF NOT EXISTS form_submission_state (
  form_key    TEXT    PRIMARY KEY,
  last_row    INTEGER NOT NULL DEFAULT 0,
  initialized INTEGER NOT NULL DEFAULT 0
);

-- Rows the poller could not post. Kept after a skip so a dropped submission is
-- visible rather than silently lost — if someone says they applied and no thread
-- exists, this is the table to look in.
CREATE TABLE IF NOT EXISTS form_submission_failures (
  form_key        TEXT    NOT NULL,
  sheet_row       INTEGER NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  skipped         INTEGER NOT NULL DEFAULT 0,
  first_failed_at TEXT,
  last_failed_at  TEXT,
  last_error      TEXT,
  PRIMARY KEY (form_key, sheet_row)
);

-- ── Ping routes ───────────────────────────────────────────────────────────────
--
-- The four intake routes already exist and already carry the right channel and
-- roles, so they are reused rather than replaced: retargeting a form in
-- Discord & Access keeps working exactly as before, and the registry does not
-- grow a second row per form that means almost the same thing. Only what the
-- route DOES has changed — it opens a thread now instead of posting a notice —
-- so the descriptions are rewritten to say so.
--
-- These same routes also decide who may press the buttons: the roles a form
-- pings are the roles that can action it. That keeps CI applications with Game
-- Affairs, who own them, without a second permission list to maintain.
UPDATE ping_routes SET
  description = 'Opens a thread for a new RCF application and pings for acknowledgement. These roles can also action it.',
  source_hint = 'bot/formSubmissions.js'
  WHERE key = 'form.rcf_application';
UPDATE ping_routes SET
  description = 'Opens a thread for a new staff application and pings for acknowledgement. These roles can also action it.',
  source_hint = 'bot/formSubmissions.js'
  WHERE key = 'form.staff_application';
UPDATE ping_routes SET
  description = 'Opens a thread for a new garage request and pings for acknowledgement. These roles can also action it.',
  source_hint = 'bot/formSubmissions.js'
  WHERE key = 'form.garage_request';
UPDATE ping_routes SET
  description = 'Opens a thread for a new CI application and pings for acknowledgement. These roles can also action it.',
  source_hint = 'bot/formSubmissions.js'
  WHERE key = 'form.ci_application';

-- One nudge route per form, kind 'per_item' — the chase is posted inside the
-- item's own thread, so there is no channel to configure. Separate rows so a
-- form that does not need chasing can be silenced on its own, without stopping
-- its intake and without silencing the other three.
INSERT OR IGNORE INTO ping_routes
  (key, group_key, label, description, source_hint, kind, channel_id, mention_roles, sort)
VALUES
  ('form.rcf_application.nudge', 'forms', 'RCF application still open',
   'Chases an application that has not been completed or cancelled yet. Posted in its own thread every 48 hours.',
   'bot/formSubmissions.js', 'per_item', '', '["1457670376745074730"]', 11),
  ('form.staff_application.nudge', 'forms', 'Staff application still open',
   'Chases an application that has not been completed or cancelled yet. Posted in its own thread every 48 hours.',
   'bot/formSubmissions.js', 'per_item', '', '["1457670376745074730"]', 21),
  ('form.garage_request.nudge', 'forms', 'Garage request still open',
   'Chases a request that has not been completed or cancelled yet. Posted in its own thread every 48 hours.',
   'bot/formSubmissions.js', 'per_item', '', '["1457670376745074730"]', 31),
  ('form.ci_application.nudge', 'forms', 'CI application still open',
   'Chases an application that has not been completed or cancelled yet. Posted in its own thread every 48 hours.',
   'bot/formSubmissions.js', 'per_item', '', '["1457189093594239147"]', 41);
