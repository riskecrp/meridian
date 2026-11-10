"use server";
import { query, queryOne, run } from "../../../lib/db.js";
import { requireActor } from "../../../lib/requireActor.js";
import { logAudit } from "../../../lib/audit.js";
import { fetchChannelMessages } from "../../../lib/discord.js";
import { pingChannel } from "../../../lib/pings.js";
import { nowSqlite } from "../../../../../shared/dates.js";
import { toInt, fail } from "../../../../../shared/validate.js";

// Player feedback about FM factions. The bot (bot/factionFeedback.js) polls the
// response sheet, opens a thread per submission and owns the nudges; the
// record's lifecycle is
//
//   new -> claimed (the submitter has been contacted) -> completed / cancelled
//                                                        -> reopen -> back to where it was
//
// The same steps are available here as on the thread buttons, and they do the
// same things the bot does — update the row, retitle the thread, post the next
// prompt with the bot's own buttons — so the thread title and the record never
// disagree whichever surface closed an item.
//
// L2, matching the three roles that can work an item in Discord: FM Team Leads,
// FM Leadership and Game Affairs Management.
const MIN_LEVEL = 2;

const ENDED_STATUSES = ['completed', 'cancelled'];
const REMINDER_HOURS = 48;          // bot cadence; reopening restarts the clock
const SNOOZE_DAYS = 7;
const EMBED_COLOR = 0xE74C3C;
const THREAD_NAME_LIMIT = 100;

const STATUS_SENTENCE = {
  new: 'waiting for the submitter to be acknowledged',
  claimed: 'awaiting review',
  completed: 'completed',
  cancelled: 'cancelled',
};
const STATUS_TAGS = {
  new: '[Pending Acknowledgement]',
  claimed: '[Pending Review]',
  completed: '[Completed]',
  cancelled: '[Cancelled]',
};
// Every tag any intake can put on a thread (bot/lib/formIntake.js ALL_TAGS).
const ALL_TAGS = ['[Pending Acknowledgement]', '[Pending Review]', '[Completed]', '[Cancelled]', '[Open]', '[Accepted]', '[Rejected]'];

const plusHours = (h) => new Date(Date.now() + h * 3600000).toISOString().slice(0, 19).replace('T', ' ');
const plusDays = (d) => plusHours(d * 24);

function titled(base, tag) {
  const room = THREAD_NAME_LIMIT - tag.length - 1;
  return `${tag} ${base.slice(0, room).trimEnd()}`;
}
function retag(name, tag) {
  let base = name;
  for (const t of ALL_TAGS) { if (base.startsWith(t + ' ')) { base = base.slice(t.length + 1); break; } }
  return titled(base, tag);
}

// ── Discord (REST, same calls the bot makes) ───────────────────────────────────
async function discordApi(method, path, body) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`https://discord.com/api/v10${path}`, {
      method,
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) { console.error(`[FEEDBACK] ${method} ${path} failed ${res.status}`); return null; }
    if (res.status === 204) return {};
    return await res.json().catch(() => ({}));
  } catch (e) { console.error(`[FEEDBACK] ${method} ${path}:`, e.message); return null; }
}

const NO_MENTIONS = { parse: [] };
const BTN = { PRIMARY: 1, SECONDARY: 2, SUCCESS: 3, DANGER: 4 };
const button = (label, style, customId) => ({ type: 2, style, label, custom_id: customId });
const row = (...b) => ({ type: 1, components: b });
const ackRow = (id) => row(button('Done', BTN.SUCCESS, `fbk:done:${id}`), button('Cancel', BTN.SECONDARY, `fbk:cancel:${id}`));
const reviewRow = (id) => row(button('Complete', BTN.SUCCESS, `fbk:complete:${id}`), button('Cancel', BTN.SECONDARY, `fbk:cancel:${id}`));
const reopenRow = (id) => row(button('Reopen', BTN.SECONDARY, `fbk:reopen:${id}`));

async function postToThread(threadId, embed, components) {
  if (!threadId) return;
  await discordApi('POST', `/channels/${threadId}/messages`, { embeds: [{ color: EMBED_COLOR, ...embed }], components, allowed_mentions: NO_MENTIONS });
}

/** Move a thread's status tag on, optionally archiving it and hiding its card from the parent channel. */
async function retitleThread(threadId, tag, { archive = false, unarchive = false } = {}) {
  if (!threadId) return;
  const channel = await discordApi('GET', `/channels/${threadId}`);
  if (!channel) return;
  const patch = { ...(channel.name ? { name: retag(channel.name, tag) } : {}), ...(archive ? { archived: true } : {}), ...(unarchive ? { archived: false } : {}) };
  await discordApi('PATCH', `/channels/${threadId}`, patch);
  if (archive && channel.parent_id) await discordApi('DELETE', `/channels/${channel.parent_id}/messages/${threadId}`);
}

