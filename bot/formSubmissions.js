/**
 * FM form intake — CI applications, staff applications, Recognized Criminal
 * Faction applications and garage requests each become a thread.
 *
 * Every 15 minutes each form's response sheet is read and any new row becomes a
 * thread in the configured channel: the submission laid out for reading, a ping,
 * and a workflow that ends with the item explicitly closed.
 *
 * There are two workflows, declared per form below.
 *
 * Most forms just need doing. There is no acknowledgement step and nothing to
 * claim: the thread is where the work and the discussion happen, and one button
 * says they are finished.
 *
 *   [Open] -> [Completed]
 *
 * The Recognized Criminal Faction application is decided first, and an accepted
 * faction then has to be set up. FM Leadership owns it throughout and is the
 * only role it ever pings; Game Affairs Management may also work the setup
 * checklist, without being paged for it. Complete stays disabled until every box
 * is ticked.
 *
 *   [Open] --Reject--> [Rejected]
 *          --Accept--> [Accepted] --all ticked--> [Completed]
 *
 * The thread title carries the status either way, so the channel list shows
 * where everything stands without opening any of it. While an item is open it is
 * nudged in-thread every REMINDER_HOURS.
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
  discordFetch, discordPost, discordPatch, hideThreadCard,
  OPEN_STATUS_TAGS, DECISION_STATUS_TAGS, titled, retag, chunks, fetchSheetRows,
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
    color: 3447003,
    sheet: { id: '1_CWtU4LA-sH6IeD-rnCVq_PFcOo_e9rMZ1Pac6kDVMQ', gid: '' },
    // The one form that is decided before it is worked. Accept or Reject first;
    // an accepted faction then has to be set up before the item can close.
    workflow: 'decision',
    // Roles that may work the setup checklist WITHOUT being pinged for it.
    // FM Leadership owns an RCF application start to finish and is the only role
    // it notifies; Game Affairs Management can pitch in proactively when help is
    // wanted, which is an access grant, not an obligation. Keyed into
    // discord_roles so a role re-created in Discord is a database edit.
    setupAlsoAllow: ['game_affairs'],
    // Setup steps for an accepted faction. `label` goes on the button (keep it
    // short — Discord allows 80 characters and a cramped row is unreadable);
    // `detail` is the instruction shown in the embed, where links belong.
    //
    // `prereq: true` marks the three steps everything else depends on — you
    // cannot configure a faction whose Discord you have not joined, whose bot is
    // not invited, and whose roles do not exist. The remaining seven stay
    // disabled until all three are ticked. Order is otherwise free.
    //
    // Keys are permanent identifiers: they ride in button custom ids and are
    // snapshotted onto each accepted application, so change one only alongside
    // its label. Max 20 items.
    checklist: [
      { key: 'join_discord', prereq: true, label: "Join faction Discord",
        detail: "Join the recognized faction's Discord." },
      { key: 'invite_bot', prereq: true, label: 'Invite Meridian bot',
        detail: 'Invite the Meridian bot to their Discord — [invite link](https://discord.com/oauth2/authorize?client_id=1441261070206636042&permissions=274877991936&integration_type=0&scope=bot+applications.commands)' },
      { key: 'ecrp_roles', prereq: true, label: 'ECRP roles',
        detail: "Verify or create the **ECRP Guide** and **ECRP Management** roles in the faction's Discord." },
      { key: 'invite_hc', label: 'High Command → GA',
        detail: 'Invite their High Command to the GA Discord — [invite link](https://discord.gg/FTDmuQqcDR)' },
      { key: 'dashboard', label: 'Add to Dashboard',
        detail: 'Configure the faction on the Meridian Dashboard: **Factions → Add Faction +**' },
      { key: 'f4_exists', label: 'F4 exists',
        detail: 'Verify or create an in-game **F4** for the faction.' },
      { key: 'f4_owner', label: 'F4 ownership',
        detail: 'Transfer ownership of the F4 to the faction leader, if needed.' },
      { key: 'leader_role', label: 'Criminal leader role',
        detail: 'Add the **criminal leader** role to the player in the main ECRP Discord.' },
      { key: 'fm_team', label: 'Assign FM Team',
        detail: 'Assign the faction to an FM Team: **Meridian Dashboard → Staff**' },
      { key: 'notify_team', label: 'Notify FM Team',
        detail: "Tell the team they're receiving a new faction, and advise them to send the [Initial Garage Request](https://docs.google.com/forms/d/e/1FAIpQLSe4Q_seUQf2IrkTKYhuaNTzTLXNCbhw6M8pUHvO1mpAWSiwRw/viewform) after their first OOC meeting." },
    ],
  },
  {
    key: 'staff_application',
    label: 'Faction Management Staff Application',
    title: [/^staff name|^name$/i],
    contact: [/^discord$/i, /discord/i],
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
    // row to date — the question is not actually being collected. Kept so the
    // record starts carrying a handle the day the form asks for one.
    contact: [/what is your discord|discord/i],
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

// Statuses that end the flow — no more nudges, buttons refuse to act. 'accepted'
// is NOT one of them: an accepted application still has its setup to finish, and
// that is exactly the stretch worth chasing.
const ENDED_STATUSES = ['completed', 'cancelled', 'rejected'];

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
// Who is pinged for the setup work, and who may tick it off. Deliberately a
// different route from the form itself: Leadership decides, Game Affairs sets up.
const setupKey = (formKey) => `form.${formKey}.setup`;

// Which tag set a form's threads use.
const tagsFor = (form) => (form.workflow === 'decision' ? DECISION_STATUS_TAGS : OPEN_STATUS_TAGS);

// Discord allows 5 action rows of 5 buttons; the last row is the Complete
// button, so the checklist itself gets four rows.
const MAX_CHECKLIST_ITEMS = 20;

// Audit entries use the shared vocabulary: an uppercase verb, with the noun in
// target_type.
const audit = (interaction, action, id, label, details) => logAudit(
  interaction?.user?.id || '', interaction ? actorName(interaction) : 'Forms bot',
  action, 'form_submission', id, label, details);

// ── Buttons ────────────────────────────────────────────────────────────────────
//
// The record id rides in the custom id, so a press works after a restart with no
// state held in memory. index.js routes anything starting 'frm:' back here.

const BTN = { PRIMARY: 1, SECONDARY: 2, SUCCESS: 3, DANGER: 4 };

const button = (label, style, customId) => ({ type: 2, style, label, custom_id: customId });
const actionRow = (...buttons) => ({ type: 1, components: buttons });

// One button, on the opening prompt and on every nudge. There is no
// acknowledgement step and nothing to claim: the thread is where the work and
// the discussion happen, and Complete is the statement that they are finished.
//
// Snooze and Cancel still exist behind handleFormButton — adding either back is
// a matter of putting it in this row.
const completeRow = (id) => actionRow(
  button('Complete', BTN.SUCCESS, `frm:complete:${id}`),
);

// The decision workflow's opening prompt.
const decisionRow = (id) => actionRow(
  button('Accept', BTN.SUCCESS, `frm:accept:${id}`),
  button('Reject', BTN.DANGER, `frm:reject:${id}`),
);

/**
 * The checklist, drawn from the snapshotted rows rather than the config, so a
 * later edit to the item list cannot change what an application in flight is
 * being held to.
 *
 * Complete is rendered disabled until every box is ticked, rather than hidden:
 * a greyed button reading "Complete (2/6)" says what is left, where an absent
 * one just looks like the feature is missing.
 */
