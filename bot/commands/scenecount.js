import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { query } from '../lib/db.js';
import { requireStaff } from '../lib/auth.js';

export default {
  data: new SlashCommandBuilder().setName('scenecount').setDescription('Show scene counts for all factions'),
  async execute(interaction) {
    const actor = await requireStaff(interaction, 1, { allowLeadStoryteller: true });
    if (!actor) return;
    await interaction.deferReply();
    const archived = new Set(query("SELECT name FROM factions WHERE archived = 1").map(r => r.name));
    const stats = query("SELECT * FROM v_faction_scene_stats ORDER BY scenes_30d DESC").filter(s => !archived.has(s.faction_name));
    if (stats.length === 0) return interaction.editReply({ content: 'No scene data.' });
    const lines = stats.map(s => `**${s.faction_name}** — 30d: ${s.scenes_30d} | All: ${s.all_time}`);
    const embed = new EmbedBuilder().setTitle('Scene Activity').setColor(0x22C55E)
      .setDescription(lines.join('\n').substring(0, 4096))
      .setFooter({ text: `${stats.length} active factions tracked` });
    await interaction.editReply({ embeds: [embed] });
  }
};
