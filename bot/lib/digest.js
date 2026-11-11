// Scheduled nudges that keep leadership's queue moving. All three are READ-ONLY
// as far as the workflow goes: they list and remind, they never approve,
// execute, verify or vote. The single write any of them makes is
// pending_executions.verify_nudged_at, the column that exists so the
// verify-in-game reminder is sent once per 48 hours and not every hour.
//
//   buildDigest()          grouped "waiting on leadership" data (pure, testable)
//   sendLeadershipDigest() Monday embed on route 'leadership.digest'
//   verifyNudgeTick()      hourly DM (channel fallback) on 'rp.verify_nudge'
//   missingVotes()         who still has to vote this month (pure)
//   reviewVoteNudge()      12th-of-month DM (channel fallback) on 'review.vote_nudge'
//
// Every job records sync_status (lib/syncStatus.js) and does nothing but record
// "muted" when its route is switched off in the dashboard.
import { query, queryOne, run } from './db.js';
import { pingEnabled, sendPing, getRole, urls, BASE_URL } from './pings.js';
import { recordSyncOk, recordSyncFail } from './syncStatus.js';
import { dmUser } from './notify.js';
import { parseDate, monthKey, nowIso } from '../../shared/dates.js';

export const DIGEST_DAYS = 7;
export const VERIFY_HOURS = 48;

const DAY = 86400000;
const tsMs = (v) => parseDate(v)?.getTime() ?? null;
const ageDays = (since, nowMs) => { const t = tsMs(since); return t == null ? null : Math.max(0, Math.floor((nowMs - t) / DAY)); };
const nowMsOf = (now) => (now instanceof Date ? now.getTime() : Number(now) || Date.now());
const queueUrl = () => `${BASE_URL}/v2/leadership?tab=queue`;

const KINDS = [
  ['approval', 'RP requests awaiting approval'],
  ['execute', 'RP done, awaiting execution'],
  ['verify', 'Executed, not verified in game'],
  ['feedback', 'Confirmed reviews without feedback sent'],
  ['deletion', 'Deletion requests'],
  ['question', 'Unanswered task questions'],
  ['task', 'Unclaimed leadership tasks'],
  ['promotion', 'Staged promotions'],
];

