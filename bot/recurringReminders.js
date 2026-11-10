import { query, run, queryOne, transaction } from './lib/db.js';
import { recordSyncOk, recordSyncFail } from './lib/syncStatus.js';
import { pingEnabled, urls } from './lib/pings.js';

// Recipients for a definition — by clearance and flags, never by rank text
// (BOT-27). Role targets map to clearance bands; placeholder and retired rows
// never count.
const LIVE = "discord_id != '' AND discord_id NOT LIKE 'placeholder%' AND COALESCE(active, 1) = 1";
function resolveRecipients(def) {
  if (def.target_type === 'User') {
    const u = queryOne(`SELECT discord_id, display_name FROM staff WHERE discord_id = ? AND ${LIVE}`, [def.target_id]);
    return u ? [{ id: u.discord_id, name: u.display_name }] : [];
  }
  if (def.target_type === 'Team') {
    return query(`SELECT discord_id, display_name FROM staff WHERE team_id = ? AND ${LIVE} AND clearance >= 1`, [def.target_id])
      .map(r => ({ id: r.discord_id, name: r.display_name }));
  }
  if (def.target_type === 'Role') {
    const role = queryOne("SELECT key FROM discord_roles WHERE role_id = ?", [def.target_id]);
    if (!role) return [];
    let staffRows = [];
    if (role.key === 'fm_leadership' || role.key === 'game_affairs') staffRows = query(`SELECT discord_id, display_name FROM staff WHERE clearance >= 3 AND ${LIVE}`);
    else if (role.key === 'fm_team_lead') staffRows = query(`SELECT discord_id, display_name FROM staff WHERE clearance = 2 AND ${LIVE}`);
    else if (role.key === 'fm_team_guide') staffRows = query(`SELECT discord_id, display_name FROM staff WHERE clearance >= 1 AND ${LIVE}`);
    return staffRows.map(r => ({ id: r.discord_id, name: r.display_name }));
  }
  return [];
}

// Fires one definition: posts the Discord ping, THEN records the instances in
// one transaction — a month only counts as done once the ping was delivered
// (BOT-7). `force` skips the "already fired this month" check.
// Returns { ok, recipientsCount, sent, reason?, error? }.
export async function fireReminderDefinition(client, def, year, month, force = false) {
  if (!force) {
    const existing = queryOne("SELECT id FROM recurring_reminder_instances WHERE reminder_id = ? AND year = ? AND month = ? LIMIT 1", [def.id, year, month]);
    if (existing) return { ok: true, recipientsCount: 0, sent: false, reason: 'already_fired_this_month' };
  }

  const recipients = resolveRecipients(def);
  if (recipients.length === 0) {
    console.log(`[RECURRING] No recipients for "${def.title}"`);
    return { ok: true, recipientsCount: 0, sent: false, reason: 'no_recipients' };
  }

  if (!pingEnabled('reminder.recurring')) {
    console.log(`[RECURRING] Skipped "${def.title}" — route disabled in Admin › Pings`);
    return { ok: false, recipientsCount: recipients.length, sent: false, error: 'Route disabled' };
  }

  // Build Discord ping
  let tag = '';
  if (def.target_type === 'Role') tag = `<@&${def.target_id}>`;
  else if (def.target_type === 'User') tag = `<@${def.target_id}>`;
  else if (def.target_type === 'Team') tag = recipients.map(r => `<@${r.id}>`).join(' ');

  const linksBlock = def.links ? `\n\n**References:**\n${def.links}` : '';
  const dueText = def.due_day ? `\n\n**Due:** Day ${def.due_day} of this month.` : '';
  const description = `${def.body || ''}${dueText}${linksBlock}\n\n_View on the dashboard: ${urls.home()}_`;
  const colorInt = (typeof def.color === 'string' && def.color.startsWith('0x')) ? parseInt(def.color, 16) : (parseInt(def.color, 10) || 0xF59E0B);

  try {
    const channel = await client.channels.fetch(def.channel_id);
    await channel.send({
      content: tag,
      embeds: [{ title: `📅 ${def.title}`, description, color: colorInt, footer: { text: `Recurring · Day ${def.ping_day}${force ? ' · Force-sent' : ''}` } }],
    });
  } catch (e) {
    console.error(`[RECURRING] send failed for "${def.title}":`, e.message);
    return { ok: false, recipientsCount: recipients.length, sent: false, error: e.message };
  }

  // Delivered: now the month is done for every recipient (idempotent inserts).
  try {
    transaction(() => {
      for (const r of recipients) {
        run("INSERT OR IGNORE INTO recurring_reminder_instances (reminder_id, year, month, recipient_id, recipient_name) VALUES (?, ?, ?, ?, ?)",
          [def.id, year, month, r.id, r.name || '']);
      }
    });
  } catch (e) {
    console.error('[RECURRING] insert instances failed:', e.message);
    return { ok: false, recipientsCount: recipients.length, sent: true, error: `sent, but instances not recorded: ${e.message}` };
  }
  console.log(`[RECURRING] Sent: ${def.title} (${recipients.length} recipients${force ? ', forced' : ''})`);
  return { ok: true, recipientsCount: recipients.length, sent: true };
}

// Every-minute check: fires any definition whose ping_day matches today and
// hasn't fired yet this month. Time gate: any time at/after 18:00 UTC; the
// instance rows make repeat checks idempotent. Per-definition failures reach
// sync_status so a month that silently never fired is visible.
export async function checkRecurringReminders(client) {
  try {
    const now = new Date();
    const utcHour = now.getUTCHours();
    if (utcHour < 18) {
      recordSyncOk('recurring_reminders', 'checked; holding until 18:00 UTC');
      return;
    }

    const day = now.getUTCDate();
    const month = now.getUTCMonth() + 1;
    const year = now.getUTCFullYear();

    const definitions = query("SELECT * FROM recurring_reminders WHERE active = 1 AND ping_day = ?", [day]);
    const failures = [];
    let sent = 0;
    for (const def of definitions) {
      try {
        const r = await fireReminderDefinition(client, def, year, month, false);
        if (r.sent) sent++;
        if (!r.ok) failures.push(`"${def.title}": ${r.error}`);
      } catch (e) { console.error(`[RECURRING] definition ${def.id} failed:`, e.message); failures.push(`"${def.title}": ${e.message}`); }
    }
    if (failures.length) recordSyncFail('recurring_reminders', failures.join(' | '));
    else recordSyncOk('recurring_reminders', `${definitions.length} definition(s) due today, ${sent} sent now`);
  } catch (e) { console.error('[RECURRING] Outer error:', e.message); recordSyncFail('recurring_reminders', e); }
}
