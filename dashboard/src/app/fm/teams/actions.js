"use server";
// The Teams workspace: team rosters, team/personal task boards and events, and
// the IC-contact → RP-change bridge.
//
// Tasks are thin wrappers over shared/tasks.js (requireActor → shared fn →
// revalidatePath) so the dashboard, /v2 and the bot enforce one rule set:
// claims are always the actor's own, completion is soft, dates are ISO and
// every write is audited with the real record id.
//
// IC-contact writes are scoped with lib/access.js: a guide or team lead may
// only work contacts of factions led by someone on their team; L3 is
// unscoped; archived factions accept no writes.
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { query, queryOne, run, transaction } from "../../../lib/db.js";
import { logAudit } from "../../../lib/audit.js";
import { sendPing, sendDiscord, pingChannel, rpComponents, urls } from "../../../lib/pings.js";
import { requireActor } from "../../../lib/requireActor.js";
import { assertFactionWrite, resolveFaction, writableFactionIds } from "../../../lib/access.js";
import * as Tasks from "../../../../../shared/tasks.js";
import { getRole } from "../../../../../shared/pings.js";
import { nowIso, todayIso } from "../../../../../shared/dates.js";
import { str, toInt, isSnowflake, fail, oneOf, RP_TYPES } from "../../../../../shared/validate.js";

const PATHS = ['/v2', '/v2/teams', '/v2/tasks', '/fm/teams', '/fm/dashboard'];
function refresh() { for (const p of PATHS) { try { revalidatePath(p); } catch { /* outside a request */ } } }

// ── Teams ─────────────────────────────────────────────────────────────────────

export async function getTeams() {
  await requireActor(1);
  const teamRows = query("SELECT team_id, team_name FROM teams ORDER BY team_name");
  const staff = query("SELECT discord_id, display_name, rank, clearance, team_id, team_name FROM staff WHERE discord_id != '' AND discord_id NOT LIKE 'placeholder%' AND COALESCE(active, 1) = 1 ORDER BY clearance DESC, display_name");
  const factions = query(`SELECT f.id, f.name, f.tier, f.lead_discord_id,
      COALESCE((SELECT COUNT(*) FROM scene_logs sl WHERE sl.faction_id = f.id AND sl.created_at >= datetime('now','-30 days')), 0) AS scenes30d,
      COALESCE((SELECT COUNT(*) FROM scene_logs sl WHERE sl.faction_id = f.id), 0) AS allTime
    FROM factions f WHERE f.archived = 0 ORDER BY f.name`);

  const teams = {};
  const ensure = (id, name) => (teams[id] ||= { id, name: name || 'Unnamed', leads: [], guides: [], factions: [], total30d: 0, totalAll: 0 });
  for (const t of teamRows) ensure(t.team_id, t.team_name);
  for (const s of staff) {
    if (!s.team_id || s.team_name === 'Game Affairs Management') continue;
    const team = ensure(s.team_id, s.team_name);
    const entry = { discordId: s.discord_id, name: s.display_name, rank: s.rank, clearance: s.clearance };
    // staff.clearance is the truth (never the rank text): L2+ are the leads of a team.
    (Number(s.clearance) >= 2 ? team.leads : team.guides).push(entry);
  }
  const teamOfLead = Object.fromEntries(staff.map(s => [s.discord_id, s.team_id]));
  for (const f of factions) {
    const tid = teamOfLead[f.lead_discord_id];
    if (!tid || !teams[tid]) continue;
    teams[tid].factions.push({ id: f.id, name: f.name, tier: f.tier, scenes30d: f.scenes30d, allTime: f.allTime });
    teams[tid].total30d += f.scenes30d;
    teams[tid].totalAll += f.allTime;
  }
  return Object.values(teams).filter(t => t.leads.length || t.guides.length || t.factions.length);
}

function teamMemberIds(teamId) {
  return new Set(query("SELECT discord_id FROM staff WHERE team_id = ?", [teamId]).map(s => s.discord_id));
}