// Every item is { kind, id, title, faction, who, since, ageDays, href }.
function collect(now) {
  const nowMs = nowMsOf(now);
  const item = (kind, id, title, faction, who, since, href) => ({ kind, id, title, faction: faction || '', who: who || '', since: since || null, ageDays: ageDays(since, nowMs), href });
  const rpTitle = (r) => `${r.execution_type}: ${r.old_value} → ${r.new_value}`;
  const items = [];

  for (const r of query(`SELECT pe.*, f.name AS faction_name FROM pending_executions pe JOIN factions f ON f.id = pe.faction_id WHERE pe.status = 'PENDING'`))
    items.push(item('approval', r.id, rpTitle(r), r.faction_name, r.requested_by, r.created_at, urls.approvals()));

  // RP_DONE has no timestamp of its own; the latest audit row for the request
  // (the requester's "done" click) is when it started waiting.
  for (const r of query(`SELECT pe.*, f.name AS faction_name,
        COALESCE((SELECT MAX(a.timestamp) FROM site_audit_log a WHERE a.target_type = 'rp_change' AND a.target_id = CAST(pe.id AS TEXT)), pe.created_at) AS since
      FROM pending_executions pe JOIN factions f ON f.id = pe.faction_id WHERE pe.status = 'RP_DONE'`))
    items.push(item('execute', r.id, rpTitle(r), r.faction_name, r.requested_by, r.since, urls.approvals()));

  for (const r of query(`SELECT pe.*, f.name AS faction_name FROM pending_executions pe JOIN factions f ON f.id = pe.faction_id WHERE pe.status = 'EXECUTED' AND pe.verified_at IS NULL`))
    items.push(item('verify', r.id, rpTitle(r), r.faction_name, r.requested_by, r.resolved_at || r.created_at, queueUrl()));

  for (const r of query(`SELECT r.*, f.name AS fname FROM faction_reviews r JOIN factions f ON f.id = r.faction_id
      WHERE r.review_month = ? AND r.status LIKE 'Confirmed %' AND r.feedback_sent_at IS NULL AND f.archived = 0`, [monthKey(new Date(nowMs))]))
    items.push(item('feedback', r.id, `${r.status} (${r.review_month})`, r.fname, r.submitted_by, r.updated_at || r.created_at, urls.faction(r.fname, 'review')));

  for (const r of query(`SELECT * FROM deletion_requests WHERE status = 'PENDING'`))
    items.push(item('deletion', r.id, `${r.content_type || r.target_table}: ${String(r.original_text || '').slice(0, 60)}`, '', r.requested_by, r.created_at, urls.approvals()));

  for (const r of query(`SELECT q.*, t.description FROM task_questions q JOIN tasks t ON t.task_uid = q.task_uid WHERE q.answered_at IS NULL AND t.status = 'open'`))
    items.push(item('question', r.id, `${String(r.description).split('\n')[0].slice(0, 60)} — "${String(r.question).slice(0, 60)}"`, '', r.asked_by_name, r.asked_at, urls.task(r.task_uid)));

  const roles = [getRole('fm_leadership'), getRole('game_affairs')].filter(Boolean);
  if (roles.length) {
    for (const r of query(`SELECT * FROM tasks WHERE status = 'open' AND claimed_by = 'None' AND target_type = 'Role' AND target_id IN (${roles.map(() => '?').join(',')})`, roles))
      items.push(item('task', r.task_uid, String(r.description).split('\n')[0].slice(0, 80), '', r.created_by_name, r.created_at, urls.task(r.task_uid)));
  }

  for (const r of query(`SELECT f.id, f.name, f.pending_promo, f.updated_at,
        (SELECT MAX(h.created_at) FROM faction_history h WHERE h.faction_id = f.id AND h.action_type = 'PROMO_STAGED') AS staged_at
      FROM factions f WHERE f.archived = 0 AND COALESCE(f.pending_promo, '') != ''`)) {
    // pending_promo is JSON {tier, imports} from the hub, or a bare tier number from older rows.
    let tier = ''; try { const v = JSON.parse(r.pending_promo); tier = (typeof v === 'object' && v ? v.tier : v) ?? ''; } catch { tier = /^\d+$/.test(r.pending_promo) ? r.pending_promo : ''; }
    items.push(item('promotion', r.id, `Staged${tier !== '' ? ` for Tier ${tier}` : ''}`, r.name, '', r.staged_at || r.updated_at, urls.faction(r.name, 'review')));
  }
  return items;
}

/**
 * Everything waiting on leadership for longer than `olderThanDays` (verify
 * items: longer than `verifyHours`), grouped by kind. Pure: no Discord.
 *   { generatedAt, olderThanDays, verifyHours, total,
 *     groups: [{ kind, label, items: [{ kind, id, title, faction, who, since, ageDays, href }] }] }
 * Items whose timestamp cannot be read are kept (age null): unknown age is not
 * a reason to hide something from the people who should clear it.
 */
export function buildDigest({ now = new Date(), olderThanDays = DIGEST_DAYS, verifyHours = VERIFY_HOURS } = {}) {
  const nowMs = nowMsOf(now);
  const old = (it) => {
    const t = tsMs(it.since);
    if (t == null) return true;
    const limit = it.kind === 'verify' ? verifyHours * 3600000 : olderThanDays * DAY;
    return nowMs - t >= limit;
  };
  const kept = collect(nowMs).filter(old).sort((a, b) => (b.ageDays ?? 1e9) - (a.ageDays ?? 1e9));
  const groups = KINDS.map(([kind, label]) => ({ kind, label, items: kept.filter(i => i.kind === kind) })).filter(g => g.items.length);
  return { generatedAt: new Date(nowMs).toISOString(), olderThanDays, verifyHours, total: kept.length, groups };
}

const line = (it) => `• ${it.faction ? `**${it.faction}** — ` : ''}${it.title}${it.who ? ` (${it.who})` : ''} · ${it.ageDays == null ? 'age unknown' : `${it.ageDays}d`} · [open](${it.href})`;

