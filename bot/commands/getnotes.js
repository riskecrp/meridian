import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { query } from '../lib/db.js';
import { requireStaff, replyEphemeral } from '../lib/auth.js';
import { findFaction, respondFactions } from '../lib/factions.js';
import { toInt } from '../../shared/validate.js';
import { legacyDate } from '../../shared/dates.js';

export default {
  data: new SlashCommandBuilder().setName('getnotes').setDescription('View recent intel notes for a faction')
    .addStringOption(o => o.setName('faction').setDescription('Faction name').setRequired(true).setAutocomplete(true))
    .addIntegerOption(o => o.setName('count').setDescription('Number of notes (1-25, default 5)').setRequired(false).setMinValue(1).setMaxValue(25)),
  async autocomplete(interaction) { await respondFactions(interaction, { includeArchived: true }); },
  async execute(interaction) {
    // Intel is readable by staff and by the Lead Storyteller (read-only role).
    const actor = await requireStaff(interaction, 1, { allowLeadStoryteller: true });
    if (!actor) return;
    const r = findFaction(interaction.options.getString('faction'), { allowArchived: true });
    if (r.error) return replyEphemeral(interaction, `❌ ${r.error}`);
    const f = r.faction;
    const count = toInt(interaction.options.getInteger('count'), { min: 1, max: 25, def: 5 });
    const notes = query("SELECT text, author, date FROM intel_notes WHERE faction_id = ? ORDER BY created_at DESC LIMIT ?", [f.id, count]);
    if (notes.length === 0) return replyEphemeral(interaction, `No notes for **${f.name}**.`);
    const embed = new EmbedBuilder().setTitle(`Intel: ${f.name}${f.archived ? ' (archived)' : ''}`).setColor(0x6366F1)
      .setDescription(notes.map(n => `**${n.author}** (${legacyDate(n.date)})\n${n.text}`).join('\n\n').substring(0, 4096));
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
