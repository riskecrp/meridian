"use server";
import { query, queryOne, run } from "../../../../lib/db.js";
import { requireActor } from "../../../../lib/requireActor.js";
import { sendDiscord } from "../../../../lib/discord.js";
import { pingEnabled } from "../../../../lib/pings.js";
import { logAudit } from "../../../../lib/audit.js";

// List all reminders.
// L3: all. L2: own only. L1: forbidden (page is L2+).
export async function listReminders() {
  const actor = await requireActor(2);
  let rows;
  if (actor.level >= 3) {
    rows = query("SELECT * FROM recurring_reminders ORDER BY ping_day, title");
  } else {
    rows = query("SELECT * FROM recurring_reminders WHERE created_by_id = ? ORDER BY ping_day, title", [actor.id]);
  }
  return rows;
}

// L3 sees all instances for a reminder for the current month, with completion status.
export async function getReminderProgress(reminderId, year, month) {
  await requireActor(3);
  return query(
    "SELECT * FROM recurring_reminder_instances WHERE reminder_id = ? AND year = ? AND month = ? ORDER BY recipient_name",
    [reminderId, year, month]
  );
}

// All Discord channels available for the dropdown.
export async function listChannels() {
  await requireActor(2);
  return query("SELECT key, channel_id FROM discord_config ORDER BY key");
}

// Possible target options for the dropdown.
export async function getTargetOptions() {
  await requireActor(2);
  const teams = query("SELECT DISTINCT team_id, team_name FROM staff WHERE team_id != '' AND team_name != 'Game Affairs Management' ORDER BY team_name");
  const staff = query("SELECT discord_id, display_name FROM staff WHERE discord_id != '' AND discord_id NOT LIKE 'placeholder%' ORDER BY display_name");
  const roles = query("SELECT key, role_id FROM discord_roles ORDER BY key");
  return { teams, staff, roles };
}

export async function createReminder(data) {
  const actor = await requireActor(2);
  if (!data.title || !data.target_type || !data.target_id || !data.channel_id || !data.ping_day) {
    return { ok: false, error: "Missing required fields" };
  }
  const pingDay = parseInt(data.ping_day);
  const dueDay = parseInt(data.due_day || data.ping_day);
  if (pingDay < 1 || pingDay > 31 || dueDay < 1 || dueDay > 31) return { ok: false, error: "Days must be 1-31" };
  if (dueDay < pingDay) return { ok: false, error: "Due day cannot be before ping day" };

  run(
    "INSERT INTO recurring_reminders (title, body, links, target_type, target_id, channel_id, ping_day, due_day, active, created_by_id, created_by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
    [data.title, data.body || '', data.links || '', data.target_type, data.target_id, data.channel_id, pingDay, dueDay, actor.id, actor.name]
  );
  logAudit(actor.id, actor.name, 'CREATE', 'recurring_reminder', null, data.title.substring(0, 100), 'Recurring reminder created');
  return { ok: true };
}

export async function updateReminder(id, data) {
  const actor = await requireActor(2);
  const existing = queryOne("SELECT * FROM recurring_reminders WHERE id = ?", [id]);
  if (!existing) return { ok: false, error: "Not found" };
  if (actor.level < 3 && existing.created_by_id !== actor.id) {
    return { ok: false, error: "L2 can only edit reminders they created" };
  }
  const pingDay = parseInt(data.ping_day);
  const dueDay = parseInt(data.due_day || data.ping_day);
  if (pingDay < 1 || pingDay > 31 || dueDay < 1 || dueDay > 31) return { ok: false, error: "Days must be 1-31" };
  if (dueDay < pingDay) return { ok: false, error: "Due day cannot be before ping day" };

  run(
    "UPDATE recurring_reminders SET title=?, body=?, links=?, target_type=?, target_id=?, channel_id=?, ping_day=?, due_day=?, active=?, updated_at=datetime('now') WHERE id=?",
    [data.title, data.body || '', data.links || '', data.target_type, data.target_id, data.channel_id, pingDay, dueDay, data.active ? 1 : 0, id]
  );
  logAudit(actor.id, actor.name, 'EDIT', 'recurring_reminder', id, data.title.substring(0, 100), '');
  return { ok: true };
}

export async function deleteReminder(id) {
  const actor = await requireActor(2);
  const existing = queryOne("SELECT * FROM recurring_reminders WHERE id = ?", [id]);
  if (!existing) return { ok: false, error: "Not found" };
  if (actor.level < 3 && existing.created_by_id !== actor.id) {
    return { ok: false, error: "L2 can only delete reminders they created" };
  }
  // Soft-delete: deactivate. Preserves history of past instances.
  run("UPDATE recurring_reminders SET active = 0, updated_at = datetime('now') WHERE id = ?", [id]);
  logAudit(actor.id, actor.name, 'DELETE', 'recurring_reminder', id, existing.title.substring(0, 100), 'Deactivated');
  return { ok: true };
}

