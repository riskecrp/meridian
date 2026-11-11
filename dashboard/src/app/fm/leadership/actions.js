"use server";
// Leadership actions: the monthly review cycle, team/guide performance, the
// approvals queue and meeting notes. Shared by /fm/leadership/* and /v2.
//
// Review model (policy 7): the team lead writes ONE recommendation per faction
// per month (faction_reviews). Each L3 casts ONE vote per faction per month —
// a leadership_personal_notes row (UNIQUE faction/author/month, upserted) whose
// `status` is one of REVIEW_STATUSES. faction_reviews.status is never set by
// hand: it is DERIVED from the tally of those votes (strict majority of the
// 'Confirmed *' votes → that status, otherwise 'Pending Discussion'). The bot's
// 14th-of-month job reads the same 'Confirmed Promote' / 'Confirmed Hold'
// strings. A tally that lands on Confirmed Demote / Remove raises a leadership
// task, the same way the bot does for Promote. Feedback delivery is recorded on
// faction_reviews.feedback_sent_at / feedback_sent_by.
import { query, queryOne, run, transaction } from "../../../lib/db.js";
import { sendPing, sendDiscord, urls } from "../../../lib/pings.js";
import { getRole } from "../../../lib/discord.js";
import { logAudit } from "../../../lib/audit.js";
import { requireActor } from "../../../lib/requireActor.js";
import { assertFactionWrite, resolveFaction, writableFactions, writableFactionIds, canWriteFaction } from "../../../lib/access.js";
import { str, toInt, oneOf, isSnowflake, fail, REVIEW_RECOMMENDATIONS, REVIEW_STATUSES } from "../../../../../shared/validate.js";
import { monthKey, nowIso, todayIso } from "../../../../../shared/dates.js";
import { createTask } from "../../../../../shared/tasks.js";
import { sanitizeHtml, htmlToText } from "./_shared/sanitize.js";

const ok = (extra = {}) => ({ ok: true, ...extra });
const CONFIRMED = REVIEW_STATUSES.filter(s => s.startsWith('Confirmed '));

// Factions the actor works with: everything for L3 and Lead Storytellers
// (reads), the team's factions for L1/L2.
function scopedFactions(actor) {
  if (actor.level >= 3 || actor.isLeadStoryteller) return query("SELECT * FROM factions WHERE archived = 0 ORDER BY name");
  return writableFactions(actor);
}

function leadershipVoters() {
  return query("SELECT discord_id, display_name FROM staff WHERE clearance >= 3 AND discord_id != '' AND discord_id NOT LIKE 'placeholder%' AND COALESCE(active, 1) = 1 ORDER BY display_name");
}

/** Vote tally for one faction-month: { counts: {status: n}, total, confirmed, status }. */
function tallyVotes(factionId, month) {
  const rows = query("SELECT status, COUNT(*) AS c FROM leadership_personal_notes WHERE faction_id = ? AND review_month = ? AND status != '' GROUP BY status", [factionId, month]);
  const counts = {};
  let confirmed = 0, top = null;
  for (const r of rows) {
    counts[r.status] = r.c;
    if (CONFIRMED.includes(r.status)) {
      confirmed += r.c;
      if (!top || r.c > top.c) top = { status: r.status, c: r.c };
    }
  }
  const status = top && top.c * 2 > confirmed ? top.status : 'Pending Discussion';
  return { counts, total: rows.reduce((s, r) => s + r.c, 0), confirmed, status };
}

/**
 * Recompute faction_reviews.status for a faction-month from the votes. Raises
 * a leadership task the first time the tally lands on Demote or Remove.
 * Returns { status, review, changed }.
 */
