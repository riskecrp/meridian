// Leadership queue (fm/operations/actions.js getLeadershipQueue) and the
// verify-in-game flag (shared/rpChanges.js verifyRPChange): L3 vs L2 scoping,
// one item of every kind, and the verify gates.
import { as, ok, eq, rejects, failsWith, pass, captureDiscord, pings } from '../lib.mjs';
import { query, queryOne, run } from '../../../shared/db.js';
const log = captureDiscord();
const A = await import('../../../dashboard/src/app/fm/operations/actions.js');
const RP = await import('../../../shared/rpChanges.js');
const month = new Date().toISOString().slice(0, 7);
const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
const audit = () => queryOne('SELECT action, target_id, target_type, source, details FROM site_audit_log ORDER BY id DESC LIMIT 1');
const newExec = (sql, p = []) => { run(sql, p); return queryOne('SELECT id FROM pending_executions ORDER BY id DESC LIMIT 1').id; };
const byKind = (q, k) => q.items.filter(i => i.kind === k);

// ── seed one of everything ──
// RP_DONE for faction 2 (no lead → outside L2's team), EXECUTED+unverified for faction 1 (L2's own, 3 days old → overdue),
// EXECUTED+unverified for faction 4 requested by L3 (outside L2's scope), EXECUTED but verified (never listed).
const eExec = newExec("INSERT INTO pending_executions (date, faction_id, execution_type, turf, old_value, new_value, requested_by, status, requester_id, rp_note, created_at) VALUES ('01/NOV/2026',2,'Other','N/A','N/A','Rename crew','Lead Two','RP_DONE','100000000000000002','played', ?)", [ago(10)]);
const eVer1 = newExec("INSERT INTO pending_executions (date, faction_id, execution_type, turf, old_value, new_value, requested_by, status, requester_id, resolved_at, created_at, contact_id) VALUES ('01/NOV/2026',1,'HQ','N/A','12 Grove St','99 New St','Lead Two','EXECUTED','100000000000000002', ?, ?, 1)", [ago(3), ago(4)]);
const eVer4 = newExec("INSERT INTO pending_executions (date, faction_id, execution_type, turf, old_value, new_value, requested_by, status, requester_id, resolved_at, created_at) VALUES ('01/NOV/2026',4,'TURF','Docks','Docks','Harbor','Mgmt Three','EXECUTED','100000000000000003', ?, ?)", [ago(0.5), ago(1)]);
newExec("INSERT INTO pending_executions (date, faction_id, execution_type, turf, old_value, new_value, requested_by, status, requester_id, resolved_at, verified_at, verified_by) VALUES ('01/NOV/2026',1,'Other','N/A','N/A','done+verified','Lead Two','EXECUTED','100000000000000002', ?, ?, 'Lead Two')", [ago(9), ago(8)]);
run("UPDATE faction_ic_contacts SET thread_id = '620000000000000001', rp_change_id = ?, status = 'completed' WHERE id = 1", [eVer1]);
// Feedback: this month's reviews, confirmed, nothing sent (faction 1 in L2's scope, faction 4 not); faction 2 pending discussion (not listed).
run("INSERT INTO faction_reviews (faction_id, review_month, recommendation, feedback, submitted_by, submitted_by_id, team_id, team_name, faction_name, status, updated_at) VALUES (1, ?, 'Promote', 'Strong', 'Lead Two', '100000000000000002', 'team_cup', 'Team Cup', 'The Vanguard', 'Confirmed Promote', ?), (4, ?, 'Hold', 'Steady', 'Mgmt Three', '100000000000000003', 'team_pumpkin', 'Team Pumpkin', 'Harbor Syndicate', 'Confirmed Hold', ?), (2, ?, 'Hold', 'Quiet', 'Lead Two', '100000000000000002', 'team_cup', 'Team Cup', 'Los Santos Kings', 'Pending Discussion', ?)",
  [month, ago(8), month, ago(1), month, ago(1)]);
// Deletion request, a second question on L2's own task, a resolved question that must not show.
run("INSERT INTO deletion_requests (requested_by, discord_id, content_type, original_text, target_row_id, status, created_at) VALUES ('Guide One', '100000000000000001', 'intel_note', 'Rumoured…', 1, 'PENDING', ?)", [ago(12)]);
run("INSERT INTO task_questions (task_uid, asked_by_id, asked_by_name, question, asked_at) VALUES ('t1002', '100000000000000001', 'Guide One', 'Who is the leader now?', ?)", [ago(2)]);
run("INSERT INTO task_questions (task_uid, asked_by_id, asked_by_name, question, answer, asked_at, answered_at) VALUES ('t1001', '100000000000000001', 'Guide One', 'Answered one', 'Yes', ?, ?)", [ago(2), ago(1)]);
run("INSERT INTO faction_history (faction_id, faction_name, action_type, details, authorized_by, created_at) VALUES (4, 'Harbor Syndicate', 'PROMO_STAGED', 'Staged for Tier 4', 'Risk', ?)", [ago(20)]);

