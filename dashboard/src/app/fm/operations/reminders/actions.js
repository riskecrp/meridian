"use server";
import { revalidatePath } from "next/cache";
import { query, queryOne, run } from "../../../../lib/db.js";
import { requireActor } from "../../../../lib/requireActor.js";
import { sendDiscord, pingEnabled, urls } from "../../../../lib/pings.js";
import { logAudit } from "../../../../lib/audit.js";
import { str, toInt, isSnowflake, fail, oneOf } from "../../../../../../shared/validate.js";
import { nowIso } from "../../../../../../shared/dates.js";

// Recurring reminders: monthly nudges to a role, a team or a person.
//   L3: everything.
//   L2: their own team — reminders they created, or whose target is their team
//       (or someone on it); new ones may only target their own team / its members.
// Targets and channels are validated as Discord snowflakes that exist in
// discord_roles / teams / staff (targets) or discord_config (channels).

const TARGET_TYPES = ['Role', 'Team', 'User'];
const ACTIVE_STAFF = "discord_id != '' AND discord_id NOT LIKE 'placeholder%' AND active = 1 AND clearance >= 1";

function bump() {
  for (const p of ['/fm/operations/reminders', '/fm/dashboard', '/v2/admin', '/v2']) {
    try { revalidatePath(p); } catch {}
  }
}

/** Can this actor see / edit this reminder definition? */
function ownsReminder(actor, def) {
  if (actor.level >= 3) return true;
  if (def.created_by_id === actor.id) return true;
  if (def.target_type === 'Team' && actor.teamId && def.target_id === actor.teamId) return true;
  if (def.target_type === 'User') {
    const t = queryOne("SELECT team_id FROM staff WHERE discord_id = ?", [def.target_id]);
    return !!t && !!actor.teamId && t.team_id === actor.teamId;
  }
  return false;
}

/** null when the target is valid for this actor, else the error text. */
function validateTarget(actor, targetType, targetId) {
  if (!TARGET_TYPES.includes(targetType)) return 'Target type must be Role, Team or User.';
  if (!targetId) return 'Pick a target.';
  if (targetType === 'Role') {
    if (actor.level < 3) return 'Only Leadership can target a role; target your team instead.';
    if (!isSnowflake(targetId) || !queryOne("SELECT 1 FROM discord_roles WHERE role_id = ?", [targetId])) return 'Unknown role.';
  } else if (targetType === 'Team') {
    // Team ids are the team's Discord role id; the row must exist either way.
    if (!queryOne("SELECT 1 FROM teams WHERE team_id = ?", [targetId])) return 'Unknown team.';
    if (actor.level < 3 && targetId !== actor.teamId) return 'You can only target your own team.';
  } else {
    if (!isSnowflake(targetId)) return 'Pick a target.';
    const s = queryOne(`SELECT team_id FROM staff WHERE discord_id = ? AND ${ACTIVE_STAFF}`, [targetId]);
    if (!s) return 'That person is not an active staff member.';
    if (actor.level < 3 && s.team_id !== actor.teamId) return 'You can only target someone on your own team.';
  }
  return null;
}

function validateChannel(channelId) {
  if (!isSnowflake(channelId)) return 'Pick a channel.';
  const known = queryOne("SELECT 1 FROM discord_config WHERE channel_id = ?", [channelId]) || queryOne("SELECT 1 FROM teams WHERE channel_id = ?", [channelId]);
  return known ? null : 'That channel is not one of the configured channels (Admin › Pings › Channel shortcuts, or a team channel).';
}

function validateDays(data) {
  const pingDay = toInt(data.ping_day, { min: 1, max: 31 });
  const dueDay = data.due_day === undefined || data.due_day === '' || data.due_day == null ? pingDay : toInt(data.due_day, { min: 1, max: 31 });
  if (!pingDay || !dueDay) return { error: 'Days must be whole numbers from 1 to 31.' };
  if (dueDay < pingDay) return { error: 'Due day cannot be before ping day.' };
  return { pingDay, dueDay };
}

