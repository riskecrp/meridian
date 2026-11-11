"use server";
// Dashboard / Home actions for both shells (fm/dashboard, v2 Home, v2 Tasks,
// v2 Inbox, v2 task detail). Every task write is a thin wrapper over
// shared/tasks.js (requireActor → shared fn → revalidatePath); reads use
// visibleTasks + decorate so the two shells, the bot and the Discord buttons
// agree on who may see and touch a task.
//
// Gates: writes need L1+ (Event Team and Lead Storytellers are read-only here,
// policy 4 / 3). Reads keep the actor's REAL level — the Event Team boost that
// requireActor(…, { allowEventTeam }) applies never reaches a visibility rule.
import { revalidatePath } from "next/cache";
import { query, queryOne, run } from "../../../lib/db.js";
import { logAudit } from "../../../lib/audit.js";
import { getChannel } from "../../../lib/discord.js";
import { sendPing, pingChannel } from "../../../lib/pings.js";
import { requireActor, getActor } from "../../../lib/requireActor.js";
import * as Tasks from "../../../../../shared/tasks.js";
import { str, toNum, fail, isSnowflake, TASK_TARGET_TYPES, TASK_STATUSES } from "../../../../../shared/validate.js";
import { nowIso } from "../../../../../shared/dates.js";
import { randomUUID } from "node:crypto";

const TASK_PATHS = ["/v2", "/v2/tasks", "/v2/inbox", "/fm/dashboard"];
function bump(uid) {
  for (const p of TASK_PATHS) revalidatePath(p);
  if (uid) { revalidatePath(`/v2/tasks/${uid}`); revalidatePath(`/fm/tasks/${uid}`); }
}

function authError(code, message) { const e = new Error(message); e.code = code; return e; }

/** Read gate: L1+, Event Team and (by default) Lead Storytellers, with the real level kept. Throws like requireActor. */
async function reader({ lst = true } = {}) {
  const actor = await getActor();
  if (!actor) throw authError("AUTH_REQUIRED", "Not authenticated");
  if (actor.level < 1 && !actor.isEventTeam && !(lst && actor.isLeadStoryteller)) {
    throw authError("AUTH_INSUFFICIENT", `Insufficient clearance (need L1, have L${actor.level})`);
  }
  return actor;
}

/** Write gate: never throws — returns { actor } or { error } so forms can show the reason. */
async function writer(minLevel = 1) {
  try {
    return { actor: await requireActor(minLevel) };
  } catch (e) {
    if (e.code === "AUTH_REQUIRED") return { error: "Not authenticated." };
    const a = await getActor();
    if (a?.isEventTeam && a.level < minLevel) return { error: "Event Team access is read-only here." };
    if (a?.isLeadStoryteller && a.level < minLevel) return { error: "Lead Storyteller access is read-only here." };
    return { error: e.message || "Not allowed." };
  }
}

// ── TASK READS ─────────────────────────────────────────────────────────────

const isMine = (actor, t) => (t.target_type === "User" && t.target_id === actor.id) || t.claimed_by === actor.id;
// Visible through a role/team/leadership rule rather than only because I created or claimed it.
const teamScoped = (actor, t) => t.target_type === "Role" && Tasks.canSeeTask({ ...actor, id: "" }, t);

/** Open tasks visible to me, split into assignedToMe / forMyTeam (role-scoped). */
export async function getMyTasks() {
  const actor = await reader();
  const visible = Tasks.visibleTasks(actor).map(Tasks.decorate);
  return {
    assignedToMe: visible.filter(t => isMine(actor, t)),
    forMyTeam: visible.filter(t => !isMine(actor, t) && teamScoped(actor, t)),
  };
}

function teamContextOf(t) {
  const r = Tasks.roleIds();
  if (t.target_type === "User") return queryOne("SELECT team_name FROM staff WHERE discord_id = ?", [t.target_id])?.team_name || "";
  if (t.target_id === r.leadership || t.target_id === r.gameAffairs) return "Leadership";
  if (t.target_id === r.lead || t.target_id === r.guide) return "All Teams";
  return queryOne("SELECT team_name FROM teams WHERE team_id = ?", [t.target_id])?.team_name || "";
}

/** Every task on the server (L3), newest first. `status` = 'open' (default) | 'completed' | 'removed' | null for all. */
export async function getAllServerTasks({ status = "open" } = {}) {
  await requireActor(3);
  const st = status === null ? null : (TASK_STATUSES.includes(status) ? status : "open");
  const rows = st ? query("SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC", [st]) : query("SELECT * FROM tasks ORDER BY created_at DESC");
  return rows.map(t => ({ ...Tasks.decorate(t), teamContext: teamContextOf(t) }));
}

