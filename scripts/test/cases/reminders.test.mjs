// Recurring reminders, FM hours and the pings admin
// (dashboard/src/app/fm/operations/{reminders,fmhours,pings}/actions.js).
import { as, ok, eq, rejects, failsWith, pass, captureDiscord, pings } from '../lib.mjs';
import { queryOne, run } from '../../../shared/db.js';
const flags = { discordFail: false };
const log = captureDiscord((e) => flags.discordFail && e.url.includes('discord.com') ? { status: 403, text: 'forbidden', json: {} } : null);
const R = await import('../../../dashboard/src/app/fm/operations/reminders/actions.js');
const H = await import('../../../dashboard/src/app/fm/operations/fmhours/actions.js');
const P = await import('../../../dashboard/src/app/fm/operations/pings/actions.js');
const lastAudit = () => queryOne('SELECT target_type, details FROM site_audit_log ORDER BY id DESC LIMIT 1');
const instances = (id) => queryOne('SELECT COUNT(*) c FROM recurring_reminder_instances WHERE reminder_id=?', [id]).c;

// ── recurring reminders ──
as('tok-l1'); await rejects(() => R.listReminders(), 'AUTH_INSUFFICIENT', 'L1 list');
as('tok-l2'); eq((await R.listReminders()).length, 0, 'L2 does not see the role-targeted reminder'); as('tok-l3'); eq((await R.listReminders()).length, 1, 'L3 sees it');
as('tok-l2'); { const o = await R.getTargetOptions(); ok(o.teams.length === 1 && o.roles.length === 0 && o.staff.every(s => s.team_id === 'team_cup'), 'L2 targets: own team, no roles'); }
await failsWith(() => R.createReminder({ title: 'x', target_type: 'Role', target_id: '900000000000000003', channel_id: '800000000000000001', ping_day: 1 }), null, 'L2 cannot target a role');
await failsWith(() => R.createReminder({ title: 'x', target_type: 'Team', target_id: 'team_pumpkin', channel_id: '800000000000000001', ping_day: 1 }), null, 'other team');
await failsWith(() => R.createReminder({ title: 'x', target_type: 'Team', target_id: 'team_cup', channel_id: 'nochannel', ping_day: 1 }), null, 'bogus channel'); await failsWith(() => R.createReminder({ title: 'x', target_type: 'Team', target_id: 'team_cup', channel_id: '800000000000000001', ping_day: 'abc' }), null, 'ping_day NaN');
const rid = (await R.createReminder({ title: 'Team hours', body: 'Log hours', target_type: 'Team', target_id: 'team_cup', channel_id: '700000000000000001', ping_day: 2, due_day: 5 })).id; ok(rid > 0, 'L2 creates for own team');
eq((await R.listReminders()).length, 1, 'L2 sees own'); await failsWith(() => R.updateReminder(1, { title: 'hack' }), null, 'L2 cannot edit the leadership reminder');
ok((await R.updateReminder(rid, { title: 'Team hours!' })).ok && queryOne('SELECT target_id FROM recurring_reminders WHERE id=?', [rid]).target_id === 'team_cup', 'partial update keeps target');
await rejects(() => R.forceSendRecurringReminder(rid), 'AUTH_INSUFFICIENT', 'L2 force send');
as('tok-l3'); log.length = 0; { const r = await R.forceSendRecurringReminder(1); ok(r.ok && r.recipientsCount === 1 && r.instancesCreated === 1 && pings(log).some(p => p.ch === '800000000000000001' && p.embeds === 1), 'force send: Lead Two only, instance created, embed sent'); }
{ const r = await R.forceSendRecurringReminder(1); ok(r.ok && r.instancesCreated === 0 && r.resent, 'resend creates no instances'); }
run("UPDATE recurring_reminders SET target_id='900000000000000003' WHERE id=1"); eq((await R.forceSendRecurringReminder(1)).recipientsCount, 4, 'guide role → 4 recipients (no clearance 0 / placeholder)'); run("UPDATE recurring_reminders SET target_id='900000000000000002' WHERE id=1");
{ flags.discordFail = true; const before = instances(rid); await failsWith(() => R.forceSendRecurringReminder(rid), null, 'Discord 403 is a real failure'); eq(instances(rid), before, 'no instances on failure'); flags.discordFail = false;
  run("UPDATE ping_routes SET enabled=0 WHERE key='reminder.recurring'"); await failsWith(() => R.forceSendRecurringReminder(rid), null, 'route off'); eq(instances(rid), before, 'no instances when muted'); run("UPDATE ping_routes SET enabled=1 WHERE key='reminder.recurring'"); }
