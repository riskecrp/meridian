/**
 * FM form intake — CI applications, staff applications, Recognized Criminal
 * Faction applications and garage requests each become a thread.
 *
 * Every 15 minutes each form's response sheet is read and any new row becomes a
 * thread in the configured channel: the submission laid out for reading, a ping,
 * and a workflow that ends with the item explicitly closed.
 *
 *   new -> claimed (acknowledged) -> completed / cancelled
 *
 * The thread title carries the status, so the channel list shows where every
 * item stands without opening any of them:
 *
 *   [Pending Acknowledgement] -> [Pending Review] -> [Completed] / [Cancelled]
 *
 * While an item is open it is nudged in-thread every REMINDER_HOURS, with
 * Complete / Snooze / Cancel on the nudge.
 *
 * This is the same process as bot/factionFeedback.js, generalised to four forms;
 * the shared plumbing lives in lib/formIntake.js. Feedback keeps its own module
 * because it filters one sheet shared with LFM by a division column, which none
 * of these do.
 *
 * Why polling and not the push we already have: api/notify is pinged by each
 * form's Apps Script on submit, but that payload carries only a name and a link
 * to the sheet — the answers themselves only exist in the sheet, and the answers
 * are the point. The push also has no reconciliation, so a dropped request is
 * lost outright; reading the sheet each cycle means a missed submission is picked
 * up on the next pass instead of vanishing.
 *
 * Buttons are handled in index.js with the rest of the interaction routing; the
 * record id travels in the custom id, so they keep working across restarts.
 */

import cron from 'node-cron';
import { query, queryOne, run } from './lib/db.js';
import { getPingRoute, getRole, pingChannel, pingMentions, pingRoleIds, pingEnabled } from './lib/pings.js';
import { logAudit } from './lib/audit.js';
import { recordSyncOk, recordSyncFail } from './lib/syncStatus.js';
import {
  nowStr, plusHours, plusDays,
  discordFetch, discordPost, discordPatch,
  STATUS_TAGS, titled, retag, chunks, fetchSheetRows,
  TIMESTAMP_HEADER, valueByHeader, identify, splitAnswers, rowPayload,
} from './lib/formIntake.js';

/**
 * The forms, and the little each one needs said about it.
 *
 * `title` and `contact` are matched against the sheet's HEADER TEXT rather than
 * being column indexes, because these forms are edited by hand and a question
 * inserted in the middle would silently re-point every index below it. Anything
 * not matched here is still posted — see postSubmission — so a form gaining a
 * question needs no change in this file.
 *
 * The channel, the roles pinged, and the roles allowed to press the buttons all
 * come from ping route `form.<key>`, editable in Discord & Access.
 */
const FORMS = [
  {
    key: 'rcf_application',
    label: 'Recognized Criminal Faction Application',
    // Applicants are factions here, so the faction is the identity and its
    // leader is who we actually talk to.
    title: [/^faction name/i, /^faction leader name/i],
    contact: [/leader.*discord|discord.*(username|handle|tag)/i, /discord/i],
    submitter: 'the faction leader',
    color: 3447003,
    sheet: { id: '1_CWtU4LA-sH6IeD-rnCVq_PFcOo_e9rMZ1Pac6kDVMQ', gid: '' },
  },
  {
    key: 'staff_application',
    label: 'Faction Management Staff Application',
    title: [/^staff name|^name$/i],
    contact: [/^discord$/i, /discord/i],
    submitter: 'the applicant',
    color: 15158332,
    sheet: { id: '1n485B947BGHbyf1U3xZd4V2wGAMPeK4DQZFBG6n2LCQ', gid: '1145131757' },
  },
  {
    key: 'garage_request',
    label: 'Faction Management Garage Request',
    // The old embed led with the request type, and it is the first thing anyone
    // wants to know, so it stays in the thread title.
    title: [/what faction are you requesting|^faction/i, /what are you requesting/i],
    // This form asks for no Discord handle at all, so the follow-up is the
    // character — which is who a garage is actually issued to anyway.
    contact: [/discord/i, /character.?s? name/i],
    submitter: 'the requester',
    color: 3547003,
    sheet: { id: '1JIZGWKHYik3cMul1L1J3a4ZLXNYWSTFiXz92wPFSHYo', gid: '' },
  },
  {
    key: 'ci_application',
    label: 'CI Application',
    // Character name only. The faction being applied against would be the useful
    // second half, but it is a free-text box that gets answered with a paragraph
    // as often as a name, so it stays in the body.
    title: [/^character name|^name$/i],
    // The sheet has a "What is your Discord?" column, but it is empty on every
    // row to date — the question is not actually being collected. Kept so it
    // starts working the day the form asks for it; until then acknowledgement
    // falls back to its no-handle wording.
    contact: [/what is your discord|discord/i],
    submitter: 'the applicant',
    color: 9807270,
    sheet: { id: '1ZgUuEPhXZow3m3i32w0mbk0mKZoWxJP5bAAPEqioW14', gid: '' },
  },
];

