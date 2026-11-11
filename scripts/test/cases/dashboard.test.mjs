// Home / My Tasks actions (dashboard/src/app/fm/dashboard/actions.js): task
// visibility per clearance, claim/create/edit/reassign/Q&A/complete guards,
// personal reminders and recurring-reminder instances, with Discord captured.
import { as, ok, eq, rejects, failsWith, pass, captureDiscord, pings } from '../lib.mjs';
import { queryOne, run } from '../../../shared/db.js';
const log = captureDiscord();
const A = await import('../../../dashboard/src/app/fm/dashboard/actions.js');

const L1 = '100000000000000001', L2 = '100000000000000002', L3 = '100000000000000003';
const LEAD_ROLE = '900000000000000001', TL_ROLE = '900000000000000002', ALLFM_ROLE = '900000000000000003', GA_ROLE = '900000000000000004';
const MAIN = '1457201300583485491', ALT = '1494694133862760578', EVENT = '1464012356379213854';
const uids = (r) => ({ me: r.assignedToMe.map(x => x.task_uid), team: r.forMyTeam.map(x => x.task_uid) });
const lastAudit = () => queryOne('SELECT action, target_type, target_id, details FROM site_audit_log ORDER BY id DESC LIMIT 1');

// ── reads ──
as('tok-l1'); eq(JSON.stringify(uids(await A.getMyTasks())), '{"me":["t1002"],"team":["t1001"]}', 'L1 sees assigned + guide-role task');
as('tok-l2'); eq(JSON.stringify(uids(await A.getMyTasks())), '{"me":[],"team":["t1001"]}', 'L2 lists');
as('tok-l3'); ok(uids(await A.getMyTasks()).team.includes('t1003'), 'L3 sees the leadership task');
as('tok-et'); ok(!uids(await A.getMyTasks()).team.includes('t1003'), 'ET keeps its real level');
as('tok-lst'); ok(!uids(await A.getMyTasks()).team.includes('t1003'), 'LST may read, no leadership task');
as('tok-expired'); await rejects(() => A.getMyTasks(), 'AUTH_REQUIRED', 'expired');
as('tok-owner', L1); eq(JSON.stringify(uids(await A.getMyTasks())), '{"me":["t1002"],"team":["t1001"]}', 'owner view-as L1 is server-side');
as('tok-l3', L1); ok(uids(await A.getMyTasks()).team.includes('t1003'), 'non-owner view-as ignored');
as('tok-l2'); await rejects(() => A.getAllServerTasks(), 'AUTH_INSUFFICIENT', 'L2 refused all-server list');
as('tok-et'); await rejects(() => A.getAllServerTasks(), 'AUTH_INSUFFICIENT', 'ET not boosted');
as('tok-l3'); { const r = await A.getAllServerTasks(); ok(r.length === 3 && r.every(x => x.status === 'open' && x.teamContext !== undefined && x.url), 'L3 all open tasks decorated'); }
as('tok-l2'); eq((await A.getMyCreatedTasks()).map(x => x.task_uid).join(), 't1002', 'created by L2');
as('tok-l1'); await rejects(() => A.getMyTeamAllTasks(), 'AUTH_INSUFFICIENT', 'L1 no team list');
as('tok-l2'); eq((await A.getMyTeamAllTasks()).map(x => x.task_uid).sort().join(), 't1001,t1002', 'L2 team list');
as('tok-l1'); eq(await A.getTaskByUid('t1003'), null, 'invisible task → null');
{ const r = await A.getTaskByUid('t1001'); ok(r?.targetLabel === 'All FM' && r.claimerName === 'Unclaimed', 'decorated task'); }
eq((await A.getTaskQuestions('t1003')).length, 0, 'questions hidden with the task'); eq((await A.getTaskQuestions('t1001')).length, 1, 'questions visible');
await failsWith(() => A.getTaskDetail('t1003'), /not visible/, 'detail invisible'); await failsWith(() => A.getTaskDetail('zzz'), /not found/i, 'detail unknown');
{ const d = await A.getTaskDetail('t1001'); ok(d.ok && d.can.claim && d.can.complete && d.can.ask && !d.can.edit && !d.can.reassign && !d.can.answer && d.questions.length === 1, 'L1 capabilities'); }
as('tok-l3'); { const d = await A.getTaskDetail('t1001'); ok(d.can.answer && d.can.edit && d.can.reassign && !d.can.ask, 'creator capabilities'); }
as('tok-et'); { const d = await A.getTaskDetail('t1001'); ok(d.ok && !Object.values(d.can).some(Boolean), 'ET read-only'); }
as('tok-l1'); eq((await A.getQACountsForTasks(['t1001', 't1002'])).t1001?.open, 1, 'QA counts'); eq(Object.keys(await A.getQACountsForTasks('t1001')).length, 0, 'QA counts non-array');
{ const r = await A.getRoleTargetsForCreate(); ok(r.gameAffairsId === GA_ROLE && r.teams.length === 3 && r.teams[0].team_id, 'role targets from discord_roles + teams'); }
{ const r = await A.getStaffForCreate(); ok(r.every(s => 'clearance' in s) && !r.some(s => s.discord_id.startsWith('placeholder')), 'staff picker'); }
as('tok-lst'); { const r = await A.getMyTeamFactions(); ok(r.teamName === 'All Factions' && r.factions.length === 3, 'LST sees all factions'); }
as('tok-l1'); eq((await A.getMyTeamFactions()).factions.map(f => f.name).join(), 'The Vanguard', 'L1 team factions');
as('tok-et'); eq((await A.getMyTeamFactions()).factions.length, 0, 'ET no team'); pass('reads');

