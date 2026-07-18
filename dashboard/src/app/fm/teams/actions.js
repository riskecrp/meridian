"use server";
import { query, queryOne, run } from "../../../lib/db.js";
import { logAudit } from "../../../lib/audit.js";
import { sendDiscord, getChannel, getRole } from "../../../lib/discord.js";
import { requireActor } from "../../../lib/requireActor.js";


// ── creator notification helper ──
function _creatorPingChannel(createdById, currentTargetType, currentTargetId) {
  if (!createdById) return null;
  const staff = queryOne("SELECT rank FROM staff WHERE discord_id = ?", [createdById]);
  const rank = (staff?.rank || '').toLowerCase();
  const isLeadership = rank.includes('leadership') || rank.includes('management') || rank.includes('game affairs');
  if (!isLeadership) return getChannel('global_ping_channel');
  const leadershipRoleId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_leadership'")?.role_id || '';
  const gameAffairsId = '1457189093594239147';
  const routesToLeadership = currentTargetType === 'Role' && (currentTargetId === leadershipRoleId || currentTargetId === gameAffairsId);
  return routesToLeadership ? getChannel('leadership_channel') : getChannel('global_ping_channel');
}


function today() { return new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}).replace(/ /g,'/').toUpperCase(); }

export async function getTeams() {
  try {
    const staff = query("SELECT * FROM staff WHERE discord_id != '' AND discord_id != 'Unassigned_Lead_Placeholder' ORDER BY team_id, rank");
    const factions = query(`SELECT f.*, 
      COALESCE((SELECT COUNT(*) FROM scene_logs sl WHERE sl.faction_id=f.id AND sl.created_at>=datetime('now','-30 days')),0) as scenes30d,
      COALESCE((SELECT COUNT(*) FROM scene_logs sl WHERE sl.faction_id=f.id),0) as allTime
      FROM factions f WHERE f.archived = 0 ORDER BY f.name`);

    const teams = {};
    staff.forEach(s => {
      if (!s.team_id || s.team_name === 'Game Affairs Management') return;
      if (!teams[s.team_id]) teams[s.team_id] = { id: s.team_id, name: s.team_name || 'Unnamed', leads: [], guides: [], factions: [], total30d: 0, totalAll: 0 };
      const entry = { discordId: s.discord_id, name: s.display_name, rank: s.rank };
      if (s.rank.toLowerCase().includes('lead')) teams[s.team_id].leads.push(entry);
      else teams[s.team_id].guides.push(entry);
    });

    // Assign factions to teams based on lead
    factions.forEach(f => {
      const leadStaff = staff.find(s => s.discord_id === f.lead_discord_id);
      const tid = leadStaff?.team_id;
      if (tid && teams[tid]) {
        teams[tid].factions.push({ id: f.id, name: f.name, tier: f.tier, scenes30d: f.scenes30d, allTime: f.allTime });
        teams[tid].total30d += f.scenes30d;
        teams[tid].totalAll += f.allTime;
      }
    });

    return Object.values(teams);
  } catch (e) { console.error("getTeams:", e); return []; }
}

export async function getTeamTasks(teamId) {
  try {
    const staffInTeam = query("SELECT discord_id FROM staff WHERE team_id = ?", [teamId]);
    const memberIds = staffInTeam.map(s => s.discord_id);
    const allTasks = query("SELECT * FROM tasks ORDER BY created_at DESC");
    return allTasks.filter(t => {
      if (t.target_type === 'Role' && t.target_id === teamId) return true;
      if ((t.target_type === 'User' || t.target_type === 'Private') && memberIds.includes(t.target_id)) return true;
      return false;
    }).map(t => {
      const claimer = t.claimed_by !== 'None' ? query("SELECT display_name FROM staff WHERE discord_id = ?", [t.claimed_by])[0]?.display_name || t.claimed_by : 'Unclaimed';
      return { ...t, claimerName: claimer, creatorName: t.created_by_name || 'Unknown' };
    });
  } catch (e) { return []; }
}

