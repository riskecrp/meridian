/**
 * Monthly Promotion Review — fires on the 14th at 12:00 UTC
 * Poll result processor  — checks every 5 minutes for closed polls
 *
 * Policy 7: one leadership_personal_notes row per L3 per faction per month is
 * that leader's vote (UNIQUE(faction_id, author_id, review_month)). The tally
 * DERIVES faction_reviews.status — 'Confirmed Promote' / 'Confirmed Hold' /
 * 'Confirmed Demote' / 'Confirmed Remove' when a strict majority OF THE PANEL
 * (FM Leadership role holders) votes the same way — decideOutcome() in
 * shared/reviewPanel.js, the same rule the dashboard uses — otherwise
 * 'Pending Discussion' — and writes it back. Confirmed Promote opens
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
import { pingChannel, getRole, urls } from './lib/pings.js';
import { recordSyncOk, recordSyncFail } from './lib/syncStatus.js';
import { BOT_ACTOR } from './lib/auth.js';
import { createTask } from '../shared/tasks.js';
import { REVIEW_STATUSES } from '../shared/validate.js';
import { fetchReviewPanel, decideOutcome, votesNeeded } from '../shared/reviewPanel.js';
import { monthKey, nowIso } from '../shared/dates.js';

export const GUN_CATEGORIES = (process.env.PROMO_GUN_CATEGORIES || [
  'Pistol Light', 'Pistol Medium', 'Pistol Heavy',
  'SMG', 'OP SMG',
  'Shotgun', 'Shotgun Auto',
  'Rifle Mk1', 'Rifle Mk2',
  'MG',
].join(',')).split(',').map(s => s.trim()).filter(Boolean);

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
export function tallyMonth(month, panelSize) {
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
    const d = decideOutcome(v.counts, panelSize);
    v.status = d.status; v.needed = d.needed;
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

// Tasks raised by the review are keyed by their first line (faction + month +
// outcome), so a re-run never raises them twice — and for Demote / Remove the
// first line is the one the dashboard's deriveReviewStatus writes, so whichever
// surface tallies first raises the task and the other finds it.
async function raiseReviewTask(prefix, body) {
  const dup = queryOne("SELECT task_uid FROM tasks WHERE description LIKE ?", [`${prefix}%`]);
  if (dup) return { ok: true, uid: dup.task_uid, existing: true };
  const leadership = getRole('fm_leadership');
  if (!leadership) return { ok: false, error: 'discord_roles has no fm_leadership role' };
  return createTask(BOT_ACTOR, { desc: `${prefix}\n\n${body}`, targetType: 'Role', targetId: leadership }, { via: 'promotion review' });
}

/** The dashboard's wording for a confirmed Demote / Remove task (fm/leadership/actions.js). */
function outcomeTask(f, month, outcome) {
  const faction = queryOne("SELECT tier FROM factions WHERE id = ?", [f.factionId]);
  return {
    prefix: `${f.name} — apply the confirmed ${outcome.toLowerCase()} (review ${month})`,
    body: `Leadership confirmed "Confirmed ${outcome}" for ${month}. ${outcome === 'Demote' ? `Demote the faction from Tier ${faction?.tier ?? '?'} on the hub's Review tab.` : "Archive the faction from the hub's Admin tab once the RP has concluded."}\n${urls.faction(f.name, 'review')}`,
  };
}

// ── Main review job (14th at 12:00 UTC) ───────────────────────────────────────

