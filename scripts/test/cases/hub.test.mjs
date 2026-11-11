// Faction hub feed (fm/factions/actions.js getFactionTimeline / getPromotionReadiness)
// and the leadership helpers behind it (fm/leadership/actions.js getVoteStatus /
// getFeedbackDraft): merge of every source, ordering, paging, L1 redaction,
// readiness numbers against the seed, vote status and the feedback draft's gates.
import { as, ok, eq, rejects, failsWith, pass } from '../lib.mjs';
import { query, queryOne, run } from '../../../shared/db.js';
const A = await import('../../../dashboard/src/app/fm/factions/actions.js');
const L = await import('../../../dashboard/src/app/fm/leadership/actions.js');
const month = new Date().toISOString().slice(0, 7);
const prevMonth = (k) => { const [y, m] = k.split('-').map(Number); return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7); };

// ── extra rows so every source has something to say about The Vanguard (id 1) ──
const peAt = queryOne('SELECT created_at FROM pending_executions WHERE id=1').created_at;
run("INSERT INTO site_audit_log (actor_id, actor_name, action, target_type, target_id, target_label, details, timestamp) VALUES " +
  "('100000000000000003','Mgmt Three','EDIT','faction','1','The Vanguard','Set forum to https://x','2026-11-01 10:00:00')," +
  "('100000000000000001','Guide One','CREATE','member','','Someone Old','Added to The Vanguard','2026-11-02 10:00:00')," +
  "('100000000000000002','Lead Two','CREATE','rp_change','1','The Vanguard','NPC: Big Smoke → Big Smoke (relocated)', ?)," +
  "('100000000000000002','Lead Two','CREATE','review','1','The Vanguard','Promote','2026-11-04 10:00:00')," +
  "('100000000000000003','Mgmt Three','CREATE','leadership_note','1','The Vanguard','Confirmed Hold — private thoughts','2026-11-04 11:00:00')," +
  "('100000000000000001','Guide One','ACKNOWLEDGE','feedback','1','The Vanguard — Marcus Vane','Submitter contacted','2026-11-05 10:00:00')," +
  "('100000000000000003','Mgmt Three','EDIT','faction','4','Harbor Syndicate','Set forum to https://y','2026-11-05 11:00:00')," +
  "('100000000000000003','Mgmt Three','EDIT','faction','1','The Vanguard','Tier set to 3','2026-11-06 10:00:01')", [peAt]);
run("INSERT INTO faction_history (faction_id, faction_name, action_type, details, authorized_by, created_at) VALUES (1,'The Vanguard','TIER_SET','Tier 2 → 3','Mgmt Three','2026-11-06 10:00:00')");
run("INSERT INTO tasks (task_uid, description, target_id, target_type, claimed_by, created_by_id, created_by_name) VALUES ('t2001','TVG leadership-only follow-up','900000000000000001','Role','None','738214924760907907','Risk (owner)')");
run("INSERT INTO task_log (action, actor, task_uid, description, target, created_at) VALUES ('CREATED','Risk (owner)','t2001','TVG leadership-only follow-up','Role','2026-11-07 10:00:00')");
run("UPDATE pending_executions SET status='EXECUTED', resolved_at='2026-11-08T10:00:00.000Z', verified_at='2026-11-08T12:00:00.000Z', verified_by='Lead Two' WHERE id=1");
run("UPDATE faction_feedback SET claimed_at='2026-11-09 10:00:00', claimed_by_name='Guide One', status='claimed' WHERE id=1");

