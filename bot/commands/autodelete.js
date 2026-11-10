import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { query, queryOne, run } from '../lib/db.js';
import { logAudit } from '../lib/audit.js';
import { requireStaff } from '../lib/auth.js';

// setDefaultMemberPermissions only hides the command from the menu; the
// requireStaff(3) check below is the real gate.
export default {
  data: new SlashCommandBuilder()
    .setName('autodelete')
    .setDescription('Configure automatic message deletion for a channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand(sub => sub
      .setName('set')
      .setDescription('Enable auto-delete in a channel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel to configure').setRequired(true))
      .addIntegerOption(o => o.setName('delay').setDescription('Seconds before deletion (0 = immediate)').setRequired(false).setMinValue(0).setMaxValue(3600)))
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Disable auto-delete for a channel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel to stop auto-deleting').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List all channels with auto-delete enabled')),

  async execute(interaction) {
    const actor = await requireStaff(interaction, 3);
    if (!actor) return;
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const channel = interaction.options.getChannel('channel');
      const delay   = Math.min(3600, Math.max(0, interaction.options.getInteger('delay') ?? 0));
      run(
        `INSERT INTO auto_delete_channels (channel_id, channel_name, delay_seconds, added_by_id, added_by_name, added_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(channel_id) DO UPDATE SET channel_name = excluded.channel_name, delay_seconds = excluded.delay_seconds,
           added_by_id = excluded.added_by_id, added_by_name = excluded.added_by_name, added_at = excluded.added_at`,
        [channel.id, channel.name, delay, actor.id, actor.name]
      );
      logAudit(actor.id, actor.name, 'EDIT', 'auto_delete_channel', channel.id, '#' + channel.name, `auto-delete on, delay ${delay}s`);
      const label = delay === 0 ? 'immediately' : `after ${delay}s`;
      await interaction.reply({
        content: `✅ Auto-delete enabled in <#${channel.id}> — messages will be deleted **${label}**.`,
        ephemeral: true,
      });
      return;
    }

    if (sub === 'remove') {
      const channel = interaction.options.getChannel('channel');
      const existing = queryOne("SELECT channel_id FROM auto_delete_channels WHERE channel_id = ?", [channel.id]);
      if (!existing) {
        await interaction.reply({ content: `<#${channel.id}> doesn't have auto-delete configured.`, ephemeral: true });
        return;
      }
      run("DELETE FROM auto_delete_channels WHERE channel_id = ?", [channel.id]);
      logAudit(actor.id, actor.name, 'DELETE', 'auto_delete_channel', channel.id, '#' + channel.name, 'auto-delete off');
      await interaction.reply({ content: `✅ Auto-delete disabled for <#${channel.id}>.`, ephemeral: true });
      return;
    }

    if (sub === 'list') {
      const rows = query("SELECT channel_id, channel_name, delay_seconds, added_by_name FROM auto_delete_channels ORDER BY added_at DESC");
      if (rows.length === 0) {
        await interaction.reply({ content: 'No channels have auto-delete configured.', ephemeral: true });
        return;
      }
      const lines = rows.map(r => {
        const label = r.delay_seconds === 0 ? 'immediate' : `${r.delay_seconds}s delay`;
        return `• <#${r.channel_id}> (${r.channel_name}) — ${label} — set by ${r.added_by_name}`;
      });
      await interaction.reply({ content: `**Auto-delete channels:**\n${lines.join('\n')}`.slice(0, 1900), ephemeral: true });
    }
  },
};
