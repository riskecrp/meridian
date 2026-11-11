// Leadership actions (dashboard/src/app/fm/leadership/actions.js): review
// submission scoping, personal-note votes and the derived review status,
// feedback-sent tracking, meeting notes, team performance.
import { as, ok, eq, rejects, failsWith, pass, captureDiscord, pings } from '../lib.mjs';
import { query, queryOne, run } from '../../../shared/db.js';
const log = captureDiscord();
const L = await import('../../../dashboard/src/app/fm/leadership/actions.js');
const audit = () => queryOne('SELECT actor_name, action, target_type, target_id, target_label, details FROM site_audit_log ORDER BY id DESC LIMIT 1');
const month = new Date().toISOString().slice(0, 7);

// ── reviews ──
as('tok-l2'); await failsWith(() => L.submitReview({ factionId: 4, recommendation: 'Promote', feedback: 'x' }), null, 'review cross-team');
await failsWith(() => L.submitReview({ factionId: 1, recommendation: 'Banana', feedback: 'x' }), null, 'bad recommendation');
log.length = 0; const rv = await L.submitReview({ factionId: 1, factionName: 'WRONG', recommendation: 'Promote', feedback: 'Strong month' });
{ const p = pings(log); ok(rv.ok && queryOne('SELECT faction_name FROM faction_reviews WHERE id=?', [rv.id]).faction_name === 'The Vanguard' && p.length === 1 && !/<@1000/.test(p[0].content), 'review stored with server name, pinged without self-mention'); }
log.length = 0; ok((await L.submitReview({ factionId: 1, recommendation: 'Hold', feedback: 'Revised' })).ok && pings(log).length === 0, 'resubmit updates without ping');
as('tok-l3'); await failsWith(() => L.submitPersonalNote(1, '', 'note', 'Promote'), null, 'bare Promote refused (bot needs Confirmed X)');
await failsWith(() => L.submitPersonalNote(3, '', 'note', 'Confirmed Hold'), null, 'note on archived'); await failsWith(() => L.submitPersonalNote(999, '', 'note', 'Confirmed Hold'), null, 'note unknown faction');
{ const r = await L.submitPersonalNote(1, 'WRONG', 'Looks good', 'Confirmed Promote'); ok(r.ok && r.status === 'Confirmed Promote' && queryOne('SELECT status FROM faction_reviews WHERE id=?', [rv.id]).status === 'Confirmed Promote', 'vote derives Confirmed Promote'); }
{ const r = await L.submitPersonalNote(1, '', 'Changed my mind', 'Confirmed Hold'); ok(r.ok && queryOne("SELECT COUNT(*) c FROM leadership_personal_notes WHERE faction_id=1 AND author_id='100000000000000003' AND review_month=?", [month]).c === 1, 'same month upserts'); eq(queryOne('SELECT status FROM faction_reviews WHERE id=?', [rv.id]).status, 'Confirmed Hold', 'derived Hold'); }
as('tok-owner'); { const r = await L.submitPersonalNote(1, '', 'Promote them', 'Confirmed Promote'); ok(r.status === 'Pending Discussion' && queryOne('SELECT status FROM faction_reviews WHERE id=?', [rv.id]).status === 'Pending Discussion', 'tie → Pending Discussion'); }
as('tok-l2'); await rejects(() => L.setReviewStatus(rv.id, 'Confirmed Promote'), 'AUTH_INSUFFICIENT', 'L2 cannot confirm');
as('tok-l3'); await failsWith(() => L.setReviewStatus(rv.id, 'Whatever'), null, 'bad status');
const openTasks0 = queryOne("SELECT COUNT(*) c FROM tasks WHERE status='open'").c;
eq((await L.setReviewStatus(rv.id, 'Confirmed Demote')).status, 'Pending Discussion', 'L3 demote vs owner promote still tied');
as('tok-owner'); eq((await L.setReviewStatus(rv.id, 'Confirmed Demote')).status, 'Confirmed Demote', 'majority demote');
{ const t = query("SELECT target_id FROM tasks WHERE status='open' ORDER BY id DESC LIMIT 1")[0]; ok(queryOne("SELECT COUNT(*) c FROM tasks WHERE status='open'").c === openTasks0 + 1 && t.target_id === '900000000000000001', 'one leadership task raised'); }
as('tok-l2'); { const s = await L.getFactionLeadershipSummary(1); ok(s.status === 'Confirmed Demote' && s.notes.length === 2, 'summary derived'); }
as('tok-lst'); ok(typeof (await L.getFactionLeadershipSummary(1)).status === 'string', 'LST reads summary'); ok((await L.getReviewData()).length > 0, 'LST reads review data');
ok(query("SELECT DISTINCT status FROM leadership_personal_notes WHERE status != ''").every(x => /^Confirmed /.test(x.status)), 'only bot-compatible Confirmed X strings stored'); pass('reviews + votes');

