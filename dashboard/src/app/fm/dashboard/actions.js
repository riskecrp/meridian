"use server";
import { query, queryOne, run } from "../../../lib/db.js";
import { logAudit } from "../../../lib/audit.js";
import { getChannel, getRole } from "../../../lib/discord.js";
import { sendPing, pingChannel } from "../../../lib/pings.js";
import { requireActor } from "../../../lib/requireActor.js";

// Returns ALL tasks visible to the current user.
// No discordId or level params — derived server-side from the session.

// Returns true if the task target should be routed to the leadership/management channel.
// Covers: FM Leadership role, Game Affairs role, OR any individual User with rank='Management'.
function _routesToLeadership(targetType, targetId) {
  if (targetType === 'Role') {
    const leadershipRoleId = getRole('fm_leadership');
    const gameAffairsId = getRole('game_affairs');
    return targetId === leadershipRoleId || targetId === gameAffairsId;
  }
  if (targetType === 'User') {
    const s = queryOne("SELECT rank FROM staff WHERE discord_id = ?", [targetId]);
    return (s?.rank || '').toLowerCase().includes('management');
  }
  return false;
}

// True when a creator notification should take the confidentiality branch of its
// route: the creator is Leadership AND the target routes to leadership, so the
// ping can go to the private channel without hiding it from them.
function _creatorRoutesAlt(createdById, currentTargetType, currentTargetId) {
  if (!createdById) return false;
  const staff = queryOne("SELECT rank FROM staff WHERE discord_id = ?", [createdById]);
  const rank = (staff?.rank || '').toLowerCase();
  if (!rank.includes('management')) return false;
  return _routesToLeadership(currentTargetType, currentTargetId);
}


export async function getMyTasks() {
  const actor = await requireActor(1, {allowEventTeam: true});
  const discordId = actor.id;
  const level = actor.level;

  const staff = queryOne("SELECT team_id FROM staff WHERE discord_id = ?", [discordId]);
  const teamId = staff?.team_id || '';

  const leadershipRoleId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_leadership'")?.role_id || '';
  const gameAffairsRoleId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'game_affairs'")?.role_id || '';
  const leadRoleId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_team_lead'")?.role_id || '';
  const allFmRoleId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_team_guide'")?.role_id || '';

  const allTasks = query("SELECT * FROM tasks ORDER BY created_at DESC");

  const visible = allTasks.filter(t => {
    if (t.target_type === 'User' && t.target_id === discordId) return true;
    if (t.claimed_by === discordId) return true;
    if (t.target_type === 'Role') {
      if (t.target_id === teamId) return true;
      if (t.target_id === allFmRoleId) return true;
      if (level >= 2 && t.target_id === leadRoleId) return true;
      if (level >= 3 && (t.target_id === leadershipRoleId || t.target_id === gameAffairsRoleId)) return true;
    }
    return false;
  }).map(t => {
    const claimer = (t.claimed_by !== 'None' && t.claimed_by) ? (queryOne("SELECT display_name FROM staff WHERE discord_id = ?", [t.claimed_by])?.display_name || t.claimed_by) : 'Unclaimed';

    let targetLabel = '';
    if (t.target_type === 'User') {
      targetLabel = queryOne("SELECT display_name FROM staff WHERE discord_id = ?", [t.target_id])?.display_name || 'User';
    } else if (t.target_type === 'Role') {
      if (t.target_id === leadershipRoleId) targetLabel = 'FM Leadership';
      else if (t.target_id === gameAffairsRoleId) targetLabel = 'Game Affairs';
      else if (t.target_id === leadRoleId) targetLabel = 'Team Leads';
      else if (t.target_id === allFmRoleId) targetLabel = 'All FM';
      else {
        const team = queryOne("SELECT team_name FROM staff WHERE team_id = ? LIMIT 1", [t.target_id]);
        targetLabel = team?.team_name ? `Team ${team.team_name}` : 'Role';
      }
    }

    return { ...t, claimerName: claimer, targetLabel };
  });

  const assignedToMe = visible.filter(t =>
    (t.target_type === 'User' && t.target_id === discordId) ||
    t.claimed_by === discordId
  );
  const forMyTeam = visible.filter(t =>
    !(t.target_type === 'User' && t.target_id === discordId) &&
    t.claimed_by !== discordId
  );

  return { assignedToMe, forMyTeam };
}

export async function getMyReminders() {
  const actor = await requireActor(1, {allowEventTeam: true});
  const discordId = actor.id;
  const level = actor.level;

  const staff = queryOne("SELECT team_id FROM staff WHERE discord_id = ?", [discordId]);
  const teamId = staff?.team_id || '';

  const leadershipRoleId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_leadership'")?.role_id || '';
  const gameAffairsRoleId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'game_affairs'")?.role_id || '';
  const leadRoleId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_team_lead'")?.role_id || '';
  const allFmRoleId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_team_guide'")?.role_id || '';

  const all = query("SELECT * FROM reminders WHERE status IN ('ACTIVE','WARNED') ORDER BY epoch_ms");
  return all.filter(r => {
    if (r.author_id === discordId) return true;
    const userMatch = r.target_tag?.match(/<@(\d+)>/);
    const roleMatch = r.target_tag?.match(/<@&(\d+)>/);
    if (userMatch && userMatch[1] === discordId) return true;
    if (roleMatch) {
      const rid = roleMatch[1];
      if (rid === teamId) return true;
      if (rid === allFmRoleId) return true;
      if (level >= 2 && rid === leadRoleId) return true;
      if (level >= 3 && (rid === leadershipRoleId || rid === gameAffairsRoleId)) return true;
    }
    return false;
  }).map(r => {
    const authorStaff = queryOne("SELECT display_name FROM staff WHERE discord_id = ?", [r.author_id]);
    return { ...r, authorName: authorStaff?.display_name || r.author_id, epochMs: parseInt(r.epoch_ms) };
  });
}