/** Open tasks aimed at a team (its role) or one of its members, limited to what the actor may see. */
export async function getTeamTasks(teamId) {
  const actor = await requireActor(1);
  const tid = str(teamId);
  if (!tid) return [];
  const members = teamMemberIds(tid);
  return Tasks.visibleTasks(actor)
    .filter(t => (t.target_type === 'Role' && t.target_id === tid) || (t.target_type === 'User' && members.has(t.target_id)))
    .map(t => ({ ...Tasks.decorate(t), creatorName: t.created_by_name || 'Unknown' }));
}

function nameMap(ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return {};
  const rows = query(`SELECT discord_id, display_name FROM staff WHERE discord_id IN (${list.map(() => '?').join(',')})`, list);
  return Object.fromEntries(rows.map(r => [r.discord_id, r.display_name]));
}

function decorateReminders(rows) {
  const names = nameMap(rows.map(r => r.author_id));
  return rows.map(r => ({ ...r, authorName: names[r.author_id] || r.author_id, epochMs: parseInt(r.epoch_ms, 10) || 0 }));
}

export async function getTeamReminders(teamId) {
  await requireActor(1);
  const tid = str(teamId);
  if (!tid) return [];
  const members = teamMemberIds(tid);
  const all = query("SELECT * FROM reminders WHERE status != 'FIRED' ORDER BY CAST(epoch_ms AS INTEGER)");
  return decorateReminders(all.filter(r => {
    const role = r.target_tag?.match(/<@&(\d+)>/);
    const user = r.target_tag?.match(/<@(\d+)>/);
    return (role && role[1] === tid) || (user && members.has(user[1]));
  }));
}

/** Every open task the actor may see (the shared visibility rule), newest first. */
export async function getMyTasks() {
  const actor = await requireActor(1);
  return Tasks.visibleTasks(actor).map(Tasks.decorate);
}

export async function getMyReminders() {
  const actor = await requireActor(1);
  const leadRole = getRole('fm_team_lead');
  const guideRole = getRole('fm_team_guide');
  const all = query("SELECT * FROM reminders WHERE status != 'FIRED' ORDER BY CAST(epoch_ms AS INTEGER)");
  // Same audience rule as tasks: mine, aimed at me, my team, all-FM; leads add
  // the lead role; leadership sees every role event.
  return decorateReminders(all.filter(r => {
    if (r.author_id === actor.id) return true;
    const role = r.target_tag?.match(/<@&(\d+)>/);
    const user = r.target_tag?.match(/<@(\d+)>/);
    if (user && user[1] === actor.id) return true;
    if (!role) return false;
    if (actor.level >= 3) return true;
    if (role[1] === actor.teamId || role[1] === guideRole) return true;
    return actor.level >= 2 && role[1] === leadRole;
  }));
}

// ── Tasks (thin wrappers over shared/tasks.js) ────────────────────────────────

export async function createTask(data) {
  const actor = await requireActor(1);
  const r = await Tasks.createTask(actor, data || {}, { via: 'dashboard' });
  if (r.ok) refresh();
  return r;
}

/**
 * Claim a task as yourself. `opts` may be `{ enableDM }` (or a boolean) to turn
 * on the 24h DM reminder for the claim. A claimer id is never taken from the
 * client: a claim is always the actor's own.
 */
export async function claimTask(taskUid, opts) {
  const actor = await requireActor(1);
  const r = await Tasks.claimTask(actor, str(taskUid), { via: 'dashboard' });
  if (!r.ok) return r;
  const enableDM = typeof opts === 'object' && opts !== null ? !!opts.enableDM : opts === true;
  if (enableDM) run("UPDATE tasks SET next_reminder = ? WHERE task_uid = ? AND claimed_by = ?", [String(Date.now() + 86400000), str(taskUid), actor.id]);
  refresh();
  return r;
}

export async function completeTask(taskUid, note) {
  const actor = await requireActor(1);
  const r = await Tasks.completeTask(actor, str(taskUid), note, { via: 'dashboard' });
  if (r.ok) refresh();
  return r;
}

export async function editTask(taskUid, newDesc) {
  const actor = await requireActor(1);
  const r = await Tasks.editTask(actor, str(taskUid), newDesc);
  if (r.ok) refresh();
  return r;
}