function loadItem(id) {
  const fid = toInt(id, { min: 1 });
  const item = fid ? queryOne("SELECT * FROM faction_feedback WHERE id = ?", [fid]) : null;
  return item ? { item } : { error: 'Feedback item not found.' };
}
const label = (i) => `${i.faction} — ${i.character_name}`;

// ── Reads ──────────────────────────────────────────────────────────────────────

export async function getFeedbackList() {
  await requireActor(MIN_LEVEL);
  const rows = query(
    `SELECT id, faction, character_name, discord_username, status, thread_id,
            claimed_by_name, concluded_by_name, created_at, submitted_at, due_at
     FROM faction_feedback ORDER BY id DESC`,
  ).map(r => ({ ...r, received: r.submitted_at || r.created_at }));
  const counts = {};
  for (const r of query("SELECT status, count(*) AS n FROM faction_feedback GROUP BY status")) counts[r.status] = r.n;
  return { rows, counts };
}

export async function getFeedbackItem(id) {
  await requireActor(MIN_LEVEL);
  const { item } = loadItem(id);
  if (!item) return null;

  let payload = {};
  try { payload = JSON.parse(item.payload || "{}"); } catch { payload = {}; }

  // The long-form answers are what is worth reading. The routing columns —
  // which division it was addressed to, and the acknowledgement the form makes
  // you tick — are noise on a page that has already routed it here.
  const qa = Object.entries(payload)
    .filter(([q, a]) => String(a || "").trim()
      && !/^(timestamp|are you providing|this form is for)/i.test(q.trim()))
    .map(([question, answer]) => ({ question, answer: String(answer) }));

  return { ...item, received: item.submitted_at || item.created_at, qa };
}

/**
 * The human discussion under an item's thread. Bot messages are dropped: the
 * submission, the acknowledgement prompt and the nudges are all ours, and
 * repeating them here would bury the part that isn't.
 */
export async function getFeedbackDiscussion(id) {
  await requireActor(MIN_LEVEL);
  const { item } = loadItem(id);
  if (!item?.thread_id) return [];
  const messages = await fetchChannelMessages(item.thread_id);
  // An image posted without a caption is still discussion, so a message counts
  // if it has text OR an attachment.
  return messages.filter(m => !m.bot && (m.content.trim() || m.attachments.length));
}

/**
 * Submissions the poller could not post, so a report of "I sent feedback and
 * nothing happened" has somewhere to be answered from. Empty in normal running.
 */
export async function getFeedbackFailures() {
  await requireActor(MIN_LEVEL);
  return query(
    "SELECT sheet_row, attempts, skipped, first_failed_at, last_failed_at, last_error FROM faction_feedback_failures ORDER BY sheet_row DESC",
  );
}

// ── Writes (mirror bot/factionFeedback.js handleDone / handleEnd / handleSnooze / handleReopen) ──

/** The submitter has been contacted: new → claimed. */
export async function acknowledgeFeedback(id) {
  const actor = await requireActor(MIN_LEVEL);
  const { item, error } = loadItem(id);
  if (error) return fail(error);
  if (ENDED_STATUSES.includes(item.status)) return fail(`This feedback is already ${item.status}.`);
  if (item.status === 'claimed') return fail(`Already acknowledged by ${item.claimed_by_name}.`);
  run("UPDATE faction_feedback SET status = 'claimed', claimed_by_id = ?, claimed_by_name = ?, claimed_at = ? WHERE id = ?", [actor.id, actor.name, nowSqlite(), item.id]);
  logAudit(actor.id, actor.name, 'ACKNOWLEDGE', 'feedback', item.id, label(item), `Submitter ${item.discord_username} contacted`);
  const unix = Math.floor(Date.now() / 1000);
  await postToThread(item.thread_id, { title: 'Acknowledgement', description: `**${actor.name}** has messaged the submitter (**${item.discord_username}**) and acknowledged the feedback was received. <t:${unix}:f> *(via dashboard)*` }, [reviewRow(item.id)]);
  await retitleThread(item.thread_id, STATUS_TAGS.claimed);
  return { ok: true };
}