// ── ACTIONS ──
export async function claimMyTask(taskUid) {
  const actor = await requireActor(1, {allowEventTeam: true});
  const task = queryOne("SELECT description, created_by_id, notify_creator FROM tasks WHERE task_uid = ?", [taskUid]);
  run("UPDATE tasks SET claimed_by = ? WHERE task_uid = ?", [actor.id, taskUid]);
  run("INSERT INTO task_log (action, actor, task_uid, description, target, created_at) VALUES ('CLAIMED', ?, ?, '', 'Claimed', ?)",
    [actor.name + ' (' + actor.id + ')', taskUid, new Date().toISOString()]);
  logAudit(actor.id, actor.name, 'EDIT', 'task', null, taskUid, 'Claimed');
  if (task && task.created_by_id && task.created_by_id !== actor.id) {
    const _t2 = queryOne("SELECT target_type, target_id FROM tasks WHERE task_uid = ?", [taskUid]);
    const _alt = _creatorRoutesAlt(task.created_by_id, _t2?.target_type, _t2?.target_id);
    await sendPing('task.claimed.creator', '🤚 <@' + task.created_by_id + '> — **' + actor.name + '** claimed a task you assigned.\n📋 https://ecrpfm.com/fm/tasks/' + taskUid, { alt: _alt });
  }
  return { ok: true };
}

export async function unclaimMyTask(taskUid, note) {
  const actor = await requireActor(1, {allowEventTeam: true});
  const task = queryOne("SELECT description, claimed_by, created_by_id, notify_creator FROM tasks WHERE task_uid = ?", [taskUid]);
  if (!task) return { ok: false, error: "Task not found" };
  if (task.claimed_by === 'None' || !task.claimed_by) return { ok: false, error: "Task is not claimed" };
  if (task.claimed_by !== actor.id && actor.level < 3) {
    return { ok: false, error: "Only the claimer or L3 can unclaim a task" };
  }
  run("UPDATE tasks SET claimed_by = 'None' WHERE task_uid = ?", [taskUid]);
  run("INSERT INTO task_log (action, actor, task_uid, description, target, created_at) VALUES ('UNCLAIMED', ?, ?, ?, 'Unclaimed', ?)",
    [actor.name, taskUid, task.description || '', new Date().toISOString()]);
  logAudit(actor.id, actor.name, 'EDIT', 'task', null, taskUid, 'Unclaimed');
  if (task.created_by_id && task.created_by_id !== actor.id) {
    const _t2 = queryOne("SELECT target_type, target_id FROM tasks WHERE task_uid = ?", [taskUid]);
    const _alt = _creatorRoutesAlt(task.created_by_id, _t2?.target_type, _t2?.target_id);
    await sendPing('task.unclaimed.creator', '↩️ <@' + task.created_by_id + '> — **' + actor.name + '** released a task you assigned — it\'s open again.' + (note ? '\n**Note:** ' + note : '') + '\n📋 https://ecrpfm.com/fm/tasks/' + taskUid, { alt: _alt });
  }
  return { ok: true };
}


export async function requestTaskInfo(taskUid, question) {
  const actor = await requireActor(1, {allowEventTeam: true});
  if (!question || !question.trim()) return { ok: false, error: "Question is required" };
  const task = queryOne("SELECT description, target_type, target_id, created_by_id FROM tasks WHERE task_uid = ?", [taskUid]);
  if (!task) return { ok: false, error: "Task not found" };
  if (!task.created_by_id) return { ok: false, error: "Task has no recorded creator" };
  if (task.created_by_id === actor.id) return { ok: false, error: "You are the creator of this task" };

  const now = new Date().toISOString();
  const insertRes = run("INSERT INTO task_questions (task_uid, asked_by_id, asked_by_name, question, asked_at) VALUES (?, ?, ?, ?, ?)",
    [taskUid, actor.id, actor.name, question.trim(), now]);

  const alt = _creatorRoutesAlt(task.created_by_id, task.target_type, task.target_id);
  const replyUrl = 'https://ecrpfm.com/fm/tasks/' + taskUid;
  const questionId = insertRes.lastInsertRowid;
  const replyBtn = [{ type: 1, components: [{ type: 2, style: 1, label: 'Reply via Discord', custom_id: `task_info_btn_${questionId}` }] }];
  await sendPing('task.question.asked', '❓ <@' + task.created_by_id + '> — **' + actor.name + '** has a question about a task you created:\n> ' + question.trim().replace(/\n/g, '\n> ') + '\n\n📋 ' + replyUrl, { alt, components: replyBtn });

  run("INSERT INTO task_log (action, actor, task_uid, description, target, created_at) VALUES ('INFO_REQUEST', ?, ?, ?, ?, ?)",
    [actor.name, taskUid, (task.description || '').substring(0, 200), question.substring(0, 300), now]);
  logAudit(actor.id, actor.name, 'EDIT', 'task', null, taskUid, 'Requested info: ' + question.substring(0, 100));

  return { ok: true };
}

// Returns one task by uid, with Q&A counts.
export async function getTaskByUid(taskUid) {
  await requireActor(1, {allowEventTeam: true});
  const task = queryOne("SELECT * FROM tasks WHERE task_uid = ?", [taskUid]);
  if (!task) return null;
  // Resolve claimer name
  if (task.claimed_by && task.claimed_by !== 'None') {
    const claimer = queryOne("SELECT display_name FROM staff WHERE discord_id = ?", [task.claimed_by]);
    task.claimerName = claimer?.display_name || task.claimed_by;
  } else {
    task.claimerName = '';
  }
  // Resolve target label
  if (task.target_type === 'User') {
    const u = queryOne("SELECT display_name FROM staff WHERE discord_id = ?", [task.target_id]);
    task.targetLabel = u?.display_name || task.target_id;
  } else if (task.target_type === 'Team') {
    const t = queryOne("SELECT team_name FROM staff WHERE team_id = ? LIMIT 1", [task.target_id]);
    task.targetLabel = t?.team_name || task.target_id;
  } else if (task.target_type === 'Role') {
    const leadershipId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_leadership'")?.role_id || '';
    if (task.target_id === leadershipId) task.targetLabel = 'FM Leadership';
    else if (task.target_id === getRole('game_affairs')) task.targetLabel = 'Game Affairs Management';
    else task.targetLabel = task.target_id;
  } else {
    task.targetLabel = task.target_id;
  }
  return task;
}

