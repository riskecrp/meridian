// Bot background jobs with cron/timers stubbed: reminder ticks, housekeeping,
// purges, recurring reminders, forum/conversation sync, staff role sync,
// promotion review + polls, and the Google Sheets intakes (feedback + forms).
import { ok, eq, pass, captureDiscord } from '../lib.mjs';
import { query, queryOne, run } from '../../../shared/db.js';
import { fakeClient, fakeMessage, IDS, ROLES } from '../harness/discord-fakes.mjs';
import cron from '../../../bot/node_modules/node-cron/dist/node-cron.js';
import { Collection } from '../../../bot/node_modules/discord.js/src/index.js';
process.env.BASE_URL = 'http://localhost:3000'; process.env.DISCORD_CLIENT_ID = '111111111111111111';
process.env.SHEET_FEEDBACK_ID = 'sheet-feedback'; process.env.SHEET_FEEDBACK_GID = '7';
for (const k of ['RCF_APPLICATION', 'STAFF_APPLICATION', 'GARAGE_REQUEST', 'CI_APPLICATION']) process.env[`SHEET_${k}_ID`] = `sheet-${k.toLowerCase()}`;
delete process.env.OPENAI_API_KEY; delete process.env.GOOGLE_SHEETS_API_KEY;
const crons = []; cron.schedule = (expr, fn, opts) => { crons.push({ expr, fn, opts }); return { stop() {} }; };
const timers = []; const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms) => { if (ms >= 5000) { timers.push({ ms, fn }); return 0; } return realSetTimeout(fn, ms); };
globalThis.setInterval = (fn, ms) => { timers.push({ kind: 'interval', ms, fn }); return 0; };
let plan = null; const log = captureDiscord((e) => (typeof plan === 'function' ? plan(e) : plan));
const quiet = () => { const errs = []; const orig = { log: console.log, error: console.error, warn: console.warn }; console.log = console.error = console.warn = (...a) => errs.push(a.join(' ')); return () => Object.assign(console, orig); };
const sync = (job) => queryOne('SELECT last_detail, last_error, consecutive_failures, runs FROM sync_status WHERE job=?', [job]);
let unq = quiet(); const section = (label) => { unq(); pass(label); unq = quiet(); };   // the jobs narrate on console; keep only our markers

// ── scheduler: reminders ──
const { reminderTick, pruneExpiredSessions, startHousekeeping, startChannelPurge, startReminderPurge } = await import('../../../bot/scheduler.js');
const now = Date.now(); run('DELETE FROM reminders');
run("INSERT INTO reminders (uuid, author_id, channel_id, message, epoch_ms, readable_time, repeat_rule, target_tag, status, created_at) VALUES ('warn1','1','800000000000000001','Warn me', ?, '', 'None', '<@1>', 'ACTIVE', datetime('now','-2 hours')),('quick','1','800000000000000001','Created inside window', ?, '', 'None', '<@1>', 'ACTIVE', datetime('now')),('due1','1','800000000000000001','Due now', ?, '', 'None', '<@1>', 'WARNED', datetime('now','-1 day')),('rep1','1','800000000000000001','Daily', ?, '', '1D', '<@1>', 'ACTIVE', datetime('now','-1 day')),('badch','1','999','No channel', ?, '', 'None', '<@1>', 'ACTIVE', datetime('now','-1 day')),('flaky','1','800000000000000002','Send throws', ?, '', 'None', '<@1>', 'ACTIVE', datetime('now','-1 day')),('old','1','800000000000000002','Too old', ?, '', 'None', '<@1>', 'ACTIVE', datetime('now','-3 days'))",
  [String(now + 10 * 60000), String(now + 10 * 60000), String(now - 1000), String(now - 1000), String(now - 1000), String(now - 1000), String(now - 2 * 86400000)]);
const client = fakeClient({ channels: { '800000000000000001': { name: 'reminders' }, '800000000000000002': { name: 'broken' } } });
const origFetch = client.channels.fetch; client.channels.fetch = async (id) => { const c = await origFetch(id); if (id === '800000000000000002') c.send = async () => { throw new Error('Missing Access'); }; return c; };
{ const r = await reminderTick(client); const rows = Object.fromEntries(query('SELECT uuid, status FROM reminders').map(x => [x.uuid, x.status]));
  ok(r.fired === 2 && r.warned === 1 && r.failed === 2 && r.held === 0 && r.errors.length === 3, 'tick: 2 fired, 1 warned, 2 failed'); ok(client.sent.filter(s => /Due Now/.test(s.embeds?.[0]?.data?.title)).length === 2 && client.sent.some(s => /30 Minute Warning/.test(s.embeds?.[0]?.data?.title)), 'due + warning embeds sent');
  eq(JSON.stringify(rows), JSON.stringify({ warn1: 'WARNED', quick: 'WARNED', rep1: 'ACTIVE', badch: 'FAILED', flaky: 'ACTIVE', old: 'FAILED' }), 'due deleted, repeat re-armed, bad channel FAILED, flaky kept for retry, too old FAILED'); ok(sync('reminders').consecutive_failures === 1 && /Missing Access/.test(sync('reminders').last_error), 'sync_status records the errors'); }