async function deriveReviewStatus(actor, factionId, month) {
  const { status } = tallyVotes(factionId, month);
  const review = queryOne("SELECT * FROM faction_reviews WHERE faction_id = ? AND review_month = ?", [factionId, month]);
  if (!review) return { status, review: null, changed: false };
  if (review.status === status) return { status, review, changed: false };
  run("UPDATE faction_reviews SET status = ?, updated_at = ? WHERE id = ?", [status, nowIso(), review.id]);
  logAudit(actor.id, actor.name, 'EDIT', 'review', review.id, review.faction_name, `Status derived: ${review.status} → ${status}`);
  if (status === 'Confirmed Demote' || status === 'Confirmed Remove') {
    const outcome = status.replace('Confirmed ', '');
    const f = queryOne("SELECT id, name, tier FROM factions WHERE id = ?", [factionId]);
    const desc = `${f?.name || review.faction_name} — apply the confirmed ${outcome.toLowerCase()} (review ${month})\n\nLeadership confirmed "${status}" for ${month}. ${outcome === 'Demote' ? `Demote the faction from Tier ${f?.tier ?? '?'} on the hub's Review tab.` : 'Archive the faction from the hub\'s Admin tab once the RP has concluded.'}\n${urls.faction(f?.name || review.faction_name, 'review')}`;
    const dupe = queryOne("SELECT task_uid FROM tasks WHERE status = 'open' AND description LIKE ?", [`${f?.name || review.faction_name} — apply the confirmed ${outcome.toLowerCase()} (review ${month})%`]);
    const leadership = getRole('fm_leadership');
    if (!dupe && leadership) {
      try { await createTask(actor, { desc, targetType: 'Role', targetId: leadership }, { via: 'review tally' }); }
      catch (e) { console.error('[review] task for confirmed outcome:', e.message); }
    }
  }
  return { status, review: { ...review, status }, changed: true };
}

// ══════════════════════════════════════════════
// REVIEWS
// ══════════════════════════════════════════════

/** One row per faction with everything the board and the hub need, in a handful of queries. */
function reviewRows(actor, onlyFactionId = null) {
  const month = monthKey();
  const factions = query(`SELECT f.*, s.display_name AS lead_name, s.team_name AS lead_team_name, s.team_id AS lead_team_id
    FROM factions f LEFT JOIN staff s ON s.discord_id = f.lead_discord_id
    WHERE f.archived = 0 ${onlyFactionId ? 'AND f.id = ?' : ''} ORDER BY f.name`, onlyFactionId ? [onlyFactionId] : []);
  if (!factions.length) return [];
  const ids = factions.map(f => f.id);
  const ph = ids.map(() => '?').join(',');
  const scenes = {};
  query(`SELECT faction_id,
      SUM(CASE WHEN created_at >= datetime('now','-30 days') THEN 1 ELSE 0 END) AS s30,
      SUM(CASE WHEN created_at >= datetime('now','-60 days') AND created_at < datetime('now','-30 days') THEN 1 ELSE 0 END) AS s60,
      SUM(CASE WHEN created_at >= datetime('now','-90 days') AND created_at < datetime('now','-60 days') THEN 1 ELSE 0 END) AS s90
    FROM scene_logs WHERE faction_id IN (${ph}) GROUP BY faction_id`, ids).forEach(r => { scenes[r.faction_id] = r; });
  const intel = {};
  query(`SELECT faction_id, COUNT(*) AS c FROM intel_notes WHERE faction_id IN (${ph}) AND created_at >= datetime('now','-30 days') GROUP BY faction_id`, ids).forEach(r => { intel[r.faction_id] = r.c; });
  const hist = {};
  query(`SELECT faction_id, action_type, details, created_at FROM (
      SELECT faction_id, action_type, details, created_at, ROW_NUMBER() OVER (PARTITION BY faction_id ORDER BY created_at DESC, id DESC) AS rn
      FROM faction_history WHERE faction_id IN (${ph})) WHERE rn <= 5 ORDER BY created_at DESC`, ids)
    .forEach(r => { (hist[r.faction_id] ||= []).push({ action_type: r.action_type, details: r.details, created_at: r.created_at }); });
  const reviews = {};
  query(`SELECT * FROM faction_reviews WHERE review_month = ? AND faction_id IN (${ph})`, [month, ...ids]).forEach(r => { reviews[r.faction_id] = r; });
  const votes = {};
  query(`SELECT faction_id, status, COUNT(*) AS c FROM leadership_personal_notes WHERE review_month = ? AND faction_id IN (${ph}) GROUP BY faction_id, status`, [month, ...ids])
    .forEach(r => { (votes[r.faction_id] ||= {})[r.status || ''] = r.c; });
  const myVotes = actor.level >= 3
    ? new Set(query(`SELECT faction_id FROM leadership_personal_notes WHERE review_month = ? AND author_id = ? AND faction_id IN (${ph})`, [month, actor.id, ...ids]).map(r => r.faction_id))
    : null;
  const voterCount = actor.level >= 2 ? leadershipVoters().length : 0;
  const writable = writableFactionIds(actor);
  const canWrite = (id) => !actor.isLeadStoryteller && (writable === null || writable.has(id));

  return factions.map(f => {
    const sc = scenes[f.id] || {};
    const review = reviews[f.id] || null;
    const v = votes[f.id] || {};
    const castVotes = Object.entries(v).filter(([s]) => CONFIRMED.includes(s));
    const confirmedTotal = castVotes.reduce((s, [, c]) => s + c, 0);
    const top = castVotes.sort((a, b) => b[1] - a[1])[0];
    const derived = top && top[1] * 2 > confirmedTotal ? top[0] : 'Pending Discussion';
    const notesRecorded = Object.values(v).reduce((s, c) => s + c, 0);
    return {
      id: f.id, name: f.name, tier: f.tier,
      teamName: f.lead_team_name || '', leadName: f.lead_name || '',
      teamId: f.lead_team_id || '',
      mine: canWrite(f.id),
      scenes30: sc.s30 || 0, scenes60: sc.s60 || 0, scenes90: sc.s90 || 0,
      forumPosts: f.forum_posts_30d || 0,
      noteCount: intel[f.id] || 0,
      lastPromoted: f.last_promoted || 'Never',
      recentHistory: hist[f.id] || [],
      currentReview: review,
      status: review ? review.status : derived,
      tally: { counts: v, recorded: notesRecorded, voters: voterCount, derived },
      hasMyNote: myVotes ? myVotes.has(f.id) : null,
      feedbackSent: review?.feedback_sent_at ? { sent: true, by: review.feedback_sent_by, at: review.feedback_sent_at } : { sent: false },
      staged: !!f.pending_promo,
    };
  });
}

export async function getReviewData() {
  const actor = await requireActor(2, { allowLeadStoryteller: true });
  return reviewRows(actor);
}

/** The same row for one faction (the hub's Review tab). */
export async function getReviewDataFor(factionId) {
  const actor = await requireActor(2, { allowLeadStoryteller: true });
  const id = toInt(factionId);
  if (!id) return null;
  return reviewRows(actor, id)[0] || null;
}

export async function getReviewHistory(factionId) {
  await requireActor(2, { allowLeadStoryteller: true });
  return query("SELECT * FROM faction_reviews WHERE faction_id = ? ORDER BY review_month DESC LIMIT 12", [toInt(factionId)]);
}

/** Team lead recommendation for this month (create or update). */
export async function submitReview(data) {
  const actor = await requireActor(2);
  const d = data && typeof data === 'object' ? data : {};
  const recommendation = oneOf(str(d.recommendation), REVIEW_RECOMMENDATIONS);
  if (!recommendation) return fail(`Recommendation must be one of ${REVIEW_RECOMMENDATIONS.join(', ')}.`);
  const feedback = str(d.feedback, { max: 4000 });
  if (!feedback) return fail('Written feedback is required.');
  const r = assertFactionWrite(actor, d.factionId);
  if (r.error) return fail(r.error);
  const f = r.faction;
  const month = monthKey();
  const existing = queryOne("SELECT id FROM faction_reviews WHERE faction_id = ? AND review_month = ?", [f.id, month]);
  let reviewId;
  if (existing) {
    reviewId = existing.id;
    run("UPDATE faction_reviews SET recommendation = ?, feedback = ?, faction_name = ?, updated_at = ? WHERE id = ?", [recommendation, feedback, f.name, nowIso(), reviewId]);
    logAudit(actor.id, actor.name, 'EDIT', 'review', reviewId, f.name, recommendation);
  } else {
    const { status } = tallyVotes(f.id, month);
    reviewId = Number(run("INSERT INTO faction_reviews (faction_id, faction_name, review_month, recommendation, feedback, reviewer_id, reviewer_name, submitted_by, submitted_by_id, team_id, team_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [f.id, f.name, month, recommendation, feedback, actor.id, actor.name, actor.name, actor.id, actor.teamId || '', actor.teamName || '', status, nowIso(), nowIso()]).lastInsertRowid);
    logAudit(actor.id, actor.name, 'CREATE', 'review', reviewId, f.name, recommendation);
    // First submission only: leadership needs to know a recommendation landed so they can vote.
    await sendPing('review.submitted',
      `📋 **Team lead review submitted** — **${f.name}** (${month})\n**Recommendation:** ${recommendation} · by ${actor.name}\nLeadership: add your note and vote before the 15th.\n${urls.faction(f.name, 'review')}`);
  }
  return ok({ id: reviewId });
}

export async function editReview(reviewId, data) {
  const actor = await requireActor(2);
  const review = queryOne("SELECT * FROM faction_reviews WHERE id = ?", [toInt(reviewId)]);
  if (!review) return fail('Review not found.');
  if (review.reviewer_id !== actor.id && actor.level < 3) return fail('Not your review.');
  const d = data && typeof data === 'object' ? data : {};
  const recommendation = oneOf(str(d.recommendation), REVIEW_RECOMMENDATIONS);
  if (!recommendation) return fail(`Recommendation must be one of ${REVIEW_RECOMMENDATIONS.join(', ')}.`);
  const feedback = str(d.feedback, { max: 4000 });
  if (!feedback) return fail('Written feedback is required.');
  if (!canWriteFaction(actor, review.faction_id)) return fail('That faction is outside your team.');
  run("UPDATE faction_reviews SET recommendation = ?, feedback = ?, updated_at = ? WHERE id = ?", [recommendation, feedback, nowIso(), review.id]);
  logAudit(actor.id, actor.name, 'EDIT', 'review', review.id, review.faction_name, recommendation);
  return ok();
}

export async function deleteReview(reviewId) {
  const actor = await requireActor(2);
  const review = queryOne("SELECT * FROM faction_reviews WHERE id = ?", [toInt(reviewId)]);
  if (!review) return fail('Review not found.');
  if (review.reviewer_id !== actor.id && actor.level < 3) return fail('Not your review.');
  run("DELETE FROM faction_reviews WHERE id = ?", [review.id]);
  logAudit(actor.id, actor.name, 'DELETE', 'review', review.id, review.faction_name, `${review.review_month} ${review.recommendation}`);
  return ok();
}

/**
 * "Confirm outcome" from the board: an L3 casting (or changing) their vote for
 * the review's month. The review's status is then derived from the tally, so
 * the result may still read 'Pending Discussion' until a majority agrees.
 */
export async function setReviewStatus(reviewId, status) {
  const actor = await requireActor(3);
  const st = oneOf(str(status), REVIEW_STATUSES);
  if (!st) return fail(`Status must be one of ${REVIEW_STATUSES.join(', ')}.`);
  const review = queryOne("SELECT * FROM faction_reviews WHERE id = ?", [toInt(reviewId)]);
  if (!review) return fail('Review not found.');
  const r = resolveFaction(review.faction_id);
  if (r.error) return fail(r.error);
  const f = r.faction;
  const mine = queryOne("SELECT * FROM leadership_personal_notes WHERE faction_id = ? AND author_id = ? AND review_month = ?", [f.id, actor.id, review.review_month]);
  const noteText = mine?.note || `Outcome vote recorded from the review board (${st}).`;
  const noteId = upsertVote(actor, f, review.review_month, noteText, st);
  const { status: derived } = await deriveReviewStatus(actor, f.id, review.review_month);
  logAudit(actor.id, actor.name, mine ? 'EDIT' : 'CREATE', 'leadership_note', noteId, f.name, `Vote: ${st} (tally → ${derived})`);
  return ok({ status: derived, vote: st });
}

// ══════════════════════════════════════════════
// LEADERSHIP VOTES / PERSONAL NOTES
// ══════════════════════════════════════════════

function upsertVote(actor, faction, month, note, status) {
  run(`INSERT INTO leadership_personal_notes (faction_id, faction_name, author_id, author_name, review_month, note, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(faction_id, author_id, review_month) DO UPDATE SET note = excluded.note, status = excluded.status, author_name = excluded.author_name, faction_name = excluded.faction_name`,
    [faction.id, faction.name, actor.id, actor.name, month, note, status || '', nowIso()]);
  return queryOne("SELECT id FROM leadership_personal_notes WHERE faction_id = ? AND author_id = ? AND review_month = ?", [faction.id, actor.id, month])?.id;
}

/** This month's votes on a faction, who still has to vote, the tally and the derived status. Read by L2+ (and LST). */
export async function getFactionLeadershipSummary(factionId) {
  const actor = await requireActor(2, { allowLeadStoryteller: true });
  const id = toInt(factionId);
  const month = monthKey();
  const leaders = leadershipVoters();
  const notes = query("SELECT * FROM leadership_personal_notes WHERE faction_id = ? AND review_month = ? ORDER BY created_at ASC", [id, month]);
  const submitted = new Set(notes.map(n => n.author_id));
  const pending = leaders.filter(l => !submitted.has(l.discord_id));
  const tally = tallyVotes(id, month);
  return { notes, pending, tally, status: tally.status, mine: notes.find(n => n.author_id === actor.id) || null, month };
}

export async function getMyPersonalNotes(factionId) {
  const actor = await requireActor(3);
  return query("SELECT * FROM leadership_personal_notes WHERE faction_id = ? AND author_id = ? ORDER BY review_month DESC, created_at DESC", [toInt(factionId), actor.id]);
}

export async function getAllLeadershipNotes(factionId) {
  await requireActor(2, { allowLeadStoryteller: true });
  return query("SELECT * FROM leadership_personal_notes WHERE faction_id = ? ORDER BY review_month DESC, created_at DESC", [toInt(factionId)]);
}

/** An L3's note + vote for this month (one per faction per author; writing again updates it). */
export async function submitPersonalNote(factionId, factionName, note, status) {
  const actor = await requireActor(3);
  const text = str(note, { max: 4000 });
  if (!text) return fail('Note is empty.');
  const st = status ? oneOf(str(status), REVIEW_STATUSES) : '';
  if (status && !st) return fail(`Status must be one of ${REVIEW_STATUSES.join(', ')}.`);
  const r = resolveFaction(factionId);
  if (r.error) return fail(r.error);
  const f = r.faction;
  const month = monthKey();
  const before = queryOne("SELECT id, status FROM leadership_personal_notes WHERE faction_id = ? AND author_id = ? AND review_month = ?", [f.id, actor.id, month]);
  const noteId = upsertVote(actor, f, month, text, st);
  const { status: derived } = await deriveReviewStatus(actor, f.id, month);
  logAudit(actor.id, actor.name, before ? 'EDIT' : 'CREATE', 'leadership_note', noteId, f.name, (st ? st + ' — ' : '') + text.substring(0, 80));
  if (!before || before.status !== st) {
    await sendPing('review.leadership_note',
      `${f.lead_discord_id ? `<@${f.lead_discord_id}> ` : ''}📝 **Leadership note ${before ? 'updated' : 'submitted'} for ${f.name}**${st ? ` · vote: ${st}` : ''} · tally: ${derived}\nPlease fold it into the faction's message before the 15th.\n${urls.faction(f.name, 'review')}`);
  }
  return ok({ id: noteId, status: derived, updated: !!before });
}

