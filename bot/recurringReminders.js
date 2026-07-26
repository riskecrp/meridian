import { query, run, queryOne } from './lib/db.js';
import { pingEnabled } from './lib/pings.js';

// Resolves recipients for a definition.
function resolveRecipients(def) {
  if (def.target_type === 'User') {
    const u = queryOne("SELECT discord_id, display_name FROM staff WHERE discord_id = ?", [def.target_id]);
    return u ? [{ id: u.discord_id, name: u.display_name }] : [];
  }
  if (def.target_type === 'Team') {
    return query("SELECT discord_id, display_name FROM staff WHERE team_id = ? AND discord_id != '' AND discord_id NOT LIKE 'placeholder%'", [def.target_id])
      .map(r => ({ id: r.discord_id, name: r.display_name }));
  }
  if (def.target_type === 'Role') {
    const role = queryOne("SELECT key FROM discord_roles WHERE role_id = ?", [def.target_id]);
    if (!role) return [];
    let staffRows = [];
    if (role.key === 'fm_leadership') staffRows = query("SELECT discord_id, display_name FROM staff WHERE LOWER(rank) LIKE '%leadership%' OR LOWER(rank) LIKE '%management%'");
    else if (role.key === 'fm_team_lead') staffRows = query("SELECT discord_id, display_name FROM staff WHERE LOWER(rank) LIKE '%team lead%' OR LOWER(rank) LIKE '%lead%'");
    else if (role.key === 'fm_team_guide') staffRows = query("SELECT discord_id, display_name FROM staff WHERE discord_id != '' AND discord_id NOT LIKE 'placeholder%'");
    return staffRows.filter(r => r.discord_id && !r.discord_id.startsWith('placeholder')).map(r => ({ id: r.discord_id, name: r.display_name }));
  }
  return [];
}

// Fires one definition: creates instances + posts Discord ping.
// `force` skips the "instance already exists this month" idempotency check.
// Returns { ok, recipientsCount, sent }.
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

  // Create instances (idempotent)
  for (const r of recipients) {
    try {
      run("INSERT OR IGNORE INTO recurring_reminder_instances (reminder_id, year, month, recipient_id, recipient_name) VALUES (?, ?, ?, ?, ?)",
        [def.id, year, month, r.id, r.name || '']);
    } catch (e) { console.error('[RECURRING] insert instance failed:', e.message); }
  }

  // Build Discord ping
  let tag = '';
  if (def.target_type === 'Role') tag = `<@&${def.target_id}>`;
  else if (def.target_type === 'User') tag = `<@${def.target_id}>`;
  else if (def.target_type === 'Team') tag = recipients.map(r => `<@${r.id}>`).join(' ');

  const linksBlock = def.links ? `\n\n**References:**\n${def.links}` : '';
  const dueText = def.due_day ? `\n\n**Due:** Day ${def.due_day} of this month.` : '';
  const description = `${def.body || ''}${dueText}${linksBlock}\n\n_View on the dashboard: https://ecrpfm.com/fm/dashboard_`;
  const colorInt = (typeof def.color === 'string' && def.color.startsWith('0x')) ? parseInt(def.color, 16) : (parseInt(def.color, 10) || 0xF59E0B);

  if (!pingEnabled('reminder.recurring')) {
    console.log(`[RECURRING] Skipped "${def.title}" — route disabled in Admin › Pings`);
    return { ok: false, recipientsCount: recipients.length, sent: false, error: 'Route disabled' };
  }

  try {
    const channel = await client.channels.fetch(def.channel_id);
    await channel.send({
      content: tag,
      embeds: [{ title: `📅 ${def.title}`, description, color: colorInt, footer: { text: `Recurring · Day ${def.ping_day}${force ? ' · Force-sent' : ''}` } }],
    });
    console.log(`[RECURRING] Sent: ${def.title} (${recipients.length} recipients${force ? ', forced' : ''})`);
    return { ok: true, recipientsCount: recipients.length, sent: true };
  } catch (e) {
    console.error(`[RECURRING] send failed for "${def.title}":`, e.message);
    return { ok: false, recipientsCount: recipients.length, sent: false, error: e.message };
  }
}

// Daily check: fires any definition whose ping_day matches today and hasn't fired yet this month.
// Time gate: any time at/after 18:00 UTC. Idempotency prevents duplicates.
export async function checkRecurringReminders(client) {
  try {
    const now = new Date();
    const utcHour = now.getUTCHours();
    if (utcHour < 18) return; // Wait until 18:00 UTC; idempotency handles repeat checks after that.

    const day = now.getUTCDate();
    const month = now.getUTCMonth() + 1;
    const year = now.getUTCFullYear();

    const definitions = query("SELECT * FROM recurring_reminders WHERE active = 1 AND ping_day = ?", [day]);
    for (const def of definitions) {
      try { await fireReminderDefinition(client, def, year, month, false); }
      catch (e) { console.error(`[RECURRING] definition ${def.id} failed:`, e.message); }
    }
  } catch (e) { console.error('[RECURRING] Outer error:', e.message); }
}
