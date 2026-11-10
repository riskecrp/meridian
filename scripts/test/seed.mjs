// Seeds the throwaway DB with a small but broad data set: roles/channels, teams,
// staff at every clearance, sessions with KNOWN tokens, factions, members,
// properties, npcs, turfs, imports, scenes, tasks, reviews, docs, kb, etc.
import Database from 'better-sqlite3';
const db = new Database(process.argv[2]);
db.pragma('foreign_keys = ON');
const run = (sql, p = []) => db.prepare(sql).run(...p);

// ── Discord config ──
const roles = {
  fm_leadership: '900000000000000001', fm_team_lead: '900000000000000002', fm_team_guide: '900000000000000003',
  game_affairs: '900000000000000004', founder: '900000000000000005', executive_admin: '900000000000000006',
  event_team: '900000000000000007', lead_storyteller: '900000000000000008', lfm: '900000000000000009',
};
for (const [k, v] of Object.entries(roles)) run("INSERT INTO discord_roles (key, role_id, description) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET role_id = excluded.role_id", [k, v, k]);
const channels = { global_ping_channel: '800000000000000001', team_lead_channel: '800000000000000002', important_links: '800000000000000003' };
for (const [k, v] of Object.entries(channels)) run("INSERT INTO discord_config (key, channel_id, description) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET channel_id = excluded.channel_id", [k, v, k]);

// ── Teams ──
for (const [id, name, ch] of [['team_cup', 'Team Cup', '700000000000000001'], ['team_pumpkin', 'Team Pumpkin', '700000000000000002'], ['team_daxu', 'Team Daxu', '700000000000000003']])
  run("INSERT OR IGNORE INTO teams (team_id, team_name, channel_id) VALUES (?,?,?)", [id, name, ch]);

// ── Staff + sessions (tokens are the test contract) ──
const staff = [
  { id: 1, discord_id: '738214924760907907', name: 'Risk (owner)', team: 'team_cup', rank: 'Management', clearance: 3, token: 'tok-owner' },
  { id: 2, discord_id: '100000000000000003', name: 'Mgmt Three', team: 'team_pumpkin', rank: 'Management', clearance: 3, token: 'tok-l3' },
  { id: 3, discord_id: '100000000000000002', name: 'Lead Two', team: 'team_cup', rank: 'Team Lead', clearance: 2, token: 'tok-l2' },
  { id: 4, discord_id: '100000000000000001', name: 'Guide One', team: 'team_cup', rank: 'Guide', clearance: 1, token: 'tok-l1' },
  { id: 5, discord_id: '100000000000000009', name: 'Event Teamer', team: '', rank: 'Guide', clearance: 0, token: 'tok-et', event_team: 1 },
  { id: 6, discord_id: '100000000000000010', name: 'Story Lead', team: '', rank: 'Guide', clearance: 0, token: 'tok-lst', lead_storyteller: 1 },
  { id: 7, discord_id: 'placeholder_legacy_7', name: 'Legacy Placeholder', team: 'team_daxu', rank: 'Guide', clearance: 1 },
];
for (const s of staff) {
  const teamName = s.team ? db.prepare('SELECT team_name FROM teams WHERE team_id=?').get(s.team)?.team_name : '';
  run("INSERT INTO staff (id, discord_id, discord_name, display_name, team_id, team_name, rank, clearance, lead_storyteller) VALUES (?,?,?,?,?,?,?,?,?)",
    [s.id, s.discord_id, s.name.toLowerCase().replace(/\W+/g, ''), s.name, s.team || '', teamName || '', s.rank, s.clearance, s.lead_storyteller ? 1 : 0]);
  if (s.token) run("INSERT INTO sessions (staff_id, token, discord_id, discord_name, clearance, event_team, lead_storyteller, expires_at) VALUES (?,?,?,?,?,?,?, datetime('now','+3 days'))",
    [s.id, s.token, s.discord_id, s.name, s.clearance, s.event_team ? 1 : 0, s.lead_storyteller ? 1 : 0]);
}
run("INSERT INTO sessions (staff_id, token, discord_id, discord_name, clearance, expires_at) VALUES (4, 'tok-expired', '100000000000000001', 'Guide One', 1, datetime('now','-1 day'))");
run("INSERT INTO dashboard_access (discord_id, display_name, level, granted_by_name) VALUES ('100000000000000011', 'Granted Person', 2, 'Risk')");