const FORM_BY_KEY = Object.fromEntries(FORMS.map((f) => [f.key, f]));

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

// How a status reads in a sentence.
const STATUS_LABELS = {
  new: 'waiting to be acknowledged',
  claimed: 'awaiting a decision',
  completed: 'completed',
  cancelled: 'cancelled',
};

/**
 * What a message from this module is allowed to ping: the route's roles by id,
 * and nothing else.
 *
 * An explicit list rather than `parse: ['roles']`, because every message we send
 * carries text somebody typed into a form. "Allow role mentions" would allow
 * THEIRS too — an applicant who put `<@&…>` in the name box would have the bot
 * ping that role on their behalf, borrowing a reach they don't have themselves.
 * With ids listed, our pings fire and anything they typed renders as inert text.
 */
const allowedMentions = (routeKey) => ({ parse: [], roles: pingRoleIds(routeKey) });

// Nothing an applicant wrote may ping anything at all.
const NO_MENTIONS = { parse: [] };

const routeKey = (formKey) => `form.${formKey}`;
const nudgeKey = (formKey) => `form.${formKey}.nudge`;

// Audit entries use the shared vocabulary: an uppercase verb, with the noun in
// target_type.
const audit = (interaction, action, id, label, details) => logAudit(
  interaction?.user?.id || '', interaction ? actorName(interaction) : 'Forms bot',
  action, 'form_submission', id, label, details);

// ── Buttons ────────────────────────────────────────────────────────────────────
//
// The record id rides in the custom id, so a press works after a restart with no
// state held in memory. index.js routes anything starting 'frm:' back here.

const BTN = { SUCCESS: 3, SECONDARY: 2 };

const button = (label, style, customId) => ({ type: 2, style, label, custom_id: customId });
const actionRow = (...buttons) => ({ type: 1, components: buttons });

const ackRow = (id) => actionRow(
  button('Acknowledge', BTN.SUCCESS, `frm:done:${id}`),
  button('Cancel', BTN.SECONDARY, `frm:cancel:${id}`),
);

const reviewRow = (id) => actionRow(
  button('Complete', BTN.SUCCESS, `frm:complete:${id}`),
  button('Cancel', BTN.SECONDARY, `frm:cancel:${id}`),
);

const nudgeRow = (id) => actionRow(
  button('Complete', BTN.SUCCESS, `frm:complete:${id}`),
  button(`Snooze ${SNOOZE_DAYS} days`, BTN.SECONDARY, `frm:snooze:${id}`),
  button('Cancel', BTN.SECONDARY, `frm:cancel:${id}`),
);

// ── Sheet polling ──────────────────────────────────────────────────────────────

