/**
 * Faction feedback intake — player feedback about FM factions becomes a thread.
 *
 * Players fill in the ECRP roleplay feedback form. One sheet serves both
 * divisions, so a row is ours when its team column reads
 * "Criminal Faction Management (FM)". Every 15 minutes the new rows are read and
 * each one becomes a thread in #fm-feedback: the submission laid out for
 * reading, a ping, and a workflow that ends with the item explicitly closed.
 *
 *   new -> claimed (the submitter has been contacted) -> completed / cancelled
 *
 * The thread title carries the status, so the channel list shows where every
 * item stands without opening any of them:
 *
 *   [Pending Acknowledgement] -> [Pending Review] -> [Completed] / [Cancelled]
 *
 * While an item is open it is nudged in-thread every REMINDER_HOURS, with
 * Complete / Snooze / Cancel on the nudge. Snooze buys SNOOZE_DAYS of quiet
 * instead of the normal cadence, for when something is genuinely in progress.
 *
 * Closing is not final: the closing message keeps a Reopen button (and pressing
 * any stale button on a closed item offers one). Reopening steps the status back
 * to wherever it was, unarchives the thread, restarts the nudges, and puts a
 * card back in #fm-feedback linking the thread.
 *
 * Why polling and not the push we already have: api/notify is pinged by the
 * form's Apps Script on submit, but that payload carries only the faction name.
 * The answers exist solely in the sheet, and the answers are the point.
 *
 * Buttons are handled in index.js with the rest of the interaction routing; the
 * record id travels in the custom id, so they keep working across restarts.
 *
 * Not to be confused with commands/feedback.js — that logs a staff member's
 * notes on a scene. This is a player writing in about a faction.
 */

import cron from 'node-cron';
import { query, queryOne, run } from './lib/db.js';
import { pingChannel, pingMentions, pingRoleIds, pingEnabled } from './lib/pings.js';
import { logAudit } from './lib/audit.js';
import { recordSyncOk, recordSyncFail } from './lib/syncStatus.js';
import { requireStaff, replyEphemeral } from './lib/auth.js';
import {
  nowStr, plusHours, plusDays,
  discordFetch, discordPost, discordPatch, discordDelete, hideThreadCard,
  STATUS_TAGS, titled, retag, chunks, fetchSheetRows, valueByHeader, rowPayload, TIMESTAMP_HEADER,
  rowKeys, ensureIntakeSchema, rowSeen, markRowSeen, markAllRowsSeen, freeSheetRow, seedSeenFromLastRow,
} from './lib/formIntake.js';

// Responses sheet of the ECRP roleplay feedback form. The id and tab come from
// the environment (see .env.example); with GOOGLE_SHEETS_API_KEY set it is
// read through the Sheets API, otherwise as a link-viewable CSV export.
// Defaults are the production responses sheet (link-viewable, not a secret); .env overrides.
const SHEET = () => ({ id: process.env.SHEET_FEEDBACK_ID || '1T6d-I_P1Gvr1nyJctk0-LM3xlXEBUNCi3CMM2MWrUoQ', gid: process.env.SHEET_FEEDBACK_GID || '1222111670' });
const TEAM_VALUE = process.env.FEEDBACK_TEAM_VALUE || 'Criminal Faction Management (FM)';
const SOURCE = 'feedback';

// Columns are found by HEADER TEXT, not position, so a question inserted into
// the form cannot re-point every field below it (BOT-9). Everything that is
// not one of these identity fields is a question and is posted as a section.
const COLS = {
  team: /team|division/i,
  faction: /faction/i,
  character: /character/i,
  discord: /discord/i,
  occurred: /occur|when did/i,
};

const EMBED_COLOR = 0xE74C3C;   // FM red, matching api/notify's feedback embed

// An open item is nudged every REMINDER_HOURS until it is completed or
// cancelled. The first nudge lands REMINDER_HOURS after the thread is created.
const REMINDER_HOURS = 48;
// What Snooze buys: a longer pause than the normal cadence, so an item that is
// actually being worked stops nagging without being closed.
const SNOOZE_DAYS = 7;

// How many cycles one sheet row may fail before the poller gives up on it and
// moves on. A network blip or a Discord 5xx clears well inside this; anything
// that fails this many times is not going to fix itself, and must not be allowed
// to hold up every submission queued behind it.
const MAX_POST_ATTEMPTS = 3;