// ── Factions ──
const factions = [
  { id: 1, name: 'The Vanguard', lead: '100000000000000002', tier: 2, thread: '600000000000000001', discord_url: 'https://discord.gg/vanguard' },
  { id: 2, name: 'Los Santos Kings', lead: '', tier: 1, thread: '600000000000000002' },
  { id: 3, name: 'Old Crew', lead: '', tier: 0, thread: '', archived: 1 },
  { id: 4, name: 'Harbor Syndicate', lead: '100000000000000003', tier: 3, thread: '600000000000000004', pending_promo: '4' },
];
for (const f of factions) run("INSERT INTO factions (id, name, lead_discord_id, tier, thread_id, discord_url, archived, archived_at, pending_promo, aliases) VALUES (?,?,?,?,?,?,?,?,?,?)",
  [f.id, f.name, f.lead, f.tier, f.thread, f.discord_url || '', f.archived || 0, f.archived ? '2026-01-01' : '', f.pending_promo || null, f.id === 1 ? 'Vanguard,TVG' : '']);
run("INSERT INTO faction_members (faction_id, character_name, phone, residence, is_leader) VALUES (1,'Marcus Vane','555-0100','12 Grove St',1),(1,'Lena Ortiz','555-0101','N/A',0),(2,'Tyrone King','555-0200','N/A',1),(4,'Ivan Petrov','555-0400','Pier 9',1)");
run("INSERT INTO properties (address, faction_id, property_type, is_hq, date_given, current_owner) VALUES ('12 Grove St',1,'HQ',1,'2026-05-01','Marcus Vane'),('44 Vespucci Blvd',1,'Property',0,'2026-06-01',''),('Pier 9 Warehouse',4,'HQ',1,'2026-04-01','Ivan Petrov')");
run("INSERT INTO properties (address, faction_id, property_type, confiscated, date_confiscated, confiscated_by) VALUES ('Old Mill',3,'Property',1,'2026-02-01','Risk')");
run("INSERT INTO turfs (name, shipment_power) VALUES ('Grove Street','High'),('Vespucci','Medium'),('Docks','High')");
run("INSERT INTO npcs (name, position, npc_type, turf, shipment_power, claimable) VALUES ('Big Smoke','123.4 -567.8 29.1','Dealer','Grove Street','High',1),('Dockmaster','-800.0 -3000.0 13.0','Fence','Docks','High',1),('Neutral Vendor','0 0 0','Vendor','Neutral','',0)");
run("INSERT INTO import_items (name, tier, category, lore_specific, pkg, price, import_time, shipment_power) VALUES ('Pistol Crate','1','Weapons','No','A','$5,000','24h','Low'),('SMG Crate','2','Weapons','No','B','$12,000','48h','Medium'),('Armor Pack','1','Gear','No','A','$2,000','12h','Low')");
run("INSERT INTO faction_imports (faction_id, item_id, permitted) VALUES (1,1,1),(1,2,1),(2,1,1)");
run("INSERT INTO scene_logs (date, faction_id, rewards, logged_by, notes, author_id, created_at) VALUES ('01/NOV/2026',1,'None','Guide One','Drug deal gone wrong','100000000000000001', datetime('now','-5 days')),('05/NOV/2026',1,'$2000','Lead Two','Turf war','100000000000000002', datetime('now','-2 days')),('03/NOV/2026',2,'None','Guide One','Recruitment scene','100000000000000001', datetime('now','-3 days'))");
run("INSERT INTO scene_assistants (scene_id, staff_id, staff_name, added_by_id, added_by_name) VALUES (1,'100000000000000002','Lead Two','100000000000000002','Lead Two')");
run("INSERT INTO intel_notes (faction_id, text, author, author_id, date) VALUES (1,'Rumoured to be moving weapons via the docks','Guide One','100000000000000001','01/NOV/2026')");
run("INSERT INTO ooc_notes (faction_id, date, author, author_id, text, meeting_type, duration_hours, attendees_json, target_type, target_key, target_label) VALUES (1,'02/NOV/2026','Lead Two','100000000000000002','Met leader re: expectations','general',1.0,'[\"100000000000000002\"]','faction','1','The Vanguard')");
run("INSERT INTO faction_history (faction_id, faction_name, action_type, details, authorized_by) VALUES (1,'The Vanguard','PROMOTION','Tier 1 -> 2','Risk'),(3,'Old Crew','ARCHIVED','Disbanded','Risk')");
run("INSERT INTO faction_reviews (faction_id, review_month, recommendation, feedback, submitted_by, submitted_by_id, team_id, team_name, faction_name, status) VALUES (1,'2026-10','Promote','Strong month','Lead Two','100000000000000002','team_cup','Team Cup','The Vanguard','Pending Discussion'),(2,'2026-10','Hold','Quiet','Lead Two','100000000000000002','team_cup','Team Cup','Los Santos Kings','Pending Discussion')");
run("INSERT INTO leadership_personal_notes (faction_id, faction_name, author_id, author_name, review_month, note) VALUES (1,'The Vanguard','100000000000000003','Mgmt Three','2026-10','Keep an eye on weapons')");
run("INSERT INTO leadership_meeting_notes (title, meeting_type, team_id, team_name, content, attendees, meeting_date, created_by, created_by_id) VALUES ('Weekly sync','General','team_cup','Team Cup','<p>Notes</p>','Risk, Lead Two','2026-11-01','Risk','738214924760907907')");
run("INSERT INTO pending_executions (date, faction_id, execution_type, turf, old_value, new_value, requested_by, status, requester_id, rp_note) VALUES ('06/NOV/2026',1,'NPC','Grove Street','Big Smoke','Big Smoke (relocated)','Lead Two','PENDING','100000000000000002','Scene planned'),('01/NOV/2026',2,'HQ','N/A','N/A','New HQ at 9 Alta St','Lead Two','APPROVED','100000000000000002','')");