export async function runPromotionReview(client, { now = new Date(), panel } = {}) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) { console.error('[PROMO] No bot token.'); recordSyncFail('promotion_review', 'no bot token'); return { ok: false, error: 'no bot token' }; }

  const month = monthKey(now);
  console.log(`[PROMO] Running promotion review for ${month}`);
  const voters = panel ?? await fetchReviewPanel();
  if (!voters) {
    console.error('[PROMO] Could not read the FM Leadership role — not tallying.');
    recordSyncFail('promotion_review', `${month}: could not read FM Leadership role members; nothing tallied`);
    return { ok: false, error: 'could not read FM Leadership role members' };
  }
  const tally = tallyMonth(month, voters.length);
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
      const { prefix, body } = outcomeTask(f, month, kind === 'demote' ? 'Demote' : 'Remove');
      const r = await raiseReviewTask(prefix, body);
      if (r.ok) outcome.tasks.push({ faction: f.name, kind, uid: r.uid, existing: !!r.existing });
      else console.error(`[PROMO] task for ${f.name} (${kind}) failed:`, r.error);
    }
  }

  // The month's summary for leadership — once per month, in the month's thread.
  const needsSummary = outcome.promote.length > 0 || outcome.discuss.length > 0;
  let threadId = null;
  if (needsSummary) {
    const existing = queryOne("SELECT thread_id, summary_posted_at FROM promotion_threads WHERE month = ?", [month]);
    if (!existing?.summary_posted_at) {
      try { threadId = await ensureMonthThread(token, month); }
      catch (e) {
        recordSyncFail('promotion_review', `thread: ${e.message}`);
        return { ok: false, ...outcome, error: e.message };
      }
      const role = getRole('fm_leadership');
      const sections = [];
      if (outcome.promote.length) sections.push(`**Confirmed Promotions:** ${outcome.promote.map(f => f.name).join(', ')}`);
      if (outcome.demote.length)  sections.push(`**Confirmed Demotions:** ${outcome.demote.map(f => f.name).join(', ')} (leadership tasks raised)`);
      if (outcome.remove.length)  sections.push(`**Confirmed Removals:** ${outcome.remove.map(f => f.name).join(', ')} (leadership tasks raised)`);
      if (outcome.hold.length)    sections.push(`**Confirmed Hold:** ${outcome.hold.map(f => f.name).join(', ')}`);
      if (outcome.discuss.length) sections.push(`**Needs Discussion:** ${outcome.discuss.map(d => `${d.name} (${splitText(d.counts)})`).join(', ')}`);
      await discordPost(token, `/channels/${threadId}/messages`, {
        content: `<@&${role}> **Promotion Review — ${threadName(month)}**\n\n${sections.join('\n')}${outcome.promote.length ? '\n\nWeapon polls for confirmed promotions are in this thread (each opens as soon as the promotion is confirmed). Polls close in 48 hours.' : ''}`,
        allowed_mentions: { parse: [], roles: [role].filter(Boolean) },
      }).catch(e => console.error('[PROMO] Opening message error:', e.message));
      for (const d of outcome.discuss) {
        await discordPost(token, `/channels/${threadId}/messages`, {
          content: `<@&${role}> ⚠️ **${d.name}** has no majority yet (${splitText(d.counts)}) — please discuss and reach a decision.`,
          allowed_mentions: { parse: [], roles: [role].filter(Boolean) },
        }).catch(e => console.error(`[PROMO] Discussion message error for ${d.name}:`, e.message));
        await sleep(500);
      }
      run("UPDATE promotion_threads SET summary_posted_at = ? WHERE month = ?", [nowIso(), month]);
    } else {
      outcome.alreadyReviewed = true;
    }
  }

  // Weapon polls for any confirmed promotion not opened yet (normally the
  // 5-minute sweep has already opened them the moment they were confirmed).
  const opened = await openConfirmedPromotions({ now, panel: voters, tally });
  outcome.polls = opened.polls;
  outcome.tasks.push(...opened.tasks);
  outcome.skipped = outcome.promote.filter(f => !opened.opened.includes(f.name)).map(f => f.name);

  console.log(`[PROMO] Review complete for ${month}.`);
  if (opened.errors.length) recordSyncFail('promotion_review', opened.errors.join(' | '));
  else recordSyncOk('promotion_review', `${month}: ${entries.length} faction(s) tallied, ${outcome.polls} poll(s), ${outcome.tasks.length} task(s)${outcome.alreadyReviewed ? ' (summary already posted)' : ''}`);
  return { ok: opened.errors.length === 0, ...outcome, threadId: threadId || opened.threadId || null };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const splitText = (counts) => Object.entries(counts).map(([s, n]) => `${n} ${s.replace('Confirmed ', '').toLowerCase()}`).join(' / ');

/** The month's "YYYY-MON Promotion Discussions" thread, created on first use. */
async function ensureMonthThread(token, month) {
  const row = queryOne("SELECT thread_id FROM promotion_threads WHERE month = ?", [month]);
  if (row?.thread_id) return row.thread_id;
  const boardChannel = pingChannel('promo.review.thread');
  if (!boardChannel) throw new Error('route promo.review.thread is disabled or has no channel');
  const thread = await discordPost(token, `/channels/${boardChannel}/threads`, { name: threadName(month), auto_archive_duration: 10080, type: 11 });
  run("INSERT OR IGNORE INTO promotion_threads (month, thread_id) VALUES (?, ?)", [month, thread.id]);
  console.log(`[PROMO] Created thread "${threadName(month)}" (${thread.id})`);
  return queryOne("SELECT thread_id FROM promotion_threads WHERE month = ?", [month]).thread_id;
}

/**
 * Has this month's promotion for the faction already been started (or done by
 * hand)? Polls, a staging task, a staged promotion or a promotion in the
 * faction's history all count — so nothing is ever opened twice.
 */
