import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { query, queryOne } from '../lib/db.js';
export default {
  data: new SlashCommandBuilder().setName('imports').setDescription('Show authorized imports for a faction')
    .addStringOption(o => o.setName('faction').setDescription('Faction name').setRequired(true).setAutocomplete(true)),
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const factions = query("SELECT name FROM factions ORDER BY name").map(r => r.name);
    await interaction.respond(factions.filter(f => f.toLowerCase().includes(focused)).slice(0, 25).map(f => ({ name: f, value: f })));
  },
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const factionName = interaction.options.getString('faction');
    const f = queryOne("SELECT id, tier FROM factions WHERE name = ?", [factionName]);
    if (!f) return interaction.editReply({ content: `Faction "${factionName}" not found.`, ephemeral: true });
    const imports = query("SELECT i.name, i.tier, i.category FROM import_items i JOIN faction_imports fi ON fi.item_id = i.id WHERE fi.faction_id = ? AND fi.permitted = 1 ORDER BY i.tier, i.name", [f.id]);
    if (imports.length === 0) return interaction.editReply({ content: `No authorized imports for **${factionName}** (Tier ${f.tier}).`, ephemeral: true });
    const byTier = {};
    imports.forEach(i => { if (!byTier[i.tier]) byTier[i.tier] = []; byTier[i.tier].push(i.name); });
    const desc = Object.entries(byTier).sort((a,b) => a[0]-b[0]).map(([t, items]) => `**Tier ${t}:** ${items.join(', ')}`).join('\n\n');
    const embed = new EmbedBuilder().setTitle(`Imports: ${factionName} (T${f.tier})`).setColor(0x6366F1)
      .setDescription(desc.substring(0, 4096)).setFooter({ text: `${imports.length} items authorized` });
    await interaction.editReply({ embeds: [embed] });
  }
};