// ── Tasks / reminders ──
run("INSERT INTO tasks (task_uid, description, target_id, target_type, claimed_by, created_by_id, created_by_name, notify_creator) VALUES ('t1001','Update Vanguard HQ notes','900000000000000003','Role','None','100000000000000003','Mgmt Three',1),('t1002','Chase LSK leader','100000000000000001','User','100000000000000001','100000000000000002','Lead Two',0),('t1003','Leadership-only item','900000000000000001','Role','None','738214924760907907','Risk (owner)',1)");
run("INSERT INTO task_log (action, actor, task_uid, description, target) VALUES ('CREATED','Mgmt Three','t1001','Update Vanguard HQ notes','Role')");
run("INSERT INTO task_questions (task_uid, asked_by_id, asked_by_name, question, asked_at) VALUES ('t1001','100000000000000001','Guide One','Which notes exactly?', datetime('now'))");
run("INSERT INTO reminders (uuid, author_id, channel_id, message, epoch_ms, readable_time, repeat_rule, target_tag, status) VALUES ('rem001','100000000000000002','800000000000000001','Review meeting', ?, '2026-12-01T18:00:00Z','None','<@&900000000000000002>','ACTIVE')", [String(Date.now() + 86400000 * 20)]);
run("INSERT INTO recurring_reminders (title, body, links, target_type, target_id, channel_id, ping_day, due_day, created_by_id, created_by_name) VALUES ('Monthly reviews','Submit reviews','https://ecrpfm.com/fm/leadership/reviews','Role','900000000000000002','800000000000000001',1,10,'738214924760907907','Risk')");