/** Tasks I created (open by default). Self-scoped, so L1 is enough. */
export async function getMyCreatedTasks({ status = "open" } = {}) {
  const actor = await reader();
  const st = status === null ? null : (TASK_STATUSES.includes(status) ? status : "open");
  const rows = st
    ? query("SELECT * FROM tasks WHERE created_by_id = ? AND status = ? ORDER BY created_at DESC", [actor.id, st])
    : query("SELECT * FROM tasks WHERE created_by_id = ? ORDER BY created_at DESC", [actor.id]);
  return rows.map(Tasks.decorate);
}

/** Open tasks aimed at my team role, my team's members, or the shared lead / all-FM roles. L2+. */
export async function getMyTeamAllTasks() {
  const actor = await requireActor(2);
  const teamId = actor.teamId || "";
  const memberIds = teamId ? query("SELECT discord_id FROM staff WHERE team_id = ? AND COALESCE(active, 1) = 1", [teamId]).map(m => m.discord_id) : [];
  const r = Tasks.roleIds();
  const roleTargets = [teamId, r.lead, r.guide].filter(Boolean);
  if (!roleTargets.length && !memberIds.length) return [];
  const clauses = [], params = [];
  if (roleTargets.length) { clauses.push(`(target_type = 'Role' AND target_id IN (${roleTargets.map(() => "?").join(",")}))`); params.push(...roleTargets); }
  if (memberIds.length) { clauses.push(`(target_type = 'User' AND target_id IN (${memberIds.map(() => "?").join(",")}))`); params.push(...memberIds); }
  return query(`SELECT * FROM tasks WHERE status = 'open' AND (${clauses.join(" OR ")}) ORDER BY created_at DESC`, params).map(Tasks.decorate);
}

/** One task by uid, decorated — null when missing or not visible to me (legacy Q&A page). */
export async function getTaskByUid(taskUid) {
  const actor = await reader();
  const task = Tasks.getTask(str(taskUid));
  if (!task || !Tasks.canSeeTask(actor, task)) return null;
  return Tasks.decorate(task);
}

/** Q&A rows for a task I can see, oldest first. */
export async function getTaskQuestions(taskUid) {
  const actor = await reader();
  const task = Tasks.getTask(str(taskUid));
  if (!task || !Tasks.canSeeTask(actor, task)) return [];
  return Tasks.taskQuestions(task.task_uid);
}

/**
 * The v2 task page in one call: the task, its Q&A thread and what THIS actor
 * may do to it (mirrors the gates in shared/tasks.js so buttons only show when
 * the server would say yes).
 */
export async function getTaskDetail(taskUid) {
  const actor = await reader();
  const task = Tasks.getTask(str(taskUid));
  if (!task) return fail("Task not found.");
  if (!Tasks.canSeeTask(actor, task)) return fail("This task is not visible to you.");
  const open = task.status === "open";
  const claimed = !!task.claimed_by && task.claimed_by !== "None";
  const writes = actor.level >= 1;                 // ET / LST are read-only
  const isCreator = !!task.created_by_id && task.created_by_id === actor.id;
  const can = {
    claim: writes && open && !claimed,
    unclaim: writes && open && claimed && (task.claimed_by === actor.id || actor.level >= 3),
    complete: writes && open,
    edit: writes && open && (isCreator || actor.level >= 2),
    reassign: writes && open && actor.level >= 2,
    ask: writes && !!task.created_by_id && !isCreator,
    answer: writes && (isCreator || actor.level >= 3),
  };
  return { ok: true, task: Tasks.decorate(task), questions: Tasks.taskQuestions(task.task_uid), can, me: actor.id };
}

// Map of task_uid → { open, total } question counts.
export async function getQACountsForTasks(taskUids) {
  await reader();
  if (!Array.isArray(taskUids) || taskUids.length === 0) return {};
  const uids = taskUids.map(u => str(u)).filter(Boolean).slice(0, 500);
  if (!uids.length) return {};
  const rows = query(
    `SELECT task_uid, SUM(CASE WHEN answer IS NULL OR answer = '' THEN 1 ELSE 0 END) AS open_count, COUNT(*) AS total_count
     FROM task_questions WHERE task_uid IN (${uids.map(() => "?").join(",")}) GROUP BY task_uid`, uids);
  const map = {};
  rows.forEach(r => { map[r.task_uid] = { open: r.open_count || 0, total: r.total_count || 0 }; });
  return map;
}

// ── TASK WRITES (thin wrappers over shared/tasks.js) ───────────────────────

export async function createMyTask(data) {
  const g = await writer(1); if (g.error) return fail(g.error);
  const r = await Tasks.createTask(g.actor, data || {}, { via: "dashboard" });
  if (r.ok) bump(r.uid);
  return r;
}