async function pollForm(form) {
  const job = `form_poll.${form.key}`;
  const { rows, error } = await fetchSheetRows(form.sheet.id, form.sheet.gid);
  if (error) { recordSyncFail(job, error); return; }
  if (!rows.length) { recordSyncFail(job, 'the sheet returned no rows'); return; }

  const header = rows[0];
  const data = rows.slice(1);

  run('INSERT OR IGNORE INTO form_submission_state (form_key) VALUES (?)', [form.key]);
  const state = queryOne('SELECT last_row, initialized FROM form_submission_state WHERE form_key = ?', [form.key]);
  if (!state) { recordSyncFail(job, 'state row is missing'); return; }

  if (!state.initialized) {
    // First run: everything already in the sheet is history. Those rows predate
    // the feature and would otherwise arrive as a wall of threads, each with its
    // own ping and its own 48-hour nudge cycle.
    run('UPDATE form_submission_state SET last_row = ?, initialized = 1 WHERE form_key = ?', [data.length, form.key]);
    console.log(`[FORMS] ${form.key} initialised at row ${data.length}; watching for new submissions`);
    recordSyncOk(job, `initialised at sheet row ${data.length}; no backfill`);
    return;
  }

  let posted = 0;
  for (let idx = state.last_row; idx < data.length; idx++) {
    const sheetRow = idx + 2;   // 1-based, plus the header
    try {
      await postSubmission(form, header, data[idx], sheetRow);
      posted++;
    } catch (e) {
      const attempts = recordFailure(form.key, sheetRow, e);
      if (attempts < MAX_POST_ATTEMPTS) {
        // Probably transient. Stop WITHOUT advancing, so this row is retried next
        // cycle and submissions keep arriving in the order they were sent.
        console.error(`[FORMS] ${form.key} row ${sheetRow} attempt ${attempts}/${MAX_POST_ATTEMPTS} failed, retrying next cycle:`, e.message);
        // The job itself is working — it read the sheet and is holding position
        // on purpose, so this stays a success with a note.
        recordSyncOk(job, `holding at sheet row ${sheetRow}, attempt ${attempts}/${MAX_POST_ATTEMPTS}`);
        return;
      }
      // Out of retries. Advance past it so everything queued behind it can still
      // post; the failure row stays behind for visibility.
      run('UPDATE form_submission_failures SET skipped = 1 WHERE form_key = ? AND sheet_row = ?', [form.key, sheetRow]);
      console.error(`[FORMS] ${form.key} row ${sheetRow} failed ${attempts}x — SKIPPING so the queue can drain. Not posted:`, e.message);
    }
    run('UPDATE form_submission_state SET last_row = ? WHERE form_key = ?', [idx + 1, form.key]);
  }
  recordSyncOk(job, posted ? `${posted} new submission(s) posted` : 'checked, nothing new');
}

/**
 * Bump the attempt counter for a sheet row and return the new count. A database
 * problem here must not itself decide a row's fate, so a failure to record
 * reports attempt 1 — which retries rather than skips.
 */
function recordFailure(formKey, sheetRow, err) {
  const message = `${err.name || 'Error'}: ${err.message}`.slice(0, 300);
  try {
    run(
      `INSERT INTO form_submission_failures (form_key, sheet_row, attempts, first_failed_at, last_failed_at, last_error)
       VALUES (?, ?, 1, ?, ?, ?)
       ON CONFLICT(form_key, sheet_row) DO UPDATE SET
         attempts = attempts + 1, last_failed_at = excluded.last_failed_at, last_error = excluded.last_error`,
      [formKey, sheetRow, nowStr(), nowStr(), message],
    );
    return queryOne('SELECT attempts FROM form_submission_failures WHERE form_key = ? AND sheet_row = ?',
      [formKey, sheetRow])?.attempts || 1;
  } catch (e) {
    console.error(`[FORMS] could not record failure for ${formKey} row ${sheetRow}:`, e.message);
    return 1;
  }
}

/**
 * `silent` suppresses every mention — the roles are neither pinged in the
 * content nor listed as allowed. It exists for postLatestRowForTest below, so a
 * dry run can be posted through this exact code path (rather than a second
 * renderer that would drift from it) without notifying anyone.
 */
