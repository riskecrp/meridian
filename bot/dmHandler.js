/**
 * DM Task Handler
 * Lets FM staff who opted in (staff.dm_tracking_enabled) create and manage
 * tasks by DMing the bot, and stores forwarded messages for the dashboard inbox.
 *
 * Commands (all case-insensitive):
 *   task [description]              → create task for FM Leadership (default)
 *   task leads | [description]      → create task for Team Leads
 *   task all | [description]        → create task for All FM staff
 *   task me | [description]         → create task assigned to yourself
 *   task @name | [description]      → create task for a specific staff member
 *   tasks                           → list your open tasks
 *   done [uid]                      → mark a task complete
 *   claim [uid]                     → claim a task
 *   help                            → show this list
 *
 * Every task write goes through shared/tasks.js (same rules, audit rows and
 * pings as the dashboard and the buttons); the database is the shared
 * connection (DATABASE_PATH), not a private one on a hardcoded path.
 */
import { queryOne, run } from './lib/db.js';
import { getRole } from './lib/pings.js';
import { actorFromDiscord } from '../shared/actor.js';
import { createTask, completeTask, claimTask, visibleTasks, decorate, getTask } from '../shared/tasks.js';
import { nowIso, parseDate } from '../shared/dates.js';

function isAuthorized(discordId) {
  return queryOne("SELECT dm_tracking_enabled FROM staff WHERE discord_id = ?", [discordId])?.dm_tracking_enabled === 1;
}