client.sent.length = 0; { const r = await reminderTick(client); ok(r.fired === 0 && r.warned === 0 && r.failed === 0 && r.errors.length === 1 && client.sent.length === 0 && queryOne("SELECT status FROM reminders WHERE uuid='flaky'").status === 'ACTIVE', 'second tick: flaky retried, nothing re-fired'); }
run("UPDATE ping_routes SET enabled=0 WHERE key='reminder.due'"); run("INSERT INTO reminders (uuid, author_id, channel_id, message, epoch_ms, readable_time, repeat_rule, target_tag, status) VALUES ('due2','1','800000000000000001','Due2', ?, '', 'None', '<@1>', 'ACTIVE')", [String(Date.now() - 1)]); run("DELETE FROM reminders WHERE uuid='flaky'"); client.sent.length = 0;
{ const r = await reminderTick(client); run("UPDATE ping_routes SET enabled=1 WHERE key='reminder.due'"); ok(r.held === 1 && r.fired === 0 && client.sent.length === 0 && !!queryOne("SELECT 1 FROM reminders WHERE uuid='due2'") && /held 1 \(reminder.due muted\)/.test(sync('reminders').last_detail), 'muted due route holds the row'); }
{ const before = query('SELECT token FROM sessions').length; const n = pruneExpiredSessions(); startHousekeeping(); timers.find(x => x.ms === 20000).fn(); ok(n === 1 && query('SELECT token FROM sessions').length === before - 1 && !queryOne("SELECT 1 FROM sessions WHERE token='tok-expired'") && sync('housekeeping').runs === 1, 'prune removes only the expired session; housekeeping records sync'); }
crons.length = 0; timers.length = 0; run("INSERT INTO channel_purge_schedules (channel_id, channel_name, interval_hours) VALUES ('800000000000000005','p',24)"); run("INSERT INTO reminder_purge_channels (channel_id) VALUES ('800000000000000007')");
{ const pc = fakeClient({ channels: { '800000000000000005': { name: 'p', messages: () => [] }, '800000000000000007': { name: 'r', messages: () => [] } } }); await startChannelPurge(pc); await startReminderPurge(pc); await crons[0].fn(); await crons[1].fn();
  ok(/cannot fetch 800000000000000010/.test(sync('channel_purge').last_error) && sync('channel_purge').consecutive_failures === 1, 'channel purge records the unreachable seed channel'); ok(/0 message\(s\) deleted across 1 channel\(s\)/.test(sync('reminder_purge').last_detail), 'reminder purge records ok'); } section('scheduler');

// ── recurring reminders ──
const { fireReminderDefinition, checkRecurringReminders } = await import('../../../bot/recurringReminders.js');
const def = queryOne('SELECT * FROM recurring_reminders WHERE id=1'); const rclient = fakeClient({ channels: { '800000000000000001': { name: 'reminders' } } });
{ const r = await fireReminderDefinition(rclient, def, 2026, 11); ok(r.ok && r.recipientsCount === 1 && r.sent && JSON.stringify(query('SELECT recipient_name FROM recurring_reminder_instances WHERE reminder_id=1').map(x => x.recipient_name)) === '["Lead Two"]' && /dashboard: http:\/\/localhost:3000\//.test(rclient.sent[0].embeds[0].description), 'team-lead role → Lead Two only, instance after send, dashboard link'); }
eq((await fireReminderDefinition(rclient, def, 2026, 11)).reason, 'already_fired_this_month', 'fire twice');
{ const a = await fireReminderDefinition(rclient, { ...def, id: 78, target_id: ROLES.fm_team_guide }, 2026, 12); await fireReminderDefinition(rclient, { ...def, id: 77, target_id: ROLES.fm_leadership }, 2026, 12);
  eq(a.recipientsCount, 4, 'guide role → clearance >= 1 only (no ET/LST/placeholder)'); eq(JSON.stringify(query('SELECT recipient_name FROM recurring_reminder_instances WHERE reminder_id=77 ORDER BY recipient_name').map(x => x.recipient_name)), '["Mgmt Three","Risk (owner)"]', 'leadership role → L3s'); }
{ const d = { ...def, id: 82, channel_id: '000' }; const r = await fireReminderDefinition(rclient, d, 2026, 12); ok(!r.ok && /Unknown Channel 000/.test(r.error) && query('SELECT 1 FROM recurring_reminder_instances WHERE reminder_id=82').length === 0, 'bad channel → ok:false and no instances'); ok((await fireReminderDefinition(rclient, { ...d, channel_id: '800000000000000001' }, 2026, 12)).sent, 'retries once the channel is fixed'); }
{ run("UPDATE ping_routes SET enabled=0 WHERE key='reminder.recurring'"); run('UPDATE recurring_reminders SET ping_day=? WHERE id=1', [new Date().getUTCDate()]); run('DELETE FROM recurring_reminder_instances WHERE reminder_id=1');
  const RealDate = Date; globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [RealDate.UTC(2026, 10, new RealDate().getUTCDate(), 19, 0, 0)])); } static now() { return new RealDate().getTime(); } };
  await checkRecurringReminders(rclient); const s1 = sync('recurring_reminders'); run("UPDATE ping_routes SET enabled=1 WHERE key='reminder.recurring'"); await checkRecurringReminders(rclient); globalThis.Date = RealDate;
  ok(/Route disabled/.test(s1.last_error) && s1.consecutive_failures === 1, 'disabled route recorded as a failure'); ok(/1 sent now/.test(sync('recurring_reminders').last_detail) && query('SELECT 1 FROM recurring_reminder_instances WHERE reminder_id=1').length === 1, 'sends once re-enabled'); } section('recurring reminders');