export async function getTeamReminders(teamId) {
  try {
    const staffInTeam = query("SELECT discord_id FROM staff WHERE team_id = ?", [teamId]);
    const memberIds = staffInTeam.map(s => s.discord_id);
    const all = query("SELECT * FROM reminders WHERE status != 'FIRED' ORDER BY epoch_ms");
    return all.filter(r => {
      const roleMatch = r.target_tag?.match(/<@&(\d+)>/);
      const userMatch = r.target_tag?.match(/<@(\d+)>/);
      if (roleMatch && roleMatch[1] === teamId) return true;
      if (userMatch && memberIds.includes(userMatch[1])) return true;
      return false;
    }).map(r => {
      const authorStaff = query("SELECT display_name FROM staff WHERE discord_id = ?", [r.author_id])[0];
      return { ...r, authorName: authorStaff?.display_name || r.author_id, epochMs: parseInt(r.epoch_ms) };
    });
  } catch (e) { return []; }
}

export async function getMyTasks(discordId, teamId, rank) {
  try {
    const allTasks = query("SELECT * FROM tasks ORDER BY created_at DESC");
    const isLead = rank?.toLowerCase().includes('lead');
    const isMgmt = rank?.toLowerCase().includes('management') || rank?.toLowerCase().includes('admin');
    const leadRoleId = getRole('fm_team_lead');
    const leadershipRoleId = getRole('fm_leadership');
    const allFmRoleId = getRole('fm_team_guide');

    return allTasks.filter(t => {
      if (t.target_id === discordId) return true;
      if (t.target_type === 'Role' && t.target_id === teamId) return true;
      if (t.claimed_by === discordId) return true;
      if (isLead && t.target_type === 'Role' && t.target_id === leadRoleId) return true;
      if (isMgmt && t.target_type === 'Role' && (t.target_id === leadershipRoleId || t.target_id === allFmRoleId)) return true;
      return false;
    }).map(t => {
      const claimer = t.claimed_by !== 'None' ? query("SELECT display_name FROM staff WHERE discord_id = ?", [t.claimed_by])[0]?.display_name || t.claimed_by : 'Unclaimed';
      return { ...t, claimerName: claimer };
    });
  } catch (e) { return []; }
}

export async function getMyReminders(discordId, teamId, rank) {
  try {
    const all = query("SELECT * FROM reminders WHERE status != 'FIRED' ORDER BY epoch_ms");
    const isLead = rank?.toLowerCase().includes('lead');
    const isMgmt = rank?.toLowerCase().includes('management');
    const leadRoleId = getRole('fm_team_lead');
    const leadershipRoleId = getRole('fm_leadership');

    return all.filter(r => {
      if (r.author_id === discordId) return true;
      const roleMatch = r.target_tag?.match(/<@&(\d+)>/);
      const userMatch = r.target_tag?.match(/<@(\d+)>/);
      if (userMatch && userMatch[1] === discordId) return true;
      if (roleMatch && roleMatch[1] === teamId) return true;
      if (isLead && roleMatch && roleMatch[1] === leadRoleId) return true;
      if (isMgmt && roleMatch && (roleMatch[1] === leadershipRoleId)) return true;
      return false;
    }).map(r => ({ ...r, authorName: r.author_id, epochMs: parseInt(r.epoch_ms) }));
  } catch (e) { return []; }
}

