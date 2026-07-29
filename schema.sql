-- Meridian schema — GENERATED from the live DB, do not hand-edit.
-- Regenerate after migrations: sqlite3 data/meridian.db .schema > schema.sql
-- Generated: 2026-07-29T21:27:41Z
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE staff (
    id INTEGER PRIMARY KEY, discord_id TEXT NOT NULL UNIQUE, discord_name TEXT NOT NULL DEFAULT '',
    display_name TEXT NOT NULL DEFAULT '', team_id TEXT NOT NULL DEFAULT '', team_name TEXT NOT NULL DEFAULT '',
    rank TEXT NOT NULL DEFAULT 'Guide', clearance INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, dm_tracking_enabled INTEGER NOT NULL DEFAULT 0, lead_storyteller INTEGER NOT NULL DEFAULT 0);
CREATE TABLE sessions (
    id INTEGER PRIMARY KEY, staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE, discord_id TEXT NOT NULL, discord_name TEXT NOT NULL DEFAULT '',
    clearance INTEGER NOT NULL DEFAULT 1, expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
, event_team INTEGER NOT NULL DEFAULT 0, lead_storyteller INTEGER NOT NULL DEFAULT 0);
CREATE INDEX idx_sessions_token ON sessions(token);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
CREATE TABLE factions (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, lead_discord_id TEXT NOT NULL DEFAULT '',
    tier INTEGER NOT NULL DEFAULT 0, last_promoted TEXT DEFAULT NULL,
    thread_id TEXT NOT NULL DEFAULT '', forum_url TEXT NOT NULL DEFAULT '', discord_url TEXT NOT NULL DEFAULT '',
    pending_promo TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, archived INTEGER NOT NULL DEFAULT 0, archived_at TEXT NOT NULL DEFAULT '', forum_posts_30d INTEGER NOT NULL DEFAULT 0, forum_last_synced TEXT NOT NULL DEFAULT '', aliases TEXT NOT NULL DEFAULT '');