await failsWith(() => R.adminCompleteInstance(999), null, 'complete unknown instance'); ok((await R.adminCompleteInstance(queryOne('SELECT id FROM recurring_reminder_instances WHERE reminder_id=1 LIMIT 1').id)).ok, 'admin completes instance');
as('tok-l2'); ok((await R.deleteReminder(rid)).ok && queryOne('SELECT active FROM recurring_reminders WHERE id=?', [rid]).active === 0, 'delete deactivates'); pass('recurring reminders');

// ── fm hours ──
as('tok-l1'); await rejects(() => H.getFMStaffWithLinks(), 'AUTH_INSUFFICIENT', 'L1 hours staff');
as('tok-l2'); { const r = await H.getFMStaffWithLinks(); ok(r.every(s => s.team_id === 'team_cup') && r.length === 3, 'L2 own team, no clearance 0'); } as('tok-l3'); eq((await H.getFMStaffWithLinks()).length, 4, 'L3 all FM staff (no ET/LST/placeholder)');
await failsWith(() => H.setCharacterLink('100000000000000099', 'Ghost', 'support'), null, 'link non-staff'); ok((await H.setCharacterLink('100000000000000001', null, 'support')).ok, 'null name tolerated');
as('tok-l2'); await failsWith(() => H.setCharacterLink('100000000000000003', 'X', 'moderator'), null, 'link other team'); ok((await H.setCharacterLink('100000000000000001', 'Johnny Guide', 'support')).ok && lastAudit().target_type === 'fm_character_link', 'link own + audit');
as('tok-l3'); await failsWith(() => H.saveFMHours('garbage', [{ discord_id: '100000000000000001', hours: 1 }]), null, 'bad period'); await failsWith(() => H.saveFMHours('2026-11', [{ discord_id: '100000000000000001', hours: 'abc' }]), null, 'hours text saves nothing');
{ const r = await H.saveFMHours('2026-11', [{ discord_id: '100000000000000001', hours: '12.5' }, { discord_id: '100000000000000003', hours: -1 }, { discord_id: 'nope', hours: 1 }]); ok(r.ok && r.saved === 1 && r.skipped.length === 2 && queryOne("SELECT hours FROM fm_hours_log WHERE discord_id='100000000000000001' AND period='2026-11'").hours === 12.5, 'mixed rows: 1 saved, 2 skipped'); }
as('tok-l2'); await failsWith(() => H.saveFMHours('2026-11', [{ discord_id: '100000000000000003', hours: 1 }]), null, 'hours other team');
as('tok-l3'); run("INSERT OR REPLACE INTO fm_hours_log (discord_id, period, hours) VALUES ('100000000000000002','2026-11','abc')");
ok(Object.keys(await H.getFMScenesForPeriod('2026', '11')).length > 0, 'scenes per period (strings coerced)'); eq((await H.getFMMeetingsForPeriod(2026, 11))['100000000000000002'], 1, 'meetings per period');
as('tok-l2'); await rejects(() => H.postFMReport({ period: '2026-11', testMode: true }), 'AUTH_INSUFFICIENT', 'L2 report'); as('tok-l3'); await failsWith(() => H.postFMReport({ period: 'garbage', testMode: true }), null, 'report bad period');
log.length = 0; ok((await H.postFMReport({ period: '2026-11', testMode: true })).ok && pings(log).some(p => p.embeds === 1) && lastAudit().target_type === 'fm_hours_report', 'report posted despite a bad hours row, audited');
delete process.env.DISCORD_BOT_TOKEN; await failsWith(() => H.postFMReport({ period: '2026-11', testMode: true }), /token not configured/, 'report without token'); pass('fm hours');

// ── pings admin ──
await failsWith(() => P.testPing('rp.done', {}), /token not configured/, 'test ping without token');
{ const c = await P.getPingConfig(); ok(c.directoryError && c.routes.length > 0 && c.channels.length === 0, 'config degrades without token'); }
process.env.DISCORD_BOT_TOKEN = 'test-token';
await failsWith(() => P.updatePingRoute('rp.done', { channel_id: 'not-a-snowflake' }), null, 'route channel must be a snowflake');
ok((await P.updatePingRoute('task.reminder.dm', { channel_id: '800000000000000001', enabled: true })).ok && queryOne("SELECT channel_id FROM ping_routes WHERE key='task.reminder.dm'").channel_id === '', 'DM route ignores channel');
ok((await P.updatePingRoute('rp.done', { channel_id: '800000000000000002', mention_roles: ['900000000000000001', 'bad', '900000000000000001'] })).ok && queryOne("SELECT mention_roles FROM ping_routes WHERE key='rp.done'").mention_roles === '["900000000000000001"]', 'mentions validated + deduped');
delete process.env.DISCORD_BOT_TOKEN; await failsWith(() => R.forceSendRecurringReminder(1), /token not configured/, 'force send without token'); pass('pings admin');