// Returns all Q&A rows for a task, oldest first.
export async function getTaskQuestions(taskUid) {
  await requireActor(1, {allowEventTeam: true});
  return query("SELECT * FROM task_questions WHERE task_uid = ? ORDER BY asked_at ASC", [taskUid]);
}

// Creator answers a question. Pings the asker in their visible channel.
export async function answerTaskQuestion(questionId, answer) {
  const actor = await requireActor(1, {allowEventTeam: true});
  if (!answer || !answer.trim()) return { ok: false, error: "Answer is required" };
  const q = queryOne("SELECT * FROM task_questions WHERE id = ?", [questionId]);
  if (!q) return { ok: false, error: "Question not found" };
  if (q.answer) return { ok: false, error: "Question is already answered" };
  const task = queryOne("SELECT description, target_type, target_id, created_by_id FROM tasks WHERE task_uid = ?", [q.task_uid]);
  if (!task) return { ok: false, error: "Task not found" };
  if (task.created_by_id !== actor.id) {
    return { ok: false, error: "Only the task creator can answer questions" };
  }

  const now = new Date().toISOString();
  run("UPDATE task_questions SET answer = ?, answered_by_id = ?, answered_by_name = ?, answered_at = ? WHERE id = ?",
    [answer.trim(), actor.id, actor.name, now, questionId]);

  // Ping asker in their visible channel — same routing rule as creator pings.
  if (q.asked_by_id) {
    const alt = _creatorRoutesAlt(q.asked_by_id, task.target_type, task.target_id);
    const replyUrl = 'https://ecrpfm.com/fm/tasks/' + q.task_uid;
    await sendPing('task.question.answered', '💬 <@' + q.asked_by_id + '> — **' + actor.name + '** answered your question:\n> ' + answer.trim().replace(/\n/g, '\n> ') + '\n\n📋 ' + replyUrl, { alt });
  }

  run("INSERT INTO task_log (action, actor, task_uid, description, target, created_at) VALUES ('INFO_ANSWER', ?, ?, ?, ?, ?)",
    [actor.name, q.task_uid, (task.description || '').substring(0, 200), answer.substring(0, 300), now]);
  logAudit(actor.id, actor.name, 'EDIT', 'task', null, q.task_uid, 'Answered: ' + answer.substring(0, 100));

  return { ok: true };
}

export async function completeMyTask(taskUid, note) {
  const actor = await requireActor(1, {allowEventTeam: true});
  const task = queryOne("SELECT description, target_id, target_type, created_by_id, notify_creator FROM tasks WHERE task_uid = ?", [taskUid]);
  run("DELETE FROM tasks WHERE task_uid = ?", [taskUid]);
  run("INSERT INTO task_log (action, actor, task_uid, description, target, created_at) VALUES ('COMPLETED', ?, ?, ?, 'Done', ?)",
    [actor.name, taskUid, task?.description || '', new Date().toISOString()]);
  logAudit(actor.id, actor.name, 'DELETE', 'task', null, taskUid, 'Completed');
  if (task && task.created_by_id && task.created_by_id !== actor.id) {
    const _alt = _creatorRoutesAlt(task.created_by_id, task.target_type, task.target_id);
    await sendPing('task.completed.creator', '✅ <@' + task.created_by_id + '> — **' + actor.name + '** completed a task you created.' + (note ? '\n**Note:** ' + note : ''), { alt: _alt });
  }
  return { ok: true };
}

export async function editMyTask(taskUid, newDesc) {
  const actor = await requireActor(1, {allowEventTeam: true});
  // Restrict editing to creator OR L2+
  const task = queryOne("SELECT created_by_id FROM tasks WHERE task_uid = ?", [taskUid]);
  if (!task) return { ok: false, error: "Task not found" };
  if (task.created_by_id !== actor.id && actor.level < 2) {
    return { ok: false, error: "Only creator or L2+ can edit" };
  }
  run("UPDATE tasks SET description = ? WHERE task_uid = ?", [newDesc, taskUid]);
  logAudit(actor.id, actor.name, 'EDIT', 'task', null, taskUid, newDesc.substring(0,100));
  return { ok: true };
}