export async function claimMyTask(taskUid) {
  const g = await writer(1); if (g.error) return fail(g.error);
  const r = await Tasks.claimTask(g.actor, str(taskUid), { via: "dashboard" });
  if (r.ok) bump(str(taskUid));
  return r;
}

export async function unclaimMyTask(taskUid, note) {
  const g = await writer(1); if (g.error) return fail(g.error);
  const r = await Tasks.unclaimTask(g.actor, str(taskUid), note, { via: "dashboard" });
  if (r.ok) bump(str(taskUid));
  return r;
}

export async function completeMyTask(taskUid, note) {
  const g = await writer(1); if (g.error) return fail(g.error);
  const r = await Tasks.completeTask(g.actor, str(taskUid), note, { via: "dashboard" });
  if (r.ok) bump(str(taskUid));
  return r;
}

export async function editMyTask(taskUid, newDesc) {
  const g = await writer(1); if (g.error) return fail(g.error);
  const r = await Tasks.editTask(g.actor, str(taskUid), newDesc);
  if (r.ok) bump(str(taskUid));
  return r;
}

/** Reassign (L2+). 'Team' is the legacy spelling of a team role: it maps to Role=<team id>. */
export async function reassignMyTask(taskUid, newTargetId, newTargetType, note) {
  const g = await writer(2); if (g.error) return fail(g.error);
  const type = str(newTargetType) === "Team" ? "Role" : str(newTargetType);
  const r = await Tasks.reassignTask(g.actor, str(taskUid), newTargetId, type, note);
  if (r.ok) bump(str(taskUid));
  return r;
}

export async function requestTaskInfo(taskUid, question) {
  const g = await writer(1); if (g.error) return fail(g.error);
  const r = await Tasks.requestTaskInfo(g.actor, str(taskUid), question);
  if (r.ok) bump(str(taskUid));
  return r;
}

export async function answerTaskQuestion(questionId, answer) {
  const g = await writer(1); if (g.error) return fail(g.error);
  const qid = Number(questionId);
  if (!Number.isInteger(qid) || qid <= 0) return fail("Question not found.");
  const r = await Tasks.answerTaskQuestion(g.actor, qid, answer);
  if (r.ok) bump(queryOne("SELECT task_uid FROM task_questions WHERE id = ?", [qid])?.task_uid);
  return r;
}

// ── REMINDERS (one-off events) ────────────────────────────────────────────

function validateTarget(targetType, targetId) {
  if (!TASK_TARGET_TYPES.includes(targetType)) return "Target type must be Role or User.";
  if (!targetId) return "A target is required.";
  if (targetType === "User") {
    if (!queryOne("SELECT 1 FROM staff WHERE discord_id = ? AND discord_id NOT LIKE 'placeholder%' AND COALESCE(active, 1) = 1", [targetId])) return "That person is not on the staff roster.";
    return null;
  }
  const known = queryOne("SELECT 1 FROM discord_roles WHERE role_id = ?", [targetId]) || queryOne("SELECT 1 FROM teams WHERE team_id = ?", [targetId]);
  if (!known && !isSnowflake(targetId)) return "Unknown role.";
  return null;
}

function reminderDecorate(r) {
  const author = queryOne("SELECT display_name FROM staff WHERE discord_id = ?", [r.author_id]);
  return { ...r, authorName: author?.display_name || r.author_id, epochMs: parseInt(r.epoch_ms, 10) };
}

/** ACTIVE/WARNED reminders aimed at me or my roles; leadership sees the whole calendar. */
export async function getMyReminders() {
  const actor = await reader();
  const r = Tasks.roleIds();
  const all = query("SELECT * FROM reminders WHERE status IN ('ACTIVE','WARNED') ORDER BY CAST(epoch_ms AS INTEGER)");
  return all.filter(row => {
    if (actor.level >= 3) return true;
    if (row.author_id === actor.id) return true;
    const userMatch = row.target_tag?.match(/<@!?(\d+)>/);
    const roleMatch = row.target_tag?.match(/<@&([^>]+)>/);
    if (userMatch && userMatch[1] === actor.id) return true;
    if (roleMatch) {
      const rid = roleMatch[1];
      if (rid && rid === actor.teamId) return true;
      if (rid === r.guide) return true;
      if (actor.level >= 2 && rid === r.lead) return true;
    }
    return false;
  }).map(reminderDecorate);
}

