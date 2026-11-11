// Team workspace actions (dashboard/src/app/fm/teams/actions.js): team reads,
// task lifecycle from the team view, reminders, IC contacts and RP staging.
import { as, ok, eq, rejects, failsWith, pass, captureDiscord, pings } from '../lib.mjs';
import { queryOne, run } from '../../../shared/db.js';
const log = captureDiscord((e) => /\/messages\?/.test(e.url) ? { json: [{ id: '1', content: 'hi', author: { username: 'u', bot: false }, timestamp: '2026-11-10T00:00:00Z' }] } : null);
const A = await import('../../../dashboard/src/app/fm/teams/actions.js');
const L1 = '100000000000000001', L2 = '100000000000000002', L3 = '100000000000000003', OWNER = '738214924760907907';
const LEAD_ROLE = '900000000000000001', GUIDE_ROLE = '900000000000000003', ALT = '1494694133862760578';

// ── reads ──
as('tok-expired'); await rejects(() => A.getTeams(), 'AUTH_REQUIRED', 'getTeams expired');
as('tok-l1'); const teams = await A.getTeams(); ok(teams.length >= 2, 'teams listed');
{ const cup = teams.find(x => x.id === 'team_cup'); ok(cup.leads.some(l => l.discordId === OWNER) && !cup.guides.some(g => g.discordId === OWNER), 'owner (L3) is a lead, not a guide'); }
{ const r = await A.getTeamTasks('team_cup'); ok(r.some(t => t.task_uid === 't1002') && r.every(t => t.targetLabel && t.claimerName), 'team tasks decorated'); }
eq((await A.getTeamTasks('team_pumpkin')).length, 0, 'L3 member task invisible to L1'); as('tok-l3'); ok((await A.getTeamTasks('team_cup')).some(t => t.task_uid === 't1002'), 'L3 team tasks');
eq((await A.getTeamTasks(null)).length, 0, 'bad team arg'); as('tok-l1'); ok(Array.isArray(await A.getTeamReminders('team_cup')), 'team reminders');
eq((await A.getMyTasks()).map(t => t.task_uid).sort().join(), 't1001,t1002', 'L1 my tasks');
as('tok-l2'); { const r = await A.getMyTasks(); ok(r.some(t => t.task_uid === 't1001') && r.some(t => t.task_uid === 't1002'), 'L2 my tasks incl. created'); }
as('tok-l3'); ok((await A.getMyTasks()).some(t => t.task_uid === 't1003'), 'L3 sees leadership task');
as('tok-l1'); eq((await A.getMyReminders()).length, 0, 'L1 no reminders'); as('tok-l2'); { const r = await A.getMyReminders(); ok(r.length === 1 && r[0].authorName === 'Lead Two', 'L2 own reminder'); }
as('tok-l3'); eq((await A.getMyReminders()).length, 1, 'L3 sees lead-role reminder');
as('tok-l1'); ok(!(await A.getStaffList()).some(s => s.discord_id.startsWith('placeholder')), 'staff list excludes placeholder');
{ const r = await A.getRoleTargets(); ok(r.teams.length === 3 && r.leadershipId === LEAD_ROLE, 'role targets'); } pass('reads');

// ── createTask ──
as('tok-expired'); await rejects(() => A.createTask({ desc: 'x', targetId: 'team_cup', targetType: 'Role' }), 'AUTH_REQUIRED', 'create expired');
as('tok-l1'); log.length = 0; const c1 = await A.createTask({ desc: 'Team task from L1', targetId: 'team_cup', targetType: 'Role' });
{ const p = pings(log); ok(c1.ok && c1.uid && p.length === 1 && p[0].comps[0] === `tsk:claim:${c1.uid}`, 'team task pinged with claim button'); }
ok(/^\d{4}-\d{2}-\d{2}T/.test(queryOne('SELECT created_at FROM tasks WHERE task_uid=?', [c1.uid]).created_at), 'ISO created_at');
eq(queryOne("SELECT target_id FROM site_audit_log WHERE target_type='task' ORDER BY id DESC LIMIT 1").target_id, c1.uid, 'audit target is uid');
log.length = 0; const c2 = await A.createTask({ desc: 'L1 asks leadership', targetId: LEAD_ROLE, targetType: 'Role', enableDM: true });
ok(c2.ok && pings(log)[0]?.ch === ALT, 'leadership target → ALT'); { const r = queryOne('SELECT notify_creator, next_reminder FROM tasks WHERE task_uid=?', [c2.uid]); ok(r.notify_creator === 1 && r.next_reminder, 'notify_creator + DM reminder'); }
await failsWith(() => A.createTask({ targetId: 'team_cup', targetType: 'Role' }), /description/i, 'no desc'); await failsWith(() => A.createTask({ desc: 'x', targetId: 'abc', targetType: 'Banana' }), /Role or User/, 'bad type');
await failsWith(() => A.createTask({ desc: 'x', targetId: '555', targetType: 'User' }), /roster/, 'unknown user'); ok((await A.createTask({ desc: 123, targetId: 'team_cup', targetType: 'Role' })).ok, 'numeric desc coerced');
as('tok-l3'); log.length = 0; ok((await A.createTask({ desc: 'self note', targetId: L3, targetType: 'User' })).ok && pings(log).length === 0, 'self-assign no ping'); pass('createTask');

