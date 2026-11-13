// Leadership nudges and job health (bot/lib/digest.js, bot/lib/health.js,
// bot/scheduler.js startLeadershipJobs/healthAlertTick) and the dashboard's
// /api/health route. Discord goes through fetch (captureDiscord) for channel
// posts and through a fake client for DMs; cron and timers are stubbed.
import { as, ok, eq, pass, captureDiscord, pings } from '../lib.mjs';
import { query, queryOne, run } from '../../../shared/db.js';
import { fakeClient, IDS, ROLES } from '../harness/discord-fakes.mjs';
import cron from '../../../bot/node_modules/node-cron/dist/node-cron.js';
process.env.BASE_URL = 'http://localhost:3000';
const crons = []; cron.schedule = (expr, fn, opts) => { crons.push({ expr, fn, opts }); return { stop() {} }; };
const timers = []; const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms) => { if (ms >= 5000) { timers.push({ ms, fn }); return 0; } return realSetTimeout(fn, ms); };
const log = captureDiscord();
const quiet = () => { const orig = { log: console.log, error: console.error, warn: console.warn }; console.log = console.error = console.warn = () => {}; return () => Object.assign(console, orig); };
let unq = quiet(); const section = (label) => { unq(); pass(label); unq = quiet(); };
const sync = (job) => queryOne('SELECT last_detail, last_error, consecutive_failures, runs, expected_every_minutes FROM sync_status WHERE job=?', [job]);
const route = (key) => queryOne('SELECT channel_id, alt_channel_id FROM ping_routes WHERE key=?', [key]);
const mute = (key, on) => run('UPDATE ping_routes SET enabled=? WHERE key=?', [on ? 0 : 1, key]);
const agoIso = (ms) => new Date(Date.now() - ms).toISOString();
const H = 3600000, D = 24 * H;

const { buildDigest, digestEmbed, sendLeadershipDigest, unverifiedForNudge, verifyNudgeTick, missingVotes, reviewVoteNudge, fetchVoters } = await import('../../../bot/lib/digest.js');
const { healthReport, classifyJob, diffHealth, registerJob } = await import('../../../bot/lib/health.js');
const { healthAlertTick, startLeadershipJobs, LEADERSHIP_JOBS } = await import('../../../bot/scheduler.js');
for (const k of ['leadership.digest', 'rp.verify_nudge', 'review.vote_nudge', 'ops.health']) ok(!!route(k), `route ${k} exists (migration 026)`);