// Reassign an individually-assigned task to a new target.
// Constraints:
//   - Caller must be L2+
//   - Caller must currently be the individual assignee (target_type='User', target_id=actor.id)
//   - L2 cannot reassign TO L3-only targets:
//       * a User whose staff rank is L3 (FM Leadership / Game Affairs)
//       * a Role that is FM Leadership or Game Affairs Management
//   - L3 has no constraint
export async function reassignMyTask(taskUid, newTargetId, newTargetType, note) {
  const actor = await requireActor(2);
  const task = queryOne("SELECT description, target_id, target_type, created_by_id, notify_creator FROM tasks WHERE task_uid = ?", [taskUid]);
  if (!task) return { ok: false, error: "Task not found" };
  // No restriction on which task — any L2+ can reassign any task they can see.
  if (!['User', 'Role', 'Team'].includes(newTargetType)) {
    return { ok: false, error: "Invalid target type" };
  }
  if (!newTargetId) return { ok: false, error: "Missing target" };

  const leadershipRoleId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_leadership'")?.role_id || '';
  const gameAffairsId = getRole('game_affairs');

  // L2 escalation guard
  if (actor.level < 3) {
    if (newTargetType === 'Role') {
      if (newTargetId === leadershipRoleId || newTargetId === gameAffairsId) {
        return { ok: false, error: "L2 cannot reassign to FM Leadership or Game Affairs Management" };
      }
    }
    if (newTargetType === 'User') {
      const staff = queryOne("SELECT rank FROM staff WHERE discord_id = ?", [newTargetId]);
      const rankStr = (staff?.rank || '').toLowerCase();
      // L3 ranks contain "leadership" or "management" or "game affairs"
      if (rankStr.includes('leadership') || rankStr.includes('management') || rankStr.includes('game affairs')) {
        return { ok: false, error: "L2 cannot reassign tasks to L3 staff" };
      }
    }
  }

  // Resolve a friendly target label for the audit + log
  let targetLabel = newTargetType + ': ' + newTargetId;
  if (newTargetType === 'User') {
    const s = queryOne("SELECT display_name FROM staff WHERE discord_id = ?", [newTargetId]);
    if (s?.display_name) targetLabel = 'User: ' + s.display_name;
  } else if (newTargetType === 'Team') {
    const t = queryOne("SELECT team_name FROM staff WHERE team_id = ? LIMIT 1", [newTargetId]);
    if (t?.team_name) targetLabel = 'Team: ' + t.team_name;
  } else if (newTargetType === 'Role') {
    if (newTargetId === leadershipRoleId) targetLabel = 'Role: FM Leadership';
    else if (newTargetId === gameAffairsId) targetLabel = 'Role: Game Affairs Management';
    else {
      const r = queryOne("SELECT key FROM discord_roles WHERE role_id = ?", [newTargetId]);
      if (r?.key) targetLabel = 'Role: ' + r.key;
    }
  }

  // Recompute notify_creator. Notify when:
  //   - creator cannot see leadership_channel (not Management rank)
  //   - AND the new target routes to leadership_channel
  let _newNotifyCreator = 0;
  if (task.created_by_id) {
    const _creatorStaff = queryOne("SELECT rank FROM staff WHERE discord_id = ?", [task.created_by_id]);
    const _creatorIsLeadership = (_creatorStaff?.rank || '').toLowerCase().includes('management');
    _newNotifyCreator = (!_creatorIsLeadership && _routesToLeadership(newTargetType, newTargetId)) ? 1 : 0;
  }

  // Apply update — clear claimed_by since assignee is changing, refresh notify_creator
  run("UPDATE tasks SET target_id = ?, target_type = ?, claimed_by = 'None', notify_creator = ? WHERE task_uid = ?",
    [newTargetId, newTargetType, _newNotifyCreator, taskUid]);

  run("INSERT INTO task_log (action, actor, task_uid, description, target, created_at) VALUES ('REASSIGNED', ?, ?, ?, ?, ?)",
    [actor.name, taskUid, task.description || '', targetLabel, new Date().toISOString()]);

  logAudit(actor.id, actor.name, 'EDIT', 'task', null, taskUid, 'Reassigned to ' + targetLabel);

  // Notification
  const tag = newTargetType === 'Role' ? '<@&' + newTargetId + '>' : (newTargetType === 'User' ? '<@' + newTargetId + '>' : '@' + targetLabel);
  await sendPing('task.reassigned', '📋 **TASK REASSIGNED** | ' + tag + '\n**Reassigned By:** ' + actor.name + '\n**Task:** ' + (task.description || '').substring(0, 200), { alt: _routesToLeadership(newTargetType, newTargetId) });

  // Notify creator if they should now be looped in (notify_creator just (re)computed).
  if (task.created_by_id && task.created_by_id !== actor.id) {
    const _alt = _creatorRoutesAlt(task.created_by_id, newTargetType, newTargetId);
    await sendPing('task.reassigned.creator', '🔁 <@' + task.created_by_id + '> — **' + actor.name + '** reassigned a task you created to ' + targetLabel + '.' + (note ? '\n**Note:** ' + note : '') + '\n📋 https://ecrpfm.com/fm/tasks/' + taskUid, { alt: _alt });
  }

  return { ok: true };
}

export async function createMyTask(data) {
  const actor = await requireActor(1, {allowEventTeam: true});
  const uid = Date.now().toString();
  const dt = new Date().toISOString();
  const nextReminder = data.enableDM ? (Date.now() + 86400000).toString() : null;
  // Notify creator on lifecycle events only if they can't see leadership_channel
  const notifyCreator = (!actor.rank?.toLowerCase().includes('management') && _routesToLeadership(data.targetType, data.targetId)) ? 1 : 0;
  run("INSERT INTO tasks (task_uid, description, target_id, target_type, claimed_by, created_by_id, created_by_name, next_reminder, created_at, notify_creator) VALUES (?, ?, ?, ?, 'None', ?, ?, ?, ?, ?)",
    [uid, data.desc, data.targetId, data.targetType, actor.id, actor.name, nextReminder, dt, notifyCreator]);
  run("INSERT INTO task_log (action, actor, task_uid, description, target, created_at) VALUES ('CREATED', ?, ?, ?, ?, ?)",
    [actor.name, uid, data.desc, data.targetType + ': ' + data.targetId, dt]);
  logAudit(actor.id, actor.name, 'CREATE', 'task', null, data.desc.substring(0,50), 'Personal workspace task');
  const selfAssign = actor.level >= 3 && data.targetType === 'User' && data.targetId === actor.id;
  if (!selfAssign) {
    const tag = data.targetType === 'Role' ? '<@&' + data.targetId + '>' : '<@' + data.targetId + '>';
    await sendPing('task.assigned', '📋 **NEW TASK ASSIGNED** | ' + tag + '\n**Assigned By:** ' + actor.name, { alt: _routesToLeadership(data.targetType, data.targetId) });
  }
  return { ok: true };
}

export async function createMyReminder(data) {
  const actor = await requireActor(1, {allowEventTeam: true});
  const uuid = Math.random().toString(36).substring(2, 8);
  const targetTag = data.targetType === 'Role' ? '<@&' + data.targetId + '>' : '<@' + data.targetId + '>';
  const eventAlt = _routesToLeadership(data.targetType, data.targetId);
  const ch = pingChannel('event.created', { alt: eventAlt, ignoreEnabled: true });
  run("INSERT INTO reminders (uuid, author_id, channel_id, message, epoch_ms, readable_time, repeat_rule, target_tag, status) VALUES (?, ?, ?, ?, ?, ?, 'None', ?, 'ACTIVE')",
    [uuid, actor.id, ch, data.message, data.epochMs.toString(), new Date(data.epochMs).toISOString(), targetTag]);
  logAudit(actor.id, actor.name, 'CREATE', 'reminder', null, data.message.substring(0,50), '');
  const epoch = Math.floor(data.epochMs / 1000);
  const embeds = [{ title: '📌 ' + (data.eventType || 'Event') + ' Scheduled', description: '**Time:** <t:' + epoch + ':F> (<t:' + epoch + ':R>)' + (data.note ? '\n**Details:** ' + data.note : '') + '\n\n*Via Meridian Dashboard*', color: 0x5865F2 }];
  await sendPing('event.created', targetTag, { alt: eventAlt, embeds });
  return { ok: true };
}