// ── claim / complete / unclaim / edit ──
as('tok-l1'); ok((await A.claimTask(c1.uid, { enableDM: true })).ok, 'claim with DM');
{ const r = queryOne('SELECT claimed_by, next_reminder FROM tasks WHERE task_uid=?', [c1.uid]); ok(r.claimed_by === L1 && r.next_reminder, 'claimed as actor + reminder'); }
await failsWith(() => A.claimTask(c1.uid), /already/i, 'claim twice'); as('tok-l2'); await failsWith(() => A.claimTask(c1.uid), /Guide One/, 'claim names holder');
as('tok-l1'); await failsWith(() => A.claimTask('t1003'), /not visible/, 'claim invisible'); await failsWith(() => A.claimTask('nope'), /not found/i, 'claim unknown');
await failsWith(() => A.completeTask('t1003'), /not visible/, 'complete invisible'); ok((await A.completeTask(c1.uid, 'all done')).ok, 'complete');
{ const r = queryOne('SELECT status, completion_note, completed_by_id FROM tasks WHERE task_uid=?', [c1.uid]); ok(r.status === 'completed' && r.completion_note === 'all done' && r.completed_by_id === L1, 'soft completed'); }
await failsWith(() => A.completeTask(c1.uid), /already/, 'complete twice'); ok((await A.unclaimTask('t1002', 'busy')).ok, 'unclaim own'); await failsWith(() => A.unclaimTask('t1002'), /not claimed/, 'unclaim unclaimed');
as('tok-expired'); await rejects(() => A.unclaimTask('t1002'), 'AUTH_REQUIRED', 'unclaim expired');
as('tok-l1'); await failsWith(() => A.editTask('t1001', 'nope'), /creator/, 'L1 edit other'); as('tok-l2'); ok((await A.editTask('t1001', 'Update Vanguard HQ notes (edited)')).ok, 'L2 edit'); await failsWith(() => A.editTask('t1001', '   '), /description/i, 'blank edit'); pass('claim / complete / edit');

// ── reassign ──
as('tok-l1'); await failsWith(() => A.reassignTask('t1001', L2, 'User'), /team leads/i, 'L1 reassign');
as('tok-l2'); await failsWith(() => A.reassignTask('t1001', LEAD_ROLE, 'Role'), /leadership/, 'L2 → leadership role'); await failsWith(() => A.reassignTask('t1001', L3, 'User'), /leadership/, 'L2 → L3');
await failsWith(() => A.reassignTask('t1001', '555', 'User'), /roster/, 'reassign unknown'); await failsWith(() => A.reassignTask('t1001', 'team_pumpkin', 'Team'), /Role or User/, 'Team type refused here');
ok((await A.reassignTask('t1001', 'team_pumpkin', 'Role', 'please')).ok, 'reassign to team role');
as('tok-l3'); log.length = 0; ok((await A.reassignTask('t1001', LEAD_ROLE, 'Role')).ok && pings(log).some(x => x.ch === ALT), 'L3 → leadership'); pass('reassign');

// ── questions ──
as('tok-l1'); await failsWith(() => A.requestTaskInfo('t1001', 'which?'), /visible/, 'ask on now-invisible task');
as('tok-l3'); ok((await A.reassignTask('t1001', GUIDE_ROLE, 'Role')).ok, 'reassign back to guides');
as('tok-l1'); log.length = 0; const qi = await A.requestTaskInfo('t1001', 'which notes?'); ok(qi.ok && pings(log)[0]?.comps[0]?.startsWith('task_info_btn_'), 'question with Answer button');
await failsWith(() => A.requestTaskInfo('t1001', ''), /question/i, 'blank question'); ok((await A.getTaskQuestions('t1001')).length >= 2, 'questions listed');
await failsWith(() => A.answerTaskQuestion(qi.id, 'these'), /creator/, 'answer not creator'); as('tok-l3'); ok((await A.answerTaskQuestion(qi.id, 'these ones')).ok, 'creator answers'); await failsWith(() => A.answerTaskQuestion('abc', 'x'), /not found/i, 'bad id');
as('tok-l1'); eq(await A.getTaskByUid('t1003'), null, 'invisible → null'); eq((await A.getTaskByUid('t1001')).targetLabel, 'All FM', 'decorated'); pass('questions');

