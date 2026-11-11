import { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { requireStaff, replyEphemeral } from '../lib/auth.js';
import { assertFactionWrite, respondFactions } from '../lib/factions.js';

// Staff scene feedback via a form. The modal carries the FACTION ID (never the
// name) in its custom id; index.js resolves it again on submit and re-checks
// the scope, since a modal can be submitted long after it was opened.
export default {
  data: new SlashCommandBuilder().setName('feedback').setDescription('Submit scene feedback via a form')
    .addStringOption(o => o.setName('faction').setDescription('Faction name').setRequired(true).setAutocomplete(true)),
  async autocomplete(interaction) { await respondFactions(interaction); },
  async execute(interaction) {
    const actor = await requireStaff(interaction, 1);
    if (!actor) return;
    const r = assertFactionWrite(actor, interaction.options.getString('faction'));
    if (r.error) return replyEphemeral(interaction, `❌ ${r.error}`);
    const f = r.faction;
    const modal = new ModalBuilder()
      .setCustomId(`feedback_modal_${f.id}`)
      .setTitle(`Scene Feedback: ${f.name.substring(0, 30)}`);
    const notesInput = new TextInputBuilder()
      .setCustomId('notes').setLabel('Scene Notes').setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Describe the scene, interactions, and observations...').setRequired(true).setMaxLength(4000);
    const rewardsInput = new TextInputBuilder()
      .setCustomId('rewards').setLabel('Rewards (optional)')
      .setStyle(TextInputStyle.Short).setPlaceholder('e.g. $5,000, 2x Pistol').setRequired(false).setMaxLength(500);
    modal.addComponents(
      new ActionRowBuilder().addComponents(notesInput),
      new ActionRowBuilder().addComponents(rewardsInput)
    );
    await interaction.showModal(modal);
  }
};
