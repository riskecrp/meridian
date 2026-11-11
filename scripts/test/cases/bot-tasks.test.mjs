// Bot task surfaces: /todo, the task buttons + completion modal, the claimer
// reminder job and the DM command handler, all through shared/tasks.js.
import { ok, eq, pass, captureDiscord, pings } from '../lib.mjs';
import { query, queryOne, run } from '../../../shared/db.js';
import { fakeInteraction, fakeClient, replyText, callOf, IDS, ROLES } from '../harness/discord-fakes.mjs';
process.env.BASE_URL = 'http://localhost:3000';
const log = captureDiscord();
const MAIN = '1457201300583485491', ALT = '1494694133862760578';
const chans = () => pings(log).map(p => p.ch + (p.comps.length ? '+btn' : ''));
const audit = () => queryOne('SELECT source, target_id, details FROM site_audit_log ORDER BY id DESC LIMIT 1');

// ── /todo ──
const todo = (await import('../../../bot/commands/todo.js')).default;
const todoRun = async (o) => { const i = fakeInteraction(o); await todo.execute(i); return i; };
ok(/FM staff only/.test(replyText(await todoRun({ id: IDS.nobody, sub: 'list' }))), 'non-staff refused');
{ const d = callOf(await todoRun({ id: IDS.l1, sub: 'list' }), 'reply').embeds[0].data.description; ok(/t1002/.test(d) && /t1001/.test(d) && !/t1003/.test(d) && /v2\/tasks\/t1002/.test(d), 'L1 list: assigned + team, no leadership task, v2 links'); }
ok(/t1003/.test(callOf(await todoRun({ id: IDS.l3, sub: 'list' }), 'reply').embeds[0].data.description), 'L3 list has leadership task');
{ const p = callOf(await todoRun({ id: IDS.et, sub: 'list' }), 'reply'); ok(p && !/t1003/.test(p.embeds?.[0]?.data?.description || p.content), 'ET may list, no leadership task'); }
ok(/read-only/.test(replyText(await todoRun({ id: IDS.et, sub: 'create', opts: { description: 'ET task' } }))) && !queryOne("SELECT 1 FROM tasks WHERE description='ET task'"), 'ET create refused');
log.length = 0; { const i = await todoRun({ id: IDS.l1, sub: 'create', opts: { description: 'Self task' } }); const t = queryOne("SELECT * FROM tasks WHERE description='Self task'"); ok(t && /^[0-9a-f-]{36}$/.test(t.task_uid) && t.status === 'open' && chans().length === 0 && audit().source === 'bot' && audit().target_id === t.task_uid && /created for you/.test(replyText(i)), 'self task: uuid, no ping, audit source=bot'); }
log.length = 0; await todoRun({ id: IDS.l1, sub: 'create', opts: { description: 'Guide pings leadership', role: { id: ROLES.fm_leadership } } }); ok(chans().join() === `${ALT}+btn` && queryOne("SELECT notify_creator FROM tasks WHERE description='Guide pings leadership'").notify_creator === 1, 'leadership role → ALT with buttons, notify_creator');
ok(/roster/.test(replyText(await todoRun({ id: IDS.l1, sub: 'create', opts: { description: 'to nobody', user: { id: IDS.nobody } } }))) && !queryOne("SELECT 1 FROM tasks WHERE description='to nobody'"), 'user not on roster');
{ const [a, b] = [fakeInteraction({ sub: 'create', opts: { description: 'dup1' } }), fakeInteraction({ sub: 'create', opts: { description: 'dup2' } })]; await Promise.all([todo.execute(a), todo.execute(b)]); const rows = query("SELECT task_uid FROM tasks WHERE description IN ('dup1','dup2')"); ok(rows.length === 2 && rows[0].task_uid !== rows[1].task_uid, 'two creates in one tick get distinct uids'); }
ok(/not visible/.test(replyText(await todoRun({ id: IDS.l1, sub: 'complete', opts: { id: 't1003' } }))) && queryOne("SELECT status FROM tasks WHERE task_uid='t1003'").status === 'open', 'complete invisible refused');
ok(/not found/i.test(replyText(await todoRun({ sub: 'complete', opts: { id: 'nope' } }))), 'complete unknown');
log.length = 0; { const i = await todoRun({ id: IDS.l1, sub: 'complete', opts: { id: 't1001' } }); const t = queryOne("SELECT status, completed_by_id FROM tasks WHERE task_uid='t1001'"); ok(t.status === 'completed' && t.completed_by_id === IDS.l1 && chans().join() === MAIN && /completed/.test(replyText(i)), 'soft complete + creator ping'); }
{ const uid = queryOne("SELECT task_uid FROM tasks WHERE description='Self task'").task_uid; const i = await todoRun({ id: IDS.l1, sub: 'complete', opts: { id: uid.slice(0, 8) } }); ok(queryOne('SELECT status FROM tasks WHERE task_uid=?', [uid]).status === 'completed' && replyText(i).includes(uid), 'complete by uid prefix'); }
ok(/already completed/.test(replyText(await todoRun({ id: IDS.l1, sub: 'complete', opts: { id: 't1001' } }))), 'complete twice'); pass('/todo');