export async function reassignTask(taskUid, newTargetId, newTargetType, note) {
  const actor = await requireActor(1);
  const r = await Tasks.reassignTask(actor, str(taskUid), newTargetId, newTargetType, note);
  if (r.ok) refresh();
  return r;
}

export async function unclaimTask(taskUid, note) {
  const actor = await requireActor(1);
  const r = await Tasks.unclaimTask(actor, str(taskUid), note, { via: 'dashboard' });
  if (r.ok) refresh();
  return r;
}

export async function requestTaskInfo(taskUid, question) {
  const actor = await requireActor(1);
  return Tasks.requestTaskInfo(actor, str(taskUid), question);
}

export async function answerTaskQuestion(questionId, answer) {
  const actor = await requireActor(1);
  const qid = toInt(questionId, { min: 1 });
  if (!qid) return fail('Question not found.');
  return Tasks.answerTaskQuestion(actor, qid, answer);
}

export async function getTaskByUid(taskUid) {
  const actor = await requireActor(1);
  const task = Tasks.getTask(str(taskUid));
  if (!task || !Tasks.canSeeTask(actor, task)) return null;
  return Tasks.decorate(task);
}

export async function getTaskQuestions(taskUid) {
  const actor = await requireActor(1);
  const task = Tasks.getTask(str(taskUid));
  if (!task || !Tasks.canSeeTask(actor, task)) return [];
  return Tasks.taskQuestions(task.task_uid);
}

// ── Events / reminders ────────────────────────────────────────────────────────

function validateReminderTarget(targetType, targetId) {
  if (targetType !== 'Role' && targetType !== 'User') return 'Target type must be Role or User.';
  if (!targetId) return 'A target is required.';
  if (targetType === 'User') {
    if (!queryOne("SELECT 1 FROM staff WHERE discord_id = ? AND discord_id NOT LIKE 'placeholder%'", [targetId])) return 'That person is not on the staff roster.';
    return null;
  }
  const known = queryOne("SELECT 1 FROM discord_roles WHERE role_id = ?", [targetId]) || queryOne("SELECT 1 FROM teams WHERE team_id = ?", [targetId]);
  if (!known && !isSnowflake(targetId)) return 'Unknown role.';
  return null;
}

/**
 * Schedule an event / reminder. `data`: { message, epochMs, eventType, note,
 * targetType, targetId }. The 30-minute warning is a global route switch
 * (ping_routes 'reminder.warning'), not a per-event option, so `enable30m` is
 * accepted and ignored.
 */
export async function createReminder(data) {
  const actor = await requireActor(1);
  const d = data && typeof data === 'object' ? data : {};
  const eventType = str(d.eventType, { max: 60 });
  const note = str(d.note, { max: 500 });
  let message = str(d.message, { max: 600 });
  if (!message && note) message = `[${eventType || 'Event'}] ${note}`;
  if (!message) return fail('A message is required.');
  const epochMs = toInt(d.epochMs);
  if (!epochMs || epochMs < 1e12 || epochMs > 4e12) return fail('A valid date and time is required.');
  if (epochMs < Date.now() - 60000) return fail('The event time must be in the future.');
  const targetType = str(d.targetType);
  const targetId = str(d.targetId);
  const bad = validateReminderTarget(targetType, targetId);
  if (bad) return fail(bad);

  const uuid = randomUUID().replace(/-/g, '').slice(0, 12);
  const targetTag = targetType === 'Role' ? `<@&${targetId}>` : `<@${targetId}>`;
  const readable = new Date(epochMs).toISOString();
  // Leadership-targeted events take the confidentiality branch. The row stores
  // the resolved channel so the bot scheduler fires it in the same place.
  const alt = targetType === 'Role' && (targetId === getRole('fm_leadership') || targetId === getRole('game_affairs'));
  const channel = pingChannel('event.created', { alt, ignoreEnabled: true });

  run("INSERT INTO reminders (uuid, author_id, channel_id, message, epoch_ms, readable_time, repeat_rule, target_tag, status) VALUES (?, ?, ?, ?, ?, ?, 'None', ?, 'ACTIVE')",
    [uuid, actor.id, channel, message, String(epochMs), readable, targetTag]);
  logAudit(actor.id, actor.name, 'CREATE', 'reminder', uuid, message.slice(0, 80), `Scheduled for ${readable} · ${targetType} ${targetId}`);

  const epoch = Math.floor(epochMs / 1000);
  const embeds = [{ title: `📌 ${eventType || 'Event'} Scheduled`, description: `**Time:** <t:${epoch}:F> (<t:${epoch}:R>)\n${note ? `**Details:** ${note}` : ''}\n\n*Via Meridian Dashboard*`, color: 0x5865F2 }];
  await sendPing('event.created', targetTag, { alt, embeds });
  refresh();
  return { ok: true, uuid };
}

