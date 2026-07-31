-- 008_form_decision_checklist.sql
-- The Recognized Criminal Faction application needs more than "done": it is
-- decided first, and an accepted faction then has to be set up before the item
-- can close.
--
--   [Open] --Reject--> [Rejected]
--          --Accept--> [Accepted] --all boxes ticked--> [Completed]
--
-- The other three forms are unaffected — they keep the single Complete button.
-- Which workflow a form uses is declared in bot/formSubmissions.js.

-- Who decided, when, and (for a rejection) why. The reason is kept because the
-- thread's discussion is not a summary: months later "why was this turned down"
-- should be answerable from the closing message, and whoever reaches out to the
-- applicant needs the wording to hand.
ALTER TABLE form_submissions ADD COLUMN decided_by_id       TEXT;
ALTER TABLE form_submissions ADD COLUMN decided_by_name     TEXT;
ALTER TABLE form_submissions ADD COLUMN decided_at          TEXT;
ALTER TABLE form_submissions ADD COLUMN decision_reason     TEXT;
-- The checklist lives in its own message, posted when the application is
-- accepted, so it can be rewritten in place as boxes are ticked.
ALTER TABLE form_submissions ADD COLUMN checklist_message_id TEXT;

-- One row per setup step per accepted application.
--
-- The steps are SNAPSHOTTED here at accept time rather than being read from the
-- code each time the message is drawn. Editing the list later must not silently
-- rewrite what an in-flight application is being held to, nor make a finished
-- one look incomplete against a list that did not exist when it was worked.
CREATE TABLE IF NOT EXISTS form_submission_checklist (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL,
  item_key      TEXT    NOT NULL,
  label         TEXT    NOT NULL,
  sort          INTEGER NOT NULL DEFAULT 0,
  done          INTEGER NOT NULL DEFAULT 0,
  done_by_id    TEXT,
  done_by_name  TEXT,
  done_at       TEXT,
  UNIQUE (submission_id, item_key)
);
CREATE INDEX IF NOT EXISTS idx_form_checklist_submission ON form_submission_checklist(submission_id);

-- Who may tick the boxes, and who is pinged when an application is accepted and
-- the setup work starts. Separate from form.rcf_application, which stays with FM
-- Leadership: Leadership decides, Game Affairs Management does the setup.
--
-- kind 'per_item' — the checklist is posted inside the application's own thread,
-- so there is no channel to configure.
INSERT OR IGNORE INTO ping_routes
  (key, group_key, label, description, source_hint, kind, channel_id, mention_roles, sort)
VALUES
  ('form.rcf_application.setup', 'forms', 'RCF application accepted — setup needed',
   'Posts the setup checklist in the application''s thread when it is accepted. These roles are pinged and are the ones who can tick the boxes.',
   'bot/formSubmissions.js', 'per_item', '', '["1457189093594239147"]', 12);
