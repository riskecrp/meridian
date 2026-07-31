-- 010_rcf_setup_ping_leadership.sql
-- FM Leadership is the only role an RCF application pings — on arrival, on
-- acceptance, and on every nudge.
--
-- Game Affairs Management can still work the setup checklist, but that is now an
-- access grant rather than a notification: they are not on the hook for every
-- accepted faction, they are free to pitch in when it helps. Because this route
-- doubles as the permission list for the setup phase, leaving GA in
-- mention_roles would have meant paging them every time — so the extra access is
-- expressed in bot/formSubmissions.js (`setupAlsoAllow`) instead, where it can
-- grant without notifying.
UPDATE ping_routes SET
  mention_roles = '["1457670376745074730"]',
  description   = 'Posts the setup checklist in the application''s thread when it is accepted, and pings these roles. Game Affairs Management can also tick the boxes without being pinged — see setupAlsoAllow in bot/formSubmissions.js.'
  WHERE key = 'form.rcf_application.setup';