// ── Comms / inbox ──
run("INSERT INTO faction_public_messages (faction_id, faction_name, author_name, author_id, message, is_pinned) VALUES (1,'The Vanguard','Risk','738214924760907907','Welcome aboard',1)");
run("INSERT INTO faction_ic_contacts (faction_id, faction_name, sender_name, contact_type, message, status) VALUES (1,'The Vanguard','Marcus Vane','IC','We want a meeting','pending_discussion')");
run("INSERT INTO faction_ic_messages (faction_id, faction_name, author_name, author_id, link, message) VALUES (1,'The Vanguard','Risk','738214924760907907','https://discord.com/channels/1/2/3','Sent IC memo')");
run("INSERT INTO announcement_log (kind, author_id, author_name, channel_type, message, sent_count, total_count) VALUES ('announcement','738214924760907907','Risk','command','Server rules updated',2,2)");
run("INSERT INTO mentions (message_id, target_user_id, channel_id, channel_name, author_id, author_name, content, guild_id, guild_name, created_at) VALUES ('m1','738214924760907907','800000000000000001','general','100000000000000001','Guide One','hey <@738214924760907907>','1457188814916423855','FM', datetime('now'))");
run("INSERT INTO role_mentions (message_id, channel_id, channel_name, author_id, author_name, content, guild_id, guild_name, created_at) VALUES ('m2','800000000000000001','general','100000000000000001','Guide One','<@&900000000000000001> help','1457188814916423855','FM', datetime('now'))");
run("INSERT INTO forwarded_dms (message_id, author_id, author_name, content, source_channel, target_user_id) VALUES ('m3','100000000000000005','Random Player','I need help','DM','738214924760907907')");
run("INSERT INTO bot_server_configs (guild_id, guild_name, faction_id, watch_role_id, watch_role_name) VALUES ('500000000000000001','Vanguard Discord',1,'510000000000000001','Vanguard Leadership')");
run("INSERT INTO bot_watch_roles (config_id, role_id, role_name) VALUES (1,'510000000000000001','Vanguard Leadership')");
run("INSERT INTO watch_role_mentions (message_id, config_id, watch_role_id, watch_role_name, channel_id, channel_name, author_id, author_name, content, guild_id, guild_name, created_at) VALUES ('m4',1,'510000000000000001','Vanguard Leadership','520000000000000001','chat','100000000000000005','Random Player','<@&510000000000000001> yo','500000000000000001','Vanguard Discord', datetime('now'))");

