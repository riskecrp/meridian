import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { query, queryOne, run } from '../lib/db.js';

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
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const channel = interaction.options.getChannel('channel');
      const delay   = interaction.options.getInteger('delay') ?? 0;
      run(
        `INSERT OR REPLACE INTO auto_delete_channels (channel_id, channel_name, delay_seconds, added_by_id, added_by_name, added_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`,
        [channel.id, channel.name, delay, interaction.user.id, interaction.user.globalName || interaction.user.username]
      );
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
      await interaction.reply({ content: `**Auto-delete channels:**\n${lines.join('\n')}`, ephemeral: true });
    }
  },
};