async function postSubmission(form, header, row, sheetRow, { silent = false } = {}) {
  const { title, contact } = identify(form, header, row);

  const payload = rowPayload(header, row);

  const submittedAt = valueByHeader(header, row, TIMESTAMP_HEADER)?.value || '';

  // Claim the row BEFORE touching Discord. (form_key, sheet_row) is UNIQUE, so a
  // retry after a half-finished post finds this record and resumes rather than
  // opening a second thread and then dying on the constraint. ack_message_id is
  // written last and checked first, so it doubles as the "posted in full" marker.
  const existing = queryOne(
    'SELECT id, thread_id, ack_message_id FROM form_submissions WHERE form_key = ? AND sheet_row = ?',
    [form.key, sheetRow]);
  if (existing?.ack_message_id) return;

  let recordId, threadId;
  if (existing) {
    recordId = existing.id;
    threadId = existing.thread_id;
    console.log(`[FORMS] resuming partially posted ${form.key} row ${sheetRow} (#${recordId})`);
  } else {
    const res = run(
      `INSERT INTO form_submissions (form_key, sheet_row, title, contact, submitted_at, payload,
         thread_id, due_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      [form.key, sheetRow, title, contact, submittedAt, JSON.stringify(payload),
       plusHours(REMINDER_HOURS), nowStr()],
    );
    recordId = res.lastInsertRowid;
    threadId = null;
    audit(null, 'CREATE', recordId, `${form.label} — ${title}`, 'Submission received from the form');
  }

  const channelId = pingChannel(routeKey(form.key));
  if (!channelId) throw new Error(`${routeKey(form.key)} has no channel (disabled or unset)`);

  // Adopt the thread a previous attempt recorded if it still exists, otherwise
  // open one and record its id immediately so the next retry adopts it rather
  // than opening another.
  if (!threadId) {
    const thread = await discordPost(`/channels/${channelId}/threads`, {
      name: titled(title, STATUS_TAGS.new),
      type: 11,                      // public thread
      auto_archive_duration: 10080,  // 7 days
    });
    threadId = thread.id;
    run('UPDATE form_submissions SET thread_id = ? WHERE id = ?', [String(threadId), recordId]);
  }

  const mentions = silent ? '' : pingMentions(routeKey(form.key));
  const allow = silent ? NO_MENTIONS : allowedMentions(routeKey(form.key));

  // Header block: every short answer as one line, in the order the form asks
  // them. Long answers follow as their own sections, so the summary stays
  // readable no matter how much someone wrote.
  const { shortLines, longAnswers } = splitAnswers(header, row);

  await discordPost(`/channels/${threadId}/messages`, {
    content: [
      mentions,
      `## New ${form.label}`,
      ...shortLines,
      submittedAt ? `**Submitted:** ${submittedAt}` : '',
    ].filter(Boolean).join('\n').slice(0, 1990),
    allowed_mentions: allow,
  });

  // One section per long-form answer, split to fit the message limit. The
  // zero-width space opens each section with a visible blank line.
  for (const { question, answer } of longAnswers) {
    const parts = chunks(answer);
    for (let n = 0; n < parts.length; n++) {
      await discordPost(`/channels/${threadId}/messages`, {
        content: (n === 0 ? `​\n**${question}**\n` : '') + parts[n],
        allowed_mentions: NO_MENTIONS,
      });
    }
  }

  // The acknowledgement prompt. Contacting the submitter comes first because it
  // is the part that is invisible if nobody does it — the decision itself is
  // visible in the thread either way.
  const ack = await discordPost(`/channels/${threadId}/messages`, {
    content: mentions || undefined,
    embeds: [{
      title: 'Acknowledgement',
      // Without a handle there is nobody to name, and telling someone to message
      // "not provided" is worse than telling them the form didn't ask.
      description: contact
        // Not "reach out on Discord" — for the garage form this falls back to a
        // character name, and half these forms never asked for a handle.
        ? `Has ${form.submitter} been told we have this? If not, reach out to **${contact}** to let ` +
          `them know the submission was received, then press **Acknowledge**.`
        : `Has ${form.submitter} been told we have this? This form does not collect a Discord handle, so they ` +
          `will need to be found from the details above. Press **Acknowledge** once they know.`,
      color: form.color,
      footer: { text: `Reminders every ${REMINDER_HOURS}h until this is completed or cancelled.` },
    }],
    components: [ackRow(recordId)],
    allowed_mentions: allow,
  });

  run('UPDATE form_submissions SET ack_message_id = ? WHERE id = ?', [String(ack.id), recordId]);
  console.log(`[FORMS] #${recordId} posted — ${form.key}: ${title} (row ${sheetRow})`);

  // Only now is the row fully posted, so an earlier failure record is stale.
  run('DELETE FROM form_submission_failures WHERE form_key = ? AND sheet_row = ?', [form.key, sheetRow]);
}