// ── forum / conversation sync ──
const { syncForumPosts } = await import('../../../bot/forumSync.js');
run("UPDATE ping_routes SET enabled=0 WHERE key='forum.sync.source'"); await syncForumPosts(fakeClient({})); ok(/route forum.sync.source is disabled/.test(sync('forum_sync').last_error), 'forum sync: disabled route');
run("UPDATE ping_routes SET enabled=1 WHERE key='forum.sync.source'"); await syncForumPosts(fakeClient({})); ok(/cannot fetch channel/.test(sync('forum_sync').last_error) && sync('forum_sync').consecutive_failures === 2, 'forum sync: unreachable channel');
{ const fc = fakeClient({}); fc.channels.fetch = async () => ({ messages: { fetch: async () => new Collection([['1', fakeMessage({ id: '1', content: 'New forum post: The Vanguard - hi' })]]) } }); await syncForumPosts(fc); ok(sync('forum_sync').consecutive_failures === 0 && queryOne('SELECT forum_posts_30d FROM factions WHERE id=1').forum_posts_30d > 0, 'forum sync: matched post counted'); }
const { syncConversations } = await import('../../../bot/conversationSync.js');
run("INSERT OR IGNORE INTO conversation_sync_channels (channel_id, name, enabled) VALUES ('800000000000000011','team-x',1)"); await syncConversations(fakeClient({})); ok(/unreachable: team-x/.test(sync('conversation_sync').last_error), 'conversation sync: unreachable channels recorded'); section('forum / conversation sync');

// ── staff sync ──
const { syncStaffFromRoles, retireStaffOnLeave } = await import('../../../bot/lib/staffSync.js');
const member = (id, roles, name = 'New Person') => ({ user: { id, username: name.toLowerCase().replace(/\W/g, ''), globalName: name }, nickname: null, roles: { cache: new Map(roles.map(r => [r, {}])) } });
const st = (id) => queryOne('SELECT rank, clearance, active FROM staff WHERE discord_id=?', [id]);
{ const id = '100000000000000050';
  eq(syncStaffFromRoles(member(id, [ROLES.fm_team_guide]), { addedRoles: [ROLES.fm_team_guide] }).action, 'added', 'base role → added'); eq(JSON.stringify(st(id)), '{"rank":"Guide","clearance":1,"active":1}', 'Guide L1');
  syncStaffFromRoles(member(id, [ROLES.fm_team_guide, ROLES.fm_team_lead]), { addedRoles: [ROLES.fm_team_lead] }); eq(JSON.stringify(st(id)), '{"rank":"Team Lead","clearance":2,"active":1}', '+team lead → L2');
  syncStaffFromRoles(member(id, [ROLES.fm_team_guide, ROLES.fm_team_lead, ROLES.fm_leadership]), { addedRoles: [ROLES.fm_leadership] }); eq(st(id).clearance, 3, '+leadership → L3');
  syncStaffFromRoles(member(id, [ROLES.fm_team_guide, ROLES.fm_team_lead]), { removedRoles: [ROLES.fm_leadership] }); eq(st(id).clearance, 2, '-leadership → L2');
  eq(syncStaffFromRoles(member(id, [ROLES.fm_team_guide, ROLES.fm_team_lead]), { addedRoles: ['123'] }).changed, false, 'unrelated role → no change');
  eq(syncStaffFromRoles(member(id, [ROLES.fm_team_lead]), { removedRoles: [ROLES.fm_team_guide] }).action, 'retired', '-base role → retired'); eq(st(id).active, 0, 'inactive');
  eq(syncStaffFromRoles(member(id, [ROLES.fm_team_guide, ROLES.fm_team_lead]), { addedRoles: [ROLES.fm_team_guide] }).action, 'reactivated', 're-add → reactivated'); ok(st(id).active === 1 && st(id).clearance === 2 && query('SELECT 1 FROM staff WHERE discord_id=?', [id]).length === 1, 'one row, L2 again');
  ok(retireStaffOnLeave(id, 'New Person') === true && st(id).active === 0 && /left the FM Discord/.test(queryOne("SELECT details FROM site_audit_log WHERE target_type='staff' ORDER BY id DESC LIMIT 1").details), 'leave → retired + audited'); } section('staff sync');

