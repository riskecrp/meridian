-- 004_feedback_nudge_roles.sql
-- Game Affairs Management is pinged when feedback arrives, but not chased about it.
--
-- The nudge every 48 hours is aimed at the people who own the follow-through —
-- FM Team Leads and FM Leadership. Game Affairs still gets the initial ping, can
-- still read every thread, and can still press the buttons; they just stop
-- receiving the repeat tag on an item that is sitting open.
--
-- 003 seeded both routes with all three roles. This narrows the nudge only.
-- It also narrows what that message is ALLOWED to ping: the bot builds each
-- message's mention allow-list from this same column, so a role dropped here can
-- no longer be pinged from a nudge even if its mention ends up in the text.
UPDATE ping_routes
   SET mention_roles = '["1457670376745074730","1457215385139941456"]'
 WHERE key = 'feedback.nudge';
