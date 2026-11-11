-- 023_deletion_requested_route.sql
-- Leadership learns about deletion requests (intel notes, scenes, OOC notes)
-- from a ping as well as from the Approvals tab. Same channel as the other
-- approval pings; retarget it from Admin › Pings.
INSERT OR IGNORE INTO ping_routes
  (key, group_key, label, description, source_hint, kind, channel_id, alt_channel_id, alt_label, mention_roles, dynamic_mentions, sort)
VALUES
  ('deletion.requested','records','Deletion requested','A guide asked for an intel note, scene or OOC note to be deleted; approve or reject it under Leadership → Approvals.','factions/actions.js','channel','1494694133862760578','','','[]','',15);
