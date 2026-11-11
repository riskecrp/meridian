-- 025_document_ping_alt.sql
-- Documents above level 1 are announced on the leadership branch of the
-- document.published route (shared comms code skips them when no alt channel
-- is set). Seed that branch from the task routes' leadership channel so
-- restricted documents are announced out of the box; Admin › Pings can change it.
UPDATE ping_routes
   SET alt_channel_id = COALESCE((SELECT alt_channel_id FROM ping_routes WHERE key = 'task.assigned' AND alt_channel_id <> ''), alt_channel_id),
       alt_label = CASE WHEN alt_label = '' THEN 'Leadership-only documents' ELSE alt_label END
 WHERE key = 'document.published' AND (alt_channel_id IS NULL OR alt_channel_id = '');
