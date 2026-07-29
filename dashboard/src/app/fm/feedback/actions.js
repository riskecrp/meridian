"use server";
import { query, queryOne } from "../../../lib/db.js";
import { requireActor } from "../../../lib/requireActor.js";
import { fetchChannelMessages } from "../../../lib/discord.js";

// Read-only over the bot-owned faction_feedback table (bot/factionFeedback.js
// writes it). Everything that changes an item's state happens on the buttons in
// its Discord thread, deliberately: the work — messaging the submitter, reading
// the answers, agreeing an outcome — happens there, and a second place to close
// an item would let the thread title and the record disagree.
//
// L2, matching the three roles that can work an item in Discord: FM Team Leads,
// FM Leadership and Game Affairs Management.
const MIN_LEVEL = 2;

export async function getFeedbackList() {
  await requireActor(MIN_LEVEL);
  const rows = query(
    `SELECT id, faction, character_name, discord_username, status, thread_id,
            claimed_by_name, concluded_by_name, created_at, submitted_at
     FROM faction_feedback ORDER BY id DESC`,
  );
  const counts = {};
  for (const r of query("SELECT status, count(*) AS n FROM faction_feedback GROUP BY status")) {
    counts[r.status] = r.n;
  }
  return { rows, counts };
}

export async function getFeedbackItem(id) {
  await requireActor(MIN_LEVEL);
  const item = queryOne("SELECT * FROM faction_feedback WHERE id = ?", [id]);
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

  return { ...item, qa };
}

/**
 * The human discussion under an item's thread. Bot messages are dropped: the
 * submission, the acknowledgement prompt and the nudges are all ours, and
 * repeating them here would bury the part that isn't.
 */
export async function getFeedbackDiscussion(id) {
  await requireActor(MIN_LEVEL);
  const row = queryOne("SELECT thread_id FROM faction_feedback WHERE id = ?", [id]);
  if (!row?.thread_id) return [];
  const messages = await fetchChannelMessages(row.thread_id);
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