export async function createMyReminder(data = {}) {
  const g = await writer(1); if (g.error) return fail(g.error);
  const actor = g.actor;
  const message = str(data.message, { max: 500 });
  if (!message) return fail("A message is required.");
  const epochMs = toNum(data.epochMs);
  if (!epochMs || epochMs < 946684800000) return fail("A valid date and time is required.");
  if (epochMs < Date.now()) return fail("The event time must be in the future.");
  const targetType = str(data.targetType), targetId = str(data.targetId);
  const bad = validateTarget(targetType, targetId);
  if (bad) return fail(bad);
  const uuid = randomUUID().replace(/-/g, "").slice(0, 10);
  const targetTag = targetType === "Role" ? `<@&${targetId}>` : `<@${targetId}>`;
  const eventAlt = Tasks.routesToLeadership(targetType, targetId);
  const ch = pingChannel("event.created", { alt: eventAlt, ignoreEnabled: true });
  const readable = new Date(epochMs).toISOString();
  run("INSERT INTO reminders (uuid, author_id, channel_id, message, epoch_ms, readable_time, repeat_rule, target_tag, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'None', ?, 'ACTIVE', ?)",
    [uuid, actor.id, ch, message, String(epochMs), readable, targetTag, nowIso()]);
  logAudit(actor.id, actor.name, "CREATE", "reminder", uuid, message.slice(0, 80), `Scheduled for ${readable} · ${targetType} ${targetId}`);
  const epoch = Math.floor(epochMs / 1000);
  const note = str(data.note, { max: 500 });
  const embeds = [{ title: `📌 ${str(data.eventType, { max: 60 }) || "Event"} Scheduled`, description: `**Time:** <t:${epoch}:F> (<t:${epoch}:R>)${note ? `\n**Details:** ${note}` : ""}\n\n*Via Meridian Dashboard*`, color: 0x5865F2 }];
  await sendPing("event.created", targetTag, { alt: eventAlt, embeds });
  bump();
  return { ok: true, uuid };
}

/** Push a reminder back by one hour. Author or L2+; audited. */
export async function snoozeMyReminder(uuid) {
  const g = await writer(1); if (g.error) return fail(g.error);
  const actor = g.actor;
  const r = queryOne("SELECT * FROM reminders WHERE uuid = ?", [str(uuid)]);
  if (!r) return fail("Reminder not found.");
  if (r.author_id !== actor.id && actor.level < 2) return fail("Only the author or a team lead can snooze this reminder.");
  if (!["ACTIVE", "WARNED"].includes(r.status)) return fail("This reminder has already fired.");
  const newTime = Math.max(parseInt(r.epoch_ms, 10) || 0, Date.now()) + 3600000;
  run("UPDATE reminders SET epoch_ms = ?, readable_time = ?, status = 'ACTIVE' WHERE uuid = ?", [String(newTime), new Date(newTime).toISOString(), r.uuid]);
  logAudit(actor.id, actor.name, "EDIT", "reminder", r.uuid, r.message.slice(0, 80), `Snoozed 1h → ${new Date(newTime).toISOString()}`);
  bump();
  return { ok: true, epochMs: newTime };
}

/**
 * Fix an event's time / type / details after the fact. Author or L2+, same rule
 * as snooze/delete. The row goes back to ACTIVE so the 30-minute warning re-arms
 * against the corrected time, and an "Updated" notice goes out through the same
 * route the original announcement used — that post can't be edited in place
 * (sendPing keeps no message id). `data`: { epochMs, eventType, note }.
 */
export async function editMyReminder(uuid, data = {}) {
  const g = await writer(1); if (g.error) return fail(g.error);
  const actor = g.actor;
  const r = queryOne("SELECT * FROM reminders WHERE uuid = ?", [str(uuid)]);
  if (!r) return fail("Event not found — it may have already fired.");
  if (r.author_id !== actor.id && actor.level < 2) return fail("Only the author or a team lead can edit this event.");
  if (!["ACTIVE", "WARNED"].includes(r.status)) return fail("This event has already fired.");
  const epochMs = toNum(data.epochMs);
  if (!epochMs || epochMs < 946684800000) return fail("A valid date and time is required.");
  if (epochMs <= Date.now()) return fail("The event time must be in the future.");
  const eventType = str(data.eventType, { max: 60 });
  const note = str(data.note, { max: 500 });
  const message = (eventType ? `[${eventType}] ${note}` : note).trim();
  if (!message) return fail("Details are required.");

  const oldMs = parseInt(r.epoch_ms, 10) || 0;
  const readable = new Date(epochMs).toISOString();
  run("UPDATE reminders SET message = ?, epoch_ms = ?, readable_time = ?, status = 'ACTIVE' WHERE uuid = ?",
    [message, String(epochMs), readable, r.uuid]);
  const timeChanged = oldMs !== epochMs;
  logAudit(actor.id, actor.name, "EDIT", "reminder", r.uuid, message.slice(0, 80),
    timeChanged ? `Rescheduled ${new Date(oldMs).toISOString()} → ${readable}` : "Details edited");

  if (timeChanged || message !== r.message) {
    const roleMatch = r.target_tag?.match(/<@&([^>]+)>/);
    const userMatch = r.target_tag?.match(/<@!?(\d+)>/);
    const eventAlt = roleMatch ? Tasks.routesToLeadership("Role", roleMatch[1])
      : userMatch ? Tasks.routesToLeadership("User", userMatch[1]) : false;
    const epoch = Math.floor(epochMs / 1000);
    const lines = [`**Time:** <t:${epoch}:F> (<t:${epoch}:R>)`];
    if (timeChanged && oldMs) lines.push(`~~Was <t:${Math.floor(oldMs / 1000)}:F>~~`);
    if (note) lines.push(`**Details:** ${note}`);
    lines.push("", `*Updated by ${actor.name} via Meridian Dashboard*`);
    const embeds = [{ title: `📝 ${eventType || "Event"} ${timeChanged ? "Rescheduled" : "Updated"}`, description: lines.join("\n"), color: 0xF0B232 }];
    if (roleMatch || userMatch) await sendPing("event.created", r.target_tag, { alt: eventAlt, embeds });
  }
  bump();
  return { ok: true };
}

