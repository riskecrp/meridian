/**
 * DM Task Handler
 * Allows FM Leadership to create and manage tasks via Discord DMs to the bot.
 *
 * Commands (all case-insensitive):
 *   task [description]              → create task for FM Leadership (default)
 *   task leads | [description]      → create task for Team Leads
 *   task all | [description]        → create task for All FM staff
 *   task me | [description]         → create task assigned to yourself
 *   task @name | [description]      → create task for a specific staff member
 *   tasks                           → list your open tasks
 *   done [uid]                      → mark a task complete
 *   help                            → show this list
 */

import Database from 'better-sqlite3';

const DB_PATH = '/opt/meridian/data/meridian.db';

const ROLE_LEADERSHIP = '1457670376745074730';
const ROLE_LEADS      = '1457215385139941456';
const ROLE_ALL_FM     = '1457229857749729363';

function isAuthorized(discordId) {
  const d = db();
  try {
    const row = d.prepare("SELECT dm_tracking_enabled FROM staff WHERE discord_id = ?").get(discordId);
    return row?.dm_tracking_enabled === 1;
  } finally { d.close(); }
}

function db() {
  const d = new Database(DB_PATH);
  d.pragma('journal_mode = WAL');
  d.pragma('busy_timeout = 5000');
  return d;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Auth ────────────────────────────────────────────────────────────────────

function getActor(discordId) {
  const d = db();
  const row = d.prepare(
    "SELECT discord_id, display_name, clearance, team_id FROM staff WHERE discord_id = ? AND discord_id NOT LIKE 'placeholder%'"
  ).get(discordId);
  d.close();
  return row || null;
}

// ── Task helpers ─────────────────────────────────────────────────────────────

function resolveTarget(raw, actorId, d) {
  if (!raw) return { id: ROLE_LEADERSHIP, type: 'Role', label: 'FM Leadership' };

  const r = raw.trim().toLowerCase();

  if (r === 'me')                              return { id: actorId,        type: 'User', label: 'yourself'      };
  if (r === 'leads' || r === 'team leads')     return { id: ROLE_LEADS,     type: 'Role', label: 'Team Leads'    };
  if (r === 'all'   || r === 'all fm')         return { id: ROLE_ALL_FM,    type: 'Role', label: 'All FM'        };
  if (r === 'leadership' || r === 'fm leadership') return { id: ROLE_LEADERSHIP, type: 'Role', label: 'FM Leadership' };

  // Try to match a staff member by name
  const staff = d.prepare(
    "SELECT discord_id, display_name FROM staff WHERE lower(display_name) LIKE ? AND discord_id NOT LIKE 'placeholder%' LIMIT 1"
  ).get(`%${r}%`);
  if (staff) return { id: staff.discord_id, type: 'User', label: staff.display_name };

  return null;
}

function createTask(actor, targetId, targetType, targetLabel, description) {
  const d = db();
  try {
    const taskId  = uid();
    const now     = new Date().toISOString();
    const selfAssign = targetType === 'User' && targetId === actor.discord_id;
    // notify_creator: 1 if creator can't see the destination (non-leadership creating leadership task)
    const notify  = (!selfAssign && targetId === ROLE_LEADERSHIP && actor.clearance < 3) ? 1 : 0;

    d.prepare(
      `INSERT INTO tasks (task_uid, description, target_id, target_type, claimed_by,
        created_by_id, created_by_name, next_reminder, created_at, notify_creator)
       VALUES (?, ?, ?, ?, 'None', ?, ?, NULL, ?, ?)`
    ).run(taskId, description, targetId, targetType, actor.discord_id, actor.display_name, now, notify);

    d.prepare(
      `INSERT INTO task_log (action, actor, task_uid, description, target, created_at)
       VALUES ('CREATED', ?, ?, ?, ?, ?)`
    ).run(actor.display_name, taskId, description, `${targetType}: ${targetId}`, now);

    return { ok: true, uid: taskId, label: targetLabel };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    d.close();
  }
}

function listOpenTasks(actorId) {
  const d = db();
  try {
    const rows = d.prepare(`
      SELECT task_uid, description, target_type, target_id, claimed_by, created_at
      FROM tasks
      WHERE (created_by_id = ? OR target_id = ? OR (target_type = 'Role' AND target_id = ?))
        AND task_uid NOT IN (SELECT task_uid FROM task_log WHERE action = 'COMPLETED')
      ORDER BY created_at DESC
      LIMIT 10
    `).all(actorId, actorId, ROLE_LEADERSHIP);
    return rows;
  } finally {
    d.close();
  }
}

function completeTask(uid, actorId, actorName) {
  const d = db();
  try {
    const task = d.prepare("SELECT task_uid, description FROM tasks WHERE task_uid = ?").get(uid);
    if (!task) return { ok: false, error: `No task found with ID \`${uid}\`.` };

    const already = d.prepare("SELECT 1 FROM task_log WHERE task_uid = ? AND action = 'COMPLETED'").get(uid);
    if (already) return { ok: false, error: 'That task is already marked complete.' };

    const now = new Date().toISOString();
    d.prepare(
      `INSERT INTO task_log (action, actor, task_uid, description, target, created_at)
       VALUES ('COMPLETED', ?, ?, ?, 'Completed via DM', ?)`
    ).run(actorName, uid, task.description, now);

    return { ok: true, description: task.description };
  } finally {
    d.close();
  }
}

// ── Target label lookup for list display ─────────────────────────────────────

function labelFor(type, id) {
  if (type === 'Role') {
    if (id === ROLE_LEADERSHIP) return 'FM Leadership';
    if (id === ROLE_LEADS)      return 'Team Leads';
    if (id === ROLE_ALL_FM)     return 'All FM';
    return 'Role';
  }
  const d = db();
  try {
    const s = d.prepare("SELECT display_name FROM staff WHERE discord_id = ?").get(id);
    return s?.display_name || 'User';
  } finally { d.close(); }
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
  List your 10 most recent open tasks.

\`done [id]\`
  Mark a task complete by its short ID.

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
      // Try iterating the collection entries
      for (const [, s] of message.messageSnapshots) {
        const c = (s?.content ?? s?.message?.content ?? '').trim();
        if (c) { content = c; isForward = true; break; }
      }
    }
  }

  if (!content) return;

  // Forwarded message — store it in forwarded_dms for the dashboard
  if (isForward) {
    const d = db();
    try {
      const msgId    = message.id || Date.now().toString();
      const snapshot = message.messageSnapshots?.first();

      // Pull author info from snapshot
      const authorId   = snapshot?.author?.id       ?? snapshot?.message?.author?.id   ?? 'unknown';
      const authorName = snapshot?.author?.username  ?? snapshot?.message?.author?.username ?? 'Unknown';

      // Original channel + message for the "jump back" link
      const sourceChannelId = snapshot?.channelId ?? snapshot?.message?.channelId ?? '';
      const sourceMessageId = snapshot?.id        ?? snapshot?.message?.id        ?? '';

      d.prepare(
        `INSERT OR IGNORE INTO forwarded_dms
           (message_id, author_id, author_name, content, source_channel, source_channel_id, source_message_id, target_user_id, forwarded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(msgId, authorId, authorName, content, 'DM Forward', sourceChannelId, sourceMessageId, message.author.id, new Date().toISOString());

      console.log(`[DM] Stored forward from ${authorName} — channel ${sourceChannelId} msg ${sourceMessageId}`);
      await message.reply(`✅ Logged to your dashboard.\n> ${content.slice(0, 200)}`);
    } finally {
      d.close();
    }
    return;
  }

  if (!isAuthorized(message.author.id)) return;
  console.log(`[DM] Received from ${message.author.id} — content: "${message.content?.slice(0,80)}" snapshots: ${message.messageSnapshots?.size ?? 0}`);

  const actor = getActor(message.author.id);
  if (!actor) {
    await message.reply('Could not find your staff record.');
    return;
  }

  const lower = content.toLowerCase();

  // ── help ──
  if (lower === 'help') {
    await message.reply(HELP);
    return;
  }

  // ── tasks (list) ──
  if (lower === 'tasks' || lower === 'task list') {
    const rows = listOpenTasks(actor.discord_id);
    if (!rows.length) {
      await message.reply('No open tasks found.');
      return;
    }
    const lines = rows.map(t => {
      const target  = labelFor(t.target_type, t.target_id);
      const claimed = t.claimed_by && t.claimed_by !== 'None' ? ` · claimed` : '';
      return `\`${t.task_uid}\` **${t.description.slice(0, 80)}**\n  → ${target}${claimed} · ${formatDate(t.created_at)}`;
    });
    await message.reply(`**Open Tasks (${rows.length})**\n\n${lines.join('\n\n')}`);
    return;
  }

  // ── done [uid] ──
  if (lower.startsWith('done ')) {
    const taskUid = content.slice(5).trim();
    const result  = completeTask(taskUid, actor.discord_id, actor.display_name);
    if (!result.ok) {
      await message.reply(`❌ ${result.error}`);
    } else {
      await message.reply(`✅ Marked complete: **${result.description.slice(0, 100)}**`);
    }
    return;
  }

  // ── task ... ──
  if (lower.startsWith('task ') || lower === 'task') {
    const body = content.slice(5).trim();
    if (!body) {
      await message.reply('Usage: `task [description]` or `task [target] | [description]`\nType `help` for all commands.');
      return;
    }

    let targetRaw   = null;
    let description = body;

    if (body.includes('|')) {
      const idx    = body.indexOf('|');
      targetRaw    = body.slice(0, idx).trim();
      description  = body.slice(idx + 1).trim();
    }

    if (!description) {
      await message.reply('Please include a description after the `|`.');
      return;
    }

    const d      = db();
    const target = resolveTarget(targetRaw, actor.discord_id, d);
    d.close();

    if (!target) {
      await message.reply(`❌ Could not find a target matching \`${targetRaw}\`. Try \`leads\`, \`all\`, \`me\`, or a staff name.`);
      return;
    }

    const result = createTask(actor, target.id, target.type, target.label, description);
    if (!result.ok) {
      await message.reply(`❌ Failed to create task: ${result.error}`);
    } else {
      await message.reply(`✅ Task created for **${target.label}**\n> ${description}\n\nID: \`${result.uid}\``);
    }
    return;
  }

  // Unknown command
  await message.reply('Unknown command. Type `help` for the command list.');
}