// ── claim / unclaim ──
as('tok-l1'); await failsWith(() => A.claimMyTask('t1003'), /not visible/, 'claim invisible'); await failsWith(() => A.claimMyTask('does-not-exist'), /not found/i, 'claim unknown');
log.length = 0; ok((await A.claimMyTask('t1001')).ok, 'claim');
{ const p = pings(log); ok(queryOne("SELECT claimed_by FROM tasks WHERE task_uid='t1001'").claimed_by === L1 && lastAudit().target_id === 't1001' && p.length === 1 && p[0].ch === MAIN, 'claim stored, audited, pinged MAIN'); }
as('tok-l2'); await failsWith(() => A.claimMyTask('t1001'), /Already claimed by Guide One/, 'already claimed');
as('tok-et'); await failsWith(() => A.claimMyTask('t1001'), /read-only/, 'ET read-only'); as('tok-lst'); await failsWith(() => A.claimMyTask('t1001'), /read-only/, 'LST read-only');
as('tok-expired'); await failsWith(() => A.claimMyTask('t1001'), /Not authenticated/, 'expired claim');
as('tok-l2'); await failsWith(() => A.unclaimMyTask('t1001', 'nope'), /claimer or leadership/, 'unclaim by other L2');
as('tok-l3'); ok((await A.unclaimMyTask('t1001', 'freeing')).ok && queryOne("SELECT claimed_by FROM tasks WHERE task_uid='t1001'").claimed_by === 'None', 'L3 unclaims');
as('tok-l1'); await failsWith(() => A.unclaimMyTask('t1001'), /not claimed/, 'unclaim unclaimed'); pass('claims');

// ── create ──
await failsWith(() => A.createMyTask({ targetType: 'Role', targetId: ALLFM_ROLE }), /description/i, 'no description');
await failsWith(() => A.createMyTask({ desc: 'x', targetType: 'Garbage', targetId: 'xyz' }), /Role or User/, 'bad type');
await failsWith(() => A.createMyTask({ desc: 'x', targetType: 'User', targetId: '555' }), /roster/, 'unknown user');
await failsWith(() => A.createMyTask({ desc: 'x', targetType: 'Role', targetId: 'team_nope' }), /Unknown role/, 'unknown role');
await failsWith(() => A.createMyTask({}), null, 'empty args');
as('tok-et'); await failsWith(() => A.createMyTask({ desc: 'ET task', targetType: 'Role', targetId: ALLFM_ROLE }), /read-only/, 'ET create');
as('tok-lst'); await failsWith(() => A.createMyTask({ desc: 'LST task', targetType: 'Role', targetId: ALLFM_ROLE }), /read-only/, 'LST create');
as('tok-l1'); log.length = 0;
const c1 = await A.createMyTask({ desc: 'L1 task to All FM', targetType: 'Role', targetId: ALLFM_ROLE, enableDM: true });
{ const row = queryOne('SELECT * FROM tasks WHERE task_uid=?', [c1.uid]); const p = pings(log);
  ok(c1.ok && /^[0-9a-f-]{36}$/.test(c1.uid) && row.status === 'open' && row.notify_creator === 0 && row.next_reminder && /^\d{4}-/.test(row.created_at), 'created with uuid, ISO created_at, DM reminder');
  ok(lastAudit().target_id === c1.uid && p.length === 1 && p[0].ch === MAIN && p[0].comps.length, 'audited + MAIN ping with buttons'); }