export async function editPersonalNote(noteId, note, status) {
  const actor = await requireActor(3);
  const text = str(note, { max: 4000 });
  if (!text) return fail('Note is empty.');
  const st = status ? oneOf(str(status), REVIEW_STATUSES) : '';
  if (status && !st) return fail(`Status must be one of ${REVIEW_STATUSES.join(', ')}.`);
  const existing = queryOne("SELECT * FROM leadership_personal_notes WHERE id = ? AND author_id = ?", [toInt(noteId), actor.id]);
  if (!existing) return fail('Note not found or not yours.');
  run("UPDATE leadership_personal_notes SET note = ?, status = ? WHERE id = ?", [text, st, existing.id]);
  const { status: derived } = await deriveReviewStatus(actor, existing.faction_id, existing.review_month);
  logAudit(actor.id, actor.name, 'EDIT', 'leadership_note', existing.id, existing.faction_name, (st || '') + ' — ' + text.substring(0, 80));
  if (st !== existing.status && existing.review_month === monthKey()) {
    const f = queryOne("SELECT name, lead_discord_id FROM factions WHERE id = ?", [existing.faction_id]);
    await sendPing('review.leadership_note',
      `${f?.lead_discord_id ? `<@${f.lead_discord_id}> ` : ''}📝 **Leadership note updated for ${existing.faction_name}**${st ? ` · vote: ${st}` : ''} · tally: ${derived}\n${urls.faction(f?.name || existing.faction_name, 'review')}`);
  }
  return ok({ status: derived });
}

// ══════════════════════════════════════════════
// AI FEEDBACK DRAFT + SEND TO FACTION
// ══════════════════════════════════════════════

