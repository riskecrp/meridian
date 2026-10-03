-- 015_server_log_channel.sql
-- The bot's server log (member join/leave, message edits/deletes, trigger-word
-- hits) was database-only, with trigger words also DMing one user. It now also
-- posts into a channel in the Game Affairs Discord, and a trigger-word hit pings
-- Game Affairs Management there. Both are ping routes so the channel and the
-- pinged roles stay editable on the Discord & Access page.
INSERT OR IGNORE INTO ping_routes
  (key, group_key, label, description, source_hint, kind, channel_id, alt_channel_id, alt_label, mention_roles, dynamic_mentions, sort)
VALUES
 ('logs.events','logs','Server log — joins, leaves, edits, deletes','Every member join/leave and message edit/delete the bot sees, in any server it is in. Posted as embeds; nothing is pinged.','bot/index.js','channel','1556076309615083580','','','[]','',10),
 ('logs.keyword','logs','Trigger word alert','A message or edit containing one of the trigger words (Member Log page). Posts the hit here and pings these roles. The alert DM to the bot owner is unchanged.','bot/index.js checkKeywords','channel','1556076309615083580','','','["1457189093594239147"]','',20);
