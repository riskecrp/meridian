import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { run } from '../lib/db.js';
import { logAudit, actorOf } from '../lib/audit.js';
export default {
  data: new SlashCommandBuilder().setName('reminder').setDescription('Set a reminder')
    .addStringOption(o => o.setName('message').setDescription('Reminder message').setRequired(true))
    .addStringOption(o => o.setName('time').setDescription('When (e.g. "30m", "2h", "1d", or "2026-04-10 15:00")').setRequired(true))
    .addUserOption(o => o.setName('user').setDescription('Ping a specific user').setRequired(false))
    .addRoleOption(o => o.setName('role').setDescription('Ping a role instead').setRequired(false)),
  async execute(interaction) {
    const message = interaction.options.getString('message');
    const timeStr = interaction.options.getString('time');
    const pingUser = interaction.options.getUser('user');
    const pingRole = interaction.options.getRole('role');
    let epochMs;
    const match = timeStr.match(/^(\d+)(m|h|d)$/i);
    if (match) {
      const mult = { m: 60000, h: 3600000, d: 86400000 };
      epochMs = Date.now() + parseInt(match[1]) * mult[match[2].toLowerCase()];
    } else {
      const parsed = new Date(timeStr);
      if (isNaN(parsed.getTime())) return interaction.reply({ content: 'Invalid time. Use "30m", "2h", "1d", or a date like "2026-04-10 15:00"', ephemeral: true });
      epochMs = parsed.getTime();
    }
    const uuid = Math.random().toString(36).substring(2, 8);
    let targetTag;
    if (pingRole) targetTag = `<@&${pingRole.id}>`;
    else if (pingUser) targetTag = `<@${pingUser.id}>`;
    else targetTag = `<@${interaction.user.id}>`;
    run("INSERT INTO reminders (uuid, author_id, channel_id, message, epoch_ms, readable_time, repeat_rule, target_tag, status) VALUES (?, ?, ?, ?, ?, ?, 'None', ?, 'ACTIVE')",
      [uuid, interaction.user.id, interaction.channelId, message, epochMs.toString(), new Date(epochMs).toISOString(), targetTag]);
    logAudit(interaction.user.id, actorOf(interaction), 'CREATE', 'reminder', uuid, message.slice(0, 120), `via /reminder · fires ${new Date(epochMs).toISOString().slice(0, 16).replace('T', ' ')} UTC`);
    const ts = Math.floor(epochMs / 1000);
    const embed = new EmbedBuilder().setTitle('⏰ Reminder Set').setColor(0x6366F1)
      .setDescription(`**Message:** ${message}\n**When:** <t:${ts}:F> (<t:${ts}:R>)\n**Ping:** ${targetTag}`)
      .setFooter({ text: `ID: ${uuid}` });
    await interaction.reply({ embeds: [embed] });
  }
};