// ── promotion review ──
const { runPromotionReview, processClosedPolls, tallyMonth } = await import('../../../bot/promotionReview.js');
const month = new Date().toISOString().slice(0, 7); run('DELETE FROM leadership_personal_notes');
run("INSERT INTO leadership_personal_notes (faction_id, faction_name, author_id, author_name, review_month, note, status) VALUES (1,'The Vanguard','100000000000000003','Mgmt Three',?,'go','Confirmed Promote'),(1,'The Vanguard','738214924760907907','Risk',?,'go','Confirmed Promote'),(1,'The Vanguard','232331558676070401','Other',?,'meh','Confirmed Hold'),(2,'Los Santos Kings','100000000000000003','Mgmt Three',?,'x','Confirmed Promote'),(2,'Los Santos Kings','738214924760907907','Risk',?,'x','Confirmed Hold'),(4,'Harbor Syndicate','100000000000000003','Mgmt Three',?,'bad','Confirmed Demote'),(4,'Harbor Syndicate','738214924760907907','Risk',?,'','')", [month, month, month, month, month, month, month]);
run("INSERT INTO import_items (name, tier, category) VALUES ('Pistol .50','3','Pistol Medium'),('Micro SMG','3','SMG'),('Combat MG','3','MG')"); run("INSERT INTO faction_imports (faction_id, item_id, permitted) VALUES (1, (SELECT id FROM import_items WHERE name='Combat MG'), 1)");
{ const t = tallyMonth(month); ok(t[1].votes === 3 && t[1].status === 'Confirmed Promote' && t[2].status === 'Pending Discussion' && t[4].votes === 1 && t[4].status === 'Confirmed Demote', 'tally: blank note not a vote, majority / split / demote'); }
plan = (e) => e.url.includes('/threads') ? { json: { id: 'thread1' } } : { json: { id: 'msg' + Math.random().toString(36).slice(2, 6) } };
{ const r = await runPromotionReview(null); ok(r.ok && r.promote.map(f => f.name).join() === 'The Vanguard' && r.demote.map(f => f.name).join() === 'Harbor Syndicate' && r.discuss.map(f => f.name).join() === 'Los Santos Kings' && r.polls === 2, 'review buckets + 2 polls (MG excluded)');
  eq(JSON.stringify(query('SELECT faction_id, status FROM faction_reviews WHERE review_month=? ORDER BY faction_id', [month])), JSON.stringify([{ faction_id: 1, status: 'Confirmed Promote' }, { faction_id: 2, status: 'Pending Discussion' }, { faction_id: 4, status: 'Confirmed Demote' }]), 'derived statuses written');
  const t = query("SELECT target_id, created_by_id, created_by_name, status, created_at FROM tasks WHERE created_by_id='bot'"); ok(t.length === 1 && t[0].target_id === ROLES.fm_leadership && t[0].created_by_name === 'Meridian' && t[0].status === 'open' && /^\d{4}-\d\d-\d\dT/.test(t[0].created_at) && r.tasks[0].kind === 'demote' && !r.tasks[0].existing, 'demote task via shared createTask');
  eq(query('SELECT category FROM promotion_polls ORDER BY category').map(x => x.category).join(), 'Pistol Medium,SMG', 'polls per weapon category'); }
{ const r = await runPromotionReview(null); ok(r.alreadyReviewed && r.tasks[0].existing && query('SELECT 1 FROM promotion_polls').length === 2 && query("SELECT 1 FROM tasks WHERE created_by_id='bot'").length === 1 && /already reviewed/.test(sync('promotion_review').last_detail), 'second run: no duplicate thread/polls/tasks'); }
run("UPDATE promotion_polls SET created_at = datetime('now','-49 hours')");
plan = () => ({ json: { poll: { expiry: new Date(Date.now() + 3600000).toISOString(), results: { is_finalized: false, answer_counts: [] }, answers: [] } } }); { const a = await processClosedPolls(); ok(a.ok && a.processed === 0, 'unfinalised polls untouched'); }
{ let n = 0; plan = (e) => (e.method === 'GET' && n++ === 0) ? { status: 500, json: { message: 'boom' } } : { json: { id: 'x', poll: { expiry: new Date(Date.now() - 3600000).toISOString(), results: { is_finalized: true, answer_counts: [{ id: 1, count: 2 }] }, answers: [{ answer_id: 1, poll_media: { text: 'Pistol .50' } }] } } };
  const b = await processClosedPolls(); ok(!b.ok && b.processed === 0 && /500/.test(b.errors[0]) && /will retry/.test(b.errors[0]) && sync('promotion_polls').consecutive_failures === 1, 'one GET failure → retried later, recorded');
  const c = await processClosedPolls(); ok(c.ok && c.processed === 1 && query('SELECT processed FROM promotion_polls').every(p => p.processed === 1), 'finalised → processed'); ok(/Stage Promotion to Tier 3/.test(queryOne("SELECT description FROM tasks WHERE created_by_id='bot' ORDER BY id DESC LIMIT 1").description), 'promotion task raised'); eq((await processClosedPolls()).processed, 0, 'nothing left'); } section('promotion review');