/** The digest as one plain embed object (REST shape, no builders) so it can be inspected in tests. */
export function digestEmbed(digest) {
  const embed = { title: '📋 Weekly leadership digest', color: digest.total ? 0xF59E0B : 0x10B981, timestamp: digest.generatedAt,
    footer: { text: `Items waiting more than ${digest.olderThanDays} days (verifications: ${digest.verifyHours} h) · ${queueUrl()}` } };
  if (!digest.total) { embed.description = 'Nothing is waiting on leadership. 🎉'; return embed; }
  embed.description = `**${digest.total}** item${digest.total === 1 ? '' : 's'} waiting on leadership.`;
  embed.fields = digest.groups.map(g => {
    const lines = g.items.slice(0, 10).map(line);
    if (g.items.length > 10) lines.push(`… and ${g.items.length - 10} more`);
    let value = lines.join('\n'); if (value.length > 1024) value = value.slice(0, 1010) + '\n…';
    return { name: `${g.label} (${g.items.length})`, value };
  }).slice(0, 25);
  return embed;
}

/** Monday 09:00 UTC. Route 'leadership.digest'; sync_status 'leadership_digest'. */
export async function sendLeadershipDigest({ now = new Date() } = {}) {
  try {
    if (!pingEnabled('leadership.digest')) { recordSyncOk('leadership_digest', 'route leadership.digest muted; nothing sent'); return { ok: true, muted: true }; }
    const digest = buildDigest({ now });
    const sent = await sendPing('leadership.digest', '', { embeds: [digestEmbed(digest)] });
    if (!sent) { recordSyncFail('leadership_digest', 'digest could not be posted (route unset or Discord refused)'); return { ok: false, digest }; }
    recordSyncOk('leadership_digest', `${digest.total} item(s) in ${digest.groups.length} group(s)`);
    return { ok: true, digest };
  } catch (e) { console.error('[DIGEST]', e.message); recordSyncFail('leadership_digest', e); return { ok: false, error: e.message }; }
}

// ── Verify-in-game nudge ──────────────────────────────────────────────────────

/** EXECUTED, unverified, executed more than `hours` ago, not nudged in the last `hours`. */
export function unverifiedForNudge({ now = new Date(), hours = VERIFY_HOURS } = {}) {
  const cutoff = new Date(nowMsOf(now) - hours * 3600000).toISOString();
  // Both columns are ISO or SQLite datetime text; normalising to "YYYY-MM-DD HH:MM:SS" makes the comparison honest for either.
  const norm = (col) => `replace(replace(substr(${col}, 1, 19), 'T', ' '), 'Z', '')`;
  const cut = cutoff.slice(0, 19).replace('T', ' ');
  return query(`SELECT pe.*, f.name AS faction_name FROM pending_executions pe JOIN factions f ON f.id = pe.faction_id
     WHERE pe.status = 'EXECUTED' AND pe.verified_at IS NULL AND pe.requester_id != ''
       AND pe.resolved_at IS NOT NULL AND ${norm('pe.resolved_at')} <= ?
       AND (pe.verify_nudged_at IS NULL OR ${norm('pe.verify_nudged_at')} <= ?)
     ORDER BY pe.resolved_at`, [cut, cut]);
}

