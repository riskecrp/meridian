/**
 * Monthly Promotion Review — fires on the 14th at 12:00 UTC
 * Poll result processor  — checks every 5 minutes for closed polls
 *
 * Policy 7: one leadership_personal_notes row per L3 per faction per month is
 * that leader's vote (UNIQUE(faction_id, author_id, review_month)). The tally
 * DERIVES faction_reviews.status — 'Confirmed Promote' / 'Confirmed Hold' /
 * 'Confirmed Demote' / 'Confirmed Remove' when two thirds of the votes agree,
 * otherwise 'Pending Discussion' — and writes it back. Confirmed Promote opens
 * the weapon polls; Confirmed Demote / Remove raise a leadership task straight
 * away, exactly as a closed promotion poll does.
 *
 * Idempotent: a faction that already has polls this month is skipped, the
 * month's thread is reused, tasks are keyed by faction + month, and poll
 * results are read from Discord's own `is_finalized` / `expiry` rather than
 * from elapsed time. A poll that cannot be fetched stays unprocessed and is
 * retried (and reported in sync_status) instead of being counted as empty.
 */

import cron from 'node-cron';
import { query, queryOne, run, transaction } from './lib/db.js';
import { pingChannel, getRole } from './lib/pings.js';
import { recordSyncOk, recordSyncFail } from './lib/syncStatus.js';
import { BOT_ACTOR } from './lib/auth.js';
import { createTask } from '../shared/tasks.js';
import { REVIEW_STATUSES } from '../shared/validate.js';
import { monthKey, nowIso } from '../shared/dates.js';

export const GUN_CATEGORIES = (process.env.PROMO_GUN_CATEGORIES || [
  'Pistol Light', 'Pistol Medium', 'Pistol Heavy',
  'SMG', 'OP SMG',
  'Shotgun', 'Shotgun Auto',
  'Rifle Mk1', 'Rifle Mk2',
  'MG',
].join(',')).split(',').map(s => s.trim()).filter(Boolean);

// A confirmed outcome needs this share of the votes cast.
const THRESHOLD = 2 / 3;
// A poll whose message cannot be fetched for this long after it should have
// closed is given up on (the thread was deleted) rather than retried forever.
const POLL_GIVE_UP_DAYS = 7;

// ── Discord helpers ────────────────────────────────────────────────────────────

async function discordPost(token, path, body) {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Discord POST ${path} → ${res.status}: ${err}`);
  }
  return res.json();
}

async function discordGet(token, path) {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bot ${token}` },
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    const e = new Error(`Discord GET ${path} → ${res.status}: ${err}`);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

// ── Date helpers ───────────────────────────────────────────────────────────────

const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
function threadName(month) {
  const [y, m] = month.split('-');
  return `${y}-${MONTHS[Number(m) - 1]} Promotion Discussions`;
}

// ── Tally (policy 7) ───────────────────────────────────────────────────────────

const CONFIRMED = REVIEW_STATUSES.filter(s => s.startsWith('Confirmed '));

/**
 * The votes for a month, grouped by faction. A note whose status is blank or
 * "Pending Discussion" is a note, not a vote, and does not count toward the
 * threshold. Returns { [factionId]: { name, votes, counts: {status: n}, status } }.
 */
export function tallyMonth(month) {
  const notes = query(
    `SELECT n.faction_id, f.name AS faction_name, n.status
       FROM leadership_personal_notes n JOIN factions f ON f.id = n.faction_id
      WHERE n.review_month = ? AND f.archived = 0`,
    [month]
  );
  const byFaction = {};
  for (const n of notes) {
    const v = byFaction[n.faction_id] ||= { name: n.faction_name, votes: 0, counts: {} };
    if (!CONFIRMED.includes(n.status)) continue;
    v.votes++;
    v.counts[n.status] = (v.counts[n.status] || 0) + 1;
  }
  for (const v of Object.values(byFaction)) {
    v.status = 'Pending Discussion';
    for (const [status, count] of Object.entries(v.counts)) {
      if (v.votes > 0 && count / v.votes >= THRESHOLD) v.status = status;
    }
  }
  return byFaction;
}

const RECOMMENDATION_FOR = { 'Confirmed Promote': 'Promote', 'Confirmed Hold': 'Hold', 'Confirmed Demote': 'Demote', 'Confirmed Remove': 'Remove' };