/**
 * Post one form's most recent sheet row as a silent dry run — real thread, real
 * layout, real working buttons, no ping.
 *
 * For eyeballing what a form produces before it goes live. It deliberately reuses
 * postSubmission rather than rendering separately, because a preview that is not
 * the actual code path is not a preview of anything.
 *
 * The row it posts is already behind the poller's position, so this creates no
 * duplicate later. The record is a normal one — delete it and its thread when
 * you are done looking.
 */
export async function postLatestRowForTest(formKey) {
  const form = FORM_BY_KEY[formKey];
  if (!form) throw new Error(`unknown form "${formKey}"`);

  const { rows, error } = await fetchSheetRows(form.sheet.id, form.sheet.gid);
  if (error) throw new Error(error);
  if (rows.length < 2) throw new Error('sheet has no submissions');

  const sheetRow = rows.length;   // 1-based; the last row of the sheet
  await postSubmission(form, rows[0], rows[rows.length - 1], sheetRow, { silent: true });
  return queryOne('SELECT id, title, thread_id FROM form_submissions WHERE form_key = ? AND sheet_row = ?',
    [formKey, sheetRow]);
}

// ── Nudges ─────────────────────────────────────────────────────────────────────

async function checkReminders(form) {
  const job = `form_nudge.${form.key}`;
  if (!pingEnabled(nudgeKey(form.key))) {
    // Switched off in Discord & Access is a state, not a fault — worth showing as
    // such, so "why is nothing being chased" has a visible answer.
    recordSyncOk(job, 'nudges are switched off for this form');
    return;
  }

  const due = query(
    `SELECT id, thread_id, title, status FROM form_submissions
     WHERE form_key = ?
       AND status NOT IN ('completed', 'cancelled')
       AND thread_id IS NOT NULL
       AND due_at <= ?
       AND (last_reminder_at IS NULL OR last_reminder_at < due_at)`,
    [form.key, nowStr()],
  );

  let nudged = 0;
  for (const item of due) {
    try {
      // A thread that auto-archived has to be reopened before it can be posted
      // in, or the nudge lands nowhere anyone will see.
      await discordPatch(`/channels/${item.thread_id}`, { archived: false }).catch(() => {});
      await discordPost(`/channels/${item.thread_id}/messages`, {
        content: pingMentions(nudgeKey(form.key)) || undefined,
        embeds: [{
          title: `${form.label} still open`,
          description:
            `This has been open for a while and is still **${STATUS_LABELS[item.status] || item.status}**. ` +
            `If it is handled, press **Complete**. If it is genuinely in progress, update ${form.submitter} and ` +
            `press **Snooze ${SNOOZE_DAYS} days**, or press **Cancel** to end it.\n\n` +
            `Otherwise this will nudge again in ${REMINDER_HOURS} hours.`,
          color: form.color,
        }],
        components: [nudgeRow(item.id)],
        allowed_mentions: allowedMentions(nudgeKey(form.key)),
      });
    } catch (e) {
      // One unreachable thread must not stop the others being chased.
      console.error(`[FORMS] nudge for #${item.id} failed:`, e.message);
      continue;
    }
    // Roll the due date forward rather than only stamping the reminder, so an
    // item that stays open keeps being chased on the same cadence.
    run('UPDATE form_submissions SET last_reminder_at = ?, due_at = ? WHERE id = ?',
      [nowStr(), plusHours(REMINDER_HOURS), item.id]);
    nudged++;
  }
  recordSyncOk(job, nudged ? `${nudged} item(s) nudged` : 'checked, nothing due');
}

// ── Button handling (called from index.js) ─────────────────────────────────────

/**
 * Who may work a form: whoever that form pings. Retargeting a form's mention in
 * Discord & Access therefore retargets who can action it — one list, not two.
 *
 * The route is read directly rather than through pingRoleIds() so that `enabled`
 * is ignored here: switching a form's intake off should stop new threads, not
 * strand the open ones with buttons nobody can press. An empty or unparseable
 * list falls back to FM Leadership, so a misconfigured route cannot lock
 * everyone out of an item that is already posted.
 */