export async function snoozeReminder(uuid) {
  const actor = await requireActor(1);
  const r = queryOne("SELECT * FROM reminders WHERE uuid = ?", [str(uuid)]);
  if (!r) return fail('Reminder not found.');
  if (r.author_id !== actor.id && actor.level < 2) return fail('Only the author or a team lead can snooze this event.');
  const newTime = (parseInt(r.epoch_ms, 10) || Date.now()) + 3600000;
  run("UPDATE reminders SET epoch_ms = ?, readable_time = ?, status = 'ACTIVE' WHERE uuid = ?", [String(newTime), new Date(newTime).toISOString(), r.uuid]);
  logAudit(actor.id, actor.name, 'EDIT', 'reminder', r.uuid, r.message.slice(0, 80), 'Snoozed 1h');
  refresh();
  return { ok: true };
}

export async function deleteReminder(uuid) {
  const actor = await requireActor(1);
  const r = queryOne("SELECT * FROM reminders WHERE uuid = ?", [str(uuid)]);
  if (!r) return fail('Reminder not found.');
  if (r.author_id !== actor.id && actor.level < 2) return fail('Only the author or a team lead can delete this event.');
  run("DELETE FROM reminders WHERE uuid = ?", [r.uuid]);
  logAudit(actor.id, actor.name, 'DELETE', 'reminder', r.uuid, r.message.slice(0, 80), 'Event deleted');
  refresh();
  return { ok: true };
}

// ── Pickers ───────────────────────────────────────────────────────────────────

export async function getStaffList() {
  await requireActor(1);
  return query("SELECT discord_id, display_name, team_id, team_name, rank, clearance FROM staff WHERE discord_id != '' AND discord_id NOT LIKE 'placeholder%' AND COALESCE(active, 1) = 1 ORDER BY display_name");
}

export async function getRoleTargets() {
  await requireActor(1);
  const leadershipId = getRole('fm_leadership');
  const leadId = getRole('fm_team_lead');
  const allFmId = getRole('fm_team_guide');
  const teams = query("SELECT team_id, team_name FROM teams WHERE team_name NOT IN ('FM Leadership','FM Team Leads','Faction Management','Game Affairs Management') ORDER BY team_name");
  return { leadershipId, leadId, allFmId, teams };
}

// ── IC Contacts ───────────────────────────────────────────────────────────────

const IC_SELECT = `SELECT c.*, f.name AS faction_name, f.archived AS faction_archived
  FROM faction_ic_contacts c JOIN factions f ON f.id = c.faction_id`;

function teamFactionIds(teamId) {
  return query(`SELECT DISTINCT f.id FROM factions f JOIN staff s ON s.discord_id = f.lead_discord_id WHERE s.team_id = ? AND f.archived = 0`, [teamId]).map(r => r.id);
}

function contactsForFactions(ids, { includeCompleted = false, limit = 0 } = {}) {
  if (!ids.length) return [];
  const ph = ids.map(() => '?').join(',');
  return query(`${IC_SELECT} WHERE c.faction_id IN (${ph})${includeCompleted ? '' : " AND c.status != 'completed'"} ORDER BY c.submitted_at DESC${limit ? ` LIMIT ${limit}` : ''}`, ids);
}

/** Open IC contacts for the factions led by a team. Reads are global. */
export async function getTeamIcContacts(teamId) {
  await requireActor(1);
  const tid = str(teamId);
  return tid ? contactsForFactions(teamFactionIds(tid)) : [];
}

export async function getTeamIcContactsAll(teamId) {
  await requireActor(1);
  const tid = str(teamId);
  return tid ? contactsForFactions(teamFactionIds(tid), { includeCompleted: true, limit: 50 }) : [];
}