// Statuses that end the flow — no more nudges, buttons refuse to act.
const ENDED_STATUSES = ['completed', 'cancelled'];

// How a status reads in a sentence, mirroring the dashboard's labels.
const STATUS_LABELS = {
  new: 'waiting for the submitter to be acknowledged',
  claimed: 'awaiting review',
  completed: 'completed',
  cancelled: 'cancelled',
};

/**
 * What a message from this module is allowed to ping: the route's three roles by
 * id, and nothing else.
 *
 * An explicit list rather than `parse: ['roles']`, because every message we send
 * carries text a player typed into the form. "Allow role mentions" would allow
 * THEIRS too — a submitter who put `<@&…>` in the character-name box would have
 * the bot ping that role on their behalf, borrowing a reach they don't have
 * themselves. With ids listed, our pings fire and anything they typed renders as
 * inert text. (LFM's version allows the broad form; this is a deliberate
 * difference, not a porting slip.)
 */
const allowedMentions = (routeKey) => ({ parse: [], roles: pingRoleIds(routeKey) });

// Nothing a player wrote may ping anything at all.
const NO_MENTIONS = { parse: [] };

// The form's closing tickbox ("I understand"), not something the player told us.
// It is the last column, but matched on its text rather than its index so adding
// a question to the form doesn't start posting it.
const SKIP_QUESTION = /^this form is for/i;

// Audit entries use the shared vocabulary: an uppercase verb, with the noun in
// target_type. `feedback` is lowercase to match `task`, `document` and the rest.
const audit = (interaction, action, id, label, details) => logAudit(
  interaction?.user?.id || '', interaction ? actorName(interaction) : 'Feedback bot',
  action, 'feedback', id, label, details);

// ── Buttons ────────────────────────────────────────────────────────────────────
//
// The record id rides in the custom id, so a press works after a restart with no
// state held in memory. index.js routes anything starting 'fbk:' back here.

const BTN = { PRIMARY: 1, SUCCESS: 3, DANGER: 4, SECONDARY: 2 };

const button = (label, style, customId) => ({ type: 2, style, label, custom_id: customId });
const actionRow = (...buttons) => ({ type: 1, components: buttons });

const ackRow = (id) => actionRow(
  button('Done', BTN.SUCCESS, `fbk:done:${id}`),
  button('Cancel', BTN.SECONDARY, `fbk:cancel:${id}`),
);

const reviewRow = (id) => actionRow(
  button('Complete', BTN.SUCCESS, `fbk:complete:${id}`),
  button('Cancel', BTN.SECONDARY, `fbk:cancel:${id}`),
);

const nudgeRow = (id) => actionRow(
  button('Complete', BTN.SUCCESS, `fbk:complete:${id}`),
  button(`Snooze ${SNOOZE_DAYS} days`, BTN.SECONDARY, `fbk:snooze:${id}`),
  button('Cancel', BTN.SECONDARY, `fbk:cancel:${id}`),
);

const reopenRow = (id) => actionRow(
  button('Reopen', BTN.SECONDARY, `fbk:reopen:${id}`),
);

// The "that item is closed" reply, everywhere a stale button can be pressed on a
// completed or cancelled item. It carries a Reopen button of its own, so the
// items closed before Reopen existed — whose closing messages have no buttons —
// still have a way back.
const alreadyEnded = (interaction, id, status) => interaction.reply({
  content: `This feedback is already ${status}.`,
  components: [reopenRow(id)],
  ephemeral: true,
});

// ── Sheet polling ──────────────────────────────────────────────────────────────