function promotionStarted(faction, month) {
  if (queryOne("SELECT 1 FROM promotion_polls WHERE faction_id = ? AND strftime('%Y-%m', created_at) = ?", [faction.factionId, month])) return true;
  if (queryOne("SELECT 1 FROM tasks WHERE description LIKE ?", [`${faction.name} — Stage Promotion to Tier % (review ${month})%`])) return true;
  const f = queryOne("SELECT pending_promo FROM factions WHERE id = ?", [faction.factionId]);
  if (f?.pending_promo) return true;
  return !!queryOne("SELECT 1 FROM faction_history WHERE faction_id = ? AND action_type IN ('PROMOTED','PROMO_STAGED') AND substr(created_at, 1, 7) = ?", [faction.factionId, month]);
}

// One sweep at a time: the 5-minute sweep and the 14th's job share this.
let sweeping = Promise.resolve();

/**
 * Open the weapon polls for every promotion confirmed THIS month that hasn't
 * been started. Runs every 5 minutes, so a promotion confirmed on any day gets
 * its polls within minutes — not only if it was confirmed before the 14th.
 * Only the current month is looked at: older months were handled by hand.
 * Returns { polls, tasks, opened: [names], errors, threadId }.
 */
export function openConfirmedPromotions(opts = {}) {
  const run_ = sweeping.then(() => openConfirmedPromotionsNow(opts));
  sweeping = run_.catch(() => {});
  return run_;
}