/** Every IC contact (L3), or the actor's team's contacts (L2), with the owning team. */
export async function getAllIcContacts() {
  const actor = await requireActor(2);
  const rows = query(`SELECT c.*, f.name AS faction_name, f.archived AS faction_archived, t.team_name, t.team_id
    FROM faction_ic_contacts c
    JOIN factions f ON f.id = c.faction_id
    LEFT JOIN staff s ON s.discord_id = f.lead_discord_id
    LEFT JOIN teams t ON t.team_id = s.team_id
    ORDER BY c.submitted_at DESC`);
  const scope = writableFactionIds(actor);
  return scope === null ? rows : rows.filter(r => scope.has(r.faction_id));
}

function loadContact(contactId) {
  const cid = toInt(contactId, { min: 1 });
  const contact = cid ? queryOne(`${IC_SELECT} WHERE c.id = ?`, [cid]) : null;
  return contact ? { contact } : { error: 'Contact not found.' };
}

const contactLabel = (c) => `${c.faction_name} · ${c.sender_name}`;

async function postToThread(threadId, content) {
  if (!threadId) return false;
  return sendDiscord(threadId, content, undefined, undefined, { allowedMentions: { parse: [] } });
}

export async function assignIcContact(contactId, assignToId) {
  const actor = await requireActor(1);
  const { contact, error } = loadContact(contactId);
  if (error) return fail(error);
  const scope = assertFactionWrite(actor, contact.faction_id);
  if (scope.error) return fail(scope.error);
  const assignee = queryOne("SELECT discord_id, display_name FROM staff WHERE discord_id = ? AND discord_id NOT LIKE 'placeholder%' AND COALESCE(active, 1) = 1", [str(assignToId)]);
  if (!assignee) return fail('That person is not on the staff roster.');
  run("UPDATE faction_ic_contacts SET assigned_to = ?, assigned_name = ? WHERE id = ?", [assignee.discord_id, assignee.display_name, contact.id]);
  logAudit(actor.id, actor.name, 'EDIT', 'ic_contact', contact.id, contactLabel(contact), `Assigned to ${assignee.display_name}`);
  await postToThread(contact.thread_id, `**Assigned** to ${assignee.display_name} by ${actor.name}`);
  refresh();
  return { ok: true };
}

const STATUS_LABELS = { pending_discussion: 'Pending Discussion', pending_roleplay: 'Pending Roleplay' };

export async function setIcContactStatus(contactId, status) {
  const actor = await requireActor(1);
  const s = oneOf(str(status), Object.keys(STATUS_LABELS));
  if (!s) return fail('Invalid status.');
  const { contact, error } = loadContact(contactId);
  if (error) return fail(error);
  const scope = assertFactionWrite(actor, contact.faction_id);
  if (scope.error) return fail(scope.error);
  if (contact.status === s) return { ok: true };
  run("UPDATE faction_ic_contacts SET status = ? WHERE id = ?", [s, contact.id]);
  logAudit(actor.id, actor.name, 'EDIT', 'ic_contact', contact.id, contactLabel(contact), `Status ${contact.status} → ${s}`);
  await postToThread(contact.thread_id, `**Status updated** to ${STATUS_LABELS[s]} by ${actor.name}`);
  refresh();
  return { ok: true };
}

export async function completeIcContact(contactId) {
  const actor = await requireActor(1);
  const { contact, error } = loadContact(contactId);
  if (error) return fail(error);
  const scope = assertFactionWrite(actor, contact.faction_id);
  if (scope.error) return fail(scope.error);
  if (contact.status === 'completed') return fail('This contact is already completed.');
  run("UPDATE faction_ic_contacts SET status = 'completed' WHERE id = ?", [contact.id]);
  logAudit(actor.id, actor.name, 'EDIT', 'ic_contact', contact.id, contactLabel(contact), 'Completed and archived');
  await postToThread(contact.thread_id, `**Contact Completed** by ${actor.name} — this IC contact has been resolved and archived.`);
  refresh();
  return { ok: true };
}