export async function listReminders() {
  const actor = await requireActor(2);
  const rows = query("SELECT * FROM recurring_reminders ORDER BY ping_day, title");
  return rows.filter(r => ownsReminder(actor, r));
}

export async function getReminderProgress(reminderId, year, month) {
  const actor = await requireActor(2);
  const def = queryOne("SELECT * FROM recurring_reminders WHERE id = ?", [toInt(reminderId)]);
  if (!def || !ownsReminder(actor, def)) return [];
  return query(
    "SELECT * FROM recurring_reminder_instances WHERE reminder_id = ? AND year = ? AND month = ? ORDER BY recipient_name",
    [def.id, toInt(year), toInt(month)]
  );
}

/** Channels offered in the form: the named shortcuts plus team channels. */
export async function listChannels() {
  const actor = await requireActor(2);
  const named = query("SELECT key, channel_id, description FROM discord_config WHERE channel_id != '' ORDER BY key");
  const teams = query("SELECT team_id, team_name, channel_id FROM teams WHERE channel_id != '' ORDER BY team_name")
    .filter(t => actor.level >= 3 || t.team_id === actor.teamId)
    .map(t => ({ key: `team:${t.team_id}`, channel_id: t.channel_id, description: `${t.team_name} channel` }));
  return [...named, ...teams];
}

/** Target options for the form, scoped to the actor's team below L3. */
export async function getTargetOptions() {
  const actor = await requireActor(2);
  const all = actor.level >= 3;
  const teams = query("SELECT team_id, team_name FROM teams WHERE team_name != 'Game Affairs Management' ORDER BY team_name")
    .filter(t => all || t.team_id === actor.teamId);
  const staff = query(`SELECT discord_id, display_name, team_id FROM staff WHERE ${ACTIVE_STAFF} ORDER BY display_name`)
    .filter(s => all || s.team_id === actor.teamId);
  const roles = all ? query("SELECT key, role_id FROM discord_roles ORDER BY key") : [];
  return { teams, staff, roles };
}

export async function createReminder(data) {
  const actor = await requireActor(2);
  data = data && typeof data === 'object' ? data : {};
  const title = str(data.title, { max: 150 });
  if (!title) return fail('A title is required.');
  const targetType = oneOf(str(data.target_type), TARGET_TYPES);
  const targetId = str(data.target_id);
  const bad = validateTarget(actor, targetType, targetId);
  if (bad) return fail(bad);
  const channelId = str(data.channel_id);
  const badCh = validateChannel(channelId);
  if (badCh) return fail(badCh);
  const days = validateDays(data);
  if (days.error) return fail(days.error);
  const ins = run(
    "INSERT INTO recurring_reminders (title, body, links, target_type, target_id, channel_id, ping_day, due_day, active, created_by_id, created_by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
    [title, str(data.body, { max: 2000 }), str(data.links, { max: 2000 }), targetType, targetId, channelId, days.pingDay, days.dueDay, actor.id, actor.name]
  );
  const id = Number(ins.lastInsertRowid);
  logAudit(actor.id, actor.name, 'CREATE', 'recurring_reminder', id, title.substring(0, 100), `${targetType} ${targetId}, day ${days.pingDay}/${days.dueDay}`);
  bump();
  return { ok: true, id };
}

