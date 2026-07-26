-- 001_ping_routes.sql
-- Central registry for every Discord notification ("ping") Meridian emits.
--
-- Before this, destinations lived in three places: 4 rows in discord_config, a
-- dozen hardcoded channel constants across dashboard + bot source, and inline
-- role snowflakes. This table becomes the single source of truth so pings are
-- editable from the dashboard instead of by redeploying.
--
-- Seed values are EXACTLY what the code hardcoded at time of writing, so
-- applying this migration changes no behaviour.
--
-- channel_id     = primary destination
-- alt_channel_id = the confidentiality branch destination (leadership-scoped
--                  variants of task/event pings). '' when the ping has no branch.
-- mention_roles  = JSON array of role snowflakes statically @-mentioned.
--                  Dynamic mentions (the task target, the faction lead, the
--                  request author) are supplied by the caller and are NOT here.
-- kind           = channel   → posts to channel_id
--                  dm        → direct message, no channel to configure
--                  per_item  → destination stored per record (reminders), only
--                              the enabled toggle applies
--                  source    → a channel the bot READS rather than posts to

CREATE TABLE IF NOT EXISTS ping_routes (
  key              TEXT PRIMARY KEY,
  group_key        TEXT NOT NULL,
  label            TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  source_hint      TEXT NOT NULL DEFAULT '',
  kind             TEXT NOT NULL DEFAULT 'channel',
  channel_id       TEXT NOT NULL DEFAULT '',
  alt_channel_id   TEXT NOT NULL DEFAULT '',
  alt_label        TEXT NOT NULL DEFAULT '',
  mention_roles    TEXT NOT NULL DEFAULT '[]',
  dynamic_mentions TEXT NOT NULL DEFAULT '',
  enabled          INTEGER NOT NULL DEFAULT 1,
  sort             INTEGER NOT NULL DEFAULT 0,
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by       TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_ping_routes_group ON ping_routes(group_key, sort);

-- Channels the bot harvests conversation history from. Was a hardcoded array in
-- bot/conversationSync.js; team channels are volatile (renamed/added/removed with
-- staffing) so they belong in the DB.
CREATE TABLE IF NOT EXISTS conversation_sync_channels (
  channel_id TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  enabled    INTEGER NOT NULL DEFAULT 1,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- LFM is pinged by the faction-feedback form but was never in discord_roles.
INSERT OR IGNORE INTO discord_roles (key, role_id, description)
VALUES ('lfm', '1457208224435666977', 'Legal Faction Management (form pings)');

-- ── Seed: Tasks ──────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO ping_routes
  (key, group_key, label, description, source_hint, kind, channel_id, alt_channel_id, alt_label, mention_roles, dynamic_mentions, sort)
VALUES
 ('task.assigned','tasks','Task assigned','Posted when a task is created or assigned to someone.','teams/dashboard/operations actions, /todo, DM bot','channel','1457201300583485491','1494694133862760578','Task targets FM Leadership or Game Affairs','[]','The task target (role or user)',10),
 ('task.claimed.broadcast','tasks','Task claimed (broadcast)','Announces that someone picked up an open task.','teams/actions.js','channel','1457201300583485491','','','[]','',20),
 ('task.claimed.creator','tasks','Creator notified — task claimed','Tells the person who created the task that it was claimed.','teams + dashboard actions','channel','1457201300583485491','1494694133862760578','Creator is Leadership and the task is leadership-scoped','[]','The task creator',30),
 ('task.unclaimed.creator','tasks','Creator notified — task released','Tells the creator their task was unclaimed and is open again.','teams + dashboard actions','channel','1457201300583485491','1494694133862760578','Creator is Leadership and the task is leadership-scoped','[]','The task creator',40),
 ('task.completed.creator','tasks','Creator notified — task completed','Tells the creator their task was finished.','teams + dashboard + operations actions, /todo','channel','1457201300583485491','1494694133862760578','Creator is Leadership and the task is leadership-scoped','[]','The task creator',50),
 ('task.reassigned','tasks','Task reassigned','Announces a task moving to a new target.','teams + dashboard actions','channel','1457201300583485491','1494694133862760578','New target is FM Leadership or Game Affairs','[]','The new task target',60),
 ('task.reassigned.creator','tasks','Creator notified — task reassigned','Tells the creator their task was handed to someone else.','teams + dashboard actions','channel','1457201300583485491','1494694133862760578','Creator is Leadership and the task is leadership-scoped','[]','The task creator',70),
 ('task.question.asked','tasks','Question asked on a task','Someone requested more information from the task creator.','teams + dashboard actions','channel','1457201300583485491','1494694133862760578','Creator is Leadership and the task is leadership-scoped','[]','The task creator',80),
 ('task.question.answered','tasks','Question answered on a task','The creator answered a request for information.','teams + dashboard actions, bot modal','channel','1457201300583485491','1494694133862760578','Asker is Leadership and the task is leadership-scoped','[]','The person who asked',90),
 ('task.reminder.dm','tasks','Task reminder (DM)','Nudges the assignee by direct message about an outstanding task.','bot/taskReminder.js','dm','','','','[]','The assignee',100);

-- ── Seed: Events & Reminders ─────────────────────────────────────────────────
INSERT OR IGNORE INTO ping_routes
  (key, group_key, label, description, source_hint, kind, channel_id, alt_channel_id, alt_label, mention_roles, dynamic_mentions, sort)
VALUES
 ('event.created','events','Event created','Announces a newly scheduled event.','teams + dashboard + operations actions','channel','1464012356379213854','1494694133862760578','Event targets FM Leadership or Game Affairs','[]','The event target',10),
 ('reminder.warning','events','Reminder — 30 minute warning','Heads-up posted half an hour before a reminder is due.','bot/scheduler.js','per_item','','','','[]','The reminder target',20),
 ('reminder.due','events','Reminder — due now','Fires when a one-off reminder comes due.','bot/scheduler.js','per_item','','','','[]','The reminder target',30),
 ('reminder.recurring','events','Recurring monthly reminder','Fires monthly recurring reminder definitions.','bot/recurringReminders.js','per_item','','','','[]','The reminder target',40);

-- ── Seed: Promotions & Reviews ───────────────────────────────────────────────
INSERT OR IGNORE INTO ping_routes
  (key, group_key, label, description, source_hint, kind, channel_id, alt_channel_id, alt_label, mention_roles, dynamic_mentions, sort)
VALUES
 ('promo.staged','promotions','Promotion staged','A faction has been staged for a tier promotion, awaiting RP confirmation.','factions + operations actions','channel','1469503845095702692','','','[]','The faction team lead',10),
 ('promo.completed','promotions','Promotion complete','A staged promotion was applied — tier and imports granted.','factions/actions.js','channel','1469503845095702692','','','[]','The faction team lead',20),
 ('promo.cancelled','promotions','Promotion cancelled','A staged promotion was called off.','factions/actions.js','channel','1469503845095702692','','','[]','The faction team lead',30),
 ('promo.demoted','promotions','Faction demoted','A faction was moved down a tier.','factions/actions.js','channel','1469503845095702692','','','[]','The faction team lead',40),
 ('promo.review.thread','promotions','Monthly review thread','Opens the promotion review thread and polls on the 14th.','bot/promotionReview.js','channel','1457189620256215083','','','["1457670376745074730"]','',50),
 ('review.submitted','promotions','Monthly review submitted','Asks the team lead to fold this month''s feedback into their 15th message.','leadership/actions.js','channel','1469503845095702692','','','[]','The faction team lead',60),
 ('review.leadership_note','promotions','Leadership feedback submitted','Leadership added a confidential note to a faction review.','leadership/actions.js','channel','1469503845095702692','','','[]','The faction team lead',70),
 ('review.feedback_sent','promotions','Monthly feedback delivered','Confirms the month''s feedback message reached the faction — sent via comms or marked as delivered manually.','leadership/actions.js','channel','1469503845095702692','','','[]','',80);

-- ── Seed: RP Changes ─────────────────────────────────────────────────────────
INSERT OR IGNORE INTO ping_routes
  (key, group_key, label, description, source_hint, kind, channel_id, alt_channel_id, alt_label, mention_roles, dynamic_mentions, sort)
VALUES
 ('rp.requested','rp','RP change requested','A team lead asked for an NPC, HQ or turf change.','factions/actions.js','channel','1494694133862760578','','','[]','',10),
 ('rp.resubmitted','rp','RP change resubmitted','A denied request came back with more context.','operations/actions.js','channel','1494694133862760578','','','[]','',20),
 ('rp.done','rp','RP scene complete','The requester confirmed the scene has been played out.','operations/actions.js','channel','1494694133862760578','','','[]','',30),
 ('rp.executed','rp','RP change executed','Leadership applied the change to the NPC/HQ record.','operations/actions.js','channel','1494694133862760578','','','[]','',40),
 ('rp.approved.requester','rp','Requester notified — approved','Tells the requester their RP change was approved.','operations/actions.js','channel','1469503845095702692','','','[]','The requester',50),
 ('rp.denied.requester','rp','Requester notified — denied','Tells the requester their RP change was rejected, with the reason.','operations/actions.js','channel','1469503845095702692','','','[]','The requester',60),
 ('rp.executed.requester','rp','Requester notified — executed','Confirms to the requester that the change is live.','operations/actions.js','channel','1469503845095702692','','','[]','The requester',70);

-- ── Seed: Form Submissions ───────────────────────────────────────────────────
INSERT OR IGNORE INTO ping_routes
  (key, group_key, label, description, source_hint, kind, channel_id, alt_channel_id, alt_label, mention_roles, dynamic_mentions, sort)
VALUES
 ('form.rcf_application','forms','Recognized Criminal Faction application','A faction applied for RCF status.','api/notify','channel','1457571102019555463','','','["1457670376745074730"]','',10),
 ('form.staff_application','forms','FM staff application','Someone applied to join Faction Management.','api/notify','channel','1457571102019555463','','','["1457670376745074730"]','',20),
 ('form.garage_request','forms','Garage request','A faction submitted a garage/vehicle request.','api/notify','channel','1457571102019555463','','','["1457670376745074730"]','',30),
 ('form.ci_application','forms','CI application','A new Confidential Informant application arrived.','api/notify','channel','1457571102019555463','','','["1457189093594239147"]','',40),
 ('form.faction_feedback.fm','forms','Faction feedback — Criminal (FM)','Feedback form routed to Criminal Faction Management.','api/notify','channel','1457571102019555463','','','["1457670376745074730"]','',50),
 ('form.faction_feedback.lfm','forms','Faction feedback — Legal (LFM)','Feedback form routed to Legal Faction Management.','api/notify','channel','1457571102019555463','','','["1457208224435666977"]','',60);

-- ── Seed: Communications ─────────────────────────────────────────────────────
INSERT OR IGNORE INTO ping_routes
  (key, group_key, label, description, source_hint, kind, channel_id, alt_channel_id, alt_label, mention_roles, dynamic_mentions, sort)
VALUES
 ('comms.announcement.fm','comms','Announcement — also post to FM','Copy of an announcement posted into FM Announcements.','communications/actions.js','channel','1503178123993157633','','','["1457229857749729363"]','',10),
 ('comms.ic.fm','comms','IC communication — also post to FM','Copy of an IC communication filed in the Memo Archive.','communications/actions.js','channel','1460432301878935725','','','[]','',20);

-- ── Seed: Storytelling ───────────────────────────────────────────────────────
INSERT OR IGNORE INTO ping_routes
  (key, group_key, label, description, source_hint, kind, channel_id, alt_channel_id, alt_label, mention_roles, dynamic_mentions, sort)
VALUES
 ('story.changelog','storytelling','Change Log entry','Posted when a black-market doctor or drop location is added, edited or removed.','storytelling/actions.js','channel','1464415763577176208','','','[]','',10),
 ('story.scene_idea','storytelling','New scene library idea','A staff member submitted a scene idea for approval.','storytelling/actions.js','channel','1469503845095702692','','','[]','',20),
 ('story.scene_feedback','storytelling','Feedback on a scene idea','Someone commented on a pending scene idea.','storytelling/actions.js','channel','1457201300583485491','','','[]','The idea author',30),
 ('scene.assistant_added','storytelling','Scene log — assistant added','Tells the scene author that someone added themselves as an assistant on their log.','scenes/actions.js','channel','1457201300583485491','','','[]','The scene author',40);

-- ── Seed: Records & Reports ──────────────────────────────────────────────────
INSERT OR IGNORE INTO ping_routes
  (key, group_key, label, description, source_hint, kind, channel_id, alt_channel_id, alt_label, mention_roles, dynamic_mentions, sort)
VALUES
 ('document.published','records','Document published','A new SOP or document went live on the dashboard.','documents/actions.js','channel','1457230769951998114','','','[]','',10),
 ('fmhours.report.prod','records','FM hours report','Monthly staff activity report.','operations/fmhours/actions.js','channel','1504787244307976285','','','[]','',20),
 ('fmhours.report.test','records','FM hours report (test mode)','Where the hours report goes when Test Mode is ticked.','operations/fmhours/actions.js','channel','1504787457407848558','','','[]','',30),
 ('forum.sync.source','records','Forum activity feed (read)','Channel the bot WATCHES for forum post notifications. Not a ping — changing this changes what forum activity gets counted.','bot/forumSync.js','source','1457671829354451090','','','[]','',40);

-- ── Seed: conversation sync channels (was hardcoded in bot/conversationSync.js)
INSERT OR IGNORE INTO conversation_sync_channels (channel_id, name, sort) VALUES
 ('1457201300583485491','meridian-database',10),
 ('1457189620256215083','management-board',20),
 ('1469503845095702692','team-leads',30),
 ('1457277228520964190','team-cup',40),
 ('1457277245851963475','team-pumpkin',50),
 ('1462320570858209331','team-daxu',60),
 ('1457277183407165573','team-niner',70),
 ('1457277206370975785','team-wolokai',80);