function actionRoleIds(formKey) {
  const route = getPingRoute(routeKey(formKey));
  let ids = [];
  try {
    const parsed = JSON.parse(route?.mention_roles || '[]');
    if (Array.isArray(parsed)) ids = parsed.filter(Boolean).map(String);
  } catch { ids = []; }
  if (!ids.length) {
    const fallback = getRole('fm_leadership');
    if (fallback) ids = [fallback];
  }
  return ids;
}

/**
 * Checked on every press. A component interaction carries no command permissions
 * with it, so nothing else stands between a random member and these buttons.
 */
function canAct(interaction, formKey) {
  const allowed = actionRoleIds(formKey);
  const held = interaction.member?.roles?.cache;
  return !!held && allowed.some((id) => held.has(id));
}

const actorName = (interaction) => interaction.member?.displayName
  || interaction.user.globalName || interaction.user.username;

/** How the roles that may act on a form read in a refusal message. */
function allowedRoleNames(interaction, formKey) {
  const names = actionRoleIds(formKey)
    .map((id) => interaction.guild?.roles?.cache?.get(id)?.name)
    .filter(Boolean);
  return names.length ? names.join(', ') : 'the roles this form pings';
}

/**
 * Move a thread's status tag on, and optionally archive it.
 *
 * `threadId` comes from the record rather than the interaction, and the current
 * name is read over REST when the channel isn't in cache — the tag in the title
 * is how the channel list shows where everything stands, so it must not depend
 * on whether discord.js happened to have the thread cached at press time.
 */
async function retitleThread(interaction, threadId, tag, { archive = false } = {}) {
  const id = interaction.channel?.isThread?.() ? interaction.channel.id : threadId;
  if (!id) return;
  try {
    let name = interaction.channel?.isThread?.() ? interaction.channel.name : null;
    if (!name) name = (await discordFetch('GET', `/channels/${id}`))?.name;
    if (!name) return;
    await discordPatch(`/channels/${id}`, {
      name: retag(name, tag),
      ...(archive ? { archived: true } : {}),
    });
  } catch (e) {
    // The record is already updated; a title that could not be changed is
    // cosmetic and must not turn a completed item into an error the presser sees.
    console.error(`[FORMS] retitle ${id} failed:`, e.message);
  }
}

async function handleDone(interaction, item, form) {
  if (item.status === 'claimed') {
    return interaction.reply({ content: `Already acknowledged by ${item.claimed_by_name}.`, ephemeral: true });
  }

  const who = actorName(interaction);
  run("UPDATE form_submissions SET status = 'claimed', claimed_by_id = ?, claimed_by_name = ?, claimed_at = ? WHERE id = ?",
    [interaction.user.id, who, nowStr(), item.id]);
  audit(interaction, 'ACKNOWLEDGE', item.id, `${form.label} — ${item.title}`,
    item.contact ? `${item.contact} contacted` : 'Submitter acknowledged');

  const unix = Math.floor(Date.now() / 1000);
  await interaction.update({
    content: null,
    embeds: [{
      title: 'Acknowledgement',
      description: item.contact
        ? `**${who}** has contacted **${item.contact}** to confirm the submission was received. <t:${unix}:f>`
        : `**${who}** has acknowledged this submission and let ${form.submitter} know it was received. <t:${unix}:f>`,
      color: form.color,
    }],
    components: [reviewRow(item.id)],
  });
  await retitleThread(interaction, item.thread_id, STATUS_TAGS.claimed);
}

async function handleEnd(interaction, item, form, status) {
  const who = actorName(interaction);
  const verb = status === 'completed' ? 'Completed' : 'Cancelled';
  run('UPDATE form_submissions SET status = ?, concluded_by_name = ?, concluded_at = ? WHERE id = ?',
    [status, who, nowStr(), item.id]);
  audit(interaction, verb.toUpperCase(), item.id, `${form.label} — ${item.title}`, '');

  const unix = Math.floor(Date.now() / 1000);
  await interaction.update({
    content: null,
    embeds: [{
      description: `${verb} by **${who}** <t:${unix}:f>. No further reminders will be sent.`,
      color: form.color,
    }],
    components: [],
  });
  await retitleThread(interaction, item.thread_id, STATUS_TAGS[status], { archive: true });
}

