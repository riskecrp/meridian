// Inbox (mentions / watch pings / forwarded DMs) scope and audit, plus the v2
// shell aggregates in dashboard/src/app/v2/actions.js.
import { as, ok, eq, rejects, failsWith, pass, captureDiscord, pings } from '../lib.mjs';
import { queryOne, run } from '../../../shared/db.js';
const log = captureDiscord();
const A = await import('../../../dashboard/src/app/fm/dashboard/actions.js');
const V = await import('../../../dashboard/src/app/v2/actions.js');
const L1 = '100000000000000001';
const lastAudit = () => queryOne('SELECT action, target_type, target_id, details FROM site_audit_log ORDER BY id DESC LIMIT 1');
const auditCount = () => queryOne('SELECT count(*) c FROM site_audit_log').c;

// ── watch pings: team scope ──
as('tok-l1'); eq((await A.getTeamWatchPings()).length, 1, 'L1 sees team watch ping');
as('tok-et'); eq((await A.getTeamWatchPings()).length, 0, 'ET without team sees none');
as('tok-lst'); eq((await A.getTeamWatchPings()).length, 1, 'LST sees all');
as('tok-et'); await failsWith(() => A.markWatchPingRead(1), /outside your team/, 'mark read out of scope');
as('tok-l1'); await failsWith(() => A.markWatchPingRead(999), /not found/i, 'mark read unknown');
await failsWith(() => A.replyToWatchPing(1, ''), /empty/, 'empty reply');
as('tok-et'); await failsWith(() => A.replyToWatchPing(1, 'hi'), /read-only/, 'ET cannot reply');
as('tok-l1'); const ac0 = auditCount(); log.length = 0;
ok((await A.replyToWatchPing(1, 'on it')).ok, 'reply in scope');
{ const p = pings(log); ok(auditCount() === ac0 + 1 && lastAudit().action === 'SEND' && lastAudit().target_type === 'discord_reply' && p[0].reply && queryOne('SELECT is_read FROM watch_role_mentions WHERE id=1').is_read === 1, 'reply audited, sent as Discord reply, marks read'); }
ok((await A.markWatchPingRead(1)).ok, 'mark read in scope'); pass('watch pings');

// ── mentions / leadership mentions / DMs ──
as('tok-l1'); await failsWith(() => A.markMentionRead(1), /not found/i, 'mention not mine'); await failsWith(() => A.replyToMention(1, 'x'), /not found/i, 'reply mention not mine');
as('tok-owner'); ok((await A.replyToMention(1, 'thanks')).ok && lastAudit().action === 'SEND' && queryOne('SELECT is_read FROM mentions WHERE id=1').is_read === 1, 'owner replies to own mention');
as('tok-l2'); await failsWith(() => A.replyToLeadershipMention(1, 'ack'), /Insufficient/, 'L2 leadership mention');
as('tok-l3'); ok((await A.replyToLeadershipMention(1, 'ack')).ok && lastAudit().action === 'SEND', 'L3 replies to leadership mention');
await failsWith(() => A.replyToLeadershipMention(99, 'ack'), /not found/i, 'unknown leadership mention');
as('tok-owner'); { const r = await A.toggleDMTracking(true); ok(r.enabled === true && /DM forwarding enabled/.test(lastAudit().details), 'DM tracking toggle audited'); }
eq(typeof (await A.getInboxUnreadCount()).unread, 'number', 'unread count');
as('tok-l1'); await failsWith(() => A.deleteDM(1), /not found/i, 'delete DM not mine');
as('tok-owner'); ok((await A.deleteDM(1)).ok && !queryOne('SELECT 1 FROM forwarded_dms WHERE id=1') && lastAudit().target_type === 'forwarded_dm', 'delete own DM audited');
await failsWith(() => A.markDMRead(1), /not found/i, 'mark deleted DM'); pass('mentions + DMs');

// ── v2 aggregates ──
as('tok-l1'); { const d = await V.getAllDocuments(); ok(d.length === 1 && d[0].content !== undefined, 'L1 documents gated by level'); }
as('tok-et'); { const d = await V.getAllDocuments({ titlesOnly: true }); ok(d.length === 1 && d[0].content === undefined, 'ET guide-level, titles only'); }
as('tok-l3'); eq((await V.getAllDocuments()).length, 2, 'L3 all documents');
as('tok-lst'); { const f = await V.getFactionFleetSummary(1); ok(f?.limits?.isOverridden === true && f.stipend === 4000, 'LST fleet summary (override from seed)'); }
as('tok-l1'); eq(await V.getFactionFleetSummary(999), null, 'fleet summary unknown faction');
as('tok-l3'); await failsWith(() => V.getRPExecuteTarget(1), /No NPC of type/, 'seed old_value is a name, not a type → no match');
run('UPDATE pending_executions SET npc_id = 1 WHERE id = 1');
{ const r = await V.getRPExecuteTarget(1); ok(r.ok && r.target?.name === 'Big Smoke' && r.type === 'NPC' && r.status === 'PENDING', 'RP execute target resolves by npc_id'); }
await failsWith(() => V.getRPExecuteTarget(999), /not found/i, 'RP target unknown');
as('tok-l2'); await rejects(() => V.getRPExecuteTarget(1), 'AUTH_INSUFFICIENT', 'RP target L2');
run("INSERT INTO recurring_reminder_instances (reminder_id, year, month, recipient_id, recipient_name) VALUES (1, 2026, 10, ?, 'Guide One'), (1, 2026, 11, ?, 'Guide One')", [L1, L1]);
as('tok-l1'); { const a = await V.getMyAttention(); ok(a.reminderInstances.length === 2 && a.counts.reminders === 2 && a.reminderInstances.every(i => i.year && i.month), 'attention lists all open instances incl. last month'); }
ok((await V.completeMyReminderInstance(1)).ok, 'v2 completes an instance'); await failsWith(() => V.completeMyReminderInstance(1), /Already completed/, 'v2 instance twice');
as('tok-lst'); ok((await V.getMyAttention()).counts.approvals >= 0, 'LST attention');
as('tok-et'); eq((await V.getMyAttention()).counts.inboxUnread, 0, 'ET counts no leadership mentions');
pass('v2 aggregates');
