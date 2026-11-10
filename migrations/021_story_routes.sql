-- 021_story_routes.sql
-- Storytelling repair (STORY-6/12/19 and policy 3/4):
--   1. A ping route for decisions on scene ideas. The author was pinged on
--      feedback but never on approval, reversion or deletion; those now go
--      through story.scene_decision. It starts on the same channel as the
--      feedback ping (muted/retargeted from the dashboard like any route).
--   2. One spelling of "no turf". npcs.turf used '', 'Unaffiliated' and
--      'Neutral' with contradictory claimable values; the sentinel is now
--      'Neutral' and claimable is derived from it (0 for Neutral, 1 otherwise).
--   3. Feedback rows orphaned by earlier scene deletions are removed (deleting
--      a scene now removes its feedback in the same transaction).

INSERT OR IGNORE INTO ping_routes
  (key, group_key, label, description, source_hint, kind, channel_id, alt_channel_id, alt_label, mention_roles, dynamic_mentions, sort)
VALUES
 ('story.scene_decision','storytelling','Decision on your scene idea','Tells the author when their scene idea is approved, moved back to idea, or removed from the library.','storytelling/actions.js','channel',
  COALESCE((SELECT channel_id FROM ping_routes WHERE key = 'story.scene_feedback'), ''),'','','[]','The idea author',40);

UPDATE npcs SET turf = 'Neutral'
 WHERE TRIM(turf) = '' OR LOWER(TRIM(turf)) IN ('unaffiliated', 'neutral');
UPDATE npcs SET claimable = CASE WHEN turf = 'Neutral' THEN 0 ELSE 1 END,
                shipment_power = CASE WHEN turf = 'Neutral' THEN '' ELSE shipment_power END;
DELETE FROM turfs WHERE LOWER(TRIM(name)) IN ('neutral', 'unaffiliated', '');

DELETE FROM scene_library_feedback WHERE scene_id NOT IN (SELECT id FROM scene_library);