function formatDate(value) {
  const d = parseDate(value);
  return d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

// ── Target resolution ────────────────────────────────────────────────────────

function resolveTarget(raw, actorId) {
  if (!raw) return { id: getRole('fm_leadership'), type: 'Role', label: 'FM Leadership' };
  const r = raw.trim().toLowerCase();
  if (r === 'me')                                   return { id: actorId, type: 'User', label: 'yourself' };
  if (r === 'leads' || r === 'team leads')          return { id: getRole('fm_team_lead'), type: 'Role', label: 'Team Leads' };
  if (r === 'all' || r === 'all fm')                return { id: getRole('fm_team_guide'), type: 'Role', label: 'All FM' };
  if (r === 'leadership' || r === 'fm leadership')  return { id: getRole('fm_leadership'), type: 'Role', label: 'FM Leadership' };
  const staff = queryOne("SELECT discord_id, display_name FROM staff WHERE lower(display_name) LIKE ? AND discord_id NOT LIKE 'placeholder%' AND COALESCE(active, 1) = 1 ORDER BY length(display_name) LIMIT 1", [`%${r}%`]);
  if (staff) return { id: staff.discord_id, type: 'User', label: staff.display_name };
  return null;
}

/** Exact uid, or an unambiguous prefix among the tasks this actor can see. */
function resolveUid(actor, input) {
  const id = String(input || '').trim();
  if (!id) return null;
  if (getTask(id)) return id;
  const hits = visibleTasks(actor).filter(t => t.task_uid.startsWith(id));
  return hits.length === 1 ? hits[0].task_uid : null;
}

// ── Main handler ─────────────────────────────────────────────────────────────

const HELP = `**Meridian Task Bot — DM Commands**

\`task [description]\`
  Create a task for **FM Leadership** (default target).

\`task leads | [description]\`
\`task all | [description]\`
\`task me | [description]\`
\`task [name] | [description]\`
  Create a task for a specific target.

\`tasks\`
  List the open tasks you can see.

\`claim [id]\`
  Claim a task by its id (or its first characters).

\`done [id]\`
  Mark a task complete by its id (or its first characters).

\`help\`
  Show this message.`;

export async function handleDM(message) {
  // Discord's "forward" feature sends empty content with messageSnapshots
  let content = message.content?.trim();
  let isForward = false;

  if (!content && message.messageSnapshots?.size > 0) {
    const snapshot = message.messageSnapshots.first();
    content = (snapshot?.content ?? snapshot?.message?.content ?? '').trim();
    if (content) isForward = true;
    else {
      for (const [, s] of message.messageSnapshots) {
        const c = (s?.content ?? s?.message?.content ?? '').trim();
        if (c) { content = c; isForward = true; break; }
      }
    }
  }

  if (!content) return;

  // Forwarded message — store it in forwarded_dms for the dashboard
  if (isForward) {
    const msgId = message.id || String(Date.now());
    const snapshot = message.messageSnapshots?.first();
    const authorId = snapshot?.author?.id ?? snapshot?.message?.author?.id ?? 'unknown';
    const authorName = snapshot?.author?.username ?? snapshot?.message?.author?.username ?? 'Unknown';
    const sourceChannelId = snapshot?.channelId ?? snapshot?.message?.channelId ?? '';
    const sourceMessageId = snapshot?.id ?? snapshot?.message?.id ?? '';
    try {
      run(`INSERT OR IGNORE INTO forwarded_dms (message_id, author_id, author_name, content, source_channel, source_channel_id, source_message_id, target_user_id, forwarded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [msgId, authorId, authorName, content, 'DM Forward', sourceChannelId, sourceMessageId, message.author.id, nowIso()]);
      console.log(`[DM] Stored forward from ${authorName} — channel ${sourceChannelId} msg ${sourceMessageId}`);
      await message.reply(`✅ Logged to your dashboard.\n> ${content.slice(0, 200)}`);
    } catch (e) {
      console.error('[DM] forward store failed:', e.message);
      await message.reply('❌ Could not store that message.').catch(() => {});
    }
    return;
  }

  if (!isAuthorized(message.author.id)) return;
  console.log(`[DM] Received from ${message.author.id} — content: "${message.content?.slice(0, 80)}" snapshots: ${message.messageSnapshots?.size ?? 0}`);

  const actor = actorFromDiscord(message.author.id, message.author.globalName || message.author.username);
  if (!actor) {
    await message.reply('Could not find your staff record.');
    return;
  }

  const lower = content.toLowerCase();

  if (lower === 'help') { await message.reply(HELP); return; }

  // ── tasks (list) ──
  if (lower === 'tasks' || lower === 'task list') {
    const rows = visibleTasks(actor).map(decorate).slice(0, 10);
    if (!rows.length) { await message.reply('No open tasks found.'); return; }
    const lines = rows.map(t =>
      `\`${t.task_uid}\` **${t.description.slice(0, 80)}**\n  → ${t.targetLabel}${t.claimed_by && t.claimed_by !== 'None' ? ` · claimed by ${t.claimerName}` : ''} · ${formatDate(t.created_at)}`);
    await message.reply(`**Open Tasks (${rows.length})**\n\n${lines.join('\n\n')}`);
    return;
  }

  const needsWrite = lower.startsWith('done ') || lower.startsWith('claim ') || lower.startsWith('task ') || lower === 'task';
  if (needsWrite && actor.level < 1) {
    await message.reply('❌ Creating, claiming or completing tasks needs FM clearance (L1+); your access is read-only.');
    return;
  }

  // ── done [uid] ──
  if (lower.startsWith('done ')) {
    const uid = resolveUid(actor, content.slice(5));
    if (!uid) { await message.reply(`❌ No task found with ID \`${content.slice(5).trim()}\`. Send \`tasks\` to list the ids you can see.`); return; }
    const r = await completeTask(actor, uid, '', { via: 'DM' });
    if (!r.ok) await message.reply(`❌ ${r.error}`);
    else await message.reply(`✅ Marked complete: **${getTask(uid)?.description.slice(0, 100) || uid}**`);
    return;
  }

  // ── claim [uid] ──
  if (lower.startsWith('claim ')) {
    const uid = resolveUid(actor, content.slice(6));
    if (!uid) { await message.reply(`❌ No task found with ID \`${content.slice(6).trim()}\`. Send \`tasks\` to list the ids you can see.`); return; }
    const r = await claimTask(actor, uid, { via: 'DM' });
    if (!r.ok) await message.reply(`❌ ${r.error}`);
    else await message.reply(`✋ Claimed: **${getTask(uid)?.description.slice(0, 100) || uid}**`);
    return;
  }

  // ── task ... ──
  if (lower.startsWith('task ') || lower === 'task') {
    const body = content.slice(5).trim();
    if (!body) {
      await message.reply('Usage: `task [description]` or `task [target] | [description]`\nType `help` for all commands.');
      return;
    }
    let targetRaw = null;
    let description = body;
    if (body.includes('|')) {
      const idx = body.indexOf('|');
      targetRaw = body.slice(0, idx).trim();
      description = body.slice(idx + 1).trim();
    }
    if (!description) { await message.reply('Please include a description after the `|`.'); return; }

    const target = resolveTarget(targetRaw, actor.id);
    if (!target) {
      await message.reply(`❌ Could not find a target matching \`${targetRaw}\`. Try \`leads\`, \`all\`, \`me\`, or a staff name.`);
      return;
    }
    const r = await createTask(actor, { desc: description, targetType: target.type, targetId: target.id }, { via: 'DM' });
    if (!r.ok) await message.reply(`❌ Failed to create task: ${r.error}`);
    else await message.reply(`✅ Task created for **${target.label}**\n> ${description}\n\nID: \`${r.uid}\``);
    return;
  }

  await message.reply('Unknown command. Type `help` for the command list.');
}
