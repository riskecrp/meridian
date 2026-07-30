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

// Responses sheet of the ECRP roleplay feedback form (link-viewable, read as
// CSV). The same sheet api/notify links to when a submission arrives.
const SHEET_ID = '1T6d-I_P1Gvr1nyJctk0-LM3xlXEBUNCi3CMM2MWrUoQ';
const SHEET_GID = '1222111670';
const TEAM_VALUE = 'Criminal Faction Management (FM)';

// Column indexes in the responses sheet (0-based). Everything from
// FIRST_QUESTION_COL on is a long-form answer and is posted as its own section,
// so questions can be added to the form without touching this file.
const COL_TIMESTAMP = 0;
const COL_TEAM = 1;
const COL_FACTION = 2;
const COL_CHARACTER = 3;
const COL_DISCORD = 4;
const COL_OCCURRED = 5;
const FIRST_QUESTION_COL = 6;

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

const THREAD_NAME_LIMIT = 100;

// Statuses that end the flow — no more nudges, buttons refuse to act.
const ENDED_STATUSES = ['completed', 'cancelled'];

// Thread-title prefix per status.
const STATUS_TAGS = {
  new: '[Pending Acknowledgement]',   // the submitter has not been told we have it
  claimed: '[Pending Review]',        // submitter contacted, the review is outstanding
  completed: '[Completed]',
  cancelled: '[Cancelled]',
};
// Longest first, so '[Pending Acknowledgement]' is never half-matched by a
// shorter tag when a title is being re-tagged.
const ALL_TAGS = [...new Set(Object.values(STATUS_TAGS))].sort((a, b) => b.length - a.length);

// How a status reads in a sentence, mirroring the dashboard's labels.
const STATUS_LABELS = {
  new: 'waiting for the submitter to be acknowledged',
  claimed: 'awaiting review',
  completed: 'completed',
  cancelled: 'cancelled',
};

// ── Discord REST ───────────────────────────────────────────────────────────────

const API = 'https://discord.com/api/v10';

async function discordFetch(method, path, body) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error('no bot token');
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Discord ${method} ${path} → ${res.status}: ${err.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

const discordPost = (path, body) => discordFetch('POST', path, body);
const discordPatch = (path, body) => discordFetch('PATCH', path, body);

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

// ── Small helpers ──────────────────────────────────────────────────────────────

const nowStr = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const plusHours = (h) => new Date(Date.now() + h * 3600000).toISOString().slice(0, 19).replace('T', ' ');
const plusDays = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 19).replace('T', ' ');

function csvUrl() {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;
}

/** '<tag> <base>', trimming the base so the whole thing fits Discord's limit. */
function titled(base, tag) {
  const room = THREAD_NAME_LIMIT - tag.length - 1;
  return `${tag} ${base.slice(0, room).trimEnd()}`;
}

/** Swap whatever status tag a thread carries now for a new one. */
function retag(name, tag) {
  let base = name;
  for (const t of ALL_TAGS) {
    if (base.startsWith(t + ' ')) { base = base.slice(t.length + 1); break; }
  }
  return titled(base, tag);
}

/** Split long text at newline boundaries so every piece fits one message. */
function chunks(text, limit = 1900) {
  const parts = [];
  let rest = String(text || '').trim();
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < limit / 2) cut = limit;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest) parts.push(rest);
  return parts;
}

/**
 * A minimal CSV reader. Google's export quotes any field containing a comma,
 * newline or quote, and escapes quotes by doubling them — so a submission
 * containing either (they routinely contain both) has to be parsed rather than
 * split on commas.
 */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

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

// ── Sheet polling ──────────────────────────────────────────────────────────────

async function fetchRows() {
  let text;
  try {
    const res = await fetch(csvUrl(), { signal: AbortSignal.timeout(30000) });
    if (!res.ok) { console.error(`[FEEDBACK] sheet fetch HTTP ${res.status}`); return null; }
    text = await res.text();
  } catch (e) {
    console.error('[FEEDBACK] sheet fetch error:', e.message);
    return null;
  }
  // A sheet that has stopped being link-viewable answers with a login page, and
  // parsing that as CSV would look like a sheet that suddenly went empty.
  if (/^\s*<!doc|^\s*<html/i.test(text)) {
    console.error('[FEEDBACK] sheet is not public (got HTML instead of CSV)');
    return null;
  }
  return parseCsv(text);
}