async function openConfirmedPromotionsNow({ now = new Date(), panel, tally } = {}) {
  const out = { polls: 0, tasks: [], opened: [], errors: [], threadId: null };
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return out;
  const month = monthKey(now);
  const reviews = query(`SELECT r.faction_id, f.name FROM faction_reviews r JOIN factions f ON f.id = r.faction_id
     WHERE r.review_month = ? AND r.status = 'Confirmed Promote' AND f.archived = 0 ORDER BY f.name`, [month]);
  if (!reviews.length) return out;
  // Re-check the votes against the live panel rather than trusting a stored status.
  const voters = panel ?? await fetchReviewPanel();
  if (!voters) { out.errors.push('could not read FM Leadership role members'); return out; }
  const t = tally ?? tallyMonth(month, voters.length);
  const due = reviews.map(r => ({ factionId: r.faction_id, name: r.name }))
    .filter(f => t[f.factionId]?.status === 'Confirmed Promote' && !promotionStarted(f, month));
  if (!due.length) return out;

  let threadId;
  try { threadId = await ensureMonthThread(token, month); }
  catch (e) { out.errors.push(`thread: ${e.message}`); recordSyncFail('promotion_open', out.errors.join(' | ')); return out; }
  out.threadId = threadId;
  const role = getRole('fm_leadership');

  for (const faction of due) {
    const factionRow = queryOne("SELECT tier FROM factions WHERE id = ?", [faction.factionId]);
    if (!factionRow) continue;
    const nextTier = parseInt(factionRow.tier) + 1;
    const authorizedIds = new Set(query(`SELECT item_id FROM faction_imports WHERE faction_id = ? AND permitted = 1`, [faction.factionId]).map(r => r.item_id));
    const placeholders = GUN_CATEGORIES.map(() => '?').join(',');
    const weapons = query(
      `SELECT id, name, category FROM import_items WHERE category IN (${placeholders}) AND CAST(tier AS INTEGER) = ? ORDER BY category, name`,
      [...GUN_CATEGORIES, String(nextTier)]
    ).filter(w => !authorizedIds.has(w.id));

    if (weapons.length === 0) {
      await discordPost(token, `/channels/${threadId}/messages`, {
        content: `<@&${role}> ✅ **${faction.name}** — promotion to Tier ${nextTier} confirmed. No new Tier ${nextTier} weapons are available (all already authorized), so there is nothing to poll; a task has been raised to stage it.`,
        allowed_mentions: { parse: [], roles: [role].filter(Boolean) },
      }).catch(() => {});
      const r = await raiseReviewTask(`${faction.name} — Stage Promotion to Tier ${nextTier} (review ${month})`,
        `Leadership confirmed the promotion; no new Tier ${nextTier} weapons were available to poll. Stage the promotion in the Factions dashboard.\n${urls.faction(faction.name, 'review')}`);
      if (r.ok) out.tasks.push({ faction: faction.name, kind: 'promote', uid: r.uid, existing: !!r.existing });
      out.opened.push(faction.name);
      continue;
    }

    await discordPost(token, `/channels/${threadId}/messages`, {
      content: `<@&${role}> ✅ **${faction.name}** — promotion to Tier ${nextTier} confirmed. Vote below on which new weapons they get — a weapon needs a majority of FM Leadership to be approved; the polls close in 48 hours.`,
      allowed_mentions: { parse: [], roles: [role].filter(Boolean) },
    }).catch(e => console.error(`[PROMO] Intro error for ${faction.name}:`, e.message));

    const byCategory = {};
    for (const w of weapons) (byCategory[w.category] ||= []).push(w);
    let any = false;
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
        run(`INSERT INTO promotion_polls (faction_id, faction_name, next_tier, thread_id, message_id, category, weapon_names, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [faction.factionId, faction.name, nextTier, threadId, msg.id, category, JSON.stringify(items.slice(0, 10).map(w => w.name)), nowIso().slice(0, 19).replace('T', ' ')]);
        out.polls++; any = true;
        console.log(`[PROMO] Poll created: ${faction.name} — ${category} (${items.length} options)`);
        await sleep(600);
      } catch (e) {
        console.error(`[PROMO] Poll error ${faction.name} ${category}:`, e.message);
        out.errors.push(`${faction.name}/${category}: ${e.message}`);
      }
    }
    if (any) out.opened.push(faction.name);
  }
  if (out.errors.length) recordSyncFail('promotion_open', out.errors.join(' | '));
  else recordSyncOk('promotion_open', `${month}: opened ${out.opened.join(', ') || 'nothing'} (${out.polls} poll(s))`);
  return out;
}

// ── Poll result processor ──────────────────────────────────────────────────────

/**
 * Read a poll message and decide whether it is closed. A weapon is approved
 * when at least `needed` people voted for it (a majority of FM Leadership, the
 * same rule as the outcome vote). Returns { closed, approved[], counts{} } or throws.
 */
async function readPoll(token, poll, now, needed) {
  const msg = await discordGet(token, `/channels/${poll.thread_id}/messages/${poll.message_id}`);
  const p = msg.poll || {};
  const expiry = p.expiry ? new Date(p.expiry).getTime() : 0;
  const closed = !!p.results?.is_finalized || (expiry > 0 && expiry <= now.getTime());
  if (!closed) return { closed: false, approved: [] };
  const answers = p.answers || [];
  const answerCounts = p.results?.answer_counts || [];
  const weapons = JSON.parse(poll.weapon_names || '[]');
  const approved = [];
  const counts = {};
  for (const ac of answerCounts) {
    const answer = answers.find(a => a.answer_id === ac.id);
    const weaponName = answer?.poll_media?.text || weapons[ac.id - 1];
    if (!weaponName) continue;
    counts[weaponName] = ac.count;
    if (ac.count >= needed) approved.push(weaponName);
  }
  return { closed: true, approved, counts };
}

export async function processClosedPolls({ now = new Date(), panel } = {}) {
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
  // Each weapon needs a majority of the panel; can't read the panel → try again later.
  const voters = panel ?? await fetchReviewPanel();
  const needed = voters ? votesNeeded(voters.length) : null;
  if (!needed) { recordSyncFail('promotion_polls', 'could not read FM Leadership role members; results not processed (will retry)'); return { ok: false, processed: 0, errors: ['could not read FM Leadership role members'] }; }

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
        const r = await readPoll(token, poll, now, needed);
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
    const month = monthKey(String(data.polls[0].created_at).replace(' ', 'T') + 'Z');
    const body = approvedWeapons.length
      ? [
          `Weapon polls have closed. Approved imports (${needed}+ of ${voters.length} FM Leadership votes):`,
          ...approvedWeapons.map(w => `• ${w}`),
          ``,
          `Stage the promotion in the Factions dashboard with these imports. This will notify Team Leads to schedule the RP.`,
          urls.faction(data.name, 'review'),
        ].join('\n')
      : `No weapon reached ${needed} of ${voters.length} FM Leadership votes. Please review the poll results and stage the promotion manually in the Factions dashboard.\n${urls.faction(data.name, 'review')}`;
    const task = await raiseReviewTask(`${data.name} — Stage Promotion to Tier ${data.nextTier} (review ${month})`, body);
    if (!task.ok) { errors.push(`${data.name}: task failed (${task.error})`); continue; }
    transaction(() => { for (const r of results) run("UPDATE promotion_polls SET processed = 1 WHERE id = ?", [r.poll.id]); });
    factionsDone++;

    const summary = approvedWeapons.length
      ? [`<@&${getRole('fm_leadership')}> ✅ **${data.name}** — Polls closed`,
         `**Approved imports (${approvedWeapons.length}, ${needed}+ votes each):** ${approvedWeapons.join(', ')}`,
         `A task has been created for FM Leadership to stage the promotion. Team Leads will be notified once it is staged.`].join('\n')
      : `<@&${getRole('fm_leadership')}> ⚠️ **${data.name}** — No weapon reached ${needed} of ${voters.length} FM Leadership votes. A task has been created to review and stage the promotion manually.`;
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
    // Promotions confirmed on any day get their weapon polls within 5 minutes.
    openConfirmedPromotions().catch(e => { console.error('[PROMO OPEN] Uncaught error:', e.message); recordSyncFail('promotion_open', e); });
  }, { timezone: 'UTC' });

  console.log('[PROMO] Promotion review scheduled — summary on the 14th at 12:00 UTC; confirmed promotions opened + poll results processed every 5 minutes.');
}