/** Write the derived status onto faction_reviews (upsert; never touches the lead's recommendation on an existing row). */
export function writeDerivedStatus(factionId, factionName, month, status) {
  const existing = queryOne("SELECT id, status FROM faction_reviews WHERE faction_id = ? AND review_month = ?", [factionId, month]);
  if (existing) {
    if (existing.status === status) return { changed: false };
    run("UPDATE faction_reviews SET status = ?, updated_at = ? WHERE id = ?", [status, nowIso(), existing.id]);
    return { changed: true, from: existing.status };
  }
  run("INSERT INTO faction_reviews (faction_id, faction_name, review_month, recommendation, feedback, reviewer_id, reviewer_name, submitted_by, status) VALUES (?, ?, ?, ?, '', 'bot', 'Meridian', 'Meridian', ?)",
    [factionId, factionName, month, RECOMMENDATION_FOR[status] || 'Hold', status]);
  return { changed: true, from: null };
}

// ── Leadership tasks ───────────────────────────────────────────────────────────

// Tasks raised by the review carry a marker so a re-run never raises them twice.
const marker = (factionId, month, kind) => `[review ${month} · faction ${factionId} · ${kind}]`;

async function raiseReviewTask(factionId, month, kind, description) {
  const tag = marker(factionId, month, kind);
  const dup = queryOne("SELECT task_uid FROM tasks WHERE description LIKE ?", [`%${tag}%`]);
  if (dup) return { ok: true, uid: dup.task_uid, existing: true };
  const leadership = getRole('fm_leadership');
  if (!leadership) return { ok: false, error: 'discord_roles has no fm_leadership role' };
  return createTask(BOT_ACTOR, { desc: `${description}\n\n${tag}`, targetType: 'Role', targetId: leadership }, { via: 'promotion review' });
}

// ── Main review job (14th at 12:00 UTC) ───────────────────────────────────────