// L3 mark someone else's instance complete on their behalf
export async function adminCompleteInstance(instanceId) {
  const actor = await requireActor(3);
  run("UPDATE recurring_reminder_instances SET completed_at = datetime('now'), completed_by_id = ?, completed_by_name = ? WHERE id = ? AND completed_at IS NULL",
    [actor.id, actor.name, instanceId]);
  logAudit(actor.id, actor.name, 'EDIT', 'recurring_reminder_instance', instanceId, '', 'Admin completed');
  return { ok: true };
}

// L3-only: force-fire a definition immediately, regardless of today's date.
// Creates instances for the current UTC month if missing, then posts Discord.
// Will overwrite-no-op if instances already exist for this month (idempotent).
export async function forceSendRecurringReminder(reminderId) {
  const actor = await requireActor(3);
  const def = queryOne("SELECT * FROM recurring_reminders WHERE id = ? AND active = 1", [reminderId]);
  if (!def) return { ok: false, error: "Reminder not found or archived" };

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;

  // Resolve recipients (mirrors bot logic)
  let recipients = [];
  if (def.target_type === 'User') {
    const u = queryOne("SELECT discord_id, display_name FROM staff WHERE discord_id = ?", [def.target_id]);
    if (u) recipients.push({ id: u.discord_id, name: u.display_name });
  } else if (def.target_type === 'Team') {
    recipients = query("SELECT discord_id, display_name FROM staff WHERE team_id = ? AND discord_id != '' AND discord_id NOT LIKE 'placeholder%'", [def.target_id])
      .map(r => ({ id: r.discord_id, name: r.display_name }));
  } else if (def.target_type === 'Role') {
    const role = queryOne("SELECT key FROM discord_roles WHERE role_id = ?", [def.target_id]);
    if (role) {
      let staffRows = [];
      if (role.key === 'fm_leadership') staffRows = query("SELECT discord_id, display_name FROM staff WHERE LOWER(rank) LIKE '%leadership%' OR LOWER(rank) LIKE '%management%'");
      else if (role.key === 'fm_team_lead') staffRows = query("SELECT discord_id, display_name FROM staff WHERE LOWER(rank) LIKE '%team lead%' OR LOWER(rank) LIKE '%lead%'");
      else if (role.key === 'fm_team_guide') staffRows = query("SELECT discord_id, display_name FROM staff WHERE discord_id != '' AND discord_id NOT LIKE 'placeholder%'");
      recipients = staffRows.filter(r => r.discord_id && !r.discord_id.startsWith('placeholder')).map(r => ({ id: r.discord_id, name: r.display_name }));
    }
  }
  if (recipients.length === 0) return { ok: false, error: "No recipients resolved for this target" };

  // Create instances (idempotent: INSERT OR IGNORE)
  for (const r of recipients) {
    try {
      run("INSERT OR IGNORE INTO recurring_reminder_instances (reminder_id, year, month, recipient_id, recipient_name) VALUES (?, ?, ?, ?, ?)",
        [def.id, year, month, r.id, r.name || '']);
    } catch (e) { /* ignore individual insert failures */ }
  }

  // Build embed
  let tag = '';
  if (def.target_type === 'Role') tag = '<@&' + def.target_id + '>';
  else if (def.target_type === 'User') tag = '<@' + def.target_id + '>';
  else if (def.target_type === 'Team') tag = recipients.map(r => '<@' + r.id + '>').join(' ');

  const linksBlock = def.links ? '\n\n**References:**\n' + def.links : '';
  const dueText = def.due_day ? '\n\n**Due:** Day ' + def.due_day + ' of this month.' : '';
  const description = (def.body || '') + dueText + linksBlock + '\n\n_View on the dashboard: https://ecrpfm.com/fm/dashboard_';
  const colorInt = (typeof def.color === 'string' && def.color.startsWith('0x')) ? parseInt(def.color, 16) : (parseInt(def.color, 10) || 0xF59E0B);
  const embed = {
    title: '📅 ' + def.title,
    description,
    color: colorInt,
    footer: { text: 'Recurring · Day ' + def.ping_day + ' · Force-sent by ' + actor.name },
  };

  // Destination is per-definition, but the route's toggle still governs whether
  // recurring reminders fire at all.
  if (!pingEnabled('reminder.recurring')) {
    return { ok: false, error: "Recurring reminders are switched off in Admin › Pings." };
  }

  try {
    await sendDiscord(def.channel_id, tag, [embed]);
  } catch (e) {
    return { ok: false, error: "Discord send failed: " + e.message };
  }

  logAudit(actor.id, actor.name, 'EDIT', 'recurring_reminder', def.id, def.title.substring(0, 50), 'Force-sent (' + recipients.length + ' recipients)');
  return { ok: true, recipientsCount: recipients.length };
}