export async function snoozeMyReminder(uuid) {
  await requireActor(1, {allowEventTeam: true});
  const r = queryOne("SELECT * FROM reminders WHERE uuid = ?", [uuid]);
  if (!r) return { ok: false };
  const newTime = parseInt(r.epoch_ms) + 3600000;
  run("UPDATE reminders SET epoch_ms = ?, readable_time = ?, status = 'ACTIVE' WHERE uuid = ?", [newTime.toString(), new Date(newTime).toISOString(), uuid]);
  return { ok: true };
}

export async function deleteMyReminder(uuid) {
  const actor = await requireActor(1, {allowEventTeam: true});
  // Restrict deletion to author OR L2+
  const r = queryOne("SELECT author_id FROM reminders WHERE uuid = ?", [uuid]);
  if (!r) return { ok: false, error: "Reminder not found" };
  if (r.author_id !== actor.id && actor.level < 2) {
    return { ok: false, error: "Only author or L2+ can delete" };
  }
  run("DELETE FROM reminders WHERE uuid = ?", [uuid]);
  logAudit(actor.id, actor.name, 'DELETE', 'reminder', null, uuid, '');
  return { ok: true };
}

export async function getStaffForCreate() {
  await requireActor(1, {allowEventTeam: true});
  return query("SELECT discord_id, display_name, team_id, team_name, rank FROM staff WHERE discord_id != '' AND discord_id NOT LIKE 'placeholder%' ORDER BY display_name");
}

export async function getRoleTargetsForCreate() {
  await requireActor(1, {allowEventTeam: true});
  const leadershipId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_leadership'")?.role_id || '';
  const leadId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_team_lead'")?.role_id || '';
  const allFmId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_team_guide'")?.role_id || '';
  const teams = query("SELECT DISTINCT team_id, team_name FROM staff WHERE team_id != '' AND team_name != 'Game Affairs Management' ORDER BY team_name");
  return { leadershipId, leadId, allFmId, teams };
}

// Returns factions assigned to the current user's team.
export async function getMyTeamFactions() {
  const actor = await requireActor(1, {allowEventTeam: true});
  const discordId = actor.id;
  const level = actor.level;

  const staff = queryOne("SELECT team_id, team_name FROM staff WHERE discord_id = ?", [discordId]);
  if (!staff) return { teamName: '', factions: [] };

  let factions;
  if (level >= 3 || actor.isLeadStoryteller) {
    factions = query("SELECT id, name, tier, lead_discord_id, last_promoted, pending_promo, forum_posts_30d FROM factions WHERE archived = 0 ORDER BY name");
  } else {
    const teamLeads = query("SELECT discord_id FROM staff WHERE team_id = ?", [staff.team_id]).map(r => r.discord_id);
    if (teamLeads.length === 0) return { teamName: staff.team_name || '', factions: [] };
    const placeholders = teamLeads.map(() => '?').join(',');
    factions = query(`SELECT id, name, tier, lead_discord_id, last_promoted, pending_promo, forum_posts_30d FROM factions WHERE archived = 0 AND lead_discord_id IN (${placeholders}) ORDER BY name`, teamLeads);
  }

  return {
    teamName: (level >= 3 || actor.isLeadStoryteller) ? 'All Factions' : (staff.team_name || ''),
    factions: factions.map(f => {
      const scenes30d = queryOne("SELECT COUNT(*) as c FROM scene_logs WHERE faction_id = ? AND created_at >= datetime('now','-30 days')", [f.id])?.c || 0;
      const scenesAll = queryOne("SELECT COUNT(*) as c FROM scene_logs WHERE faction_id = ?", [f.id])?.c || 0;
      const lead = queryOne("SELECT display_name FROM staff WHERE discord_id = ?", [f.lead_discord_id]);
      return {
        ...f,
        scenes30d,
        scenesAll,
        leadName: lead?.display_name || 'Unassigned',
      };
    }),
  };
}

// Returns a map of task_uid → unanswered_count + total_count, for a list of uids.
export async function getQACountsForTasks(taskUids) {
  await requireActor(1, {allowEventTeam: true});
  if (!Array.isArray(taskUids) || taskUids.length === 0) return {};
  const placeholders = taskUids.map(() => '?').join(',');
  const rows = query(
    "SELECT task_uid, SUM(CASE WHEN answer IS NULL OR answer = '' THEN 1 ELSE 0 END) AS open_count, COUNT(*) AS total_count FROM task_questions WHERE task_uid IN (" + placeholders + ") GROUP BY task_uid",
    taskUids
  );
  const map = {};
  rows.forEach(r => { map[r.task_uid] = { open: r.open_count || 0, total: r.total_count || 0 }; });
  return map;
}

// ── RECURRING REMINDERS — dashboard cards ──

// Returns active instances for the current user, filtered by visible channels.
//   L1 sees instances whose channel is global_ping_channel
//   L2 sees instances whose channel is global_ping_channel or team_lead_channel
//   L3 sees all
export async function getMyRecurringInstances() {
  const actor = await requireActor(1, {allowEventTeam: true});
  const globalCh = getChannel('global_ping_channel');
  const teamLeadCh = getChannel('team_lead_channel');

  let visibleChannels;
  if (actor.level >= 3) {
    visibleChannels = null; // all
  } else if (actor.level >= 2) {
    visibleChannels = [globalCh, teamLeadCh].filter(Boolean);
  } else {
    visibleChannels = [globalCh].filter(Boolean);
  }

  let sql = `
    SELECT i.*, r.title, r.body, r.links, r.channel_id, r.ping_day, r.due_day, r.target_type, r.target_id
    FROM recurring_reminder_instances i
    JOIN recurring_reminders r ON i.reminder_id = r.id
    WHERE i.recipient_id = ? AND i.completed_at IS NULL AND r.active = 1
  `;
  const params = [actor.id];
  if (visibleChannels !== null) {
    if (visibleChannels.length === 0) return [];
    const placeholders = visibleChannels.map(() => '?').join(',');
    sql += ` AND r.channel_id IN (${placeholders})`;
    params.push(...visibleChannels);
  }
  sql += ' ORDER BY i.year DESC, i.month DESC, r.due_day ASC';
  return query(sql, params);
}