// ── buildDigest: grouping and the 7-day cutoff ──
// Seed state: request 1 PENDING (created now), t1001 question (asked now), t1003 unclaimed leadership task (now), faction 4 staged (now).
{ const d = buildDigest(); eq(d.total, 0, 'fresh seed: nothing older than 7 days'); ok(/Nothing is waiting/.test(digestEmbed(d).description) && !digestEmbed(d).fields, 'empty digest says so'); }
{ const d = buildDigest({ now: Date.now() + 8 * D }); const kinds = d.groups.map(g => g.kind);
  eq(JSON.stringify(kinds), JSON.stringify(['approval', 'question', 'task', 'promotion']), '8 days later: the four fresh items are grouped by kind in fixed order');
  const appr = d.groups.find(g => g.kind === 'approval').items[0]; ok(appr.id === 1 && appr.faction === 'The Vanguard' && /NPC: Big Smoke/.test(appr.title) && appr.ageDays === 8 && appr.href === 'http://localhost:3000/v2/leadership?tab=approvals', 'approval item: faction, title, age, approvals link');
  const task = d.groups.find(g => g.kind === 'task').items; ok(task.length === 1 && task[0].id === 't1003' && task[0].href.endsWith('/v2/tasks/t1003'), 'only the leadership-role task counts (guide-role t1001 does not)');
  const q = d.groups.find(g => g.kind === 'question').items[0]; ok(/Which notes exactly/.test(q.title) && q.who === 'Guide One', 'unanswered question carries the text and asker');
  const promo = d.groups.find(g => g.kind === 'promotion').items[0]; ok(promo.faction === 'Harbor Syndicate' && /Tier 4/.test(promo.title) && /Harbor%20Syndicate\?tab=review/.test(promo.href), 'staged promotion links the faction review tab');
  const e = digestEmbed(d); ok(e.fields.length === 4 && /\(1\)$/.test(e.fields[0].name) && /\*\*The Vanguard\*\* — NPC: Big Smoke.*8d.*\[open\]\(http:\/\/localhost:3000/.test(e.fields[0].value), 'embed: one field per group, lines with age and link'); }
// Backdated items of the other kinds show up at the real "now".
run("INSERT INTO pending_executions (date, faction_id, execution_type, old_value, new_value, requested_by, status, requester_id, resolved_at) VALUES ('2026-11-01',1,'HQ','Old HQ','New HQ','Lead Two','EXECUTED',?, ?)", [IDS.l2, agoIso(3 * D)]);
const execVerify = Number(queryOne("SELECT MAX(id) id FROM pending_executions").id);
run("INSERT INTO pending_executions (date, faction_id, execution_type, old_value, new_value, requested_by, status, requester_id, created_at) VALUES ('2026-10-20',2,'TURF','Docks','Vespucci','Lead Two','RP_DONE',?, ?)", [IDS.l2, agoIso(20 * D)]);
const execDone = Number(queryOne("SELECT MAX(id) id FROM pending_executions").id);
run("INSERT INTO site_audit_log (actor_id, actor_name, action, target_type, target_id, details, timestamp) VALUES (?, 'Lead Two', 'EDIT', 'rp_change', ?, 'RP done', ?)", [IDS.l2, String(execDone), agoIso(9 * D)]);
run("INSERT INTO faction_reviews (faction_id, faction_name, review_month, recommendation, status, submitted_by, created_at, updated_at) VALUES (2,'Los Santos Kings',?, 'Promote','Confirmed Promote','Lead Two',?,?)", [new Date().toISOString().slice(0, 7), agoIso(12 * D), agoIso(10 * D)]);
run("INSERT INTO deletion_requests (requested_by, discord_id, content_type, original_text, target_row_id, target_table, created_at) VALUES ('Guide One', ?, 'intel', 'Rumoured to be moving weapons', 1, 'intel_notes', ?)", [IDS.l1, agoIso(9 * D)]);
{ const d = buildDigest(); eq(JSON.stringify(d.groups.map(g => [g.kind, g.items.length])), JSON.stringify([['execute', 1], ['verify', 1], ['feedback', 1], ['deletion', 1]]), 'execute (audit age 9d), verify (48h rule, 3d), feedback (10d), deletion (9d) — the fresh items still excluded');
  const v = d.groups.find(g => g.kind === 'verify').items[0]; ok(v.id === execVerify && v.ageDays === 3 && v.href === 'http://localhost:3000/v2/leadership?tab=queue', 'verify item links the queue tab');
  const x = d.groups.find(g => g.kind === 'execute').items[0]; ok(x.id === execDone && x.ageDays === 9, 'RP_DONE age comes from the audit row, not created_at');
  ok(buildDigest({ verifyHours: 96 }).groups.every(g => g.kind !== 'verify'), 'verify cutoff is configurable'); }
// Sending: one embed on the route; a muted route posts nothing and says so.
{ log.length = 0; const r = await sendLeadershipDigest(); const p = pings(log); const ch = route('leadership.digest').channel_id;
  ok(r.ok && r.digest.total === 4 && p.length === 1 && p[0].ch === ch && p[0].embeds === 1 && log.length === 0, 'digest posted once on leadership.digest'); ok(/4 item\(s\) in 4 group\(s\)/.test(sync('leadership_digest').last_detail), 'sync_status recorded');
  mute('leadership.digest', true); log.length = 0; const m = await sendLeadershipDigest(); mute('leadership.digest', false); ok(m.muted && pings(log).length === 0 && /muted/.test(sync('leadership_digest').last_detail), 'muted route: nothing sent, recorded as ok'); }
section('weekly digest');

// ── verify-in-game nudge ──
run('DELETE FROM pending_executions WHERE id > 2');
const ins = (resolvedAgo, { nudgedAgo = null, verified = false, requester = IDS.l2 } = {}) => { run("INSERT INTO pending_executions (date, faction_id, execution_type, old_value, new_value, requested_by, status, requester_id, resolved_at, verify_nudged_at, verified_at, verified_by) VALUES ('2026-11-01',1,'NPC','A','B','Lead Two','EXECUTED',?,?,?,?,?)", [requester, agoIso(resolvedAgo), nudgedAgo == null ? null : agoIso(nudgedAgo), verified ? agoIso(H) : null, verified ? 'Risk' : '']); return Number(queryOne('SELECT MAX(id) id FROM pending_executions').id); };
const due = ins(3 * D), fresh = ins(1 * D), nudgedRecently = ins(5 * D, { nudgedAgo: 1 * D }), nudgedLongAgo = ins(5 * D, { nudgedAgo: 3 * D }), verified = ins(6 * D, { verified: true }), noRequester = ins(6 * D, { requester: '' });
eq(JSON.stringify(unverifiedForNudge().map(r => r.id)), JSON.stringify([nudgedLongAgo, due]), 'selection: executed > 48h, unverified, never nudged or nudged > 48h ago, with a requester');
{ const client = fakeClient({}); log.length = 0; const r = await verifyNudgeTick(client);
  ok(r.candidates === 2 && r.dm === 2 && r.channel === 0 && client.dms.length === 2 && client.dms.every(d => d.to === IDS.l2) && /verify in game/.test(client.dms[0].m.content) && /\/v2\/leadership\?tab=queue/.test(client.dms[0].m.content) && new RegExp(`Request #${due}`).test(client.dms.map(d => d.m.content).join()), 'both due requests DMed to the requester with the queue link');
  const rows = Object.fromEntries(query('SELECT id, verify_nudged_at, verified_at, status FROM pending_executions WHERE id > 2').map(x => [x.id, x]));
  ok(rows[due].verify_nudged_at && rows[nudgedLongAgo].verify_nudged_at > agoIso(60000) && rows[fresh].verify_nudged_at === null && rows[nudgedRecently].verify_nudged_at < agoIso(23 * H) && rows[verified].verify_nudged_at === null && rows[noRequester].verify_nudged_at === null, 'verify_nudged_at written for the two nudged rows only');
  ok(Object.values(rows).every(x => x.status === 'EXECUTED' && (x.id === verified ? !!x.verified_at : x.verified_at === null)), 'no workflow state changed'); ok(pings(log).length === 0 && /2 due; 2 by DM, 0 in channel/.test(sync('rp_verify_nudge').last_detail), 'nothing in channel; sync recorded');
  eq((await verifyNudgeTick(client)).candidates, 0, 'second hourly tick: nothing due (nudged_at < 48h)'); }
{ run('UPDATE pending_executions SET verify_nudged_at = NULL WHERE id = ?', [due]); const bad = fakeClient({ users: { [IDS.l2]: false } }); log.length = 0; const r = await verifyNudgeTick(bad); const p = pings(log);
  ok(r.dm === 0 && r.channel === 1 && p.length === 1 && p[0].ch === route('rp.verify_nudge').channel_id && p[0].content.startsWith(`<@${IDS.l2}>`) && queryOne('SELECT verify_nudged_at v FROM pending_executions WHERE id=?', [due]).v, 'DM failure falls back to the route channel with a mention, still stamps nudged_at');
  run('UPDATE pending_executions SET verify_nudged_at = NULL WHERE id = ?', [due]); mute('rp.verify_nudge', true); log.length = 0; const m = await verifyNudgeTick(fakeClient({})); mute('rp.verify_nudge', false);
  ok(m.muted && pings(log).length === 0 && queryOne('SELECT verify_nudged_at v FROM pending_executions WHERE id=?', [due]).v === null && /muted/.test(sync('rp_verify_nudge').last_detail), 'muted route: no DM, no channel, no write'); }
section('verify nudge');

// ── review vote nudge ──
// 2026-10: reviews for factions 1 and 2; Mgmt Three voted on 1; Risk (owner, L3) voted on nothing.
// Voters are the FM Leadership role holders only, never "everyone at clearance 3".
const PANEL = [{ id: IDS.l3, name: 'x' }, { id: IDS.owner, name: 'y' }];
{ const m = missingVotes('2026-10', PANEL); eq(JSON.stringify(m.map(x => [x.leaderName, x.factions.map(f => f.name)])), JSON.stringify([['Mgmt Three', ['Los Santos Kings']], ['Risk (owner)', ['Los Santos Kings', 'The Vanguard']]]), 'missing voters per leader (staff names)');
  eq(missingVotes('2026-10', [{ id: IDS.owner, name: 'y' }]).length, 1, 'an L3 without the FM Leadership role is not a voter');
  eq(missingVotes('2026-10').length, 0, 'no voters → nobody'); eq(missingVotes('2026-10', [{ id: IDS.nobody, name: 'Discord Name' }])[0].leaderName, 'Discord Name', 'role holder with no staff row uses the Discord name');
  run("INSERT INTO leadership_personal_notes (faction_id, faction_name, author_id, author_name, review_month, note, status) VALUES (2,'Los Santos Kings',?,'Mgmt Three','2026-10','fine','')", [IDS.l3]); eq(missingVotes('2026-10', PANEL).length, 1, 'any note row for the faction-month counts as having voted'); eq(missingVotes('2026-10', PANEL)[0].leaderName, 'Risk (owner)', 'Risk still missing');
  eq(missingVotes('2026-12', PANEL).length, 0, 'a month without reviews has nothing to vote on'); }
{ process.env.GUILD_ID ||= '1457188814916423855'; const role = queryOne("SELECT role_id FROM discord_roles WHERE key='fm_leadership'").role_id;
  const mem = (id, roles, bot = false) => [id, { id, displayName: 'D' + id.slice(-2), user: { bot }, roles: { cache: new Map(roles.map(r => [r, {}])) } }];
  const guildClient = (members) => Object.assign(fakeClient({}), { guilds: { fetch: async (gid) => { if (gid !== process.env.GUILD_ID) throw new Error('wrong guild'); return { members: { fetch: async () => new Map(members) } }; } } });
  const v = await fetchVoters(guildClient([mem(IDS.owner, [role]), mem(IDS.l3, [ROLES.game_affairs]), mem('999999999999999999', [role], true)]));
  eq(JSON.stringify(v.map(x => x.id)), JSON.stringify([IDS.owner]), 'fetchVoters: FM Leadership holders only, bots and other L3 roles excluded');
  eq(await fetchVoters(Object.assign(fakeClient({}), { guilds: { fetch: async () => { throw new Error('nope'); } } })), null, 'fetchVoters: unreadable guild → null');
  const c = guildClient([mem(IDS.owner, [role]), mem(IDS.l3, [ROLES.game_affairs])]); log.length = 0; const r = await reviewVoteNudge(c, { now: new Date('2026-10-12T10:00:00Z') });
  ok(r.leaders === 1 && c.dms.length === 1 && c.dms[0].to === IDS.owner, 'scheduled run: only the role holder is DMed');
  const u = fakeClient({}); log.length = 0; const n = await reviewVoteNudge(u, { now: new Date('2026-10-12T10:00:00Z') });
  ok(n.error && u.dms.length === 0 && pings(log).length === 0 && /could not read FM Leadership/.test(sync('review_vote_nudge').last_error), 'role unreadable → nothing sent, failure recorded'); }
{ const client = fakeClient({}); log.length = 0; const r = await reviewVoteNudge(client, { now: new Date('2026-10-12T10:00:00Z'), voters: PANEL });
  ok(r.month === '2026-10' && r.leaders === 1 && r.dm === 1 && client.dms.length === 1 && client.dms[0].to === IDS.owner && /2 factions/.test(client.dms[0].m.content) && /\*\*The Vanguard\*\*/.test(client.dms[0].m.content) && /\*\*Los Santos Kings\*\*/.test(client.dms[0].m.content) && /\/v2\/leadership\?tab=reviews/.test(client.dms[0].m.content), 'one DM listing both factions, with the reviews link'); ok(pings(log).length === 0 && /1 leader\(s\) behind; 1 by DM/.test(sync('review_vote_nudge').last_detail), 'sync recorded, no channel post');
  const bad = fakeClient({ users: { [IDS.owner]: false } }); log.length = 0; const f = await reviewVoteNudge(bad, { now: new Date('2026-10-12T10:00:00Z'), voters: PANEL }); const p = pings(log);
  ok(f.channel === 1 && p.length === 1 && p[0].ch === route('review.vote_nudge').channel_id && p[0].content.startsWith(`<@${IDS.owner}>`), 'DM failure → channel post mentioning the leader');
  mute('review.vote_nudge', true); log.length = 0; const m = await reviewVoteNudge(fakeClient({}), { now: new Date('2026-10-12T10:00:00Z'), voters: PANEL }); mute('review.vote_nudge', false); ok(m.muted && pings(log).length === 0, 'muted route sends nothing');
  eq((await reviewVoteNudge(fakeClient({}), { now: new Date('2026-12-12T10:00:00Z'), voters: PANEL })).leaders, 0, 'nothing reviewed this month → nobody nudged'); }
section('review vote nudge');

// ── health classification ──
run('DELETE FROM sync_status');
const srow = (job, every, { okAgo = null, runAgo = null, fails = 0, err = '', updAgo = 0 } = {}) => run("INSERT INTO sync_status (job, label, expected_every_minutes, last_ok_at, last_run_at, consecutive_failures, last_error, updated_at) VALUES (?,?,?,?,?,?,?,?)", [job, job, every, okAgo == null ? null : agoIso(okAgo), runAgo == null ? null : agoIso(runAgo), fails, err, agoIso(updAgo)]);
srow('j_ok', 60, { okAgo: 10 * 60000 }); srow('j_late', 60, { okAgo: 4 * H, runAgo: 5 * 60000 }); srow('j_fail', 60, { okAgo: 5 * 60000, fails: 3, err: 'boom' }); srow('j_blip', 60, { okAgo: 5 * 60000, fails: 2, err: 'once' }); srow('j_nocad', 0, { okAgo: 30 * D }); srow('j_never', 15, { updAgo: 2 * H }); srow('j_new', 15, { updAgo: 60000 });
{ const r = healthReport(); const st = Object.fromEntries(r.jobs.map(j => [j.job, j.status]));
  eq(JSON.stringify(st), JSON.stringify({ j_blip: 'ok', j_fail: 'failing', j_late: 'late', j_never: 'late', j_new: 'ok', j_nocad: 'ok', j_ok: 'ok' }), 'late = no success for > 3× cadence (never-run judged from the row), failing = 3+ in a row, no cadence = never late');
  ok(r.ok === false && r.jobs.find(j => j.job === 'j_late').ageMinutes === 240 && r.jobs.find(j => j.job === 'j_fail').lastError === 'boom' && r.jobs.find(j => j.job === 'j_never').lastOk === null && typeof r.checkedAt === 'string', 'report shape: ok, ageMinutes, lastError, lastOk');
  eq(classifyJob({ job: 'x', expected_every_minutes: 60, last_ok_at: '2026-11-11 08:00:00', consecutive_failures: 0 }, new Date('2026-11-11T11:01:00Z')).status, 'late', 'sqlite datetime text is read as UTC');
  eq(classifyJob({ job: 'x', expected_every_minutes: 60, last_ok_at: '2026-11-11 08:00:00', consecutive_failures: 0 }, new Date('2026-11-11T10:59:00Z')).status, 'ok', 'inside 3× cadence is ok'); }
// Alerts fire on change only; recovery is announced once.
const state = new Map();
{ log.length = 0; const r = await healthAlertTick({ state }); const p = pings(log);
  ok(r.alerts.length === 3 && r.sent === 3 && p.length === 1 && p[0].ch === route('ops.health').channel_id && /🔴 \*\*j_fail\*\* failing — 3 failures in a row: boom/.test(p[0].content) && /🟠 \*\*j_late\*\* late — no successful run for 4h \(expected every 60 min\)/.test(p[0].content) && /j_never/.test(p[0].content) && /\/v2\/admin\?tab=audit/.test(p[0].content), 'first pass: one post naming the late and failing jobs');
  log.length = 0; const again = await healthAlertTick({ state }); ok(again.alerts.length === 0 && pings(log).length === 0, 'second pass: same state, nothing repeated');
  run("UPDATE sync_status SET last_ok_at = ?, consecutive_failures = 0, last_error = '' WHERE job = 'j_late'", [agoIso(60000)]); log.length = 0; const rec = await healthAlertTick({ state }); const q = pings(log);
  ok(rec.alerts.length === 1 && rec.alerts[0].kind === 'recovered' && q.length === 1 && /✅ \*\*j_late\*\* recovered/.test(q[0].content) && !/j_fail/.test(q[0].content), 'recovery announced once, still-broken jobs not repeated');
  ok(/job\(s\) checked/.test(sync('ops_health').last_detail) && sync('ops_health').runs === 3, 'health job records its own sync_status');
  run("UPDATE sync_status SET consecutive_failures = 0, last_error = '' WHERE job = 'j_fail'"); mute('ops.health', true); log.length = 0; const m = await healthAlertTick({ state }); mute('ops.health', false);
  ok(m.muted && pings(log).length === 0 && state.get('j_fail') === 'failing', 'muted: nothing posted and the state is not advanced'); log.length = 0; const after = await healthAlertTick({ state }); ok(after.alerts.length === 1 && after.alerts[0].kind === 'recovered' && pings(log).length === 1, 'un-muted: the recovery is still reported');
  run("UPDATE sync_status SET consecutive_failures = 3, last_error = 'x' WHERE job = 'j_fail'"); const d = diffHealth(state, healthReport()); ok(d.length === 1 && d[0].kind === 'failing', 'diffHealth is pure over a caller-owned map'); }
// Scheduling: four UTC crons, each job seeded with its cadence, so a job that never fires shows up late.
{ crons.length = 0; timers.length = 0; startLeadershipJobs(fakeClient({})); eq(JSON.stringify(crons.map(c => c.expr)), JSON.stringify(['0 9 * * 1', '5 * * * *', '0 10 12 * *', '*/30 * * * *']), 'digest Monday 09:00, verify hourly, vote nudge 12th 10:00, health every 30 min'); ok(crons.every(c => c.opts?.timezone === 'UTC'), 'all in UTC');
  ok(LEADERSHIP_JOBS.every(j => sync(j.job)?.expected_every_minutes === j.every), 'sync_status rows registered with cadences'); ok(timers.some(t => t.ms === 60000), 'startup health pass scheduled'); registerJob('leadership_digest', 'Weekly leadership digest', 7 * 24 * 60); eq(query("SELECT COUNT(*) c FROM sync_status WHERE job='leadership_digest'")[0].c, 1, 'registerJob is idempotent'); }
section('job health');

// ── dashboard /api/health ──
const { GET } = await import('../../../dashboard/src/app/api/health/route.js');
{ run("UPDATE sync_status SET consecutive_failures = 3, last_error = 'x' WHERE job = 'j_fail'"); as('tok-l3'); let res = await GET(); let body = await res.json();
  ok(res.status === 503 && body.ok === false && Array.isArray(body.jobs) && body.jobs.some(j => j.job === 'j_fail' && j.status === 'failing') && res.headers.get('cache-control') === 'no-store', 'L3: 503 with job details while a job is failing');
  as('tok-l1'); res = await GET(); body = await res.json(); ok(res.status === 503 && body.ok === false && body.jobs === undefined, 'L1: status code only, no details');
  as('nope'); res = await GET(); body = await res.json(); ok(res.status === 503 && JSON.stringify(body) === '{"ok":false}', 'unauthenticated: { ok } only');
  run("UPDATE sync_status SET consecutive_failures = 0, last_error = '' WHERE job = 'j_fail'"); run("UPDATE sync_status SET last_ok_at = ? WHERE job = 'j_never'", [agoIso(60000)]); as('tok-l3'); res = await GET(); body = await res.json(); ok(res.status === 200 && body.ok === true && body.jobs.every(j => j.status === 'ok'), 'everything ok → 200'); as('nope'); res = await GET(); ok(res.status === 200 && JSON.stringify(await res.json()) === '{"ok":true}', 'unauthenticated 200 → { ok: true }'); }
section('/api/health');