// ── reminders ──
log.length = 0; const rem = await A.createReminder({ message: '[OOC Meeting] sync', epochMs: Date.now() + 3600000, eventType: 'OOC Meeting', note: 'sync', targetType: 'Role', targetId: 'team_cup', enable30m: true });
ok(rem.ok && rem.uuid && pings(log).length === 1, 'reminder created + pinged'); eq(queryOne("SELECT target_id FROM site_audit_log WHERE target_type='reminder' ORDER BY id DESC LIMIT 1").target_id, rem.uuid, 'audit target uuid');
await failsWith(() => A.createReminder({ message: 'x', epochMs: 1000, targetType: 'Role', targetId: 'team_cup' }), /date|future/i, 'past'); await failsWith(() => A.createReminder({ epochMs: Date.now() + 1e6, targetType: 'Role', targetId: 'team_cup' }), /message/i, 'no message');
await failsWith(() => A.createReminder({ message: 'x', epochMs: Date.now() + 1e6, targetType: 'User', targetId: 'nobody' }), /roster/, 'bad target'); await failsWith(() => A.createReminder(undefined), null, 'undefined');
log.length = 0; ok((await A.createReminder({ message: 'x', epochMs: Date.now() + 1e6, targetType: 'Role', targetId: LEAD_ROLE })).ok && pings(log)[0]?.ch === ALT, 'leadership reminder → ALT');
await failsWith(() => A.snoozeReminder('rem001'), /author/, 'snooze other'); ok((await A.snoozeReminder(rem.uuid)).ok, 'snooze own'); await failsWith(() => A.snoozeReminder('zzz'), /not found/i, 'snooze unknown');
await failsWith(() => A.deleteReminder('rem001'), /author/, 'delete other'); as('tok-l2'); ok((await A.deleteReminder(rem.uuid)).ok, 'team lead deletes'); pass('reminders');

// ── IC contacts ──
as('tok-l1'); { const r = await A.getTeamIcContacts('team_cup'); ok(r.length === 1 && r[0].faction_name === 'The Vanguard', 'team contacts'); } eq((await A.getTeamIcContacts('nope')).length, 0, 'unknown team');
await rejects(() => A.getAllIcContacts(), 'AUTH_INSUFFICIENT', 'L1 all contacts'); as('tok-l2'); { const r = await A.getAllIcContacts(); ok(r.length === 1 && r[0].team_name === 'Team Cup', 'L2 scoped'); } as('tok-l3'); eq((await A.getAllIcContacts()).length, 1, 'L3 all');
run("INSERT INTO faction_ic_contacts (faction_id, faction_name, sender_name, message, status) VALUES (4,'Harbor Syndicate','Ivan','Need HQ','pending_discussion'),(3,'Old Crew','Ghost','old','pending_discussion')");
as('tok-l1'); ok((await A.assignIcContact(1, L2, 'client-supplied-name-ignored')).ok, 'assign contact');
{ const r = queryOne('SELECT assigned_to, assigned_name FROM faction_ic_contacts WHERE id=1'); ok(r.assigned_to === L2 && r.assigned_name === 'Lead Two', 'assignee name resolved server-side'); }
{ const a = queryOne("SELECT target_id, target_label FROM site_audit_log WHERE target_type='ic_contact' ORDER BY id DESC LIMIT 1"); ok(a.target_id === '1' && /Vanguard/.test(a.target_label), 'contact audit'); }
await failsWith(() => A.assignIcContact(2, L1), /outside your team/, 'assign other team'); await failsWith(() => A.assignIcContact(3, L1), /archived/, 'assign archived'); await failsWith(() => A.assignIcContact(999, L1), /not found/i, 'assign unknown'); await failsWith(() => A.assignIcContact(1, null), /roster/, 'assign null');
await failsWith(() => A.setIcContactStatus(1, 'garbage'), /Invalid/, 'bad status'); await failsWith(() => A.setIcContactStatus(1, 'completed'), /Invalid/, 'completed via set refused');
ok((await A.setIcContactStatus(1, 'pending_roleplay')).ok, 'status ok'); await failsWith(() => A.setIcContactStatus(2, 'pending_roleplay'), /outside/, 'status scope'); as('tok-l3'); ok((await A.setIcContactStatus(2, 'pending_roleplay')).ok, 'L3 status');
as('tok-l1'); { const f = await A.getIcContactFormData(1); ok(f.npcs.length > 0 && f.properties.length === 2 && f.scoped === false, 'form data'); } { const f = await A.getIcContactFormData(999); ok(f.error && f.npcs.length === 0, 'form data unknown'); }
eq((await A.getThreadMessages('123')).length, 0, 'non-contact thread'); run("UPDATE faction_ic_contacts SET thread_id='610000000000000009' WHERE id=1"); eq((await A.getThreadMessages('610000000000000009')).length, 1, 'contact thread fetched'); pass('IC contacts');