export async function createTask(data, actor) {
  try {
    const uid = Date.now().toString();
    const ts = today();
    const nextReminder = data.enableDM ? (Date.now() + 86400000).toString() : null;
  const _leadershipRoleId_create = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_leadership'")?.role_id || '';
  const _gameAffairsId_create = '1457189093594239147';
  const _routesToLeadership_create = data.targetType === 'Role' && (data.targetId === _leadershipRoleId_create || data.targetId === _gameAffairsId_create);
  const notifyCreator = (actor.level < 3 && _routesToLeadership_create) ? 1 : 0;

    run("INSERT INTO tasks (task_uid, description, target_id, target_type, claimed_by, created_by_id, created_by_name, next_reminder, created_at, notify_creator) VALUES (?, ?, ?, ?, 'None', ?, ?, ?, ?, ?)",
      [uid, data.desc, data.targetId, data.targetType, actor.id, actor.name, nextReminder, ts, notifyCreator]);
    run("INSERT INTO task_log (action, actor, task_uid, description, target, created_at) VALUES ('CREATED', ?, ?, ?, ?, ?)",
      [actor.name, uid, data.desc, `${data.targetType}: ${data.targetId}`, ts]);
    logAudit(actor.id, actor.name, 'CREATE', 'task', null, data.desc.substring(0,50), `Assigned to ${data.targetType}: ${data.targetId}`);

    // Discord ping — skip if FM Leadership is assigning to themselves
    const selfAssign = actor.level >= 3 && data.targetType === 'User' && data.targetId === actor.id;
    if (!selfAssign) {
      const leadershipRoleId = getRole('fm_leadership');
      const gameAffairsId = '1457189093594239147';
      const routeLeadership = data.targetType === 'Role' && (data.targetId === leadershipRoleId || data.targetId === gameAffairsId);
      const ch = routeLeadership ? getChannel('leadership_channel') : getChannel('global_ping_channel');
      const tag = data.targetType === 'Role' ? `<@&${data.targetId}>` : `<@${data.targetId}>`;
      await sendDiscord(ch, `📋 **NEW TASK ASSIGNED** | ${tag}\n**Assigned By:** ${actor.name}`);
    }
    return { ok: true };
  } catch (e) { return { ok: false }; }
}

export async function claimTask(taskUid, claimerId, claimerName, enableDM) {
  try {
    run("UPDATE tasks SET claimed_by = ? WHERE task_uid = ?", [claimerId, taskUid]);
    if (enableDM) run("UPDATE tasks SET next_reminder = ? WHERE task_uid = ?", [(Date.now() + 86400000).toString(), taskUid]);
    run("INSERT INTO task_log (action, actor, task_uid, description, target, created_at) VALUES ('CLAIMED', ?, ?, '', 'Status Updated', ?)",
      [`${claimerName} (${claimerId})`, taskUid, today()]);
    logAudit(claimerId, claimerName, 'EDIT', 'task', null, taskUid, 'Task claimed');
    const ch = getChannel('global_ping_channel');
    await sendDiscord(ch, `✅ **TASK CLAIMED** by ${claimerName}`);
  const _t = queryOne("SELECT description, created_by_id, notify_creator FROM tasks WHERE task_uid = ?", [taskUid]);
  if (_t && _t.notify_creator === 1 && _t.created_by_id && _t.created_by_id !== actor.id) {
    const _ch = getChannel('global_ping_channel');
    await sendDiscord(_ch, '🤚 <@' + _t.created_by_id + '> — your task "' + (_t.description || '').substring(0, 200) + '" was claimed by **' + actor.name + '**.');
  }

    return { ok: true };
  } catch (e) { return { ok: false }; }
}

export async function completeTask(taskUid, actor, note) {
  try {
    const task = queryOne("SELECT description, target_id, target_type, created_by_id, notify_creator FROM tasks WHERE task_uid = ?", [taskUid]);
    run("DELETE FROM tasks WHERE task_uid = ?", [taskUid]);
    run("INSERT INTO task_log (action, actor, task_uid, description, target, created_at) VALUES ('COMPLETED', ?, ?, ?, 'Task Cleared', ?)",
      [actor.name, taskUid, task?.description || '', today()]);
    logAudit(actor.id, actor.name, 'DELETE', 'task', null, taskUid, 'Task completed and removed');
    if (task) {
      const leadershipRoleId = getRole('fm_leadership');
      const gameAffairsId = '1457189093594239147';
      const wasLeadershipTarget = task.target_type === 'Role' && (task.target_id === leadershipRoleId || task.target_id === gameAffairsId);
      if (wasLeadershipTarget && task.created_by_id && task.created_by_id !== actor.id) {
        const ch = getChannel('global_ping_channel');
        await sendDiscord(ch, `✅ <@${task.created_by_id}> — your task "${task.description}" has been completed by **${actor.name}**.`);
      }
    }
    return { ok: true };
  } catch (e) { return { ok: false }; }
}