async function openai(messages) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fail('OpenAI API key not configured.');
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages, max_tokens: 500, temperature: 0.7 }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return fail(err.error?.message || `OpenAI error ${res.status}`);
    }
    const json = await res.json();
    const draft = json.choices?.[0]?.message?.content?.trim();
    return draft ? ok({ draft }) : fail('No response from AI.');
  } catch (e) { return fail(e.message); }
}

export async function generateFeedbackDraft(factionId) {
  const actor = await requireActor(2);
  const r = assertFactionWrite(actor, factionId);
  if (r.error) return fail(r.error);
  const faction = r.faction;
  const month = monthKey();
  const review = queryOne("SELECT recommendation, feedback FROM faction_reviews WHERE faction_id = ? AND review_month = ?", [faction.id, month]);
  const notes = query("SELECT author_name, note FROM leadership_personal_notes WHERE faction_id = ? AND review_month = ? ORDER BY created_at", [faction.id, month]);
  if (!review?.feedback?.trim() && notes.length === 0) return fail('No feedback or leadership notes found for this faction yet. Write your review first.');
  const scenes30 = queryOne("SELECT COUNT(*) AS c FROM scene_logs WHERE faction_id = ? AND created_at >= datetime('now','-30 days')", [faction.id])?.c || 0;
  const forumPosts = faction.forum_posts_30d || 0;
  const threadStatus = forumPosts === 0
    ? 'NO posts in the last 30 days — NOT meeting faction thread guidelines (demotion risk)'
    : forumPosts < 3 ? `${forumPosts} post(s) in the last 30 days — faction thread activity is low`
    : `${forumPosts} posts in the last 30 days — faction thread is active`;
  const lines = [`Faction: ${faction.name} (Tier ${faction.tier})`, `30-day scenes: ${scenes30}`, `Faction thread activity: ${threadStatus}`];
  if (review) {
    lines.push(`\nTeam Lead Recommendation: ${review.recommendation}`);
    if (review.feedback?.trim()) lines.push(`Team Lead Feedback:\n${review.feedback.trim()}`);
  }
  if (notes.length) { lines.push('\nFM Leadership Notes:'); notes.forEach(n => lines.push(`- ${n.author_name}: ${n.note}`)); }
  return openai([
    { role: 'system', content: 'You are a writer for Faction Management in a GTA RP server. You help craft casual, direct feedback messages to send to faction leads. Write from the perspective of Faction Management as a team — never use "I", always use "we" or "FM". Start the message with "Hello [Faction Name]." on its own line, then continue from there. Write in plain paragraphs only — no markdown, no asterisks, no bullet dashes. Keep it 2–4 paragraphs, under 300 words. Be conversational and straightforward, not corporate or overly formal. Be specific to the feedback provided. Always address faction thread activity — if the faction is not meeting thread guidelines, call it out clearly and explain it is a demotion factor. If they are meeting it, acknowledge it.' },
    { role: 'user', content: `Draft a message from Faction Management to send to this faction lead. Open with "Hello [Faction Name]." — replace [Faction Name] with the actual faction name. Keep the tone casual and direct. Always include a comment on their faction thread activity based on the data provided. Reference specific feedback points, give actionable suggestions where relevant, and write as if FM is speaking collectively.\n\n${lines.join('\n')}` },
  ]);
}

export async function adjustFeedbackDraft(factionId, currentMessage, instruction) {
  const actor = await requireActor(2);
  const message = str(currentMessage, { max: 6000 });
  const instr = str(instruction, { max: 500 });
  if (!message) return fail('No message to adjust.');
  if (!instr) return fail('Please provide an adjustment instruction.');
  const r = assertFactionWrite(actor, factionId);
  if (r.error) return fail(r.error);
  return openai([
    { role: 'system', content: 'You are a writer for Faction Management in a GTA RP server. You adjust existing feedback messages based on instructions. Write from FM\'s perspective — never use "I", always use "we" or "FM". Keep the opening greeting intact. Write in plain paragraphs only — no markdown, no asterisks, no bullet dashes. Preserve the tone and structure unless the instruction says otherwise.' },
    { role: 'user', content: `Adjust the following feedback message based on this instruction: "${instr}"\n\nCurrent message:\n${message}` },
  ]);
}

function markSent(actor, review, how) {
  run("UPDATE faction_reviews SET feedback_sent_at = ?, feedback_sent_by = ?, updated_at = ? WHERE id = ?", [nowIso(), actor.name, nowIso(), review.id]);
  logAudit(actor.id, actor.name, 'CREATE', 'feedback_sent', review.id, review.faction_name, how);
}

/** Deliver this month's feedback to the faction's command channel and record it on the review. */
export async function sendFeedbackToFaction(factionId, message) {
  const actor = await requireActor(2);
  const text = str(message, { max: 4000 });
  if (!text) return fail('Message is empty.');
  const r = assertFactionWrite(actor, factionId);
  if (r.error) return fail(r.error);
  const faction = r.faction;
  const month = monthKey();
  const review = queryOne("SELECT * FROM faction_reviews WHERE faction_id = ? AND review_month = ?", [faction.id, month]);
  if (!review) return fail("Submit this month's team lead review before sending feedback.");
  const config = queryOne("SELECT comms_channel_id FROM bot_server_configs WHERE faction_id = ?", [faction.id]);
  if (!config?.comms_channel_id) return fail(`${faction.name} has no comms channel configured.`);
  if (!process.env.DISCORD_BOT_TOKEN) return fail('Bot token not configured.');
  const embed = {
    title: `Monthly Feedback - ${new Date().toLocaleString('en-US', { month: 'long' })}`,
    description: text, color: 0xa07ef5, footer: { text: `Sent by ${actor.name}` }, timestamp: nowIso(),
  };
  const delivered = await sendDiscord(config.comms_channel_id, '', [embed]);
  if (!delivered) return fail('Discord delivery failed — check the bot can post in the faction comms channel.');
  transaction(() => {
    run("INSERT INTO faction_public_messages (faction_id, faction_name, author_name, author_id, message, is_pinned, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
      [faction.id, faction.name, actor.name, actor.id, text, nowIso()]);
    markSent(actor, review, `Sent via comms: ${text.substring(0, 100)}`);
  });
  await sendPing('review.feedback_sent', `📨 **${actor.name}** sent the ${month} feedback message to **${faction.name}** via Faction Management comms.\n${urls.faction(faction.name, 'review')}`);
  return ok({ sentAt: nowIso(), by: actor.name });
}

/** Feedback was delivered outside the dashboard. Idempotent. */
export async function markFeedbackSent(factionId) {
  const actor = await requireActor(2);
  const r = assertFactionWrite(actor, factionId);
  if (r.error) return fail(r.error);
  const faction = r.faction;
  const month = monthKey();
  const review = queryOne("SELECT * FROM faction_reviews WHERE faction_id = ? AND review_month = ?", [faction.id, month]);
  if (!review) return fail("Submit this month's team lead review before marking feedback as sent.");
  if (review.feedback_sent_at) return ok({ already: true, sentAt: review.feedback_sent_at, by: review.feedback_sent_by });
  markSent(actor, review, 'Marked as sent manually');
  await sendPing('review.feedback_sent', `📨 **${actor.name}** marked the ${month} feedback as sent to **${faction.name}** (delivered outside the dashboard).\n${urls.faction(faction.name, 'review')}`);
  return ok({ sentAt: nowIso(), by: actor.name });
}