log.length = 0; const cLead = await A.createMyTask({ desc: 'L1 to Leadership', targetType: 'Role', targetId: LEAD_ROLE });
ok(cLead.ok && queryOne('SELECT notify_creator FROM tasks WHERE task_uid=?', [cLead.uid]).notify_creator === 1 && pings(log)[0].ch === ALT, 'leadership target → ALT + notify_creator');
log.length = 0; ok((await A.createMyTask({ desc: 'L1 to GA', targetType: 'Role', targetId: GA_ROLE })).ok && pings(log)[0].ch === ALT, 'GA role routes ALT');
log.length = 0; { const r = await A.createMyTask({ desc: 'L1 to Mgmt user', targetType: 'User', targetId: L3 }); ok(r.ok && pings(log)[0].ch === ALT && queryOne('SELECT notify_creator FROM tasks WHERE task_uid=?', [r.uid]).notify_creator === 1, 'L3 user routes ALT'); }
as('tok-l3'); log.length = 0; ok((await A.createMyTask({ desc: 'L3 self', targetType: 'User', targetId: L3 })).ok && pings(log).length === 0, 'self-assign no ping');
as('tok-l1'); { const [a, b] = await Promise.all([A.createMyTask({ desc: 'burst A', targetType: 'Role', targetId: ALLFM_ROLE }), A.createMyTask({ desc: 'burst B', targetType: 'Role', targetId: ALLFM_ROLE })]); ok(a.ok && b.ok && a.uid !== b.uid, 'distinct uids in one tick'); }
ok((await A.getMyCreatedTasks()).some(x => x.task_uid === cLead.uid), 'creator sees leadership-targeted task');
{ const u = uids(await A.getMyTasks()); ok(!u.team.includes(cLead.uid) && u.team.includes(c1.uid), 'leadership task not in L1 team tab'); } pass('create');

// ── edit / reassign ──
await failsWith(() => A.editMyTask('t1001', 'hijack'), /creator or a team lead/, 'L1 edit refused');
as('tok-l2'); await failsWith(() => A.editMyTask('t1001', '   '), /description/i, 'blank edit');
ok((await A.editMyTask('t1001', 'Update Vanguard HQ notes (edited)')).ok && queryOne("SELECT description FROM tasks WHERE task_uid='t1001'").description.endsWith('(edited)') && queryOne("SELECT count(*) c FROM task_log WHERE task_uid='t1001' AND action='EDITED'").c === 1, 'L2 edit logged');
await failsWith(() => A.editMyTask('nope', 'x'), /not found/i, 'edit unknown');
as('tok-l1'); await failsWith(() => A.reassignMyTask('t1002', L2, 'User'), /need L2/, 'L1 reassign'); as('tok-et'); await failsWith(() => A.reassignMyTask('t1002', L2, 'User'), /read-only/, 'ET reassign');
as('tok-l2'); await failsWith(() => A.reassignMyTask('t1002', LEAD_ROLE, 'Role'), /cannot assign tasks to leadership roles/, 'L2 → leadership role');
await failsWith(() => A.reassignMyTask('t1002', GA_ROLE, 'Role'), /leadership roles/, 'L2 → GA role'); await failsWith(() => A.reassignMyTask('t1002', L3, 'User'), /leadership members/, 'L2 → L3 user');
await failsWith(() => A.reassignMyTask('t1002', '555', 'User'), /roster/, 'reassign unknown user');
log.length = 0; ok((await A.reassignMyTask('t1002', 'team_cup', 'Team', 'to the team')).ok, "'Team' maps to a team role");
{ const row = queryOne("SELECT target_type, target_id, claimed_by FROM tasks WHERE task_uid='t1002'"); ok(row.target_type === 'Role' && row.target_id === 'team_cup' && row.claimed_by === 'None' && pings(log).length >= 1, 'reassign clears claim + pings'); }
as('tok-l1'); ok(uids(await A.getMyTasks()).team.includes('t1002'), 'team-role task visible to teammate');
as('tok-l3'); log.length = 0; ok((await A.reassignMyTask('t1002', LEAD_ROLE, 'Role')).ok && pings(log)[0].ch === ALT, 'L3 → leadership ok');
await failsWith(() => A.reassignMyTask('nope', L1, 'User'), /not found/i, 'reassign unknown'); pass('edit / reassign');

