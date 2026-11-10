// The task lifecycle, implemented once for the dashboard (fm/dashboard,
// fm/teams, v2) and the bot (/todo, Claim/Done buttons, DM commands).
//
// Rules this module enforces, which the old copies did not agree on:
//   - a task is visible to its target, its claimer, its creator, the team role,
//     the all-FM role, team leads for the lead role, leadership for the
//     leadership and Game Affairs roles; every write checks visibility first
//   - a claim is always the actor's own; a claimed task cannot be claimed again
//   - completing keeps the row (status = completed) so Q&A, links and stats
//     survive; the creator is told what was completed, with a link
//   - ids are random, dates are ISO, every write is audited with the record id
//   - creator notifications take the confidentiality branch when the creator is
//     leadership AND the target is leadership-scoped
import { randomUUID } from 'node:crypto';
import { query, queryOne, run } from './db.js';
import { sendPing, getRole, taskComponents, urls } from './pings.js';
import { nowIso } from './dates.js';
import { isLeadershipStaff } from './actor.js';
import { str, missing, isSnowflake, fail, TASK_TARGET_TYPES } from './validate.js';

function audit(actor, action, targetId, label, details) {
  try {
    run("INSERT INTO site_audit_log (actor_id, actor_name, action, target_type, target_id, target_label, details, source) VALUES (?, ?, ?, 'task', ?, ?, ?, ?)",
      [actor.id || '', actor.name || '', action, String(targetId || ''), label || '', details || '', actor.source === 'bot' ? 'bot' : 'site']);
  } catch (e) { console.error('[AUDIT]', e.message); }
}

