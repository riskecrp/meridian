import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { query, queryOne } from '../lib/db.js';
export default {
  data: new SlashCommandBuilder().setName('getnotes').setDescription('View recent intel notes for a faction')
    .addStringOption(o => o.setName('faction').setDescription('Faction name').setRequired(true).setAutocomplete(true))
    .addIntegerOption(o => o.setName('count').setDescription('Number of notes (default 5)').setRequired(false)),
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const factions = query("SELECT name FROM factions ORDER BY name").map(r => r.name);
    await interaction.respond(factions.filter(f => f.toLowerCase().includes(focused)).slice(0, 25).map(f => ({ name: f, value: f })));
  },
  async execute(interaction) {
    const factionName = interaction.options.getString('faction');
    const count = interaction.options.getInteger('count') || 5;
    const f = queryOne("SELECT id FROM factions WHERE name = ?", [factionName]);
    if (!f) return interaction.reply({ content: `Faction "${factionName}" not found.`, ephemeral: true });
    const notes = query("SELECT text, author, date FROM intel_notes WHERE faction_id = ? ORDER BY created_at DESC LIMIT ?", [f.id, count]);
    if (notes.length === 0) return interaction.reply({ content: `No notes for **${factionName}**.`, ephemeral: true });
    const embed = new EmbedBuilder().setTitle(`Intel: ${factionName}`).setColor(0x6366F1)
      .setDescription(notes.map(n => `**${n.author}** (${n.date})\n${n.text}`).join('\n\n').substring(0, 4096));
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