// ── Records / storytelling / library ──
run("INSERT INTO documents (title, category, content, created_by, created_by_id, level_required) VALUES ('Scene Logging SOP','SOP','<p>How to log a scene</p>','Risk','738214924760907907',1),('Leadership Only Doc','Policy','<p>Secret</p>','Risk','738214924760907907',3)");
run("INSERT INTO knowledge_base (category, title, content, added_by, entry_type) VALUES ('Lore','The Docks','Long history','Risk','lore'),('Mechanics','Import tiers','Tier rules','Risk','mechanic')");
run("INSERT INTO change_log (change_type, name, position, action, blocked_off, notes, created_by, created_by_id) VALUES ('drop_location','Drop A','100 200 30','added',0,'','Risk','738214924760907907'),('doctor','Doc Brown','300 400 30','added',0,'','Risk','738214924760907907')");
run("INSERT INTO spawn_items (category, name, game_id, item_type, extra) VALUES ('Weapons','Pistol','WEAPON_PISTOL','weapon',''),('Vehicles','Sultan','sultan','vehicle','')");
run("INSERT INTO weapon_ammo (weapon_name, weapon_category, caliber) VALUES ('Pistol','Handgun','9mm'),('Carbine Rifle','Rifle','5.56')");
run("INSERT INTO weapon_ammo_compat (weapon_id, ammo_name, ammo_type) VALUES (1,'9mm Standard','Standard'),(2,'5.56 Standard','Standard')");
run("INSERT INTO weapon_attachments (weapon_id, attachment_name) VALUES (1,'Suppressor'),(2,'Scope')");
run("INSERT INTO scene_library (title, status, category, description, staff_required, spawning_required, ped_required, proposed_rewards, tags, created_by, created_by_id) VALUES ('Warehouse raid','idea','Action','A raid',2,1,1,'$5k','raid,action','Guide One','100000000000000001'),('Approved heist','approved','Action','Heist',3,1,0,'','heist','Risk','738214924760907907')");
run("INSERT INTO scene_library_feedback (scene_id, feedback, created_by, created_by_id) VALUES (1,'Needs more detail','Mgmt Three','100000000000000003')");
run("INSERT INTO inventory_stock (name, category, starting_stock, current_stock, threshold, purchaseable) VALUES ('Lockpick','Tools',100,20,25,1),('Burner Phone','Tools',50,50,10,1)");
run("INSERT INTO inventory_logs (date, item_name, quantity, distributed_by) VALUES ('01/NOV/2026','Lockpick',5,'Risk')");
run("INSERT INTO treasury_logs (date, faction_name, amount, distributed_by) VALUES ('01/NOV/2026','The Vanguard',5000,'Risk')");
run("INSERT INTO faction_fleet_config (faction_id, max_types, max_total, max_garages) VALUES (1,3,6,2)");
run("INSERT INTO faction_fleet_vehicles (faction_id, vehicle_name, quantity, created_by, spawn_name) VALUES (1,'Sultan',2,'Risk','sultan')");
run("INSERT INTO faction_fleet_garages (faction_id, name, x, y, z, created_by) VALUES (1,'Grove garage',123.0,-567.0,29.0,'Risk')");
run("INSERT INTO fleet_vehicle_catalog (vehicle_name, use_count, spawn_name) VALUES ('Sultan',1,'sultan'),('Kuruma',0,'kuruma')");
run("INSERT INTO fm_character_links (discord_id, character_name, category) VALUES ('100000000000000001','Johnny Guide','')");
run("INSERT INTO fm_hours_log (discord_id, period, hours) VALUES ('100000000000000001','2026-10',12.5),('100000000000000002','2026-10',20)");
run("INSERT INTO staff_coi (discord_id, faction_name, source) VALUES ('100000000000000001','The Vanguard','manual')");
run("INSERT INTO site_audit_log (actor_id, actor_name, action, target_type, target_id, target_label, details) VALUES ('738214924760907907','Risk','LOGIN','session','','Risk','Level 3 login')");
run("INSERT INTO faction_feedback (sheet_row, faction, character_name, discord_username, occurred, submitted_at, payload, thread_id, status) VALUES (2,'The Vanguard','Marcus Vane','marcus#1','2026-10-30','2026-10-31 10:00:00','{\"Faction\":\"The Vanguard\",\"What happened?\":\"Great scene\"}','610000000000000001','new')");
run("INSERT INTO form_submissions (form_key, sheet_row, title, contact, submitted_at, payload, thread_id, status) VALUES ('rcf_application',2,'New Faction · Jane','jane#1','2026-11-01 10:00:00','{\"Faction name\":\"New Faction\"}','610000000000000002','new')");
run("INSERT INTO conversation_sync_channels (channel_id, name, sort) VALUES ('800000000000000001','general',1)");
run("INSERT INTO discord_messages (message_id, channel_id, channel_name, author_id, author_name, content, created_at) VALUES ('dm1','800000000000000001','general','100000000000000001','Guide One','hello team', datetime('now'))");
run("INSERT INTO member_join_leave_logs (guild_id, guild_name, user_id, username, display_name, event) VALUES ('500000000000000001','Vanguard Discord','100000000000000005','randomplayer','Random Player','join')");
run("INSERT INTO deleted_message_logs (message_id, guild_id, guild_name, channel_id, channel_name, author_id, author_name, content, had_content) VALUES ('d1','500000000000000001','Vanguard Discord','520000000000000001','chat','100000000000000005','randomplayer','oops',1)");
run("INSERT INTO edited_message_logs (message_id, guild_id, guild_name, channel_id, channel_name, author_id, author_name, content_before, content_after) VALUES ('e1','500000000000000001','Vanguard Discord','520000000000000001','chat','100000000000000005','randomplayer','helo','hello')");
run("INSERT INTO server_log_keywords (phrase) VALUES ('meridian')");
run("INSERT INTO keyword_alerts (keyword, message_id, guild_id, guild_name, channel_id, channel_name, author_id, author_name, content) VALUES ('meridian','k1','500000000000000001','Vanguard Discord','520000000000000001','chat','100000000000000005','randomplayer','meridian is watching')");
run("INSERT INTO managed_forum_posts (key, channel_id, title, content_json) VALUES ('important_links','800000000000000003','Important Links','[{\"heading\":\"Links\",\"type\":\"links\",\"links\":[{\"label\":\"Dashboard\",\"url\":\"https://ecrpfm.com\"}]}]')");
run("INSERT INTO mdb_access_roles (role_id, role_name) VALUES ('900000000000000003','FM Guide')");
run("INSERT INTO pipedown_items (name, category, price, is_offmenu, faction_id, sort_order) VALUES ('Cohiba','Cigar',500,0,NULL,1),('Red Label','Cigar',900,1,1,2),('Whiskey','Beverage',120,0,NULL,3)");
run("INSERT INTO auto_delete_channels (channel_id, channel_name, delay_seconds, added_by_name) VALUES ('800000000000000009','bot-spam',30,'Risk')");
run("INSERT INTO channel_purge_schedules (channel_id, channel_name, interval_hours, added_by_name) VALUES ('800000000000000010','daily-purge',24,'Risk')");
console.log('seeded. staff:', db.prepare('select count(*) c from staff').get().c, 'factions:', db.prepare('select count(*) c from factions').get().c);
db.close();