// Health is recorded inside this function rather than by the caller, because the
// interesting outcomes are all early returns: an unreadable sheet returns exactly
// like a poll with nothing new, and a caller wrapping this in .then() would call
// that a success.
async function pollSheet() {
  ensureIntakeSchema();
  const sheet = SHEET();
  const { rows, error } = await fetchSheetRows(sheet.id, sheet.gid);
  if (error) {
    console.error('[FEEDBACK]', error);
    recordSyncFail('feedback_poll', error);
    return;
  }
  if (!rows.length) {
    recordSyncFail('feedback_poll', 'the sheet returned no rows');
    return;
  }
  const header = rows[0];
  const data = rows.slice(1);
  const teamCol = header.findIndex(h => COLS.team.test(String(h || '')));
  if (teamCol < 0) { recordSyncFail('feedback_poll', 'the sheet has no team/division column — headers changed?'); return; }

  const state = queryOne('SELECT last_row, initialized, keys_seeded FROM faction_feedback_state WHERE id = 1');
  if (!state) {
    recordSyncFail('feedback_poll', 'faction_feedback_state row is missing');
    return;
  }
  if (!state.initialized) {
    // First run: everything already in the sheet is history. Those rows predate
    // the feature and would otherwise arrive as a wall of threads, each with its
    // own ping and its own 48-hour nudge cycle.
    markAllRowsSeen(SOURCE, header, data);
    run('UPDATE faction_feedback_state SET last_row = ?, initialized = 1, keys_seeded = 1 WHERE id = 1', [data.length]);
    console.log(`[FEEDBACK] initialised at row ${data.length}; watching for new submissions`);
    recordSyncOk('feedback_poll', `initialised at sheet row ${data.length}; no backfill`);
    return;
  }

  if (!state.keys_seeded) {
    // Initialised under the old position counter: hand its rows over to row keys.
    const n = seedSeenFromLastRow(SOURCE, header, data, state.last_row);
    run('UPDATE faction_feedback_state SET keys_seeded = 1 WHERE id = 1');
    console.log(`[FEEDBACK] row keys seeded from last_row (${n} rows marked seen)`);
  }

  let posted = 0, held = null;
  const keys = rowKeys(header, data);
  for (let idx = 0; idx < data.length; idx++) {
    const row = data[idx];
    const key = keys[idx];
    if (rowSeen(SOURCE, key)) continue;
    const sheetRow = idx + 2;   // 1-based, plus the header — informational only
    if ((row[teamCol] || '').trim() !== TEAM_VALUE) { markRowSeen(SOURCE, key, sheetRow); continue; }
    try {
      const id = await postFeedback(header, row, sheetRow, key);
      markRowSeen(SOURCE, key, sheetRow, id);
      posted++;
    } catch (e) {
      const attempts = recordFailure(sheetRow, key, e);
      if (attempts < MAX_POST_ATTEMPTS) {
        // Probably transient. Stop WITHOUT marking it seen, so this row is
        // retried next cycle and submissions keep arriving in order.
        console.error(`[FEEDBACK] row ${sheetRow} attempt ${attempts}/${MAX_POST_ATTEMPTS} failed, retrying next cycle:`, e.message);
        held = `holding at sheet row ${sheetRow}, attempt ${attempts}/${MAX_POST_ATTEMPTS}: ${e.message}`;
        break;
      }
      // Out of retries. Mark it seen so everything queued behind it can still
      // post; the failure row stays behind for visibility.
      run('UPDATE faction_feedback_failures SET skipped = 1 WHERE sheet_row = ?', [sheetRow]);
      markRowSeen(SOURCE, key, sheetRow);
      console.error(`[FEEDBACK] row ${sheetRow} failed ${attempts}x — SKIPPING so the queue can drain. Not posted:`, e.message);
    }
  }
  run('UPDATE faction_feedback_state SET last_row = ? WHERE id = 1', [data.length]);
  if (held) recordSyncFail('feedback_poll', held);
  else recordSyncOk('feedback_poll', posted ? `${posted} new submission(s) posted` : 'checked, nothing new');
}

/**
 * Bump the attempt counter for a sheet row and return the new count. A database
 * problem here must not itself decide a row's fate, so a failure to record
 * reports attempt 1 — which retries rather than skips.
 */
function recordFailure(sheetRow, key, err) {
  const message = `${err.name || 'Error'}: ${err.message}`.slice(0, 300);
  try {
    run(
      `INSERT INTO faction_feedback_failures (sheet_row, row_key, attempts, first_failed_at, last_failed_at, last_error)
       VALUES (?, ?, 1, ?, ?, ?)
       ON CONFLICT(sheet_row) DO UPDATE SET
         row_key = excluded.row_key, attempts = attempts + 1, last_failed_at = excluded.last_failed_at, last_error = excluded.last_error`,
      [sheetRow, key, nowStr(), nowStr(), message],
    );
    return queryOne('SELECT attempts FROM faction_feedback_failures WHERE sheet_row = ?', [sheetRow])?.attempts || 1;
  } catch (e) {
    console.error(`[FEEDBACK] could not record failure for row ${sheetRow}:`, e.message);
    return 1;
  }
}