// ── sheet intakes ──
const { pollSheet } = await import('../../../bot/factionFeedback.js'); const { pollForm, FORMS } = await import('../../../bot/formSubmissions.js'); const { fetchSheetRows } = await import('../../../bot/lib/formIntake.js');
const csv = (rows) => rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
let sheet = [['Timestamp', 'Which team is this for?', 'Faction', 'Character name', 'Your Discord', 'When did this occur?', 'What happened?', 'This form is for feedback'], ['2026-11-01 10:00', 'Criminal Faction Management (FM)', 'The Vanguard', 'Old Row', 'old#1', 'last week', 'ancient history', 'yes']];
const sheetPlan = (discord = null) => (e) => e.url.includes('docs.google.com') ? { text: csv(sheet), json: {} } : e.url.includes('sheets.googleapis.com') ? { status: 403, json: {} } : discord || (e.url.includes('/threads') ? { json: { id: 'th' + Math.random().toString(36).slice(2, 6) } } : { json: { id: 'm' + Math.random().toString(36).slice(2, 6) } });
plan = sheetPlan();
await pollSheet(); ok(/initialised at sheet row 1; no backfill/.test(sync('feedback_poll').last_detail) && queryOne("SELECT count(*) n FROM sheet_rows_seen WHERE source='feedback'").n === 1, 'feedback init marks history, no backfill');
sheet.push(['2026-11-10 12:00', 'Legal Faction Management (LFM)', 'Cops', 'X', 'x#1', 'today', 'not ours', 'yes']); sheet.push(['2026-11-10 13:00', 'Criminal Faction Management (FM)', 'Los Santos Kings', 'Tyrone', 'ty#1', 'yesterday', 'He did a thing <@&1>', 'yes']);
await pollSheet(); { const rows = query('SELECT sheet_row, faction, character_name, discord_username, occurred, row_key FROM faction_feedback'); ok(/1 new submission/.test(sync('feedback_poll').last_detail) && rows.length === 2 && rows[1].sheet_row === 4 && rows[1].faction === 'Los Santos Kings' && rows[1].character_name === 'Tyrone' && rows[1].row_key, 'only the FM row posts, fields by header, row_key stored'); }
sheet.splice(1, 1); await pollSheet(); ok(/nothing new/.test(sync('feedback_poll').last_detail), 'deleted row shifts positions: nothing re-posted');
sheet.push(['2026-11-10 14:00', 'Criminal Faction Management (FM)', 'Harbor Syndicate', 'Marcus', 'mv#1', 'today', 'another thing', 'yes']); await pollSheet(); ok(/1 new submission/.test(sync('feedback_poll').last_detail) && query('SELECT 1 FROM faction_feedback').length === 3, 'a new row at an old position still posts');
sheet = sheet.map((r, i) => [r[0], r[1], i === 0 ? 'Server region?' : 'EU', ...r.slice(2)]); sheet.push(['2026-11-10 15:00', 'Criminal Faction Management (FM)', 'NA', 'The Vanguard', 'Dee', 'dee#1', 'today', 'thing', 'yes']); await pollSheet();
{ const last = queryOne('SELECT faction, character_name, discord_username FROM faction_feedback ORDER BY id DESC LIMIT 1'); ok(/1 new submission/.test(sync('feedback_poll').last_detail) && last.faction === 'The Vanguard' && last.character_name === 'Dee', 'inserted column: old rows not re-posted, new row mapped by header'); }
sheet.push(['2026-11-10 16:00', 'Criminal Faction Management (FM)', 'NA', 'The Vanguard', 'Fail', 'f#1', 'today', 'thing', 'yes']); plan = sheetPlan({ status: 500, json: { message: 'down' } });
{ const fails = []; for (let i = 0; i < 3; i++) { await pollSheet(); fails.push(sync('feedback_poll')); } ok(/attempt 1\/3/.test(fails[0].last_error) && /attempt 2\/3/.test(fails[1].last_error) && fails[2].last_error === '' && fails[2].consecutive_failures === 0, 'Discord down: held twice, then skipped');
  const f = query('SELECT sheet_row, attempts, skipped FROM faction_feedback_failures'); ok(f.length === 1 && f[0].attempts === 3 && f[0].skipped === 1, 'failure row recorded'); plan = sheetPlan(); await pollSheet(); ok(/nothing new/.test(sync('feedback_poll').last_detail), 'queue drained'); }
{ const saved = sheet; sheet = [['Timestamp', 'Faction']]; await pollSheet(); ok(/no team\/division column/.test(sync('feedback_poll').last_error), 'missing team column is a clear failure'); sheet = saved; plan = () => ({ status: 403, json: {} }); await pollSheet(); ok(/not shared/.test(sync('feedback_poll').last_error), 'unreadable sheet failure'); plan = sheetPlan(); }
{ process.env.GOOGLE_SHEETS_API_KEY = 'key'; plan = (e) => e.url.includes('sheets.googleapis.com') && e.url.includes('fields=') ? { json: { sheets: [{ properties: { sheetId: 7, title: 'Form Responses 1' } }] } } : e.url.includes('sheets.googleapis.com') ? { json: { values: [['Timestamp', 'A'], ['t', '1']] } } : { text: 'x', json: {} };
  log.length = 0; const a = await fetchSheetRows('sid', '7'); ok(a.via === 'api' && a.rows[1][1] === '1' && log.every(e => e.url.includes('sheets.googleapis.com')), 'API key path used when set');
  plan = (e) => e.url.includes('sheets.googleapis.com') ? { status: 403, json: { error: { message: 'bad key' } } } : { text: 'Timestamp,A\nt,2', json: {} }; const b = await fetchSheetRows('sid', '7'); ok(b.via === 'csv' && b.rows[1][1] === '2', 'CSV fallback when the API refuses'); delete process.env.GOOGLE_SHEETS_API_KEY; }
{ const forms = { 'sheet-rcf_application': [['Timestamp', 'Faction Name', 'Faction Leader Name', 'Faction Leader Discord', 'Discord invite link'], ['2026-11-01', 'Old', 'O', 'o#1', 'https://discord.gg/old']], 'sheet-staff_application': [['Timestamp', 'Name', 'Discord'], ['t', 'Bob', 'bob#1']], 'sheet-garage_request': [['Timestamp', 'What faction are you requesting for?', 'What are you requesting?'], ['t', 'V', 'car']], 'sheet-ci_application': [['Timestamp', 'Character name', 'What is your Discord?'], ['t', 'C', '']] };
  plan = (e) => { const m = e.url.match(/spreadsheets\/d\/([^/]+)/); if (m) return { text: csv(forms[m[1]]), json: {} }; if (e.url.includes('sheets.googleapis.com')) return { status: 403, json: {} }; return { json: { id: (e.url.includes('/threads') ? 'th' : 'm') + Math.random().toString(36).slice(2, 6) } }; };
  for (const f of FORMS) await pollForm(f); ok(FORMS.every(f => /initialised at sheet row 1; no backfill/.test(sync('form_poll.' + f.key).last_detail)), 'all four forms initialise without backfill');
  forms['sheet-rcf_application'].push(['2026-11-10', 'The Reapers', 'Jay', '', 'https://discord.gg/new']); await pollForm(FORMS[0]); const row = queryOne("SELECT title, contact, status, row_key FROM form_submissions WHERE form_key='rcf_application' ORDER BY id DESC LIMIT 1");
  ok(/1 new submission/.test(sync('form_poll.rcf_application').last_detail) && row.title === 'The Reapers · Jay' && row.contact === '' && row.status === 'new' && row.row_key, 'new RCF row posts; contact never a URL');
  // Sheet ids default to the production forms; blank one out to exercise the configuration-failure path.
  const savedDesc = Object.getOwnPropertyDescriptor(FORMS[3], 'sheet'); Object.defineProperty(FORMS[3], 'sheet', { configurable: true, get: () => ({ id: '', gid: '' }) }); await pollForm(FORMS[3]); Object.defineProperty(FORMS[3], 'sheet', savedDesc); ok(/no sheet id configured/.test(sync('form_poll.ci_application').last_error), 'blank sheet id is a recorded configuration failure, not a crash'); }