export async function deleteMyReminder(uuid) {
  const g = await writer(1); if (g.error) return fail(g.error);
  const actor = g.actor;
  const r = queryOne("SELECT * FROM reminders WHERE uuid = ?", [str(uuid)]);
  if (!r) return fail("Reminder not found.");
  if (r.author_id !== actor.id && actor.level < 2) return fail("Only the author or a team lead can delete this reminder.");
  run("DELETE FROM reminders WHERE uuid = ?", [r.uuid]);
  logAudit(actor.id, actor.name, "DELETE", "reminder", r.uuid, r.message.slice(0, 80), "Reminder deleted");
  bump();
  return { ok: true };
}

// ── PICKER DATA ───────────────────────────────────────────────────────────

export async function getStaffForCreate() {
  await reader();
  return query("SELECT discord_id, display_name, team_id, team_name, rank, clearance FROM staff WHERE discord_id != '' AND discord_id NOT LIKE 'placeholder%' AND COALESCE(active, 1) = 1 ORDER BY display_name");
}

/** Role / team ids for the target pickers — all read from discord_roles / teams, never a constant. */
export async function getRoleTargetsForCreate() {
  await reader();
  const r = Tasks.roleIds();
  let teams = query("SELECT team_id, team_name FROM teams WHERE team_id != '' ORDER BY team_name");
  if (!teams.length) teams = query("SELECT DISTINCT team_id, team_name FROM staff WHERE team_id != '' AND team_name != 'Game Affairs Management' ORDER BY team_name");
  return { leadershipId: r.leadership, leadId: r.lead, allFmId: r.guide, gameAffairsId: r.gameAffairs, teams };
}

// Factions in my scope (team-led for L1/L2; all for L3 and Lead Storytellers), with scene counts.
export async function getMyTeamFactions() {
  const actor = await reader();
  const all = actor.level >= 3 || actor.isLeadStoryteller;
  let factions;
  if (all) {
    factions = query("SELECT id, name, tier, lead_discord_id, last_promoted, pending_promo, forum_posts_30d FROM factions WHERE archived = 0 ORDER BY name");
  } else {
    if (!actor.teamId) return { teamName: actor.teamName || "", factions: [] };
    const teamIds = query("SELECT discord_id FROM staff WHERE team_id = ?", [actor.teamId]).map(x => x.discord_id);
    if (!teamIds.length) return { teamName: actor.teamName || "", factions: [] };
    factions = query(`SELECT id, name, tier, lead_discord_id, last_promoted, pending_promo, forum_posts_30d FROM factions WHERE archived = 0 AND lead_discord_id IN (${teamIds.map(() => "?").join(",")}) ORDER BY name`, teamIds);
  }
  return {
    teamName: all ? "All Factions" : (actor.teamName || ""),
    factions: factions.map(f => ({
      ...f,
      scenes30d: queryOne("SELECT COUNT(*) AS c FROM scene_logs WHERE faction_id = ? AND created_at >= datetime('now','-30 days')", [f.id])?.c || 0,
      scenesAll: queryOne("SELECT COUNT(*) AS c FROM scene_logs WHERE faction_id = ?", [f.id])?.c || 0,
      leadName: queryOne("SELECT display_name FROM staff WHERE discord_id = ?", [f.lead_discord_id])?.display_name || "Unassigned",
    })),
  };
}