export async function editTask(taskUid, newDesc, actor) {
  try {
    run("UPDATE tasks SET description = ? WHERE task_uid = ?", [newDesc, taskUid]);
    logAudit(actor.id, actor.name, 'EDIT', 'task', null, taskUid, newDesc.substring(0,100));
    return { ok: true };
  } catch (e) { return { ok: false }; }
}

export async function createReminder(data, actor) {
  try {
    const uuid = Math.random().toString(36).substring(2, 8);
    const targetTag = data.targetType === 'Role' ? `<@&${data.targetId}>` : `<@${data.targetId}>`;
    const readable = new Date(data.epochMs).toISOString();

    // All events/reminders go to the up-and-coming channel
    const leadershipRoleId2 = getRole('fm_leadership');
    const gameAffairsId2 = '1457189093594239147';
    const ch = (data.targetType === 'Role' && (data.targetId === leadershipRoleId2 || data.targetId === gameAffairsId2)) ? getChannel('leadership_channel') : getChannel('event_announce_channel');

    run("INSERT INTO reminders (uuid, author_id, channel_id, message, epoch_ms, readable_time, repeat_rule, target_tag, status) VALUES (?, ?, ?, ?, ?, ?, 'None', ?, 'ACTIVE')",
      [uuid, actor.id, ch, data.message, data.epochMs.toString(), readable, targetTag]);
    logAudit(actor.id, actor.name, 'CREATE', 'reminder', null, data.message.substring(0,50), `Scheduled for ${readable}`);

    // Announce
    const epoch = Math.floor(data.epochMs / 1000);
    const embeds = [{ title: `📌 ${data.eventType || 'Event'} Scheduled`, description: `**Time:** <t:${epoch}:F> (<t:${epoch}:R>)\n${data.note ? `**Details:** ${data.note}` : ''}\n\n*Via Meridian Dashboard*`, color: 0x5865F2 }];
    await sendDiscord(ch, targetTag, embeds);
    return { ok: true };
  } catch (e) { return { ok: false }; }
}

export async function snoozeReminder(uuid) {
  try {
    const r = queryOne("SELECT * FROM reminders WHERE uuid = ?", [uuid]);
    if (!r) return { ok: false };
    const newTime = parseInt(r.epoch_ms) + 3600000;
    run("UPDATE reminders SET epoch_ms = ?, readable_time = ?, status = 'ACTIVE' WHERE uuid = ?", [newTime.toString(), new Date(newTime).toISOString(), uuid]);
    return { ok: true };
  } catch (e) { return { ok: false }; }
}

export async function deleteReminder(uuid, actor) {
  try {
    run("DELETE FROM reminders WHERE uuid = ?", [uuid]);
    logAudit(actor.id, actor.name, 'DELETE', 'reminder', null, uuid, 'Reminder deleted');
    return { ok: true };
  } catch (e) { return { ok: false }; }
}

export async function getStaffList() {
  return query("SELECT discord_id, display_name, team_id, team_name, rank FROM staff WHERE discord_id != '' AND discord_id != 'Unassigned_Lead_Placeholder' ORDER BY display_name");
}

export async function getRoleTargets() {
  const leadershipId = getRole('fm_leadership');
  const leadId = getRole('fm_team_lead');
  const allFmId = getRole('fm_team_guide');
  const teams = query("SELECT DISTINCT team_id, team_name FROM staff WHERE team_id != '' AND team_name NOT IN ('FM Leadership','FM Team Leads','Faction Management')");
  return { leadershipId, leadId, allFmId, teams };
}