function checklistView(item, form) {
  const items = query(
    'SELECT item_key, label, detail, prereq, done, done_by_name FROM form_submission_checklist WHERE submission_id = ? ORDER BY sort, id',
    [item.id]);
  const doneCount = items.filter((i) => i.done).length;
  const allDone = items.length > 0 && doneCount === items.length;

  const prereqs = items.filter((i) => i.prereq);
  const rest = items.filter((i) => !i.prereq);
  // The gate. Until every prerequisite is ticked the remaining steps cannot
  // actually be carried out, so their buttons stay disabled rather than letting
  // someone tick work they could not have done.
  const prereqsDone = prereqs.every((i) => i.done);

  const line = (i, n) => {
    const head = i.done ? `✅ ~~**${n}. ${i.label}**~~` : `☐ **${n}. ${i.label}**`;
    const who = i.done ? ` — ${i.done_by_name}` : '';
    return `${head}${who}\n${i.detail || ''}`.trimEnd();
  };

  const sections = [];
  if (prereqs.length) {
    sections.push(`**Do these first — the rest depend on them**\n${
      prereqs.map((i, n) => line(i, n + 1)).join('\n')}`);
  }
  if (rest.length) {
    sections.push(`**${prereqsDone ? 'Then, in any order' : 'Locked until the three above are done'}**\n${
      rest.map((i, n) => line(i, prereqs.length + n + 1)).join('\n')}`);
  }

  // Prerequisites get their own row so the split is visible in the buttons, not
  // only in the text.
  const rows = [];
  const addRows = (group, offset, disabled) => {
    for (let i = 0; i < group.length; i += 5) {
      rows.push(actionRow(...group.slice(i, i + 5).map((it, n) => ({
        ...button(
          `${it.done ? '✅' : '☐'} ${offset + i + n + 1}. ${it.label}`.slice(0, 80),
          it.done ? BTN.SECONDARY : BTN.PRIMARY,
          `frm:tick:${item.id}:${it.item_key}`,
        ),
        // A ticked step stays pressable so it can be undone.
        disabled: disabled && !it.done,
      }))));
    }
  };
  addRows(prereqs, 0, false);
  addRows(rest, prereqs.length, !prereqsDone);

  rows.push(actionRow({
    ...button(allDone ? 'Complete' : `Complete (${doneCount}/${items.length})`,
      BTN.SUCCESS, `frm:complete:${item.id}`),
    disabled: !allDone,
  }));

  return {
    embeds: [{
      title: `Setup checklist — ${doneCount}/${items.length} complete`,
      description: `${sections.join('\n\n')}\n\n${allDone
        ? 'Everything is done. Press **Complete** to close this out.'
        : 'Tick each step as it is finished. Complete unlocks once they all are.'}`.slice(0, 4096),
      color: form.color,
    }],
    components: rows,
  };
}

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
      name: titled(title, tagsFor(form).new),
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

  // The prompt that moves the item on. It goes last so it sits at the bottom of
  // the thread, under everything it is asking about.
  const decides = form.workflow === 'decision';
  const ack = await discordPost(`/channels/${threadId}/messages`, {
    content: mentions || undefined,
    embeds: [{
      title: decides ? 'Decision' : 'Open',
      description: decides
        ? 'Discuss this in the thread, then **Accept** or **Reject**.'
        : 'Discuss and handle this in the thread. Press **Complete** once it is done.',
      color: form.color,
      footer: { text: `Reminders every ${REMINDER_HOURS}h until this is ${decides ? 'decided and set up' : 'completed'}.` },
    }],
    components: [decides ? decisionRow(recordId) : completeRow(recordId)],
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
export async function postLatestRowForTest(formKey, wantRow = null, { accepted = false } = {}) {
  const form = FORM_BY_KEY[formKey];
  if (!form) throw new Error(`unknown form "${formKey}"`);

  const { rows, error } = await fetchSheetRows(form.sheet.id, form.sheet.gid);
  if (error) throw new Error(error);
  if (rows.length < 2) throw new Error('sheet has no submissions');

  // 1-based and inclusive of the header, matching what the poller records — so
  // `wantRow` is the row number as the spreadsheet itself shows it.
  const sheetRow = wantRow ?? rows.length;
  if (sheetRow < 2 || sheetRow > rows.length) throw new Error(`row ${sheetRow} is not in the sheet`);
  await postSubmission(form, rows[0], rows[sheetRow - 1], sheetRow, { silent: true });
  const item = queryOne('SELECT id, title, thread_id FROM form_submissions WHERE form_key = ? AND sheet_row = ?',
    [formKey, sheetRow]);

  // Carry a decision-workflow preview through to its checklist stage, so the
  // half that only exists after acceptance can be seen and clicked without
  // pressing Accept for real and paging the setup roles.
  if (accepted && form.workflow === 'decision') {
    run("UPDATE form_submissions SET status = 'accepted', decided_by_name = 'Preview', decided_at = ? WHERE id = ?",
      [nowStr(), item.id]);
    (form.checklist || []).slice(0, MAX_CHECKLIST_ITEMS).forEach((it, n) => run(
      'INSERT OR IGNORE INTO form_submission_checklist (submission_id, item_key, label, detail, prereq, sort) VALUES (?, ?, ?, ?, ?, ?)',
      [item.id, it.key, it.label, it.detail || '', it.prereq ? 1 : 0, n]));
    // Retire the decision prompt exactly as accepting for real would, or the
    // preview shows a live Accept/Reject above a checklist that already exists.
    const prompt = queryOne('SELECT ack_message_id FROM form_submissions WHERE id = ?', [item.id])?.ack_message_id;
    if (prompt) {
      await discordPatch(`/channels/${item.thread_id}/messages/${prompt}`, {
        content: null,
        embeds: [{
          title: 'Accepted',
          description: `Accepted by **Preview** <t:${Math.floor(Date.now() / 1000)}:f>. Setup is now outstanding.`,
          color: form.color,
        }],
        components: [],
      }).catch(() => {});
    }
    const posted = await discordPost(`/channels/${item.thread_id}/messages`, {
      ...checklistView(item, form),
      allowed_mentions: NO_MENTIONS,
    });
    run('UPDATE form_submissions SET checklist_message_id = ? WHERE id = ?', [String(posted.id), item.id]);
    await discordPatch(`/channels/${item.thread_id}`, {
      name: retag(titled(item.title, tagsFor(form).new), tagsFor(form).accepted),
    }).catch(() => {});
  }
  return item;
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
       AND status NOT IN (${ENDED_STATUSES.map(() => '?').join(', ')})
       AND thread_id IS NOT NULL
       AND due_at <= ?
       AND (last_reminder_at IS NULL OR last_reminder_at < due_at)`,
    [form.key, ...ENDED_STATUSES, nowStr()],
  );

  let nudged = 0;
  for (const item of due) {
    try {
      // A thread that auto-archived has to be reopened before it can be posted
      // in, or the nudge lands nowhere anyone will see.
      await discordPatch(`/channels/${item.thread_id}`, { archived: false }).catch(() => {});
      // On the decision forms the buttons live on the prompt messages above —
      // the decision one, then the checklist — so the nudge only says what is
      // outstanding and leaves the acting to them. Repeating a checklist that
      // rewrites itself would leave stale copies scattered up the thread.
      const left = item.status === 'accepted' ? remainingSteps(item, form) : 0;
      const chase = item.status === 'accepted'
        ? `This was accepted but its setup is not finished — **${left}** step${left === 1 ? '' : 's'} still to tick on the checklist above.`
        : form.workflow === 'decision'
          ? 'This has been waiting a while and has not been accepted or rejected yet.'
          : 'This has been open for a while and has not been completed. If it is handled, press **Complete**.';

      await discordPost(`/channels/${item.thread_id}/messages`, {
        content: pingMentions(nudgeKey(form.key)) || undefined,
        embeds: [{
          title: `${form.label} still open`,
          description: `${chase}\n\nOtherwise this will nudge again in ${REMINDER_HOURS} hours.`,
          color: form.color,
        }],
        components: form.workflow === 'decision' ? [] : [completeRow(item.id)],
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
function actionRoleIds(key) {
  const route = getPingRoute(key);
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
 * Which route governs a given press.
 *
 * On the decision forms the two halves are owned by different people: FM
 * Leadership decides whether to accept, and Game Affairs Management does the
 * setup and says when it is finished. So ticking and completing answer to the
 * setup route, and everything else to the form's own.
 */
const isSetupPhase = (form, action) =>
  form.workflow === 'decision' && (action === 'tick' || action === 'complete');

function routeForAction(form, action) {
  return isSetupPhase(form, action) ? setupKey(form.key) : routeKey(form.key);
}

/**
 * Everyone who may press a given button: the governing route's roles, plus — in
 * the setup phase only — the roles granted access without being pinged.
 *
 * The two are separate on purpose. A ping route's mention_roles is a list of
 * people to notify, and using it alone to mean "may press this" forces anyone
 * with access to also be paged for every single item.
 */
function permittedRoleIds(form, action) {
  const ids = actionRoleIds(routeForAction(form, action));
  if (!isSetupPhase(form, action)) return ids;
  const extra = (form.setupAlsoAllow || []).map((k) => getRole(k)).filter(Boolean);
  return [...new Set([...ids, ...extra])];
}

/**
 * Checked on every press. A component interaction carries no command permissions
 * with it, so nothing else stands between a random member and these buttons.
 */
function canAct(interaction, allowed) {
  const held = interaction.member?.roles?.cache;
  return !!held && allowed.some((id) => held.has(id));
}

const actorName = (interaction) => interaction.member?.displayName
  || interaction.user.globalName || interaction.user.username;

/** How the roles that may act read in a refusal message. */
function allowedRoleNames(interaction, allowed) {
  const names = allowed
    .map((id) => interaction.guild?.roles?.cache?.get(id)?.name)
    .filter(Boolean);
  // Not "the roles this form pings" — in the setup phase some roles may act
  // without being pinged at all, so that phrasing would name the wrong set.
  return names.length ? names.join(', ') : 'certain roles';
}

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
  const id = interaction.channel?.isThread?.() ? interaction.channel.id : threadId;
  if (!id) return;
  try {
    const cached = interaction.channel?.isThread?.() ? interaction.channel : null;
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
    if (archive) await hideThreadCard(id, parentId, 'FORMS');
  } catch (e) {
    // The record is already updated; a title that could not be changed is
    // cosmetic and must not turn a completed item into an error the presser sees.
    console.error(`[FORMS] retitle ${id} failed:`, e.message);
  }
}

/**
 * Accept: record the decision, snapshot the checklist, and hand the thread over
 * to whoever does the setup.
 *
 * The checklist goes in a NEW message rather than replacing the decision, so the
 * thread keeps a record of who accepted it and when, and so the ping lands as a
 * new notification for the setup roles rather than as a silent edit.
 */
async function handleAccept(interaction, item, form) {
  // Guards a double-click and a press on a stale message: accepting twice would
  // post a second checklist and orphan the first, ticks and all.
  if (item.status === 'accepted') {
    return interaction.reply({ content: 'This has already been accepted — the checklist is above.', ephemeral: true });
  }
  const who = actorName(interaction);
  const items = (form.checklist || []).slice(0, MAX_CHECKLIST_ITEMS);
  if (!items.length) throw new Error(`${form.key} has workflow 'decision' but no checklist`);

  run("UPDATE form_submissions SET status = 'accepted', decided_by_id = ?, decided_by_name = ?, decided_at = ? WHERE id = ?",
    [interaction.user.id, who, nowStr(), item.id]);
  // Snapshot the steps as they stand today. INSERT OR IGNORE so a retry after a
  // half-finished accept does not reset ticks that were already made.
  items.forEach((it, n) => run(
    'INSERT OR IGNORE INTO form_submission_checklist (submission_id, item_key, label, detail, prereq, sort) VALUES (?, ?, ?, ?, ?, ?)',
    [item.id, it.key, it.label, it.detail || '', it.prereq ? 1 : 0, n]));
  audit(interaction, 'ACCEPT', item.id, `${form.label} — ${item.title}`, `${items.length} setup steps to complete`);

  const unix = Math.floor(Date.now() / 1000);
  await interaction.update({
    content: null,
    embeds: [{
      title: 'Accepted',
      description: `Accepted by **${who}** <t:${unix}:f>. Setup is now outstanding.`,
      color: form.color,
    }],
    components: [],
  });
  await retitleThread(interaction, item.thread_id, tagsFor(form).accepted);

  const view = checklistView(item, form);
  const posted = await discordPost(`/channels/${item.thread_id}/messages`, {
    content: pingMentions(setupKey(form.key)) || undefined,
    ...view,
    allowed_mentions: allowedMentions(setupKey(form.key)),
  });
  run('UPDATE form_submissions SET checklist_message_id = ? WHERE id = ?', [String(posted.id), item.id]);
}

/** Reject: capture why, close the thread, and name who to tell. */
async function handleReject(interaction, item, form, reason) {
  const who = actorName(interaction);
  run("UPDATE form_submissions SET status = 'rejected', decided_by_id = ?, decided_by_name = ?, decided_at = ?, decision_reason = ?, concluded_by_name = ?, concluded_at = ? WHERE id = ?",
    [interaction.user.id, who, nowStr(), reason || '', who, nowStr(), item.id]);
  audit(interaction, 'REJECT', item.id, `${form.label} — ${item.title}`, reason || '');

  const unix = Math.floor(Date.now() / 1000);
  await interaction.update({
    content: null,
    embeds: [{
      title: 'Rejected',
      description: [
        `Rejected by **${who}** <t:${unix}:f>.`,
        reason ? `\n**Reason:** ${reason}` : '',
        item.contact ? `\nReach out to **${item.contact}** to let them know.` : '',
      ].filter(Boolean).join(''),
      color: form.color,
    }],
    components: [],
  });
  await retitleThread(interaction, item.thread_id, tagsFor(form).rejected, { archive: true });
}

/** Toggle one setup step. Ticks are reversible — people mis-click. */
async function handleTick(interaction, item, form, itemKey) {
  if (item.status !== 'accepted') {
    return interaction.reply({ content: 'This is not in setup.', ephemeral: true });
  }
  const step = queryOne(
    'SELECT item_key, label, done, prereq FROM form_submission_checklist WHERE submission_id = ? AND item_key = ?',
    [item.id, itemKey]);
  if (!step) return interaction.reply({ content: 'That step is no longer on this checklist.', ephemeral: true });

  // The gate is enforced here as well as rendered, because a stale copy of the
  // message can still be clicked. Un-ticking is always allowed — otherwise a
  // step ticked before its prerequisites lapsed could never be corrected.
  if (!step.prereq && !step.done) {
    const blocking = queryOne(
      'SELECT count(*) AS n FROM form_submission_checklist WHERE submission_id = ? AND prereq = 1 AND done = 0',
      [item.id])?.n || 0;
    if (blocking) {
      return interaction.reply({
        content: `The first ${blocking === 1 ? 'step' : `${blocking} steps`} still need doing before this one — joining their Discord, inviting the bot and creating the ECRP roles come first.`,
        ephemeral: true,
      });
    }
  }

  const who = actorName(interaction);
  if (step.done) {
    run('UPDATE form_submission_checklist SET done = 0, done_by_id = NULL, done_by_name = NULL, done_at = NULL WHERE submission_id = ? AND item_key = ?',
      [item.id, itemKey]);
    audit(interaction, 'UNTICK', item.id, `${form.label} — ${item.title}`, step.label);
  } else {
    run('UPDATE form_submission_checklist SET done = 1, done_by_id = ?, done_by_name = ?, done_at = ? WHERE submission_id = ? AND item_key = ?',
      [interaction.user.id, who, nowStr(), item.id, itemKey]);
    audit(interaction, 'TICK', item.id, `${form.label} — ${item.title}`, step.label);
  }
  await interaction.update(checklistView(item, form));
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
  await retitleThread(interaction, item.thread_id, tagsFor(form)[status], { archive: true });
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

const loadItem = (id) => queryOne(
  'SELECT id, form_key, status, title, contact, thread_id FROM form_submissions WHERE id = ?', [id]);

/**
 * How many setup steps are still outstanding. Zero for a form that has no
 * checklist at all, so the single-button forms complete as they always did.
 */
function remainingSteps(item, form) {
  if (form.workflow !== 'decision') return 0;
  return queryOne(
    'SELECT count(*) AS n FROM form_submission_checklist WHERE submission_id = ? AND done = 0',
    [item.id])?.n || 0;
}

/**
 * Redraw an application's checklist message from the database.
 *
 * Every normal tick redraws it in place as part of answering the interaction, so
 * this is for the cases where nothing was pressed: a message edited out of sync,
 * or a state change made outside Discord.
 */
export async function refreshChecklistMessage(id) {
  const item = queryOne('SELECT id, form_key, title, thread_id, checklist_message_id FROM form_submissions WHERE id = ?', [id]);
  const form = item && FORM_BY_KEY[item.form_key];
  if (!form || !item.checklist_message_id) return false;
  await discordPatch(`/channels/${item.thread_id}/messages/${item.checklist_message_id}`, checklistView(item, form));
  return true;
}

/**
 * The reject modal's submission. Routed from index.js like the buttons; the
 * permission and status checks are repeated here because a modal can be
 * submitted long after it was opened, and roles or state may have moved on.
 */
export async function handleFormModal(interaction) {
  const { customId } = interaction;
  if (!customId.startsWith('frmmodal:reject:')) return false;

  const id = parseInt(customId.split(':')[2], 10);
  try {
    const item = loadItem(id);
    if (!item) {
      await interaction.reply({ content: 'This submission no longer exists.', ephemeral: true });
      return true;
    }
    const form = FORM_BY_KEY[item.form_key];
    if (!form || !canAct(interaction, permittedRoleIds(form, 'reject'))) {
      await interaction.reply({ content: 'You can no longer action this.', ephemeral: true });
      return true;
    }
    if (ENDED_STATUSES.includes(item.status) || item.status === 'accepted') {
      await interaction.reply({ content: `This submission is already ${item.status}.`, ephemeral: true });
      return true;
    }
    await handleReject(interaction, item, form, interaction.fields.getTextInputValue('reason').trim());
  } catch (e) {
    console.error('[FORMS] reject modal error:', e.message);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Something went wrong handling that.', ephemeral: true }).catch(() => {});
    }
  }
  return true;
}

/**
 * Route a form button. Returns true if it was one of ours, so index.js can fall
 * through to its other handlers when it isn't.
 */
export async function handleFormButton(interaction) {
  const { customId } = interaction;
  if (!customId.startsWith('frm:')) return false;

  const [, action, rawId, extra] = customId.split(':');
  const id = parseInt(rawId, 10);
  if (!Number.isInteger(id)) return true;

  try {
    const item = loadItem(id);
    if (!item) {
      await interaction.reply({ content: 'This submission no longer exists.', ephemeral: true });
      return true;
    }
    const form = FORM_BY_KEY[item.form_key];
    if (!form) {
      await interaction.reply({ content: 'This submission belongs to a form that is no longer configured.', ephemeral: true });
      return true;
    }
    const allowed = permittedRoleIds(form, action);
    if (!canAct(interaction, allowed)) {
      await interaction.reply({
        content: `Only ${allowedRoleNames(interaction, allowed)} can do that.`,
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

    if (action === 'accept') await handleAccept(interaction, item, form);
    else if (action === 'reject') {
      // The reason is asked for in a modal, so the actual rejection happens on
      // the modal submit — see handleFormModal.
      await interaction.showModal({
        title: 'Reject application',
        customId: `frmmodal:reject:${id}`,
        components: [{ type: 1, components: [{
          type: 4, custom_id: 'reason', label: 'Reason (optional)', style: 2,
          required: false, max_length: 900,
          placeholder: 'Why is this being turned down? Shown in the thread.',
        }] }],
      });
    }
    else if (action === 'tick') await handleTick(interaction, item, form, extra);
    else if (action === 'complete') {
      // The button is rendered disabled until every box is ticked, but a stale
      // message can still be pressed, so the gate is enforced here too.
      const left = remainingSteps(item, form);
      if (left) {
        await interaction.reply({ content: `${left} setup step${left === 1 ? '' : 's'} still to tick before this can be completed.`, ephemeral: true });
        return true;
      }
      await handleEnd(interaction, item, form, 'completed');
    }
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