async function postFeedback(header, row, sheetRow, key) {
  const pick = (re) => valueByHeader(header, row, re)?.value || '';
  const faction = pick(COLS.faction) || 'Unknown faction';
  const character = pick(COLS.character) || 'Unknown';
  const submitter = pick(COLS.discord) || 'not provided';
  const occurred = pick(COLS.occurred);
  const submittedAt = valueByHeader(header, row, TIMESTAMP_HEADER)?.value || '';
  const payload = rowPayload(header, row);

  // Claim the row BEFORE touching Discord. row_key is UNIQUE, so a retry after
  // a half-finished post finds this record and resumes rather than opening a
  // second thread. ack_message_id is written last and checked first, so it
  // doubles as the "posted in full" marker.
  const existing = queryOne('SELECT id, thread_id, ack_message_id FROM faction_feedback WHERE row_key = ?', [key]);
  if (existing?.ack_message_id) return existing.id;

  let feedbackId, threadId;
  if (existing) {
    feedbackId = existing.id;
    threadId = existing.thread_id;
    console.log(`[FEEDBACK] resuming partially posted row ${sheetRow} (#${feedbackId})`);
  } else {
    const res = run(
      `INSERT INTO faction_feedback (sheet_row, row_key, faction, character_name, discord_username, occurred,
         submitted_at, payload, thread_id, due_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      [freeSheetRow('faction_feedback', sheetRow), key, faction, character, submitter, occurred, submittedAt,
       JSON.stringify(payload), plusHours(REMINDER_HOURS), nowStr()],
    );
    feedbackId = res.lastInsertRowid;
    threadId = null;
    audit(null, 'CREATE', feedbackId, `${faction} — ${character}`, 'Submission received from the form');
  }

  const channelId = pingChannel('feedback.new');
  if (!channelId) throw new Error('feedback.new route has no channel (disabled or unset)');

  // Adopt the thread a previous attempt recorded if it still exists, otherwise
  // open one and record its id immediately so the next retry adopts it rather
  // than opening another.
  if (!threadId) {
    const thread = await discordPost(`/channels/${channelId}/threads`, {
      name: titled(`${faction} · ${character}`, STATUS_TAGS.new),
      type: 11,                      // public thread
      auto_archive_duration: 10080,  // 7 days
    });
    threadId = thread.id;
    run('UPDATE faction_feedback SET thread_id = ? WHERE id = ?', [String(threadId), feedbackId]);
  }

  const mentions = pingMentions('feedback.new');

  // Header: who, what, when.
  await discordPost(`/channels/${threadId}/messages`, {
    content: [
      mentions,
      '## New faction feedback',
      `**Faction:** ${faction}`,
      `**Character:** ${character}`,
      `**Discord (for follow-up):** ${submitter}`,
      `**When did this occur?** ${occurred || 'not provided'}`,
      `**Submitted:** ${submittedAt}`,
    ].filter(Boolean).join('\n'),
    allowed_mentions: allowedMentions('feedback.new'),
  });

  // One section per question that is not an identity field, split to fit the
  // message limit. The zero-width space opens each section with a blank line.
  const identity = [TIMESTAMP_HEADER, ...Object.values(COLS)];
  for (let i = 0; i < header.length; i++) {
    const question = String(header[i] || '').trim();
    const answer = String(row[i] ?? '').trim();
    if (!question || !answer || SKIP_QUESTION.test(question)) continue;
    if (identity.some(re => re.test(question))) continue;
    const parts = chunks(answer);
    for (let n = 0; n < parts.length; n++) {
      await discordPost(`/channels/${threadId}/messages`, {
        content: (n === 0 ? `\u200b\n**${question}**\n` : '') + parts[n],
        allowed_mentions: NO_MENTIONS,
      });
    }
  }

  // The acknowledgement prompt. Contacting the submitter comes first because it
  // is the part that is invisible if nobody does it — the review itself is
  // visible in the thread either way.
  const ack = await discordPost(`/channels/${threadId}/messages`, {
    content: mentions || undefined,
    embeds: [{
      title: 'Acknowledgement',
      description: `Have we messaged the submitter yet? If not, reach out to **${submitter}** on Discord to let them know the feedback was received, then mark this as **Done**.`,
      color: EMBED_COLOR,
      footer: { text: `Reminders every ${REMINDER_HOURS}h until this is completed or cancelled.` },
    }],
    components: [ackRow(feedbackId)],
    allowed_mentions: allowedMentions('feedback.new'),
  });

  run('UPDATE faction_feedback SET ack_message_id = ? WHERE id = ?', [String(ack.id), feedbackId]);
  console.log(`[FEEDBACK] #${feedbackId} posted — ${faction} · ${character} (row ${sheetRow})`);

  // Only now is the row fully posted, so an earlier failure record is stale.
  run('DELETE FROM faction_feedback_failures WHERE sheet_row = ? OR row_key = ?', [sheetRow, key]);
  return feedbackId;
}

// ── Nudges ─────────────────────────────────────────────────────────────────────

async function checkReminders() {
  if (!pingEnabled('feedback.nudge')) {
    // Switched off in Discord & Access is a state, not a fault — worth showing as
    // such, so "why is nothing being chased" has a visible answer.
    recordSyncOk('feedback_nudge', 'nudges are switched off for this route');
    return 0;
  }

  const due = query(
    `SELECT id, thread_id, faction, character_name, status FROM faction_feedback
     WHERE status NOT IN ('completed', 'cancelled')
       AND thread_id IS NOT NULL
       AND due_at <= ?
       AND (last_reminder_at IS NULL OR last_reminder_at < due_at)`,
    [nowStr()],
  );

  let nudged = 0;
  const failures = [];
  for (const item of due) {
    try {
      // A thread that auto-archived has to be reopened before it can be posted
      // in, or the nudge lands nowhere anyone will see.
      await discordPatch(`/channels/${item.thread_id}`, { archived: false }).catch(() => {});
      await discordPost(`/channels/${item.thread_id}/messages`, {
        content: pingMentions('feedback.nudge') || undefined,
        embeds: [{
          title: 'Feedback still open',
          description:
            `This has been open for a while and is still **${STATUS_LABELS[item.status] || item.status}**. ` +
            `If it is handled, press **Complete**. If it is genuinely in progress, update the submitter and ` +
            `press **Snooze ${SNOOZE_DAYS} days**, or press **Cancel** to end it.\n\n` +
            `Otherwise this will nudge again in ${REMINDER_HOURS} hours.`,
          color: EMBED_COLOR,
        }],
        components: [nudgeRow(item.id)],
        allowed_mentions: allowedMentions('feedback.nudge'),
      });
    } catch (e) {
      // One unreachable thread must not stop the others being chased, but the
      // failure is reported rather than swallowed (BOT-32).
      console.error(`[FEEDBACK] nudge for #${item.id} failed:`, e.message);
      failures.push(`#${item.id}: ${e.message.slice(0, 80)}`);
      continue;
    }
    // Roll the due date forward rather than only stamping the reminder, so an
    // item that stays open keeps being chased on the same cadence.
    run('UPDATE faction_feedback SET last_reminder_at = ?, due_at = ? WHERE id = ?',
      [nowStr(), plusHours(REMINDER_HOURS), item.id]);
    nudged++;
  }
  return { nudged, failures };
}

// ── Button handling (called from index.js) ─────────────────────────────────────

/**
 * Who may work feedback: Team Leads and above on the staff roster (L2+), the
 * same gate as the dashboard's feedback page. Checked on every press — a
 * component interaction carries no command permissions with it.
 */
const FEEDBACK_LEVEL = 2;

const actorName = (interaction) => interaction.member?.displayName
  || interaction.user.globalName || interaction.user.username;

/**
 * Move a thread's status tag on, and optionally archive it.
 *
 * `threadId` comes from the record rather than the interaction, and the current
 * name is read over REST when the channel isn't in cache — the tag in the title
 * is how the channel list shows where everything stands, so it must not depend
 * on whether discord.js happened to have the thread cached at press time.
 *
 * Archiving also takes the thread's card out of the channel's message flow, so
 * finished work stops sitting between the live items where it can be mistaken
 * for something still open. The thread keeps everything — it moves to the
 * channel's archived-thread list.
 */
async function retitleThread(interaction, threadId, tag, { archive = false } = {}) {
  // The record's thread wins; the interaction's channel is only trusted when
  // it IS that thread (BOT-26: a press from an ephemeral reply or a nudge in
  // another thread must not rename the wrong one).
  const id = threadId || (interaction.channel?.isThread?.() ? interaction.channel.id : null);
  if (!id) return;
  try {
    const cached = interaction.channel?.isThread?.() && interaction.channel.id === String(id) ? interaction.channel : null;
    let name = cached?.name || null;
    let parentId = cached?.parentId || null;
    // One GET covers both, and the parent is only needed when we are archiving.
    if (!name || (archive && !parentId)) {
      const channel = await discordFetch('GET', `/channels/${id}`);
      name = name || channel?.name;
      parentId = parentId || channel?.parent_id;
    }
    if (!name) return;
    await discordPatch(`/channels/${id}`, {
      name: retag(name, tag),
      ...(archive ? { archived: true } : {}),
    });
    if (archive) await hideThreadCard(id, parentId, 'FEEDBACK');
  } catch (e) {
    // The record is already updated; a title that could not be changed is
    // cosmetic and must not turn a completed item into an error the presser sees.
    console.error(`[FEEDBACK] retitle ${id} failed:`, e.message);
  }
}

async function handleDone(interaction, id) {
  const row = queryOne('SELECT status, claimed_by_name, discord_username, faction, character_name, thread_id FROM faction_feedback WHERE id = ?', [id]);
  if (!row) return interaction.reply({ content: 'This feedback record no longer exists.', ephemeral: true });
  if (ENDED_STATUSES.includes(row.status)) return alreadyEnded(interaction, id, row.status);
  if (row.status === 'claimed') return interaction.reply({ content: `Already marked done by ${row.claimed_by_name}.`, ephemeral: true });

  const who = actorName(interaction);
  run("UPDATE faction_feedback SET status = 'claimed', claimed_by_id = ?, claimed_by_name = ?, claimed_at = ? WHERE id = ?",
    [interaction.user.id, who, nowStr(), id]);
  audit(interaction, 'ACKNOWLEDGE', id, `${row.faction} — ${row.character_name}`, `Submitter ${row.discord_username} contacted`);

  const unix = Math.floor(Date.now() / 1000);
  await interaction.update({
    content: null,
    embeds: [{
      title: 'Acknowledgement',
      description: `**${who}** has messaged the submitter (**${row.discord_username}**) and acknowledged the feedback was received. <t:${unix}:f>`,
      color: EMBED_COLOR,
    }],
    components: [reviewRow(id)],
  });
  await retitleThread(interaction, row.thread_id, STATUS_TAGS.claimed);
}

async function handleEnd(interaction, id, status) {
  const row = queryOne('SELECT status, faction, character_name, thread_id, reopen_card_id FROM faction_feedback WHERE id = ?', [id]);
  if (!row) return interaction.reply({ content: 'This feedback record no longer exists.', ephemeral: true });
  if (ENDED_STATUSES.includes(row.status)) return alreadyEnded(interaction, id, row.status);

  const who = actorName(interaction);
  const verb = status === 'completed' ? 'Completed' : 'Cancelled';
  run('UPDATE faction_feedback SET status = ?, concluded_by_name = ?, concluded_at = ? WHERE id = ?',
    [status, who, nowStr(), id]);
  audit(interaction, verb.toUpperCase(), id, `${row.faction} — ${row.character_name}`, '');

  const unix = Math.floor(Date.now() / 1000);
  await interaction.update({
    content: null,
    embeds: [{
      description: `${verb} by **${who}** <t:${unix}:f>. No further reminders will be sent.`,
      color: EMBED_COLOR,
    }],
    components: [reopenRow(id)],
  });
  await retitleThread(interaction, row.thread_id, STATUS_TAGS[status], { archive: true });

  // If this item had been reopened before, its reopen card is still sitting in
  // the channel — take it down the same way the original card is taken down.
  if (row.reopen_card_id) {
    const channelId = pingChannel('feedback.new');
    if (channelId) await discordDelete(`/channels/${channelId}/messages/${row.reopen_card_id}`).catch(() => {});
    run('UPDATE faction_feedback SET reopen_card_id = NULL WHERE id = ?', [id]);
  }
}

async function handleSnooze(interaction, id) {
  const row = queryOne('SELECT status, faction, character_name FROM faction_feedback WHERE id = ?', [id]);
  if (!row) return interaction.reply({ content: 'This feedback record no longer exists.', ephemeral: true });
  if (ENDED_STATUSES.includes(row.status)) return alreadyEnded(interaction, id, row.status);

  const who = actorName(interaction);
  const nextDue = plusDays(SNOOZE_DAYS);
  run('UPDATE faction_feedback SET due_at = ? WHERE id = ?', [nextDue, id]);
  audit(interaction, 'SNOOZE', id, `${row.faction} — ${row.character_name}`, `Next reminder pushed out ${SNOOZE_DAYS} days`);

  const unix = Math.floor(new Date(nextDue.replace(' ', 'T') + 'Z').getTime() / 1000);
  await interaction.update({
    content: null,
    embeds: [{
      description: `Snoozed by **${who}**. Next reminder <t:${unix}:R>.`,
      color: EMBED_COLOR,
    }],
    components: [],
  });
}

/**
 * Bring a completed or cancelled item back. The status steps back to wherever it
 * was — claimed if the submitter had already been acknowledged, new if not — and
 * the nudge clock restarts, so a reopened item is chased like any other open one.
 *
 * Closing deleted the thread's card from the channel, and Discord offers no way
 * to restore a deleted message — so reopening unarchives the thread and posts a
 * fresh card in #fm-feedback linking it. The card's id is kept on the record so
 * closing the item again takes it down with everything else.
 *
 * The press can come from the closing message in the thread OR from the
 * ephemeral "already completed" reply, so the working buttons go on a fresh
 * message in the thread rather than on whichever message was pressed — an
 * ephemeral message is gone the moment the presser dismisses it.
 */
async function handleReopen(interaction, id) {
  const row = queryOne(
    'SELECT status, claimed_by_id, faction, character_name, discord_username, thread_id, reopen_card_id FROM faction_feedback WHERE id = ?', [id]);
  if (!row) return interaction.reply({ content: 'This feedback record no longer exists.', ephemeral: true });
  if (!ENDED_STATUSES.includes(row.status)) {
    return interaction.reply({ content: `This feedback is already open — it is ${STATUS_LABELS[row.status] || row.status}.`, ephemeral: true });
  }

  // Unarchive FIRST: when the press happens inside the archived thread, nothing
  // in it — including the pressed message — can be edited until the thread is
  // live again. The retag rides in the same PATCH.
  const status = row.claimed_by_id ? 'claimed' : 'new';
  if (row.thread_id) {
    try {
      const thread = await discordFetch('GET', `/channels/${row.thread_id}`);
      await discordPatch(`/channels/${row.thread_id}`, {
        archived: false,
        ...(thread?.name ? { name: retag(thread.name, STATUS_TAGS[status]) } : {}),
      });
    } catch (e) {
      console.error(`[FEEDBACK] unarchive ${row.thread_id} failed:`, e.message);
    }
  }

  const who = actorName(interaction);
  run(`UPDATE faction_feedback SET status = ?, concluded_by_name = NULL, concluded_at = NULL,
         due_at = ?, last_reminder_at = NULL WHERE id = ?`,
    [status, plusHours(REMINDER_HOURS), id]);
  audit(interaction, 'REOPEN', id, `${row.faction} — ${row.character_name}`, `Back to ${STATUS_LABELS[status]}`);

  const unix = Math.floor(Date.now() / 1000);
  await interaction.update({
    content: null,
    embeds: [{
      description: `Reopened by **${who}** <t:${unix}:f>.`,
      color: EMBED_COLOR,
    }],
    components: [],
  });

  if (!row.thread_id) return;

  // The working prompt, matching where the item now stands.
  await discordPost(`/channels/${row.thread_id}/messages`, {
    embeds: [{
      title: 'Reopened',
      description: `**${who}** reopened this — it is back to **${STATUS_LABELS[status]}**.\n\n`
        + (status === 'claimed'
          ? 'When the review is concluded, press **Complete**, or **Cancel** to end it again.'
          : `Reach out to **${row.discord_username}** on Discord to let them know the feedback was received, then mark this as **Done**.`),
      color: EMBED_COLOR,
      footer: { text: `Reminders every ${REMINDER_HOURS}h until this is completed or cancelled.` },
    }],
    components: [status === 'claimed' ? reviewRow(id) : ackRow(id)],
    allowed_mentions: NO_MENTIONS,
  }).catch((e) => console.error(`[FEEDBACK] reopen prompt for #${id} failed:`, e.message));

  // Put the thread back in the channel. The original card (the thread-created
  // message) is gone for good, so this is a fresh one linking the thread.
  const channelId = pingChannel('feedback.new');
  if (!channelId) return;
  if (row.reopen_card_id) await discordDelete(`/channels/${channelId}/messages/${row.reopen_card_id}`).catch(() => {});
  try {
    const card = await discordPost(`/channels/${channelId}/messages`, {
      content: `🔄 **${row.faction} · ${row.character_name}** was reopened by **${who}** — <#${row.thread_id}>`,
      allowed_mentions: NO_MENTIONS,
    });
    run('UPDATE faction_feedback SET reopen_card_id = ? WHERE id = ?', [String(card.id), id]);
  } catch (e) {
    console.error(`[FEEDBACK] reopen card for #${id} failed:`, e.message);
  }
}

/**
 * Route a feedback button. Returns true if it was one of ours, so index.js can
 * fall through to its other handlers when it isn't.
 */
export async function handleFeedbackButton(interaction) {
  const { customId } = interaction;
  if (!customId.startsWith('fbk:')) return false;

  const [, action, rawId] = customId.split(':');
  const id = parseInt(rawId, 10);
  if (!Number.isInteger(id)) { await replyEphemeral(interaction, 'This button is malformed.'); return true; }

  const actor = await requireStaff(interaction, FEEDBACK_LEVEL);
  if (!actor) return true;

  try {
    if (action === 'done') await handleDone(interaction, id);
    else if (action === 'complete') await handleEnd(interaction, id, 'completed');
    else if (action === 'cancel') await handleEnd(interaction, id, 'cancelled');
    else if (action === 'snooze') await handleSnooze(interaction, id);
    else if (action === 'reopen') await handleReopen(interaction, id);
    else await replyEphemeral(interaction, `Unknown feedback action "${action}".`);
  } catch (e) {
    console.error('[FEEDBACK] button error:', e.message);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Something went wrong handling that.', ephemeral: true }).catch(() => {});
    }
  }
  return true;
}

// ── Start ──────────────────────────────────────────────────────────────────────

export { pollSheet, checkReminders };

export function startFactionFeedback() {
  if (!SHEET().id) console.warn('[FEEDBACK] SHEET_FEEDBACK_ID is not set — the feedback intake will report a configuration error on every poll');
  cron.schedule('*/15 * * * *', () => {
    pollSheet().catch((e) => { console.error('[FEEDBACK] poll error:', e.message); recordSyncFail('feedback_poll', e); });
  }, { timezone: 'UTC' });

  cron.schedule('*/30 * * * *', () => {
    checkReminders()
      .then((r) => {
        if (r === 0) return;   // route switched off: already recorded
        if (r.failures.length) recordSyncFail('feedback_nudge', `${r.failures.length} nudge(s) failed: ${r.failures.join(' | ')}`);
        else recordSyncOk('feedback_nudge', r.nudged ? `${r.nudged} item(s) nudged` : 'checked, nothing due');
      })
      .catch((e) => { console.error('[FEEDBACK] reminder error:', e.message); recordSyncFail('feedback_nudge', e); });
  }, { timezone: 'UTC' });

  // Read the sheet once on boot as well, so a restart picks up anything that
  // arrived while the bot was down instead of waiting out the cron interval.
  pollSheet().catch((e) => { console.error('[FEEDBACK] initial poll error:', e.message); recordSyncFail('feedback_poll', e); });

  console.log(`[FEEDBACK] Faction feedback intake running — sheet every 15m, nudges every ${REMINDER_HOURS}h.`);
}