export async function runPromotionReview(client, { now = new Date() } = {}) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) { console.error('[PROMO] No bot token.'); recordSyncFail('promotion_review', 'no bot token'); return { ok: false, error: 'no bot token' }; }

  const month = monthKey(now);
  console.log(`[PROMO] Running promotion review for ${month}`);
  const tally = tallyMonth(month);
  const entries = Object.entries(tally);
  if (entries.length === 0) {
    console.log('[PROMO] No leadership notes found — skipping.');
    recordSyncOk('promotion_review', `${month}: no leadership notes`);
    return { ok: true, month, factions: 0 };
  }

  // Derived statuses first — the dashboard shows them whether or not Discord
  // cooperates below.
  const outcome = { month, promote: [], demote: [], remove: [], discuss: [], hold: [], tasks: [], polls: 0, skipped: [] };
  for (const [idStr, v] of entries) {
    const factionId = Number(idStr);
    writeDerivedStatus(factionId, v.name, month, v.status);
    const item = { factionId, name: v.name, counts: v.counts, votes: v.votes };
    if (v.status === 'Confirmed Promote') outcome.promote.push(item);
    else if (v.status === 'Confirmed Demote') outcome.demote.push(item);
    else if (v.status === 'Confirmed Remove') outcome.remove.push(item);
    else if (v.status === 'Confirmed Hold') outcome.hold.push(item);
    else if (v.votes > 0) outcome.discuss.push(item);
  }

  // Demote / Remove raise a leadership task like a closed promotion poll does.
  for (const kind of ['demote', 'remove']) {
    for (const f of outcome[kind]) {
      const verb = kind === 'demote' ? 'Demote' : 'Remove';
      const r = await raiseReviewTask(f.factionId, month, kind,
        `${f.name} — Confirmed ${verb} (${month} review)\n\nLeadership voted ${f.counts[`Confirmed ${verb}`]}/${f.votes} to ${kind} ${f.name}. ${kind === 'demote' ? 'Stage the demotion in the Factions dashboard and tell the team lead.' : 'Remove the faction (archive it) in the Factions dashboard and tell the team lead.'}`);
      if (r.ok) outcome.tasks.push({ faction: f.name, kind, uid: r.uid, existing: !!r.existing });
      else console.error(`[PROMO] task for ${f.name} (${kind}) failed:`, r.error);
    }
  }

  const needsThread = outcome.promote.length > 0 || outcome.discuss.length > 0;
  if (!needsThread) {
    console.log('[PROMO] No promotions or discussions needed.');
    recordSyncOk('promotion_review', `${month}: ${entries.length} faction(s) tallied; no polls or discussions; ${outcome.tasks.length} task(s)`);
    return { ok: true, ...outcome };
  }

  // Factions that already have polls this month are done; the month's thread
  // (if any) is reused for the rest.
  const existingPolls = query("SELECT faction_id, thread_id FROM promotion_polls WHERE strftime('%Y-%m', created_at) = ?", [month]);
  const polledIds = new Set(existingPolls.map(p => p.faction_id));
  const toPoll = outcome.promote.filter(f => !polledIds.has(f.factionId));
  outcome.skipped = outcome.promote.filter(f => polledIds.has(f.factionId)).map(f => f.name);
  if (!toPoll.length && existingPolls.length) {
    console.log(`[PROMO] ${month} already reviewed — nothing new to poll.`);
    recordSyncOk('promotion_review', `${month}: already reviewed (${outcome.skipped.length} faction(s) polled earlier)`);
    return { ok: true, ...outcome, alreadyReviewed: true };
  }

  const boardChannel = pingChannel('promo.review.thread');
  if (!boardChannel) {
    recordSyncFail('promotion_review', 'route promo.review.thread is disabled or has no channel');
    return { ok: false, ...outcome, error: 'promo.review.thread route unavailable' };
  }
  const tName = threadName(month);
  let threadId = existingPolls[0]?.thread_id || null;
  if (!threadId) {
    try {
      const thread = await discordPost(token, `/channels/${boardChannel}/threads`, { name: tName, auto_archive_duration: 10080, type: 11 });
      threadId = thread.id;
      console.log(`[PROMO] Created thread "${tName}" (${threadId})`);
    } catch (e) {
      console.error('[PROMO] Failed to create thread:', e.message);
      recordSyncFail('promotion_review', `thread: ${e.message}`);
      return { ok: false, ...outcome, error: e.message };
    }

    // Opening ping
    const sections = [];
    if (outcome.promote.length) sections.push(`**Confirmed Promotions:** ${outcome.promote.map(f => f.name).join(', ')}`);
    if (outcome.demote.length)  sections.push(`**Confirmed Demotions:** ${outcome.demote.map(f => f.name).join(', ')} (leadership tasks raised)`);
    if (outcome.remove.length)  sections.push(`**Confirmed Removals:** ${outcome.remove.map(f => f.name).join(', ')} (leadership tasks raised)`);
    if (outcome.hold.length)    sections.push(`**Confirmed Hold:** ${outcome.hold.map(f => f.name).join(', ')}`);
    if (outcome.discuss.length) sections.push(`**Needs Discussion:** ${outcome.discuss.map(d => `${d.name} (${Object.entries(d.counts).map(([s, n]) => `${n} ${s.replace('Confirmed ', '').toLowerCase()}`).join(' / ')})`).join(', ')}`);
    await discordPost(token, `/channels/${threadId}/messages`, {
      content: `<@&${getRole('fm_leadership')}> **Promotion Review — ${tName}**\n\n${sections.join('\n')}\n\nWeapon polls for confirmed promotions are below. Polls close in 48 hours.`,
      allowed_mentions: { parse: [], roles: [getRole('fm_leadership')].filter(Boolean) },
    }).catch(e => console.error('[PROMO] Opening message error:', e.message));

    for (const d of outcome.discuss) {
      await discordPost(token, `/channels/${threadId}/messages`, {
        content: `<@&${getRole('fm_leadership')}> ⚠️ **${d.name}** has a split vote (${Object.entries(d.counts).map(([s, n]) => `${n} ${s.replace('Confirmed ', '').toLowerCase()}`).join(' / ')}) — please discuss and reach a decision.`,
        allowed_mentions: { parse: [], roles: [getRole('fm_leadership')].filter(Boolean) },
      }).catch(e => console.error(`[PROMO] Discussion message error for ${d.name}:`, e.message));
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // Weapon polls for confirmed factions
  const pollErrors = [];
  for (const faction of toPoll) {
    const factionRow = queryOne("SELECT tier FROM factions WHERE id = ?", [faction.factionId]);
    if (!factionRow) { console.warn(`[PROMO] Faction ${faction.name} not found`); continue; }
    const nextTier = parseInt(factionRow.tier) + 1;

    const authorizedIds = new Set(
      query(`SELECT item_id FROM faction_imports WHERE faction_id = ? AND permitted = 1`, [faction.factionId]).map(r => r.item_id)
    );

    const placeholders = GUN_CATEGORIES.map(() => '?').join(',');
    const weapons = query(
      `SELECT id, name, category FROM import_items
       WHERE category IN (${placeholders}) AND CAST(tier AS INTEGER) = ?
       ORDER BY category, name`,
      [...GUN_CATEGORIES, String(nextTier)]
    ).filter(w => !authorizedIds.has(w.id));

    if (weapons.length === 0) {
      await discordPost(token, `/channels/${threadId}/messages`, {
        content: `**${faction.name} Promotion** — No new Tier ${nextTier} weapons available (all already authorized).`,
      }).catch(() => {});
      // Nothing to poll: stage straight away so the promotion is not lost.
      const r = await raiseReviewTask(faction.factionId, month, 'promote',
        `${faction.name} — Stage Promotion to Tier ${nextTier}\n\nLeadership confirmed the promotion; no new Tier ${nextTier} weapons were available to poll. Stage the promotion in the Factions dashboard.`);
      if (r.ok) outcome.tasks.push({ faction: faction.name, kind: 'promote', uid: r.uid, existing: !!r.existing });
      continue;
    }

    // Group by category and create one poll per category
    const byCategory = {};
    for (const w of weapons) (byCategory[w.category] ||= []).push(w);

    for (const [category, items] of Object.entries(byCategory)) {
      try {
        const msg = await discordPost(token, `/channels/${threadId}/messages`, {
          poll: {
            question: { text: `${faction.name} Promotion — ${category}` },
            answers: items.slice(0, 10).map(w => ({ poll_media: { text: w.name.slice(0, 55) } })),
            allow_multiselect: true,
            duration: 48,
          },
        });
        run(
          `INSERT INTO promotion_polls (faction_id, faction_name, next_tier, thread_id, message_id, category, weapon_names, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [faction.factionId, faction.name, nextTier, threadId, msg.id, category, JSON.stringify(items.slice(0, 10).map(w => w.name)), nowIso().slice(0, 19).replace('T', ' ')]
        );
        outcome.polls++;
        console.log(`[PROMO] Poll created: ${faction.name} — ${category} (${items.length} options)`);
        await new Promise(r => setTimeout(r, 600));
      } catch (e) {
        console.error(`[PROMO] Poll error ${faction.name} ${category}:`, e.message);
        pollErrors.push(`${faction.name}/${category}: ${e.message}`);
      }
    }
  }

  console.log(`[PROMO] Review complete for ${month}.`);
  if (pollErrors.length) recordSyncFail('promotion_review', pollErrors.join(' | '));
  else recordSyncOk('promotion_review', `${month}: ${entries.length} faction(s) tallied, ${outcome.polls} poll(s), ${outcome.tasks.length} task(s)`);
  return { ok: pollErrors.length === 0, ...outcome, threadId };
}

// ── Poll result processor ──────────────────────────────────────────────────────

/** Read a poll message and decide whether it is closed. Returns { closed, approved[] } or throws. */
async function readPoll(token, poll, now) {
  const msg = await discordGet(token, `/channels/${poll.thread_id}/messages/${poll.message_id}`);
  const p = msg.poll || {};
  const expiry = p.expiry ? new Date(p.expiry).getTime() : 0;
  const closed = !!p.results?.is_finalized || (expiry > 0 && expiry <= now.getTime());
  if (!closed) return { closed: false, approved: [] };
  const answers = p.answers || [];
  const answerCounts = p.results?.answer_counts || [];
  const weapons = JSON.parse(poll.weapon_names || '[]');
  const approved = [];
  for (const ac of answerCounts) {
    if (ac.count > 0) {
      const answer = answers.find(a => a.answer_id === ac.id);
      const weaponName = answer?.poll_media?.text || weapons[ac.id - 1];
      if (weaponName) approved.push(weaponName);
    }
  }
  return { closed: true, approved };
}

export async function processClosedPolls({ now = new Date() } = {}) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return { ok: false, error: 'no bot token' };

  // Candidates: unprocessed polls old enough to possibly be closed.
  const candidates = query(`
    SELECT * FROM promotion_polls
    WHERE processed = 0
      AND datetime(created_at, '+47 hours') <= datetime(?)
    ORDER BY faction_id, id
  `, [now.toISOString().slice(0, 19).replace('T', ' ')]);
  if (candidates.length === 0) return { ok: true, processed: 0 };
  console.log(`[PROMO] Checking ${candidates.length} poll(s) for results`);

  const byFaction = {};
  for (const p of candidates) {
    (byFaction[p.faction_id] ||= { name: p.faction_name, nextTier: p.next_tier, threadId: p.thread_id, polls: [] }).polls.push(p);
  }

  const errors = [];
  let factionsDone = 0;
  for (const data of Object.values(byFaction)) {
    const results = [];
    let allClosed = true;
    for (const poll of data.polls) {
      try {
        const r = await readPoll(token, poll, now);
        if (!r.closed) { allClosed = false; break; }
        results.push({ poll, approved: r.approved });
        await new Promise(r => setTimeout(r, 300));
      } catch (e) {
        const created = new Date(String(poll.created_at).replace(' ', 'T') + 'Z').getTime();
        const stale = now.getTime() - created > (48 + 24 * POLL_GIVE_UP_DAYS) * 3600000;
        if (stale || e.status === 404) {
          // The poll message is gone for good: record that and stop retrying,
          // without pretending the vote was empty.
          run("UPDATE promotion_polls SET processed = 1 WHERE id = ?", [poll.id]);
          errors.push(`${data.name}/${poll.category}: poll unreachable (${e.message.slice(0, 80)}) — marked processed, NO task created`);
        } else {
          errors.push(`${data.name}/${poll.category}: ${e.message.slice(0, 120)} (will retry)`);
        }
        allClosed = false;
        break;
      }
    }
    if (!allClosed) continue;

    const approvedWeapons = [...new Set(results.flatMap(r => r.approved))];
    const desc = approvedWeapons.length
      ? [
          `${data.name} — Stage Promotion to Tier ${data.nextTier}`,
          ``,
          `Weapon polls have closed. Approved imports:`,
          ...approvedWeapons.map(w => `• ${w}`),
          ``,
          `Stage the promotion in the Factions dashboard with these imports. This will notify Team Leads to schedule the RP.`,
        ].join('\n')
      : `${data.name} — Promote to Tier ${data.nextTier}\n\nNo weapon votes were recorded. Please review poll results and stage the promotion manually in the Factions dashboard.`;
    const month = monthKey(String(data.polls[0].created_at).replace(' ', 'T') + 'Z');
    const task = await raiseReviewTask(Number(data.polls[0].faction_id), month, 'promote', desc);
    if (!task.ok) { errors.push(`${data.name}: task failed (${task.error})`); continue; }
    transaction(() => { for (const r of results) run("UPDATE promotion_polls SET processed = 1 WHERE id = ?", [r.poll.id]); });
    factionsDone++;

    const summary = approvedWeapons.length
      ? [`<@&${getRole('fm_leadership')}> ✅ **${data.name}** — Polls closed`,
         `**Approved imports (${approvedWeapons.length}):** ${approvedWeapons.join(', ')}`,
         `A task has been created for FM Leadership to stage the promotion. Team Leads will be notified once it is staged.`].join('\n')
      : `<@&${getRole('fm_leadership')}> ⚠️ **${data.name}** — No weapon votes were cast. A task has been created to review and stage the promotion manually.`;
    await discordPost(token, `/channels/${data.threadId}/messages`, { content: summary, allowed_mentions: { parse: [], roles: [getRole('fm_leadership')].filter(Boolean) } })
      .catch(e => console.error(`[PROMO] Thread summary error for ${data.name}:`, e.message));
    await new Promise(r => setTimeout(r, 800));
  }
  if (errors.length) recordSyncFail('promotion_polls', errors.join(' | '));
  else recordSyncOk('promotion_polls', `${factionsDone} faction(s) finalised from ${candidates.length} poll(s)`);
  return { ok: errors.length === 0, processed: factionsDone, errors };
}

// ── Exports ────────────────────────────────────────────────────────────────────

export function startPromotionReview(client) {
  // Main review — 14th of each month at 12:00 UTC
  cron.schedule('0 12 14 * *', () => {
    runPromotionReview(client).catch(e => { console.error('[PROMO] Uncaught error:', e.message); recordSyncFail('promotion_review', e); });
  }, { timezone: 'UTC' });

  // Poll result processor — every 5 minutes
  cron.schedule('*/5 * * * *', () => {
    processClosedPolls().catch(e => { console.error('[PROMO RESULTS] Uncaught error:', e.message); recordSyncFail('promotion_polls', e); });
  }, { timezone: 'UTC' });

  console.log('[PROMO] Promotion review scheduled — 14th at 12:00 UTC. Result processor running every 5 minutes.');
}