export async function updateReminder(id, data) {
  const actor = await requireActor(2);
  data = data && typeof data === 'object' ? data : {};
  const existing = queryOne("SELECT * FROM recurring_reminders WHERE id = ?", [toInt(id)]);
  if (!existing) return fail('Not found.');
  if (!ownsReminder(actor, existing)) return fail('You can only edit reminders for your own team.');
  const title = data.title === undefined ? existing.title : str(data.title, { max: 150 });
  if (!title) return fail('A title is required.');
  const targetType = data.target_type === undefined ? existing.target_type : oneOf(str(data.target_type), TARGET_TYPES);
  const targetId = data.target_id === undefined ? existing.target_id : str(data.target_id);
  const bad = validateTarget(actor, targetType, targetId);
  if (bad) return fail(bad);
  const channelId = data.channel_id === undefined ? existing.channel_id : str(data.channel_id);
  const badCh = validateChannel(channelId);
  if (badCh) return fail(badCh);
  const days = validateDays({ ping_day: data.ping_day ?? existing.ping_day, due_day: data.due_day ?? existing.due_day });
  if (days.error) return fail(days.error);
  const active = data.active === undefined ? existing.active : (data.active ? 1 : 0);
  run(
    "UPDATE recurring_reminders SET title=?, body=?, links=?, target_type=?, target_id=?, channel_id=?, ping_day=?, due_day=?, active=?, updated_at=? WHERE id=?",
    [title, data.body === undefined ? existing.body : str(data.body, { max: 2000 }), data.links === undefined ? existing.links : str(data.links, { max: 2000 }),
     targetType, targetId, channelId, days.pingDay, days.dueDay, active, nowIso(), existing.id]
  );
  logAudit(actor.id, actor.name, 'EDIT', 'recurring_reminder', existing.id, title.substring(0, 100), active !== existing.active ? (active ? 'Reactivated' : 'Deactivated') : 'Edited');
  bump();
  return { ok: true };
}

export async function deleteReminder(id) {
  const actor = await requireActor(2);
  const existing = queryOne("SELECT * FROM recurring_reminders WHERE id = ?", [toInt(id)]);
  if (!existing) return fail('Not found.');
  if (!ownsReminder(actor, existing)) return fail('You can only delete reminders for your own team.');
  if (!existing.active) return { ok: true, alreadyInactive: true };
  // Soft-delete: deactivate. Preserves history of past instances.
  run("UPDATE recurring_reminders SET active = 0, updated_at = ? WHERE id = ?", [nowIso(), existing.id]);
  logAudit(actor.id, actor.name, 'DELETE', 'recurring_reminder', existing.id, existing.title.substring(0, 100), 'Deactivated');
  bump();
  return { ok: true };
}

/** Mark someone's instance complete on their behalf (L3, or an L2 for their own team's reminder). */
export async function adminCompleteInstance(instanceId) {
  const actor = await requireActor(2);
  const inst = queryOne("SELECT i.*, r.title FROM recurring_reminder_instances i JOIN recurring_reminders r ON r.id = i.reminder_id WHERE i.id = ?", [toInt(instanceId)]);
  if (!inst) return fail('Instance not found.');
  const def = queryOne("SELECT * FROM recurring_reminders WHERE id = ?", [inst.reminder_id]);
  if (!ownsReminder(actor, def)) return fail('That reminder is not yours to manage.');
  if (inst.completed_at) return fail('Already completed.');
  run("UPDATE recurring_reminder_instances SET completed_at = ?, completed_by_id = ?, completed_by_name = ? WHERE id = ? AND completed_at IS NULL",
    [nowIso(), actor.id, actor.name, inst.id]);
  logAudit(actor.id, actor.name, 'EDIT', 'recurring_reminder_instance', inst.id, inst.recipient_name || inst.recipient_id, `Completed on their behalf — ${inst.title}`);
  bump();
  return { ok: true };
}

