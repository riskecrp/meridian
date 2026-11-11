import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { run } from '../lib/db.js';
import { logAudit } from '../lib/audit.js';
import { requireStaff, replyEphemeral } from '../lib/auth.js';
import { parseDate } from '../../shared/dates.js';
import { str } from '../../shared/validate.js';

// Absolute times are read as UTC (shared/dates.js parseDate), and the reply
// shows a Discord timestamp so everyone sees it in their own zone.
export function parseWhen(timeStr, now = Date.now()) {
  const s = String(timeStr || '').trim();
  const match = s.match(/^(\d+)\s*(m|h|d)$/i);
  if (match) {
    const n = parseInt(match[1], 10);
    if (!n) return { error: 'The delay has to be at least 1 minute.' };
    const mult = { m: 60000, h: 3600000, d: 86400000 };
    const ms = n * mult[match[2].toLowerCase()];
    if (ms > 365 * 86400000) return { error: 'Reminders can be at most a year out.' };
    return { epochMs: now + ms };
  }
  const parsed = parseDate(s);
  if (!parsed) return { error: 'Invalid time. Use "30m", "2h", "1d", or a UTC date like "2026-04-10 15:00".' };
  if (parsed.getTime() <= now) return { error: 'That time is in the past (times are UTC).' };
  return { epochMs: parsed.getTime() };
}

export default {
  data: new SlashCommandBuilder().setName('reminder').setDescription('Set a reminder')
    .addStringOption(o => o.setName('message').setDescription('Reminder message').setRequired(true).setMaxLength(1000))
    .addStringOption(o => o.setName('time').setDescription('When (e.g. "30m", "2h", "1d", or "2026-04-10 15:00" UTC)').setRequired(true))
    .addUserOption(o => o.setName('user').setDescription('Ping a specific user').setRequired(false))
    .addRoleOption(o => o.setName('role').setDescription('Ping a role instead').setRequired(false)),
  async execute(interaction) {
    const actor = await requireStaff(interaction, 1);
    if (!actor) return;
    const message = str(interaction.options.getString('message'), { max: 1000 });
    if (!message) return replyEphemeral(interaction, '❌ A message is required.');
    const when = parseWhen(interaction.options.getString('time'));
    if (when.error) return replyEphemeral(interaction, `❌ ${when.error}`);
    const epochMs = when.epochMs;
    const pingUser = interaction.options.getUser('user');
    const pingRole = interaction.options.getRole('role');
    const uuid = Math.random().toString(36).substring(2, 8);
    let targetTag;
    if (pingRole) targetTag = `<@&${pingRole.id}>`;
    else if (pingUser) targetTag = `<@${pingUser.id}>`;
    else targetTag = `<@${actor.id}>`;
    run("INSERT INTO reminders (uuid, author_id, channel_id, message, epoch_ms, readable_time, repeat_rule, target_tag, status) VALUES (?, ?, ?, ?, ?, ?, 'None', ?, 'ACTIVE')",
      [uuid, actor.id, interaction.channelId, message, epochMs.toString(), new Date(epochMs).toISOString(), targetTag]);
    logAudit(actor.id, actor.name, 'CREATE', 'reminder', uuid, message.slice(0, 120), `via /reminder · fires ${new Date(epochMs).toISOString().slice(0, 16).replace('T', ' ')} UTC`);
    const ts = Math.floor(epochMs / 1000);
    const embed = new EmbedBuilder().setTitle('⏰ Reminder Set').setColor(0x6366F1)
      .setDescription(`**Message:** ${message}\n**When:** <t:${ts}:F> (<t:${ts}:R>)\n**Ping:** ${targetTag}`)
      .setFooter({ text: `ID: ${uuid}` });
    await interaction.reply({ embeds: [embed] });
  }
};