// Returns ALL tasks across the server, enriched with targetLabel + claimerName + teamContext. L3 only.
export async function getAllServerTasks() {
  await requireActor(3);

  const leadershipRoleId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_leadership'")?.role_id || '';
  const gameAffairsRoleId = getRole('game_affairs');
  const leadRoleId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_team_lead'")?.role_id || '';
  const allFmRoleId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_team_guide'")?.role_id || '';

  const allTasks = query("SELECT * FROM tasks ORDER BY created_at DESC");

  return allTasks.map(t => {
    const claimerName = (t.claimed_by !== 'None' && t.claimed_by)
      ? (queryOne("SELECT display_name FROM staff WHERE discord_id = ?", [t.claimed_by])?.display_name || t.claimed_by)
      : 'Unclaimed';

    let targetLabel = '';
    let teamContext = '';
    if (t.target_type === 'User') {
      const s = queryOne("SELECT display_name, team_name FROM staff WHERE discord_id = ?", [t.target_id]);
      targetLabel = s?.display_name || 'User';
      teamContext = s?.team_name || '';
    } else if (t.target_type === 'Role') {
      if (t.target_id === leadershipRoleId) { targetLabel = 'FM Leadership'; teamContext = 'Leadership'; }
      else if (t.target_id === gameAffairsRoleId) { targetLabel = 'Game Affairs'; teamContext = 'Leadership'; }
      else if (t.target_id === leadRoleId) { targetLabel = 'Team Leads'; teamContext = 'All Teams'; }
      else if (t.target_id === allFmRoleId) { targetLabel = 'All FM'; teamContext = 'All Teams'; }
      else {
        const team = queryOne("SELECT DISTINCT team_name FROM staff WHERE team_id = ? LIMIT 1", [t.target_id]);
        targetLabel = team?.team_name ? `Team ${team.team_name}` : 'Role';
        teamContext = team?.team_name || '';
      }
    } else {
      targetLabel = t.target_type || 'Unknown';
    }

    return { ...t, claimerName, targetLabel, teamContext };
  });
}

// Returns all tasks created by the current user, regardless of target or claim status. L2+.
export async function getMyCreatedTasks() {
  // Self-scoped (WHERE created_by_id = actor.id) — every member may track the
  // tasks they created, so the floor is L1, not L2.
  const actor = await requireActor(1);

  const leadershipRoleId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_leadership'")?.role_id || '';
  const gameAffairsRoleId = getRole('game_affairs');
  const leadRoleId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_team_lead'")?.role_id || '';
  const allFmRoleId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_team_guide'")?.role_id || '';

  const tasks = query("SELECT * FROM tasks WHERE created_by_id = ? ORDER BY created_at DESC", [actor.id]);
  return tasks.map(t => {
    const claimerName = (t.claimed_by && t.claimed_by !== 'None')
      ? (queryOne("SELECT display_name FROM staff WHERE discord_id = ?", [t.claimed_by])?.display_name || t.claimed_by)
      : 'Unclaimed';
    let targetLabel = '';
    if (t.target_type === 'User') {
      targetLabel = queryOne("SELECT display_name FROM staff WHERE discord_id = ?", [t.target_id])?.display_name || 'User';
    } else if (t.target_type === 'Role') {
      if (t.target_id === leadershipRoleId) targetLabel = 'FM Leadership';
      else if (t.target_id === gameAffairsRoleId) targetLabel = 'Game Affairs';
      else if (t.target_id === leadRoleId) targetLabel = 'Team Leads';
      else if (t.target_id === allFmRoleId) targetLabel = 'All FM';
      else {
        const team = queryOne("SELECT team_name FROM staff WHERE team_id = ? LIMIT 1", [t.target_id]);
        targetLabel = team?.team_name ? `Team ${team.team_name}` : 'Role';
      }
    }
    return { ...t, claimerName, targetLabel };
  });
}

// Returns all tasks targeting the team role or any team member, regardless of claim status. L2+.
export async function getMyTeamAllTasks() {
  const actor = await requireActor(2);
  const staff = queryOne("SELECT team_id, team_name FROM staff WHERE discord_id = ?", [actor.id]) || {};
  const teamId = staff.team_id || '';

  const members = teamId ? query("SELECT discord_id, display_name FROM staff WHERE team_id = ?", [teamId]) : [];
  const memberIds = members.map(m => m.discord_id);
  const memberNameById = Object.fromEntries(members.map(m => [m.discord_id, m.display_name]));

  // Role pings a team lead should see: their own team role plus the shared
  // FM Team Lead and All-FM roles. Those cross-team pings previously landed in
  // no tab for L2 leads (the query only matched the team's own role + members).
  const leadRoleId  = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_team_lead'")?.role_id || '';
  const allFmRoleId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_team_guide'")?.role_id || '';
  const roleTargets = [teamId, leadRoleId, allFmRoleId].filter(Boolean);
  if (roleTargets.length === 0 && memberIds.length === 0) return [];

  const clauses = [], params = [];
  if (roleTargets.length) { clauses.push(`(target_type = 'Role' AND target_id IN (${roleTargets.map(() => '?').join(',')}))`); params.push(...roleTargets); }
  if (memberIds.length)   { clauses.push(`(target_type = 'User' AND target_id IN (${memberIds.map(() => '?').join(',')}))`); params.push(...memberIds); }
  const tasks = query(`SELECT * FROM tasks WHERE ${clauses.join(' OR ')} ORDER BY created_at DESC`, params);

  const teamLabel = `Team ${staff.team_name || teamId || 'Unassigned'}`;
  return tasks.map(t => {
    const claimerName = (t.claimed_by && t.claimed_by !== 'None')
      ? (queryOne("SELECT display_name FROM staff WHERE discord_id = ?", [t.claimed_by])?.display_name || t.claimed_by)
      : 'Unclaimed';
    const targetLabel = (t.target_type === 'User')
      ? (memberNameById[t.target_id] || t.target_id)
      : (t.target_id === leadRoleId ? 'FM Team Leads'
        : t.target_id === allFmRoleId ? 'All FM'
        : teamLabel);
    return { ...t, claimerName, targetLabel };
  });
}