/** { sent, by, at } for this month, read from faction_reviews. */
export async function getFeedbackStatus(factionId) {
  await requireActor(2, { allowLeadStoryteller: true });
  const review = queryOne("SELECT feedback_sent_at, feedback_sent_by FROM faction_reviews WHERE faction_id = ? AND review_month = ?", [toInt(factionId), monthKey()]);
  return review?.feedback_sent_at ? { sent: true, by: review.feedback_sent_by, at: review.feedback_sent_at } : { sent: false };
}

// ══════════════════════════════════════════════
// QUEUE (approvals)
// ══════════════════════════════════════════════

export async function getPendingQueue() {
  const actor = await requireActor(2, { allowLeadStoryteller: true });
  const factions = scopedFactions(actor);
  const ids = factions.map(f => f.id);
  if (!ids.length) return { rpChanges: [], deletions: [], promos: [] };
  const ph = ids.map(() => '?').join(',');
  const rpChanges = query(`SELECT e.*, f.name AS faction_name FROM pending_executions e JOIN factions f ON e.faction_id = f.id
    WHERE e.faction_id IN (${ph}) AND e.status IN ('PENDING','APPROVED','RP_DONE') ORDER BY e.created_at DESC`, ids);
  const deletions = actor.level >= 3 || actor.isLeadStoryteller
    ? query("SELECT * FROM deletion_requests WHERE status = 'PENDING' ORDER BY created_at DESC LIMIT 50")
    : query("SELECT * FROM deletion_requests WHERE status = 'PENDING' AND discord_id = ? ORDER BY created_at DESC LIMIT 50", [actor.id]);
  const authByFaction = {};
  query(`SELECT fi.faction_id, i.name FROM faction_imports fi JOIN import_items i ON i.id = fi.item_id WHERE fi.permitted = 1 AND fi.faction_id IN (${ph})`, ids)
    .forEach(r => { (authByFaction[r.faction_id] ||= []).push(r.name); });
  const promos = [];
  for (const f of factions) {
    if (!f.pending_promo) continue;
    let p = null;
    try { p = JSON.parse(f.pending_promo); } catch { p = f.pending_promo; }
    const tier = toInt(p && typeof p === 'object' ? p.tier : p, { min: 0, max: 9 });
    const imports = p && typeof p === 'object' && Array.isArray(p.imports) ? p.imports : (authByFaction[f.id] || []);
    promos.push({
      faction_id: f.id, faction_name: f.name, current_tier: f.tier,
      tier, imports,
      newImports: imports.filter(n => !(authByFaction[f.id] || []).includes(n)),
      target_tier: JSON.stringify({ tier, imports }),
    });
  }
  return { rpChanges, deletions, promos };
}

// ══════════════════════════════════════════════
// PERFORMANCE
// ══════════════════════════════════════════════

export async function getTeamPerformance() {
  const actor = await requireActor(2);
  let teams;
  if (actor.level >= 3) {
    teams = query("SELECT team_id, team_name FROM teams WHERE team_name != 'Game Affairs Management' ORDER BY team_name");
  } else {
    if (!actor.teamId) return [];
    const t = queryOne("SELECT team_id, team_name FROM teams WHERE team_id = ?", [actor.teamId]);
    teams = t ? [t] : [{ team_id: actor.teamId, team_name: actor.teamName || '' }];
  }
  if (!teams.length) return [];
  const tph = teams.map(() => '?').join(',');
  const tids = teams.map(t => t.team_id);
  const staff = query(`SELECT discord_id, display_name, team_id, clearance FROM staff WHERE team_id IN (${tph}) AND discord_id != '' AND discord_id NOT LIKE 'placeholder%' AND COALESCE(active, 1) = 1`, tids);
  const factions = query(`SELECT f.id, f.forum_posts_30d, s.team_id FROM factions f JOIN staff s ON s.discord_id = f.lead_discord_id WHERE f.archived = 0 AND s.team_id IN (${tph})`, tids);
  const fids = factions.map(f => f.id);
  const sceneByFaction = {};
  if (fids.length) {
    query(`SELECT faction_id, COUNT(*) AS allc, SUM(CASE WHEN created_at >= datetime('now','-30 days') THEN 1 ELSE 0 END) AS c30 FROM scene_logs WHERE faction_id IN (${fids.map(() => '?').join(',')}) GROUP BY faction_id`, fids)
      .forEach(r => { sceneByFaction[r.faction_id] = r; });
  }
  const sids = staff.map(s => s.discord_id);
  const openByStaff = {}, doneByStaff = {};
  if (sids.length) {
    const sph = sids.map(() => '?').join(',');
    query(`SELECT who, COUNT(*) AS c FROM (
        SELECT target_id AS who FROM tasks WHERE status = 'open' AND target_type = 'User' AND target_id IN (${sph})
        UNION ALL
        SELECT claimed_by AS who FROM tasks WHERE status = 'open' AND claimed_by IN (${sph}) AND NOT (target_type = 'User' AND target_id = claimed_by)
      ) GROUP BY who`, [...sids, ...sids]).forEach(r => { openByStaff[r.who] = r.c; });
    query(`SELECT completed_by_id AS who, COUNT(*) AS c FROM tasks WHERE status = 'completed' AND completed_by_id IN (${sph}) AND completed_at >= datetime('now','-30 days') GROUP BY completed_by_id`, sids)
      .forEach(r => { doneByStaff[r.who] = r.c; });
  }
  return teams.map(t => {
    const members = staff.filter(s => s.team_id === t.team_id);
    const facs = factions.filter(f => f.team_id === t.team_id);
    const scenes30 = facs.reduce((s, f) => s + (sceneByFaction[f.id]?.c30 || 0), 0);
    const scenesAll = facs.reduce((s, f) => s + (sceneByFaction[f.id]?.allc || 0), 0);
    const lead = members.find(s => Number(s.clearance) === 2);
    return {
      teamId: t.team_id, teamName: t.team_name,
      leadName: lead?.display_name || 'Vacant',
      guideCount: members.filter(s => Number(s.clearance) === 1).length,
      factionCount: facs.length,
      scenes30, scenesAll,
      forumPosts30: facs.reduce((s, f) => s + (f.forum_posts_30d || 0), 0),
      openTasks: members.reduce((s, m) => s + (openByStaff[m.discord_id] || 0), 0),
      completedTasks: members.reduce((s, m) => s + (doneByStaff[m.discord_id] || 0), 0),
      scenesPerFaction: facs.length ? (scenes30 / facs.length).toFixed(1) : '0',
    };
  });
}