// ── gates ──
as('tok-l1'); await rejects(() => A.getLeadershipQueue(), 'AUTH_INSUFFICIENT', 'L1 cannot read the queue');
as('tok-expired'); await rejects(() => A.getLeadershipQueue(), 'AUTH_REQUIRED', 'expired session'); pass('queue gates');

// ── L3 sees everything ──
as('tok-l3');
const q3 = await A.getLeadershipQueue();
ok(Array.isArray(q3.items) && q3.counts && q3.counts.total === q3.items.length, 'shape');
for (const it of q3.items) ok(['approval', 'execute', 'verify', 'feedback', 'deletion', 'question', 'task', 'promotion'].includes(it.kind) && typeof it.ageDays === 'number' && typeof it.href === 'string' && it.href.startsWith('/v2') && 'title' in it && 'faction' in it && 'factionId' in it && 'since' in it && 'actor' in it, `item shape ${it.kind}#${it.id}`);
eq(byKind(q3, 'approval').map(i => i.id).join(), '1', 'approval = seed PENDING #1');
eq(byKind(q3, 'execute').map(i => i.id).join(), String(eExec), 'execute = RP_DONE row');
{ const v = byKind(q3, 'verify'); eq(v.map(i => i.id).sort().join(), [eVer1, eVer4].sort().join(), 'verify = unverified executed rows only');
  const v1 = v.find(i => i.id === eVer1); ok(v1.overdue === true && v1.ageDays === 3 && v1.canVerify === true && v1.faction === 'The Vanguard', 'verify #1 overdue after 48h, 3 days old');
  ok(v.find(i => i.id === eVer4).overdue === false, 'verify #4 fresh'); }
{ const f = byKind(q3, 'feedback'); eq(f.map(i => i.factionId).sort().join(), '1,4', 'feedback = confirmed, unsent, this month'); ok(f[0].href.includes('/v2/factions/') && f[0].href.includes('tab=review') && f.find(i => i.factionId === 1).ageDays === 8, 'feedback href + age'); }
eq(byKind(q3, 'deletion').length, 1, 'deletion'); eq(byKind(q3, 'deletion')[0].ageDays, 12, 'deletion age');
{ const qs = byKind(q3, 'question'); eq(qs.length, 2, 'two unanswered questions'); ok(qs.every(i => i.href.startsWith('/v2/tasks/')), 'question href → task'); }
{ const t = byKind(q3, 'task'); eq(t.map(i => i.id).join(), 't1003', 'unclaimed leadership-role task'); eq(t[0].targetLabel, 'FM Leadership', 'target label'); }
{ const p = byKind(q3, 'promotion'); eq(p.map(i => i.factionId).join(), '4', 'staged promotion'); ok(p[0].ageDays === 20 && p[0].targetTier === 4 && p[0].currentTier === 3, 'promotion age from PROMO_STAGED + tiers'); }
eq(q3.counts.approval + q3.counts.execute + q3.counts.verify + q3.counts.feedback + q3.counts.deletion + q3.counts.question + q3.counts.task + q3.counts.promotion, q3.counts.total, 'counts add up');
ok(q3.counts.stale >= 4, 'stale (7+ days) counted');
// kind order then oldest first within a kind
ok(q3.items.findIndex(i => i.kind === 'approval') < q3.items.findIndex(i => i.kind === 'verify') && q3.items.findIndex(i => i.kind === 'verify') < q3.items.findIndex(i => i.kind === 'promotion'), 'grouped by kind');
{ const v = byKind(q3, 'verify'); ok(v[0].ageDays >= v[1].ageDays, 'oldest first within kind'); }
pass('L3 queue');

// ── L2 sees its team's factions + own verifications + own tasks' questions ──
as('tok-l2');
const q2 = await A.getLeadershipQueue();
eq(byKind(q2, 'approval').map(i => i.id).join(), '1', 'L2 approval for own faction');
eq(byKind(q2, 'execute').length, 0, 'L2 does not see faction 2 execute');
eq(byKind(q2, 'verify').map(i => i.id).join(), String(eVer1), 'L2 sees own faction verify, not faction 4');
eq(byKind(q2, 'feedback').map(i => i.factionId).join(), '1', 'L2 feedback own faction only');
eq(byKind(q2, 'deletion').length, 0, 'L2 no deletion requests');
{ const qs = byKind(q2, 'question'); eq(qs.length, 1, 'L2 sees the question on the task they created'); eq(qs[0].taskUid, 't1002', 'own task'); }
eq(byKind(q2, 'task').length, 0, 'L2 no leadership-role tasks'); eq(byKind(q2, 'promotion').length, 0, 'L2 no promo outside team');
// A verification L2 requested for a faction outside their team still shows (they are the one to verify it).
run("UPDATE pending_executions SET requester_id = '100000000000000002', requested_by = 'Lead Two' WHERE id = ?", [eVer4]);
{ const q = await A.getLeadershipQueue(); eq(byKind(q, 'verify').map(i => i.id).sort().join(), [eVer1, eVer4].sort().join(), 'L2 sees a verification they requested'); ok(byKind(q, 'verify').every(i => i.canVerify), 'canVerify as requester'); }
run("UPDATE pending_executions SET requester_id = '100000000000000003', requested_by = 'Mgmt Three' WHERE id = ?", [eVer4]);
pass('L2 scoping');