// Reassign an individually-assigned task — mirrors dashboard/actions.js reassignMyTask
export async function reassignTask(taskUid, newTargetId, newTargetType, note) {
  const actor = await requireActor(2);
  const task = queryOne("SELECT description, target_id, target_type, created_by_id FROM tasks WHERE task_uid = ?", [taskUid]);
  if (!task) return { ok: false, error: "Task not found" };
  // No restriction — L2+ can reassign any task.
  if (!['User', 'Role', 'Team'].includes(newTargetType)) {
    return { ok: false, error: "Invalid target type" };
  }
  if (!newTargetId) return { ok: false, error: "Missing target" };

  const leadershipRoleId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_leadership'")?.role_id || '';
  const gameAffairsId = '1457189093594239147';

  if (actor.level < 3) {
    if (newTargetType === 'Role' && (newTargetId === leadershipRoleId || newTargetId === gameAffairsId)) {
      return { ok: false, error: "L2 cannot reassign to FM Leadership or Game Affairs Management" };
    }
    if (newTargetType === 'User') {
      const staff = queryOne("SELECT rank FROM staff WHERE discord_id = ?", [newTargetId]);
      const rankStr = (staff?.rank || '').toLowerCase();
      if (rankStr.includes('leadership') || rankStr.includes('management') || rankStr.includes('game affairs')) {
        return { ok: false, error: "L2 cannot reassign tasks to L3 staff" };
      }
    }
  }

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
  }

  let _newNotifyCreator = 0;
  if (task.created_by_id) {
    const _creatorStaff = queryOne("SELECT rank FROM staff WHERE discord_id = ?", [task.created_by_id]);
    const _creatorRank = (_creatorStaff?.rank || '').toLowerCase();
    const _creatorIsLeadership = _creatorRank.includes('leadership') || _creatorRank.includes('management') || _creatorRank.includes('game affairs');
    const _newRoutesToLeadership = newTargetType === 'Role' && (newTargetId === leadershipRoleId || newTargetId === gameAffairsId);
    _newNotifyCreator = (!_creatorIsLeadership && _newRoutesToLeadership) ? 1 : 0;
  }
  run("UPDATE tasks SET target_id = ?, target_type = ?, claimed_by = 'None', notify_creator = ? WHERE task_uid = ?",
    [newTargetId, newTargetType, _newNotifyCreator, taskUid]);
  run("INSERT INTO task_log (action, actor, task_uid, description, target, created_at) VALUES ('REASSIGNED', ?, ?, ?, ?, ?)",
    [actor.name, taskUid, task.description || '', targetLabel, new Date().toISOString()]);
  logAudit(actor.id, actor.name, 'EDIT', 'task', null, taskUid, 'Reassigned to ' + targetLabel);

  const routeToLeadership = newTargetType === 'Role' && (newTargetId === leadershipRoleId || newTargetId === gameAffairsId);
  const ch = routeToLeadership ? getChannel('leadership_channel') : getChannel('global_ping_channel');
  const tag = newTargetType === 'Role' ? '<@&' + newTargetId + '>' : (newTargetType === 'User' ? '<@' + newTargetId + '>' : '@' + targetLabel);
  await sendDiscord(ch, '📋 **TASK REASSIGNED** | ' + tag + '\n**Reassigned By:** ' + actor.name + '\n**Task:** ' + (task.description || '').substring(0, 200));

  

  if (_newNotifyCreator === 1 && task.created_by_id && task.created_by_id !== actor.id) {
    const _gch = getChannel('global_ping_channel');
    await sendDiscord(_gch, '🔁 <@' + task.created_by_id + '> — your task "' + (task.description || '').substring(0, 200) + '" was reassigned by **' + actor.name + '** to ' + targetLabel + '.');
  }

  return { ok: true };
}

