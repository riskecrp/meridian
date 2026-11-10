-- 019_resync_faction_names.sql
-- Renaming a faction only ever updated two tables, so SVR, Outlaws MC and other
-- past names survive in the copies child rows carry. Resync every copy from the
-- faction it points to. renameFaction now does this in one transaction, so this
-- is a one-off repair.
UPDATE faction_reviews            SET faction_name = (SELECT name FROM factions f WHERE f.id = faction_reviews.faction_id)            WHERE faction_id IN (SELECT id FROM factions);
UPDATE leadership_personal_notes  SET faction_name = (SELECT name FROM factions f WHERE f.id = leadership_personal_notes.faction_id)  WHERE faction_id IN (SELECT id FROM factions);
UPDATE faction_public_messages    SET faction_name = (SELECT name FROM factions f WHERE f.id = faction_public_messages.faction_id)    WHERE faction_id IN (SELECT id FROM factions);
UPDATE faction_ic_contacts        SET faction_name = (SELECT name FROM factions f WHERE f.id = faction_ic_contacts.faction_id)        WHERE faction_id IN (SELECT id FROM factions);
UPDATE faction_ic_messages        SET faction_name = (SELECT name FROM factions f WHERE f.id = faction_ic_messages.faction_id)        WHERE faction_id IN (SELECT id FROM factions);
UPDATE faction_history            SET faction_name = (SELECT name FROM factions f WHERE f.id = faction_history.faction_id)            WHERE faction_id IN (SELECT id FROM factions) AND action_type <> 'RENAME';
UPDATE treasury_logs              SET faction_name = (SELECT name FROM factions f WHERE f.id = treasury_logs.faction_id)              WHERE faction_id IN (SELECT id FROM factions);
UPDATE staff_coi                  SET faction_name = (SELECT name FROM factions f WHERE f.id = staff_coi.faction_id)                  WHERE faction_id IN (SELECT id FROM factions);
UPDATE promotion_polls            SET faction_name = (SELECT name FROM factions f WHERE f.id = promotion_polls.faction_id)            WHERE faction_id IN (SELECT id FROM factions);
UPDATE ooc_notes                  SET target_label = (SELECT name FROM factions f WHERE f.id = ooc_notes.faction_id)                  WHERE target_type = 'faction' AND faction_id IN (SELECT id FROM factions);