unq(); pass('sheet intakes');

// ── website submissions → threads (hosted forms, dashboard/src/app/forms) ──
// A row the public form wrote (source 'web', thread_id NULL) is posted by the next
// poll — and by the one-minute job — through the same path as a sheet row, once.
unq = quiet();
globalThis.__cookies = {}; globalThis.__headers = { host: 'localhost:3000', 'x-forwarded-for': '198.51.100.7' };
const PF = await import('../../../dashboard/src/app/forms/actions.js');
const { postWebRows, webAll } = await import('../../../bot/formSubmissions.js'); const { postWebFeedback } = await import('../../../bot/factionFeedback.js');
const emptySheets = { 'sheet-rcf_application': [['Timestamp', 'Faction Name']], 'sheet-staff_application': [['Timestamp', 'Name', 'Discord']], 'sheet-garage_request': [['Timestamp', 'What faction are you requesting for?']], 'sheet-ci_application': [['Timestamp', 'Character name']], 'sheet-feedback': [['Timestamp', 'Which team is this for?', 'Faction']] };
plan = (e) => { const m = e.url.match(/spreadsheets\/d\/([^/]+)/); if (m) return { text: csv(emptySheets[m[1]] || [['Timestamp']]), json: {} }; if (e.url.includes('sheets.googleapis.com')) return { status: 403, json: {} }; return { json: { id: (e.url.includes('/threads') ? 'th' : 'm') + Math.random().toString(36).slice(2, 6) } }; };
const threads = () => log.filter(e => /\/threads$/.test(e.url) && e.method === 'POST').length;
const ackPosts = () => log.filter(e => /\/messages$/.test(e.url) && e.method === 'POST' && e.body?.embeds?.[0]?.footer).map(e => e.body.embeds[0].footer.text);
const sheetReads = () => log.filter(e => e.url.includes('docs.google.com')).length;
const garage = { 'What faction are you requesting for?': 'The Vanguard', 'What are you requesting?': 'Initial garage', "Character's name": 'Marcus Vane', 'Vehicle(s) requested (name and quantity)': 'Sultan x1', 'Reason for the request': 'First garage' };
const GARAGE = FORMS.find(f => f.key === 'garage_request'), STAFF = FORMS.find(f => f.key === 'staff_application'), RCF = FORMS[0];
{ const r = await PF.submitPublicForm('garage_request', garage); ok(r.ok, 'web garage request stored');
  const before = queryOne("SELECT id, thread_id FROM form_submissions WHERE form_key='garage_request' AND source='web'"); ok(before.thread_id === null, 'no thread before the poll');
  log.length = 0; await pollForm(GARAGE); const after = queryOne('SELECT thread_id, ack_message_id, status, title FROM form_submissions WHERE id=?', [before.id]);
  ok(threads() === 1 && after.thread_id && after.ack_message_id && after.status === 'new', 'poll posts the web row: one thread, ack recorded');
  ok(ackPosts().some(t => /Received via the website form/.test(t)), 'card footer says it came from the website form');
  ok(log.some(e => /\/threads$/.test(e.url) && e.body?.name === '[Open] The Vanguard · Initial garage'), 'thread titled like a sheet row');
  ok(/1 website submission\(s\) posted/.test(sync('form_web.garage_request').last_detail) && /nothing new/.test(sync('form_poll.garage_request').last_detail), 'health rows: web posted, sheet checked');
  log.length = 0; await pollForm(GARAGE); await webAll(); await postWebRows(GARAGE); ok(threads() === 0 && /nothing waiting/.test(sync('form_web.garage_request').last_detail), 'posted exactly once: later polls and the minute job post nothing');
  ok(query("SELECT 1 FROM form_submissions WHERE form_key='garage_request' AND source='web'").length === 1 && query("SELECT 1 FROM sheet_rows_seen WHERE source='form:garage_request' AND row_key LIKE 'web:%'").length === 0, 'no duplicate record, web rows never enter sheet_rows_seen'); }
{ ok((await PF.submitPublicForm('garage_request', { ...garage, "Character's name": 'Lena Ortiz' })).ok, 'second web row'); log.length = 0; await webAll();
  ok(threads() === 1 && queryOne("SELECT thread_id FROM form_submissions WHERE form_key='garage_request' AND source='web' ORDER BY id DESC LIMIT 1").thread_id, 'the one-minute job posts a fresh row without a sheet read'); eq(sheetReads(), 0, 'minute job reads no sheet'); }