// ── stageRoleplay ──
await rejects(() => A.stageRoleplay(1, { type: 'NPC' }), 'AUTH_INSUFFICIENT', 'stage L1'); as('tok-et'); await rejects(() => A.stageRoleplay(1, { type: 'NPC' }), 'AUTH_INSUFFICIENT', 'stage ET');
as('tok-l2'); await failsWith(() => A.stageRoleplay(1, undefined), /type/, 'undefined rpData'); await failsWith(() => A.stageRoleplay(1, { type: 'Tier', newValue: '3' }), /type/, 'Tier type');
await failsWith(() => A.stageRoleplay(1, { type: 'NPC', newValue: 'Fence' }), /Pick the NPC/, 'NPC without id'); await failsWith(() => A.stageRoleplay(1, { type: 'NPC', npcId: 999, newValue: 'Fence' }), /no longer/, 'NPC unknown'); await failsWith(() => A.stageRoleplay(1, { type: 'NPC', npcId: 1, newValue: 'Dealer' }), /same/, 'NPC same type');
log.length = 0; const s1 = await A.stageRoleplay(1, { type: 'NPC', npcId: 1, newValue: 'Fence' });
{ const p = pings(log); ok(s1.ok && s1.id && p.some(x => x.ch === ALT && x.comps[0] === `rpc:approve:${s1.id}`) && p.some(x => x.ch === '610000000000000009'), 'staged: approval ping + thread note'); }
{ const r = queryOne('SELECT * FROM pending_executions WHERE id=?', [s1.id]); ok(r.npc_id === 1 && r.contact_id === 1 && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.turf === 'Grove Street' && r.old_value === 'Dealer' && r.requester_id === L2, 'execution row'); }
{ const r = queryOne('SELECT status, rp_change_id FROM faction_ic_contacts WHERE id=1'); ok(r.status === 'pending_roleplay' && r.rp_change_id === s1.id, 'contact linked'); }
eq(queryOne("SELECT target_id FROM site_audit_log WHERE target_type='rp_change' ORDER BY id DESC LIMIT 1").target_id, String(s1.id), 'rp audit id');
await failsWith(() => A.stageRoleplay(1, { type: 'NPC', npcId: 1, newValue: 'Vendor' }), /already pending/, 'duplicate NPC'); await failsWith(() => A.stageRoleplay(1, { type: 'NPC', turf: 'Grove Street', oldValue: 'Dealer', newValue: 'Vendor' }), /already pending/, 'duplicate via turf+type');
ok((await A.stageRoleplay(1, { type: 'HQ', oldValue: '12 Grove St', newValue: '99 New St' })).ok, 'HQ'); await failsWith(() => A.stageRoleplay(1, { type: 'HQ', oldValue: '12 Grove St', newValue: '100 Other St' }), /already pending/, 'HQ duplicate'); await failsWith(() => A.stageRoleplay(1, { type: 'HQ', newValue: '99' }), /current HQ/, 'HQ no old');
ok((await A.stageRoleplay(1, { type: 'Other', newValue: 'Rename to The Vanguard MC' })).ok, 'Other'); await failsWith(() => A.stageRoleplay(1, { type: 'Other', newValue: '  ' }), /Describe/, 'Other blank'); ok((await A.stageRoleplay(1, { type: 'TURF', turf: 'Docks', newValue: 'Claim Docks' })).ok, 'TURF');
await failsWith(() => A.stageRoleplay(2, { type: 'Other', newValue: 'x' }), /outside/, 'contact other team'); await failsWith(() => A.stageRoleplay(3, { type: 'Other', newValue: 'x' }), /archived/, 'contact archived'); await failsWith(() => A.stageRoleplay(999, { type: 'Other', newValue: 'x' }), /not found/i, 'contact unknown');
ok((await A.completeIcContact(1)).ok, 'complete contact'); await failsWith(() => A.completeIcContact(1), /already/, 'complete twice'); await failsWith(() => A.stageRoleplay(1, { type: 'Other', newValue: 'y' }), /completed/, 'stage on completed');
await failsWith(() => A.completeIcContact(2), /outside/, 'complete scope'); as('tok-expired'); await rejects(() => A.completeIcContact(2), 'AUTH_REQUIRED', 'complete expired');
as('tok-owner', L1); ok(Array.isArray(await A.getMyTasks()), 'owner view-as L1'); pass('stageRoleplay');