export async function unclaimTask(taskUid, note) {
  const actor = await requireActor(1);
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
  if (task.notify_creator === 1 && task.created_by_id && task.created_by_id !== actor.id) {
    const ch = getChannel('global_ping_channel');
    await sendDiscord(ch, '↩️ <@' + task.created_by_id + '> — your task "' + (task.description || '').substring(0, 200) + '" was unclaimed by **' + actor.name + '** and is available again.' + (note ? '\n**Note:** ' + note : ''));
  }
  return { ok: true };
}

export async function requestTaskInfo(taskUid, question) {
  const actor = await requireActor(1);
  if (!question || !question.trim()) return { ok: false, error: "Question is required" };
  const task = queryOne("SELECT description, target_type, target_id, created_by_id FROM tasks WHERE task_uid = ?", [taskUid]);
  if (!task) return { ok: false, error: "Task not found" };
  if (!task.created_by_id) return { ok: false, error: "Task has no recorded creator" };
  if (task.created_by_id === actor.id) return { ok: false, error: "You are the creator of this task" };

  const ch = _creatorPingChannel(task.created_by_id, task.target_type, task.target_id);
  if (!ch) return { ok: false, error: "Could not determine notification channel" };
    const _now_ri = new Date().toISOString();
  run("INSERT INTO task_questions (task_uid, asked_by_id, asked_by_name, question, asked_at) VALUES (?, ?, ?, ?, ?)",
    [taskUid, actor.id, actor.name, question.trim(), _now_ri]);
  const _replyUrl_ri = 'https://ecrpfm.com/fm/tasks/' + taskUid;
  await sendDiscord(ch, '❓ <@' + task.created_by_id + '> — **' + actor.name + '** has a question about your task "' + (task.description || '').substring(0, 200) + '":\n> ' + question.trim().replace(/\n/g, '\n> ') + '\n\n👉 Reply on the dashboard: ' + _replyUrl_ri);

  run("INSERT INTO task_log (action, actor, task_uid, description, target, created_at) VALUES ('INFO_REQUEST', ?, ?, ?, ?, ?)",
    [actor.name, taskUid, (task.description || '').substring(0, 200), question.substring(0, 300), new Date().toISOString()]);
  logAudit(actor.id, actor.name, 'EDIT', 'task', null, taskUid, 'Requested info: ' + question.substring(0, 100));

  return { ok: true };
}

export async function getTaskByUid(taskUid) {
  await requireActor(1);
  const task = queryOne("SELECT * FROM tasks WHERE task_uid = ?", [taskUid]);
  if (!task) return null;
  if (task.claimed_by && task.claimed_by !== 'None') {
    const claimer = queryOne("SELECT display_name FROM staff WHERE discord_id = ?", [task.claimed_by]);
    task.claimerName = claimer?.display_name || task.claimed_by;
  } else { task.claimerName = ''; }
  if (task.target_type === 'User') {
    const u = queryOne("SELECT display_name FROM staff WHERE discord_id = ?", [task.target_id]);
    task.targetLabel = u?.display_name || task.target_id;
  } else if (task.target_type === 'Team') {
    const t = queryOne("SELECT team_name FROM staff WHERE team_id = ? LIMIT 1", [task.target_id]);
    task.targetLabel = t?.team_name || task.target_id;
  } else if (task.target_type === 'Role') {
    const leadershipId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_leadership'")?.role_id || '';
    if (task.target_id === leadershipId) task.targetLabel = 'FM Leadership';
    else if (task.target_id === '1457189093594239147') task.targetLabel = 'Game Affairs Management';
    else task.targetLabel = task.target_id;
  } else { task.targetLabel = task.target_id; }
  return task;
}

export async function getTaskQuestions(taskUid) {
  await requireActor(1);
  return query("SELECT * FROM task_questions WHERE task_uid = ? ORDER BY asked_at ASC", [taskUid]);
}