// ── RECURRING REMINDERS — dashboard cards ────────────────────────────────

// Open instances for me, scoped by the channels my level can see
// (L1: global ping channel · L2: + team-lead channel · L3: all).
export async function getMyRecurringInstances() {
  const actor = await reader();
  const globalCh = getChannel("global_ping_channel");
  const teamLeadCh = getChannel("team_lead_channel");
  let visibleChannels = null;
  if (actor.level < 3) visibleChannels = (actor.level >= 2 ? [globalCh, teamLeadCh] : [globalCh]).filter(Boolean);
  let sql = `SELECT i.*, r.title, r.body, r.links, r.channel_id, r.ping_day, r.due_day, r.target_type, r.target_id
    FROM recurring_reminder_instances i JOIN recurring_reminders r ON i.reminder_id = r.id
    WHERE i.recipient_id = ? AND i.completed_at IS NULL AND r.active = 1`;
  const params = [actor.id];
  if (visibleChannels !== null) {
    if (!visibleChannels.length) return [];
    sql += ` AND r.channel_id IN (${visibleChannels.map(() => "?").join(",")})`;
    params.push(...visibleChannels);
  }
  sql += " ORDER BY i.year DESC, i.month DESC, r.due_day ASC";
  return query(sql, params);
}

// Mark an instance done (recipient, or L3 for anyone). Audited with the instance id.
export async function completeMyRecurringInstance(instanceId) {
  const g = await writer(1); if (g.error) return fail(g.error);
  const actor = g.actor;
  const id = Number(instanceId);
  if (!Number.isInteger(id) || id <= 0) return fail("Instance not found.");
  const inst = queryOne("SELECT * FROM recurring_reminder_instances WHERE id = ?", [id]);
  if (!inst) return fail("Instance not found.");
  if (inst.completed_at) return fail("Already completed.");
  if (inst.recipient_id !== actor.id && actor.level < 3) return fail("You can only complete your own instance (leadership can complete others').");
  run("UPDATE recurring_reminder_instances SET completed_at = ?, completed_by_id = ?, completed_by_name = ? WHERE id = ? AND completed_at IS NULL", [nowIso(), actor.id, actor.name, id]);
  logAudit(actor.id, actor.name, "EDIT", "recurring_reminder_instance", id, inst.recipient_name || "", inst.recipient_id === actor.id ? "Self completed" : `Completed for ${inst.recipient_name || inst.recipient_id}`);
  bump();
  return { ok: true };
}

// ── Watch Role Pings (team-scoped; L3 and Lead Storytellers see all) ─────

function teamConfigIds(actor) {
  if (actor.level >= 3 || actor.isLeadStoryteller) return null; // null = all configs
  if (!actor.teamId) return [];
  const teamIds = query("SELECT discord_id FROM staff WHERE team_id = ?", [actor.teamId]).map(x => x.discord_id);
  if (!teamIds.length) return [];
  const factionIds = query(`SELECT id FROM factions WHERE lead_discord_id IN (${teamIds.map(() => "?").join(",")}) AND archived = 0`, teamIds).map(f => f.id);
  if (!factionIds.length) return [];
  return query(`SELECT id FROM bot_server_configs WHERE faction_id IN (${factionIds.map(() => "?").join(",")})`, factionIds).map(c => c.id);
}
const inScope = (ids, configId) => ids === null || ids.includes(configId);

export async function getTeamWatchPings() {
  const actor = await reader();
  const ids = teamConfigIds(actor);
  if (ids !== null && ids.length === 0) return [];
  const where = ids === null ? "" : `WHERE wrm.config_id IN (${ids.map(() => "?").join(",")})`;
  return query(`SELECT wrm.*, bsc.guild_name AS server_name, f.name AS faction_name
    FROM watch_role_mentions wrm
    LEFT JOIN bot_server_configs bsc ON wrm.config_id = bsc.id
    LEFT JOIN factions f ON bsc.faction_id = f.id
    ${where} ORDER BY wrm.is_read ASC, wrm.created_at DESC LIMIT 150`, ids || []);
}

export async function markWatchPingRead(id) {
  const actor = await reader();
  const ping = queryOne("SELECT id, config_id FROM watch_role_mentions WHERE id = ?", [Number(id)]);
  if (!ping) return fail("Ping not found.");
  if (!inScope(teamConfigIds(actor), ping.config_id)) return fail("That ping is outside your team's servers.");
  run("UPDATE watch_role_mentions SET is_read = 1 WHERE id = ?", [ping.id]);
  return { ok: true };
}