// Mark an instance as complete for the current user.
export async function completeMyRecurringInstance(instanceId) {
  const actor = await requireActor(1, {allowEventTeam: true});
  const inst = queryOne("SELECT * FROM recurring_reminder_instances WHERE id = ?", [instanceId]);
  if (!inst) return { ok: false, error: "Instance not found" };
  if (inst.completed_at) return { ok: false, error: "Already completed" };
  if (inst.recipient_id !== actor.id && actor.level < 3) {
    return { ok: false, error: "You can only complete your own instance (L3 can complete others')" };
  }
  run("UPDATE recurring_reminder_instances SET completed_at = datetime('now'), completed_by_id = ?, completed_by_name = ? WHERE id = ?",
    [actor.id, actor.name, instanceId]);
  logAudit(actor.id, actor.name, 'EDIT', 'recurring_reminder_instance', instanceId, '', 'Completed');
  return { ok: true };
}


// ── Watch Role Pings (all FM staff, L1+) ──────────────────────────────────

function _getTeamConfigIds(discordId, level, isLst = false) {
  if (level >= 3 || isLst) return null; // null = all configs
  const staff = queryOne("SELECT team_id FROM staff WHERE discord_id = ?", [discordId]);
  if (!staff?.team_id) return [];
  const teamIds = query("SELECT discord_id FROM staff WHERE team_id = ?", [staff.team_id]).map(r => r.discord_id);
  if (!teamIds.length) return [];
  const p1 = teamIds.map(() => '?').join(',');
  const factionIds = query(`SELECT id FROM factions WHERE lead_discord_id IN (${p1}) AND archived = 0`, teamIds).map(f => f.id);
  if (!factionIds.length) return [];
  const p2 = factionIds.map(() => '?').join(',');
  return query(`SELECT id FROM bot_server_configs WHERE faction_id IN (${p2})`, factionIds).map(c => c.id);
}

export async function getTeamWatchPings() {
  const actor = await requireActor(1, {allowEventTeam: true});
  const configIds = _getTeamConfigIds(actor.id, actor.level, actor.isLeadStoryteller);
  let rows;
  if (configIds === null) {
    rows = query(`
      SELECT wrm.*, bsc.guild_name as server_name, f.name as faction_name
      FROM watch_role_mentions wrm
      LEFT JOIN bot_server_configs bsc ON wrm.config_id = bsc.id
      LEFT JOIN factions f ON bsc.faction_id = f.id
      ORDER BY wrm.is_read ASC, wrm.created_at DESC LIMIT 150`);
  } else if (configIds.length === 0) {
    return [];
  } else {
    const p = configIds.map(() => '?').join(',');
    rows = query(`
      SELECT wrm.*, bsc.guild_name as server_name, f.name as faction_name
      FROM watch_role_mentions wrm
      LEFT JOIN bot_server_configs bsc ON wrm.config_id = bsc.id
      LEFT JOIN factions f ON bsc.faction_id = f.id
      WHERE wrm.config_id IN (${p})
      ORDER BY wrm.is_read ASC, wrm.created_at DESC LIMIT 150`, configIds);
  }
  return rows;
}

export async function markWatchPingRead(id) {
  await requireActor(1, {allowEventTeam: true});
  run("UPDATE watch_role_mentions SET is_read = 1 WHERE id = ?", [id]);
  return { ok: true };
}

export async function markAllWatchPingsRead() {
  const actor = await requireActor(1, {allowEventTeam: true});
  const configIds = _getTeamConfigIds(actor.id, actor.level, actor.isLeadStoryteller);
  if (configIds === null) {
    run("UPDATE watch_role_mentions SET is_read = 1 WHERE is_read = 0");
  } else if (configIds.length > 0) {
    const p = configIds.map(() => '?').join(',');
    run(`UPDATE watch_role_mentions SET is_read = 1 WHERE config_id IN (${p}) AND is_read = 0`, configIds);
  }
  return { ok: true };
}