/** Who a definition goes to: active, clearance ≥ 1, never placeholders. */
function resolveRecipients(def) {
  if (def.target_type === 'User') {
    const u = queryOne(`SELECT discord_id, display_name FROM staff WHERE discord_id = ? AND ${ACTIVE_STAFF}`, [def.target_id]);
    return u ? [{ id: u.discord_id, name: u.display_name }] : [];
  }
  if (def.target_type === 'Team') {
    return query(`SELECT discord_id, display_name FROM staff WHERE team_id = ? AND ${ACTIVE_STAFF}`, [def.target_id]).map(r => ({ id: r.discord_id, name: r.display_name }));
  }
  if (def.target_type === 'Role') {
    const role = queryOne("SELECT key FROM discord_roles WHERE role_id = ?", [def.target_id]);
    if (!role) return [];
    const where = role.key === 'fm_leadership' ? 'clearance >= 3' : role.key === 'fm_team_lead' ? 'clearance = 2' : role.key === 'fm_team_guide' ? 'clearance >= 1' : null;
    if (!where) return [];
    return query(`SELECT discord_id, display_name FROM staff WHERE ${where} AND ${ACTIVE_STAFF} ORDER BY display_name`).map(r => ({ id: r.discord_id, name: r.display_name }));
  }
  return [];
}

// L3-only: force-fire a definition immediately, regardless of today's date.
// Checks the route and the token first, posts to Discord, and only then creates
// this month's instances (idempotent) — a failed send never leaves a record
// nobody was told about.
export async function forceSendRecurringReminder(reminderId) {
  const actor = await requireActor(3);
  const def = queryOne("SELECT * FROM recurring_reminders WHERE id = ? AND active = 1", [toInt(reminderId)]);
  if (!def) return fail('Reminder not found or archived.');
  if (!pingEnabled('reminder.recurring')) return fail('Recurring reminders are switched off in Admin › Pings.');
  if (!process.env.DISCORD_BOT_TOKEN) return fail('Discord bot token not configured.');
  if (!isSnowflake(def.channel_id)) return fail('This reminder has no valid channel; edit it and pick one.');

  const recipients = resolveRecipients(def);
  if (recipients.length === 0) return fail('No recipients resolved for this target.');

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const already = queryOne("SELECT COUNT(*) c FROM recurring_reminder_instances WHERE reminder_id = ? AND year = ? AND month = ?", [def.id, year, month])?.c || 0;

  let tag = '';
  if (def.target_type === 'Role') tag = '<@&' + def.target_id + '>';
  else if (def.target_type === 'User') tag = '<@' + def.target_id + '>';
  else if (def.target_type === 'Team') tag = recipients.map(r => '<@' + r.id + '>').join(' ');

  const linksBlock = def.links ? '\n\n**References:**\n' + def.links : '';
  const dueText = def.due_day ? '\n\n**Due:** Day ' + def.due_day + ' of this month.' : '';
  const description = (def.body || '') + dueText + linksBlock + `\n\n_View on the dashboard: ${urls.home()}_`;
  const colorInt = (typeof def.color === 'string' && def.color.startsWith('0x')) ? parseInt(def.color, 16) : (parseInt(def.color, 10) || 0xF59E0B);
  const embed = {
    title: '📅 ' + def.title,
    description,
    color: colorInt,
    footer: { text: 'Recurring · Day ' + def.ping_day + ' · Force-sent by ' + actor.name + (already ? ' · re-send' : '') },
  };

  const sent = await sendDiscord(def.channel_id, tag, [embed]);
  if (!sent) {
    logAudit(actor.id, actor.name, 'EDIT', 'recurring_reminder', def.id, def.title.substring(0, 50), `Force-send FAILED (Discord rejected the post to ${def.channel_id})`);
    return fail('Discord rejected the message — check the bot can post in that channel.');
  }

  let created = 0;
  for (const r of recipients) {
    try {
      created += run("INSERT OR IGNORE INTO recurring_reminder_instances (reminder_id, year, month, recipient_id, recipient_name) VALUES (?, ?, ?, ?, ?)",
        [def.id, year, month, r.id, r.name || '']).changes;
    } catch (e) { /* ignore individual insert failures */ }
  }
  logAudit(actor.id, actor.name, 'EDIT', 'recurring_reminder', def.id, def.title.substring(0, 50), `Force-sent to ${def.channel_id} (${recipients.length} recipients, ${created} new instance(s))`);
  bump();
  return { ok: true, recipientsCount: recipients.length, instancesCreated: created, resent: already > 0 };
}