export async function markAllWatchPingsRead() {
  const actor = await reader();
  const ids = teamConfigIds(actor);
  if (ids === null) run("UPDATE watch_role_mentions SET is_read = 1 WHERE is_read = 0");
  else if (ids.length) run(`UPDATE watch_role_mentions SET is_read = 1 WHERE config_id IN (${ids.map(() => "?").join(",")}) AND is_read = 0`, ids);
  return { ok: true };
}

/** Reply in the faction server as the bot, attributed to the staffer, replying to the pinged message. */
async function discordReply(channelId, ref, text, actor, color) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return fail("Bot token not configured.");
  const body = {
    embeds: [{ description: text, author: { name: `${actor.displayName || actor.name} · Dashboard Reply` }, color }],
    message_reference: { message_id: ref.message_id, channel_id: ref.channel_id, guild_id: ref.guild_id, fail_if_not_exists: false },
    allowed_mentions: { parse: [] },
  };
  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST", headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!res.ok) { console.error("[DASHBOARD REPLY]", res.status, await res.text().catch(() => "")); return fail(`Discord error ${res.status}`); }
    return { ok: true };
  } catch (e) { return fail(e.message); }
}

export async function replyToWatchPing(id, replyText) {
  const g = await writer(1); if (g.error) return fail(g.error);
  const actor = g.actor;
  const text = str(replyText, { max: 2000 });
  if (!text) return fail("Message is empty.");
  const ping = queryOne("SELECT * FROM watch_role_mentions WHERE id = ?", [Number(id)]);
  if (!ping) return fail("Ping not found.");
  if (!inScope(teamConfigIds(actor), ping.config_id)) return fail("That ping is outside your team's servers.");
  const r = await discordReply(ping.channel_id, ping, text, actor, 0x34d399);
  if (!r.ok) return r;
  run("UPDATE watch_role_mentions SET is_read = 1 WHERE id = ?", [ping.id]);
  logAudit(actor.id, actor.name, "SEND", "discord_reply", ping.id, `#${ping.channel_name || ping.channel_id} (${ping.guild_name || ping.guild_id})`, text.slice(0, 200));
  return { ok: true };
}

// ── Personal mentions ─────────────────────────────────────────────────────

export async function getMyMentions() {
  const actor = await reader();
  return query(`SELECT m.id, m.message_id, m.channel_id, m.channel_name, m.author_id, m.author_name, m.content, m.guild_id, m.created_at, m.is_read,
      COALESCE(bsc.guild_name, m.guild_name, 'ECRP FM Discord') AS guild_name
    FROM mentions m LEFT JOIN bot_server_configs bsc ON bsc.guild_id = m.guild_id
    WHERE m.target_user_id = ? ORDER BY m.is_read ASC, m.created_at DESC LIMIT 100`, [actor.id]);
}

export async function markMentionRead(id) {
  const actor = await reader();
  const r = run("UPDATE mentions SET is_read = 1 WHERE id = ? AND target_user_id = ?", [Number(id), actor.id]);
  return r.changes ? { ok: true } : fail("Mention not found.");
}

export async function markAllMentionsRead() {
  const actor = await reader();
  run("UPDATE mentions SET is_read = 1 WHERE target_user_id = ? AND is_read = 0", [actor.id]);
  return { ok: true };
}

export async function replyToMention(mentionId, replyText) {
  const g = await writer(1); if (g.error) return fail(g.error);
  const actor = g.actor;
  const text = str(replyText, { max: 2000 });
  if (!text) return fail("Message is empty.");
  const mention = queryOne("SELECT * FROM mentions WHERE id = ? AND target_user_id = ?", [Number(mentionId), actor.id]);
  if (!mention) return fail("Mention not found.");
  const r = await discordReply(mention.channel_id, mention, text, actor, 0x6366f1);
  if (!r.ok) return r;
  run("UPDATE mentions SET is_read = 1 WHERE id = ?", [mention.id]);
  logAudit(actor.id, actor.name, "SEND", "discord_reply", mention.id, `#${mention.channel_name || mention.channel_id}`, text.slice(0, 200));
  return { ok: true };
}

// ── FM Leadership role mentions (L3) ──────────────────────────────────────

export async function getLeadershipMentions() {
  await requireActor(3);
  return query(`SELECT rm.id, rm.message_id, rm.channel_id, rm.channel_name, rm.author_id, rm.author_name, rm.content, rm.guild_id, rm.created_at, rm.is_read,
      COALESCE(bsc.guild_name, rm.guild_name, 'ECRP FM Discord') AS guild_name
    FROM role_mentions rm LEFT JOIN bot_server_configs bsc ON bsc.guild_id = rm.guild_id
    ORDER BY rm.is_read ASC, rm.created_at DESC LIMIT 100`);
}

