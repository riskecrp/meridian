import { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { query } from '../lib/db.js';
export default {
  data: new SlashCommandBuilder().setName('feedback').setDescription('Submit scene feedback via a form')
    .addStringOption(o => o.setName('faction').setDescription('Faction name').setRequired(true).setAutocomplete(true)),
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const factions = query("SELECT name FROM factions ORDER BY name").map(r => r.name);
    await interaction.respond(factions.filter(f => f.toLowerCase().includes(focused)).slice(0, 25).map(f => ({ name: f, value: f })));
  },
  async execute(interaction) {
    const factionName = interaction.options.getString('faction');
    const modal = new ModalBuilder()
      .setCustomId(`feedback_modal_${factionName}`)
      .setTitle(`Scene Feedback: ${factionName.substring(0, 30)}`);
    const notesInput = new TextInputBuilder()
      .setCustomId('notes').setLabel('Scene Notes').setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Describe the scene, interactions, and observations...').setRequired(true);
    const rewardsInput = new TextInputBuilder()
      .setCustomId('rewards').setLabel('Rewards (optional)')
      .setStyle(TextInputStyle.Short).setPlaceholder('e.g. $5,000, 2x Pistol').setRequired(false);
    modal.addComponents(
      new ActionRowBuilder().addComponents(notesInput),
      new ActionRowBuilder().addComponents(rewardsInput)
    );
    await interaction.showModal(modal);
  }
};