// ── buttons ──
const { handleTaskButton, handleTaskModal } = await import('../../../bot/taskButtons.js');
const msg = (uid) => ({ content: 'ping', components: [{ components: [{ style: 1, customId: `tsk:claim:${uid}`, label: 'Claim' }, { style: 3, customId: `tsk:done:${uid}`, label: 'Done' }, { style: 5, url: 'http://x', label: 'Open' }] }], embeds: [] });
const btn = async (o) => { const i = fakeInteraction({ message: msg(o.customId.split(':')[2]), ...o }); await handleTaskButton(i); return i; };
const modal = async (o) => { const i = fakeInteraction({ message: msg(o.customId.split(':')[1]), ...o }); await handleTaskModal(i); return i; };
ok(/FM staff only/.test(replyText(await btn({ id: IDS.nobody, customId: 'tsk:claim:t1002' }))), 'button non-staff'); ok(/read-only/.test(replyText(await btn({ id: IDS.et, customId: 'tsk:claim:t1002' }))), 'button ET read-only');
ok(/Already claimed by Guide One/.test(replyText(await btn({ id: IDS.l2, customId: 'tsk:claim:t1002' }))) && queryOne("SELECT claimed_by FROM tasks WHERE task_uid='t1002'").claimed_by === IDS.l1, 'claim already-claimed → ephemeral error');
ok(/not visible/.test(replyText(await btn({ id: IDS.l1, customId: 'tsk:claim:t1003' }))), 'claim invisible');
log.length = 0; { const u = callOf(await btn({ id: IDS.l3, customId: 'tsk:claim:t1003' }), 'update'); ok(u && /Claimed by Mgmt Three/.test(u.content) && u.components[0].components.some(c => c.custom_id === 'tsk:done:t1003') && !u.components[0].components.some(c => c.custom_id === 'tsk:claim:t1003') && chans().join() === ALT && queryOne("SELECT claimed_by FROM tasks WHERE task_uid='t1003'").claimed_by === IDS.l3, 'claim updates message, keeps Done, pings creator on ALT'); }
{ const u = callOf(await btn({ id: IDS.l1, customId: 'tsk:claim:t1001' }), 'update'); ok(u && /has been completed by Guide One/.test(u.content) && u.components[0].components.every(c => c.style === 5), 'button on completed task closes the message'); }
ok(/no longer exists/.test(callOf(await btn({ id: IDS.l1, customId: 'tsk:claim:zzz' }), 'update')?.content || ''), 'button on unknown uid');
eq(callOf(await btn({ id: IDS.l3, customId: 'tsk:done:t1003' }), 'showModal')?.customId, 'tskdonem:t1003', 'done → modal');
ok(/not visible/.test(replyText(await modal({ id: IDS.l1, customId: 'tskdonem:t1003', fields: { note: 'x' } }))), 'modal by L1 → not visible');
log.length = 0; { const i = await modal({ id: IDS.l3, customId: 'tskdonem:t1003', fields: { note: 'all sorted' } }); const t = queryOne("SELECT status, completion_note FROM tasks WHERE task_uid='t1003'"); const u = callOf(i, 'update'); ok(t.status === 'completed' && t.completion_note === 'all sorted' && chans().join() === ALT && /Completed by Mgmt Three\*\* — all sorted/.test(u?.content || '') && audit().source === 'bot' && /Discord button/.test(audit().details), 'modal completes with note, audited as bot'); }
ok(/already completed/.test(replyText(await modal({ id: IDS.l3, customId: 'tskdonem:t1003', fields: {} }))), 'modal twice');
eq(await handleTaskButton(fakeInteraction({ customId: 'rpc:approve:1' })), false, 'non-task button ignored'); pass('task buttons');

// ── taskReminder ──
const { runTaskReminders } = await import('../../../bot/taskReminder.js');
run("UPDATE tasks SET next_reminder = ? WHERE task_uid = 't1002'", [String(Date.now() - 1000)]);
run("INSERT INTO tasks (task_uid, description, target_id, target_type, claimed_by, created_by_id, created_by_name, status, next_reminder) VALUES ('rem-done','done task','x','User',?, ?, 'Lead Two','completed', ?)", [IDS.l1, IDS.l2, new Date(Date.now() - 1000).toISOString()]);
run("INSERT INTO tasks (task_uid, description, target_id, target_type, claimed_by, created_by_id, created_by_name, status, next_reminder) VALUES ('rem-future','future task','x','User',?, ?, 'Lead Two','open', ?)", [IDS.l1, IDS.l2, new Date(Date.now() + 3600000).toISOString()]);
{ const client = fakeClient(); const sent = await runTaskReminders(client); const nr = queryOne("SELECT next_reminder FROM tasks WHERE task_uid='t1002'").next_reminder;
  ok(sent === 1 && client.dms.length === 1 && client.dms[0].to === IDS.l1 && /v2\/tasks\/t1002/.test(client.dms[0].m), 'DMs the claimer of the one due open task'); ok(/^\d{4}-\d\d-\d\dT/.test(nr) && queryOne("SELECT next_reminder FROM tasks WHERE task_uid='rem-done'").next_reminder !== null, 'rescheduled as ISO; completed task untouched'); }