export async function markLeadershipMentionRead(id) {
  await requireActor(3);
  const r = run("UPDATE role_mentions SET is_read = 1 WHERE id = ?", [Number(id)]);
  return r.changes ? { ok: true } : fail("Mention not found.");
}

export async function markAllLeadershipMentionsRead() {
  await requireActor(3);
  run("UPDATE role_mentions SET is_read = 1 WHERE is_read = 0");
  return { ok: true };
}

export async function replyToLeadershipMention(mentionId, replyText) {
  const g = await writer(3); if (g.error) return fail(g.error);
  const actor = g.actor;
  const text = str(replyText, { max: 2000 });
  if (!text) return fail("Message is empty.");
  const mention = queryOne("SELECT * FROM role_mentions WHERE id = ?", [Number(mentionId)]);
  if (!mention) return fail("Mention not found.");
  const r = await discordReply(mention.channel_id, mention, text, actor, 0xf59e0b);
  if (!r.ok) return r;
  run("UPDATE role_mentions SET is_read = 1 WHERE id = ?", [mention.id]);
  logAudit(actor.id, actor.name, "SEND", "discord_reply", mention.id, `#${mention.channel_name || mention.channel_id} (leadership ping)`, text.slice(0, 200));
  return { ok: true };
}

// ── Forwarded DMs (self-scoped, opt-in) ───────────────────────────────────

export async function getDMTrackingStatus() {
  const actor = await reader();
  const row = queryOne("SELECT dm_tracking_enabled FROM staff WHERE discord_id = ?", [actor.id]);
  return { enabled: row?.dm_tracking_enabled === 1, discordId: actor.id };
}

export async function toggleDMTracking(enable) {
  const actor = await reader();
  const on = enable ? 1 : 0;
  run("UPDATE staff SET dm_tracking_enabled = ? WHERE discord_id = ?", [on, actor.id]);
  logAudit(actor.id, actor.name, "EDIT", "staff", actor.id, actor.name, on ? "DM forwarding enabled" : "DM forwarding disabled");
  return { ok: true, enabled: !!on };
}

export async function getForwardedDMs() {
  const actor = await reader();
  return query(`SELECT id, message_id, author_id, author_name, content, source_channel, source_channel_id, source_message_id, forwarded_at, is_read
    FROM forwarded_dms WHERE target_user_id = ? ORDER BY is_read ASC, forwarded_at DESC LIMIT 100`, [actor.id]);
}

export async function markDMRead(id) {
  const actor = await reader();
  const r = run("UPDATE forwarded_dms SET is_read = 1 WHERE id = ? AND target_user_id = ?", [Number(id), actor.id]);
  return r.changes ? { ok: true } : fail("Forwarded DM not found.");
}

export async function markAllDMsRead() {
  const actor = await reader();
  run("UPDATE forwarded_dms SET is_read = 1 WHERE target_user_id = ? AND is_read = 0", [actor.id]);
  return { ok: true };
}

export async function deleteDM(id) {
  const actor = await reader();
  const dm = queryOne("SELECT id, author_name, content FROM forwarded_dms WHERE id = ? AND target_user_id = ?", [Number(id), actor.id]);
  if (!dm) return fail("Forwarded DM not found.");
  run("DELETE FROM forwarded_dms WHERE id = ?", [dm.id]);
  logAudit(actor.id, actor.name, "DELETE", "forwarded_dm", dm.id, dm.author_name || "", (dm.content || "").slice(0, 120));
  return { ok: true };
}

// ── Inbox unread, cheaply (the bell polls this) ───────────────────────────

export async function getInboxUnreadCount() {
  const actor = await reader();
  let n = queryOne("SELECT COUNT(*) AS c FROM mentions WHERE target_user_id = ? AND is_read = 0", [actor.id])?.c || 0;
  const ids = teamConfigIds(actor);
  if (ids === null) n += queryOne("SELECT COUNT(*) AS c FROM watch_role_mentions WHERE is_read = 0")?.c || 0;
  else if (ids.length) n += queryOne(`SELECT COUNT(*) AS c FROM watch_role_mentions WHERE is_read = 0 AND config_id IN (${ids.map(() => "?").join(",")})`, ids)?.c || 0;
  if (queryOne("SELECT dm_tracking_enabled FROM staff WHERE discord_id = ?", [actor.id])?.dm_tracking_enabled === 1) {
    n += queryOne("SELECT COUNT(*) AS c FROM forwarded_dms WHERE target_user_id = ? AND is_read = 0", [actor.id])?.c || 0;
  }
  if (actor.level >= 3) n += queryOne("SELECT COUNT(*) AS c FROM role_mentions WHERE is_read = 0")?.c || 0;
  return { unread: n };
}