async function pollSheet() {
  const rows = await fetchRows();
  if (!rows || !rows.length) return;
  const header = rows[0];
  const data = rows.slice(1);

  const state = queryOne('SELECT last_row, initialized FROM faction_feedback_state WHERE id = 1');
  if (!state) return;
  if (!state.initialized) {
    // First run: everything already in the sheet is history. Those rows predate
    // the feature and would otherwise arrive as a wall of threads, each with its
    // own ping and its own 48-hour nudge cycle.
    run('UPDATE faction_feedback_state SET last_row = ?, initialized = 1 WHERE id = 1', [data.length]);
    console.log(`[FEEDBACK] initialised at row ${data.length}; watching for new submissions`);
    return;
  }

  for (let idx = state.last_row; idx < data.length; idx++) {
    const row = data[idx];
    const sheetRow = idx + 2;   // 1-based, plus the header
    try {
      if ((row[COL_TEAM] || '').trim() === TEAM_VALUE) {
        await postFeedback(header, row, sheetRow);
      }
    } catch (e) {
      const attempts = recordFailure(sheetRow, e);
      if (attempts < MAX_POST_ATTEMPTS) {
        // Probably transient. Stop WITHOUT advancing, so this row is retried next
        // cycle and submissions keep arriving in the order they were sent.
        console.error(`[FEEDBACK] row ${sheetRow} attempt ${attempts}/${MAX_POST_ATTEMPTS} failed, retrying next cycle:`, e.message);
        return;
      }
      // Out of retries. Advance past it so everything queued behind it can still
      // post; the failure row stays behind for visibility.
      run('UPDATE faction_feedback_failures SET skipped = 1 WHERE sheet_row = ?', [sheetRow]);
      console.error(`[FEEDBACK] row ${sheetRow} failed ${attempts}x — SKIPPING so the queue can drain. Not posted:`, e.message);
    }
    run('UPDATE faction_feedback_state SET last_row = ? WHERE id = 1', [idx + 1]);
  }
}

/**
 * Bump the attempt counter for a sheet row and return the new count. A database
 * problem here must not itself decide a row's fate, so a failure to record
 * reports attempt 1 — which retries rather than skips.
 */
function recordFailure(sheetRow, err) {
  const message = `${err.name || 'Error'}: ${err.message}`.slice(0, 300);
  try {
    run(
      `INSERT INTO faction_feedback_failures (sheet_row, attempts, first_failed_at, last_failed_at, last_error)
       VALUES (?, 1, ?, ?, ?)
       ON CONFLICT(sheet_row) DO UPDATE SET
         attempts = attempts + 1, last_failed_at = excluded.last_failed_at, last_error = excluded.last_error`,
      [sheetRow, nowStr(), nowStr(), message],
    );
    return queryOne('SELECT attempts FROM faction_feedback_failures WHERE sheet_row = ?', [sheetRow])?.attempts || 1;
  } catch (e) {
    console.error(`[FEEDBACK] could not record failure for row ${sheetRow}:`, e.message);
    return 1;
  }
}

async function postFeedback(header, row, sheetRow) {
  const col = (i) => (i < row.length ? String(row[i] || '').trim() : '');
  const faction = col(COL_FACTION) || 'Unknown faction';
  const character = col(COL_CHARACTER) || 'Unknown';
  const submitter = col(COL_DISCORD) || 'not provided';

  const payload = {};
  for (let i = 0; i < Math.min(header.length, row.length); i++) payload[header[i]] = row[i];

  // Claim the row BEFORE touching Discord. sheet_row is UNIQUE, so a retry after
  // a half-finished post finds this record and resumes rather than opening a
  // second thread and then dying on the constraint. ack_message_id is written
  // last and checked first, so it doubles as the "posted in full" marker.
  const existing = queryOne('SELECT id, thread_id, ack_message_id FROM faction_feedback WHERE sheet_row = ?', [sheetRow]);
  if (existing?.ack_message_id) return;

  let feedbackId, threadId;
  if (existing) {
    feedbackId = existing.id;
    threadId = existing.thread_id;
    console.log(`[FEEDBACK] resuming partially posted row ${sheetRow} (#${feedbackId})`);
  } else {
    const res = run(
      `INSERT INTO faction_feedback (sheet_row, faction, character_name, discord_username, occurred,
         submitted_at, payload, thread_id, due_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      [sheetRow, faction, character, submitter, col(COL_OCCURRED), col(COL_TIMESTAMP),
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
      `**When did this occur?** ${col(COL_OCCURRED) || 'not provided'}`,
      `**Submitted:** ${col(COL_TIMESTAMP)}`,
    ].filter(Boolean).join('\n'),
    allowed_mentions: allowedMentions('feedback.new'),
  });

  // One section per long-form question, split to fit the message limit. The
  // zero-width space opens each section with a visible blank line.
  for (let i = FIRST_QUESTION_COL; i < header.length; i++) {
    const question = String(header[i] || '').trim();
    const answer = col(i);
    if (!question || !answer || SKIP_QUESTION.test(question)) continue;
    const parts = chunks(answer);
    for (let n = 0; n < parts.length; n++) {
      await discordPost(`/channels/${threadId}/messages`, {
        content: (n === 0 ? `​\n**${question}**\n` : '') + parts[n],
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
  run('DELETE FROM faction_feedback_failures WHERE sheet_row = ?', [sheetRow]);
}

// ── Nudges ─────────────────────────────────────────────────────────────────────

async function checkReminders() {
  if (!pingEnabled('feedback.nudge')) return;

  const due = query(
    `SELECT id, thread_id, faction, character_name, status FROM faction_feedback
     WHERE status NOT IN ('completed', 'cancelled')
       AND thread_id IS NOT NULL
       AND due_at <= ?
       AND (last_reminder_at IS NULL OR last_reminder_at < due_at)`,
    [nowStr()],
  );

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
      // One unreachable thread must not stop the others being chased.
      console.error(`[FEEDBACK] nudge for #${item.id} failed:`, e.message);
      continue;
    }
    // Roll the due date forward rather than only stamping the reminder, so an
    // item that stays open keeps being chased on the same cadence.
    run('UPDATE faction_feedback SET last_reminder_at = ?, due_at = ? WHERE id = ?',
      [nowStr(), plusHours(REMINDER_HOURS), item.id]);
  }
}