// ── Q&A ──
as('tok-l1'); await failsWith(() => A.requestTaskInfo('t1003', 'why?'), /not visible/, 'ask on invisible'); await failsWith(() => A.requestTaskInfo('t1001', '  '), /question/i, 'ask blank');
as('tok-l3'); await failsWith(() => A.requestTaskInfo('t1001', 'self?'), /created this task/, 'creator cannot ask');
as('tok-l1'); log.length = 0; const q = await A.requestTaskInfo('t1001', 'Which notes?');
{ const p = pings(log); ok(q.ok && q.id > 0 && p.length === 1 && p[0].comps.includes(`task_info_btn_${q.id}`) && lastAudit().action === 'QUESTION', 'question pinged with Answer button'); }
await failsWith(() => A.answerTaskQuestion(q.id, 'me'), /creator/, 'non-creator answer');
as('tok-l3'); await failsWith(() => A.answerTaskQuestion(q.id, ''), /answer/i, 'blank answer'); await failsWith(() => A.answerTaskQuestion('abc', 'x'), /not found/i, 'bad question id');
log.length = 0; ok((await A.answerTaskQuestion(q.id, 'The HQ notes.')).ok && queryOne('SELECT answer FROM task_questions WHERE id=?', [q.id]).answer === 'The HQ notes.' && pings(log).length === 1, 'answer stored + pinged');
await failsWith(() => A.answerTaskQuestion(q.id, 'again'), /Already answered/, 'no double answer');
as('tok-owner'); ok((await A.answerTaskQuestion(1, 'Owner answers')).ok, 'leadership may answer'); pass('Q&A');

// ── complete (soft) ──
as('tok-l1'); await failsWith(() => A.completeMyTask('t1003'), /not visible/, 'complete invisible'); await failsWith(() => A.completeMyTask('nope'), /not found/i, 'complete unknown');
log.length = 0; ok((await A.completeMyTask('t1001', 'done it')).ok, 'complete');
{ const row = queryOne("SELECT * FROM tasks WHERE task_uid='t1001'"); const p = pings(log);
  ok(row.status === 'completed' && row.completed_by_id === L1 && row.completion_note === 'done it' && row.next_reminder === null, 'row kept, soft completed');
  ok(queryOne("SELECT count(*) c FROM task_questions WHERE task_uid='t1001'").c === 2 && p.length === 1 && /done it/.test(p[0].content) && /v2\/tasks\/t1001/.test(p[0].content), 'questions kept, creator pinged with note + link'); }
await failsWith(() => A.completeMyTask('t1001'), /already completed/, 'double complete'); await failsWith(() => A.claimMyTask('t1001'), /already completed/, 'claim completed');
{ const u = uids(await A.getMyTasks()); ok(!u.team.includes('t1001') && !u.me.includes('t1001'), 'gone from open lists'); }
{ const d = await A.getTaskDetail('t1001'); ok(d.ok && d.task.status === 'completed' && !d.can.claim && !d.can.complete && d.questions.length === 2, 'completed detail readable, no actions'); }
as('tok-l3'); eq((await A.getAllServerTasks({ status: 'completed' })).map(x => x.task_uid).join(), 't1001', 'completed history'); eq((await A.getMyCreatedTasks({ status: 'completed' })).map(x => x.task_uid).join(), 't1001', 'created completed');
log.length = 0; ok((await A.completeMyTask('t1003')).ok && pings(log)[0].ch === ALT, 'leadership task completion → ALT'); pass('completion');