async function handleSnooze(interaction, item, form) {
  const who = actorName(interaction);
  const nextDue = plusDays(SNOOZE_DAYS);
  run('UPDATE form_submissions SET due_at = ? WHERE id = ?', [nextDue, item.id]);
  audit(interaction, 'SNOOZE', item.id, `${form.label} — ${item.title}`, `Next reminder pushed out ${SNOOZE_DAYS} days`);

  const unix = Math.floor(new Date(nextDue.replace(' ', 'T') + 'Z').getTime() / 1000);
  await interaction.update({
    content: null,
    embeds: [{
      description: `Snoozed by **${who}**. Next reminder <t:${unix}:R>.`,
      color: form.color,
    }],
    components: [],
  });
}

/**
 * Route a form button. Returns true if it was one of ours, so index.js can fall
 * through to its other handlers when it isn't.
 */
export async function handleFormButton(interaction) {
  const { customId } = interaction;
  if (!customId.startsWith('frm:')) return false;

  const [, action, rawId] = customId.split(':');
  const id = parseInt(rawId, 10);
  if (!Number.isInteger(id)) return true;

  try {
    const item = queryOne(
      'SELECT id, form_key, status, title, contact, claimed_by_name, thread_id FROM form_submissions WHERE id = ?', [id]);
    if (!item) {
      await interaction.reply({ content: 'This submission no longer exists.', ephemeral: true });
      return true;
    }
    const form = FORM_BY_KEY[item.form_key];
    if (!form) {
      await interaction.reply({ content: 'This submission belongs to a form that is no longer configured.', ephemeral: true });
      return true;
    }
    if (!canAct(interaction, item.form_key)) {
      await interaction.reply({
        content: `Only ${allowedRoleNames(interaction, item.form_key)} can action ${form.label.toLowerCase()}s.`,
        ephemeral: true,
      });
      return true;
    }
    // Checked once here rather than in each handler: every action below is a
    // state change, and every one of them is meaningless on a closed item.
    if (ENDED_STATUSES.includes(item.status)) {
      await interaction.reply({ content: `This submission is already ${item.status}.`, ephemeral: true });
      return true;
    }

    if (action === 'done') await handleDone(interaction, item, form);
    else if (action === 'complete') await handleEnd(interaction, item, form, 'completed');
    else if (action === 'cancel') await handleEnd(interaction, item, form, 'cancelled');
    else if (action === 'snooze') await handleSnooze(interaction, item, form);
  } catch (e) {
    console.error('[FORMS] button error:', e.message);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Something went wrong handling that.', ephemeral: true }).catch(() => {});
    }
  }
  return true;
}

// ── Start ──────────────────────────────────────────────────────────────────────

// Each form is polled independently so one unreadable sheet cannot stop the
// others — the whole point of per-form sync rows is that a single form being
// blocked is visible as exactly that.
async function pollAll() {
  for (const form of FORMS) {
    await pollForm(form).catch((e) => {
      console.error(`[FORMS] ${form.key} poll error:`, e.message);
      recordSyncFail(`form_poll.${form.key}`, e);
    });
  }
}

async function nudgeAll() {
  for (const form of FORMS) {
    await checkReminders(form).catch((e) => {
      console.error(`[FORMS] ${form.key} reminder error:`, e.message);
      recordSyncFail(`form_nudge.${form.key}`, e);
    });
  }
}

export function startFormSubmissions() {
  cron.schedule('*/15 * * * *', () => { pollAll(); }, { timezone: 'UTC' });
  cron.schedule('*/30 * * * *', () => { nudgeAll(); }, { timezone: 'UTC' });

  // Read the sheets once on boot as well, so a restart picks up anything that
  // arrived while the bot was down instead of waiting out the cron interval.
  pollAll();

  console.log(`[FORMS] Form intake running for ${FORMS.length} forms — sheets every 15m, nudges every ${REMINDER_HOURS}h.`);
}