export async function getGuideActivity() {
  const actor = await requireActor(2);
  let staffList;
  if (actor.level >= 3) {
    staffList = query("SELECT * FROM staff WHERE discord_id != '' AND discord_id NOT LIKE 'placeholder%' AND COALESCE(active, 1) = 1 AND team_name != 'Game Affairs Management' ORDER BY team_name, clearance DESC, display_name");
  } else {
    if (!actor.teamId) return [];
    staffList = query("SELECT * FROM staff WHERE team_id = ? AND discord_id != '' AND discord_id NOT LIKE 'placeholder%' AND COALESCE(active, 1) = 1 ORDER BY clearance DESC, display_name", [actor.teamId]);
  }
  if (!staffList.length) return [];
  const ids = staffList.map(s => s.discord_id);
  const ph = ids.map(() => '?').join(',');
  const scenes = {};
  query(`SELECT who,
      SUM(CASE WHEN created_at >= datetime('now','-30 days') THEN 1 ELSE 0 END) AS s30,
      SUM(CASE WHEN created_at >= datetime('now','-60 days') AND created_at < datetime('now','-30 days') THEN 1 ELSE 0 END) AS s60,
      COUNT(*) AS sall
    FROM (
      SELECT author_id AS who, id, created_at FROM scene_logs WHERE author_id IN (${ph})
      UNION
      SELECT sa.staff_id AS who, sl.id, sl.created_at FROM scene_assistants sa JOIN scene_logs sl ON sl.id = sa.scene_id WHERE sa.staff_id IN (${ph})
    ) GROUP BY who`, [...ids, ...ids]).forEach(r => { scenes[r.who] = r; });
  const notes = {};
  query(`SELECT author_id AS who, COUNT(*) AS c FROM intel_notes WHERE author_id IN (${ph}) AND created_at >= datetime('now','-30 days') GROUP BY author_id`, ids).forEach(r => { notes[r.who] = r.c; });
  const tasks = {};
  query(`SELECT completed_by_id AS who, COUNT(*) AS c FROM tasks WHERE status = 'completed' AND completed_by_id IN (${ph}) AND completed_at >= datetime('now','-30 days') GROUP BY completed_by_id`, ids).forEach(r => { tasks[r.who] = r.c; });
  return staffList.map(s => ({
    id: s.discord_id, name: s.display_name, team: s.team_name || '', rank: s.rank || '',
    scenes30: scenes[s.discord_id]?.s30 || 0, scenes60: scenes[s.discord_id]?.s60 || 0, scenesAll: scenes[s.discord_id]?.sall || 0,
    notes30: notes[s.discord_id] || 0,
    tasksCompleted: tasks[s.discord_id] || 0,
  }));
}

// ══════════════════════════════════════════════
// MEETING NOTES
// ══════════════════════════════════════════════
// A meeting note targets a faction (default), an FM team, or a staff group.
//   target_type 'faction' -> faction_id holds the faction; target_key ''
//   target_type 'team'    -> target_key = teams.team_id
//   target_type 'group'   -> target_key = one of NOTE_GROUPS below
// Staff groups are L3-only. `clause` is a constant SQL fragment (never user input).
const NOTE_GROUPS = {
  team_leads: { label: 'Team Leads',    clause: 'clearance = 2'  },
  management: { label: 'FM Management', clause: 'clearance >= 3' },
  all_staff:  { label: 'All FM Staff',  clause: 'clearance >= 1' },
};
const NOTE_COLS = `n.id, n.faction_id, n.date, n.author, n.author_id, n.text AS content, n.created_at, n.meeting_type,
  n.target_type, n.target_key, n.target_label, n.attendees_json, f.name AS faction_name`;

function noteInScope(actor, { targetType, factionId, targetKey }) {
  if (targetType === 'team') {
    if (!targetKey || !queryOne("SELECT team_id FROM teams WHERE team_id = ?", [targetKey])) return false;
    return actor.level >= 3 || actor.teamId === targetKey;
  }
  if (targetType === 'group') return actor.level >= 3 && !!NOTE_GROUPS[targetKey];
  const id = toInt(factionId);
  if (!id) return false;
  const f = queryOne("SELECT id, archived FROM factions WHERE id = ?", [id]);
  if (!f || f.archived) return false;
  return canWriteFaction(actor, id);
}

function shapeNote(n) {
  let attendeeIds = [];
  try { attendeeIds = JSON.parse(n.attendees_json || '[]'); } catch {}
  return {
    ...n, content: sanitizeHtml(n.content), attendeeIds,
    display_name: n.target_type === 'faction' ? (n.faction_name || 'Unknown faction') : (n.target_label || 'Meeting'),
  };
}

export async function getMeetingNotes() {
  const actor = await requireActor(1, { allowEventTeam: true, allowLeadStoryteller: true });
  let rows;
  if (actor.level >= 3) {
    rows = query(`SELECT ${NOTE_COLS} FROM ooc_notes n LEFT JOIN factions f ON n.faction_id = f.id
      WHERE n.target_type != 'faction' OR f.archived = 0 ORDER BY n.created_at DESC LIMIT 100`);
  } else {
    const ids = writableFactionIds(actor);
    const fids = ids ? [...ids] : [];
    const parts = [];
    const params = [];
    if (fids.length) { parts.push(`(n.target_type = 'faction' AND f.archived = 0 AND n.faction_id IN (${fids.map(() => '?').join(',')}))`); params.push(...fids); }
    if (actor.teamId) { parts.push("(n.target_type = 'team' AND n.target_key = ?)"); params.push(actor.teamId); }
    if (!parts.length) return [];
    rows = query(`SELECT ${NOTE_COLS} FROM ooc_notes n LEFT JOIN factions f ON n.faction_id = f.id WHERE ${parts.join(' OR ')} ORDER BY n.created_at DESC LIMIT 100`, params);
  }
  return rows.map(shapeNote);
}

/** One note by id (the full-page editor), scope-checked. null when out of scope. */
export async function getMeetingNote(id) {
  const actor = await requireActor(1, { allowEventTeam: true, allowLeadStoryteller: true });
  const n = queryOne(`SELECT ${NOTE_COLS} FROM ooc_notes n LEFT JOIN factions f ON n.faction_id = f.id WHERE n.id = ?`, [toInt(id)]);
  if (!n) return null;
  if (actor.level < 3) {
    if (n.target_type === 'team' && n.target_key !== actor.teamId) return null;
    if (n.target_type === 'group') return null;
    if (n.target_type === 'faction' && !canWriteFaction(actor, n.faction_id)) return null;
  }
  return shapeNote(n);
}