// ── getUnverifiedExecutions ──
as('tok-l3'); { const u = await A.getUnverifiedExecutions(); eq(u.map(r => r.id).sort().join(), [eVer1, eVer4].sort().join(), 'L3 unverified list'); ok(u.find(r => r.id === eVer1).overdue && !u.find(r => r.id === eVer4).overdue && u.every(r => r.awaiting_verification), 'overdue flag + awaiting'); }
as('tok-l2'); eq((await A.getUnverifiedExecutions()).map(r => r.id).join(), String(eVer1), 'L2 unverified list scoped');
as('tok-l1'); await rejects(() => A.getUnverifiedExecutions(), 'AUTH_INSUFFICIENT', 'L1 unverified list');
eq(RP.unverifiedExecutions({ olderThanHours: 48 }).map(r => r.id).join(), String(eVer1), 'shared olderThanHours filter');
eq(RP.unverifiedExecutions().length, 2, 'shared unfiltered');
{ const rows = RP.pendingExecutions({ includeUnverified: true }); ok(rows.some(r => r.id === eVer1 && r.awaiting_verification === true) && rows.every(r => 'verified_at' in r && 'verified_by' in r), 'pendingExecutions carries verification fields'); ok(!RP.pendingExecutions().some(r => r.status === 'EXECUTED'), 'default list unchanged'); }
{ const p = RP.executionPreview(eVer1); ok(p.status === 'EXECUTED' && p.awaiting_verification === true && p.verified_at === null, 'preview carries verification'); }
pass('unverified lists');

// ── verifyRPChange gates ──
as('tok-l1'); await failsWith(() => A.verifyRPChange(eVer1, 'looks good'), /requester|Leadership/i, 'other L1 refused');
as('tok-l2'); await failsWith(() => A.verifyRPChange(1, ''), /executed/i, 'PENDING row cannot be verified');
await failsWith(() => A.verifyRPChange(eExec, ''), /executed/i, 'RP_DONE row cannot be verified');
await failsWith(() => A.verifyRPChange(999, ''), /no longer exists/i, 'unknown id');
as('tok-expired'); await rejects(() => A.verifyRPChange(eVer1, ''), 'AUTH_REQUIRED', 'expired');
const auditBefore = queryOne('SELECT COUNT(*) c FROM site_audit_log').c;
as('tok-l2'); log.length = 0;
{ const r = await A.verifyRPChange(eVer1, 'HQ sign is up in game');
  ok(r.ok && r.verified_by === 'Lead Two' && !!r.verified_at, 'requester verifies');
  const row = queryOne('SELECT status, verified_at, verified_by FROM pending_executions WHERE id = ?', [eVer1]);
  ok(row.status === 'EXECUTED' && row.verified_by === 'Lead Two' && !!row.verified_at, 'row flagged, status unchanged');
  const a = audit(); ok(a.action === 'VERIFY' && a.target_id === String(eVer1) && a.target_type === 'rp_change' && a.source === 'site' && /HQ sign/.test(a.details), 'audit VERIFY with record id');
  eq(queryOne("SELECT COUNT(*) c FROM faction_history WHERE faction_id = 1 AND action_type = 'RP_VERIFIED'").c, 1, 'faction_history RP_VERIFIED');
  const p = pings(log); ok(p.some(x => x.ch === '620000000000000001' && /verified in game/.test(x.content) && /Lead Two/.test(x.content)), 'note posted to the IC thread'); }
await failsWith(() => A.verifyRPChange(eVer1, 'again'), /already verified/i, 'double verify refused');
eq(queryOne('SELECT COUNT(*) c FROM site_audit_log').c, auditBefore + 1, 'no audit row for refused verifies');
as('tok-l3'); log.length = 0; { const r = await A.verifyRPChange(eVer4, ''); ok(r.ok && r.verified_by === 'Mgmt Three', 'L3 verifies without being requester'); eq(pings(log).length, 0, 'no thread → no post'); }
{ const r = await RP.verifyRPChange({ id: '100000000000000002', name: 'Lead Two', level: 2, source: 'bot' }, eExec); ok(!r.ok, 'shared refuses non-executed from bot too'); }
as('tok-l3'); { const q = await A.getLeadershipQueue(); eq(byKind(q, 'verify').length, 0, 'verified rows leave the queue'); }
eq(RP.unverifiedExecutions().length, 0, 'nothing left unverified');
pass('verifyRPChange');