/** Hourly. Route 'rp.verify_nudge'; sync_status 'rp_verify_nudge'. The only write: verify_nudged_at. */
export async function verifyNudgeTick(client, { now = new Date() } = {}) {
  const summary = { dm: 0, channel: 0, failed: 0, candidates: 0, muted: false };
  try {
    if (!pingEnabled('rp.verify_nudge')) { summary.muted = true; recordSyncOk('rp_verify_nudge', 'route rp.verify_nudge muted; nothing sent'); return summary; }
    const rows = unverifiedForNudge({ now });
    summary.candidates = rows.length;
    const errors = [];
    for (const r of rows) {
      const days = Math.floor((nowMsOf(now) - (tsMs(r.resolved_at) ?? nowMsOf(now))) / DAY);
      const text = `🔍 **Please verify in game** — the RP change you requested for **${r.faction_name}** (**${r.execution_type}: ${r.old_value} → ${r.new_value}**) was executed ${days} day${days === 1 ? '' : 's'} ago and nobody has confirmed it landed.\nCheck it in game, then mark it verified: ${queueUrl()}\n📋 Request #${r.id}`;
      let via = false;
      if (await dmUser(client, r.requester_id, text)) via = 'dm';
      else if (await sendPing('rp.verify_nudge', `<@${r.requester_id}> ${text}`)) via = 'channel';
      if (!via) { summary.failed++; errors.push(`#${r.id}: neither DM nor channel`); continue; }
      summary[via]++;
      run("UPDATE pending_executions SET verify_nudged_at = ? WHERE id = ?", [nowIso(), r.id]);
    }
    if (errors.length) recordSyncFail('rp_verify_nudge', errors.slice(0, 3).join(' | '));
    else recordSyncOk('rp_verify_nudge', `${rows.length} due; ${summary.dm} by DM, ${summary.channel} in channel`);
  } catch (e) { console.error('[VERIFY_NUDGE]', e.message); recordSyncFail('rp_verify_nudge', e); summary.error = e.message; }
  return summary;
}

// ── Review vote nudge ─────────────────────────────────────────────────────────

/**
 * Active L3s (clearance ≥ 3, active, not placeholder) and the factions reviewed
 * this month they have no leadership_personal_notes row for.
 *   [{ leaderId, leaderName, factions: [{ id, name }] }]  (leaders with nothing missing are omitted)
 */
export function missingVotes(month = monthKey()) {
  const leaders = query("SELECT discord_id, display_name FROM staff WHERE clearance >= 3 AND active = 1 AND discord_id != '' AND discord_id NOT LIKE 'placeholder%' ORDER BY display_name");
  const reviewed = query("SELECT DISTINCT f.id, f.name FROM faction_reviews r JOIN factions f ON f.id = r.faction_id WHERE r.review_month = ? AND f.archived = 0 ORDER BY f.name", [month]);
  if (!leaders.length || !reviewed.length) return [];
  const voted = new Set(query("SELECT author_id, faction_id FROM leadership_personal_notes WHERE review_month = ?", [month]).map(n => `${n.author_id}:${n.faction_id}`));
  return leaders
    .map(l => ({ leaderId: l.discord_id, leaderName: l.display_name, factions: reviewed.filter(f => !voted.has(`${l.discord_id}:${f.id}`)) }))
    .filter(l => l.factions.length);
}

/** 12th 10:00 UTC. Route 'review.vote_nudge'; sync_status 'review_vote_nudge'. DM first, channel fallback with a mention. */
export async function reviewVoteNudge(client, { now = new Date() } = {}) {
  const month = monthKey(now);
  const summary = { month, leaders: 0, dm: 0, channel: 0, failed: 0, muted: false };
  try {
    if (!pingEnabled('review.vote_nudge')) { summary.muted = true; recordSyncOk('review_vote_nudge', `${month}: route review.vote_nudge muted; nothing sent`); return summary; }
    const missing = missingVotes(month);
    summary.leaders = missing.length;
    const errors = [];
    for (const m of missing) {
      const list = m.factions.map(f => `• **${f.name}** — ${urls.faction(f.name, 'review')}`).join('\n');
      const text = `🗳️ **Review votes still needed for ${month}** — the tally runs on the 14th. You have not voted on ${m.factions.length} faction${m.factions.length === 1 ? '' : 's'}:\n${list}\nAll reviews: ${urls.reviews()}`;
      let via = false;
      if (await dmUser(client, m.leaderId, text)) via = 'dm';
      else if (await sendPing('review.vote_nudge', `<@${m.leaderId}> ${text}`)) via = 'channel';
      if (!via) { summary.failed++; errors.push(`${m.leaderName}: neither DM nor channel`); continue; }
      summary[via]++;
    }
    if (errors.length) recordSyncFail('review_vote_nudge', errors.slice(0, 3).join(' | '));
    else recordSyncOk('review_vote_nudge', `${month}: ${missing.length} leader(s) behind; ${summary.dm} by DM, ${summary.channel} in channel`);
  } catch (e) { console.error('[VOTE_NUDGE]', e.message); recordSyncFail('review_vote_nudge', e); summary.error = e.message; }
  return summary;
}