// A row the channel configuration cannot accept stays queued (reported, never skipped); the minute job leaves it to the poll.
run("UPDATE ping_routes SET channel_id='' WHERE key='form.staff_application'");
{ ok((await PF.submitPublicForm('staff_application', { Name: 'Bob', Discord: 'bob_b', Age: '24', Timezone: 'CET', 'How long have you played on ECRP?': '2y', 'Current and past characters (names and factions)': '-', 'Why do you want to join Faction Management?': 'x', 'What can you bring to the team?': 'y', 'Average weekly availability (hours)': '5' })).ok, 'web staff application stored');
  log.length = 0; await pollForm(STAFF); const s = sync('form_web.staff_application'); const f = queryOne("SELECT sheet_row, attempts, skipped FROM form_submission_failures WHERE form_key='staff_application'");
  ok(threads() === 0 && /0 posted, 1 waiting/.test(s.last_error) && /no channel/.test(s.last_error) && s.consecutive_failures === 1 && f && f.sheet_row < 0 && f.attempts === 1 && f.skipped === 0, 'no channel: failure recorded against the negative sheet_row, row kept');
  await webAll(); ok(queryOne("SELECT attempts FROM form_submission_failures WHERE form_key='staff_application'").attempts === 1, 'minute job skips a row that already failed');
  await pollForm(STAFF); ok(queryOne("SELECT attempts FROM form_submission_failures WHERE form_key='staff_application'").attempts === 2 && queryOne("SELECT thread_id FROM form_submissions WHERE form_key='staff_application' AND source='web'").thread_id === null, 'poll retries and keeps counting, never skips a web row');
  run("UPDATE ping_routes SET channel_id='800000000000000001' WHERE key='form.staff_application'"); log.length = 0; await pollForm(STAFF);
  ok(threads() === 1 && queryOne("SELECT thread_id FROM form_submissions WHERE form_key='staff_application' AND source='web'").thread_id && !queryOne("SELECT 1 FROM form_submission_failures WHERE form_key='staff_application'") && sync('form_web.staff_application').consecutive_failures === 0, 'channel fixed → posted, failure row cleared'); }