// ── Button handling (called from index.js) ─────────────────────────────────────

/**
 * Who may work feedback: FM Team Leads, FM Leadership and Game Affairs
 * Management — the same three roles the pings go to. Read from discord_roles so
 * a role being re-created in Discord is a database edit, not a redeploy.
 *
 * This is checked on every press. A component interaction carries no command
 * permissions with it, so nothing else stands between a random member and these
 * buttons.
 */
function canAct(interaction) {
  const allowed = query(
    "SELECT role_id FROM discord_roles WHERE key IN ('fm_team_lead', 'fm_leadership', 'game_affairs')",
  ).map((r) => r.role_id).filter(Boolean);
  const held = interaction.member?.roles?.cache;
  return !!held && allowed.some((id) => held.has(id));
}

const actorName = (interaction) => interaction.member?.displayName
  || interaction.user.globalName || interaction.user.username;

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
    console.error(`[FEEDBACK] retitle ${id} failed:`, e.message);
  }
}

async function handleDone(interaction, id) {
  const row = queryOne('SELECT status, claimed_by_name, discord_username, faction, character_name, thread_id FROM faction_feedback WHERE id = ?', [id]);
  if (!row) return interaction.reply({ content: 'This feedback record no longer exists.', ephemeral: true });
  if (ENDED_STATUSES.includes(row.status)) return interaction.reply({ content: `This feedback is already ${row.status}.`, ephemeral: true });
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
  const row = queryOne('SELECT status, faction, character_name, thread_id FROM faction_feedback WHERE id = ?', [id]);
  if (!row) return interaction.reply({ content: 'This feedback record no longer exists.', ephemeral: true });
  if (ENDED_STATUSES.includes(row.status)) return interaction.reply({ content: `Already ${row.status}.`, ephemeral: true });

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
    components: [],
  });
  await retitleThread(interaction, row.thread_id, STATUS_TAGS[status], { archive: true });
}

async function handleSnooze(interaction, id) {
  const row = queryOne('SELECT status, faction, character_name FROM faction_feedback WHERE id = ?', [id]);
  if (!row) return interaction.reply({ content: 'This feedback record no longer exists.', ephemeral: true });
  if (ENDED_STATUSES.includes(row.status)) return interaction.reply({ content: `Already ${row.status}.`, ephemeral: true });

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
 * Route a feedback button. Returns true if it was one of ours, so index.js can
 * fall through to its other handlers when it isn't.
 */
export async function handleFeedbackButton(interaction) {
  const { customId } = interaction;
  if (!customId.startsWith('fbk:')) return false;

  const [, action, rawId] = customId.split(':');
  const id = parseInt(rawId, 10);
  if (!Number.isInteger(id)) return true;

  if (!canAct(interaction)) {
    await interaction.reply({
      content: 'Only FM Team Leads, FM Leadership and Game Affairs Management can work feedback.',
      ephemeral: true,
    });
    return true;
  }

  try {
    if (action === 'done') await handleDone(interaction, id);
    else if (action === 'complete') await handleEnd(interaction, id, 'completed');
    else if (action === 'cancel') await handleEnd(interaction, id, 'cancelled');
    else if (action === 'snooze') await handleSnooze(interaction, id);
  } catch (e) {
    console.error('[FEEDBACK] button error:', e.message);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Something went wrong handling that.', ephemeral: true }).catch(() => {});
    }
  }
  return true;
}

// ── Start ──────────────────────────────────────────────────────────────────────

export function startFactionFeedback() {
  cron.schedule('*/15 * * * *', () => {
    pollSheet().catch((e) => console.error('[FEEDBACK] poll error:', e.message));
  }, { timezone: 'UTC' });

  cron.schedule('*/30 * * * *', () => {
    checkReminders().catch((e) => console.error('[FEEDBACK] reminder error:', e.message));
  }, { timezone: 'UTC' });

  // Read the sheet once on boot as well, so a restart picks up anything that
  // arrived while the bot was down instead of waiting out the cron interval.
  pollSheet().catch((e) => console.error('[FEEDBACK] initial poll error:', e.message));

  console.log(`[FEEDBACK] Faction feedback intake running — sheet every 15m, nudges every ${REMINDER_HOURS}h.`);
}