CREATE TABLE faction_members (
    id INTEGER PRIMARY KEY, faction_id INTEGER NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
    character_name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT 'N/A', residence TEXT NOT NULL DEFAULT 'N/A',
    is_leader INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_faction_members_faction ON faction_members(faction_id);
CREATE TABLE properties (
    id INTEGER PRIMARY KEY, address TEXT NOT NULL, faction_id INTEGER REFERENCES factions(id) ON DELETE SET NULL,
    property_type TEXT NOT NULL DEFAULT 'Property', is_hq INTEGER NOT NULL DEFAULT 0,
    confiscated INTEGER NOT NULL DEFAULT 0, date_given TEXT DEFAULT NULL,
    date_confiscated TEXT DEFAULT NULL, confiscated_by TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, current_owner TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '');
CREATE INDEX idx_properties_faction ON properties(faction_id);
CREATE TABLE scene_logs (
    id INTEGER PRIMARY KEY, date TEXT NOT NULL, faction_id INTEGER NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
    rewards TEXT NOT NULL DEFAULT 'None', logged_by TEXT NOT NULL DEFAULT 'Unknown',
    notes TEXT NOT NULL DEFAULT '', author_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_scene_logs_faction ON scene_logs(faction_id);
CREATE INDEX idx_scene_logs_date ON scene_logs(date);
CREATE TABLE intel_notes (
    id INTEGER PRIMARY KEY, faction_id INTEGER NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
    text TEXT NOT NULL, author TEXT NOT NULL DEFAULT 'Unknown', author_id TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_intel_notes_faction ON intel_notes(faction_id);
CREATE TABLE faction_history (
    id INTEGER PRIMARY KEY, faction_id INTEGER REFERENCES factions(id) ON DELETE SET NULL,
    faction_name TEXT NOT NULL DEFAULT '', action_type TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '', authorized_by TEXT NOT NULL DEFAULT 'System',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_faction_history_faction ON faction_history(faction_id);
CREATE TABLE tasks (
    id INTEGER PRIMARY KEY, task_uid TEXT NOT NULL UNIQUE, description TEXT NOT NULL,
    target_id TEXT NOT NULL DEFAULT '', target_type TEXT NOT NULL DEFAULT 'Role',
    claimed_by TEXT NOT NULL DEFAULT 'None', next_reminder TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
, created_by_id TEXT NOT NULL DEFAULT '', created_by_name TEXT NOT NULL DEFAULT '', notify_creator INTEGER DEFAULT 0);
CREATE TABLE task_log (
    id INTEGER PRIMARY KEY, action TEXT NOT NULL, actor TEXT NOT NULL DEFAULT '',
    task_uid TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
    target TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE reminders (
    id INTEGER PRIMARY KEY, uuid TEXT NOT NULL UNIQUE, author_id TEXT NOT NULL DEFAULT '',
    channel_id TEXT NOT NULL DEFAULT '', message TEXT NOT NULL DEFAULT '',
    epoch_ms TEXT NOT NULL, readable_time TEXT NOT NULL DEFAULT '',
    repeat_rule TEXT NOT NULL DEFAULT 'None', target_tag TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ACTIVE', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE deletion_requests (
    id INTEGER PRIMARY KEY, requested_by TEXT NOT NULL DEFAULT '', discord_id TEXT NOT NULL DEFAULT '',
    content_type TEXT NOT NULL DEFAULT '', original_text TEXT NOT NULL DEFAULT '',
    target_row_id INTEGER DEFAULT NULL, target_table TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'PENDING', resolved_by TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT DEFAULT NULL
);
CREATE TABLE import_items (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, tier TEXT NOT NULL DEFAULT '1',
    category TEXT NOT NULL DEFAULT 'General', lore_specific TEXT NOT NULL DEFAULT 'No',
    pkg TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now'))
, price TEXT NOT NULL DEFAULT '', import_time TEXT NOT NULL DEFAULT '', shipment_power TEXT NOT NULL DEFAULT '');
CREATE TABLE faction_imports (
    id INTEGER PRIMARY KEY, faction_id INTEGER NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES import_items(id) ON DELETE CASCADE,
    permitted INTEGER NOT NULL DEFAULT 0, UNIQUE(faction_id, item_id)
);
CREATE INDEX idx_faction_imports_faction ON faction_imports(faction_id);
CREATE INDEX idx_faction_imports_item ON faction_imports(item_id);
CREATE TABLE npcs (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, position TEXT NOT NULL DEFAULT '',
    npc_type TEXT NOT NULL DEFAULT 'General', turf TEXT NOT NULL DEFAULT 'Unaffiliated',
    shipment_power TEXT NOT NULL DEFAULT '', claimable INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_npcs_turf ON npcs(turf);
CREATE INDEX idx_npcs_type ON npcs(npc_type);
CREATE TABLE pending_executions (
    id INTEGER PRIMARY KEY, date TEXT NOT NULL,
    faction_id INTEGER NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
    execution_type TEXT NOT NULL DEFAULT '', turf TEXT NOT NULL DEFAULT 'N/A',
    old_value TEXT NOT NULL DEFAULT 'N/A', new_value TEXT NOT NULL DEFAULT '',
    requested_by TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
, requester_id TEXT NOT NULL DEFAULT '', deny_reason TEXT NOT NULL DEFAULT '', rp_note TEXT NOT NULL DEFAULT '', approver_id TEXT NOT NULL DEFAULT '');
CREATE TABLE inventory_stock (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, category TEXT NOT NULL DEFAULT '',
    starting_stock INTEGER NOT NULL DEFAULT 0, current_stock INTEGER NOT NULL DEFAULT 0,
    threshold INTEGER NOT NULL DEFAULT 0, purchaseable INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE inventory_logs (
    id INTEGER PRIMARY KEY, date TEXT NOT NULL, item_name TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0, distributed_by TEXT NOT NULL DEFAULT 'Unknown',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE treasury_logs (
    id INTEGER PRIMARY KEY, date TEXT NOT NULL, faction_name TEXT NOT NULL DEFAULT '',
    amount INTEGER NOT NULL DEFAULT 0, distributed_by TEXT NOT NULL DEFAULT 'Unknown',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE knowledge_base (
    id INTEGER PRIMARY KEY, category TEXT NOT NULL DEFAULT 'General', title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '', added_by TEXT NOT NULL DEFAULT 'System',
    notes TEXT NOT NULL DEFAULT '', entry_type TEXT NOT NULL DEFAULT 'lore',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE spawn_items (
    id INTEGER PRIMARY KEY, category TEXT NOT NULL DEFAULT '', name TEXT NOT NULL,
    game_id TEXT NOT NULL DEFAULT '', item_type TEXT NOT NULL DEFAULT 'item',
    extra TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_spawn_items_category ON spawn_items(category);
CREATE TABLE discord_config (
    id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, channel_id TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT ''
);
CREATE TABLE discord_roles (
    id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, role_id TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT ''
);
CREATE VIEW v_faction_scene_stats AS
SELECT f.id AS faction_id, f.name AS faction_name, COUNT(sl.id) AS all_time,
    SUM(CASE WHEN sl.created_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) AS scenes_30d
FROM factions f LEFT JOIN scene_logs sl ON sl.faction_id = f.id GROUP BY f.id, f.name
/* v_faction_scene_stats(faction_id,faction_name,all_time,scenes_30d) */;
CREATE VIEW v_server_analytics AS
SELECT (SELECT COUNT(*) FROM factions) AS total_factions,
    (SELECT COUNT(*) FROM properties) AS total_properties,
    (SELECT COUNT(*) FROM properties WHERE confiscated = 1) AS confiscated_assets,
    (SELECT COUNT(*) FROM tasks WHERE claimed_by = 'None') AS open_tasks
/* v_server_analytics(total_factions,total_properties,confiscated_assets,open_tasks) */;
CREATE TABLE documents (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'General',
    content TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_by_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, level_required INTEGER NOT NULL DEFAULT 1);
CREATE TABLE site_audit_log (
    id INTEGER PRIMARY KEY,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    actor_id TEXT NOT NULL DEFAULT '',
    actor_name TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT '',
    target_id TEXT DEFAULT NULL,
    target_label TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_audit_timestamp ON site_audit_log(timestamp);
CREATE TABLE weapon_ammo (
    id INTEGER PRIMARY KEY,
    weapon_name TEXT NOT NULL,
    weapon_category TEXT NOT NULL DEFAULT '',
    caliber TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_weapon_ammo_cat ON weapon_ammo(weapon_category);
CREATE TABLE weapon_ammo_compat (
    id INTEGER PRIMARY KEY,
    weapon_id INTEGER NOT NULL REFERENCES weapon_ammo(id) ON DELETE CASCADE,
    ammo_name TEXT NOT NULL,
    ammo_type TEXT NOT NULL DEFAULT 'Standard',
    UNIQUE(weapon_id, ammo_name)
);
CREATE INDEX idx_compat_weapon ON weapon_ammo_compat(weapon_id);
CREATE TABLE weapon_attachments (
    id INTEGER PRIMARY KEY,
    weapon_id INTEGER NOT NULL REFERENCES weapon_ammo(id) ON DELETE CASCADE,
    attachment_name TEXT NOT NULL,
    UNIQUE(weapon_id, attachment_name)
);
CREATE INDEX idx_attach_weapon ON weapon_attachments(weapon_id);
CREATE TABLE change_log (
    id INTEGER PRIMARY KEY,
    change_type TEXT NOT NULL DEFAULT 'drop_location',
    name TEXT NOT NULL,
    position TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL DEFAULT '',
    blocked_off INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_by_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE faction_reviews (
    id INTEGER PRIMARY KEY,
    faction_id INTEGER NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
    review_month TEXT NOT NULL,
    recommendation TEXT NOT NULL DEFAULT 'Hold',
    feedback TEXT NOT NULL DEFAULT '',
    submitted_by TEXT NOT NULL DEFAULT '',
    submitted_by_id TEXT NOT NULL DEFAULT '',
    team_id TEXT NOT NULL DEFAULT '',
    team_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')), faction_name TEXT NOT NULL DEFAULT '', reviewer_id TEXT NOT NULL DEFAULT '', reviewer_name TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Pending Discussion',
    UNIQUE(faction_id, review_month)
);
CREATE INDEX idx_reviews_month ON faction_reviews(review_month);
CREATE INDEX idx_reviews_faction ON faction_reviews(faction_id);
CREATE TABLE leadership_meeting_notes (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    meeting_type TEXT NOT NULL DEFAULT 'General',
    team_id TEXT NOT NULL DEFAULT '',
    team_name TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    attendees TEXT NOT NULL DEFAULT '',
    meeting_date TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_by_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_meeting_team ON leadership_meeting_notes(team_id);
CREATE INDEX idx_meeting_date ON leadership_meeting_notes(meeting_date);
CREATE TABLE sent_recurring_reminders (
    id INTEGER PRIMARY KEY,
    reminder_key TEXT NOT NULL UNIQUE,
    sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE discord_messages (
    message_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    channel_name TEXT NOT NULL,
    author_id TEXT NOT NULL,
    author_name TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    synced_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_dm_channel ON discord_messages(channel_id);
CREATE INDEX idx_dm_author ON discord_messages(author_id);
CREATE INDEX idx_dm_created ON discord_messages(created_at);
CREATE TABLE conversation_summaries (
    id INTEGER PRIMARY KEY,
    cache_key TEXT NOT NULL UNIQUE,
    summary_type TEXT NOT NULL,
    target TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    from_date TEXT NOT NULL,
    to_date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_summary_key ON conversation_summaries(cache_key);
CREATE TABLE channel_sync_state (
    channel_id TEXT PRIMARY KEY,
    channel_name TEXT NOT NULL,
    last_message_id TEXT NOT NULL DEFAULT '',
    last_synced_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE faction_fleet_config (
    id INTEGER PRIMARY KEY,
    faction_id INTEGER NOT NULL UNIQUE,
    max_types INTEGER,
    max_total INTEGER,
    max_garages INTEGER,
    override_reason TEXT NOT NULL DEFAULT '',
    overridden_by TEXT NOT NULL DEFAULT '',
    overridden_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE faction_fleet_vehicles (
    id INTEGER PRIMARY KEY,
    faction_id INTEGER NOT NULL,
    vehicle_name TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_by TEXT NOT NULL DEFAULT ''
, spawn_name TEXT NOT NULL DEFAULT '');
CREATE INDEX idx_ffv_faction ON faction_fleet_vehicles(faction_id);
CREATE TABLE faction_fleet_garages (
    id INTEGER PRIMARY KEY,
    faction_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    z REAL NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_ffg_faction ON faction_fleet_garages(faction_id);
CREATE TABLE fleet_vehicle_catalog (
    id INTEGER PRIMARY KEY,
    vehicle_name TEXT NOT NULL UNIQUE,
    use_count INTEGER NOT NULL DEFAULT 0
, spawn_name TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '');
CREATE TABLE task_questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_uid TEXT NOT NULL,
            asked_by_id TEXT NOT NULL,
            asked_by_name TEXT NOT NULL,
            question TEXT NOT NULL,
            answered_by_id TEXT,
            answered_by_name TEXT,
            answer TEXT,
            asked_at TEXT NOT NULL,
            answered_at TEXT
        );
CREATE TABLE sqlite_sequence(name,seq);
CREATE INDEX idx_task_questions_uid ON task_questions(task_uid);
CREATE TABLE recurring_reminders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            body TEXT,
            links TEXT,
            target_type TEXT NOT NULL,
            target_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            ping_day INTEGER NOT NULL,
            due_day INTEGER NOT NULL,
            active INTEGER DEFAULT 1,
            created_by_id TEXT,
            created_by_name TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
CREATE TABLE recurring_reminder_instances (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reminder_id INTEGER NOT NULL,
            year INTEGER NOT NULL,
            month INTEGER NOT NULL,
            recipient_id TEXT NOT NULL,
            recipient_name TEXT,
            completed_at TEXT,
            completed_by_id TEXT,
            completed_by_name TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(reminder_id, year, month, recipient_id)
        );
CREATE INDEX idx_rri_recipient ON recurring_reminder_instances(recipient_id, completed_at);
CREATE INDEX idx_rri_reminder ON recurring_reminder_instances(reminder_id);
CREATE TABLE role_mentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL UNIQUE,
  channel_id TEXT NOT NULL,
  channel_name TEXT,
  author_id TEXT NOT NULL,
  author_name TEXT,
  content TEXT NOT NULL,
  guild_id TEXT NOT NULL DEFAULT '1457188814916423855',
  created_at TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0
, guild_name TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS "mentions" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL DEFAULT '738214924760907907',
  channel_id TEXT NOT NULL,
  channel_name TEXT,
  author_id TEXT NOT NULL,
  author_name TEXT,
  content TEXT NOT NULL,
  guild_id TEXT NOT NULL DEFAULT '1457188814916423855',
  created_at TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0, guild_name TEXT NOT NULL DEFAULT '',
  UNIQUE(message_id, target_user_id)
);
CREATE TABLE leadership_personal_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  faction_id INTEGER NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
  faction_name TEXT NOT NULL DEFAULT '',
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  review_month TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
, status TEXT NOT NULL DEFAULT '');
CREATE INDEX idx_lpn_faction ON leadership_personal_notes(faction_id);
CREATE INDEX idx_lpn_author ON leadership_personal_notes(author_id);
CREATE TABLE bot_server_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  guild_name TEXT NOT NULL DEFAULT '',
  faction_id INTEGER REFERENCES factions(id) ON DELETE SET NULL,
  watch_role_id TEXT NOT NULL DEFAULT '',
  watch_role_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
, access_role_id TEXT NOT NULL DEFAULT '', access_role_name TEXT NOT NULL DEFAULT '', comms_channel_id TEXT NOT NULL DEFAULT '', comms_channel_name TEXT NOT NULL DEFAULT '', faction_channel_id TEXT NOT NULL DEFAULT '', faction_channel_name TEXT NOT NULL DEFAULT '');
CREATE TABLE faction_public_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  faction_id INTEGER NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
  faction_name TEXT NOT NULL DEFAULT '',
  author_name TEXT NOT NULL DEFAULT '',
  author_id TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE faction_ic_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  faction_id INTEGER NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
  faction_name TEXT NOT NULL DEFAULT '',
  sender_name TEXT NOT NULL DEFAULT '',
  contact_type TEXT NOT NULL DEFAULT 'IC',
  message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now'))
, status TEXT NOT NULL DEFAULT 'pending_discussion', assigned_to TEXT NOT NULL DEFAULT '', assigned_name TEXT NOT NULL DEFAULT '', thread_id TEXT NOT NULL DEFAULT '');
CREATE INDEX idx_fpm_faction ON faction_public_messages(faction_id);
CREATE INDEX idx_fic_faction ON faction_ic_contacts(faction_id);
CREATE TABLE mdb_access_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id TEXT NOT NULL UNIQUE,
  role_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE mdb_sessions (
  token TEXT PRIMARY KEY,
  discord_id TEXT NOT NULL,
  discord_name TEXT NOT NULL,
  expires_at TEXT NOT NULL
, is_fm INTEGER NOT NULL DEFAULT 0, faction_id INTEGER REFERENCES factions(id), is_leadership INTEGER NOT NULL DEFAULT 0, is_lst INTEGER NOT NULL DEFAULT 0, is_pipedown INTEGER DEFAULT 0);
CREATE TABLE bot_watch_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  config_id INTEGER NOT NULL REFERENCES bot_server_configs(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL,
  role_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE watch_role_mentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL UNIQUE,
  config_id INTEGER REFERENCES bot_server_configs(id) ON DELETE SET NULL,
  watch_role_id TEXT NOT NULL,
  watch_role_name TEXT NOT NULL DEFAULT '',
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL DEFAULT '',
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  guild_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_watch_role_mentions_config ON watch_role_mentions(config_id);
CREATE INDEX idx_watch_role_mentions_role ON watch_role_mentions(watch_role_id);
CREATE TABLE scene_assistants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scene_id INTEGER NOT NULL REFERENCES scene_logs(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL,
  staff_name TEXT NOT NULL,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  added_by_id TEXT NOT NULL,
  added_by_name TEXT NOT NULL
);
CREATE INDEX idx_scene_assistants_scene ON scene_assistants(scene_id);
CREATE INDEX idx_scene_assistants_staff ON scene_assistants(staff_id);
CREATE VIEW v_staff_activity_30d AS
SELECT
  COALESCE(s.display_name, c.discord_id) AS name,
  c.discord_id,
  COUNT(*) AS scene_count
FROM (
  SELECT sl.author_id AS discord_id
  FROM scene_logs sl
  WHERE sl.created_at >= datetime('now','-30 days')
    AND sl.author_id != ''
  UNION ALL
  SELECT sa.staff_id AS discord_id
  FROM scene_assistants sa
  JOIN scene_logs sl ON sa.scene_id = sl.id
  WHERE sl.created_at >= datetime('now','-30 days')
) c
LEFT JOIN staff s ON s.discord_id = c.discord_id
GROUP BY c.discord_id
ORDER BY scene_count DESC
/* v_staff_activity_30d(name,discord_id,scene_count) */;
CREATE TABLE teams (
  team_id TEXT PRIMARY KEY,
  team_name TEXT NOT NULL,
  channel_id TEXT NOT NULL DEFAULT ''
);
CREATE TABLE promotion_polls (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  faction_id  INTEGER NOT NULL,
  faction_name TEXT NOT NULL,
  next_tier   INTEGER NOT NULL,
  thread_id   TEXT NOT NULL,
  message_id  TEXT NOT NULL,
  category    TEXT NOT NULL,
  weapon_names TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  processed   INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE forwarded_dms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  source_channel TEXT NOT NULL DEFAULT '',
  forwarded_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_read INTEGER NOT NULL DEFAULT 0
, source_channel_id TEXT NOT NULL DEFAULT '', source_message_id TEXT NOT NULL DEFAULT '', target_user_id TEXT NOT NULL DEFAULT '');
CREATE TABLE faction_ic_messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  faction_id   INTEGER NOT NULL,
  faction_name TEXT    NOT NULL DEFAULT '',
  author_name  TEXT    NOT NULL DEFAULT '',
  author_id    TEXT    NOT NULL DEFAULT '',
  link         TEXT    NOT NULL DEFAULT '',
  message      TEXT             DEFAULT '',
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_faction_ic_messages_faction ON faction_ic_messages(faction_id);
CREATE TABLE member_join_leave_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  guild_name TEXT NOT NULL DEFAULT '',
  user_id    TEXT NOT NULL,
  username   TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  event      TEXT NOT NULL CHECK(event IN ('join','leave')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_mjll_guild   ON member_join_leave_logs(guild_id);
CREATE INDEX idx_mjll_created ON member_join_leave_logs(created_at DESC);
CREATE TABLE deleted_message_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  TEXT NOT NULL,
  guild_id    TEXT NOT NULL DEFAULT '',
  guild_name  TEXT NOT NULL DEFAULT '',
  channel_id  TEXT NOT NULL DEFAULT '',
  channel_name TEXT NOT NULL DEFAULT '',
  author_id   TEXT NOT NULL DEFAULT '',
  author_name TEXT NOT NULL DEFAULT '',
  content     TEXT NOT NULL DEFAULT '',
  had_content INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
, author_display_name TEXT NOT NULL DEFAULT '', deleter_id   TEXT NOT NULL DEFAULT '', deleter_name TEXT NOT NULL DEFAULT '');
CREATE INDEX idx_dml_guild   ON deleted_message_logs(guild_id);
CREATE INDEX idx_dml_created ON deleted_message_logs(created_at DESC);
CREATE TABLE edited_message_logs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id       TEXT NOT NULL,
  guild_id         TEXT NOT NULL DEFAULT '',
  guild_name       TEXT NOT NULL DEFAULT '',
  channel_id       TEXT NOT NULL DEFAULT '',
  channel_name     TEXT NOT NULL DEFAULT '',
  author_id        TEXT NOT NULL DEFAULT '',
  author_name      TEXT NOT NULL DEFAULT '',
  author_display_name TEXT NOT NULL DEFAULT '',
  content_before   TEXT NOT NULL DEFAULT '',
  content_after    TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_eml_guild   ON edited_message_logs(guild_id);
CREATE INDEX idx_eml_created ON edited_message_logs(created_at DESC);
CREATE TABLE server_log_keywords (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  phrase     TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE keyword_alerts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword      TEXT NOT NULL,
  message_id   TEXT NOT NULL DEFAULT '',
  guild_id     TEXT NOT NULL DEFAULT '',
  guild_name   TEXT NOT NULL DEFAULT '',
  channel_id   TEXT NOT NULL DEFAULT '',
  channel_name TEXT NOT NULL DEFAULT '',
  author_id    TEXT NOT NULL DEFAULT '',
  author_name  TEXT NOT NULL DEFAULT '',
  content      TEXT NOT NULL DEFAULT '',
  event_type   TEXT NOT NULL DEFAULT 'message',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_ka_created ON keyword_alerts(created_at DESC);
CREATE TABLE staff_coi (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id   TEXT NOT NULL,
  faction_name TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT 'manual',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(discord_id, faction_name COLLATE NOCASE)
);
CREATE INDEX idx_staff_coi_discord ON staff_coi(discord_id);
CREATE TABLE fm_character_links (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id     TEXT NOT NULL UNIQUE,
  character_name TEXT NOT NULL DEFAULT '',
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
, category TEXT NOT NULL DEFAULT '');
CREATE TABLE fm_hours_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT NOT NULL,
  period     TEXT NOT NULL,
  hours      REAL NOT NULL DEFAULT 0,
  UNIQUE(discord_id, period)
);
CREATE TABLE dashboard_access (
  discord_id   TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  level        INTEGER NOT NULL DEFAULT 3,
  granted_by_id   TEXT,
  granted_by_name TEXT,
  granted_at   TEXT DEFAULT (datetime('now'))
);
CREATE TABLE auto_delete_channels (
  channel_id   TEXT PRIMARY KEY,
  channel_name TEXT NOT NULL DEFAULT '',
  delay_seconds INTEGER NOT NULL DEFAULT 0,
  added_by_id   TEXT,
  added_by_name TEXT,
  added_at      TEXT DEFAULT (datetime('now'))
);
CREATE TABLE channel_purge_schedules (
  channel_id      TEXT PRIMARY KEY,
  channel_name    TEXT NOT NULL DEFAULT '',
  interval_hours  INTEGER NOT NULL DEFAULT 24,
  last_purged_at  TEXT,
  added_by_name   TEXT,
  added_at        TEXT DEFAULT (datetime('now'))
);
CREATE TABLE reminder_purge_channels (
  channel_id TEXT PRIMARY KEY,
  added_at   TEXT DEFAULT (datetime('now'))
);
CREATE TABLE scene_library (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'idea',
    category TEXT NOT NULL DEFAULT 'General',
    description TEXT NOT NULL DEFAULT '',
    staff_required INTEGER NOT NULL DEFAULT 1,
    spawning_required INTEGER NOT NULL DEFAULT 0,
    ped_required INTEGER NOT NULL DEFAULT 0,
    proposed_rewards TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_by_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, spawning_details TEXT NOT NULL DEFAULT '');
CREATE INDEX idx_scene_library_status ON scene_library(status);
CREATE INDEX idx_scene_library_category ON scene_library(category);
CREATE TABLE scene_library_feedback (
    id INTEGER PRIMARY KEY,
    scene_id INTEGER NOT NULL,
    feedback TEXT NOT NULL,
    created_by TEXT NOT NULL DEFAULT '',
    created_by_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_scene_library_feedback_scene ON scene_library_feedback(scene_id);
CREATE TABLE IF NOT EXISTS "ooc_notes" (
      id INTEGER PRIMARY KEY,
      faction_id INTEGER REFERENCES factions(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '',
      author_id TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      meeting_type TEXT NOT NULL DEFAULT 'general',
      duration_hours REAL NOT NULL DEFAULT 1.0,
      attendees_json TEXT NOT NULL DEFAULT '[]',
      target_type TEXT NOT NULL DEFAULT 'faction',
      target_key TEXT NOT NULL DEFAULT '',
      target_label TEXT NOT NULL DEFAULT ''
    );
CREATE INDEX idx_ooc_notes_faction ON ooc_notes(faction_id);
CREATE INDEX idx_ooc_notes_target  ON ooc_notes(target_type, target_key);
CREATE TABLE pipedown_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,                 -- 'Cigar' | 'Beverage'
  price INTEGER NOT NULL DEFAULT 0,
  description TEXT DEFAULT '',
  is_offmenu INTEGER NOT NULL DEFAULT 0,  -- 1 = off-menu code-word cigar
  faction_id INTEGER,                     -- off-menu only; NULL = unassigned spare
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE pipedown_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT DEFAULT (datetime('now')),
  customer_name TEXT DEFAULT '',
  note TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'New',     -- 'New' | 'Fulfilled'
  entered_by_id TEXT DEFAULT '',
  entered_by_name TEXT DEFAULT '',
  faction_id INTEGER,                     -- resolved alert target (hidden from Pipe Down)
  code_item_id INTEGER,                   -- off-menu item that triggered the alert
  pinged INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE pipedown_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  item_id INTEGER,
  item_name TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  price INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE managed_forum_posts (
    key               TEXT PRIMARY KEY,
    channel_id        TEXT NOT NULL,
    thread_id         TEXT,
    message_ids       TEXT,
    replace_thread_id TEXT,
    title             TEXT NOT NULL,
    content_json      TEXT NOT NULL DEFAULT '[]',
    updated_at        TEXT,
    updated_by        TEXT
  );
CREATE TABLE turfs (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  shipment_power TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE announcement_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT    NOT NULL DEFAULT 'announcement',
  author_id    TEXT    NOT NULL DEFAULT '',
  author_name  TEXT    NOT NULL DEFAULT '',
  channel_type TEXT    NOT NULL DEFAULT 'command',
  message      TEXT    NOT NULL DEFAULT '',
  link         TEXT             DEFAULT '',
  posted_to_fm INTEGER NOT NULL DEFAULT 0,
  sent_count   INTEGER NOT NULL DEFAULT 0,
  total_count  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_announcement_log_created ON announcement_log(created_at);
CREATE TABLE announcement_deliveries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id       INTEGER NOT NULL REFERENCES announcement_log(id) ON DELETE CASCADE,
  faction_id   INTEGER,
  faction_name TEXT    NOT NULL DEFAULT '',
  channel_type TEXT    NOT NULL DEFAULT '',
  ok           INTEGER NOT NULL DEFAULT 0,
  error        TEXT             DEFAULT '',
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_announcement_deliveries_log ON announcement_deliveries(log_id);
CREATE TABLE _migrations (
  name       TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE ping_routes (
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
CREATE INDEX idx_ping_routes_group ON ping_routes(group_key, sort);
CREATE TABLE conversation_sync_channels (
  channel_id TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  enabled    INTEGER NOT NULL DEFAULT 1,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE faction_feedback (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  sheet_row         INTEGER NOT NULL UNIQUE,
  faction           TEXT    NOT NULL DEFAULT '',
  character_name    TEXT    NOT NULL DEFAULT '',
  discord_username  TEXT    NOT NULL DEFAULT '',
  occurred          TEXT    NOT NULL DEFAULT '',
  submitted_at      TEXT    NOT NULL DEFAULT '',
  payload           TEXT    NOT NULL DEFAULT '{}',
  thread_id         TEXT,
  ack_message_id    TEXT,
  -- new -> claimed (the submitter has been contacted) -> completed / cancelled
  status            TEXT    NOT NULL DEFAULT 'new',
  claimed_by_id     TEXT,
  claimed_by_name   TEXT,
  claimed_at        TEXT,
  -- When the next nudge is due. Rolled forward on every nudge so an item that
  -- stays open keeps being chased instead of going quiet after one message.
  due_at            TEXT,
  last_reminder_at  TEXT,
  concluded_by_name TEXT,
  concluded_at      TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_faction_feedback_status ON faction_feedback(status);
CREATE TABLE faction_feedback_state (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  last_row    INTEGER NOT NULL DEFAULT 0,
  initialized INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE faction_feedback_failures (
  sheet_row       INTEGER PRIMARY KEY,
  attempts        INTEGER NOT NULL DEFAULT 0,
  skipped         INTEGER NOT NULL DEFAULT 0,
  first_failed_at TEXT,
  last_failed_at  TEXT,
  last_error      TEXT
);