export async function saveMeetingNote(data) {
  const actor = await requireActor(1);
  const d = data && typeof data === 'object' ? data : {};
  const targetType = oneOf(str(d.targetType) || 'faction', ['faction', 'team', 'group']);
  if (!targetType) return fail('Target must be a faction, team or group.');
  const targetKey = str(d.targetKey);
  const factionId = targetType === 'faction' ? toInt(targetKey) : null;
  const storedKey = targetType === 'faction' ? '' : targetKey;
  if (targetType === 'faction' && !factionId) return fail('Faction is required.');
  if (targetType !== 'faction' && !targetKey) return fail('A target is required.');
  const content = sanitizeHtml(d.content);
  if (!htmlToText(content)) return fail('The note is empty.');
  if (!noteInScope(actor, { targetType, factionId, targetKey })) return fail('Target not in your scope.');
  const attendees = (Array.isArray(d.attendeeIds) ? d.attendeeIds : []).map(String).filter(isSnowflake);

  let targetLabel = '';
  if (targetType === 'team') targetLabel = queryOne("SELECT team_name FROM teams WHERE team_id = ?", [targetKey])?.team_name || '';
  else if (targetType === 'group') targetLabel = NOTE_GROUPS[targetKey]?.label || '';
  else targetLabel = queryOne("SELECT name FROM factions WHERE id = ?", [factionId])?.name || '';

  const id = toInt(d.id);
  if (id) {
    const note = queryOne("SELECT id, faction_id, author_id, target_type, target_key FROM ooc_notes WHERE id = ?", [id]);
    if (!note) return fail('Note not found.');
    if (!noteInScope(actor, { targetType: note.target_type, factionId: note.faction_id, targetKey: note.target_key }) && actor.level < 3) return fail('Note not in your scope.');
    if (note.author_id !== actor.id && actor.level < 3) return fail('Only the author or leadership can edit this note.');
    run("UPDATE ooc_notes SET faction_id = ?, target_type = ?, target_key = ?, target_label = ?, text = ?, attendees_json = ?, meeting_type = ? WHERE id = ?",
      [factionId, targetType, storedKey, targetLabel, content, JSON.stringify(attendees), targetType === 'faction' ? 'faction_meeting' : `${targetType}_meeting`, id]);
    logAudit(actor.id, actor.name, 'EDIT', 'meeting_note', id, targetLabel, `${targetType} meeting note edited (${attendees.length} attendees)`);
    return ok({ id });
  }
  const newId = Number(run("INSERT INTO ooc_notes (faction_id, date, author, author_id, text, created_at, meeting_type, attendees_json, target_type, target_key, target_label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [factionId, todayIso(), actor.name, actor.id, content, nowIso(), targetType === 'faction' ? 'faction_meeting' : `${targetType}_meeting`, JSON.stringify(attendees), targetType, storedKey, targetLabel]).lastInsertRowid);
  logAudit(actor.id, actor.name, 'CREATE', 'meeting_note', newId, targetLabel, `${targetType} meeting note (${attendees.length} attendees)`);
  return ok({ id: newId });
}

export async function deleteMeetingNote(id) {
  const actor = await requireActor(1);
  const note = queryOne("SELECT id, faction_id, author_id, target_type, target_key, target_label FROM ooc_notes WHERE id = ?", [toInt(id)]);
  if (!note) return fail('Note not found.');
  if (actor.level < 3) {
    if (!noteInScope(actor, { targetType: note.target_type, factionId: note.faction_id, targetKey: note.target_key })) return fail('Note not in your scope.');
    if (note.author_id !== actor.id) return fail('Only the author or leadership can delete this note.');
  }
  run("DELETE FROM ooc_notes WHERE id = ?", [note.id]);
  logAudit(actor.id, actor.name, 'DELETE', 'meeting_note', note.id, note.target_label || (note.faction_id ? queryOne("SELECT name FROM factions WHERE id = ?", [note.faction_id])?.name : '') || '', `${note.target_type} meeting note deleted`);
  return ok();
}

/** Selectable targets for the Meeting Notes editor, scoped to the actor. */
export async function getNoteTargets() {
  const actor = await requireActor(1, { allowEventTeam: true, allowLeadStoryteller: true });
  const factions = (actor.isEventTeam || actor.isLeadStoryteller) && actor.level < 1
    ? []
    : writableFactions(actor).map(f => ({ id: f.id, name: f.name }));
  let teams = [];
  if (actor.level >= 3) teams = query("SELECT team_id, team_name FROM teams ORDER BY team_name");
  else if (actor.teamId) { const t = queryOne("SELECT team_id, team_name FROM teams WHERE team_id = ?", [actor.teamId]); if (t) teams = [t]; }
  const groups = actor.level >= 3 ? Object.entries(NOTE_GROUPS).map(([key, g]) => ({ key, label: g.label })) : [];
  return { factions, teams, groups };
}

/** Members to pre-fill the attendance list for a target. [] when out of scope. */
export async function getAttendeesForTarget(targetType, targetKey) {
  const actor = await requireActor(1, { allowEventTeam: true, allowLeadStoryteller: true });
  const type = oneOf(str(targetType) || 'faction', ['faction', 'team', 'group']);
  const key = str(targetKey);
  if (!type || !noteInScope(actor, { targetType: type, factionId: type === 'faction' ? key : null, targetKey: key })) return [];
  const members = (clause, params) => query(
    `SELECT discord_id, display_name, rank FROM staff WHERE ${clause} AND discord_id != '' AND discord_id NOT LIKE 'placeholder%' AND COALESCE(active, 1) = 1 ORDER BY clearance DESC, display_name ASC`, params);
  if (type === 'team') return members('team_id = ?', [key]);
  if (type === 'group') { const g = NOTE_GROUPS[key]; return g ? members(g.clause, []) : []; }
  const faction = queryOne("SELECT lead_discord_id FROM factions WHERE id = ?", [toInt(key)]);
  if (!faction?.lead_discord_id) return [];
  const leadTeamId = queryOne("SELECT team_id FROM staff WHERE discord_id = ?", [faction.lead_discord_id])?.team_id;
  return leadTeamId ? members('team_id = ?', [leadTeamId]) : [];
}

// ══════════════════════════════════════════════
// HUB: VOTE STATUS + FEEDBACK DRAFT
// ══════════════════════════════════════════════

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthLabel = (key) => new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Who has voted this month, faction by faction, over the active L3s. L3 sees
 * every active faction, L2 (and Lead Storyteller reads) their team's. A note
 * without a status counts as a note, not a vote; `missing` are L3s with no row.
 */
export async function getVoteStatus(reviewMonth) {
  const actor = await requireActor(2, { allowLeadStoryteller: true });
  const month = str(reviewMonth) || monthKey();
  if (!MONTH_RE.test(month)) return fail('Month must look like YYYY-MM.');
  const voters = leadershipVoters().map(v => ({ id: v.discord_id, name: v.display_name || v.discord_id }));
  const nameOf = Object.fromEntries(voters.map(v => [v.id, v.name]));
  const factions = scopedFactions(actor);
  if (!factions.length) return ok({ month, voters, factions: [] });
  const ids = factions.map(f => f.id);
  const byFaction = {};
  query(`SELECT faction_id, author_id, author_name, status FROM leadership_personal_notes WHERE review_month = ? AND faction_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at, id`, [month, ...ids])
    .forEach(n => { (byFaction[n.faction_id] ||= []).push(n); });
  return ok({
    month, voters,
    factions: factions.map(f => {
      const votes = (byFaction[f.id] || []).map(n => ({ authorId: n.author_id, authorName: nameOf[n.author_id] || n.author_name, status: n.status || '' }));
      const seen = new Set(votes.map(v => v.authorId));
      const missing = voters.filter(v => !seen.has(v.id));
      return { factionId: f.id, name: f.name, votes, missing, voted: votes.filter(v => v.status).length, complete: missing.length === 0 && votes.every(v => v.status) };
    }),
  });
}

/**
 * A plain-text feedback message for the faction, written the way the team writes
 * them (greeting, where the month landed, activity, the team's and leadership's
 * points, the standard sign-off), from that month's review, leadership notes,
 * scene count and promotion state. Nothing is sent and no names from the notes
 * leak; the lead edits the draft before it goes out. L3 any faction, L2 own team.
 */
export async function getFeedbackDraft(factionId, reviewMonth) {
  const actor = await requireActor(2);
  const month = str(reviewMonth) || monthKey();
  if (!MONTH_RE.test(month)) return fail('Month must look like YYYY-MM.');
  const r = assertFactionWrite(actor, factionId);
  if (r.error) return fail(r.error);
  const f = r.faction;
  const review = queryOne("SELECT * FROM faction_reviews WHERE faction_id = ? AND review_month = ?", [f.id, month]);
  const notes = query("SELECT note, status FROM leadership_personal_notes WHERE faction_id = ? AND review_month = ? AND TRIM(note) != '' ORDER BY created_at, id", [f.id, month]);
  if (!review && !notes.length) return fail(`No team lead review or leadership notes for ${f.name} in ${month} yet.`);

  const scenes = queryOne("SELECT COUNT(*) AS c FROM scene_logs WHERE faction_id = ? AND substr(created_at, 1, 7) = ?", [f.id, month])?.c || 0;
  const current = month === monthKey();
  const forumPosts = current ? (f.forum_posts_30d || 0) : null;
  const moves = query("SELECT action_type, details, created_at FROM faction_history WHERE faction_id = ? AND action_type IN ('PROMOTED','DEMOTED') AND substr(created_at, 1, 7) = ? ORDER BY created_at DESC, id DESC", [f.id, month]);
  const tally = tallyVotes(f.id, month);
  const status = review?.status && review.status !== 'Pending Discussion' ? review.status : tally.status;
  const outcome = /^Confirmed /.test(status) ? status.replace('Confirmed ', '') : null;
  const rec = review?.recommendation || null;
  let staged = null;
  if (f.pending_promo) { try { const p = JSON.parse(f.pending_promo); staged = toInt(p && typeof p === 'object' ? p.tier : p, { min: 0, max: 9 }); } catch { staged = toInt(f.pending_promo, { min: 0, max: 9 }); } }
  const when = monthLabel(month);
  const sources = [];
  const p = [];

  p.push(`Hello ${f.name},`);

  // Where the month landed.
  const applied = moves[0] || null;
  if (applied?.action_type === 'PROMOTED') {
    p.push(`First off, congratulations. Following the ${when} review ${f.name} has been promoted to Tier ${f.tier}. That is the result of the work you have been putting in, so keep doing what got you here.`);
    sources.push({ kind: 'promotion', label: `Promoted in ${month} (${applied.details.split(' · ')[0]})` });
  } else if (applied?.action_type === 'DEMOTED') {
    p.push(`We will be straight with you: following the ${when} review ${f.name} has been demoted to Tier ${f.tier}. What has been lost can be recovered, and we would like to see you climb back.`);
    sources.push({ kind: 'demotion', label: `Demoted in ${month} (${applied.details.split(' · ')[0]})` });
  } else if (outcome === 'Promote') {
    p.push(`Good news first: FM Leadership has confirmed a promotion for ${f.name} this month.${staged != null ? ` The move to Tier ${staged} is staged and will be applied once the roleplay that goes with it has run.` : ' Your guides will be in touch about the roleplay that goes with it before the tier change is applied.'}`);
    sources.push({ kind: 'outcome', label: `Outcome: Confirmed Promote${staged != null ? ` (staged → Tier ${staged})` : ''}` });
  } else if (outcome === 'Hold') {
    p.push(`This month's review landed on a hold, so ${f.name} stays at Tier ${f.tier}. That is not a bad place to be, but we want to see the points below worked on before the next cycle.`);
    sources.push({ kind: 'outcome', label: 'Outcome: Confirmed Hold' });
  } else if (outcome === 'Demote') {
    p.push(`This month's review landed on a demotion. ${f.name} will move down from Tier ${f.tier}; the reasons are below, and so is the way back.`);
    sources.push({ kind: 'outcome', label: 'Outcome: Confirmed Demote' });
  } else if (outcome === 'Remove') {
    p.push(`This month's review has not gone well, and FM Leadership has confirmed that ${f.name} will be removed as a faction. Your guides will walk you through what that means and when.`);
    sources.push({ kind: 'outcome', label: 'Outcome: Confirmed Remove' });
  } else if (rec) {
    const recWord = { Promote: 'a promotion', Hold: 'a hold at your current tier', Demote: 'a demotion', Remove: 'removal' }[rec] || rec.toLowerCase();
    p.push(`Your team lead has put ${f.name} forward for ${recWord} for ${when} and FM Leadership is finalising the outcome; we will follow up once that is settled.`);
    sources.push({ kind: 'outcome', label: `Outcome pending (${tally.confirmed} of the votes in)` });
  } else {
    p.push(`FM Leadership is finalising the outcome of the ${when} review for ${f.name}; we will follow up once that is settled.`);
    sources.push({ kind: 'outcome', label: 'Outcome pending' });
  }

  // Activity for the month, and the faction thread when the month is still live.
  let activity = `On activity: we logged ${plural(scenes, 'scene')} with ${f.name} in ${when}.`;
  if (scenes === 0) activity += ' We would like to see that change — reach out to your guides to get something on the calendar.';
  sources.push({ kind: 'scenes', label: `${plural(scenes, 'scene')} logged in ${month}` });
  if (forumPosts != null) {
    if (forumPosts === 0) activity += ' We also have not seen a post on your faction thread in the last 30 days. The thread is a requirement at every tier and it counts against you at review time, so please get something up.';
    else if (forumPosts < 3) activity += ` Your faction thread has had ${plural(forumPosts, 'post')} in the last 30 days, which is on the low side — keep it moving.`;
    else activity += ` Your faction thread is active (${forumPosts} posts in the last 30 days), which we appreciate.`;
    sources.push({ kind: 'forum', label: `${plural(forumPosts, 'forum post')} in the last 30 days` });
  }
  p.push(activity);

  // The team lead's written feedback, then leadership's points (never their authors).
  if (review?.feedback?.trim()) {
    p.push(`Here is what your team had to say this month:\n\n${review.feedback.trim()}`);
    sources.push({ kind: 'review', label: `Team lead review ${month}${rec ? ` (${rec})` : ''}` });
  } else if (review) sources.push({ kind: 'review', label: `Team lead review ${month}${rec ? ` (${rec})` : ''}` });
  if (notes.length) {
    p.push(`FM Leadership also wanted to pass along the following:\n\n${notes.map(n => n.note.trim()).join('\n\n')}`);
    sources.push({ kind: 'notes', label: `${plural(notes.length, 'leadership note')} for ${month}` });
  }

  p.push("As always, please don't hesitate to reach out to your guides if you need to discuss anything.");
  p.push('— Faction Management');

  return ok({ draft: p.join('\n\n'), sources, month, faction: f.name, status, recommendation: rec, scenes });
}