// ── timeline: merge + ordering ──
as('tok-l3'); const full = await A.getFactionTimeline(1, { limit: 500 });
ok(Array.isArray(full) && full.length >= 12, `merged feed has rows (${full.length})`);
for (let i = 1; i < full.length; i++) ok(full[i - 1].at >= full[i].at, `newest first at ${i}`);
for (const e of full) ok(/^\d{4}-\d{2}-\d{2}T/.test(e.at) && e.kind && e.title && 'detail' in e && 'actor' in e && 'href' in e && e.cursor, 'entry shape ' + JSON.stringify(e).slice(0, 80));
const kinds = new Set(full.map(e => e.kind));
for (const k of ['history', 'audit', 'task', 'rp', 'review', 'feedback', 'scene']) ok(kinds.has(k), `kind ${k} present`);
ok(full.some(e => e.kind === 'task' && /Vanguard HQ/.test(e.detail)), 'task matched by alias "Vanguard"');
ok(full.some(e => e.kind === 'task' && /TVG leadership-only/.test(e.detail)), 'L3 sees the leadership-only task');
ok(full.some(e => e.kind === 'rp' && /#1 requested/.test(e.title)) && full.some(e => e.kind === 'rp' && /#1 executed/.test(e.title)) && full.some(e => e.kind === 'rp' && /#1 verified/.test(e.title) && e.actor === 'Lead Two'), 'rp requested / executed / verified');
ok(full.some(e => e.kind === 'review' && /2026-10 submitted/.test(e.title) && /Promote — Strong month/.test(e.detail)), 'L3 sees the recommendation text');
ok(full.some(e => e.kind === 'feedback' && /received/.test(e.title) && /Marcus Vane/.test(e.detail)) && full.some(e => e.kind === 'feedback' && /claimed/.test(e.title) && e.actor === 'Guide One'), 'feedback received + claimed');
eq(full.filter(e => e.kind === 'scene').length, 2, 'both Vanguard scenes, none of LSK');
ok(full.some(e => e.kind === 'audit' && /Added to The Vanguard/.test(e.detail)), 'member audit matched by details');
ok(full.some(e => e.kind === 'audit' && /ACKNOWLEDGE/.test(e.title) && e.href === '/v2/feedback/1'), 'feedback audit matched by label, links to the item');
ok(full.some(e => e.kind === 'audit' && /leadership_note|private thoughts/.test(e.title + e.detail)), 'L3 sees leadership-note audits');
ok(!full.some(e => /Harbor Syndicate/.test(e.title) && e.kind === 'audit'), 'other faction audit excluded');
ok(!full.some(e => e.kind === 'audit' && /Tier set to 3/.test(e.detail)), 'audit twin of a history row (same actor, same second) collapsed');
ok(full.some(e => e.kind === 'history' && /Tier 2 → 3/.test(e.detail)), 'history row kept');
ok(!full.some(e => e.kind === 'audit' && /rp_change|Big Smoke/.test(e.title + e.detail) && e.at === new Date(peAt.replace(' ', 'T') + 'Z').toISOString()), 'audit twin of the RP request collapsed'); pass('timeline merge');

// ── paging ──
{ const p1 = await A.getFactionTimeline(1, { limit: 4 }); eq(p1.length, 4, 'page 1 size');
  const p2 = await A.getFactionTimeline(1, { limit: 4, before: p1[3].cursor }); eq(p2.length, 4, 'page 2 size');
  const keys = [...p1, ...p2].map(e => e.key); eq(new Set(keys).size, 8, 'no overlap across pages');
  eq(keys.join(), full.slice(0, 8).map(e => e.key).join(), 'pages follow the full order');
  const p3 = await A.getFactionTimeline(1, { limit: 500, before: p2[3].cursor }); eq(p1.length + p2.length + p3.length, full.length, 'paging reaches the end');
  const byTime = await A.getFactionTimeline(1, { limit: 500, before: '2026-11-03T00:00:00.000Z' }); ok(byTime.length > 0 && byTime.every(e => e.at < '2026-11-03T00:00:00.000Z'), 'bare timestamp cursor'); } pass('timeline paging');

// ── reads are global, confidential bits redacted below L2 ──
as('tok-l1'); { const t = await A.getFactionTimeline(1, {});
  ok(t.length > 0, 'L1 reads the feed');
  ok(!t.some(e => e.kind === 'audit' && /leadership_note|private thoughts|Promote$/.test(e.title + e.detail)), 'L1: no review / leadership-note audits');
  ok(t.some(e => e.kind === 'review' && e.detail === 'Team lead recommendation on file' && e.href === null), 'L1: review exists but the recommendation is redacted');
  ok(!t.some(e => /TVG leadership-only/.test(e.detail)), 'L1: leadership-only task hidden');
  ok(t.some(e => /Vanguard HQ/.test(e.detail)), 'L1: guide task visible');
  ok(t.filter(e => e.kind === 'rp').every(e => e.href === null), 'L1: no approvals link'); }
as('tok-et'); ok((await A.getFactionTimeline('The Vanguard', { limit: 5 })).length === 5, 'ET reads by name');
as('tok-lst'); ok((await A.getFactionTimeline(1)).some(e => e.kind === 'review' && /Strong month/.test(e.detail)), 'LST reads like a leader');
as('tok-l1'); eq((await A.getFactionTimeline(999)).length, 0, 'unknown faction → []'); eq((await A.getFactionTimeline(1, { limit: 'abc' })).length, (await A.getFactionTimeline(1, {})).length, 'bad limit → default');
ok((await A.getFactionTimeline(3)).some(e => e.kind === 'history' && /Disbanded/.test(e.detail)), 'archived faction still readable');
as('tok-expired'); await rejects(() => A.getFactionTimeline(1), 'AUTH_REQUIRED', 'expired session'); pass('timeline access');

// ── promotion readiness against the seed ──
as('tok-l1'); await rejects(() => A.getPromotionReadiness(1), 'AUTH_INSUFFICIENT', 'readiness is L2+');
as('tok-l2'); eq(await A.getPromotionReadiness(999), null, 'readiness unknown faction');
{ const r = await A.getPromotionReadiness(1); const c = Object.fromEntries(r.checks.map(x => [x.id, x]));
  eq(r.tier, 2, 'tier'); eq(r.nextTier, 3, 'next tier'); eq(r.checks.length, 6, 'six checks');
  eq(c.scenes30.value, 2, 'scenes 30d'); eq(c.scenes90.value, 2, 'scenes 90d'); eq(c.members.value, 2, 'members'); eq(c.streak.value, 0, 'no confirmed reviews yet');
  eq(c.openRp.value, 0, 'executed request no longer open'); ok(c.openRp.ok, 'open RP ok');
  ok(c.sincePromotion.value >= 0 && !c.sincePromotion.ok && /creation/.test(c.sincePromotion.label), 'never promoted → since creation');
  ok(r.checks.every(x => typeof x.ok === 'boolean' && typeof x.target === 'number' && 'label' in x && 'value' in x), 'check shape'); ok(!r.ready && r.met === 1, 'not ready'); }
run("UPDATE faction_reviews SET status='Confirmed Promote' WHERE faction_id=1 AND review_month='2026-10'");
run("INSERT INTO faction_reviews (faction_id, review_month, recommendation, feedback, faction_name, status) VALUES (1, ?, 'Hold', 'ok', 'The Vanguard', 'Confirmed Hold')", [month]);
run("INSERT OR IGNORE INTO faction_reviews (faction_id, review_month, recommendation, feedback, faction_name, status) VALUES (1, ?, 'Hold', 'ok', 'The Vanguard', 'Confirmed Hold')", [prevMonth(month)]);
run("INSERT INTO pending_executions (date, faction_id, execution_type, turf, old_value, new_value, requested_by, status, requester_id) VALUES ('2026-11-10',1,'HQ','N/A','a','b','Lead Two','PENDING','100000000000000002')");
{ const r = await A.getPromotionReadiness(1); const c = Object.fromEntries(r.checks.map(x => [x.id, x]));
  ok(c.streak.value >= 2, `streak counts consecutive confirmed months (${c.streak.value})`); eq(c.openRp.value, 1, 'open request counted'); ok(!c.openRp.ok, 'open request fails the check'); }
as('tok-lst'); ok((await A.getPromotionReadiness(4))?.tier === 3, 'LST reads readiness');
as('tok-l3'); { const r = await A.getPromotionReadiness(3); ok(r && r.archived === true, 'archived faction readable'); }
run("UPDATE factions SET tier = 9 WHERE id = 4"); eq((await A.getPromotionReadiness(4)).nextTier, null, 'top tier has no next'); run("UPDATE factions SET tier = 3 WHERE id = 4"); pass('readiness');

// ── vote status ──
as('tok-l1'); await rejects(() => L.getVoteStatus('2026-10'), 'AUTH_INSUFFICIENT', 'vote status L2+');
as('tok-l3'); await failsWith(() => L.getVoteStatus('2026-1'), /YYYY-MM/, 'bad month');
{ const v = await L.getVoteStatus('2026-10'); ok(v.ok && v.month === '2026-10', 'ok shape');
  eq(v.voters.length, 2, 'two active L3s'); ok(v.voters.every(x => x.id && x.name), 'voter shape');
  const f1 = v.factions.find(f => f.factionId === 1); ok(f1 && f1.name === 'The Vanguard', 'faction row');
  eq(f1.votes.length, 1, 'one note'); eq(f1.votes[0].authorName, 'Mgmt Three', 'author name'); eq(f1.votes[0].status, '', 'note without a vote has empty status'); eq(f1.voted, 0, 'not counted as a vote');
  eq(f1.missing.length, 1, 'one missing'); eq(f1.missing[0].name, 'Risk (owner)', 'the owner is missing'); ok(!f1.complete, 'incomplete');
  ok(!v.factions.some(f => f.name === 'Old Crew'), 'archived excluded'); ok(v.factions.length === 3, 'L3 sees every active faction'); }
as('tok-l2'); { const v = await L.getVoteStatus(); ok(v.ok && v.month === month && v.factions.length === 1 && v.factions[0].factionId === 1, 'L2 sees own team, defaults to this month'); }
as('tok-lst'); ok((await L.getVoteStatus('2026-10')).ok, 'LST reads vote status');
as('tok-l3'); run("INSERT INTO leadership_personal_notes (faction_id, faction_name, author_id, author_name, review_month, note, status) VALUES (1,'The Vanguard','738214924760907907','Risk (owner)','2026-10','fine','Confirmed Promote')");
run("UPDATE leadership_personal_notes SET status='Confirmed Hold' WHERE author_id='100000000000000003' AND review_month='2026-10'");
{ const f1 = (await L.getVoteStatus('2026-10')).factions.find(f => f.factionId === 1); eq(f1.voted, 2, 'both voted'); eq(f1.missing.length, 0, 'none missing'); ok(f1.complete, 'complete'); } pass('vote status');

// ── feedback draft: content + gates ──
as('tok-l1'); await rejects(() => L.getFeedbackDraft(1, '2026-10'), 'AUTH_INSUFFICIENT', 'draft L2+');
as('tok-lst'); await rejects(() => L.getFeedbackDraft(1, '2026-10'), 'AUTH_INSUFFICIENT', 'LST cannot draft');
as('tok-l2'); await failsWith(() => L.getFeedbackDraft(4, '2026-10'), /outside your team/, 'L2 cross-team');
await failsWith(() => L.getFeedbackDraft(1, 'October'), /YYYY-MM/, 'bad month'); await failsWith(() => L.getFeedbackDraft(1, '2026-01'), /No team lead review/, 'month without data');
as('tok-l3'); await failsWith(() => L.getFeedbackDraft(3, '2026-10'), /archived/, 'archived faction'); await failsWith(() => L.getFeedbackDraft(999, '2026-10'), null, 'unknown faction');
run("UPDATE faction_reviews SET status='Pending Discussion' WHERE faction_id=1 AND review_month='2026-10'"); run("UPDATE leadership_personal_notes SET status='' WHERE faction_id=1 AND review_month='2026-10'");
{ const d = await L.getFeedbackDraft(1, '2026-10'); ok(d.ok && typeof d.draft === 'string', 'draft returned');
  ok(d.draft.startsWith('Hello The Vanguard,'), 'greets the faction'); ok(/Faction Management$/.test(d.draft.trim()), 'standard sign-off');
  ok(/reach out to your guides/.test(d.draft), 'closing line'); ok(/a promotion/.test(d.draft) && /finalising/.test(d.draft), 'recommendation summarised, outcome pending');
  ok(/Strong month/.test(d.draft), 'team lead feedback folded in'); ok(/Keep an eye on weapons/.test(d.draft) && /fine/.test(d.draft), 'leadership notes folded in');
  ok(!/Mgmt Three|Risk/.test(d.draft), 'no note author names'); ok(/0 scenes/.test(d.draft) && /October 2026/.test(d.draft), 'scene count for the month');
  ok(!/\*\*|^- /m.test(d.draft), 'plain text, no markdown');
  const kinds = d.sources.map(s => s.kind); for (const k of ['outcome', 'scenes', 'review', 'notes']) ok(kinds.includes(k), `source ${k}`); ok(d.sources.every(s => s.label), 'sources labelled'); ok(!kinds.includes('forum'), 'forum line only for the live month'); }
as('tok-l2'); { const d = await L.getFeedbackDraft(1, '2026-10'); ok(d.ok && /Hello The Vanguard/.test(d.draft), 'L2 drafts for own team'); }
// Confirmed outcome + applied promotion in the live month.
as('tok-l3'); run("UPDATE faction_reviews SET status='Confirmed Promote' WHERE faction_id=1 AND review_month=?", [month]);
run("INSERT INTO faction_history (faction_id, faction_name, action_type, details, authorized_by, created_at) VALUES (1,'The Vanguard','PROMOTED','Promoted Tier 2 → 3 · granted: Armor Pack','Mgmt Three', ?)", [new Date().toISOString()]);
run("UPDATE factions SET tier = 3, forum_posts_30d = 0 WHERE id = 1");
{ const d = await L.getFeedbackDraft(1); ok(d.ok && d.month === month, 'defaults to this month');
  ok(/congratulations/.test(d.draft) && /promoted to Tier 3/.test(d.draft), 'applied promotion announced');
  ok(/2 scenes/.test(d.draft), 'this month scene count'); ok(/faction thread/.test(d.draft) && /counts against you/.test(d.draft), 'forum thread called out when live month has no posts');
  ok(d.sources.some(s => s.kind === 'promotion') && d.sources.some(s => s.kind === 'forum'), 'promotion + forum sources'); }
run("UPDATE factions SET forum_posts_30d = 5 WHERE id = 1"); { const d = await L.getFeedbackDraft(1); ok(/thread is active/.test(d.draft), 'active thread acknowledged'); }
run("UPDATE faction_reviews SET status='Confirmed Demote' WHERE faction_id=2 AND review_month='2026-10'");
{ const d = await L.getFeedbackDraft(2, '2026-10'); ok(d.ok && /landed on a demotion/.test(d.draft) && /Quiet/.test(d.draft), 'confirmed demote wording'); } pass('feedback draft');