// ── personal reminders ──
const future = Date.now() + 3 * 86400000;
as('tok-l1'); await failsWith(() => A.createMyReminder({ epochMs: future, targetType: 'Role', targetId: TL_ROLE }), /message/i, 'reminder no message');
await failsWith(() => A.createMyReminder({ message: 'x', targetType: 'Role', targetId: TL_ROLE }), /date and time/i, 'reminder no epoch');
await failsWith(() => A.createMyReminder({ message: 'x', epochMs: Date.now() - 1000, targetType: 'Role', targetId: TL_ROLE }), /future/, 'reminder in the past');
await failsWith(() => A.createMyReminder({ message: 'x', epochMs: future, targetType: 'User', targetId: '555' }), /roster/, 'reminder bad target');
as('tok-et'); await failsWith(() => A.createMyReminder({ message: 'x', epochMs: future, targetType: 'Role', targetId: TL_ROLE }), /read-only/, 'ET reminder');
as('tok-l1'); log.length = 0; const rem = await A.createMyReminder({ message: 'Team lead sync', epochMs: future, targetType: 'Role', targetId: TL_ROLE, eventType: 'OOC Meeting', note: 'agenda' });
{ const p = pings(log); ok(rem.ok && queryOne('SELECT status FROM reminders WHERE uuid=?', [rem.uuid]).status === 'ACTIVE' && p[0].ch === EVENT && p[0].embeds === 1 && lastAudit().target_id === rem.uuid, 'reminder → EVENT embed, audited'); }
log.length = 0; { const r = await A.createMyReminder({ message: 'Leadership sync', epochMs: future, targetType: 'Role', targetId: LEAD_ROLE }); ok(r.ok && queryOne('SELECT channel_id FROM reminders WHERE uuid=?', [r.uuid]).channel_id === ALT && pings(log)[0].ch === ALT, 'leadership reminder stored on ALT'); }
{ const r = await A.getMyReminders(); ok(r.some(x => x.uuid === rem.uuid) && !r.some(x => x.uuid === 'rem001'), 'L1 sees own, not the lead-role one'); }
as('tok-l2'); ok((await A.getMyReminders()).some(x => x.uuid === 'rem001'), 'L2 sees rem001');
as('tok-l1'); await failsWith(() => A.snoozeMyReminder('rem001'), /author or a team lead/, 'snooze other'); await failsWith(() => A.snoozeMyReminder('nope'), /not found/i, 'snooze unknown');
const beforeMs = parseInt(queryOne("SELECT epoch_ms FROM reminders WHERE uuid='rem001'").epoch_ms);
as('tok-l2'); ok((await A.snoozeMyReminder('rem001')).ok && parseInt(queryOne("SELECT epoch_ms FROM reminders WHERE uuid='rem001'").epoch_ms) === beforeMs + 3600000 && lastAudit().target_type === 'reminder' && /Snoozed/.test(lastAudit().details), 'snooze +1h audited');
as('tok-l1'); await failsWith(() => A.editMyReminder('rem001', { epochMs: future, note: 'x' }), /author or a team lead/, 'edit other');
await failsWith(() => A.editMyReminder('nope', { epochMs: future, note: 'x' }), /not found/i, 'edit unknown');
await failsWith(() => A.editMyReminder(rem.uuid, { epochMs: Date.now() - 1000, note: 'x' }), /future/, 'edit into the past');
await failsWith(() => A.editMyReminder(rem.uuid, { epochMs: future }), /required/, 'edit with no details');
log.length = 0; { const at = future + 7200000; const r = await A.editMyReminder(rem.uuid, { epochMs: at, eventType: 'OOC Meeting', note: 'moved' }); const row = queryOne('SELECT * FROM reminders WHERE uuid=?', [rem.uuid]);
  ok(r.ok && parseInt(row.epoch_ms) === at && row.message === '[OOC Meeting] moved' && row.status === 'ACTIVE' && lastAudit().target_id === rem.uuid && /Rescheduled/.test(lastAudit().details) && pings(log)[0].ch === EVENT, 'edit reschedules, re-arms, audits, posts update'); }
as('tok-l1'); await failsWith(() => A.deleteMyReminder('rem001'), /author or a team lead/, 'delete other');
ok((await A.deleteMyReminder(rem.uuid)).ok && !queryOne('SELECT 1 FROM reminders WHERE uuid=?', [rem.uuid]) && lastAudit().action === 'DELETE', 'delete own');
as('tok-l2'); await failsWith(() => A.deleteMyReminder('nope'), /not found/i, 'delete unknown'); pass('reminders');

// ── recurring instances ──
run("INSERT INTO recurring_reminder_instances (reminder_id, year, month, recipient_id, recipient_name) VALUES (1, 2026, 10, ?, 'Guide One'), (1, 2026, 11, ?, 'Guide One'), (1, 2026, 11, ?, 'Lead Two')", [L1, L1, L2]);
as('tok-l1'); eq((await A.getMyRecurringInstances()).length, 2, 'both months listed');
as('tok-l2'); await failsWith(() => A.completeMyRecurringInstance(1), /own instance/, 'not mine');
as('tok-l1'); ok((await A.completeMyRecurringInstance(1)).ok && queryOne('SELECT completed_by_id FROM recurring_reminder_instances WHERE id=1').completed_by_id === L1 && /^\d{4}-\d\d-\d\dT/.test(queryOne('SELECT completed_at FROM recurring_reminder_instances WHERE id=1').completed_at), 'complete mine (ISO)');
await failsWith(() => A.completeMyRecurringInstance(1), /Already completed/, 'twice');
as('tok-l3'); ok((await A.completeMyRecurringInstance(3)).ok, 'L3 completes for others');
as('tok-l1'); await failsWith(() => A.completeMyRecurringInstance(9999), /not found/i, 'unknown instance'); await failsWith(() => A.completeMyRecurringInstance('x'), /not found/i, 'bad instance id'); pass('recurring instances');