async function conclude(actor, id, status) {
  const { item, error } = loadItem(id);
  if (error) return fail(error);
  if (ENDED_STATUSES.includes(item.status)) return fail(`This feedback is already ${item.status}.`);
  const verb = status === 'completed' ? 'Completed' : 'Cancelled';
  run("UPDATE faction_feedback SET status = ?, concluded_by_name = ?, concluded_at = ? WHERE id = ?", [status, actor.name, nowSqlite(), item.id]);
  logAudit(actor.id, actor.name, verb.toUpperCase(), 'feedback', item.id, label(item), 'via dashboard');
  const unix = Math.floor(Date.now() / 1000);
  await postToThread(item.thread_id, { description: `${verb} by **${actor.name}** <t:${unix}:f>. No further reminders will be sent.` }, [reopenRow(item.id)]);
  await retitleThread(item.thread_id, STATUS_TAGS[status], { archive: true });
  // A reopened item's card is still sitting in the channel — take it down too.
  if (item.reopen_card_id) {
    const channelId = pingChannel('feedback.new');
    if (channelId) await discordApi('DELETE', `/channels/${channelId}/messages/${item.reopen_card_id}`);
    run("UPDATE faction_feedback SET reopen_card_id = NULL WHERE id = ?", [item.id]);
  }
  return { ok: true };
}

export async function completeFeedback(id) {
  const actor = await requireActor(MIN_LEVEL);
  return conclude(actor, id, 'completed');
}

export async function cancelFeedback(id) {
  const actor = await requireActor(MIN_LEVEL);
  return conclude(actor, id, 'cancelled');
}

/** Push the next nudge out by SNOOZE_DAYS. */
export async function snoozeFeedback(id) {
  const actor = await requireActor(MIN_LEVEL);
  const { item, error } = loadItem(id);
  if (error) return fail(error);
  if (ENDED_STATUSES.includes(item.status)) return fail(`This feedback is already ${item.status}.`);
  const nextDue = plusDays(SNOOZE_DAYS);
  run("UPDATE faction_feedback SET due_at = ? WHERE id = ?", [nextDue, item.id]);
  logAudit(actor.id, actor.name, 'SNOOZE', 'feedback', item.id, label(item), `Next reminder pushed out ${SNOOZE_DAYS} days`);
  const unix = Math.floor(new Date(nextDue.replace(' ', 'T') + 'Z').getTime() / 1000);
  await postToThread(item.thread_id, { description: `Snoozed by **${actor.name}** (via dashboard). Next reminder <t:${unix}:R>.` });
  return { ok: true, dueAt: nextDue };
}

/** Bring a completed / cancelled item back to where it was (claimed if acknowledged, else new) and restart the nudges. */
export async function reopenFeedback(id) {
  const actor = await requireActor(MIN_LEVEL);
  const { item, error } = loadItem(id);
  if (error) return fail(error);
  if (!ENDED_STATUSES.includes(item.status)) return fail(`This feedback is already open — it is ${STATUS_SENTENCE[item.status] || item.status}.`);
  const status = item.claimed_by_id ? 'claimed' : 'new';
  await retitleThread(item.thread_id, STATUS_TAGS[status], { unarchive: true });
  run("UPDATE faction_feedback SET status = ?, concluded_by_name = NULL, concluded_at = NULL, due_at = ?, last_reminder_at = NULL WHERE id = ?", [status, plusHours(REMINDER_HOURS), item.id]);
  logAudit(actor.id, actor.name, 'REOPEN', 'feedback', item.id, label(item), `Back to ${STATUS_SENTENCE[status]}`);
  if (item.thread_id) {
    await postToThread(item.thread_id, {
      title: 'Reopened',
      description: `**${actor.name}** reopened this (via dashboard) — it is back to **${STATUS_SENTENCE[status]}**.\n\n`
        + (status === 'claimed'
          ? 'When the review is concluded, press **Complete**, or **Cancel** to end it again.'
          : `Reach out to **${item.discord_username}** on Discord to let them know the feedback was received, then mark this as **Done**.`),
      footer: { text: `Reminders every ${REMINDER_HOURS}h until this is completed or cancelled.` },
    }, [status === 'claimed' ? reviewRow(item.id) : ackRow(item.id)]);
    // Put the thread back in the channel with a fresh card linking it.
    const channelId = pingChannel('feedback.new');
    if (channelId) {
      if (item.reopen_card_id) await discordApi('DELETE', `/channels/${channelId}/messages/${item.reopen_card_id}`);
      const card = await discordApi('POST', `/channels/${channelId}/messages`, {
        content: `🔄 **${item.faction} · ${item.character_name}** was reopened by **${actor.name}** — <#${item.thread_id}>`,
        allowed_mentions: NO_MENTIONS,
      });
      if (card?.id) run("UPDATE faction_feedback SET reopen_card_id = ? WHERE id = ?", [String(card.id), item.id]);
    }
  }
  return { ok: true, status };
}