function log(action, actor, uid, description, target) {
  run("INSERT INTO task_log (action, actor, task_uid, description, target, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [action, actor.name, uid, description || '', target || '', nowIso()]);
}

export function roleIds() {
  return {
    leadership: getRole('fm_leadership'),
    gameAffairs: getRole('game_affairs'),
    lead: getRole('fm_team_lead'),
    guide: getRole('fm_team_guide'),
  };
}

/** Does a target route to the leadership (confidential) channel? */
export function routesToLeadership(targetType, targetId) {
  const r = roleIds();
  if (targetType === 'Role') return !!targetId && (targetId === r.leadership || targetId === r.gameAffairs);
  if (targetType === 'User') return isLeadershipStaff(targetId);
  return false;
}

/** Creator pings take the alt branch when the creator is leadership and the target is leadership-scoped. */
export function creatorRoutesAlt(createdById, targetType, targetId) {
  if (!createdById) return false;
  return isLeadershipStaff(createdById) && routesToLeadership(targetType, targetId);
}

export function getTask(uid) {
  return queryOne("SELECT * FROM tasks WHERE task_uid = ?", [uid]) || null;
}

/** The visibility rule, shared by every list and every write. */
export function canSeeTask(actor, task) {
  if (!task) return false;
  if (task.created_by_id && task.created_by_id === actor.id) return true;
  if (task.claimed_by === actor.id) return true;
  if (task.target_type === 'User') return task.target_id === actor.id || actor.level >= 3;
  if (task.target_type === 'Role') {
    const r = roleIds();
    if (task.target_id === actor.teamId) return true;
    if (task.target_id === r.guide) return true;
    if (actor.level >= 2 && task.target_id === r.lead) return true;
    if (actor.level >= 3) return true;                       // leadership sees every role task
  }
  return false;
}

/** All open (or `status`) tasks the actor may see, newest first. */
export function visibleTasks(actor, { status = 'open' } = {}) {
  const rows = status ? query("SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC", [status]) : query("SELECT * FROM tasks ORDER BY created_at DESC");
  return rows.filter(t => canSeeTask(actor, t));
}

export function targetLabel(task) {
  const r = roleIds();
  if (task.target_type === 'User') return queryOne("SELECT display_name FROM staff WHERE discord_id = ?", [task.target_id])?.display_name || 'User';
  if (task.target_id === r.leadership) return 'FM Leadership';
  if (task.target_id === r.gameAffairs) return 'Game Affairs';
  if (task.target_id === r.lead) return 'Team Leads';
  if (task.target_id === r.guide) return 'All FM';
  const team = queryOne("SELECT team_name FROM teams WHERE team_id = ?", [task.target_id]);
  if (team) return team.team_name;
  const role = queryOne("SELECT key FROM discord_roles WHERE role_id = ?", [task.target_id]);
  return role ? role.key : task.target_id;
}

export function claimerName(task) {
  if (!task.claimed_by || task.claimed_by === 'None') return 'Unclaimed';
  return queryOne("SELECT display_name FROM staff WHERE discord_id = ?", [task.claimed_by])?.display_name || task.claimed_by;
}

/** Decorate a task row with the labels every UI shows. */
export function decorate(task) {
  return { ...task, claimerName: claimerName(task), targetLabel: targetLabel(task), url: urls.task(task.task_uid) };
}

function validateTarget(targetType, targetId) {
  if (!TASK_TARGET_TYPES.includes(targetType)) return 'Target type must be Role or User.';
  const id = str(targetId);
  if (!id) return 'A target is required.';
  if (targetType === 'User') {
    if (!queryOne("SELECT 1 FROM staff WHERE discord_id = ? AND discord_id NOT LIKE 'placeholder%'", [id])) return 'That person is not on the staff roster.';
  } else {
    const known = queryOne("SELECT 1 FROM discord_roles WHERE role_id = ?", [id]) || queryOne("SELECT 1 FROM teams WHERE team_id = ?", [id]);
    if (!known && !isSnowflake(id)) return 'Unknown role.';
  }
  return null;
}

function mention(targetType, targetId) { return targetType === 'Role' ? `<@&${targetId}>` : `<@${targetId}>`; }

/**
 * Create a task. `data`: { desc, targetType, targetId, enableDM }.
 * Returns { ok, uid } or { ok:false, error }.
 */
export async function createTask(actor, data = {}, { via = '' } = {}) {
  const desc = str(data.desc ?? data.description, { max: 2000 });
  if (!desc) return fail('A description is required.');
  const targetType = str(data.targetType);
  const targetId = str(data.targetId);
  const bad = validateTarget(targetType, targetId);
  if (bad) return fail(bad);
  const uid = randomUUID();
  const now = nowIso();
  const nextReminder = data.enableDM ? String(Date.now() + 86400000) : null;
  const toLeadership = routesToLeadership(targetType, targetId);
  const notifyCreator = (!isLeadershipStaff(actor.id) && toLeadership) ? 1 : 0;
  run("INSERT INTO tasks (task_uid, description, target_id, target_type, claimed_by, created_by_id, created_by_name, next_reminder, created_at, notify_creator, status) VALUES (?, ?, ?, ?, 'None', ?, ?, ?, ?, ?, 'open')",
    [uid, desc, targetId, targetType, actor.id, actor.name, nextReminder, now, notifyCreator]);
  log('CREATED', actor, uid, desc, `${targetType}: ${targetId}`);
  audit(actor, 'CREATE', uid, desc.slice(0, 80), `Assigned to ${targetType} ${targetLabel({ target_type: targetType, target_id: targetId })}${via ? ` via ${via}` : ''}`);
  const selfAssign = targetType === 'User' && targetId === actor.id;
  if (!selfAssign) {
    await sendPing('task.assigned',
      `📋 **NEW TASK ASSIGNED** | ${mention(targetType, targetId)}\n**Task:** ${desc.slice(0, 300)}\n**Assigned By:** ${actor.name}`,
      { alt: toLeadership, components: taskComponents(uid) });
  }
  return { ok: true, uid };
}

export async function claimTask(actor, uid, { via = '' } = {}) {
  const task = getTask(uid);
  if (!task) return fail('Task not found.');
  if (task.status !== 'open') return fail('This task is already completed.');
  if (!canSeeTask(actor, task)) return fail('This task is not visible to you.');
  if (task.claimed_by && task.claimed_by !== 'None') {
    return fail(task.claimed_by === actor.id ? 'You already claimed this task.' : `Already claimed by ${claimerName(task)}.`);
  }
  run("UPDATE tasks SET claimed_by = ?, updated_at = ? WHERE task_uid = ?", [actor.id, nowIso(), uid]);
  log('CLAIMED', actor, uid, '', 'Claimed');
  audit(actor, 'EDIT', uid, task.description.slice(0, 80), `Claimed${via ? ` via ${via}` : ''}`);
  if (task.created_by_id && task.created_by_id !== actor.id) {
    await sendPing('task.claimed.creator',
      `🤚 <@${task.created_by_id}> — **${actor.name}** claimed a task you assigned: **${task.description.slice(0, 120)}**\n📋 ${urls.task(uid)}`,
      { alt: creatorRoutesAlt(task.created_by_id, task.target_type, task.target_id) });
  }
  return { ok: true };
}

export async function unclaimTask(actor, uid, note = '', { via = '' } = {}) {
  const task = getTask(uid);
  if (!task) return fail('Task not found.');
  if (task.status !== 'open') return fail('This task is already completed.');
  if (!task.claimed_by || task.claimed_by === 'None') return fail('This task is not claimed.');
  if (task.claimed_by !== actor.id && actor.level < 3) return fail('Only the claimer or leadership can release a task.');
  note = str(note, { max: 500 });
  run("UPDATE tasks SET claimed_by = 'None', next_reminder = NULL, updated_at = ? WHERE task_uid = ?", [nowIso(), uid]);
  log('UNCLAIMED', actor, uid, task.description, 'Unclaimed');
  audit(actor, 'EDIT', uid, task.description.slice(0, 80), `Released${note ? ` · ${note.slice(0, 100)}` : ''}${via ? ` via ${via}` : ''}`);
  if (task.created_by_id && task.created_by_id !== actor.id) {
    await sendPing('task.unclaimed.creator',
      `↩️ <@${task.created_by_id}> — **${actor.name}** released a task you assigned, it is open again: **${task.description.slice(0, 120)}**${note ? `\n**Note:** ${note}` : ''}\n📋 ${urls.task(uid)}`,
      { alt: creatorRoutesAlt(task.created_by_id, task.target_type, task.target_id) });
  }
  return { ok: true };
}

export async function completeTask(actor, uid, note = '', { via = '' } = {}) {
  const task = getTask(uid);
  if (!task) return fail('Task not found.');
  if (task.status !== 'open') return fail('This task is already completed.');
  if (!canSeeTask(actor, task)) return fail('This task is not visible to you.');
  note = str(note, { max: 500 });
  const now = nowIso();
  run("UPDATE tasks SET status = 'completed', completed_at = ?, completed_by_id = ?, completed_by_name = ?, completion_note = ?, next_reminder = NULL, updated_at = ? WHERE task_uid = ?",
    [now, actor.id, actor.name, note, now, uid]);
  log('COMPLETED', actor, uid, task.description, 'Done');
  audit(actor, 'COMPLETE', uid, task.description.slice(0, 80), `Completed${note ? ` · ${note.slice(0, 100)}` : ''}${via ? ` via ${via}` : ''}`);
  if (task.created_by_id && task.created_by_id !== actor.id) {
    await sendPing('task.completed.creator',
      `✅ <@${task.created_by_id}> — **${actor.name}** completed a task you created: **${task.description.slice(0, 120)}**${note ? `\n**Note:** ${note}` : ''}\n📋 ${urls.task(uid)}`,
      { alt: creatorRoutesAlt(task.created_by_id, task.target_type, task.target_id) });
  }
  return { ok: true };
}

export async function editTask(actor, uid, newDesc) {
  const task = getTask(uid);
  if (!task) return fail('Task not found.');
  if (task.status !== 'open') return fail('This task is already completed.');
  if (!canSeeTask(actor, task)) return fail('This task is not visible to you.');
  if (task.created_by_id !== actor.id && actor.level < 2) return fail('Only the creator or a team lead can edit a task.');
  const desc = str(newDesc, { max: 2000 });
  if (!desc) return fail('A description is required.');
  run("UPDATE tasks SET description = ?, updated_at = ? WHERE task_uid = ?", [desc, nowIso(), uid]);
  log('EDITED', actor, uid, desc, 'Edited');
  audit(actor, 'EDIT', uid, desc.slice(0, 80), 'Description edited');
  return { ok: true };
}

export async function reassignTask(actor, uid, newTargetId, newTargetType, note = '') {
  if (actor.level < 2) return fail('Only team leads and leadership can reassign tasks.');
  const task = getTask(uid);
  if (!task) return fail('Task not found.');
  if (task.status !== 'open') return fail('This task is already completed.');
  if (!canSeeTask(actor, task)) return fail('This task is not visible to you.');
  newTargetType = str(newTargetType);
  newTargetId = str(newTargetId);
  const bad = validateTarget(newTargetType, newTargetId);
  if (bad) return fail(bad);
  if (actor.level < 3) {
    const r = roleIds();
    if (newTargetType === 'Role' && (newTargetId === r.leadership || newTargetId === r.gameAffairs)) return fail('Team leads cannot assign tasks to leadership roles.');
    if (newTargetType === 'User' && isLeadershipStaff(newTargetId)) return fail('Team leads cannot assign tasks to leadership members.');
  }
  note = str(note, { max: 500 });
  const toLeadership = routesToLeadership(newTargetType, newTargetId);
  const notifyCreator = (!isLeadershipStaff(task.created_by_id) && toLeadership) ? 1 : 0;
  run("UPDATE tasks SET target_id = ?, target_type = ?, claimed_by = 'None', next_reminder = NULL, notify_creator = ?, updated_at = ? WHERE task_uid = ?",
    [newTargetId, newTargetType, notifyCreator, nowIso(), uid]);
  const label = targetLabel({ target_type: newTargetType, target_id: newTargetId });
  log('REASSIGNED', actor, uid, task.description, `${newTargetType}: ${newTargetId}`);
  audit(actor, 'EDIT', uid, task.description.slice(0, 80), `Reassigned to ${label}${note ? ` · ${note.slice(0, 100)}` : ''}`);
  await sendPing('task.reassigned',
    `🔁 **TASK REASSIGNED** | ${mention(newTargetType, newTargetId)}\n**Task:** ${task.description.slice(0, 300)}\n**Reassigned By:** ${actor.name}${note ? `\n**Note:** ${note}` : ''}`,
    { alt: toLeadership, components: taskComponents(uid) });
  if (task.created_by_id && task.created_by_id !== actor.id) {
    await sendPing('task.reassigned.creator',
      `🔁 <@${task.created_by_id}> — **${actor.name}** reassigned a task you created to ${label}: **${task.description.slice(0, 120)}**${note ? `\n**Note:** ${note}` : ''}\n📋 ${urls.task(uid)}`,
      { alt: creatorRoutesAlt(task.created_by_id, newTargetType, newTargetId) });
  }
  return { ok: true };
}

export async function requestTaskInfo(actor, uid, question) {
  const task = getTask(uid);
  if (!task) return fail('Task not found.');
  if (!canSeeTask(actor, task)) return fail('This task is not visible to you.');
  question = str(question, { max: 1000 });
  if (!question) return fail('A question is required.');
  if (task.created_by_id === actor.id) return fail('You created this task; edit it instead of asking yourself.');
  if (!task.created_by_id) return fail('This task has no creator to ask.');
  const now = nowIso();
  const ins = run("INSERT INTO task_questions (task_uid, asked_by_id, asked_by_name, question, asked_at) VALUES (?, ?, ?, ?, ?)", [uid, actor.id, actor.name, question, now]);
  const qid = Number(ins.lastInsertRowid);
  log('INFO_REQUEST', actor, uid, task.description, question.slice(0, 200));
  audit(actor, 'QUESTION', uid, task.description.slice(0, 80), question.slice(0, 120));
  await sendPing('task.question.asked',
    `❓ <@${task.created_by_id}> — **${actor.name}** has a question about your task **${task.description.slice(0, 120)}**:\n> ${question.replace(/\n/g, '\n> ')}\n\n📋 ${urls.task(uid)}`,
    { alt: creatorRoutesAlt(actor.id, task.target_type, task.target_id),
      components: [{ type: 1, components: [{ type: 2, style: 1, label: 'Answer', custom_id: `task_info_btn_${qid}` }, { type: 2, style: 5, label: 'Open', url: urls.task(uid) }] }] });
  return { ok: true, id: qid };
}

export async function answerTaskQuestion(actor, questionId, answer) {
  const q = queryOne("SELECT * FROM task_questions WHERE id = ?", [questionId]);
  if (!q) return fail('Question not found.');
  if (q.answer) return fail('Already answered.');
  const task = getTask(q.task_uid);
  if (!task) return fail('Task not found.');
  if (task.created_by_id && task.created_by_id !== actor.id && actor.level < 3) return fail('Only the task creator can answer this.');
  answer = str(answer, { max: 1000 });
  if (!answer) return fail('An answer is required.');
  const now = nowIso();
  run("UPDATE task_questions SET answer = ?, answered_by_id = ?, answered_by_name = ?, answered_at = ? WHERE id = ?", [answer, actor.id, actor.name, now, questionId]);
  log('INFO_ANSWER', actor, q.task_uid, task.description, answer.slice(0, 200));
  audit(actor, 'ANSWER', q.task_uid, task.description.slice(0, 80), answer.slice(0, 120));
  await sendPing('task.question.answered',
    `💬 <@${q.asked_by_id}> — **${actor.name}** answered your question about **${task.description.slice(0, 120)}**:\n> ${answer.replace(/\n/g, '\n> ')}\n\n📋 ${urls.task(q.task_uid)}`,
    { alt: creatorRoutesAlt(q.asked_by_id, task.target_type, task.target_id) });
  return { ok: true };
}

export function taskQuestions(uid) {
  return query("SELECT * FROM task_questions WHERE task_uid = ? ORDER BY asked_at ASC", [uid]);
}