export async function answerTaskQuestion(questionId, answer) {
  const actor = await requireActor(1);
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
  const ch = _creatorPingChannel(q.asked_by_id, task.target_type, task.target_id);
  if (ch) {
    const replyUrl = 'https://ecrpfm.com/fm/tasks/' + q.task_uid;
    await sendDiscord(ch, '💬 <@' + q.asked_by_id + '> — **' + actor.name + '** answered your question on task "' + (task.description || '').substring(0, 200) + '":\n> ' + answer.trim().replace(/\n/g, '\n> ') + '\n\n📋 ' + replyUrl);
  }
  run("INSERT INTO task_log (action, actor, task_uid, description, target, created_at) VALUES ('INFO_ANSWER', ?, ?, ?, ?, ?)",
    [actor.name, q.task_uid, (task.description || '').substring(0, 200), answer.substring(0, 300), now]);
  logAudit(actor.id, actor.name, 'EDIT', 'task', null, q.task_uid, 'Answered: ' + answer.substring(0, 100));
  return { ok: true };
}


// ── IC Contacts ──────────────────────────────────────────────────────────────

export async function getTeamIcContacts(teamId) {
  const staffInTeam = query("SELECT discord_id FROM staff WHERE team_id = ?", [teamId]);
  const factionIds = query(`
    SELECT DISTINCT f.id FROM factions f
    JOIN staff s ON s.discord_id = f.lead_discord_id
    WHERE s.team_id = ? AND f.archived = 0
  `, [teamId]).map(r => r.id);
  if (factionIds.length === 0) return [];
  const placeholders = factionIds.map(() => '?').join(',');
  return query(
    `SELECT * FROM faction_ic_contacts WHERE faction_id IN (${placeholders}) AND status != 'completed' ORDER BY submitted_at DESC`,
    factionIds
  );
}

export async function getTeamIcContactsAll(teamId) {
  const factionIds = query(`
    SELECT DISTINCT f.id FROM factions f
    JOIN staff s ON s.discord_id = f.lead_discord_id
    WHERE s.team_id = ? AND f.archived = 0
  `, [teamId]).map(r => r.id);
  if (factionIds.length === 0) return [];
  const placeholders = factionIds.map(() => '?').join(',');
  return query(
    `SELECT * FROM faction_ic_contacts WHERE faction_id IN (${placeholders}) ORDER BY submitted_at DESC LIMIT 50`,
    factionIds
  );
}

export async function assignIcContact(contactId, assignToId, assignToName) {
  const actor = await requireActor(1);
  const contact = queryOne("SELECT thread_id FROM faction_ic_contacts WHERE id=?", [contactId]);
  run("UPDATE faction_ic_contacts SET assigned_to=?, assigned_name=? WHERE id=?",
    [assignToId, assignToName, contactId]);
  logAudit(actor.id, actor.name, 'EDIT', 'ic_contact', null, contactId, `Assigned to ${assignToName}`);
  await postToThread(contact?.thread_id, `**Assigned** to ${assignToName} by ${actor.name}`);
  return { ok: true };
}

const STATUS_LABELS = {
  pending_discussion: 'Pending Discussion',
  pending_roleplay:   'Pending Roleplay',
};

export async function setIcContactStatus(contactId, status) {
  const actor = await requireActor(1);
  if (!STATUS_LABELS[status]) return { ok: false, error: 'Invalid status' };
  const contact = queryOne("SELECT thread_id FROM faction_ic_contacts WHERE id=?", [contactId]);
  run("UPDATE faction_ic_contacts SET status=? WHERE id=?", [status, contactId]);
  logAudit(actor.id, actor.name, 'EDIT', 'ic_contact', null, contactId, `Status → ${status}`);
  await postToThread(contact?.thread_id, `**Status updated** to ${STATUS_LABELS[status]} by ${actor.name}`);
  return { ok: true };
}

