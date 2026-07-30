import { SlashCommandBuilder } from 'discord.js';
import { queryOne, run } from '../lib/db.js';
import { logAudit } from '../lib/audit.js';
export default {
  data: new SlashCommandBuilder().setName('logscene').setDescription('Quickly log a faction scene')
    .addStringOption(o => o.setName('faction').setDescription('Faction name').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('notes').setDescription('Scene notes').setRequired(true))
    .addStringOption(o => o.setName('rewards').setDescription('Rewards given').setRequired(false)),
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const { query } = await import('../lib/db.js');
    const factions = query("SELECT name FROM factions ORDER BY name").map(r => r.name);
    await interaction.respond(factions.filter(f => f.toLowerCase().includes(focused)).slice(0, 25).map(f => ({ name: f, value: f })));
  },
  async execute(interaction) {
    const factionName = interaction.options.getString('faction');
    const notes = interaction.options.getString('notes');
    const rewards = interaction.options.getString('rewards') || 'None';
    const f = queryOne("SELECT id FROM factions WHERE name = ?", [factionName]);
    if (!f) return interaction.reply({ content: `Faction "${factionName}" not found.`, ephemeral: true });
    const today = new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }).replace(/ /g, '/').toUpperCase();
    const author = interaction.user.globalName || interaction.user.username;
    run("INSERT INTO scene_logs (date, faction_id, rewards, logged_by, notes, author_id) VALUES (?, ?, ?, ?, ?, ?)",
      [today, f.id, rewards, author, notes, interaction.user.id]);
    logAudit(interaction.user.id, author, 'CREATE', 'scene', f.id, factionName,
      `via /logscene${rewards !== 'None' ? ` · rewards: ${rewards}` : ''}`);
    await interaction.reply({ content: `✅ Scene logged for **${factionName}**\n> ${notes.substring(0, 200)}${rewards !== 'None' ? `\n**Rewards:** ${rewards}` : ''}` });
  }
};