export async function replyToWatchPing(id, replyText) {
  const actor = await requireActor(1, {allowEventTeam: true});
  if (!replyText?.trim()) return { ok: false, error: 'Message is empty.' };
  const ping = queryOne("SELECT * FROM watch_role_mentions WHERE id = ?", [id]);
  if (!ping) return { ok: false, error: 'Ping not found.' };
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return { ok: false, error: 'Bot token not configured.' };
  const body = {
    embeds: [{ description: replyText.trim(), author: { name: `${actor.displayName || actor.name} · Dashboard Reply` }, color: 0x34d399 }],
    message_reference: { message_id: ping.message_id, channel_id: ping.channel_id, guild_id: ping.guild_id, fail_if_not_exists: false },
    allowed_mentions: { parse: [] },
  };
  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${ping.channel_id}/messages`, {
      method: 'POST', headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, error: `Discord error ${res.status}` };
    run("UPDATE watch_role_mentions SET is_read = 1 WHERE id = ?", [id]);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ── Personal Mentions (all FM Leadership / L3) ────────────────────────────

export async function getMyMentions() {
  const actor = await requireActor(1, {allowEventTeam: true});
  return query(
    `SELECT m.id, m.message_id, m.channel_id, m.channel_name, m.author_id, m.author_name,
            m.content, m.guild_id, m.created_at, m.is_read,
            COALESCE(bsc.guild_name, m.guild_name, 'ECRP FM Discord') as guild_name
     FROM mentions m
     LEFT JOIN bot_server_configs bsc ON bsc.guild_id = m.guild_id
     WHERE m.target_user_id = ?
     ORDER BY m.is_read ASC, m.created_at DESC
     LIMIT 100`,
    [actor.id]
  );
}

export async function markMentionRead(id) {
  const actor = await requireActor(1, {allowEventTeam: true});
  run("UPDATE mentions SET is_read = 1 WHERE id = ? AND target_user_id = ?", [id, actor.id]);
  return { ok: true };
}

export async function markAllMentionsRead() {
  const actor = await requireActor(1, {allowEventTeam: true});
  run("UPDATE mentions SET is_read = 1 WHERE target_user_id = ? AND is_read = 0", [actor.id]);
  return { ok: true };
}

export async function replyToMention(mentionId, replyText) {
  const actor = await requireActor(1, {allowEventTeam: true});
  if (!replyText?.trim()) return { ok: false, error: 'Message is empty.' };

  const mention = queryOne("SELECT * FROM mentions WHERE id = ? AND target_user_id = ?", [mentionId, actor.id]);
  if (!mention) return { ok: false, error: 'Mention not found.' };

  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return { ok: false, error: 'Bot token not configured.' };

  const body = {
    embeds: [{
      description: replyText.trim(),
      author: { name: `${actor.displayName || actor.name} · Dashboard Reply` },
      color: 0x6366f1,
    }],
    message_reference: {
      message_id: mention.message_id,
      channel_id: mention.channel_id,
      guild_id:   mention.guild_id,
      fail_if_not_exists: false,
    },
    allowed_mentions: { parse: [] },
  };

  try {
    const res = await fetch(
      `https://discord.com/api/v10/channels/${mention.channel_id}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) {
      const err = await res.text();
      console.error('[MENTIONS REPLY]', res.status, err);
      return { ok: false, error: `Discord error ${res.status}` };
    }
    // Mark as read after successful reply
    run("UPDATE mentions SET is_read = 1 WHERE id = ?", [mentionId]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}


// ── FM Leadership Role Mentions (all L3) ──────────────────────────────────

export async function getLeadershipMentions() {
  await requireActor(3);
  return query(
    `SELECT rm.id, rm.message_id, rm.channel_id, rm.channel_name, rm.author_id, rm.author_name,
            rm.content, rm.guild_id, rm.created_at, rm.is_read,
            COALESCE(bsc.guild_name, rm.guild_name, 'ECRP FM Discord') as guild_name
     FROM role_mentions rm
     LEFT JOIN bot_server_configs bsc ON bsc.guild_id = rm.guild_id
     ORDER BY rm.is_read ASC, rm.created_at DESC
     LIMIT 100`
  );
}

export async function markLeadershipMentionRead(id) {
  await requireActor(3);
  run("UPDATE role_mentions SET is_read = 1 WHERE id = ?", [id]);
  return { ok: true };
}

export async function markAllLeadershipMentionsRead() {
  await requireActor(3);
  run("UPDATE role_mentions SET is_read = 1 WHERE is_read = 0");
  return { ok: true };
}

export async function replyToLeadershipMention(mentionId, replyText) {
  const actor = await requireActor(3);
  if (!replyText?.trim()) return { ok: false, error: 'Message is empty.' };

  const mention = queryOne("SELECT * FROM role_mentions WHERE id = ?", [mentionId]);
  if (!mention) return { ok: false, error: 'Mention not found.' };

  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return { ok: false, error: 'Bot token not configured.' };

  const body = {
    embeds: [{
      description: replyText.trim(),
      author: { name: `${actor.displayName || actor.name} · Dashboard Reply` },
      color: 0xf59e0b,
    }],
    message_reference: {
      message_id: mention.message_id,
      channel_id: mention.channel_id,
      guild_id:   mention.guild_id,
      fail_if_not_exists: false,
    },
    allowed_mentions: { parse: [] },
  };

  try {
    const res = await fetch(
      `https://discord.com/api/v10/channels/${mention.channel_id}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) {
      const err = await res.text();
      console.error('[ROLE_MENTIONS REPLY]', res.status, err);
      return { ok: false, error: `Discord error ${res.status}` };
    }
    run("UPDATE role_mentions SET is_read = 1 WHERE id = ?", [mentionId]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Forwarded DMs (risk only) ─────────────────────────────────────────────

export async function getDMTrackingStatus() {
  const actor = await requireActor(1, {allowEventTeam: true});
  const row = queryOne("SELECT dm_tracking_enabled FROM staff WHERE discord_id = ?", [actor.id]);
  return { enabled: row?.dm_tracking_enabled === 1, discordId: actor.id };
}

export async function toggleDMTracking(enable) {
  const actor = await requireActor(1, {allowEventTeam: true});
  run("UPDATE staff SET dm_tracking_enabled = ? WHERE discord_id = ?", [enable ? 1 : 0, actor.id]);
  return { ok: true, enabled: enable };
}

export async function getForwardedDMs() {
  const actor = await requireActor(1, {allowEventTeam: true});
  return query(
    `SELECT id, message_id, author_id, author_name, content, source_channel,
            source_channel_id, source_message_id, forwarded_at, is_read
     FROM forwarded_dms
     WHERE target_user_id = ?
     ORDER BY is_read ASC, forwarded_at DESC
     LIMIT 100`,
    [actor.id]
  );
}

export async function markDMRead(id) {
  const actor = await requireActor(1, {allowEventTeam: true});
  run("UPDATE forwarded_dms SET is_read = 1 WHERE id = ? AND target_user_id = ?", [id, actor.id]);
  return { ok: true };
}

export async function markAllDMsRead() {
  const actor = await requireActor(1, {allowEventTeam: true});
  run("UPDATE forwarded_dms SET is_read = 1 WHERE target_user_id = ? AND is_read = 0", [actor.id]);
  return { ok: true };
}

export async function deleteDM(id) {
  const actor = await requireActor(1, {allowEventTeam: true});
  run("DELETE FROM forwarded_dms WHERE id = ? AND target_user_id = ?", [id, actor.id]);
  return { ok: true };
}