async function postToThread(threadId, content) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || !threadId) return;
  try {
    await fetch(`https://discord.com/api/v10/channels/${threadId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  } catch {}
}

export async function stageRoleplay(contactId, rpData) {
  const actor = await requireActor(2);
  const contact = queryOne(`
    SELECT c.*, f.name as faction_name
    FROM faction_ic_contacts c
    JOIN factions f ON f.id = c.faction_id
    WHERE c.id = ?
  `, [contactId]);
  if (!contact) return { ok: false, error: 'Not found' };

  // Create the RP change request through the existing cycle
  const { requestRPChange } = await import('../factions/actions.js');
  const rpResult = await requestRPChange({
    faction:  contact.faction_name,
    type:     rpData.type,
    turf:     rpData.turf     || 'N/A',
    oldValue: rpData.oldValue || 'N/A',
    newValue: rpData.newValue,
  }, actor);
  if (!rpResult?.ok) return { ok: false, error: 'Failed to create RP change request' };

  // Advance IC contact to pending_roleplay
  run("UPDATE faction_ic_contacts SET status='pending_roleplay' WHERE id=?", [contactId]);

  // Notify in thread
  let threadMsg = `**RP Staged** by ${actor.name}\n**Type:** ${rpData.type}`;
  if (rpData.type === 'NPC') threadMsg += `\n**Turf:** ${rpData.turf}\n**Current:** ${rpData.oldValue}\n**New:** ${rpData.newValue}`;
  else if (rpData.type === 'HQ') threadMsg += `\n**Old:** ${rpData.oldValue}\n**New:** ${rpData.newValue}`;
  else threadMsg += `\n**Details:** ${rpData.newValue}`;
  threadMsg += `\n\nAn RP change request has been submitted and is pending Leadership approval.`;
  await postToThread(contact.thread_id, threadMsg);

  logAudit(actor.id, actor.name, 'EDIT', 'ic_contact', null, contactId, `RP staged — ${rpData.type}`);
  return { ok: true };
}

export async function completeIcContact(contactId) {
  const actor = await requireActor(1);
  const contact = queryOne("SELECT * FROM faction_ic_contacts WHERE id=?", [contactId]);
  if (!contact) return { ok: false, error: 'Not found' };

  run("UPDATE faction_ic_contacts SET status='completed' WHERE id=?", [contactId]);

  await postToThread(contact.thread_id,
    `**Contact Completed** by ${actor.name} — this IC contact has been resolved and archived.`
  );

  logAudit(actor.id, actor.name, 'EDIT', 'ic_contact', null, contactId, 'Completed and archived');
  return { ok: true };
}

export async function getAllIcContacts() {
  await requireActor(3);
  const contacts = query(`
    SELECT c.*, t.team_name, t.team_id
    FROM faction_ic_contacts c
    LEFT JOIN factions f ON f.id = c.faction_id
    LEFT JOIN staff s ON s.discord_id = f.lead_discord_id
    LEFT JOIN teams t ON t.team_id = s.team_id
    ORDER BY c.submitted_at DESC
  `);
  return contacts;
}

export async function getThreadMessages(threadId) {
  await requireActor(3);
  if (!threadId) return [];
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return [];
  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${threadId}/messages?limit=50`, {
      headers: { Authorization: `Bot ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const msgs = await res.json();
    return msgs.reverse().map(m => ({
      id: m.id,
      content: m.content,
      author: m.author?.username || 'Unknown',
      authorBot: m.author?.bot || false,
      timestamp: m.timestamp,
    }));
  } catch { return []; }
}

export async function getIcContactFormData(factionId) {
  await requireActor(1);
  const npcs = query("SELECT id, name, npc_type, turf FROM npcs ORDER BY turf, npc_type, name");
  const npcTypes = [...new Set(npcs.map(n => n.npc_type))].sort();
  const properties = query(
    "SELECT id, address, is_hq FROM properties WHERE faction_id = ? ORDER BY is_hq DESC, address",
    [factionId]
  );
  return { npcs, npcTypes, properties };
}
