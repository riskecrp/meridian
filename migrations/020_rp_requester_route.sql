-- 020_rp_requester_route.sql
-- One route for everything the RP-change pipeline says to the person who asked
-- for the change (approved / denied / executed / withdrawn). shared/rpChanges.js
-- sends it as a direct message first (the bot registers a DM sender; the
-- dashboard uses the REST DM endpoint) and falls back to this channel when the
-- DM cannot be delivered, so the destination stays configurable from Admin › Pings.
--
-- The three per-stage requester routes it replaces pointed at the same channel;
-- they are removed so the admin page lists only routes something still sends to.

INSERT OR IGNORE INTO ping_routes
  (key, group_key, label, description, source_hint, kind, channel_id, alt_channel_id, alt_label, mention_roles, dynamic_mentions, sort)
VALUES
 ('rp.requester','rp','Requester notified (DM, channel fallback)',
  'Tells the person who requested an RP change that it was approved, denied, executed or withdrawn. Delivered as a direct message; this channel is only used when the DM cannot be sent.',
  'shared/rpChanges.js','channel',
  COALESCE((SELECT channel_id FROM ping_routes WHERE key = 'rp.approved.requester'), '1469503845095702692'),
  '','','[]','The requester',45);

DELETE FROM ping_routes WHERE key IN ('rp.approved.requester', 'rp.denied.requester', 'rp.executed.requester');
