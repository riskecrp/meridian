import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { query } from '../lib/db.js';
import { requireStaff, replyEphemeral } from '../lib/auth.js';
import { findFaction, respondFactions } from '../lib/factions.js';

export default {
  data: new SlashCommandBuilder().setName('imports').setDescription('Show authorized imports for a faction')
    .addStringOption(o => o.setName('faction').setDescription('Faction name').setRequired(true).setAutocomplete(true)),
  async autocomplete(interaction) { await respondFactions(interaction, { includeArchived: true }); },
  async execute(interaction) {
    const actor = await requireStaff(interaction, 1, { allowLeadStoryteller: true });
    if (!actor) return;
    const r = findFaction(interaction.options.getString('faction'), { allowArchived: true });
    if (r.error) return replyEphemeral(interaction, `❌ ${r.error}`);
    const f = r.faction;
    await interaction.deferReply({ ephemeral: true });
    const imports = query("SELECT i.name, i.tier, i.category FROM import_items i JOIN faction_imports fi ON fi.item_id = i.id WHERE fi.faction_id = ? AND fi.permitted = 1 ORDER BY i.tier, i.name", [f.id]);
    if (imports.length === 0) return interaction.editReply({ content: `No authorized imports for **${f.name}** (Tier ${f.tier}).` });
    const byTier = {};
    imports.forEach(i => { if (!byTier[i.tier]) byTier[i.tier] = []; byTier[i.tier].push(i.name); });
    const desc = Object.entries(byTier).sort((a, b) => a[0] - b[0]).map(([t, items]) => `**Tier ${t}:** ${items.join(', ')}`).join('\n\n');
    const embed = new EmbedBuilder().setTitle(`Imports: ${f.name} (T${f.tier})${f.archived ? ' — archived' : ''}`).setColor(0x6366F1)
      .setDescription(desc.substring(0, 4096)).setFooter({ text: `${imports.length} items authorized` });
    await interaction.editReply({ embeds: [embed] });
  }
};