// ── feedback to faction ──
as('tok-l3'); await failsWith(() => L.markFeedbackSent(4), null, 'feedback needs a review first');
as('tok-l2'); log.length = 0; { const a = await L.markFeedbackSent(1), b = await L.markFeedbackSent(1); ok(a.ok && b.already === true && pings(log).length === 1, 'markFeedbackSent idempotent'); }
ok(!!queryOne('SELECT feedback_sent_at FROM faction_reviews WHERE id=?', [rv.id]).feedback_sent_at, 'feedback_sent_at set');
{ const s = await L.getFeedbackStatus(1); ok(s.sent === true && s.by === 'Lead Two', 'feedback status'); }
{ const x = await L.getReviewDataFor(1); ok(x.feedbackSent.sent && x.status === 'Confirmed Demote', 'review row carries feedbackSent + status'); }
await failsWith(() => L.sendFeedbackToFaction(1, 'hello'), /comms channel/, 'no comms channel configured');
run("UPDATE bot_server_configs SET comms_channel_id='777000000000000001' WHERE faction_id=1");
log.length = 0; { const r = await L.sendFeedbackToFaction(1, 'Hello Vanguard.'); const p = pings(log); ok(r.ok && p.some(x => x.ch === '777000000000000001' && x.embeds) && p.length === 2, 'feedback delivered as embed + FM ping'); }
as('tok-owner'); await failsWith(() => L.editPersonalNote(1, 'x', 'Confirmed Hold'), null, 'edit someone else’s note');
as('tok-l3'); await failsWith(() => L.editPersonalNote(1, null, ''), null, 'edit note null');
{ const q = await L.getPendingQueue(); ok(Array.isArray(q.promos) && Array.isArray(q.deletions), 'pending queue shape'); } pass('feedback');

// ── meeting notes ──
as('tok-l1'); await failsWith(() => L.saveMeetingNote({ targetType: 'faction', targetKey: '1', content: '<p></p>' }), null, 'empty note');
await failsWith(() => L.saveMeetingNote({ targetType: 'faction', targetKey: '4', content: '<p>x</p>' }), null, 'note cross-team');
const n = await L.saveMeetingNote({ targetType: 'faction', targetKey: '1', content: '<p>ok</p><img src=x onerror=alert(1)>', attendeeIds: ['100000000000000001'] });
{ const row = queryOne('SELECT text, target_label FROM ooc_notes WHERE id=?', [n.id]); ok(n.ok && row.target_label === 'The Vanguard' && !/onerror/.test(row.text), 'note sanitised with label'); ok(audit().target_label === 'The Vanguard' && audit().target_id === String(n.id), 'note audit has label + id'); }
eq((await L.getMeetingNote(n.id))?.id, n.id, 'getMeetingNote');
as('tok-l3'); const g = await L.saveMeetingNote({ targetType: 'group', targetKey: 'management', content: '<p>secret</p>' }); ok(g.ok, 'group note saved');
as('tok-l1'); eq(await L.getMeetingNote(g.id), null, 'group note hidden from L1');
as('tok-l2'); await failsWith(() => L.deleteMeetingNote(n.id), null, 'delete non-author'); eq((await L.getAttendeesForTarget('group', 'management')).length, 0, 'group attendees hidden from L2');
as('tok-l3'); ok((await L.getTeamPerformance()).length >= 2, 'team performance rows');
as('tok-l2'); ok(!(await L.getGuideActivity()).some(x => /Placeholder/.test(x.name)), 'guide activity skips placeholder staff'); pass('meeting notes + performance');

// ── hub helpers: vote status + feedback draft (detail in hub.test.mjs) ──
as('tok-l1'); await rejects(() => L.getVoteStatus(), 'AUTH_INSUFFICIENT', 'vote status L2+'); await rejects(() => L.getFeedbackDraft(1), 'AUTH_INSUFFICIENT', 'draft L2+');
as('tok-l3'); { const v = await L.getVoteStatus(month); const f1 = v.factions.find(f => f.factionId === 1); ok(v.ok && f1 && f1.votes.length === 2 && f1.missing.length === 0 && f1.complete, 'vote status reflects the two votes cast above'); }
await failsWith(() => L.getVoteStatus('2026-13'), /YYYY-MM/, 'vote status bad month');
as('tok-l2'); await failsWith(() => L.getFeedbackDraft(4), /outside your team/, 'draft cross-team');
{ const d = await L.getFeedbackDraft(1); ok(d.ok && d.draft.startsWith('Hello The Vanguard,') && /landed on a demotion/.test(d.draft) && /Revised/.test(d.draft) && /Promote them/.test(d.draft) && !/Mgmt Three|Risk/.test(d.draft) && /Faction Management$/.test(d.draft.trim()), 'draft: greeting, confirmed demote, team + leadership text, no author names, sign-off'); ok(d.sources.length >= 3, 'draft sources'); } pass('hub helpers');