/**
 * The bridge: stage an RP change from an IC contact. Validates the request,
 * records the NPC id and contact id on the pending_executions row, refuses a
 * duplicate (a second PENDING request for the same faction + type + target),
 * advances the contact to pending_roleplay and pings rp.requested with the
 * Approve / Deny buttons. `rpData`: { type, npcId?, turf?, oldValue?, newValue }.
 */
export async function stageRoleplay(contactId, rpData) {
  const actor = await requireActor(2);
  const { contact, error } = loadContact(contactId);
  if (error) return fail(error);
  const scope = assertFactionWrite(actor, contact.faction_id);
  if (scope.error) return fail(scope.error);
  if (contact.status === 'completed') return fail('This contact is completed; reopen it before staging an RP change.');

  const d = rpData && typeof rpData === 'object' ? rpData : {};
  const type = oneOf(str(d.type), RP_TYPES);
  if (!type) return fail(`RP change type must be one of ${RP_TYPES.join(', ')}.`);
  const newValue = str(d.newValue, { max: 500 });
  if (!newValue) return fail(type === 'Other' ? 'Describe the change.' : 'A new value is required.');
  let turf = str(d.turf, { max: 120 }) || 'N/A';
  let oldValue = str(d.oldValue, { max: 500 }) || 'N/A';
  let npcId = null;

  if (type === 'NPC') {
    const id = toInt(d.npcId, { min: 1 });
    let npc = id ? queryOne("SELECT id, name, npc_type, turf FROM npcs WHERE id = ?", [id]) : null;
    if (id && !npc) return fail('That NPC no longer exists.');
    if (!npc) {
      if (turf === 'N/A' || oldValue === 'N/A') return fail('Pick the NPC to change.');
      const rows = query("SELECT id, name, npc_type, turf FROM npcs WHERE turf = ? AND npc_type = ? ORDER BY id", [turf, oldValue]);
      if (!rows.length) return fail('No NPC of that type on that turf.');
      if (rows.length > 1) return fail('More than one NPC matches that turf and type; pick the NPC by name.');
      npc = rows[0];
    }
    npcId = npc.id; turf = npc.turf; oldValue = npc.npc_type;      // server-side truth, not the form's copy
    if (newValue === oldValue) return fail('The new NPC type is the same as the current one.');
  } else if (type === 'HQ') {
    if (oldValue === 'N/A') return fail('Pick the current HQ address.');
    if (newValue === oldValue) return fail('The new address is the same as the current one.');
  } else if (type === 'TURF') {
    if (turf === 'N/A') return fail('Name the turf.');
  } else if (type === 'PROPERTY') {
    if (oldValue === 'N/A' && /^(REMOVED|REMOVE|N\/A)$/i.test(newValue)) return fail('Name the property to add, or the property to remove.');
  }

  // One open request per faction + type + target (the NPC, the HQ being moved, the turf, or the same details).
  const [dupWhere, dupArgs] = type === 'NPC' ? ['(pe.npc_id = ? OR (pe.turf = ? AND pe.old_value = ?))', [npcId, turf, oldValue]]
    : type === 'HQ' ? ['pe.old_value = ?', [oldValue]]
    : type === 'TURF' ? ['pe.turf = ?', [turf]]
    : type === 'PROPERTY' ? ['pe.old_value = ? AND pe.new_value = ?', [oldValue, newValue]]
    : ['pe.new_value = ?', [newValue]];
  const dup = queryOne(`SELECT pe.id FROM pending_executions pe WHERE pe.faction_id = ? AND pe.execution_type = ? AND pe.status = 'PENDING' AND ${dupWhere}`, [contact.faction_id, type, ...dupArgs]);
  if (dup) return fail(`An RP change request for this is already pending approval (#${dup.id}).`);

  const execId = transaction(() => {
    const ins = run("INSERT INTO pending_executions (date, faction_id, execution_type, turf, old_value, new_value, requested_by, requester_id, status, npc_id, contact_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)",
      [todayIso(), contact.faction_id, type, turf, oldValue, newValue, actor.name, actor.id, npcId, contact.id]);
    const id = Number(ins.lastInsertRowid);
    run("UPDATE faction_ic_contacts SET status = 'pending_roleplay', rp_change_id = ? WHERE id = ?", [id, contact.id]);
    return id;
  });

  logAudit(actor.id, actor.name, 'CREATE', 'rp_change', execId, contact.faction_name, `${type}: ${oldValue} → ${newValue}${npcId ? ` (npc #${npcId})` : ''} · from IC contact #${contact.id}`);
  logAudit(actor.id, actor.name, 'EDIT', 'ic_contact', contact.id, contactLabel(contact), `RP staged — ${type} (request #${execId})`);

  let msg = `🔔 **RP Change Request**\n**Faction:** ${contact.faction_name}\n**Type:** ${type}\n**Requested By:** ${actor.name}\n**From IC contact:** ${contact.sender_name}`;
  if (type === 'NPC') msg += `\n**Turf:** ${turf}\n**Current:** ${oldValue}\n**New:** ${newValue}`;
  else if (type === 'HQ') msg += `\n**Old Address:** ${oldValue}\n**New Address:** ${newValue}`;
  else if (type === 'TURF') msg += `\n**Turf:** ${turf}\n**Change:** ${newValue}`;
  else if (type === 'PROPERTY') msg += `\n**Current:** ${oldValue}\n**New:** ${newValue}`;
  else msg += `\n**Details:** ${newValue}`;
  msg += `\n📋 ${urls.approvals()}`;
  await sendPing('rp.requested', msg, { components: rpComponents(execId, 'pending') });

  let threadMsg = `**RP Staged** by ${actor.name}\n**Type:** ${type}`;
  if (type === 'NPC') threadMsg += `\n**Turf:** ${turf}\n**Current:** ${oldValue}\n**New:** ${newValue}`;
  else if (type === 'HQ') threadMsg += `\n**Old:** ${oldValue}\n**New:** ${newValue}`;
  else threadMsg += `\n**Details:** ${newValue}`;
  threadMsg += `\n\nRP change request #${execId} has been submitted and is pending Leadership approval.`;
  await postToThread(contact.thread_id, threadMsg);
  refresh();
  return { ok: true, id: execId };
}

/** Last 50 messages of an IC-contact thread. Only threads that belong to a contact are readable. */
export async function getThreadMessages(threadId) {
  await requireActor(1);
  const tid = str(threadId);
  if (!tid || !queryOne("SELECT 1 FROM faction_ic_contacts WHERE thread_id = ?", [tid])) return [];
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return [];
  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${tid}/messages?limit=50`, {
      headers: { Authorization: `Bot ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const msgs = await res.json();
    if (!Array.isArray(msgs)) return [];
    return msgs.reverse().map(m => ({
      id: m.id,
      content: m.content,
      author: m.author?.username || 'Unknown',
      authorBot: m.author?.bot || false,
      timestamp: m.timestamp,
    }));
  } catch { return []; }
}

/**
 * Form data for RpChangeForm. NPCs are scoped to the faction where the
 * registry allows it — an NPC's turf names who holds it, so NPCs whose turf is
 * the faction (or one of its aliases) come first; when none match, every
 * claimable NPC is offered and `scoped` is false. Properties are the faction's.
 */
export async function getIcContactFormData(factionId) {
  await requireActor(1);
  const r = resolveFaction(factionId, { allowArchived: true });
  if (r.error) return { npcs: [], npcTypes: [], properties: [], scoped: false, error: r.error };
  const f = r.faction;
  const names = new Set([f.name, ...String(f.aliases || '').split(',')].map(s => s.trim().toLowerCase()).filter(Boolean));
  const all = query("SELECT id, name, npc_type, turf, claimable FROM npcs ORDER BY turf, npc_type, name");
  const npcTypes = [...new Set(all.map(n => n.npc_type).filter(Boolean))].sort();
  const mine = all.filter(n => names.has(String(n.turf || '').toLowerCase()));
  const npcs = mine.length ? mine : all.filter(n => n.claimable !== 0 && n.turf !== 'Neutral');
  const properties = query("SELECT id, address, is_hq, property_type FROM properties WHERE faction_id = ? AND confiscated = 0 ORDER BY is_hq DESC, address", [f.id]);
  return { npcs, npcTypes, properties, scoped: mine.length > 0 };
}
