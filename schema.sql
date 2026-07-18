PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY, discord_id TEXT NOT NULL UNIQUE, discord_name TEXT NOT NULL DEFAULT '',
    display_name TEXT NOT NULL DEFAULT '', team_id TEXT NOT NULL DEFAULT '', team_name TEXT NOT NULL DEFAULT '',
    rank TEXT NOT NULL DEFAULT 'Guide', clearance INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY, staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE, discord_id TEXT NOT NULL, discord_name TEXT NOT NULL DEFAULT '',
    clearance INTEGER NOT NULL DEFAULT 1, expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS factions (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, lead_discord_id TEXT NOT NULL DEFAULT '',
    tier INTEGER NOT NULL DEFAULT 0, last_promoted TEXT DEFAULT NULL,
    thread_id TEXT NOT NULL DEFAULT '', forum_url TEXT NOT NULL DEFAULT '', discord_url TEXT NOT NULL DEFAULT '',
    pending_promo TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS faction_members (
    id INTEGER PRIMARY KEY, faction_id INTEGER NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
    character_name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT 'N/A', residence TEXT NOT NULL DEFAULT 'N/A',
    is_leader INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_faction_members_faction ON faction_members(faction_id);

CREATE TABLE IF NOT EXISTS properties (
    id INTEGER PRIMARY KEY, address TEXT NOT NULL, faction_id INTEGER REFERENCES factions(id) ON DELETE SET NULL,
    property_type TEXT NOT NULL DEFAULT 'Property', is_hq INTEGER NOT NULL DEFAULT 0,
    confiscated INTEGER NOT NULL DEFAULT 0, date_given TEXT DEFAULT NULL,
    date_confiscated TEXT DEFAULT NULL, confiscated_by TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_properties_faction ON properties(faction_id);

CREATE TABLE IF NOT EXISTS scene_logs (
    id INTEGER PRIMARY KEY, date TEXT NOT NULL, faction_id INTEGER NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
    rewards TEXT NOT NULL DEFAULT 'None', logged_by TEXT NOT NULL DEFAULT 'Unknown',
    notes TEXT NOT NULL DEFAULT '', author_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scene_logs_faction ON scene_logs(faction_id);
CREATE INDEX IF NOT EXISTS idx_scene_logs_date ON scene_logs(date);

CREATE TABLE IF NOT EXISTS intel_notes (
    id INTEGER PRIMARY KEY, faction_id INTEGER NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
    text TEXT NOT NULL, author TEXT NOT NULL DEFAULT 'Unknown', author_id TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_intel_notes_faction ON intel_notes(faction_id);

CREATE TABLE IF NOT EXISTS ooc_notes (
    id INTEGER PRIMARY KEY, faction_id INTEGER NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
    date TEXT NOT NULL, author TEXT NOT NULL DEFAULT '', author_id TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ooc_notes_faction ON ooc_notes(faction_id);

CREATE TABLE IF NOT EXISTS faction_history (
    id INTEGER PRIMARY KEY, faction_id INTEGER REFERENCES factions(id) ON DELETE SET NULL,
    faction_name TEXT NOT NULL DEFAULT '', action_type TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '', authorized_by TEXT NOT NULL DEFAULT 'System',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_faction_history_faction ON faction_history(faction_id);

CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY, task_uid TEXT NOT NULL UNIQUE, description TEXT NOT NULL,
    target_id TEXT NOT NULL DEFAULT '', target_type TEXT NOT NULL DEFAULT 'Role',
    claimed_by TEXT NOT NULL DEFAULT 'None', next_reminder TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task_log (
    id INTEGER PRIMARY KEY, action TEXT NOT NULL, actor TEXT NOT NULL DEFAULT '',
    task_uid TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
    target TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY, uuid TEXT NOT NULL UNIQUE, author_id TEXT NOT NULL DEFAULT '',
    channel_id TEXT NOT NULL DEFAULT '', message TEXT NOT NULL DEFAULT '',
    epoch_ms TEXT NOT NULL, readable_time TEXT NOT NULL DEFAULT '',
    repeat_rule TEXT NOT NULL DEFAULT 'None', target_tag TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ACTIVE', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deletion_requests (
    id INTEGER PRIMARY KEY, requested_by TEXT NOT NULL DEFAULT '', discord_id TEXT NOT NULL DEFAULT '',
    content_type TEXT NOT NULL DEFAULT '', original_text TEXT NOT NULL DEFAULT '',
    target_row_id INTEGER DEFAULT NULL, target_table TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'PENDING', resolved_by TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS import_items (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, tier TEXT NOT NULL DEFAULT '1',
    category TEXT NOT NULL DEFAULT 'General', lore_specific TEXT NOT NULL DEFAULT 'No',
    pkg TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS faction_imports (
    id INTEGER PRIMARY KEY, faction_id INTEGER NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES import_items(id) ON DELETE CASCADE,
    permitted INTEGER NOT NULL DEFAULT 0, UNIQUE(faction_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_faction_imports_faction ON faction_imports(faction_id);
CREATE INDEX IF NOT EXISTS idx_faction_imports_item ON faction_imports(item_id);

CREATE TABLE IF NOT EXISTS npcs (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, position TEXT NOT NULL DEFAULT '',
    npc_type TEXT NOT NULL DEFAULT 'General', turf TEXT NOT NULL DEFAULT 'Unaffiliated',
    shipment_power TEXT NOT NULL DEFAULT '', claimable INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_npcs_turf ON npcs(turf);
CREATE INDEX IF NOT EXISTS idx_npcs_type ON npcs(npc_type);

CREATE TABLE IF NOT EXISTS pending_executions (
    id INTEGER PRIMARY KEY, date TEXT NOT NULL,
    faction_id INTEGER NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
    execution_type TEXT NOT NULL DEFAULT '', turf TEXT NOT NULL DEFAULT 'N/A',
    old_value TEXT NOT NULL DEFAULT 'N/A', new_value TEXT NOT NULL DEFAULT '',
    requested_by TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory_stock (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, category TEXT NOT NULL DEFAULT '',
    starting_stock INTEGER NOT NULL DEFAULT 0, current_stock INTEGER NOT NULL DEFAULT 0,
    threshold INTEGER NOT NULL DEFAULT 0, purchaseable INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory_logs (
    id INTEGER PRIMARY KEY, date TEXT NOT NULL, item_name TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0, distributed_by TEXT NOT NULL DEFAULT 'Unknown',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS treasury_logs (
    id INTEGER PRIMARY KEY, date TEXT NOT NULL, faction_name TEXT NOT NULL DEFAULT '',
    amount INTEGER NOT NULL DEFAULT 0, distributed_by TEXT NOT NULL DEFAULT 'Unknown',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS knowledge_base (
    id INTEGER PRIMARY KEY, category TEXT NOT NULL DEFAULT 'General', title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '', added_by TEXT NOT NULL DEFAULT 'System',
    notes TEXT NOT NULL DEFAULT '', entry_type TEXT NOT NULL DEFAULT 'lore',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS spawn_items (
    id INTEGER PRIMARY KEY, category TEXT NOT NULL DEFAULT '', name TEXT NOT NULL,
    game_id TEXT NOT NULL DEFAULT '', item_type TEXT NOT NULL DEFAULT 'item',
    extra TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_spawn_items_category ON spawn_items(category);

CREATE TABLE IF NOT EXISTS discord_config (
    id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, channel_id TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS discord_roles (
    id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, role_id TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT ''
);

-- Seed config
INSERT OR IGNORE INTO discord_config (key, channel_id, description) VALUES
    ('global_ping_channel',     '1457201300583485491', 'General FM announcements'),
    ('event_announce_channel',  '1464012356379213854', 'Scheduled event announcements'),
    ('leadership_channel',      '1457189620256215083', 'FM Leadership private channel'),
    ('team_lead_channel',       '1469503845095702692', 'Team Lead private channel');

INSERT OR IGNORE INTO discord_roles (key, role_id, description) VALUES
    ('game_affairs',    '1457189093594239147', 'Level 3 - Game Affairs'),
    ('fm_team_lead',    '1457215385139941456', 'Level 2 - FM Team Lead'),
    ('fm_team_guide',   '1457229857749729363', 'Level 1 - FM Team Guide'),
    ('fm_leadership',   '1457670376745074730', 'FM Leadership role (for pings)');

-- Views
CREATE VIEW IF NOT EXISTS v_staff_activity_30d AS
SELECT sl.logged_by AS name, COUNT(*) AS scene_count
FROM scene_logs sl WHERE sl.created_at >= datetime('now', '-30 days')
GROUP BY sl.logged_by ORDER BY scene_count DESC;

CREATE VIEW IF NOT EXISTS v_faction_scene_stats AS
SELECT f.id AS faction_id, f.name AS faction_name, COUNT(sl.id) AS all_time,
    SUM(CASE WHEN sl.created_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) AS scenes_30d
FROM factions f LEFT JOIN scene_logs sl ON sl.faction_id = f.id GROUP BY f.id, f.name;

CREATE VIEW IF NOT EXISTS v_server_analytics AS
SELECT (SELECT COUNT(*) FROM factions) AS total_factions,
    (SELECT COUNT(*) FROM properties) AS total_properties,
    (SELECT COUNT(*) FROM properties WHERE confiscated = 1) AS confiscated_assets,
    (SELECT COUNT(*) FROM tasks WHERE claimed_by = 'None') AS open_tasks;
CREATE TABLE IF NOT EXISTS announcement_log (
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
CREATE INDEX IF NOT EXISTS idx_announcement_log_created ON announcement_log(created_at);

CREATE TABLE IF NOT EXISTS announcement_deliveries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id       INTEGER NOT NULL REFERENCES announcement_log(id) ON DELETE CASCADE,
  faction_id   INTEGER,
  faction_name TEXT    NOT NULL DEFAULT '',
  channel_type TEXT    NOT NULL DEFAULT '',
  ok           INTEGER NOT NULL DEFAULT 0,
  error        TEXT             DEFAULT '',
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_announcement_deliveries_log ON announcement_deliveries(log_id);