eq(await runTaskReminders(fakeClient()), 0, 'nothing due afterwards'); pass('taskReminder');

// ── dmHandler ──
const { handleDM } = await import('../../../bot/dmHandler.js');
const dm = async (authorId, content) => { const replies = []; await handleDM({ id: String(Date.now() + Math.random()), content, author: { id: authorId, globalName: 'X', username: 'x' }, messageSnapshots: null, reply: async (c) => { replies.push(c); } }); return replies[0]; };
eq(await dm(IDS.l1, 'tasks'), undefined, 'not opted in → silent');
run('UPDATE staff SET dm_tracking_enabled = 1 WHERE discord_id IN (?, ?, ?)', [IDS.l1, IDS.l3, IDS.et]);
ok(/claim \[id\]/.test(await dm(IDS.l1, 'help')), 'help'); { const r = await dm(IDS.l1, 'tasks'); ok(/t1002/.test(r) && !/t1003/.test(r), 'tasks list is visibility-scoped'); }
log.length = 0; { const r = await dm(IDS.l1, 'task Check the docks'); const t = queryOne("SELECT * FROM tasks WHERE description='Check the docks'"); ok(t && t.target_id === ROLES.fm_leadership && t.target_type === 'Role' && t.notify_creator === 1 && chans().join() === `${ALT}+btn` && r.includes(t.task_uid) && audit().source === 'bot' && /via DM/.test(audit().details), 'bare "task" targets leadership via shared createTask'); }
log.length = 0; { const r = await dm(IDS.l1, 'task me | my own thing'); ok(/yourself/.test(r) && chans().length === 0 && queryOne("SELECT target_id FROM tasks WHERE description='my own thing'").target_id === IDS.l1, 'task me'); }
{ const r = await dm(IDS.l1, 'task lead two | for lead'); ok(/Lead Two/.test(r) && queryOne("SELECT target_id FROM tasks WHERE description='for lead'").target_id === IDS.l2, 'task <name> resolves staff'); }
ok(/Could not find a target/.test(await dm(IDS.l1, 'task zzzzz | nope')), 'unknown target'); ok(/description/.test(await dm(IDS.l1, 'task leads |   ')), 'empty description');
{ const uid = queryOne("SELECT task_uid FROM tasks WHERE description='for lead'").task_uid; const r = await dm(IDS.l1, `claim ${uid.slice(0, 6)}`); ok(/Claimed/.test(r) && queryOne('SELECT claimed_by FROM tasks WHERE task_uid=?', [uid]).claimed_by === IDS.l1, 'claim by prefix'); }
ok(/not visible|already completed/.test(await dm(IDS.l1, 'done t1003')), 'done on invisible/completed'); ok(/No task found/.test(await dm(IDS.l1, 'done nope')), 'done unknown');
{ const uid = queryOne("SELECT task_uid FROM tasks WHERE description='my own thing'").task_uid; const r = await dm(IDS.l1, `done ${uid}`); ok(/Marked complete/.test(r) && queryOne('SELECT status FROM tasks WHERE task_uid=?', [uid]).status === 'completed', 'done own task'); }
ok(/read-only/.test(await dm(IDS.et, 'task something')) && !queryOne("SELECT 1 FROM tasks WHERE description='something'"), 'ET opted in but read-only');
{ const replies = []; const snap = { content: 'forward me', author: { id: '5', username: 'rp' }, channelId: '777', id: '888' }; await handleDM({ id: 'fwd1', content: '', author: { id: IDS.l1 }, messageSnapshots: { size: 1, first: () => snap, [Symbol.iterator]: function* () { yield ['k', snap]; } }, reply: async (c) => replies.push(c) });
  const row = queryOne("SELECT * FROM forwarded_dms WHERE message_id='fwd1'"); ok(/Logged/.test(replies[0]) && row && row.target_user_id === IDS.l1 && /^\d{4}-\d\d-\d\dT/.test(row.forwarded_at), 'forwarded message stored with ISO time'); }
ok(/Unknown command/.test(await dm(IDS.l1, 'frobnicate')), 'unknown command'); pass('dmHandler');