// INTAKE_SOURCE: web turns the sheet off per form; sheet ignores web rows.
{ process.env.INTAKE_SOURCE = 'web'; log.length = 0; await pollForm(RCF); ok(sheetReads() === 0 && /sheet polling is off/.test(sync('form_poll.rcf_application').last_detail), 'INTAKE_SOURCE=web: no sheet read, recorded as a state'); 
  process.env.INTAKE_SOURCE = 'sheet'; ok((await PF.submitPublicForm('garage_request', { ...garage, "Character's name": 'Ignored Person' })).ok, 'row written regardless'); log.length = 0; await pollForm(GARAGE); await webAll();
  ok(threads() === 0 && sheetReads() === 1 && /ignored/.test(sync('form_web.garage_request').last_detail) && queryOne("SELECT thread_id FROM form_submissions WHERE form_key='garage_request' AND source='web' ORDER BY id DESC LIMIT 1").thread_id === null, 'INTAKE_SOURCE=sheet: sheet read, web row left alone');
  delete process.env.INTAKE_SOURCE; log.length = 0; await pollForm(GARAGE); ok(threads() === 1, 'back to both: the waiting web row posts'); }
// Feedback: same contract on faction_feedback.
{ const r = await PF.submitPublicForm('faction_feedback', { 'Which faction is this feedback about?': 'The Vanguard', 'Character name': 'Tyrone', 'Your Discord username': 'ty.rone', 'When did this occur?': '2026-11-02', 'What happened? Describe the roleplay and your feedback': 'He did a thing' }); ok(r.ok, 'web feedback stored');
  const id = queryOne("SELECT id FROM faction_feedback WHERE source='web'").id; log.length = 0; await pollSheet(); const row = queryOne('SELECT thread_id, ack_message_id, faction, character_name, discord_username FROM faction_feedback WHERE id=?', [id]);
  ok(threads() === 1 && row.thread_id && row.ack_message_id && row.faction === 'The Vanguard' && row.character_name === 'Tyrone', 'feedback poll posts the web row once');
  ok(log.some(e => /\/threads$/.test(e.url) && e.body?.name === '[Pending Acknowledgement] The Vanguard · Tyrone'), 'feedback thread titled like a sheet row'); ok(ackPosts().some(t => /website form/.test(t)), 'feedback card footer names the source');
  ok(log.some(e => /\/messages$/.test(e.url) && /\*\*Discord \(for follow-up\):\*\* ty\.rone/.test(e.body?.content || '') && /When did this occur\?\*\* 2026-11-02/.test(e.body?.content || '')), 'header block built from the payload');
  ok(/1 website submission/.test(sync('feedback_web').last_detail), 'feedback_web health row');
  log.length = 0; await pollSheet(); await postWebFeedback({ freshOnly: true }); await postWebFeedback(); ok(threads() === 0 && /nothing waiting/.test(sync('feedback_web').last_detail), 'feedback posted exactly once');
  process.env.INTAKE_SOURCE_FEEDBACK = 'web'; log.length = 0; await pollSheet(); ok(sheetReads() === 0 && /sheet polling is off/.test(sync('feedback_poll').last_detail), 'INTAKE_SOURCE_FEEDBACK=web turns the feedback sheet off'); delete process.env.INTAKE_SOURCE_FEEDBACK; }
unq(); pass('website submissions → threads');
